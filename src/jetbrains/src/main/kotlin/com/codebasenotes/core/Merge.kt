package com.codebasenotes.core

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode

object Merge {
    fun threeWay(
        base: ObjectNode,
        disk: ObjectNode,
        intent: Map<String, JsonNode?>,
    ): MergeResult {
        val merged = disk.deepCopy()
        val conflicts = mutableListOf<String>()

        for ((path, intended) in intent) {
            val before = base.get(path)
            val current = disk.get(path)

            // 决策表只有三种：磁盘没变就应用；双方结果相同就接受；其余才是真冲突。
            when {
                jsonEquals(current, before) -> apply(merged, path, intended)
                jsonEquals(current, intended) -> Unit
                else -> conflicts += path
            }
        }

        return if (conflicts.isEmpty()) {
            MergeResult.Merged(merged)
        } else {
            MergeResult.Conflict(ConfigSerializer.sortedKeys(conflicts))
        }
    }

    private fun apply(notes: ObjectNode, path: String, value: JsonNode?) {
        if (value == null) notes.remove(path) else notes.set<JsonNode>(path, value.deepCopy<JsonNode>())
    }

    private fun jsonEquals(left: JsonNode?, right: JsonNode?): Boolean = left == right
}
