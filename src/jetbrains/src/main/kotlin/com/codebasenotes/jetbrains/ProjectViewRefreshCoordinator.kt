package com.codebasenotes.jetbrains

import com.codebasenotes.core.PathPolicy
import com.intellij.ide.projectView.ProjectView
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiManager
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Serializes asynchronous Project View updates and retains the paths whose presentations changed.
 *
 * Project View computes presentations asynchronously. Starting another refresh before the previous
 * one finishes can let an older presentation win the race and reappear after note state has already
 * changed. Requests are therefore merged, dispatched on the EDT, and followed by exactly one newer
 * pass when state changes during an in-flight update.
 */
internal class ProjectViewRefreshCoordinator(
    private val dispatcher: ProjectViewRefreshDispatcher,
    private val target: ProjectViewRefreshTarget,
) : Disposable {
    private val lock = Any()
    private val pendingKeys = linkedSetOf<String>()
    private var refreshRequested = false
    private var scheduledOrRunning = false
    private var disposed = false

    fun requestRefresh(changedKeys: Set<String> = emptySet()) {
        val shouldDispatch = synchronized(lock) {
            if (disposed) return
            refreshRequested = true
            pendingKeys.addAll(changedKeys)
            if (scheduledOrRunning) {
                false
            } else {
                scheduledOrRunning = true
                true
            }
        }
        if (shouldDispatch) dispatcher.dispatch(::startRefresh)
    }

    private fun startRefresh() {
        val changedKeys = synchronized(lock) {
            if (disposed) {
                scheduledOrRunning = false
                return
            }
            refreshRequested = false
            pendingKeys.toSet().also { pendingKeys.clear() }
        }

        val finished = AtomicBoolean(false)
        val finishOnce = {
            if (finished.compareAndSet(false, true)) {
                // Project View may finish off the EDT. Keep every state transition on the dispatcher,
                // so a follow-up pass cannot overlap the presentation update that it supersedes.
                dispatcher.dispatch(::finishRefresh)
            }
        }
        try {
            target.refresh(changedKeys, finishOnce)
        } catch (error: Throwable) {
            // A stale pane or cancelled PSI read must not leave the coordinator permanently locked.
            // Preserve the original failure for IntelliJ's error reporting after scheduling recovery.
            finishOnce()
            throw error
        }
    }

    private fun finishRefresh() {
        val needsFollowUp = synchronized(lock) {
            if (disposed) {
                scheduledOrRunning = false
                pendingKeys.clear()
                return
            }
            if (refreshRequested) {
                true
            } else {
                scheduledOrRunning = false
                false
            }
        }
        if (needsFollowUp) startRefresh()
    }

    override fun dispose() {
        synchronized(lock) {
            disposed = true
            pendingKeys.clear()
        }
    }
}

internal fun interface ProjectViewRefreshDispatcher {
    fun dispatch(action: () -> Unit)
}

internal fun interface ProjectViewRefreshTarget {
    /** Calls [onProcessed] exactly once after the requested presentation update has completed. */
    fun refresh(changedKeys: Set<String>, onProcessed: () -> Unit)
}

internal class IntelliJProjectViewRefreshDispatcher : ProjectViewRefreshDispatcher {
    override fun dispatch(action: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(action)
    }
}

/**
 * Isolates the Project View implementation detail needed for targeted invalidation and completion.
 *
 * Public [ProjectView.refresh] only refreshes the current pane and discards its asynchronous
 * callback. Calling that same pane directly lets us invalidate the exact PSI-backed rows first and
 * wait for a root fallback to finish before a newer state is rendered.
 */
internal class IntelliJProjectViewRefreshTarget(private val project: Project) : ProjectViewRefreshTarget {
    private val projectRoot: Path? = project.basePath
        ?.let { runCatching { Path.of(it).toAbsolutePath().normalize() }.getOrNull() }

    override fun refresh(changedKeys: Set<String>, onProcessed: () -> Unit) {
        if (project.isDisposed) {
            onProcessed()
            return
        }

        val pane = ProjectView.getInstance(project).currentProjectViewPane
        if (pane == null) {
            // No visible pane exists yet. When one is created it will build from the latest snapshot.
            onProcessed()
            return
        }

        // Actions normally target the selected row. Refreshing its concrete TreePath also covers
        // language plugins that replace a file row with a symbol row, such as a single Kotlin class.
        pane.selectedPath?.let { pane.updateFrom(it, false, false) }

        // updateFrom is deliberately confined to this adapter. Its final false selects the narrow
        // presentation-only update for the physical file/directory, independent of language rows.
        changedKeys.asSequence()
            .sorted()
            .mapNotNull(::psiElementFor)
            .forEach { pane.updateFrom(it, false, false) }

        // A root update handles paths that vanished or whose tree node cannot currently be resolved.
        pane.updateFromRoot(false).doWhenProcessed(onProcessed)
    }

    private fun psiElementFor(key: String): PsiElement? {
        if (!PathPolicy.isValidKey(key)) return null
        val root = projectRoot ?: return null
        val path = if (key == ".") root else root.resolve(key).normalize()
        if (!path.startsWith(root)) return null
        val file = LocalFileSystem.getInstance().findFileByNioFile(path)
            ?.takeIf { it.isValid }
            ?: return null
        val psiManager = PsiManager.getInstance(project)
        return if (file.isDirectory) psiManager.findDirectory(file) else psiManager.findFile(file)
    }
}
