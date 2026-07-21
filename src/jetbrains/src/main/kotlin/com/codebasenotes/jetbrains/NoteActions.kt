package com.codebasenotes.jetbrains

import com.codebasenotes.core.NoteStyle
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.JBPopupListener
import com.intellij.openapi.ui.popup.LightweightWindowEvent
import com.intellij.ui.ColoredListCellRenderer
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.JList

class EditNoteAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val target = event.noteTarget() ?: return
        val file = target.file
        val service = project.service<CodebaseNotesProjectService>()
        val key = target.key
        val existingNote = service.noteFor(file)
        val existingText = existingNote?.path("text")?.textValue().orEmpty()
        val text = Messages.showInputDialog(
            project,
            CodebaseNotesBundle.message("note.edit.prompt"),
            CodebaseNotesBundle.message("note.edit.title"),
            Messages.getQuestionIcon(),
            existingText,
            null,
        )
        when (val intent = noteEditIntent(existingNote != null, text)) {
            NoteEditIntent.NoOp -> Unit
            NoteEditIntent.Remove -> service.removeNote(key).thenAccept(service::showResult)
            is NoteEditIntent.Set -> service.setNote(key, intent.text).thenAccept(service::showResult)
            is NoteEditIntent.Invalid -> Messages.showErrorDialog(
                project,
                CodebaseNotesBundle.message(
                    when (intent.reason) {
                        NoteValidationFailure.WHITESPACE_ONLY -> "note.validation.whitespaceOnly"
                        NoteValidationFailure.TOO_LONG -> "note.validation.tooLong"
                    },
                ),
                CodebaseNotesBundle.message("plugin.title"),
            )
        }
    }

    override fun update(event: AnActionEvent) {
        val project = event.project
        event.presentation.isEnabledAndVisible = project != null && event.noteTarget() != null
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}

class SetNoteStyleAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val target = event.noteTarget() ?: return
        val file = target.file
        val service = project.service<CodebaseNotesProjectService>()
        val key = target.key
        val current = service.noteStyleFor(file) ?: return
        val chosen = AtomicBoolean(false)
        val renderer = object : ColoredListCellRenderer<NoteStyle>() {
            override fun customizeCellRenderer(
                list: JList<out NoteStyle>,
                value: NoteStyle,
                index: Int,
                selected: Boolean,
                hasFocus: Boolean,
            ) {
                append(
                    CodebaseNotesBundle.message("note.style.${value.configValue}"),
                    noteStyleAttributes(value),
                )
            }
        }
        val popup = JBPopupFactory.getInstance()
            .createPopupChooserBuilder(NoteStyle.selectable)
            .setTitle(CodebaseNotesBundle.message("note.style.title"))
            .setRenderer(renderer)
            .setSelectedValue(current.takeIf { it in NoteStyle.selectable } ?: NoteStyle.DEFAULT, true)
            .setItemSelectedCallback { style -> service.previewNoteStyle(key, style) }
            .setItemChosenCallback { style ->
                chosen.set(true)
                service.setNoteStyle(key, style).whenComplete { result, error ->
                    service.previewNoteStyle(key, null)
                    service.showResult(
                        result ?: com.codebasenotes.core.CommitResult.Failed(
                            error?.message ?: CodebaseNotesBundle.message("config.write.failed"),
                        ),
                    )
                }
            }
            .setAdText(CodebaseNotesBundle.message("note.style.previewHint"))
            .addListener(object : JBPopupListener {
                override fun onClosed(event: LightweightWindowEvent) {
                    if (!chosen.get()) service.previewNoteStyle(key, null)
                }
            })
            .createPopup()
        // 居中显示，避免遮挡左侧 Project 树，便于上下键切换时观察实时预览。
        popup.showCenteredInCurrentWindow(project)
    }

    override fun update(event: AnActionEvent) {
        val project = event.project
        val target = event.noteTarget()
        event.presentation.isEnabledAndVisible = project != null && target != null &&
            project.service<CodebaseNotesProjectService>().noteFor(target.file) != null
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}

class RemoveNoteAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val target = event.noteTarget() ?: return
        val service = project.service<CodebaseNotesProjectService>()
        val key = target.key
        if (Messages.showYesNoDialog(
                project,
                CodebaseNotesBundle.message("note.remove.confirm", key),
                CodebaseNotesBundle.message("note.remove.title"),
                Messages.getQuestionIcon(),
            ) != Messages.YES
        ) return
        service.removeNote(key).thenAccept(service::showResult)
    }

    override fun update(event: AnActionEvent) {
        val project = event.project
        val target = event.noteTarget()
        event.presentation.isEnabledAndVisible = project != null && target != null &&
            project.service<CodebaseNotesProjectService>().noteFor(target.file) != null
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}

/** Project View symbol rows may expose PSI without a direct VirtualFile. */
private fun AnActionEvent.noteTarget(): ProjectViewNoteTarget? {
    val project = project ?: return null
    return ProjectViewNoteTargetResolver.resolve(
        project = project,
        directFile = getData(CommonDataKeys.VIRTUAL_FILE),
        psiElement = getData(CommonDataKeys.PSI_ELEMENT) ?: getData(CommonDataKeys.PSI_FILE),
    )
}
