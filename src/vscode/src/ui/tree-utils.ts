import { minimatch } from "minimatch";

export type FilesExcludePatterns = Record<
  string,
  boolean | { when?: string }
>;

const alwaysHiddenNames = new Set([".git", ".hg", ".svn", "CVS", ".DS_Store"]);
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function summarizeNote(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function shouldExcludePath(
  relativePath: string,
  patterns: FilesExcludePatterns,
): boolean {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  if (alwaysHiddenNames.has(name)) {
    return true;
  }

  return Object.entries(patterns).some(([pattern, enabled]) => {
    if (enabled !== true) {
      return false;
    }
    return (
      minimatch(relativePath, pattern, { dot: true }) ||
      minimatch(`${relativePath}/`, pattern, { dot: true })
    );
  });
}

export function compareTreeEntries(
  left: { name: string; isDirectory: boolean },
  right: { name: string; isDirectory: boolean },
): number {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }
  const localized = nameCollator.compare(left.name, right.name);
  if (localized !== 0) {
    return localized;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}
