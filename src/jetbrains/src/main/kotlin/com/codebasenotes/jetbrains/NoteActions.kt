package com.codebasenotes.jetbrains

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.Messages

class EditNoteAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val service = project.service<CodebaseNotesProjectService>()
        val key = service.keyFor(file) ?: return
        val existing = service.noteFor(file)?.path("text")?.textValue().orEmpty()
        val text = Messages.showInputDialog(
            project,
            CodebaseNotesBundle.message("note.edit.prompt"),
            CodebaseNotesBundle.message("note.edit.title"),
            Messages.getQuestionIcon(),
            existing,
            null,
        ) ?: return
        if (text.isBlank() || text.codePointCount(0, text.length) > 2000) {
            Messages.showErrorDialog(
                project,
                CodebaseNotesBundle.message("note.validation.invalid"),
                CodebaseNotesBundle.message("plugin.title"),
            )
            return
        }
        service.setNote(key, text).thenAccept(service::showResult)
    }

    override fun update(event: AnActionEvent) {
        val project = event.project
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE)
        event.presentation.isEnabledAndVisible = project != null && file != null &&
            project.service<CodebaseNotesProjectService>().keyFor(file) != null
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}

class RemoveNoteAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val service = project.service<CodebaseNotesProjectService>()
        val key = service.keyFor(file) ?: return
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
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE)
        event.presentation.isEnabledAndVisible = project != null && file != null &&
            project.service<CodebaseNotesProjectService>().noteFor(file) != null
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}
