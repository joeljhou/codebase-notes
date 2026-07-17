package com.codebasenotes.core

import com.fasterxml.jackson.core.JsonFactory
import com.fasterxml.jackson.core.StreamReadFeature
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import java.math.BigInteger

object ConfigParser {
    val mapper: ObjectMapper = ObjectMapper(
        JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build(),
    )

    private val minSafeInteger = BigInteger.valueOf(-9_007_199_254_740_991L)
    private val maxSafeInteger = BigInteger.valueOf(9_007_199_254_740_991L)
    fun parse(
        bytes: ByteArray,
        localizer: CoreLocalizer = DefaultCoreLocalizer,
    ): ParseResult {
        val normalized = if (
            bytes.size >= 3 && bytes[0] == 0xef.toByte() &&
            bytes[1] == 0xbb.toByte() && bytes[2] == 0xbf.toByte()
        ) {
            bytes.copyOfRange(3, bytes.size)
        } else {
            bytes
        }

        return try {
            val root = mapper.readTree(normalized)
            if (root !is ObjectNode) return ParseResult.Invalid(localizer.message("config.root.object"))

            val version = root.get("version")
            if (version == null || !version.isIntegralNumber || !isSafeInteger(version)) {
                return ParseResult.Invalid(localizer.message("config.version.safeInteger"))
            }

            // 先只识别版本，再决定是否套用 v1 结构；否则未来格式会被旧客户端误判为损坏。
            val versionValue = version.longValue()
            if (versionValue > 1) return ParseResult.ReadonlyFuture(versionValue)
            if (versionValue != 1L) return ParseResult.Invalid(localizer.message("config.version.onlyOne"))

            validateFiniteSafeNumbers(root, localizer)?.let { return ParseResult.Invalid(it) }
            validateV1(root, localizer)?.let { return ParseResult.Invalid(it) }
            ParseResult.WritableV1(ConfigDocument(root, root.withObject("notes")))
        } catch (error: Exception) {
            ParseResult.Invalid(error.message ?: localizer.message("json.parse.failed"))
        }
    }

    private fun validateV1(root: ObjectNode, localizer: CoreLocalizer): String? {
        val notes = root.get("notes")
        if (notes !is ObjectNode) return localizer.message("notes.object")

        for ((key, value) in notes.properties()) {
            if (!PathPolicy.isValidKey(key)) return localizer.message("path.key.invalid", key)
            if (value !is ObjectNode) return localizer.message("note.object", key)

            val text = value.get("text")
            if (text == null || !text.isTextual) return localizer.message("note.text.string", key)
            val content = text.textValue()
            val codePointCount = content.codePointCount(0, content.length)
            if (content.isEmpty() || codePointCount > 2000 || content.none { !it.isWhitespace() }) {
                return localizer.message("note.text.length", key)
            }

            value.get("style")?.let { style ->
                if (!style.isTextual || style.textValue() !in NoteStyle.configValues) {
                    return localizer.message("note.style.invalid", key)
                }
            }
        }
        return null
    }

    private fun validateFiniteSafeNumbers(node: JsonNode, localizer: CoreLocalizer): String? {
        when {
            node.isIntegralNumber && !isSafeInteger(node) -> return localizer.message("number.safeInteger")
            node.isFloatingPointNumber && !node.doubleValue().isFinite() -> return localizer.message("number.finite")
            node.isArray -> node.forEach { child ->
                validateFiniteSafeNumbers(child, localizer)?.let { return it }
            }
            node.isObject -> {
                for ((_, child) in node.properties()) {
                    validateFiniteSafeNumbers(child, localizer)?.let { return it }
                }
            }
        }
        return null
    }

    private fun isSafeInteger(node: JsonNode): Boolean {
        val value = node.bigIntegerValue()
        return value >= minSafeInteger && value <= maxSafeInteger
    }
}
