package com.codebasenotes.jetbrains

import com.codebasenotes.core.NoteStyle
import com.intellij.ide.projectView.PresentationData
import com.intellij.ide.projectView.ProjectViewNode
import com.intellij.ide.projectView.ProjectViewNodeDecorator
import com.intellij.openapi.components.service
import com.intellij.openapi.vcs.FileStatusManager
import com.intellij.ui.SimpleTextAttributes
import java.awt.Color

class ProjectViewNoteDecorator : ProjectViewNodeDecorator {
    override fun decorate(node: ProjectViewNode<*>, data: PresentationData) {
        val file = node.virtualFile ?: return
        // decorate 会高频运行，只读内存快照，绝不能在项目树渲染路径上做磁盘 I/O。
        val service = node.project.service<CodebaseNotesProjectService>()
        val note = service.noteFor(file) ?: return
        val text = note.path("text").textValue()
            ?.replace(Regex("\\s+"), " ")
            ?.take(120)
            ?: return
        val style = service.noteStyleFor(file) ?: return
        val fileColor = data.forcedTextForeground
            ?: FileStatusManager.getInstance(node.project).getStatus(file).color
        appendNotePresentation(data, file.name, fileColor, text, style)
    }
}

internal fun appendNotePresentation(
    data: PresentationData,
    fallbackName: String,
    fileColor: Color?,
    noteText: String,
    style: NoteStyle,
) {
    // 部分 Project View 节点只有 presentableText，没有 coloredText；直接 addText 会让备注取代文件名。
    if (data.coloredText.isEmpty()) {
        val attributes = fileColor?.let {
            SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, it)
        } ?: SimpleTextAttributes.REGULAR_ATTRIBUTES
        data.addText(data.presentableText ?: fallbackName, attributes)
    }
    data.addText("  $noteText", noteStyleAttributes(style))
}
