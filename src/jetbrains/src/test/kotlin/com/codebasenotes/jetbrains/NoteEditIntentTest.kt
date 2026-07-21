package com.codebasenotes.jetbrains

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class NoteEditIntentTest {
    @Test
    fun `cancel is a no-op whether or not a note exists`() {
        assertEquals(NoteEditIntent.NoOp, noteEditIntent(existingNote = false, text = null))
        assertEquals(NoteEditIntent.NoOp, noteEditIntent(existingNote = true, text = null))
    }

    @Test
    fun `exact empty input removes an existing note`() {
        assertEquals(NoteEditIntent.Remove, noteEditIntent(existingNote = true, text = ""))
    }

    @Test
    fun `exact empty input without an existing note is a no-op`() {
        assertEquals(NoteEditIntent.NoOp, noteEditIntent(existingNote = false, text = ""))
    }

    @Test
    fun `non-empty whitespace is invalid`() {
        assertEquals(
            NoteEditIntent.Invalid(NoteValidationFailure.WHITESPACE_ONLY),
            noteEditIntent(existingNote = true, text = " \t\n\u2003"),
        )
    }

    @Test
    fun `two thousand Unicode code points are accepted`() {
        val text = "\uD83E\uDDEA".repeat(MAX_NOTE_CODE_POINTS)

        assertEquals(NoteEditIntent.Set(text), noteEditIntent(existingNote = false, text = text))
    }

    @Test
    fun `more than two thousand Unicode code points are rejected`() {
        val text = "\uD83E\uDDEA".repeat(MAX_NOTE_CODE_POINTS + 1)

        assertEquals(
            NoteEditIntent.Invalid(NoteValidationFailure.TOO_LONG),
            noteEditIntent(existingNote = false, text = text),
        )
    }

    @Test
    fun `valid input is preserved exactly`() {
        val text = "  useful note  "

        assertEquals(NoteEditIntent.Set(text), noteEditIntent(existingNote = true, text = text))
    }
}
