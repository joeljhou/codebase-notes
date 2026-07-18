import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8")) as Record<
    string,
    unknown
  >;
}

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\d+\}/gu)].map((match) => match[0]).sort();
}

test("VS Code manifest metadata has English and Simplified Chinese translations", () => {
  const manifest = readJson("package.json");
  const english = readJson("package.nls.json");
  const chinese = readJson("package.nls.zh-cn.json");
  const references = [
    ...JSON.stringify(manifest).matchAll(/%([^%]+)%/gu),
  ].map((match) => match[1]);

  assert.deepEqual(sortedKeys(chinese), sortedKeys(english));
  for (const key of references) {
    assert.ok(key !== undefined && key in english, `missing English manifest key: ${key}`);
    assert.ok(key !== undefined && key in chinese, `missing Chinese manifest key: ${key}`);
  }
  assert.equal(
    english["view.annotatedFiles.name"],
    english["view.annotatedFiles.contextualTitle"],
  );
  assert.equal(
    chinese["view.annotatedFiles.name"],
    chinese["view.annotatedFiles.contextualTitle"],
  );
});

test("VS Code runtime bundles have matching keys and placeholders", () => {
  const english = readJson("l10n/bundle.l10n.json");
  const chinese = readJson("l10n/bundle.l10n.zh-cn.json");

  assert.deepEqual(sortedKeys(chinese), sortedKeys(english));
  for (const [key, value] of Object.entries(chinese)) {
    assert.equal(typeof value, "string");
    assert.deepEqual(placeholders(value as string), placeholders(key), key);
  }
});

test("note actions are available on the same editable targets", () => {
  const manifest = readJson("package.json") as {
    contributes?: {
      menus?: Record<string, Array<{ command?: string; when?: string }>>;
    };
  };
  const items = manifest.contributes?.menus?.["codebaseNotes.explorerContext"] ?? [];
  const editNote = items.find((item) => item.command === "codebaseNotes.editNote");
  const setNoteStyle = items.find(
    (item) => item.command === "codebaseNotes.setNoteStyle",
  );
  const removeNote = items.find(
    (item) => item.command === "codebaseNotes.removeNote",
  );

  assert.ok(editNote, "missing edit-note menu contribution");
  assert.ok(setNoteStyle, "missing set-note-style menu contribution");
  assert.ok(removeNote, "missing remove-note menu contribution");
  assert.equal(setNoteStyle.when, editNote.when);
  assert.equal(removeNote.when, editNote.when);
});

test("note actions have cross-platform default shortcuts", () => {
  const manifest = readJson("package.json") as {
    contributes?: {
      keybindings?: Array<{ command?: string; key?: string }>;
    };
  };
  const shortcuts = manifest.contributes?.keybindings ?? [];

  assert.deepEqual(
    shortcuts.filter((item) => item.command?.startsWith("codebaseNotes.") === true),
    [
      {
        command: "codebaseNotes.editNote",
        key: "alt+r",
      },
      {
        command: "codebaseNotes.setNoteStyle",
        key: "shift+alt+r",
      },
    ],
  );
});
