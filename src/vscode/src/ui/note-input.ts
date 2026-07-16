import type { Note } from "../core/types.js";
import { defaultLocalize, type Localize } from "../core/localize.js";

export function validateNoteText(
  text: string,
  localize: Localize = defaultLocalize,
): string | undefined {
  if (text.length > 0 && text.trim().length === 0) {
    return localize(
      "A note cannot contain only whitespace; clear the input to delete it",
    );
  }
  if ([...text].length > 2_000) {
    return localize("A note cannot exceed 2000 characters");
  }
  return undefined;
}

export function noteIntentFromText(
  existing: Note | undefined,
  text: string,
): Note | null {
  if (text.length === 0) {
    return null;
  }
  return {
    ...(existing ?? {}),
    text,
  };
}
