import {
  mkdtemp,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { AtomicFileStore } from "../core/file-store.js";
import { ConfigRepository, type ConfigSnapshot } from "../core/repository.js";
import type { Note } from "../core/types.js";
import { createParser } from "./helpers.js";

async function createWorkspace(): Promise<{
  directory: string;
  configPath: string;
  repository: ConfigRepository;
  snapshot: ConfigSnapshot;
}> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "codebase-notes-repository-"),
  );
  const configPath = path.join(directory, ".codebase-notes.json");
  const repository = new ConfigRepository(createParser());
  const created = await repository.create(configPath);
  assert.equal(created.kind, "committed");
  if (created.kind !== "committed") {
    throw new Error("测试初始化失败");
  }
  return { directory, configPath, repository, snapshot: created.snapshot };
}

async function loadedSnapshot(
  repository: ConfigRepository,
  configPath: string,
): Promise<ConfigSnapshot> {
  const loaded = await repository.load(configPath);
  assert.equal(loaded.kind, "loaded");
  if (loaded.kind !== "loaded") {
    throw new Error("预期配置可加载");
  }
  return loaded.snapshot;
}

test("两个旧快照修改不同 key 时锁内重读并合并", async () => {
  const { configPath, repository, snapshot } = await createWorkspace();
  const first = await repository.setNote(snapshot, "a.ts", { text: "A" });
  assert.equal(first.kind, "committed");

  const second = await repository.setNote(snapshot, "b.ts", { text: "B" });
  assert.equal(second.kind, "committed");
  const loaded = await loadedSnapshot(repository, configPath);
  assert.deepEqual(loaded.config.notes, {
    "a.ts": { text: "A" },
    "b.ts": { text: "B" },
  });
});

test("两个旧快照修改同一 key 时不静默覆盖", async () => {
  const { configPath, repository, snapshot } = await createWorkspace();
  const seeded = await repository.setNote(snapshot, "a.ts", { text: "base" });
  assert.equal(seeded.kind, "committed");
  if (seeded.kind !== "committed") {
    return;
  }

  const first = await repository.setNote(seeded.snapshot, "a.ts", {
    text: "disk",
  });
  assert.equal(first.kind, "committed");
  const second = await repository.setNote(seeded.snapshot, "a.ts", {
    text: "mine",
  });
  assert.deepEqual(second, {
    kind: "conflict",
    code: "CBN003_WRITE_CONFLICT",
    paths: ["a.ts"],
  });
  const loaded = await loadedSnapshot(repository, configPath);
  assert.equal(loaded.config.notes["a.ts"]?.text, "disk");
});

test("rename 前故障不会破坏原配置或残留 lock/tmp", async () => {
  const { directory, configPath, snapshot } = await createWorkspace();
  const before = await readFile(configPath, "utf8");
  const failingRepository = new ConfigRepository(
    createParser(),
    new AtomicFileStore({
      hooks: {
        beforeRename: () => {
          throw new Error("fault injection");
        },
      },
    }),
  );

  const result = await failingRepository.setNote(snapshot, "a.ts", {
    text: "不会落盘",
  });
  assert.equal(result.kind, "failed");
  assert.equal(await readFile(configPath, "utf8"), before);
  assert.deepEqual(
    (await readdir(directory)).filter(
      (name) => name.includes(".lock") || name.includes(".tmp."),
    ),
    [],
  );
});

test("活锁超时后返回 CBN004_LOCKED", async () => {
  const { configPath, snapshot } = await createWorkspace();
  const lockPath = `${configPath}.lock`;
  await writeFile(
    lockPath,
    JSON.stringify({
      token: "other",
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: Date.now(),
    }),
  );
  const repository = new ConfigRepository(
    createParser(),
    new AtomicFileStore({
      lockTimeoutMs: 5,
      retryDelayMs: () => 1,
    }),
  );

  const result = await repository.setNote(snapshot, "a.ts", { text: "A" });
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.equal(result.code, "CBN004_LOCKED");
  }
  await unlink(lockPath);
});

test("确认同主机 PID 已失效后可清理 stale lock", async () => {
  const { configPath, snapshot } = await createWorkspace();
  await writeFile(
    `${configPath}.lock`,
    JSON.stringify({
      token: "stale",
      pid: 999_999,
      hostname: os.hostname(),
      createdAt: 1,
    }),
  );
  const repository = new ConfigRepository(
    createParser(),
    new AtomicFileStore({
      now: () => 100_000,
      staleLockMs: 1,
      isProcessAlive: () => false,
    }),
  );

  const result = await repository.setNote(snapshot, "a.ts", { text: "A" });
  assert.equal(result.kind, "committed");
});

