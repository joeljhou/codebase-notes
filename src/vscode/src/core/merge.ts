import { isDeepStrictEqual } from "node:util";
import type { Note } from "./types.js";

export type NoteMap = Record<string, Note>;
export type NoteIntent = Record<string, Note | null>;

export type MergeResult =
  | { kind: "merged"; notes: NoteMap }
  | { kind: "conflict"; paths: string[] };

function apply(
  target: NoteMap,
  key: string,
  value: Note | undefined,
): void {
  if (value === undefined) {
    delete target[key];
  } else {
    target[key] = value;
  }
}

export function mergeNotes(
  base: NoteMap,
  disk: NoteMap,
  intent: NoteIntent,
): MergeResult {
  const planned = new Map<string, Note | undefined>();
  const conflicts: string[] = [];

  for (const [key, intendedOrNull] of Object.entries(intent)) {
    const baseValue = base[key];
    const diskValue = disk[key];
    const intended = intendedOrNull ?? undefined;

    // 三个判断的顺序对应协议表：磁盘未变、用户实际没改、两边已相同。
    if (isDeepStrictEqual(diskValue, baseValue)) {
      planned.set(key, intended);
    } else if (isDeepStrictEqual(intended, baseValue)) {
      planned.set(key, diskValue);
    } else if (isDeepStrictEqual(diskValue, intended)) {
      planned.set(key, diskValue);
    } else {
      conflicts.push(key);
    }
  }

  if (conflicts.length > 0) {
    return { kind: "conflict", paths: conflicts.sort() };
  }

  const merged = { ...disk };
  for (const [key, value] of planned) {
    apply(merged, key, value);
  }
  return { kind: "merged", notes: merged };
}
