import assert from "node:assert/strict";
import test from "node:test";
import {
  compareTreeEntries,
  shouldExcludePath,
  summarizeNote,
} from "../ui/tree-utils.js";

test("备注摘要会折叠换行和连续空白", () => {
  assert.equal(summarizeNote("  第一行\n  第二行  "), "第一行 第二行");
});

test("完整文件树遵循 files.exclude 并隐藏版本控制元数据", () => {
  const patterns = {
    "**/generated": true,
    "**/*.map": true,
    "**/conditional": { when: "$(basename).ts" },
  };

  assert.equal(shouldExcludePath(".git", patterns), true);
  assert.equal(shouldExcludePath("src/generated", patterns), true);
  assert.equal(shouldExcludePath("dist/app.js.map", patterns), true);
  assert.equal(shouldExcludePath("src/conditional", patterns), false);
  assert.equal(shouldExcludePath("src/App.ts", patterns), false);
});

test("文件树先显示目录，再按自然顺序显示名称", () => {
  const entries = [
    { name: "file10.ts", isDirectory: false },
    { name: "src", isDirectory: true },
    { name: "file2.ts", isDirectory: false },
  ].sort(compareTreeEntries);

  assert.deepEqual(entries.map((entry) => entry.name), [
    "src",
    "file2.ts",
    "file10.ts",
  ]);
});
