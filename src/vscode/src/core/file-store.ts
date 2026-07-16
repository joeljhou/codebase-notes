import { randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DiagnosticCode } from "./types.js";
import { defaultLocalize, type Localize } from "./localize.js";

interface LockContents {
  token: string;
  pid: number;
  hostname: string;
  createdAt: number;
}

export interface AtomicFileHooks {
  afterTempSynced?: (temporaryPath: string) => Promise<void> | void;
  beforeRename?: (
    temporaryPath: string,
    targetPath: string,
  ) => Promise<void> | void;
}

export interface AtomicFileStoreOptions {
  lockTimeoutMs?: number;
  staleLockMs?: number;
  retryDelayMs?: () => number;
  now?: () => number;
  hostname?: string;
  isProcessAlive?: (pid: number) => boolean;
  hooks?: AtomicFileHooks;
  localize?: Localize;
}

export class FileStoreError extends Error {
  constructor(
    readonly code: DiagnosticCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FileStoreError";
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AtomicFileStore {
  readonly #lockTimeoutMs: number;
  readonly #staleLockMs: number;
  readonly #retryDelayMs: () => number;
  readonly #now: () => number;
  readonly #hostname: string;
  readonly #isProcessAlive: (pid: number) => boolean;
  readonly #hooks: AtomicFileHooks;
  readonly #localize: Localize;

  constructor(options: AtomicFileStoreOptions = {}) {
    this.#lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.#staleLockMs = options.staleLockMs ?? 30_000;
    this.#retryDelayMs =
      options.retryDelayMs ?? (() => 20 + Math.floor(Math.random() * 30));
    this.#now = options.now ?? Date.now;
    this.#hostname = options.hostname ?? os.hostname();
    this.#isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    this.#hooks = options.hooks ?? {};
    this.#localize = options.localize ?? defaultLocalize;
  }

  async withLock<T>(configPath: string, action: () => Promise<T>): Promise<T> {
    const lockPath = `${configPath}.lock`;
    const lock = await this.#acquireLock(lockPath);
    try {
      return await action();
    } finally {
      await this.#removeLockIfTokenMatches(lockPath, lock.token);
    }
  }

  async atomicReplace(configPath: string, bytes: Uint8Array): Promise<void> {
    const existing = await this.#existingFile(configPath);
    if (existing?.isSymbolicLink()) {
      throw new FileStoreError(
        "CBN007_UNSAFE_CONFIG",
        this.#localize(
          "The configuration file is a symbolic link and cannot be atomically replaced",
        ),
      );
    }

    const temporaryPath = `${configPath}.tmp.${randomUUID()}`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      if (existing !== undefined) {
        await handle.chmod(existing.mode & 0o777);
      }
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;

      await this.#hooks.afterTempSynced?.(temporaryPath);
      await this.#hooks.beforeRename?.(temporaryPath, configPath);
      // 同目录 rename 是提交点；失败时原文件仍在，绝不先删目标。
      await rename(temporaryPath, configPath);
      await this.#syncDirectoryBestEffort(path.dirname(configPath));
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      if (error instanceof FileStoreError) {
        throw error;
      }
      throw new FileStoreError(
        "CBN007_UNSAFE_CONFIG",
        this.#localize(
          "Atomic replacement failed: {0}",
          (error as Error).message,
        ),
        { cause: error },
      );
    }
  }

  async #acquireLock(lockPath: string): Promise<LockContents> {
    const deadline = this.#now() + this.#lockTimeoutMs;
    const lock: LockContents = {
      token: randomUUID(),
      pid: process.pid,
      hostname: this.#hostname,
      createdAt: this.#now(),
    };

    while (true) {
      let created = false;
      try {
        const handle = await open(lockPath, "wx", 0o600);
        created = true;
        try {
          await handle.writeFile(`${JSON.stringify(lock)}\n`);
          await handle.sync();
        } finally {
          await handle.close();
        }
        return lock;
      } catch (error) {
        if (created) {
          // CREATE_NEW 已成功但写入/同步失败时，不能留下无法自动判断归属的半截锁。
          await unlink(lockPath).catch(() => undefined);
        }
        if (!isErrorCode(error, "EEXIST")) {
          throw new FileStoreError(
            "CBN004_LOCKED",
            this.#localize(
              "Could not create the lock file: {0}",
              (error as Error).message,
            ),
            { cause: error },
          );
        }
      }

      if (await this.#removeKnownStaleLock(lockPath)) {
        continue;
      }
      if (this.#now() >= deadline) {
        throw new FileStoreError(
          "CBN004_LOCKED",
          this.#localize("Another process is writing the configuration"),
        );
      }
      await sleep(this.#retryDelayMs());
    }
  }

  async #removeKnownStaleLock(lockPath: string): Promise<boolean> {
    let contents: LockContents;
    try {
      contents = JSON.parse(await readFile(lockPath, "utf8")) as LockContents;
    } catch {
      return false;
    }
    const oldEnough = this.#now() - contents.createdAt >= this.#staleLockMs;
    if (
      !oldEnough ||
      contents.hostname !== this.#hostname ||
      this.#isProcessAlive(contents.pid)
    ) {
      return false;
    }

    // 删除前再次核对 token，避免把刚接管的新锁删掉。
    return this.#removeLockIfTokenMatches(lockPath, contents.token);
  }

  async #removeLockIfTokenMatches(
    lockPath: string,
    token: string,
  ): Promise<boolean> {
    try {
      const current = JSON.parse(
        await readFile(lockPath, "utf8"),
      ) as LockContents;
      if (current.token !== token) {
        return false;
      }
      await unlink(lockPath);
      return true;
    } catch {
      return false;
    }
  }

  async #existingFile(configPath: string) {
    try {
      return await lstat(configPath);
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return undefined;
      }
      throw error;
    }
  }

  async #syncDirectoryBestEffort(directory: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(directory, "r");
      await handle.sync();
    } catch {
      // Windows 和部分文件系统不支持目录 fsync；文件 rename 已经完成。
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
