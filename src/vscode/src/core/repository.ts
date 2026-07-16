import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { AtomicFileStore, FileStoreError } from "./file-store.js";
import { mergeNotes, type NoteIntent } from "./merge.js";
import { applyMove, planMove } from "./move.js";
import { ConfigParser } from "./parser.js";
import { stableSerialize } from "./serializer.js";
import type {
  ConfigLoadResult,
  ConfigV1,
  DiagnosticCode,
  Note,
} from "./types.js";
import type { Localize } from "./localize.js";

export interface ConfigSnapshot {
  configPath: string;
  rawDigest: string;
  config: ConfigV1;
}

export type LoadResult =
  | { kind: "loaded"; snapshot: ConfigSnapshot }
  | { kind: "missing" }
  | { kind: "diagnostic"; result: Exclude<ConfigLoadResult, { mode: "writable-v1" }> };

export type OperationResult =
  | { kind: "committed"; snapshot: ConfigSnapshot }
  | { kind: "no-change"; snapshot: ConfigSnapshot }
  | { kind: "conflict"; code: "CBN003_WRITE_CONFLICT"; paths: string[] }
  | { kind: "failed"; code: DiagnosticCode; message: string };

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeSnapshot(
  configPath: string,
  bytes: Uint8Array,
  config: ConfigV1,
): ConfigSnapshot {
  return { configPath, rawDigest: digest(bytes), config };
}

function isErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

export class ConfigRepository {
  readonly fileStore: AtomicFileStore;
  readonly localize: Localize;

  constructor(
    readonly parser: ConfigParser,
    fileStore?: AtomicFileStore,
  ) {
    this.localize = parser.localize;
    this.fileStore = fileStore ?? new AtomicFileStore({ localize: this.localize });
  }

  async load(configPath: string): Promise<LoadResult> {
    let bytes: Buffer;
    try {
      bytes = await readFile(configPath);
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return { kind: "missing" };
      }
      return {
        kind: "diagnostic",
        result: {
          mode: "invalid",
          code: "CBN001_INVALID_CONFIG",
          message: this.localize(
            "Could not read the configuration: {0}",
            (error as Error).message,
          ),
        },
      };
    }

    const parsed = this.parser.parse(bytes);
    if (parsed.mode !== "writable-v1") {
      return { kind: "diagnostic", result: parsed };
    }
    return {
      kind: "loaded",
      snapshot: makeSnapshot(configPath, bytes, parsed.config),
    };
  }

  async create(configPath: string): Promise<OperationResult> {
    try {
      return await this.fileStore.withLock(configPath, async () => {
        const existing = await this.load(configPath);
        if (existing.kind === "loaded") {
          return { kind: "no-change", snapshot: existing.snapshot };
        }
        if (existing.kind === "diagnostic") {
          return {
            kind: "failed",
            code: existing.result.code,
            message:
              existing.result.mode === "invalid"
                ? existing.result.message
                : this.localize(
                    "Configuration version {0} is not supported",
                    existing.result.version,
                  ),
          };
        }

        const config: ConfigV1 = { version: 1, notes: {} };
        const bytes = Buffer.from(stableSerialize(config), "utf8");
        await this.fileStore.atomicReplace(configPath, bytes);
        return {
          kind: "committed",
          snapshot: makeSnapshot(configPath, bytes, config),
        };
      });
    } catch (error) {
      return this.#failure(error);
    }
  }

  async commit(
    base: ConfigSnapshot,
    intent: NoteIntent,
  ): Promise<OperationResult> {
    try {
      return await this.fileStore.withLock(base.configPath, async () => {
        const disk = await this.load(base.configPath);
        if (disk.kind !== "loaded") {
          if (disk.kind === "diagnostic") {
            return {
              kind: "failed",
              code: disk.result.code,
              message:
                disk.result.mode === "invalid"
                  ? disk.result.message
                  : this.localize(
                      "Configuration version {0} is not supported",
                      disk.result.version,
                    ),
            };
          }
          return {
            kind: "failed",
            code: "CBN001_INVALID_CONFIG",
            message: this.localize("The configuration file was deleted"),
          };
        }

        const merged = mergeNotes(
          base.config.notes,
          disk.snapshot.config.notes,
          intent,
        );
        if (merged.kind === "conflict") {
          return {
            kind: "conflict",
            code: "CBN003_WRITE_CONFLICT",
            paths: merged.paths,
          };
        }
        if (isDeepStrictEqual(merged.notes, disk.snapshot.config.notes)) {
          return { kind: "no-change", snapshot: disk.snapshot };
        }

        // 未 touched 的根字段始终以锁内最新磁盘版本为准。
        const config: ConfigV1 = {
          ...disk.snapshot.config,
          notes: merged.notes,
        };
        const bytes = Buffer.from(stableSerialize(config), "utf8");
        // Repository 是所有写入口的最后一道边界，不能假设 UI 或第三方 API 调用者已校验。
        const validation = this.parser.parse(bytes);
        if (validation.mode !== "writable-v1") {
          return {
            kind: "failed",
            code: validation.code,
            message:
              validation.mode === "invalid"
                ? validation.message
                : this.localize(
                    "Configuration version {0} is not supported",
                    validation.version,
                  ),
          };
        }
        await this.fileStore.atomicReplace(base.configPath, bytes);
        return {
          kind: "committed",
          snapshot: makeSnapshot(base.configPath, bytes, config),
        };
      });
    } catch (error) {
      return this.#failure(error);
    }
  }

  async setNote(
    base: ConfigSnapshot,
    key: string,
    note: Note | null,
  ): Promise<OperationResult> {
    return this.commit(base, { [key]: note });
  }

  async move(
    base: ConfigSnapshot,
    oldPrefix: string,
    newPrefix: string,
  ): Promise<OperationResult> {
    return this.moveMany(base, [{ oldPrefix, newPrefix }]);
  }

  async moveMany(
    base: ConfigSnapshot,
    moves: ReadonlyArray<{ oldPrefix: string; newPrefix: string }>,
  ): Promise<OperationResult> {
    let moved = base.config.notes;
    for (const move of moves) {
      const plan = planMove(moved, move.oldPrefix, move.newPrefix);
      if (plan.kind === "conflict") {
        return {
          kind: "conflict",
          code: "CBN003_WRITE_CONFLICT",
          paths: plan.paths,
        };
      }
      moved = applyMove(moved, plan);
    }
    const intent: NoteIntent = {};
    const keys = new Set([
      ...Object.keys(base.config.notes),
      ...Object.keys(moved),
    ]);
    for (const key of keys) {
      if (!isDeepStrictEqual(base.config.notes[key], moved[key])) {
        intent[key] = moved[key] ?? null;
      }
    }
    return this.commit(base, intent);
  }

  #failure(error: unknown): OperationResult {
    if (error instanceof FileStoreError) {
      return { kind: "failed", code: error.code, message: error.message };
    }
    return {
      kind: "failed",
      code: "CBN007_UNSAFE_CONFIG",
      message: (error as Error).message,
    };
  }
}
