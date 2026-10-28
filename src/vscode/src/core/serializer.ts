import type { ConfigDocument, JsonObject, JsonValue } from "./types.js";
import { encodeTree } from "./tree-codec.js";

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

type Context = "root" | "tree" | "metadata" | "generic";

function render(value: JsonValue, depth: number, context: Context): string {
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value);
  }
  const indent = "  ".repeat(depth);
  const childIndent = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((child) =>
      `${childIndent}${render(child, depth + 1, "generic")}`,
    );
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const preferred = context === "root"
    ? ["$schema", "version", "notes"]
    : context === "tree"
      ? ["_text", "_meta"]
      : context === "metadata" ? ["style"] : [];
  const keys = orderedKeys(value, preferred);
  if (keys.length === 0) return "{}";
  // Emit members directly: JSON.stringify(object) reorders integer-like keys.
  const members = keys.map((key) => {
    let childContext: Context = "generic";
    if (context === "root" && key === "notes") {
      childContext = "tree";
    } else if (context === "tree") {
      childContext = key === "_meta" ? "metadata" : "tree";
    }
    const child = render(value[key] as JsonValue, depth + 1, childContext);
    return `${childIndent}${JSON.stringify(key)}: ${child}`;
  });
  return `{\n${members.join(",\n")}\n${indent}}`;
}

export function stableSerialize(config: ConfigDocument): string {
  const root: JsonObject = {
    ...config,
    version: 2,
    notes: encodeTree(config.notes),
  };
  return `${render(root, 0, "root")}\n`;
}
