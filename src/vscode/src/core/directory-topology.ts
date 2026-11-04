import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { isValidNoteKey } from "./path-policy.js";

export function noteDirectories(keys: Iterable<string>): Set<string> {
  const directories = new Set<string>();
  for (const key of keys) {
    if (!isValidNoteKey(key)) throw new Error(`Invalid note key: ${key}`);
    const segments = key === "." ? [] : key.split("/");
    for (let length = 1; length <= segments.length; length += 1) {
      directories.add(segments.slice(0, length).join("/"));
    }
  }
  return directories;
}

export function affectsNoteTopology(keys: Iterable<string>, changed: string): boolean {
  if (changed === ".codebase-notes.json" || changed.startsWith(".codebase-notes.json.") ||
      changed === ".git" || changed.startsWith(".git/")) return false;
  const parent = changed.includes("/") ? changed.slice(0, changed.lastIndexOf("/")) : ".";
  return [...keys].some((key) => key === changed || key.startsWith(`${changed}/`) ||
    (parent !== "." && (key === parent || key.startsWith(`${parent}/`))));
}

export async function readCompactDirectories(root: string, keys: Iterable<string>): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const safe = new Map<string, boolean>();
  async function isDirectory(key: string): Promise<boolean> {
    const cached = safe.get(key);
    if (cached !== undefined) return cached;
    const parent = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : undefined;
    const valid = (parent === undefined || await isDirectory(parent)) &&
      await lstat(path.join(root, key)).then((stat) => stat.isDirectory() && !stat.isSymbolicLink(), () => false);
    safe.set(key, valid);
    return valid;
  }
  for (const key of noteDirectories(keys)) {
    if (!await isDirectory(key)) continue;
    const entries = await readdir(path.join(root, key), { withFileTypes: true }).catch(() => []);
    if (entries.length === 1 && entries[0]?.isDirectory() && !entries[0].isSymbolicLink()) {
      links.set(key, entries[0].name);
    }
  }
  return links;
}
