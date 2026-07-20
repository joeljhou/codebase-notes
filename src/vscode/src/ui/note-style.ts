import type { Note, NoteStyle } from "../core/types.js";

export const SELECTABLE_NOTE_STYLES = [
  "core",
  "focus",
  "important",
  "stable",
  "extension",
  "default",
] as const satisfies readonly NoteStyle[];

export type SelectableNoteStyle = (typeof SELECTABLE_NOTE_STYLES)[number];

export function resolvedNoteStyle(note: Note): NoteStyle {
  return note.style ?? "default";
}

export function noteStyleThemeColor(style: NoteStyle): string | undefined {
  switch (style) {
    case "important":
      return "codebaseNotes.noteStyle.importantForeground";
    case "focus":
      return "codebaseNotes.noteStyle.focusForeground";
    case "core":
      return "codebaseNotes.noteStyle.coreForeground";
    case "stable":
      return "codebaseNotes.noteStyle.stableForeground";
    case "extension":
      return "codebaseNotes.noteStyle.extensionForeground";
    case "default":
      return undefined;
  }
}

export function noteIntentFromStyle(
  existing: Note,
  style: SelectableNoteStyle,
): Note {
  const updated: Note = { ...existing };
  if (style === "default") {
    delete updated.style;
  } else {
    updated.style = style;
  }
  return updated;
}
