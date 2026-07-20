import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  noteIntentFromStyle,
  noteStyleThemeColor,
  resolvedNoteStyle,
  SELECTABLE_NOTE_STYLES,
  type SelectableNoteStyle,
} from "../ui/note-style.js";
import { projectRoot } from "./helpers.js";

test("样式选择暴露六种代码地图语义", () => {
  assert.deepEqual(SELECTABLE_NOTE_STYLES, [
    "core",
    "focus",
    "important",
    "stable",
    "extension",
    "default",
  ]);
});

test("设置样式保留文字与未来字段，default 使用最简表示", () => {
  const existing = {
    text: "入口",
    style: "important" as const,
    future: { enabled: true },
  };
  assert.deepEqual(noteIntentFromStyle(existing, "focus"), {
    text: "入口",
    style: "focus",
    future: { enabled: true },
  });
  assert.deepEqual(noteIntentFromStyle(existing, "default"), {
    text: "入口",
    future: { enabled: true },
  });
});

test("每种代码地图样式都有稳定且可区分的主题颜色", () => {
  assert.equal(resolvedNoteStyle({ text: "A" }), "default");
  assert.deepEqual(
    ["default", "important", "focus", "core", "stable", "extension"].map(
      (style) =>
        noteStyleThemeColor(
          style as "default" | "important" | "focus" | "core" | "stable" | "extension",
        ),
    ),
    [
      undefined,
      "codebaseNotes.noteStyle.importantForeground",
      "codebaseNotes.noteStyle.focusForeground",
      "codebaseNotes.noteStyle.coreForeground",
      "codebaseNotes.noteStyle.stableForeground",
      "codebaseNotes.noteStyle.extensionForeground",
    ],
  );
});

test("Quick Pick 为每种样式提供深浅主题彩色圆点", () => {
  const expectedColors: Record<SelectableNoteStyle, [string, string]> = {
    core: ["#DC2626", "#F87171"],
    focus: ["#B45309", "#FBBF24"],
    important: ["#2563EB", "#60A5FA"],
    stable: ["#15803D", "#4ADE80"],
    extension: ["#7C3AED", "#C084FC"],
    default: ["#6B7280", "#9CA3AF"],
  };
  const directory = path.join(
    projectRoot(),
    "src",
    "vscode",
    "resources",
    "note-styles",
  );

  for (const style of SELECTABLE_NOTE_STYLES) {
    const [light, dark] = expectedColors[style];
    assert.match(
      readFileSync(path.join(directory, `${style}-light.svg`), "utf8"),
      new RegExp(`fill="${light}"`),
    );
    assert.match(
      readFileSync(path.join(directory, `${style}-dark.svg`), "utf8"),
      new RegExp(`fill="${dark}"`),
    );
  }
});
