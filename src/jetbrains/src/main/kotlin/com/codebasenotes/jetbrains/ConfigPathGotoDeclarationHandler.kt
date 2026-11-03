package com.codebasenotes.jetbrains

import com.intellij.codeInsight.navigation.actions.GotoDeclarationHandler
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.DumbAware
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.impl.FakePsiElement

class ConfigPathGotoDeclarationHandler : GotoDeclarationHandler, DumbAware {
    override fun getGotoDeclarationTargets(sourceElement: PsiElement?, offset: Int, editor: Editor): Array<PsiElement>? {
        val target = sourceElement?.let { ConfigPathResolver.resolve(it, offset) } ?: return null
        return arrayOf(ConfigPathNavigationElement(target))
    }
}

internal class ConfigPathNavigationElement(private val target: ConfigPathTarget) : FakePsiElement() {
    override fun getParent(): PsiElement = target.source

    // This is a tree-selection action, not a location in a source file.
    override fun getContainingFile(): PsiFile? = null

    override fun getName(): String = target.key

    override fun getLocationString(): String = target.file.path

    override fun isValid(): Boolean = target.source.isValid && target.file.isValid

    override fun canNavigate(): Boolean = isValid

    override fun canNavigateToSource(): Boolean = false

    override fun navigate(requestFocus: Boolean) {
        if (isValid) ProjectTreePathNavigator.select(project, target.file)
    }
}
