import { isJsonObject, ownValue, setOwn } from "./json.js";
import { isValidNoteKey } from "./path-policy.js";
import type { JsonObject, JsonValue, Note } from "./types.js";

function encodeSegment(segment: string): string {
  return segment.startsWith("_") ? `_${segment}` : segment;
}

export function decodeTree(tree: JsonObject): Record<string, Note> {
  const notes: Record<string, Note> = {};
  function visit(node: JsonValue, key: string): void {
    const hasNote = typeof node === "string" ||
      (isJsonObject(node) && Object.hasOwn(node, "_text"));
    if (hasNote && !isValidNoteKey(key)) {
      throw new Error(`Invalid note key: ${key}`);
    }
    if (typeof node === "string") {
      setOwn(notes, key, { text: node });
      return;
    }
    if (!isJsonObject(node)) {
      throw new Error(`Invalid tree node: ${key}`);
    }
    if (Object.hasOwn(node, "_text")) {
      setOwn(notes, key, {
        ...(node._meta as JsonObject | undefined),
        text: node._text as string,
      });
    }
    for (const [encoded, child] of Object.entries(node)) {
      if (encoded === "_text" || encoded === "_meta") continue;
      const segment = encoded.startsWith("__") ? encoded.slice(1) : encoded;
      const childKey = key === "." ? segment : `${key}/${segment}`;
      if (segment === "." || segment.includes("/") || !isValidNoteKey(childKey, true)) {
        throw new Error(`Invalid note key: ${childKey}`);
      }
      visit(child, childKey);
    }
  }
  visit(tree, ".");
  return notes;
}

export function encodeTree(notes: Record<string, Note>): JsonObject {
  const root: JsonObject = {};
  for (const [key, note] of Object.entries(notes)) {
    if (!isValidNoteKey(key)) throw new Error(`Invalid note key: ${key}`);
    let node = root;
    for (const segment of key === "." ? [] : key.split("/")) {
      const encoded = encodeSegment(segment);
      let child = ownValue(node, encoded);
      if (!isJsonObject(child)) {
        child = {};
        setOwn(node, encoded, child);
      }
      node = child;
    }
    node._text = note.text;
    const metadata = Object.fromEntries(
      Object.entries(note).filter(([name]) => name !== "text"),
    );
    if (Object.keys(metadata).length > 0) node._meta = metadata;
  }

  function compact(node: JsonObject, isRoot = false): JsonValue {
    const entries = Object.entries(node);
    if (!isRoot && entries.length === 1 && Object.hasOwn(node, "_text")) {
      return node._text as JsonValue;
    }
    return Object.fromEntries(entries.map(([key, value]) => [
      key,
      key === "_text" || key === "_meta" ? value : compact(value as JsonObject),
    ]));
  }
  return compact(root, true) as JsonObject;
}
