import { compareUnicodeScalars } from "./serializer.js";
import type { Note } from "./types.js";

export interface MovePlan {
  kind: "planned";
  mapping: Record<string, string>;
}

export interface MoveConflict {
  kind: "conflict";
  paths: string[];
}

export type MoveResult = MovePlan | MoveConflict;

function isUnderPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}/`);
}

export function planMove(
  notes: Record<string, Note>,
  oldPrefix: string,
  newPrefix: string,
): MoveResult {
  const sourceKeys = Object.keys(notes)
    .filter((key) => isUnderPrefix(key, oldPrefix))
    .sort(compareUnicodeScalars);
  const sources = new Set(sourceKeys);
  const mapping: Record<string, string> = {};
  const conflicts = new Set<string>();

  for (const source of sourceKeys) {
    const suffix = source.slice(oldPrefix.length);
    const destination = `${newPrefix}${suffix}`;
    mapping[source] = destination;
    if (
      Object.prototype.hasOwnProperty.call(notes, destination) &&
      !sources.has(destination)
    ) {
      conflicts.add(destination);
    }
  }

  if (conflicts.size > 0) {
    return {
      kind: "conflict",
      paths: [...conflicts].sort(compareUnicodeScalars),
    };
  }
  return { kind: "planned", mapping };
}

export function applyMove(
  notes: Record<string, Note>,
  plan: MovePlan,
): Record<string, Note> {
  const moved = { ...notes };
  const saved = new Map<string, Note>();
  for (const [source, destination] of Object.entries(plan.mapping)) {
    const note = notes[source];
    if (note !== undefined) {
      saved.set(destination, note);
      delete moved[source];
    }
  }
  // 先删全部源，再写目标，case-only rename 和目录内互换不会覆盖尚未保存的值。
  for (const [destination, note] of saved) {
    moved[destination] = note;
  }
  return moved;
}
