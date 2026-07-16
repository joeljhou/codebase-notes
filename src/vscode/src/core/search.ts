import { compareUnicodeScalars } from "./serializer.js";
import type { Note } from "./types.js";

export interface SearchResult {
  key: string;
  note: Note;
}

export function searchNotes(
  notes: Record<string, Note>,
  query: string,
): SearchResult[] {
  const needle = query.toLocaleLowerCase("en-US");
  return Object.entries(notes)
    .filter(
      ([key, note]) =>
        key.toLocaleLowerCase("en-US").includes(needle) ||
        note.text.toLocaleLowerCase("en-US").includes(needle),
    )
    .sort(([left], [right]) => compareUnicodeScalars(left, right))
    .map(([key, note]) => ({ key, note }));
}
