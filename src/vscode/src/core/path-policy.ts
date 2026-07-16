import { readdir } from "node:fs/promises";
import path from "node:path";
import { defaultLocalize, type Localize } from "./localize.js";

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;

export class PathPolicyError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid" | "missing" | "alias" = "invalid",
  ) {
    super(message);
    this.name = "PathPolicyError";
  }
}

export function isValidNoteKey(key: string): boolean {
  if (key === ".") {
    return true;
  }
  if (
    key.length === 0 ||
    key.startsWith("/") ||
    /^[A-Za-z]:\//u.test(key) ||
    key.includes("\\") ||
    key.includes("//") ||
    key.endsWith("/") ||
    CONTROL_CHARACTER.test(key)
  ) {
    return false;
  }
  const segments = key.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      segment !== ".codebase-notes.json",
  );
}

export type ReadDirectoryNames = (directory: string) => Promise<string[]>;

const defaultReadDirectoryNames: ReadDirectoryNames = async (directory) =>
  readdir(directory);

async function resolveActualSegments(
  root: string,
  requested: readonly string[],
  readDirectoryNames: ReadDirectoryNames,
  localize: Localize,
): Promise<string[]> {
  const actual: string[] = [];
  let current = root;
  for (const segment of requested) {
    const names = await readDirectoryNames(current);
    const exact = names.find((name) => name === segment);
    const matches = names.filter(
      (name) => name.toLocaleLowerCase("en-US") === segment.toLocaleLowerCase("en-US"),
    );
    const selected = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (selected === undefined) {
      throw new PathPolicyError(
        matches.length > 1
          ? localize(
              "Directory {0} contains a case-insensitive alias for {1}",
              current,
              segment,
            )
          : localize("Path does not exist: {0}", path.join(current, segment)),
        matches.length > 1 ? "alias" : "missing",
      );
    }
    actual.push(selected);
    // 逐段枚举只修正显示大小写，不调用 realpath，避免穿透符号链接。
    current = path.join(current, selected);
  }
  return actual;
}

export async function noteKeyForTarget(
  root: string,
  target: string,
  options: {
    caseSensitive: boolean;
    readDirectoryNames?: ReadDirectoryNames;
    localize?: Localize;
  },
): Promise<string> {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PathPolicyError(
      (options.localize ?? defaultLocalize)(
        "The target is outside the workspace root",
      ),
    );
  }
  if (relative.length === 0) {
    return ".";
  }

  const requested = relative.split(path.sep);
  const segments = options.caseSensitive
    ? requested
    : await resolveActualSegments(
        absoluteRoot,
        requested,
        options.readDirectoryNames ?? defaultReadDirectoryNames,
        options.localize ?? defaultLocalize,
      );
  const key = segments.join("/");
  if (!isValidNoteKey(key)) {
    throw new PathPolicyError(
      (options.localize ?? defaultLocalize)("Invalid note key: {0}", key),
    );
  }
  return key;
}
