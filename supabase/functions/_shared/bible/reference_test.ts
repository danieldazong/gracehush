import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { BSB_BOOKS } from "./books.ts";
import {
  formatReference,
  MAX_VERSE_SPAN,
  parseReference,
  type ScriptureRef,
  spokenReference,
  validateRefShape,
} from "./reference.ts";

const ref = (
  bookId: ScriptureRef["bookId"],
  chapter: number,
  verseStart: number,
  verseEnd = verseStart,
): ScriptureRef => ({
  bookId,
  chapter,
  verseStart,
  verseEnd,
});

Deno.test("formatReference writes the reference the way the app shows it", () => {
  assertEquals(formatReference(ref("PHP", 4, 6, 7)), "Philippians 4:6–7");
  assert(formatReference(ref("PHP", 4, 6, 7)).includes("–"), "an en dash, U+2013");
  assertEquals(formatReference(ref("JHN", 3, 16)), "John 3:16");
  assertEquals(formatReference(ref("PSA", 23, 1, 3)), "Psalm 23:1–3");
  assertEquals(formatReference(ref("PSA", 127, 1, 2)), "Psalm 127:1–2");
  assertEquals(formatReference(ref("JUD", 1, 24, 25)), "Jude 1:24–25");
  assertEquals(formatReference(ref("SNG", 2, 4)), "Song of Solomon 2:4");
  assertEquals(formatReference(ref("1JN", 4, 18)), "1 John 4:18");
});

Deno.test("format then parse gives the same passage, for all 66 books", () => {
  for (const book of BSB_BOOKS) {
    for (
      const passage of [
        ref(book.id, 1, 1),
        ref(book.id, book.chapters, 2, 5),
        ref(book.id, book.chapters, 1, 1 + MAX_VERSE_SPAN),
      ]
    ) {
      assertEquals(parseReference(formatReference(passage)), passage, formatReference(passage));
    }
  }
});

Deno.test("parseReference reads the usual spellings, including what older rows hold", () => {
  assertEquals(parseReference("Song of Solomon 2:4"), ref("SNG", 2, 4));
  assertEquals(parseReference("1 John 4:18"), ref("1JN", 4, 18));
  assertEquals(parseReference("Psalm 34:18"), ref("PSA", 34, 18));
  assertEquals(parseReference("Psalms 127:1–2"), ref("PSA", 127, 1, 2));
  assertEquals(parseReference("Philippians 4:6–7"), ref("PHP", 4, 6, 7));
  assertEquals(parseReference("Phil. 4:6-7"), ref("PHP", 4, 6, 7));
  assertEquals(parseReference("  john 3:16  "), ref("JHN", 3, 16));
  assertEquals(parseReference("1john 4:18"), ref("1JN", 4, 18));
  assertEquals(parseReference("Jude 1:24 – 25"), ref("JUD", 1, 24, 25));
});

Deno.test("parseReference refuses what is not a passage", () => {
  for (
    const bad of [
      "Hezekiah 1:1",
      "John 99:1",
      "John 3:",
      "John 3",
      "John",
      "",
      "3:16",
      "John 3:16–15",
      "John 3:0",
      "John 3:1–30",
      "Psalm 23:1–2:3",
      "Psalm 151:1",
      "Obadiah 2:1",
    ]
  ) {
    assertEquals(parseReference(bad), null, JSON.stringify(bad));
  }
});

Deno.test("validateRefShape names the first thing wrong", () => {
  assertEquals(validateRefShape(ref("PHP", 4, 6, 7)), { ok: true });
  assertEquals(validateRefShape({ bookId: "XXX", chapter: 1, verseStart: 1, verseEnd: 1 }), {
    ok: false,
    reason: "UNKNOWN_BOOK",
  });
  assertEquals(validateRefShape(ref("PSA", 151, 1)), { ok: false, reason: "CHAPTER_OUT_OF_RANGE" });
  assertEquals(validateRefShape(ref("PSA", 0, 1)), { ok: false, reason: "CHAPTER_OUT_OF_RANGE" });
  assertEquals(validateRefShape(ref("OBA", 2, 1)), { ok: false, reason: "CHAPTER_OUT_OF_RANGE" });
  assertEquals(validateRefShape(ref("JHN", 3, 0, 1)), { ok: false, reason: "BAD_VERSES" });
  assertEquals(validateRefShape(ref("JHN", 3, 5, 4)), { ok: false, reason: "BAD_VERSES" });
  assertEquals(validateRefShape({ bookId: "JHN", chapter: 3, verseStart: 1.5, verseEnd: 2 }), {
    ok: false,
    reason: "BAD_VERSES",
  });
  assertEquals(validateRefShape({ bookId: "JHN", chapter: 3.2, verseStart: 1, verseEnd: 2 }), {
    ok: false,
    reason: "CHAPTER_OUT_OF_RANGE",
  });
  assertEquals(validateRefShape(ref("JHN", 3, 1, 1 + MAX_VERSE_SPAN)), { ok: true });
  assertEquals(validateRefShape(ref("JHN", 3, 1, 2 + MAX_VERSE_SPAN)), { ok: false, reason: "RANGE_TOO_LONG" });
});

Deno.test("spokenReference: how a passage is read aloud", () => {
  const spoken = (text: string) => {
    const parsed = parseReference(text);
    assert(parsed !== null, text);
    return spokenReference(parsed);
  };
  assertEquals(spoken("Philippians 4:6–7"), "Philippians chapter 4, verses 6 through 7");
  assertEquals(spoken("John 3:16"), "John chapter 3, verse 16");
  assertEquals(spoken("Psalm 23:1–3"), "Psalm 23, verses 1 through 3");
  assertEquals(spoken("Psalms 127:1-2"), "Psalm 127, verses 1 through 2");
  assertEquals(spoken("1 John 4:18"), "First John chapter 4, verse 18");
  assertEquals(spoken("2 Kings 5:14"), "Second Kings chapter 5, verse 14");
  assertEquals(spoken("1 Corinthians 13:4–7"), "First Corinthians chapter 13, verses 4 through 7");
  assertEquals(spoken("Song of Solomon 2:10–12"), "Song of Solomon chapter 2, verses 10 through 12");
  // A book with one chapter leaves the chapter out, and the numbered ones still say First, Second and Third.
  assertEquals(spoken("Jude 1:24–25"), "Jude, verses 24 through 25");
  assertEquals(spoken("3 John 1:2"), "Third John, verse 2");
  assertEquals(spoken("Philemon 1:6"), "Philemon, verse 6");
});

Deno.test("spokenReference: every book reads as words, with no digit left in its name", () => {
  const ordinal: Record<string, string> = { "1": "First", "2": "Second", "3": "Third" };
  for (const book of BSB_BOOKS) {
    const text = spokenReference({ bookId: book.id, chapter: 1, verseStart: 1, verseEnd: 2 });
    // The sentence is the name, then the chapter (not for Psalms, which just has a number, nor for a one-chapter book).
    const tail = book.chapters === 1
      ? ", verses 1 through 2"
      : book.id === "PSA"
      ? " 1, verses 1 through 2"
      : " chapter 1, verses 1 through 2";
    assert(text.endsWith(tail), `${book.id}: "${text}"`);
    const name = text.slice(0, text.length - tail.length);
    assert(!/[0-9]/.test(name), `${book.id}: "${text}" keeps a digit in the book's name`);
    // The numbered books (1 Samuel, 2 Kings, 3 John...) start with their ordinal word.
    const first = /^([123]) /.exec(book.name);
    if (first) assert(name.startsWith(`${ordinal[first[1]]} `), `${book.id}: "${text}"`);
  }
});
