package com.codebasenotes.core

import com.fasterxml.jackson.databind.node.ObjectNode

const val CONFIG_FILE_NAME = ".codebase-notes.json"

enum class NoteStyle(val configValue: String) {
    DEFAULT("default"),
    IMPORTANT("important"),
    FOCUS("focus"),
    CORE("core"),
    STABLE("stable"),
    EXTENSION("extension");

    companion object {
        val configValues: Set<String> = entries.mapTo(linkedSetOf()) { it.configValue }

        val selectable: List<NoteStyle> = listOf(CORE, FOCUS, IMPORTANT, STABLE, EXTENSION, DEFAULT)

        fun fromConfigValue(value: String?): NoteStyle? = entries.find { it.configValue == value }
    }
}

fun noteStyle(note: ObjectNode): NoteStyle =
    NoteStyle.fromConfigValue(note.get("style")?.textValue()) ?: NoteStyle.DEFAULT

fun noteWithText(existing: ObjectNode?, text: String): ObjectNode =
    (existing?.deepCopy() ?: ConfigParser.mapper.createObjectNode()).put("text", text)

fun noteWithStyle(existing: ObjectNode, style: NoteStyle): ObjectNode =
    existing.deepCopy().apply {
        if (style == NoteStyle.DEFAULT) remove("style") else put("style", style.configValue)
    }

data class ConfigDocument(
    val root: ObjectNode,
    val notes: ObjectNode,
)

sealed interface ParseResult {
    data class WritableV1(val document: ConfigDocument) : ParseResult
    data class ReadonlyFuture(val version: Long) : ParseResult
    data class Invalid(val message: String) : ParseResult
}

sealed interface MergeResult {
    data class Merged(val notes: ObjectNode) : MergeResult
    data class Conflict(val paths: List<String>) : MergeResult
}

sealed interface MovePlan {
    data class Planned(val mapping: Map<String, String>) : MovePlan
    data class Conflict(val paths: List<String>) : MovePlan
}

data class ConfigSnapshot(
    val configPath: java.nio.file.Path,
    val document: ConfigDocument,
    val serialized: ByteArray,
)

sealed interface LoadResult {
    data class Loaded(val snapshot: ConfigSnapshot) : LoadResult
    data object Missing : LoadResult
    data class Invalid(val message: String) : LoadResult
    data class ReadonlyFuture(val version: Long) : LoadResult
}

sealed interface CommitResult {
    data class Committed(val snapshot: ConfigSnapshot) : CommitResult
    data class NoChange(val snapshot: ConfigSnapshot) : CommitResult
    data class Conflict(val paths: List<String>) : CommitResult
    data class Readonly(val reason: String) : CommitResult
    data class Failed(val message: String) : CommitResult
}
