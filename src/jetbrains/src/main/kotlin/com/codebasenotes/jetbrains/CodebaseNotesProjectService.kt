package com.codebasenotes.jetbrains

import com.codebasenotes.core.CommitResult
import com.codebasenotes.core.CONFIG_FILE_NAME
import com.codebasenotes.core.ConfigParser
import com.codebasenotes.core.ConfigRepository
import com.codebasenotes.core.ConfigSnapshot
import com.codebasenotes.core.LoadResult
import com.codebasenotes.core.PathPolicy
import com.fasterxml.jackson.databind.node.ObjectNode
import com.intellij.ide.projectView.ProjectView
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.openapi.vfs.newvfs.events.VFileMoveEvent
import com.intellij.openapi.vfs.newvfs.events.VFilePropertyChangeEvent
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

@Service(Service.Level.PROJECT)
class CodebaseNotesProjectService(private val project: Project) : Disposable {
    private val projectRoot: Path? = project.basePath?.let(Path::of)?.toAbsolutePath()?.normalize()
    private val configPath: Path? = projectRoot?.resolve(CONFIG_FILE_NAME)
    private val repository = ConfigRepository(localizer = CodebaseNotesBundle.coreLocalizer)
    private val snapshot = AtomicReference<ConfigSnapshot?>()
    private val executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "codebase-notes-${project.locationHash}").apply { isDaemon = true }
    }

    init {
        val connection = project.messageBus.connect(this)
        connection.subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: List<VFileEvent>) {
                onVfsEvents(events)
            }
        })
        refreshAsync()
    }

    fun keyFor(file: VirtualFile): String? = keyForPath(file.path)

    fun noteFor(file: VirtualFile): ObjectNode? {
        val key = keyFor(file) ?: return null
        return snapshot.get()?.document?.notes?.get(key) as? ObjectNode
    }

    fun setNote(key: String, text: String): CompletableFuture<CommitResult> = submit {
        if (isConfigDocumentDirty()) {
            return@submit CommitResult.Failed(CodebaseNotesBundle.message("config.dirty"))
        }
        require(PathPolicy.isValidKey(key)) { CodebaseNotesBundle.message("path.invalid", key) }
        val note = ConfigParser.mapper.createObjectNode().put("text", text)
        val base = ensureWritableSnapshot()
            ?: return@submit CommitResult.Failed(CodebaseNotesBundle.message("config.createOrRead.failed"))
        repository.setNote(base, key, note).also(::acceptResult)
    }

    fun removeNote(key: String): CompletableFuture<CommitResult> = submit {
        if (isConfigDocumentDirty()) {
            return@submit CommitResult.Failed(CodebaseNotesBundle.message("config.dirty"))
        }
        val base = snapshot.get()
            ?: return@submit CommitResult.Failed(CodebaseNotesBundle.message("config.notLoaded"))
        repository.setNote(base, key, null).also(::acceptResult)
    }

    fun refreshAsync(): CompletableFuture<Unit> = submit {
        refreshNow()
    }

    fun isConfigDocumentDirty(): Boolean {
        val path = configPath ?: return false
        val file = LocalFileSystem.getInstance().findFileByNioFile(path) ?: return false
        val manager = FileDocumentManager.getInstance()
        val document = manager.getCachedDocument(file) ?: return false
        return manager.isDocumentUnsaved(document)
    }

    fun showResult(result: CommitResult) {
        val message = when (result) {
            is CommitResult.Committed -> null
            is CommitResult.NoChange -> null
            is CommitResult.Conflict -> CodebaseNotesBundle.message(
                "config.write.conflict",
                result.paths.joinToString(),
            )
            is CommitResult.Readonly -> result.reason
            is CommitResult.Failed -> result.message
        } ?: return
        ApplicationManager.getApplication().invokeLater {
            if (!project.isDisposed) {
                NotificationGroupManager.getInstance()
                    .getNotificationGroup("Codebase Notes")
                    .createNotification(message, NotificationType.ERROR)
                    .notify(project)
            }
        }
    }

    private fun ensureWritableSnapshot(): ConfigSnapshot? {
        snapshot.get()?.let { return it }
        val path = configPath ?: return null
        return when (val created = repository.create(path)) {
            is CommitResult.Committed -> created.snapshot.also(snapshot::set)
            is CommitResult.NoChange -> created.snapshot.also(snapshot::set)
            else -> {
                showResult(created)
                null
            }
        }
    }

    private fun onVfsEvents(events: List<VFileEvent>) {
        val path = configPath ?: return
        val configChanged = events.any { event ->
            runCatching { Path.of(event.path).toAbsolutePath().normalize() == path }.getOrDefault(false)
        }
        val moves = events.mapNotNull(::movePaths)
        if (moves.isNotEmpty()) {
            submit {
                var current = snapshot.get() ?: return@submit
                for ((oldKey, newKey) in moves) {
                    val result = repository.move(current, oldKey, newKey)
                    acceptResult(result)
                    current = when (result) {
                        is CommitResult.Committed -> result.snapshot
                        is CommitResult.NoChange -> result.snapshot
                        else -> {
                            showResult(result)
                            return@submit
                        }
                    }
                }
            }
        } else if (configChanged) {
            refreshAsync()
        }
    }

    private fun movePaths(event: VFileEvent): Pair<String, String>? {
        val paths = when (event) {
            is VFileMoveEvent -> {
                val name = event.file.name
                event.oldParent.path + "/" + name to event.newParent.path + "/" + name
            }
            is VFilePropertyChangeEvent -> {
                if (event.propertyName != VirtualFile.PROP_NAME) return null
                val parent = event.file.parent?.path ?: return null
                parent + "/" + event.oldValue.toString() to parent + "/" + event.newValue.toString()
            }
            else -> return null
        }
        val oldKey = keyForPath(paths.first) ?: return null
        val newKey = keyForPath(paths.second) ?: return null
        if (oldKey == newKey || oldKey == CONFIG_FILE_NAME || newKey == CONFIG_FILE_NAME) return null
        return oldKey to newKey
    }

    private fun keyForPath(rawPath: String): String? {
        val root = projectRoot ?: return null
        val candidate = runCatching { Path.of(rawPath).toAbsolutePath().normalize() }.getOrNull() ?: return null
        if (!candidate.startsWith(root)) return null
        val relative = root.relativize(candidate).joinToString("/") { it.toString() }
        val key = relative.ifEmpty { "." }
        return key.takeIf(PathPolicy::isValidKey)
    }

    private fun refreshNow() {
        val path = configPath ?: return
        when (val loaded = repository.load(path)) {
            is LoadResult.Loaded -> snapshot.set(loaded.snapshot)
            LoadResult.Missing -> snapshot.set(null)
            is LoadResult.Invalid -> {
                snapshot.set(null)
                notifyError(CodebaseNotesBundle.message("config.invalid", loaded.message))
            }
            is LoadResult.ReadonlyFuture -> {
                snapshot.set(null)
                notifyError(CodebaseNotesBundle.message("config.futureVersion", loaded.version))
            }
        }
        refreshProjectView()
    }

    private fun acceptResult(result: CommitResult) {
        when (result) {
            is CommitResult.Committed -> snapshot.set(result.snapshot)
            is CommitResult.NoChange -> snapshot.set(result.snapshot)
            else -> Unit
        }
        VirtualFileManager.getInstance().asyncRefresh(null)
        refreshProjectView()
    }

    private fun refreshProjectView() {
        ApplicationManager.getApplication().invokeLater {
            if (!project.isDisposed) ProjectView.getInstance(project).refresh()
        }
    }

    private fun notifyError(message: String) {
        ApplicationManager.getApplication().invokeLater {
            if (!project.isDisposed) {
                NotificationGroupManager.getInstance()
                    .getNotificationGroup("Codebase Notes")
                    .createNotification(message, NotificationType.ERROR)
                    .notify(project)
            }
        }
    }

    private fun <T> submit(action: () -> T): CompletableFuture<T> =
        CompletableFuture.supplyAsync(action, executor)

    override fun dispose() {
        executor.shutdownNow()
    }
}
