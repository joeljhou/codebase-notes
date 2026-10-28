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

type Context = "root" | "notes" | "tree" | "metadata" | "generic";

function hasChildren(value: JsonValue): boolean {
  return typeof value === "object" && value !== null &&
    Object.keys(value).length > 0;
}

function render(value: JsonValue, depth: number, context: Context): string {
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value);
  }
  const indent = "  ".repeat(depth);
  const childIndent = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((child) => render(child, depth + 1, "generic"));
    if (!value.some(hasChildren)) return `[${items.join(", ")}]`;
    return `[\n${items.map((item) => `${childIndent}${item}`).join(",\n")}\n${indent}]`;
  }
  const isTree = context === "notes" || context === "tree";
  const preferred = context === "root"
    ? ["$schema", "version", "notes"]
    : isTree
      ? ["_text", "_meta"]
      : context === "metadata" ? ["style"] : [];
  const keys = orderedKeys(value, preferred);
  if (keys.length === 0) return "{}";
  // Emit members directly: JSON.stringify(object) reorders integer-like keys.
  const members = keys.map((key) => {
    let childContext: Context = "generic";
    if (context === "root" && key === "notes") {
      childContext = "notes";
    } else if (isTree) {
      childContext = key === "_meta" ? "metadata" : "tree";
    }
    const child = render(value[key] as JsonValue, depth + 1, childContext);
    return `${JSON.stringify(key)}: ${child}`;
  });
  const hasNestedData = isTree
    ? keys.some((key) => key !== "_text" && key !== "_meta")
    : keys.some((key) => hasChildren(value[key] as JsonValue));
  if (context !== "root" && context !== "notes" && !hasNestedData &&
      members.every((member) => !member.includes("\n"))) {
    return `{ ${members.join(", ")} }`;
  }
  // Keep the node's own text and simple metadata together, before child paths.
  if (isTree && keys[0] === "_text" && keys[1] === "_meta" &&
      members[1]?.includes("\n") === false) {
    members.splice(0, 2, members.slice(0, 2).join(", "));
  }
  return `{\n${members.map((member) => `${childIndent}${member}`).join(",\n")}\n${indent}}`;
}

export function stableSerialize(config: ConfigDocument): string {
  const root: JsonObject = {
    ...config,
    version: 2,
    notes: encodeTree(config.notes),
  };
  return `${render(root, 0, "root")}\n`;
}
