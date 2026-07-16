package com.codebasenotes.core

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConformanceTest {
    private val fixtureDirectory = Path.of("..", "..", "spec", "conformance").normalize()

    @TestFactory
    fun sharedFixtures(): List<DynamicTest> {
        val tests = mutableListOf<DynamicTest>()
        Files.list(fixtureDirectory).use { files ->
            files.filter { it.fileName.toString().endsWith(".json") }
                .sorted()
                .forEach { fixture ->
                    val root = ConfigParser.mapper.readTree(Files.readAllBytes(fixture)) as ObjectNode
                    val operation = root.path("operation").textValue()
                    root.withArray("cases").forEach { case ->
                        tests += DynamicTest.dynamicTest(case.path("id").textValue()) {
                            runCase(operation, case as ObjectNode)
                        }
                    }
                }
        }
        return tests
    }

    private fun runCase(operation: String, case: ObjectNode) {
        val input = case.withObject("input")
        val expected = case.withObject("expected")
        when (operation) {
            "parse-config" -> assertParse(input.path("text").textValue(), expected)
            "parse-generated-note" -> {
                val text = input.path("character").textValue().repeat(input.path("count").intValue())
                val root = ConfigParser.mapper.createObjectNode().apply {
                    put("version", 1)
                    set<ObjectNode>("notes", ConfigParser.mapper.createObjectNode().apply {
                        set<ObjectNode>("a.ts", ConfigParser.mapper.createObjectNode().put("text", text))
                    })
                }
                assertParse(ConfigParser.mapper.writeValueAsString(root), expected)
            }
            "validate-key" -> assertEquals(
                expected.path("valid").booleanValue(),
                PathPolicy.isValidKey(input.path("key").textValue()),
            )
            "sort-keys" -> assertEquals(
                expected.withArray("keys").map(JsonNode::textValue),
                ConfigSerializer.sortedKeys(input.withArray("keys").map(JsonNode::textValue)),
            )
            "serialize-config" -> {
                val config = input.withObject("config")
                val document = ConfigDocument(config, config.withObject("notes"))
                assertEquals(
                    expected.path("text").textValue(),
                    ConfigSerializer.serialize(document).toString(Charsets.UTF_8),
                )
            }
            "merge" -> assertMerge(input, expected)
            "move" -> assertMove(input, expected)
            else -> error("未知 fixture 操作：$operation")
        }
    }

    private fun assertParse(text: String, expected: ObjectNode) {
        val actual = when (ConfigParser.parse(text.toByteArray())) {
            is ParseResult.WritableV1 -> "writable-v1" to null
            is ParseResult.ReadonlyFuture -> "readonly-future" to "CBN002_FUTURE_VERSION"
            is ParseResult.Invalid -> "invalid" to "CBN001_INVALID_CONFIG"
        }
        assertEquals(expected.path("mode").textValue(), actual.first)
        if (expected.has("code")) assertEquals(expected.path("code").textValue(), actual.second)
    }

    private fun assertMerge(input: ObjectNode, expected: ObjectNode) {
        val intent = linkedMapOf<String, JsonNode?>()
        input.withObject("intent").properties().forEach { (key, value) ->
            intent[key] = if (value.isNull) null else value
        }
        when (val actual = Merge.threeWay(input.withObject("base"), input.withObject("disk"), intent)) {
            is MergeResult.Merged -> {
                assertEquals("merged", expected.path("kind").textValue())
                assertEquals(expected.get("notes"), actual.notes)
            }
            is MergeResult.Conflict -> {
                assertEquals("conflict", expected.path("kind").textValue())
                assertEquals(expected.withArray("paths").map(JsonNode::textValue), actual.paths)
            }
        }
    }

    private fun assertMove(input: ObjectNode, expected: ObjectNode) {
        when (val actual = Move.plan(
            input.withObject("notes"),
            input.path("oldPrefix").textValue(),
            input.path("newPrefix").textValue(),
        )) {
            is MovePlan.Planned -> {
                assertEquals("planned", expected.path("kind").textValue())
                assertEquals(expected.withObject("mapping").fieldNames().asSequence().toSet(), actual.mapping.keys)
                actual.mapping.forEach { (source, destination) ->
                    assertEquals(expected.path("mapping").path(source).textValue(), destination)
                }
            }
            is MovePlan.Conflict -> {
                assertEquals("conflict", expected.path("kind").textValue())
                assertEquals(expected.withArray("paths").map(JsonNode::textValue), actual.paths)
            }
        }
    }
}
