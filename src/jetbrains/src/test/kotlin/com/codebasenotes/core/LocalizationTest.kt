package com.codebasenotes.core

import org.junit.jupiter.api.Test
import java.util.Locale
import java.util.ResourceBundle
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LocalizationTest {
    @Test
    fun `English and Simplified Chinese bundles have matching keys and placeholders`() {
        val english = ResourceBundle.getBundle("messages.CodebaseNotesBundle", Locale.ENGLISH)
        val chinese = ResourceBundle.getBundle("messages.CodebaseNotesBundle", Locale.SIMPLIFIED_CHINESE)

        assertEquals(english.keySet(), chinese.keySet())
        english.keySet().forEach { key ->
            assertEquals(
                placeholders(english.getString(key)),
                placeholders(chinese.getString(key)),
                key,
            )
            assertTrue(chinese.getString(key).isNotBlank(), key)
        }
    }

    private fun placeholders(value: String): List<String> =
        Regex("\\{\\d+}").findAll(value).map { it.value }.sorted().toList()
}
