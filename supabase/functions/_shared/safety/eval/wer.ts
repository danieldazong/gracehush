// The transcription fidelity check's arithmetic (step 36): a recording's words against the script that was read aloud, as a
// word error rate. Pure: no network, no file, nothing logged.

// What screen-v2 writes for a word it could not make out. It is always a wrong word, even against itself: a word that was
// said and not heard is an error, whatever was said.
export const UNCLEAR = "[unclear]";

// The words of a text for comparing: lowercased, one kind of apostrophe, punctuation gone (a pause written "…" or a comma is
// not a word), and [unclear] kept as one word.
export function normalizeWords(text: string): string[] {
  return text.toLowerCase().replace(/’/g, "'").match(/\[unclear\]|[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

// Substitutions, insertions and deletions (the Levenshtein distance over words), over the script's words. 0 is word for
// word; 1 is as many errors as the script has words (it can go past 1 when many words are added).
export function wordErrorRate(script: string, heard: string): number {
  const reference = normalizeWords(script);
  if (reference.length === 0) throw new Error("the script has no words to measure against");
  const hypothesis = normalizeWords(heard);
  const same = (said: string, written: string) => said === written && written !== UNCLEAR;
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= hypothesis.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (same(reference[row - 1], hypothesis[column - 1]) ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length] / reference.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
