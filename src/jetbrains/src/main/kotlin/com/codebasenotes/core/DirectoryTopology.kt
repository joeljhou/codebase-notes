package com.codebasenotes.core

import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path

object DirectoryTopology {
    fun affects(keys: Iterable<String>, changed: String): Boolean {
        if (changed == CONFIG_FILE_NAME || changed.startsWith("$CONFIG_FILE_NAME.") ||
            changed == ".git" || changed.startsWith(".git/")) return false
        val parent = changed.substringBeforeLast('/', ".")
        return keys.any { it == changed || it.startsWith("$changed/") ||
            (parent != "." && (it == parent || it.startsWith("$parent/"))) }
    }

    fun read(root: Path, keys: Iterable<String>): Map<String, String> {
        val directories = linkedSetOf<String>()
        for (key in keys) {
            require(PathPolicy.isValidKey(key)) { "Invalid note key: $key" }
            val segments = if (key == ".") emptyList() else key.split('/')
            for (length in 1..segments.size) directories += segments.take(length).joinToString("/")
        }
        val safe = mutableMapOf<String, Boolean>()
        fun isDirectory(key: String): Boolean = safe.getOrPut(key) {
            val parent = key.substringBeforeLast('/', "")
            (parent.isEmpty() || isDirectory(parent)) && Files.isDirectory(root.resolve(key), NOFOLLOW_LINKS)
        }
        val links = linkedMapOf<String, String>()
        for (key in directories) {
            if (!isDirectory(key)) continue
            val children = runCatching {
                Files.list(root.resolve(key)).use { it.limit(2).toList() }
            }.getOrDefault(emptyList())
            if (children.size == 1 && Files.isDirectory(children[0], NOFOLLOW_LINKS)) {
                links[key] = children[0].fileName.toString()
            }
        }
        return links
    }
}
