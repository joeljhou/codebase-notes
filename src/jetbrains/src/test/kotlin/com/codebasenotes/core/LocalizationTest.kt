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
        assertEquals("核心", chinese.getString("note.style.core"))
        assertEquals("关注", chinese.getString("note.style.focus"))
        assertEquals("重要", chinese.getString("note.style.important"))
        assertEquals("稳定", chinese.getString("note.style.stable"))
        assertEquals("扩展", chinese.getString("note.style.extension"))
        assertEquals("普通", chinese.getString("note.style.default"))
        assertEquals(
            "上下键实时预览，Enter 保存，Esc 取消",
            chinese.getString("note.style.previewHint"),
        )
        assertEquals(
            "备注不能只包含空白字符；清空输入可删除备注",
            chinese.getString("note.validation.whitespaceOnly"),
        )
        assertEquals(
            "备注不能超过 2000 个字符",
            chinese.getString("note.validation.tooLong"),
        )
    }

    private fun placeholders(value: String): List<String> =
        Regex("\\{\\d+}").findAll(value).map { it.value }.sorted().toList()
}