test("配置 symlink 可读但不可写", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "codebase-notes-symlink-"),
  );
  const target = path.join(directory, "actual.json");
  const configPath = path.join(directory, ".codebase-notes.json");
  await writeFile(target, '{"version":1,"notes":{}}\n');
  await symlink(target, configPath);
  const repository = new ConfigRepository(createParser());
  const snapshot = await loadedSnapshot(repository, configPath);

  const result = await repository.setNote(snapshot, "a.ts", { text: "A" });
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.equal(result.code, "CBN007_UNSAFE_CONFIG");
  }
  assert.equal(await readFile(target, "utf8"), '{"version":1,"notes":{}}\n');
});

test("写入以磁盘最新根字段为基础", async () => {
  const { configPath, repository, snapshot } = await createWorkspace();
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      notes: { "b.ts": { text: "B" } },
      futureRoot: { enabled: true },
    }),
  );

  const result = await repository.setNote(snapshot, "a.ts", { text: "A" });
  assert.equal(result.kind, "committed");
  const loaded = await loadedSnapshot(repository, configPath);
  assert.deepEqual(loaded.config.futureRoot, { enabled: true });
  assert.deepEqual(loaded.config.notes, {
    "a.ts": { text: "A" },
    "b.ts": { text: "B" },
  });
});

test("删除 note 使用 null intent，不写空字符串", async () => {
  const { configPath, repository, snapshot } = await createWorkspace();
  const created = await repository.setNote(snapshot, "a.ts", {
    text: "A",
  } satisfies Note);
  assert.equal(created.kind, "committed");
  if (created.kind !== "committed") {
    return;
  }
  const removed = await repository.setNote(created.snapshot, "a.ts", null);
  assert.equal(removed.kind, "committed");
  assert.deepEqual(
    (await loadedSnapshot(repository, configPath)).config.notes,
    {},
  );
});

test("迁移只在成功保存时发生，未变化的旧配置也升级且升级后保持幂等", async () => {
  const { configPath, repository } = await createWorkspace();
  const legacy = '{"version":1,"notes":{"src":{"text":"源代码","style":"default","future":{"__proto__":{"kept":true}}},"src/a.ts":{"text":"A"},"empty":{"text":"空目录"}},"rootFuture":[null,true]}\n';
  await writeFile(configPath, legacy);
  const base = await loadedSnapshot(repository, configPath);
  assert.equal(base.config.version, 1);
  assert.equal(await readFile(configPath, "utf8"), legacy);

  const migrated = await repository.setNote(base, "src", base.config.notes.src as Note);
  assert.equal(migrated.kind, "committed");
  if (migrated.kind !== "committed") return;
  assert.equal(migrated.snapshot.config.version, 2);
  const bytes = await readFile(configPath, "utf8");
  const stored = JSON.parse(bytes);
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.notes, {
    src: {
      _text: "源代码", _meta: JSON.parse('{"style":"default","future":{"__proto__":{"kept":true}}}'),
      "a.ts": "A",
    },
    empty: "空目录",
  });
  assert.deepEqual(migrated.snapshot.config.notes, base.config.notes);
  assert.deepEqual(migrated.snapshot.config.rootFuture, [null, true]);
  assert.equal((await repository.commit(migrated.snapshot, {})).kind, "no-change");
  assert.equal(await readFile(configPath, "utf8"), bytes);
});

test("create 复用已有旧配置时完成无损迁移", async () => {
  const { configPath, repository } = await createWorkspace();
  await writeFile(configPath, '{"version":1,"notes":{".":{"text":"项目"},"src/a":{"text":"A"}}}');
  const result = await repository.create(configPath);
  assert.equal(result.kind, "committed");
  const stored = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(stored, { version: 2, notes: { _text: "项目", src: { a: "A" } } });
  assert.equal((await repository.create(configPath)).kind, "no-change");
});

