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
