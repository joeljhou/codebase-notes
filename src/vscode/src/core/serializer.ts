import type { ConfigV1, JsonObject, JsonValue, Note } from "./types.js";

export function compareUnicodeScalars(left: string, right: string): number {
  // JS 默认按 UTF-16 code unit 排序；显式按 code point 比较，避免 emoji
  // 与 BMP 字符在 Kotlin/TypeScript 两端得到不同顺序。
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

function orderedKeys(value: JsonObject, preferred: readonly string[]): string[] {
  const priority = new Map(preferred.map((key, index) => [key, index]));
  return Object.keys(value).sort((left, right) => {
    const leftPriority = priority.get(left);
    const rightPriority = priority.get(right);
    if (leftPriority !== undefined || rightPriority !== undefined) {
      return (
        (leftPriority ?? Number.MAX_SAFE_INTEGER) -
        (rightPriority ?? Number.MAX_SAFE_INTEGER)
      );
    }
    return compareUnicodeScalars(left, right);
  });
}

function normalizeGeneric(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(normalizeGeneric);
  }
  if (typeof value !== "object" || value === null) {
    return Object.is(value, -0) ? 0 : value;
  }
  const normalized: JsonObject = {};
  for (const key of orderedKeys(value, [])) {
    normalized[key] = normalizeGeneric(value[key] as JsonValue);
  }
  return normalized;
}

function normalizeNote(note: Note): JsonObject {
  const normalized: JsonObject = {};
  for (const key of orderedKeys(note, ["text", "style"])) {
    normalized[key] = normalizeGeneric(note[key] as JsonValue);
  }
  return normalized;
}

export function stableSerialize(config: ConfigV1): string {
  const normalized: JsonObject = {};
  for (const key of orderedKeys(config, ["$schema", "version", "notes"])) {
    if (key === "notes") {
      const notes: JsonObject = {};
      for (const noteKey of Object.keys(config.notes).sort(
        compareUnicodeScalars,
      )) {
        notes[noteKey] = normalizeNote(config.notes[noteKey] as Note);
      }
      normalized.notes = notes;
    } else {
      normalized[key] = normalizeGeneric(config[key] as JsonValue);
    }
  }
  return `${JSON.stringify(normalized, null, 2)}\n`;
}