test("删除父备注保留子树，移动携带所有元数据，末条删除裁剪空枝", async () => {
  const { configPath, repository } = await createWorkspace();
  await writeFile(configPath, JSON.stringify({ version: 2, notes: {
    src: { _text: "目录", nested: { "a.ts": { _text: "A", _meta: { style: "focus", custom: [null, true] } } } },
    empty: "空目录",
  } }));
  const base = await loadedSnapshot(repository, configPath);
  const removed = await repository.setNote(base, "src", null);
  assert.equal(removed.kind, "committed");
  if (removed.kind !== "committed") return;
  const moved = await repository.move(removed.snapshot, "src", "new");
  assert.equal(moved.kind, "committed");
  if (moved.kind !== "committed") return;
  assert.deepEqual(moved.snapshot.config.notes["new/nested/a.ts"], { text: "A", style: "focus", custom: [null, true] });
  const deleted = await repository.setNote(moved.snapshot, "new/nested/a.ts", null);
  assert.equal(deleted.kind, "committed");
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")).notes, { empty: "空目录" });
});

test("旧快照可在其他客户端完成迁移后继续合并，内容相同不产生原型假冲突", async () => {
  const { configPath, repository } = await createWorkspace();
  await writeFile(configPath, '{"version":1,"notes":{"a":{"text":"A"}},"rootFuture":1}');
  const base = await loadedSnapshot(repository, configPath);
  assert.equal((await repository.commit(base, {})).kind, "committed");
  const disk = JSON.parse(await readFile(configPath, "utf8"));
  disk.rootFuture = 2;
  await writeFile(configPath, JSON.stringify(disk));
  const merged = await repository.setNote(base, "b", { text: "B" });
  assert.equal(merged.kind, "committed");
  const loaded = await loadedSnapshot(repository, configPath);
  assert.deepEqual(loaded.config.notes, { a: { text: "A" }, b: { text: "B" } });
  assert.equal(loaded.config.rootFuture, 2);
  assert.equal((await repository.setNote(base, "b", { text: "B" })).kind, "no-change");
});

test("特殊键能够添加、移动、冲突检测和删除，不命中继承属性", async () => {
  const { configPath, repository, snapshot } = await createWorkspace();
  const first = await repository.setNote(snapshot, "__proto__", { text: "原型文件" });
  assert.equal(first.kind, "committed");
  if (first.kind !== "committed") return;
  const second = await repository.setNote(first.snapshot, "constructor", { text: "构造文件" });
  assert.equal(second.kind, "committed");
  if (second.kind !== "committed") return;
  assert.equal((await repository.move(second.snapshot, "__proto__", "constructor")).kind, "conflict");
  const moved = await repository.move(second.snapshot, "__proto__", "toString");
  assert.equal(moved.kind, "committed");
  if (moved.kind !== "committed") return;
  const removed = await repository.setNote(moved.snapshot, "constructor", null);
  assert.equal(removed.kind, "committed");
  assert.deepEqual((await loadedSnapshot(repository, configPath)).config.notes, { toString: { text: "原型文件" } });
});

test("旧配置迁移失败或与磁盘冲突时原字节保持不变", async () => {
  const { directory, configPath, repository } = await createWorkspace();
  const legacy = '{"version":1,"notes":{"a":{"text":"A"}}}\n';
  await writeFile(configPath, legacy);
  const base = await loadedSnapshot(repository, configPath);
  const failing = new ConfigRepository(createParser(), new AtomicFileStore({
    hooks: { beforeRename: () => { throw new Error("migration failure"); } },
  }));
  assert.equal((await failing.commit(base, {})).kind, "failed");
  assert.equal(await readFile(configPath, "utf8"), legacy);
  assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".lock") || name.includes(".tmp.")), []);
  const disk = legacy.replace('"A"', '"disk"');
  await writeFile(configPath, disk);
  assert.equal((await repository.setNote(base, "a", { text: "mine" })).kind, "conflict");
  assert.equal(await readFile(configPath, "utf8"), disk);
});

test("非法配置和未来版本不会被旧快照保存覆盖", async () => {
  const { configPath, repository, snapshot } = await createWorkspace();
  for (const text of ['{"version":2,"notes":{"a":{"_meta":{}}}}', '{"version":3,"notes":"future"}']) {
    await writeFile(configPath, text);
    assert.equal((await repository.setNote(snapshot, "a", { text: "A" })).kind, "failed");
    assert.equal(await readFile(configPath, "utf8"), text);
  }
});

test("Repository 边界拒绝 UI 之外传入的非法 note", async () => {
  const { configPath, repository, snapshot } = await createWorkspace();
  const before = await readFile(configPath, "utf8");

  const result = await repository.setNote(snapshot, "a.ts", {
    text: "x".repeat(2_001),
  });

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.equal(result.code, "CBN001_INVALID_CONFIG");
  }
  assert.equal(await readFile(configPath, "utf8"), before);
});
