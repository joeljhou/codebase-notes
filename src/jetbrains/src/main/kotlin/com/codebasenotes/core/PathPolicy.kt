package com.codebasenotes.core

object PathPolicy {
    private val drivePrefix = Regex("^[A-Za-z]:/")
    private val controlCharacter = Regex("[\\u0000-\\u001F\\u007F]")

    fun isValidKey(key: String): Boolean {
        if (key == ".") return true
        if (
            key.isEmpty() || key.startsWith('/') || key.endsWith('/') ||
            drivePrefix.containsMatchIn(key) || '\\' in key || "//" in key ||
            controlCharacter.containsMatchIn(key)
        ) {
            return false
        }

        val segments = key.split('/')
        return segments.none { it == "." || it == ".." } &&
            segments.last() != CONFIG_FILE_NAME
    }

    fun isWithinPrefix(key: String, prefix: String): Boolean =
        key == prefix || (prefix != "." && key.startsWith("$prefix/"))

    fun replacePrefix(key: String, oldPrefix: String, newPrefix: String): String {
        if (key == oldPrefix) return newPrefix
        return newPrefix + key.removePrefix(oldPrefix)
    }
}
