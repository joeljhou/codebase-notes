package com.codebasenotes.core

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode

object Move {
    fun plan(
        notes: ObjectNode,
        oldPrefix: String,
        newPrefix: String,
        localizer: CoreLocalizer = DefaultCoreLocalizer,
    ): MovePlan {
        require(PathPolicy.isValidKey(oldPrefix)) { localizer.message("move.oldPath.invalid", oldPrefix) }
        require(PathPolicy.isValidKey(newPrefix)) { localizer.message("move.newPath.invalid", newPrefix) }

        val sources = notes.fieldNames().asSequence()
            .filter { PathPolicy.isWithinPrefix(it, oldPrefix) }
            .toList()
        val sourceSet = sources.toSet()
        val mapping = linkedMapOf<String, String>()
        val conflicts = mutableSetOf<String>()

        for (source in ConfigSerializer.sortedKeys(sources)) {
            val destination = PathPolicy.replacePrefix(source, oldPrefix, newPrefix)
            if (notes.has(destination) && destination !in sourceSet) conflicts += destination
            mapping[source] = destination
        }

        return if (conflicts.isEmpty()) {
            MovePlan.Planned(mapping)
        } else {
            MovePlan.Conflict(ConfigSerializer.sortedKeys(conflicts))
        }
    }

    fun apply(notes: ObjectNode, plan: MovePlan.Planned): ObjectNode {
        val result = notes.deepCopy()
        val values = plan.mapping.mapValues { (source, _) -> notes.get(source)?.deepCopy<JsonNode>() }
        plan.mapping.keys.forEach(result::remove)
        plan.mapping.forEach { (source, destination) ->
            values[source]?.let { result.set<JsonNode>(destination, it) }
        }
        return result
    }
}
