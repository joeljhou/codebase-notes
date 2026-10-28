package com.codebasenotes.core

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode

object TreeCodec {
    fun decode(tree: ObjectNode, localizer: CoreLocalizer): ObjectNode {
        val notes = ConfigParser.mapper.createObjectNode()
        fun visit(node: JsonNode, key: String) {
            fun invalid(): Nothing = throw IllegalArgumentException(localizer.message("tree.invalid", key))
            if (node.isTextual) {
                notes.set<ObjectNode>(key, ConfigParser.mapper.createObjectNode().put("text", node.textValue()))
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
                notes.set<ObjectNode>(key, note)
            }
            for ((encoded, child) in node.properties()) {
                if (encoded == "_text" || encoded == "_meta") continue
                if (encoded.startsWith('_') && !encoded.startsWith("__")) invalid()
                val segment = if (encoded.startsWith("__")) encoded.drop(1) else encoded
                val childKey = if (key == ".") segment else "$key/$segment"
                if (segment == "." || '/' in segment || !PathPolicy.isValidKey(childKey, structural = true)) invalid()
                visit(child, childKey)
            }
        }
        visit(tree, ".")
        return notes
    }

    fun encode(notes: ObjectNode): ObjectNode {
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
        fun compact(node: ObjectNode, isRoot: Boolean = false): JsonNode {
            if (!isRoot && node.size() == 1 && node.has("_text")) return node.get("_text")
            val result = ConfigParser.mapper.createObjectNode()
            for ((key, value) in node.properties()) {
                result.set<JsonNode>(key, if (key == "_text" || key == "_meta") value else compact(value as ObjectNode))
            }
            return result
        }
        return compact(root, isRoot = true) as ObjectNode
    }
}
