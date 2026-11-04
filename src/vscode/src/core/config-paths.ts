import { findNodeAtLocation, parseTree, type Node, type ParseError } from "jsonc-parser";
import { isValidNoteKey } from "./path-policy.js";
import { decodeTreeKey } from "./tree-codec.js";
import { CONFIG_VERSION } from "./types.js";

export interface ConfigPathLocation {
  key: string;
  offset: number;
  length: number;
}

export function configPathLocations(text: string): ConfigPathLocation[] {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (root?.type !== "object" || errors.length > 0) return [];
  const version = findNodeAtLocation(root, ["version"]);
  if (version === undefined || text.slice(version.offset, version.offset + version.length) !== String(CONFIG_VERSION)) return [];
  const notes = findNodeAtLocation(root, ["notes"]);
  if (notes?.type !== "object") return [];
  const locations: ConfigPathLocation[] = [];
  function visit(node: Node, parent: string): void {
    for (const property of node.children ?? []) {
      const [name, value] = property.children ?? [];
      if (name?.type !== "string" || (value?.type !== "object" && value?.type !== "string")) continue;
      const relative = decodeTreeKey(String(name.value));
      if (relative === undefined) continue;
      const key = parent === "." ? relative : `${parent}/${relative}`;
      if (!isValidNoteKey(key)) continue;
      locations.push({ key, offset: name.offset + 1, length: name.length - 2 });
      if (value.type === "object") visit(value, key);
    }
  }
  visit(notes, ".");
  return locations;
}
