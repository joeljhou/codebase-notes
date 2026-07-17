package com.codebasenotes.jetbrains

import com.codebasenotes.core.NoteStyle
import com.intellij.ui.JBColor
import com.intellij.ui.SimpleTextAttributes
import java.awt.Color

internal fun noteStyleAttributes(style: NoteStyle): SimpleTextAttributes =
    if (style == NoteStyle.DEFAULT) {
        // 与 IntelliJ 原生 location text 一致，普通备注保持低视觉权重。
        SimpleTextAttributes.GRAYED_ATTRIBUTES
    } else {
        SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, noteStyleColor(style))
    }

private fun noteStyleColor(style: NoteStyle): Color = when (style) {
    NoteStyle.DEFAULT -> SimpleTextAttributes.GRAYED_ATTRIBUTES.fgColor
    NoteStyle.MUTED -> JBColor.namedColor("Label.disabledForeground", JBColor.GRAY)
    NoteStyle.INFO -> JBColor(Color(0x2563EB), Color(0x60A5FA))
    NoteStyle.SUCCESS -> JBColor(Color(0x15803D), Color(0x4ADE80))
    NoteStyle.WARNING -> JBColor(Color(0xB45309), Color(0xFBBF24))
    NoteStyle.DANGER -> JBColor(Color(0xDC2626), Color(0xF87171))
}
