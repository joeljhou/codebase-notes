import type { Note, NoteStyle } from "../core/types.js";

// muted 继续兼容旧配置，但不再作为新建选项；核心样式保持明确的状态语义。
export const SELECTABLE_NOTE_STYLES = [
  "default",
  "info",
  "success",
  "warning",
  "danger",
] as const satisfies readonly NoteStyle[];

export type SelectableNoteStyle = (typeof SELECTABLE_NOTE_STYLES)[number];

export function resolvedNoteStyle(note: Note): NoteStyle {
  return note.style ?? "default";
}

export function noteStyleThemeColor(style: NoteStyle): string {
  switch (style) {
    case "muted":
      return "disabledForeground";
    case "info":
      return "codebaseNotes.noteStyle.infoForeground";
    case "success":
      return "codebaseNotes.noteStyle.successForeground";
    case "warning":
      return "codebaseNotes.noteStyle.warningForeground";
    case "danger":
      return "codebaseNotes.noteStyle.dangerForeground";
    case "default":
      return "codebaseNotes.noteStyle.defaultForeground";
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
