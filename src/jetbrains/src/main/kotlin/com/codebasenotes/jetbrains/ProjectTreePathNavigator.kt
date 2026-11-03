package com.codebasenotes.jetbrains

import com.intellij.ide.projectView.ProjectView
import com.intellij.ide.projectView.ProjectViewNode
import com.intellij.ide.projectView.impl.ProjectViewPane
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.ActionCallback
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindowId
import com.intellij.openapi.wm.ToolWindowManager

internal object ProjectTreePathNavigator {
    fun select(project: Project, file: VirtualFile): ActionCallback {
        if (project.isDisposed || !file.isValid) return ActionCallback.REJECTED
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow(ToolWindowId.PROJECT_VIEW)
            ?: return ActionCallback.REJECTED
        val result = ActionCallback()
        // Show without taking focus: tree autoscroll/preview must not open the selected file.
        toolWindow.show {
            if (project.isDisposed || !file.isValid) {
                result.setRejected()
                return@show
            }
            val view = ProjectView.getInstance(project)
            // changeViewCB rejects an already-current view, even though it is ready for selection.
            val ready = if (view.currentViewId == ProjectViewPane.ID) ActionCallback.DONE
                else view.changeViewCB(ProjectViewPane.ID, null)
            ready.doWhenDone {
                if (project.isDisposed || !file.isValid) {
                    result.setRejected()
                    return@doWhenDone
                }
                val pane = view.currentProjectViewPane
                if (pane == null) {
                    result.setRejected()
                    return@doWhenDone
                }
                view.selectCB(file, file, false).doWhenDone {
                    if (!project.isDisposed && file.isValid && file.isDirectory &&
                        view.currentProjectViewPane == pane &&
                        pane.selectedUserObjects.any {
                            (it as? ProjectViewNode<*>)?.let(ProjectViewNoteTargetResolver::resolve)?.file == file
                        }
                    ) {
                        pane.selectedPath?.let { pane.tree?.expandPath(it) }
                    }
                    result.setDone()
                }.doWhenRejected(Runnable { result.setRejected() })
            }.doWhenRejected(Runnable { result.setRejected() })
        }
        return result
    }
}
