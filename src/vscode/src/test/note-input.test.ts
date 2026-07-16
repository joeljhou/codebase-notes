import assert from "node:assert/strict";
import test from "node:test";
import { noteIntentFromText, validateNoteText } from "../ui/note-input.js";

test("文字备注留空时转换为删除意图", () => {
  assert.equal(noteIntentFromText({ text: "旧备注" }, ""), null);
  assert.equal(validateNoteText(""), undefined);
});

test("编辑文字备注时保留 style 与未来字段", () => {
  assert.deepEqual(
    noteIntentFromText(
      { text: "旧备注", style: "info", future: { enabled: true } },
      "新备注",
    ),
    {
      text: "新备注",
      style: "info",
      future: { enabled: true },
    },
  );
});

test("只包含空白的备注会提示清空输入", () => {
  assert.equal(
    validateNoteText("   "),
    "A note cannot contain only whitespace; clear the input to delete it",
  );
});
