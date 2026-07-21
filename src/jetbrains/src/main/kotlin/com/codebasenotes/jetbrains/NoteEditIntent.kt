package com.codebasenotes.jetbrains

internal const val MAX_NOTE_CODE_POINTS = 2_000

internal sealed interface NoteEditIntent {
    data object NoOp : NoteEditIntent

    data object Remove : NoteEditIntent

    data class Set(val text: String) : NoteEditIntent

    data class Invalid(val reason: NoteValidationFailure) : NoteEditIntent
}

internal enum class NoteValidationFailure {
    WHITESPACE_ONLY,
    TOO_LONG,
}

/**
 * Converts the input dialog result into an explicit edit operation.
 *
 * A null value means that the dialog was cancelled. An exact empty string is the
 * delete gesture, while non-empty whitespace remains invalid so accidental spaces
 * cannot create an invisible note.
 */
internal fun noteEditIntent(existingNote: Boolean, text: String?): NoteEditIntent {
    if (text == null) return NoteEditIntent.NoOp
    if (text.isEmpty()) {
        return if (existingNote) NoteEditIntent.Remove else NoteEditIntent.NoOp
    }
    if (text.isBlank()) return NoteEditIntent.Invalid(NoteValidationFailure.WHITESPACE_ONLY)
    if (text.codePointCount(0, text.length) > MAX_NOTE_CODE_POINTS) {
        return NoteEditIntent.Invalid(NoteValidationFailure.TOO_LONG)
    }
    return NoteEditIntent.Set(text)
}
