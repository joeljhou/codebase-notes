import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, planMove } from "../core/move.js";
import {
  isValidNoteKey,
  noteKeyForTarget,
  PathPolicyError,
} from "../core/path-policy.js";
import { searchNotes } from "../core/search.js";
import { stableSerialize } from "../core/serializer.js";
import type { ConfigV1 } from "../core/types.js";
import { createParser } from "./helpers.js";

const parser = createParser();

test("稳定序列化会保留未知字段并规范字段顺序", () => {
  const config = {
    z: { b: true, a: -0 },
    notes: {
      "中.ts": { future: { z: 2, a: 1 }, style: "important", text: "中文" },
      "a.ts": { text: "A" },
    },
    version: 1,
    $schema: "./spec/codebase-notes.schema.json",
  } as ConfigV1;

  const serialized = stableSerialize(config);
  assert.equal(
    serialized,
    [
      "{",
      '  "$schema": "./spec/codebase-notes.schema.json",',
      '  "version": 1,',
      '  "notes": {',
      '    "a.ts": {',
      '      "text": "A"',
      "    },",
      '    "中.ts": {',
      '      "text": "中文",',
      '      "style": "important",',
      '      "future": {',
      '        "a": 1,',
      '        "z": 2',
      "      }",
      "    }",
      "  },",
      '  "z": {',
      '    "a": 0,',
      '    "b": true',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  const reparsed = parser.parse(serialized);
  assert.equal(reparsed.mode, "writable-v1");
});

test("大小写不敏感路径使用磁盘目录项的真实大小写", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codebase-notes-path-"));
  await mkdir(path.join(root, "Src"));
  await writeFile(path.join(root, "Src", "App.ts"), "");

  assert.equal(
    await noteKeyForTarget(root, path.join(root, "src", "app.ts"), {
      caseSensitive: false,
    }),
    "Src/App.ts",
  );
});

test("路径不能逃出 boundary root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codebase-notes-root-"));
  await assert.rejects(
    noteKeyForTarget(root, path.dirname(root), { caseSensitive: true }),
    PathPolicyError,
  );
  assert.equal(isValidNoteKey("../x.ts"), false);
});

test("目录移动先保存全部源值再写目标", () => {
  const notes = {
    "old/a.ts": { text: "A" },
    "old/nested/b.ts": { text: "B" },
  };
  const plan = planMove(notes, "old", "new");
  assert.equal(plan.kind, "planned");
  if (plan.kind === "planned") {
    assert.deepEqual(applyMove(notes, plan), {
      "new/a.ts": { text: "A" },
      "new/nested/b.ts": { text: "B" },
    });
  }
});

test("搜索只覆盖 path 与 text，并按 key 排序", () => {
  const notes = {
    "z.ts": { text: "入口", futureTag: "payment" },
    "a.ts": { text: "Payment service" },
  };
  assert.deepEqual(
    searchNotes(notes, "payment").map((result) => result.key),
    ["a.ts"],
  );
  assert.deepEqual(
    searchNotes(notes, ".ts").map((result) => result.key),
    ["a.ts", "z.ts"],
  );
});
