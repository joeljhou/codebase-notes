package com.codebasenotes.core

import java.text.MessageFormat

fun interface CoreLocalizer {
    fun message(key: String, vararg params: Any): String
}

object DefaultCoreLocalizer : CoreLocalizer {
    private val messages = mapOf(
        "config.root.object" to "The configuration root must be an object",
        "config.version.safeInteger" to "version must be a safe integer",
        "config.version.onlyOne" to "Only version=1 is supported",
        "json.parse.failed" to "Failed to parse JSON",
        "notes.object" to "notes must be an object",
        "path.key.invalid" to "Invalid path key: {0}",
        "note.object" to "The note must be an object: {0}",
        "note.text.string" to "The note text must be a string: {0}",
        "note.text.length" to "The note text must contain 1..2000 characters and cannot be blank: {0}",
        "note.style.invalid" to "Invalid note style: {0}",
        "number.safeInteger" to "An integer exceeds the JavaScript safe integer range",
        "number.finite" to "A number must be finite",
        "config.read.failed" to "Could not read the configuration: {0}",
        "config.version.unsupported" to "Configuration version {0} is not supported",
        "config.deleted" to "The configuration file was deleted",
        "config.write.invalid" to "Refusing to write a configuration that does not conform to v1",
        "config.write.failed" to "Could not write the configuration",
        "config.symlink" to "The configuration file is a symbolic link and cannot be atomically replaced",
        "config.atomic.unsupported" to "The current file system does not support atomic replacement",
        "config.atomic.failed" to "Atomic replacement failed: {0}",
        "config.locked" to "Another process is writing the configuration",
        "config.lock.interrupted" to "Interrupted while waiting for the configuration lock",
        "config.lock.create.failed" to "Could not create the lock file: {0}",
        "move.oldPath.invalid" to "Invalid old path: {0}",
        "move.newPath.invalid" to "Invalid new path: {0}",
    )

    override fun message(key: String, vararg params: Any): String {
        val pattern = messages[key] ?: key
        return MessageFormat.format(pattern, *params)
    }
}
