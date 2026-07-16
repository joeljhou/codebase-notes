package com.codebasenotes.jetbrains

import com.intellij.ide.projectView.PresentationData
import com.intellij.ide.projectView.ProjectViewNode
import com.intellij.ide.projectView.ProjectViewNodeDecorator
import com.intellij.openapi.components.service

class ProjectViewNoteDecorator : ProjectViewNodeDecorator {
    override fun decorate(node: ProjectViewNode<*>, data: PresentationData) {
        val file = node.virtualFile ?: return
        // decorate 会高频运行，只读内存快照，绝不能在项目树渲染路径上做磁盘 I/O。
        val note = node.project.service<CodebaseNotesProjectService>()
            .noteFor(file)
            ?.path("text")
            ?.textValue()
            ?: return
        data.locationString = note.replace(Regex("\\s+"), " ").take(120)
    }
}
