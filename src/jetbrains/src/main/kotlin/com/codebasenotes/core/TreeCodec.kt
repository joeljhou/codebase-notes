package com.codebasenotes.core

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode

object TreeCodec {
    fun decodeKey(encoded: String): String? {
        val segments = encoded.split('/')
        if (segments.any { it.startsWith('_') && !it.startsWith("__") }) return null
        val key = segments.joinToString("/") { if (it.startsWith("__")) it.drop(1) else it }
        return key.takeIf { it != "." && PathPolicy.isValidKey(it, structural = true) }
    }

    fun decode(tree: ObjectNode, localizer: CoreLocalizer): ObjectNode {
        val notes = ConfigParser.mapper.createObjectNode()
        fun addNote(key: String, note: ObjectNode) {
            require(PathPolicy.isValidKey(key) && !notes.has(key)) { localizer.message("tree.invalid", key) }
            notes.set<ObjectNode>(key, note)
        }
        fun visit(node: JsonNode, key: String) {
            fun invalid(): Nothing = throw IllegalArgumentException(localizer.message("tree.invalid", key))
            if (node.isTextual) {
                addNote(key, ConfigParser.mapper.createObjectNode().put("text", node.textValue()))
                return
            }
            if (node !is ObjectNode) invalid()
            if (node.has("_meta")) {
                val metadata = node.get("_meta")
                if (!node.has("_text") || metadata !is ObjectNode || metadata.has("text")) invalid()
            }
            if (node.has("_text")) {
                val note = (node.get("_meta") as ObjectNode?)?.deepCopy()
                    ?: ConfigParser.mapper.createObjectNode()
                note.set<JsonNode>("text", node.get("_text"))
                addNote(key, note)
            }
            for ((encoded, child) in node.properties()) {
                if (encoded == "_text" || encoded == "_meta") continue
                val relative = decodeKey(encoded) ?: invalid()
                val childKey = if (key == ".") relative else "$key/$relative"
                if (!PathPolicy.isValidKey(childKey, structural = true)) invalid()
                visit(child, childKey)
            }
        }
        visit(tree, ".")
        return notes
    }

    fun encode(notes: ObjectNode, compactDirectories: Map<String, String> = emptyMap()): ObjectNode {
        val root = ConfigParser.mapper.createObjectNode()
        for ((key, note) in notes.properties()) {
            require(PathPolicy.isValidKey(key)) { "Invalid note key: $key" }
            var node = root
            for (segment in if (key == ".") emptyList() else key.split('/')) {
                val encoded = if (segment.startsWith('_')) "_$segment" else segment
                val child = node.get(encoded) as ObjectNode?
                    ?: ConfigParser.mapper.createObjectNode().also { node.set<ObjectNode>(encoded, it) }
                node = child
            }
            node.set<JsonNode>("_text", note.get("text"))
            val metadata = (note as ObjectNode).deepCopy().apply { remove("text") }
            if (!metadata.isEmpty) node.set<ObjectNode>("_meta", metadata)
        }
        fun compact(node: ObjectNode, key: String): JsonNode {
            if (key != "." && node.size() == 1 && node.has("_text")) return node.get("_text")
            val result = ConfigParser.mapper.createObjectNode()
            for ((encoded, value) in node.properties()) {
                if (encoded == "_text" || encoded == "_meta") {
                    result.set<JsonNode>(encoded, value)
                    continue
                }
                var name = encoded
                var child = value as ObjectNode
                var childKey = if (key == ".") requireNotNull(decodeKey(encoded)) else "$key/${decodeKey(encoded)}"
                while (!child.has("_text") && child.size() == 1) {
                    val next = child.properties().first()
                    val segment = decodeKey(next.key) ?: break
                    if (compactDirectories[childKey] != segment) break
                    name += "/${next.key}"
                    childKey += "/$segment"
                    child = next.value as ObjectNode
                }
                result.set<JsonNode>(name, compact(child, childKey))
            }
            return result
        }
        return compact(root, ".") as ObjectNode
    }
}
