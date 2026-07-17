package com.codebasenotes.jetbrains

import com.codebasenotes.core.NoteStyle
import com.intellij.ide.projectView.PresentationData
import com.intellij.ui.SimpleTextAttributes
import org.junit.jupiter.api.Test
import java.awt.Color
import kotlin.test.assertEquals

class ProjectViewNoteDecoratorTest {
    @Test
    fun `default note uses IntelliJ secondary text gray`() {
        assertEquals(
            SimpleTextAttributes.GRAYED_ATTRIBUTES.fgColor,
            noteStyleAttributes(NoteStyle.DEFAULT).fgColor,
        )
    }

    @Test
    fun `note keeps the original file name and its color`() {
        val data = PresentationData().apply { presentableText = "deploy.sh" }
        val fileColor = Color(0x3B82F6)

        appendNotePresentation(data, "fallback", fileColor, "双端打包入口", NoteStyle.INFO)

        assertEquals(listOf("deploy.sh", "  双端打包入口"), data.coloredText.map { it.text })
        assertEquals(fileColor, data.coloredText.first().attributes.fgColor)
    }

    @Test
    fun `existing name fragment is not duplicated`() {
        val data = PresentationData().apply {
            addText("src", com.intellij.ui.SimpleTextAttributes.REGULAR_ATTRIBUTES)
        }

        appendNotePresentation(data, "src", null, "源码", NoteStyle.SUCCESS)

        assertEquals(listOf("src", "  源码"), data.coloredText.map { it.text })
    }
}
