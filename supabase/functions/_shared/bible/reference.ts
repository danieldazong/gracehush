import { type BibleBook, bookById, resolveBook, type UsfmBookId } from "./books.ts";

// A passage inside one chapter, verses inclusive. The model returns one of these (with the book as a USFM id), the server
// checks it, and formatReference() writes it the way the app shows it.
export type ScriptureRef = { bookId: UsfmBookId; chapter: number; verseStart: number; verseEnd: number };

// verseEnd - verseStart may be at most this, so a passage is at most six verses. The model is asked for one to four: a
// passage a verse or two over is accepted rather than paid for with a second model call.
export const MAX_VERSE_SPAN = 5;

export type RefProblem = "UNKNOWN_BOOK" | "CHAPTER_OUT_OF_RANGE" | "BAD_VERSES" | "RANGE_TOO_LONG";

export type ShapeCheck = { ok: true } | { ok: false; reason: RefProblem };

// Is this the location of a possible passage? It checks the book, the chapter against the book's chapter count and the
// verse numbers. It cannot say whether the verses exist (some BSB chapters leave verse numbers out): the chapter text
// decides that.
export function validateRefShape(
  ref: { bookId: string; chapter: number; verseStart: number; verseEnd: number },
): ShapeCheck {
  const book = bookById(ref.bookId);
  if (!book) return { ok: false, reason: "UNKNOWN_BOOK" };
  if (!Number.isInteger(ref.chapter) || ref.chapter < 1 || ref.chapter > book.chapters) {
    return { ok: false, reason: "CHAPTER_OUT_OF_RANGE" };
  }
  if (!Number.isInteger(ref.verseStart) || !Number.isInteger(ref.verseEnd)) return { ok: false, reason: "BAD_VERSES" };
  if (ref.verseStart < 1 || ref.verseEnd < ref.verseStart) return { ok: false, reason: "BAD_VERSES" };
  if (ref.verseEnd - ref.verseStart > MAX_VERSE_SPAN) return { ok: false, reason: "RANGE_TOO_LONG" };
  return { ok: true };
}

// The name a reference is written with: books.json's commonName, and "Psalm" (singular) for the book of Psalms.
export function displayName(book: BibleBook): string {
  return book.id === "PSA" ? "Psalm" : book.name;
}

// "Philippians 4:6–7" (an en dash, U+2013), "John 3:16", "Psalm 23:1–3", "Jude 1:24–25": the chapter is always written,
// even for a book with one chapter.
export function formatReference(ref: ScriptureRef): string {
  const book = bookById(ref.bookId);
  const name = book ? displayName(book) : ref.bookId;
  const verses = ref.verseEnd > ref.verseStart ? `${ref.verseStart}–${ref.verseEnd}` : `${ref.verseStart}`;
  return `${name} ${ref.chapter}:${verses}`;
}

const ORDINALS: Record<string, string> = { "1": "First", "2": "Second", "3": "Third" };

// How a passage is read aloud (step 22), for the sentence "A reading from …": the numbered books say First, Second and
// Third ("1 John" is "First John"), a dash becomes "through", the book of Psalms has no "chapter" ("Psalm 23, verses 1
// through 3"), and a book with one chapter leaves the chapter out ("Jude, verses 24 through 25"), as a reader would.
export function spokenReference(ref: ScriptureRef): string {
  const book = bookById(ref.bookId);
  const name = (book ? displayName(book) : ref.bookId).replace(
    /^([123]) /,
    (_whole, digit: string) => `${ORDINALS[digit]} `,
  );
  const verses = ref.verseEnd > ref.verseStart
    ? `verses ${ref.verseStart} through ${ref.verseEnd}`
    : `verse ${ref.verseStart}`;
  if (book !== null && book.chapters === 1) return `${name}, ${verses}`;
  return ref.bookId === "PSA" ? `${name} ${ref.chapter}, ${verses}` : `${name} chapter ${ref.chapter}, ${verses}`;
}

const REFERENCE = /^(.+?)\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?$/;

// Reads what formatReference() writes, and the spellings older rows may hold ("Psalms 127:1-2", "Phil. 4:6-7"). Null when
// the text is not a reference or names a passage that cannot exist.
export function parseReference(text: string): ScriptureRef | null {
  const match = REFERENCE.exec(text.trim());
  if (!match) return null;
  const book = resolveBook(match[1]);
  if (!book) return null;
  const verseStart = Number(match[3]);
  const ref: ScriptureRef = {
    bookId: book.id,
    chapter: Number(match[2]),
    verseStart,
    verseEnd: match[4] === undefined ? verseStart : Number(match[4]),
  };
  return validateRefShape(ref).ok ? ref : null;
}
