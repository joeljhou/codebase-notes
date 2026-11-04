package com.codebasenotes.core

import com.fasterxml.jackson.databind.node.ObjectNode
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CompactionTest {
    @TempDir
    lateinit var root: Path
    private val chain = "src/main/java/cn/geekyspace/app"
    private val integration = "$chain/integration"
    private val unit = "$chain/unit"
    private val repository = ConfigRepository()
    private val configPath get() = root.resolve(CONFIG_FILE_NAME)

    private fun snapshot(result: CommitResult): ConfigSnapshot = when (result) {
        is CommitResult.Committed -> result.snapshot
        is CommitResult.NoChange -> result.snapshot
        else -> error("Unexpected result: $result")
    }

    private fun note(text: String): ObjectNode = ConfigParser.mapper.createObjectNode().put("text", text)

    private fun setup(): ConfigSnapshot {
        Files.createDirectories(root.resolve(integration))
        Files.createDirectory(root.resolve(unit))
        val base = snapshot(repository.create(configPath))
        val styled = note("集成测试").put("style", "focus").apply { putObject("future").put("kept", true) }
        return snapshot(repository.commit(base, mapOf(integration to styled, unit to note("单元测试"))))
    }

    private fun stored(): ObjectNode = ConfigParser.mapper.readTree(Files.readAllBytes(configPath)).path("notes") as ObjectNode

    @Test
    fun `single directory chains split on intermediate notes and compact after removal`() {
        var base = setup()
        assertTrue(stored().has(chain))
        base = snapshot(repository.setNote(base, "src/main/java/cn", note("包入口").put("style", "core")))
        assertEquals("包入口", stored().path("src/main/java/cn").path("_text").textValue())
        assertTrue(stored().path("src/main/java/cn").has("geekyspace/app"))
        val edited = (base.document.notes.get(integration) as ObjectNode).deepCopy().put("text", "集成验证").put("style", "stable")
        base = snapshot(repository.setNote(base, integration, edited))
        assertTrue(base.document.notes.path(integration).path("future").path("kept").booleanValue())
        base = snapshot(repository.setNote(base, "src/main/java/cn", null))
        assertEquals("stable", stored().path(chain).path("integration").path("_meta").path("style").textValue())
        base = snapshot(repository.setNote(base, unit, null))
        assertTrue(stored().has(chain))
        assertTrue(!stored().has("$chain/integration"))
        base = snapshot(repository.setNote(base, integration, null))
        assertTrue(stored().isEmpty)
        assertTrue(base.document.notes.isEmpty)
    }

    @Test
    fun `unannotated files and branches block compaction and normalization is idempotent`() {
        val base = setup()
        Files.writeString(root.resolve("src/main/README.md"), "unannotated")
        val expanded = assertIs<CommitResult.Committed>(repository.normalize(configPath)).snapshot
        assertEquals(base.document.notes, expanded.document.notes)
        assertTrue(stored().path("src/main").has("java/cn/geekyspace/app"))
        Files.delete(root.resolve("src/main/README.md"))
        assertIs<CommitResult.Committed>(repository.normalize(configPath))
        assertTrue(stored().has(chain))
        val bytes = Files.readAllBytes(configPath)
        assertIs<CommitResult.NoChange>(repository.normalize(configPath))
        assertContentEquals(bytes, Files.readAllBytes(configPath))
        Files.createDirectory(root.resolve("src/other"))
        assertIs<CommitResult.Committed>(repository.commit(base, emptyMap()))
        assertTrue(stored().path("src").has("main/java/cn/geekyspace/app"))
    }

    @Test
    fun `moves recompute compact paths and preserve all metadata`() {
        val base = setup()
        Files.createDirectory(root.resolve("new"))
        Files.move(root.resolve("src/main"), root.resolve("new/main"))
        val moved = snapshot(repository.move(base, "src/main", "new/main"))
        assertEquals(base.document.notes.get(integration), moved.document.notes.get("new/main/java/cn/geekyspace/app/integration"))
        assertTrue(stored().has("new/main/java/cn/geekyspace/app"))
        assertTrue(!stored().has(chain))
        assertIs<CommitResult.NoChange>(repository.normalize(configPath))
    }

    @Test
    fun `missing paths files and symbolic links are not guessed as directory chains`() {
        var base = setup()
        Files.writeString(root.resolve("$integration/Test.java"), "test")
        base = snapshot(repository.commit(base, mapOf(
            integration to null, unit to null, "$chain/missing/deep/Test.java" to note("失联"),
        )))
        assertEquals("失联", stored().path(chain).path("missing").path("deep").path("Test.java").textValue())
        base = snapshot(repository.setNote(base, "$integration/Test.java", note("测试文件").put("style", "core")))
        assertEquals("测试文件", stored().path(chain).path("integration").path("Test.java").path("_text").textValue())
        Files.createSymbolicLink(root.resolve("alias"), root.resolve("src"))
        base = snapshot(repository.setNote(base, "alias/main/java/cn/geekyspace/app/unit", note("别名")))
        assertEquals("别名", stored().path("alias").path("main").path("java").path("cn").path("geekyspace").path("app").path("unit").textValue())
        assertEquals("别名", base.document.notes.path("alias/main/java/cn/geekyspace/app/unit").path("text").textValue())
    }

    @Test
    fun `normalization respects unsaved changes and never overwrites unsupported configs or drops missing notes`() {
        val base = setup()
        val original = Files.readAllBytes(configPath)
        root.resolve("src").toFile().deleteRecursively()
        assertNull(repository.normalize(configPath) { false })
        assertContentEquals(original, Files.readAllBytes(configPath))
        val normalized = assertIs<CommitResult.Committed>(repository.normalize(configPath)).snapshot
        assertEquals(base.document.notes, normalized.document.notes)
        for (version in listOf(1, 2, 4)) {
            val text = """{"version":$version,"notes":"unsupported"}"""
            Files.writeString(configPath, text)
            assertNull(repository.normalize(configPath))
            val result = repository.create(configPath)
            assertTrue(result is CommitResult.Failed || result is CommitResult.Readonly)
            assertEquals(text, Files.readString(configPath))
        }
    }

    @Test
    fun `topology events filter unrelated and plugin generated paths`() {
        for (changed in listOf("src", "src/main/new.txt", "$integration/Test.java")) {
            assertTrue(DirectoryTopology.affects(listOf(integration), changed), changed)
        }
        for (changed in listOf(CONFIG_FILE_NAME, "$CONFIG_FILE_NAME.lock", "$CONFIG_FILE_NAME.tmp.x", ".git/objects/x", "unrelated/file.txt")) {
            assertTrue(!DirectoryTopology.affects(listOf(integration), changed), changed)
        }
    }
}
