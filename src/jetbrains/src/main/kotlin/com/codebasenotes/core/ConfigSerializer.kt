package com.codebasenotes.core

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.DoubleNode
import com.fasterxml.jackson.databind.node.IntNode
import com.fasterxml.jackson.databind.node.ObjectNode

object ConfigSerializer {
    val scalarComparator = Comparator<String> { left, right -> compareUnicodeScalars(left, right) }

    fun serialize(document: ConfigDocument): ByteArray {
        val root = document.root.deepCopy().apply {
            put("version", 2)
            set<ObjectNode>("notes", TreeCodec.encode(document.notes))
        }
        val normalized = sortObject(root, listOf("\$schema", "version", "notes")) { key, value ->
            if (key == "notes") sortTree(value as ObjectNode) else sortNode(value)
        }
        return (render(normalized) + '\n').toByteArray(Charsets.UTF_8)
    }

    private enum class Context { ROOT, NOTES, TREE, GENERIC }

    private fun hasChildren(node: JsonNode): Boolean = node.isContainerNode && !node.isEmpty

    private fun render(node: JsonNode, depth: Int = 0, context: Context = Context.ROOT): String {
        val indent = "  ".repeat(depth)
        val childIndent = "$indent  "
        return when (node) {
            is ObjectNode -> {
                if (node.isEmpty) return "{}"
                val isTree = context == Context.NOTES || context == Context.TREE
                val entries = node.properties().toList()
                val members = entries.map { (key, value) ->
                    val childContext = when {
                        context == Context.ROOT && key == "notes" -> Context.NOTES
                        isTree && key != "_meta" -> Context.TREE
                        else -> Context.GENERIC
                    }
                    "${ConfigParser.mapper.writeValueAsString(key)}: ${render(value, depth + 1, childContext)}"
                }.toMutableList()
                val hasNestedData = if (isTree) {
                    entries.any { (key, _) -> key != "_text" && key != "_meta" }
                } else {
                    entries.any { (_, value) -> hasChildren(value) }
                }
                if (context != Context.ROOT && context != Context.NOTES && !hasNestedData &&
                    members.none { '\n' in it }
                ) {
                    return members.joinToString(", ", "{ ", " }")
                }
                // Keep the node's own text and simple metadata together, before child paths.
                if (entries.getOrNull(0)?.key == "_text" && entries.getOrNull(1)?.key == "_meta" &&
                    isTree && '\n' !in members[1]
                ) {
                    members[0] = "${members[0]}, ${members.removeAt(1)}"
                }
                members.joinToString(",\n", "{\n", "\n$indent}") { "$childIndent$it" }
            }
            is ArrayNode -> {
                if (node.isEmpty) return "[]"
                val items = node.map { render(it, depth + 1, Context.GENERIC) }
                if (node.none { hasChildren(it) }) return items.joinToString(", ", "[", "]")
                items.joinToString(",\n", "[\n", "\n$indent]") { "$childIndent$it" }
            }
            else -> ConfigParser.mapper.writeValueAsString(node)
        }
    }

    private fun sortTree(node: ObjectNode): ObjectNode =
        sortObject(node, listOf("_text", "_meta")) { key, value ->
            when {
                key == "_meta" -> sortObject(value as ObjectNode, listOf("style"))
                value is ObjectNode -> sortTree(value)
                else -> sortNode(value)
            }
        }

    fun sortedKeys(keys: Iterable<String>): List<String> = keys.sortedWith(scalarComparator)

    private fun sortNode(node: JsonNode): JsonNode = when {
        node is ObjectNode -> sortObject(node)
        node is ArrayNode -> {
            val result = ConfigParser.mapper.createArrayNode()
            node.forEach { result.add(sortNode(it)) }
            result
        }
        node is DoubleNode && node.doubleValue() == 0.0 -> IntNode.valueOf(0)
        else -> node.deepCopy<JsonNode>()
    }

    private fun sortObject(
        node: ObjectNode,
        preferred: List<String> = emptyList(),
        transform: (String, JsonNode) -> JsonNode = { _, value -> sortNode(value) },
    ): ObjectNode {
        val priority = preferred.withIndex().associate { it.value to it.index }
        val keys = node.fieldNames().asSequence().toList().sortedWith { left, right ->
            val leftPriority = priority[left]
            val rightPriority = priority[right]
            if (leftPriority != null || rightPriority != null) {
                (leftPriority ?: Int.MAX_VALUE).compareTo(rightPriority ?: Int.MAX_VALUE)
            } else {
                scalarComparator.compare(left, right)
            }
        }
        val result = ConfigParser.mapper.createObjectNode()
        // 固定公共字段优先级，剩余字段再按 Unicode 标量值排序，保证 TS/Kotlin 字节输出一致。
        keys.forEach { key -> result.set<JsonNode>(key, transform(key, node.get(key))) }
        return result
    }

    private fun compareUnicodeScalars(left: String, right: String): Int {
        val leftPoints = left.codePoints().toArray()
        val rightPoints = right.codePoints().toArray()
        val count = minOf(leftPoints.size, rightPoints.size)
        for (index in 0 until count) {
            val comparison = leftPoints[index].compareTo(rightPoints[index])
            if (comparison != 0) return comparison
        }
        return leftPoints.size.compareTo(rightPoints.size)
    }
}
