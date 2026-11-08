import type { AffirmationVerse } from "@/types";

// An affirmation's verse (step 37) as the app keeps it: a reference and the verse's words, both non-empty text, or null.
// Affirmations saved before step 37, cached before it, or answered by a process-entry that has not been redeployed have no
// `verse` at all; anything that is not a whole verse is read as none, so a screen never shows half of one.
export function readAffirmationVerse(value: unknown): AffirmationVerse | null {
  if (typeof value !== "object" || value === null) return null;
  const { reference, text } = value as Record<string, unknown>;
  if (typeof reference !== "string" || typeof text !== "string") return null;
  if (reference.trim() === "" || text.trim() === "") return null;
  return { reference, text };
}
