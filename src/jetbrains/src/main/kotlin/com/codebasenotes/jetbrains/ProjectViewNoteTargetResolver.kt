package com.codebasenotes.jetbrains

import com.codebasenotes.core.PathPolicy
import com.intellij.ide.projectView.ProjectViewNode
import com.intellij.ide.util.treeView.AbstractTreeNode
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFileSystemItem
import com.intellij.psi.SmartPsiElementPointer
import com.intellij.psi.util.PsiUtilCore
import java.nio.file.Path

internal data class ProjectViewNoteTarget(
    val file: VirtualFile,
    val key: String,
)

/**
 * Resolves Project View nodes to the physical project file or directory that owns a note.
 *
 * Language plugins are allowed to replace a file row with a PSI-backed row. Consequently,
 * [ProjectViewNode.getVirtualFile] is only the fast path, not the node identity contract.
 * Keep this resolver language-independent: no file extensions, PSI language types or concrete
 * Project View node classes belong here.
 */
internal object ProjectViewNoteTargetResolver {
    /** Resolves the node itself, without deciding whether an ancestor already represents it. */
    fun resolve(node: ProjectViewNode<*>): ProjectViewNoteTarget? =
        resolveBackingTarget(node)?.target

    /** Shared identity policy for actions whose DataContext exposes a file and/or PSI element. */
    fun resolve(
        project: Project,
        directFile: VirtualFile?,
        psiElement: PsiElement?,
    ): ProjectViewNoteTarget? {
        val candidate = directFile ?: psiElement
            ?.takeIf(PsiElement::isValid)
            ?.let(PsiUtilCore::getVirtualFile)
            ?: return null
        return targetFor(project, candidate)
    }

    /**
     * Resolves a target only for the highest visible node representing its physical path.
     * Member/symbol rows commonly resolve to their containing file; an ancestor with the same
     * key already owns that file's presentation, so decorating the child would duplicate the note.
     */
    fun resolveForDecoration(node: ProjectViewNode<*>): ProjectViewNoteTarget? {
        val resolved = resolveBackingTarget(node) ?: return null
        // A detached symbol is ambiguous: it may be an aggregate/search result rather than a file row.
        if (resolved.symbolBacked && node.parent == null) return null

        var ancestor: AbstractTreeNode<*>? = node.parent
        while (ancestor != null) {
            if (ancestor is ProjectViewNode<*> && ancestor.project === node.project) {
                val ancestorTarget = resolveBackingTarget(ancestor)
                if (ancestorTarget?.target?.key == resolved.target.key) return null
            }
            ancestor = ancestor.parent
        }
        return resolved.target
    }

    private fun resolveBackingTarget(node: ProjectViewNode<*>): ResolvedNodeTarget? {
        val value = node.value
        val equalityObject = node.equalityObject
        if (value is PsiElement && !value.isValid) return null
        if (node.roots.asSequence().map(VirtualFile::getPath).distinct().take(2).count() > 1) {
            return null
        }

        val valueBacking = backingFileFrom(value)
        // AbstractTreeNode may anchor a PSI value as a smart pointer. Resolve its live element
        // rather than trusting the pointer's retained file path after the PSI became invalid.
        val anchoredBacking = valueBacking ?: backingFileFrom(equalityObject)
        val pointerBacked = value is SmartPsiElementPointer<*> ||
            equalityObject is SmartPsiElementPointer<*>
        if (pointerBacked && anchoredBacking == null) return null

        val candidate = node.virtualFile?.let {
            BackingFile(it, symbolBacked = anchoredBacking?.symbolBacked == true)
        }
            ?: anchoredBacking
            ?: return null
        return targetFor(node.project, candidate.file)?.let {
            ResolvedNodeTarget(it, candidate.symbolBacked)
        }
    }

    private fun backingFileFrom(value: Any?): BackingFile? = when (value) {
        is VirtualFile -> BackingFile(value, symbolBacked = false)
        is SmartPsiElementPointer<*> -> value.element
            ?.takeIf(PsiElement::isValid)
            ?.let(PsiUtilCore::getVirtualFile)
            ?.let { BackingFile(it, symbolBacked = true) }
        is PsiFileSystemItem -> value.takeIf(PsiElement::isValid)?.virtualFile
            ?.let { BackingFile(it, symbolBacked = false) }
        is PsiElement -> value.takeIf(PsiElement::isValid)?.let(PsiUtilCore::getVirtualFile)
            ?.let { BackingFile(it, symbolBacked = true) }
        else -> null
    }

    private fun targetFor(project: Project, file: VirtualFile): ProjectViewNoteTarget? {
        if (!file.isValid || !file.isInLocalFileSystem) return null
        val root = normalizedAbsolutePath(project.basePath ?: return null) ?: return null
        val candidate = normalizedAbsolutePath(file.path) ?: return null
        if (!candidate.startsWith(root)) return null

        val relative = root.relativize(candidate).joinToString("/") { it.toString() }
        val key = relative.ifEmpty { "." }
        return key.takeIf(PathPolicy::isValidKey)?.let { ProjectViewNoteTarget(file, it) }
    }

    private fun normalizedAbsolutePath(rawPath: String): Path? =
        runCatching { Path.of(rawPath).toAbsolutePath().normalize() }.getOrNull()

    private data class BackingFile(
        val file: VirtualFile,
        val symbolBacked: Boolean,
    )

    private data class ResolvedNodeTarget(
        val target: ProjectViewNoteTarget,
        val symbolBacked: Boolean,
    )
}
