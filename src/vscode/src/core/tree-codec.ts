import { isJsonObject, ownValue, setOwn } from "./json.js";
import { isValidNoteKey } from "./path-policy.js";
import type { JsonObject, JsonValue, Note } from "./types.js";

function encodeSegment(segment: string): string {
  return segment.startsWith("_") ? `_${segment}` : segment;
}

export function decodeTreeKey(encoded: string): string | undefined {
  const segments = encoded.split("/");
  if (segments.some((segment) => segment.startsWith("_") && !segment.startsWith("__"))) {
    return undefined;
  }
  const key = segments.map((segment) => segment.startsWith("__") ? segment.slice(1) : segment).join("/");
  return key !== "." && isValidNoteKey(key, true) ? key : undefined;
}

export function decodeTree(tree: JsonObject): Record<string, Note> {
  const notes: Record<string, Note> = {};
  function addNote(key: string, note: Note): void {
    if (!isValidNoteKey(key) || Object.hasOwn(notes, key)) {
      throw new Error(`Invalid or duplicate note key: ${key}`);
    }
    setOwn(notes, key, note);
  }
  function visit(node: JsonValue, key: string): void {
    if (typeof node === "string") {
      addNote(key, { text: node });
      return;
    }
    if (!isJsonObject(node)) throw new Error(`Invalid tree node: ${key}`);
    if (Object.hasOwn(node, "_text")) {
      addNote(key, {
        ...(node._meta as JsonObject | undefined),
        text: node._text as string,
      });
    }
    for (const [encoded, child] of Object.entries(node)) {
      if (encoded === "_text" || encoded === "_meta") continue;
      const relative = decodeTreeKey(encoded);
      if (relative === undefined) throw new Error(`Invalid note key: ${encoded}`);
      const childKey = key === "." ? relative : `${key}/${relative}`;
      if (!isValidNoteKey(childKey, true)) throw new Error(`Invalid note key: ${childKey}`);
      visit(child, childKey);
    }
  }
  visit(tree, ".");
  return notes;
}

export function encodeTree(
  notes: Record<string, Note>,
  compactDirectories: ReadonlyMap<string, string> = new Map(),
): JsonObject {
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

  function compact(node: JsonObject, key: string): JsonValue {
    if (key !== "." && Object.keys(node).length === 1 && Object.hasOwn(node, "_text")) {
      return node._text as JsonValue;
    }
    return Object.fromEntries(Object.entries(node).map(([encoded, value]) => {
      if (encoded === "_text" || encoded === "_meta") return [encoded, value];
      let name = encoded;
      let child = value as JsonObject;
      const segment = decodeTreeKey(encoded) as string;
      let childKey = key === "." ? segment : `${key}/${segment}`;
      while (!Object.hasOwn(child, "_text") && Object.keys(child).length === 1) {
        const next = Object.entries(child)[0];
        if (next === undefined || compactDirectories.get(childKey) !== decodeTreeKey(next[0])) break;
        name += `/${next[0]}`;
        childKey += `/${decodeTreeKey(next[0]) as string}`;
        child = next[1] as JsonObject;
      }
      return [name, compact(child, childKey)];
    }));
  }
  return compact(root, ".") as JsonObject;
}
