package com.codebasenotes.core

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path

class ConfigRepository(
    private val localizer: CoreLocalizer = DefaultCoreLocalizer,
    private val fileStore: AtomicFileStore = AtomicFileStore(localizer = localizer),
) {
    fun load(configPath: Path): LoadResult {
        val bytes = try {
            Files.readAllBytes(configPath)
        } catch (_: NoSuchFileException) {
            return LoadResult.Missing
        } catch (error: Throwable) {
            return LoadResult.Invalid(localizer.message("config.read.failed", error.message.orEmpty()))
        }

        return when (val parsed = ConfigParser.parse(bytes, localizer)) {
            is ParseResult.WritableV1 -> LoadResult.Loaded(
                ConfigSnapshot(configPath, parsed.document, bytes),
            )
            is ParseResult.ReadonlyFuture -> LoadResult.ReadonlyFuture(parsed.version)
            is ParseResult.Invalid -> LoadResult.Invalid(parsed.message)
        }
    }

    fun create(configPath: Path): CommitResult = safely {
        fileStore.withLock(configPath) {
            when (val current = load(configPath)) {
                is LoadResult.Loaded -> CommitResult.NoChange(current.snapshot)
                is LoadResult.ReadonlyFuture -> CommitResult.Readonly(
                    localizer.message("config.version.unsupported", current.version),
                )
                is LoadResult.Invalid -> CommitResult.Failed(current.message)
                LoadResult.Missing -> {
                    val root = ConfigParser.mapper.createObjectNode().apply {
                        put("version", 1)
                        set<ObjectNode>("notes", ConfigParser.mapper.createObjectNode())
                    }
                    write(configPath, ConfigDocument(root, root.withObject("notes")))
                }
            }
        }
    }

    fun setNote(base: ConfigSnapshot, key: String, note: ObjectNode?): CommitResult {
        require(PathPolicy.isValidKey(key)) { localizer.message("path.key.invalid", key) }
        return commit(base, mapOf(key to note))
    }

    fun commit(base: ConfigSnapshot, intent: Map<String, JsonNode?>): CommitResult = safely {
        fileStore.withLock(base.configPath) {
            when (val disk = load(base.configPath)) {
                is LoadResult.Loaded -> {
                    val merged = Merge.threeWay(base.document.notes, disk.snapshot.document.notes, intent)
                    when (merged) {
                        is MergeResult.Conflict -> CommitResult.Conflict(merged.paths)
                        is MergeResult.Merged -> {
                            if (merged.notes == disk.snapshot.document.notes) {
                                CommitResult.NoChange(disk.snapshot)
                            } else {
                                // 未被本次操作触及的根字段，以锁内刚读到的磁盘版本为准。
                                val root = disk.snapshot.document.root.deepCopy()
                                root.set<ObjectNode>("notes", merged.notes)
                                write(base.configPath, ConfigDocument(root, merged.notes))
                            }
                        }
                    }
                }
                is LoadResult.ReadonlyFuture -> CommitResult.Readonly(
                    localizer.message("config.version.unsupported", disk.version),
                )
                is LoadResult.Invalid -> CommitResult.Failed(disk.message)
                LoadResult.Missing -> CommitResult.Failed(localizer.message("config.deleted"))
            }
        }
    }

    fun move(base: ConfigSnapshot, oldPrefix: String, newPrefix: String): CommitResult {
        val plan = Move.plan(base.document.notes, oldPrefix, newPrefix, localizer)
        if (plan is MovePlan.Conflict) return CommitResult.Conflict(plan.paths)
        val moved = Move.apply(base.document.notes, plan as MovePlan.Planned)
        val intent = linkedMapOf<String, JsonNode?>()
        val keys = (base.document.notes.fieldNames().asSequence().toSet() +
            moved.fieldNames().asSequence().toSet())
        keys.forEach { key ->
            val before = base.document.notes.get(key)
            val after = moved.get(key)
            if (before != after) intent[key] = after
        }
        return commit(base, intent)
    }

    private fun write(path: Path, document: ConfigDocument): CommitResult.Committed {
        val bytes = ConfigSerializer.serialize(document)
        // Repository 是所有写入口的最后一道边界，不能依赖 Action 或未来调用者永远传合法对象。
        check(ConfigParser.parse(bytes, localizer) is ParseResult.WritableV1) {
            localizer.message("config.write.invalid")
        }
        fileStore.atomicReplace(path, bytes)
        return CommitResult.Committed(ConfigSnapshot(path, document, bytes))
    }

    private inline fun safely(action: () -> CommitResult): CommitResult = try {
        action()
    } catch (error: Throwable) {
        CommitResult.Failed(error.message ?: localizer.message("config.write.failed"))
    }
}
