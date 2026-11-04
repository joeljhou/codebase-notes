package com.codebasenotes.jetbrains

import com.codebasenotes.core.CONFIG_FILE_NAME
import com.codebasenotes.core.CONFIG_VERSION
import com.codebasenotes.core.TreeCodec
import com.codebasenotes.core.PathPolicy
import com.intellij.json.psi.JsonFile
import com.intellij.json.psi.JsonObject
import com.intellij.json.psi.JsonProperty
import com.intellij.json.psi.JsonStringLiteral
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiElement
import com.intellij.psi.util.PsiTreeUtil

internal data class ConfigPathTarget(val source: JsonStringLiteral, val key: String, val file: VirtualFile)

internal object ConfigPathResolver {
    fun resolve(element: PsiElement, offset: Int): ConfigPathTarget? {
        val literal = PsiTreeUtil.getParentOfType(element, JsonStringLiteral::class.java, false) ?: return null
        if (!literal.isPropertyName || offset <= literal.textRange.startOffset ||
            offset >= literal.textRange.endOffset - 1
        ) return null
        val config = literal.containingFile as? JsonFile ?: return null
        val configFile = config.virtualFile ?: return null
        if (configFile.name != CONFIG_FILE_NAME || !configFile.isInLocalFileSystem) return null
        val basePath = config.project.basePath ?: return null
        val root = LocalFileSystem.getInstance().findFileByPath(basePath) ?: return null
        if (configFile.parent != root) return null

        val document = config.topLevelValue as? JsonObject ?: return null
        val notes = document.findProperty("notes")?.value as? JsonObject ?: return null
        val property = literal.parent as? JsonProperty ?: return null
        if (document.findProperty("version")?.value?.text != CONFIG_VERSION.toString()) return null
        val key = treeKey(property, notes) ?: return null
        if (!PathPolicy.isValidKey(key)) return null
        val target = if (key == ".") root else root.findFileByRelativePath(key) ?: return null
        return ConfigPathTarget(literal, key, target)
    }

    private fun treeKey(property: JsonProperty, notes: JsonObject): String? {
        val segments = mutableListOf<String>()
        var current = property
        while (true) {
            if (current.value !is JsonObject && current.value !is JsonStringLiteral) return null
            val segment = TreeCodec.decodeKey(current.name) ?: return null
            segments.add(segment)
            val parent = current.parent as? JsonObject ?: return null
            if (parent == notes) return segments.asReversed().joinToString("/")
            current = parent.parent as? JsonProperty ?: return null
        }
    }
}
