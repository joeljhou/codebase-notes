import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { ConfigRepository, type ConfigSnapshot, type OperationResult } from "../core/repository.js";
import { affectsNoteTopology } from "../core/directory-topology.js";
import { createParser } from "./helpers.js";

const chain = "src/main/java/cn/geekyspace/app";
const integration = `${chain}/integration`;
const unit = `${chain}/unit`;

function snapshot(result: OperationResult): ConfigSnapshot {
  assert.ok(result.kind === "committed" || result.kind === "no-change");
  return result.snapshot;
}

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cbn-compact-"));
  await mkdir(path.join(root, integration), { recursive: true });
  await mkdir(path.join(root, unit));
  const configPath = path.join(root, ".codebase-notes.json");
  const repository = new ConfigRepository(createParser());
  let base = snapshot(await repository.create(configPath));
  base = snapshot(await repository.commit(base, {
    [integration]: { text: "集成测试", style: "focus", future: { kept: true } },
    [unit]: { text: "单元测试" },
  }));
  const stored = async () => JSON.parse(await readFile(configPath, "utf8"));
  return { root, configPath, repository, base, stored };
}

test("单子目录链压缩，新增中间备注拆开，修改和删除后重新合并", async () => {
  const { root, repository, configPath, stored } = await workspace();
  try {
    let loaded = await repository.load(configPath);
    assert.equal(loaded.kind, "loaded");
    if (loaded.kind !== "loaded") return;
    let base = loaded.snapshot;
    assert.deepEqual((await stored()).notes, {
      [chain]: {
        integration: { _text: "集成测试", _meta: { style: "focus", future: { kept: true } } },
        unit: "单元测试",
      },
    });
    base = snapshot(await repository.setNote(base, "src/main/java/cn", { text: "包入口", style: "core" }));
    let notes = (await stored()).notes;
    assert.equal(notes["src/main/java/cn"]._text, "包入口");
    assert.ok(notes["src/main/java/cn"]["geekyspace/app"]);
    base = snapshot(await repository.setNote(base, integration, {
      ...base.config.notes[integration], text: "集成验证", style: "stable",
    }));
    assert.deepEqual(base.config.notes[integration], { text: "集成验证", style: "stable", future: { kept: true } });
    base = snapshot(await repository.setNote(base, "src/main/java/cn", null));
    notes = (await stored()).notes;
    assert.ok(notes[chain]);
    assert.equal(notes[chain].integration._meta.style, "stable");
    base = snapshot(await repository.setNote(base, unit, null));
    assert.ok((await stored()).notes[chain]);
    // The unannotated unit directory still prevents compression through app.
    assert.equal((await stored()).notes[`${chain}/integration`], undefined);
    base = snapshot(await repository.setNote(base, integration, null));
    assert.deepEqual((await stored()).notes, {});
    assert.deepEqual(base.config.notes, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("真实未备注文件和分支阻止合并，删除后仅维护格式且幂等", async () => {
  const { root, repository, configPath, base, stored } = await workspace();
  try {
    await writeFile(path.join(root, "src/main/README.md"), "unannotated");
    const expanded = await repository.normalize(configPath);
    assert.equal(expanded?.kind, "committed");
    assert.deepEqual(snapshot(expanded!).config.notes, base.config.notes);
    assert.ok((await stored()).notes["src/main"]["java/cn/geekyspace/app"]);
    await rm(path.join(root, "src/main/README.md"));
    assert.equal((await repository.normalize(configPath))?.kind, "committed");
    assert.ok((await stored()).notes[chain]);
    const bytes = await readFile(configPath, "utf8");
    assert.equal((await repository.normalize(configPath))?.kind, "no-change");
    assert.equal(await readFile(configPath, "utf8"), bytes);
    await mkdir(path.join(root, "src/other"));
    assert.equal((await repository.commit(base, {})).kind, "committed");
    assert.ok((await stored()).notes.src["main/java/cn/geekyspace/app"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("移动重新生成目录链并保留所有元数据", async () => {
  const { root, repository, configPath, base, stored } = await workspace();
  try {
    await mkdir(path.join(root, "new"));
    await rename(path.join(root, "src/main"), path.join(root, "new/main"));
    const moved = snapshot(await repository.move(base, "src/main", "new/main"));
    assert.deepEqual(moved.config.notes[`new/main/java/cn/geekyspace/app/integration`], base.config.notes[integration]);
    assert.ok((await stored()).notes["new/main/java/cn/geekyspace/app"]);
    assert.equal((await stored()).notes[chain], undefined);
    assert.equal((await repository.normalize(configPath))?.kind, "no-change");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("失联路径不猜测唯一子目录，文件不合并，符号链接链路不扫描", async () => {
  const { root, repository, base, stored } = await workspace();
  try {
    await writeFile(path.join(root, `${chain}/integration/Test.java`), "test");
    let next = snapshot(await repository.commit(base, {
      [integration]: null, [unit]: null,
      [`${chain}/missing/deep/Test.java`]: { text: "失联" },
    }));
    assert.ok((await stored()).notes[chain].missing.deep["Test.java"]);
    next = snapshot(await repository.setNote(next, `${integration}/Test.java`, { text: "测试文件", style: "core" }));
    assert.equal((await stored()).notes[chain].integration["Test.java"]._text, "测试文件");
    await symlink(path.join(root, "src"), path.join(root, "alias"));
    next = snapshot(await repository.setNote(next, "alias/main/java/cn/geekyspace/app/unit", { text: "别名" }));
    assert.ok((await stored()).notes.alias.main.java.cn.geekyspace.app.unit);
    assert.equal(next.config.notes["alias/main/java/cn/geekyspace/app/unit"]?.text, "别名");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("自动维护尊重未保存状态，拒绝历史或未来配置且不删除失联备注", async () => {
  const { root, repository, configPath, base } = await workspace();
  try {
    const original = await readFile(configPath, "utf8");
    await rm(path.join(root, "src"), { recursive: true });
    assert.equal(await repository.normalize(configPath, () => false), undefined);
    assert.equal(await readFile(configPath, "utf8"), original);
    const normalized = await repository.normalize(configPath);
    assert.equal(normalized?.kind, "committed");
    assert.deepEqual(snapshot(normalized!).config.notes, base.config.notes);
    for (const version of [1, 2, 4]) {
      const text = JSON.stringify({ version, notes: "unsupported" });
      await writeFile(configPath, text);
      assert.equal(await repository.normalize(configPath), undefined);
      assert.equal((await repository.create(configPath)).kind, "failed");
      assert.equal(await readFile(configPath, "utf8"), text);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("结构事件只关注备注相关目录并过滤插件自身文件", () => {
  const keys = [integration];
  for (const changed of ["src", "src/main/new.txt", `${chain}/integration/test.java`]) {
    assert.equal(affectsNoteTopology(keys, changed), true, changed);
  }
  for (const changed of [".codebase-notes.json", ".codebase-notes.json.lock", ".codebase-notes.json.tmp.x", ".git/objects/x", "unrelated/file.txt"]) {
    assert.equal(affectsNoteTopology(keys, changed), false, changed);
  }
});
