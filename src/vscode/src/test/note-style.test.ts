import assert from "node:assert/strict";
import test from "node:test";
import {
  noteIntentFromStyle,
  noteStyleThemeColor,
  resolvedNoteStyle,
  SELECTABLE_NOTE_STYLES,
} from "../ui/note-style.js";

test("样式选择只暴露五个核心语义", () => {
  assert.deepEqual(SELECTABLE_NOTE_STYLES, [
    "default",
    "info",
    "success",
    "warning",
    "danger",
  ]);
});

test("设置样式保留文字与未来字段，default 使用最简表示", () => {
  const existing = {
    text: "入口",
    style: "info" as const,
    future: { enabled: true },
  };
  assert.deepEqual(noteIntentFromStyle(existing, "warning"), {
    text: "入口",
    style: "warning",
    future: { enabled: true },
  });
  assert.deepEqual(noteIntentFromStyle(existing, "default"), {
    text: "入口",
    future: { enabled: true },
  });
});

test("每种兼容样式都有稳定且可区分的主题颜色", () => {
  assert.equal(resolvedNoteStyle({ text: "A" }), "default");
  assert.deepEqual(
    ["default", "muted", "info", "success", "warning", "danger"].map(
      (style) =>
        noteStyleThemeColor(
          style as "default" | "muted" | "info" | "success" | "warning" | "danger",
        ),
    ),
    [
      undefined,
      "disabledForeground",
      "codebaseNotes.noteStyle.infoForeground",
      "codebaseNotes.noteStyle.successForeground",
      "codebaseNotes.noteStyle.warningForeground",
      "codebaseNotes.noteStyle.dangerForeground",
    ],
  );
});
