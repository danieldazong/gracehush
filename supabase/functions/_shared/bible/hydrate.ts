import { bookById } from "./books.ts";
import { fetchChapter } from "./helloao.ts";
import { formatReference, type RefProblem, type ScriptureRef, validateRefShape } from "./reference.ts";

// Turns a passage location into the exact Berean Standard Bible text, or says why it cannot. Scripture is never typed
// out by the model or by this code: the words come from the chapter the API serves.

// A card shows the passage in full; this keeps it a card.
export const MAX_PASSAGE_CHARS = 1_200;

export type InvalidReason = RefProblem | "VERSE_MISSING" | "TOO_LONG";

export type HydrateResult =
  | { status: "verified"; ref: ScriptureRef; reference: string; text: string }
  // Definitive: this passage does not exist in the BSB. `note` says so in words, built only from our own book table and
  // the numbers asked for (it is shown to the model when it is asked for another passage, never to a person).
  | { status: "invalid"; reference: string; reason: InvalidReason; note: string }
  // The chapter could not be read (the API is down, slow or answered with something else). The passage may be fine:
  // the reference is kept, without its text, and confirm-scripture tries again later.
  | { status: "unavailable"; ref: ScriptureRef; reference: string };

function bookName(bookId: string): string {
  return bookById(bookId)?.name ?? bookId;
}

function shapeNote(ref: ScriptureRef, reason: RefProblem): string {
  switch (reason) {
    case "UNKNOWN_BOOK":
      return "that book is not in the Berean Standard Bible";
    case "CHAPTER_OUT_OF_RANGE": {
      const chapters = bookById(ref.bookId)?.chapters ?? 0;
      return `${bookName(ref.bookId)} has only ${chapters} chapter${chapters === 1 ? "" : "s"}`;
    }
    case "BAD_VERSES":
      return "those verse numbers are not valid";
    case "RANGE_TOO_LONG":
      return "the passage is too long: it must be one to four verses";
  }
}

export async function hydrateScripture(ref: ScriptureRef): Promise<HydrateResult> {
  const reference = formatReference(ref);

  const shape = validateRefShape(ref);
  if (!shape.ok) return { status: "invalid", reference, reason: shape.reason, note: shapeNote(ref, shape.reason) };

  // Whatever goes wrong while reading the chapter, the passage has not been shown to be wrong: it is unavailable.
  const chapter = await fetchChapter(ref.bookId, ref.chapter);
  if (!chapter.ok) return { status: "unavailable", ref, reference };

  // A verse exists when the chapter lists it. (numberOfVerses counts the verses present, and 15 chapters leave some
  // numbers out, such as Matthew 17:21, so it says nothing about the highest verse number.)
  let text = "";
  let previousPoetic = false;
  for (let number = ref.verseStart; number <= ref.verseEnd; number += 1) {
    const verse = chapter.verses.get(number);
    if (!verse) {
      return {
        status: "invalid",
        reference,
        reason: "VERSE_MISSING",
        note: `${bookName(ref.bookId)} ${ref.chapter} has no verse ${number} in the Berean Standard Bible`,
      };
    }
    // Lines of a psalm stay on their own lines; prose verses run on.
    text += number === ref.verseStart ? verse.text : `${previousPoetic || verse.poetic ? "\n" : " "}${verse.text}`;
    previousPoetic = verse.poetic;
  }

  if (text.length > MAX_PASSAGE_CHARS) {
    return {
      status: "invalid",
      reference,
      reason: "TOO_LONG",
      note: `the passage is too long to show on a card (over ${MAX_PASSAGE_CHARS} characters)`,
    };
  }
  return { status: "verified", ref, reference, text };
}
