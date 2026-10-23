import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { bookById, BSB_BOOKS, isUsfmBookId, normalizeBookName, resolveBook, USFM_BOOK_IDS } from "./books.ts";

Deno.test("the table has the 66 books of the BSB, in order, with 1,189 chapters", () => {
  assertEquals(BSB_BOOKS.length, 66);
  assertEquals(BSB_BOOKS.map((book) => book.order), Array.from({ length: 66 }, (_, index) => index + 1));
  assertEquals(new Set(BSB_BOOKS.map((book) => book.id)).size, 66);
  assertEquals(BSB_BOOKS.reduce((sum, book) => sum + book.chapters, 0), 1_189);
  for (const book of BSB_BOOKS) assert(/^(?:[1-3][A-Z]{2}|[A-Z]{3})$/.test(book.id), `a USFM id: ${book.id}`);
  assertEquals(USFM_BOOK_IDS, BSB_BOOKS.map((book) => book.id));
  assertEquals(bookById("PSA")?.chapters, 150);
  assertEquals(bookById("OBA")?.chapters, 1);
  assertEquals(bookById("psa"), null);
});

Deno.test("the Song of Solomon is SNG, named as its commonName, not books.json's short name", () => {
  assertEquals(bookById("SNG")?.name, "Song of Solomon");
  assertEquals(bookById("SNG")?.chapters, 8);
});

Deno.test("isUsfmBookId accepts the 66 ids and nothing else", () => {
  for (const id of USFM_BOOK_IDS) assert(isUsfmBookId(id));
  for (const bad of ["php", "PHI", "Philippians", "", "PS", "SOS", null, undefined, 7]) {
    assertEquals(isUsfmBookId(bad), false);
  }
});

Deno.test("every alias is in normalized form, resolves to exactly its own book, and is claimed once", () => {
  const owners = new Map<string, string>();
  for (const book of BSB_BOOKS) {
    for (const alias of book.aliases) {
      assertEquals(normalizeBookName(alias), alias, `alias "${alias}" of ${book.id} is not normalized`);
      assertEquals(resolveBook(alias)?.id, book.id, `alias "${alias}" resolves to the wrong book`);
      assert(!owners.has(alias), `"${alias}" is claimed by ${owners.get(alias)} and ${book.id}`);
      owners.set(alias, book.id);
    }
  }
});

Deno.test("an id and a display name always resolve to their own book", () => {
  for (const book of BSB_BOOKS) {
    assertEquals(resolveBook(book.id)?.id, book.id);
    assertEquals(resolveBook(book.name)?.id, book.id);
    assertEquals(resolveBook(book.name.toUpperCase())?.id, book.id);
  }
});

Deno.test("resolveBook reads the usual spellings", () => {
  const cases: [string, string][] = [
    ["Phil.", "PHP"],
    ["Philippians", "PHP"],
    ["php", "PHP"],
    ["Philem", "PHM"],
    ["Phlm.", "PHM"],
    ["1 John", "1JN"],
    ["1john", "1JN"],
    ["First John", "1JN"],
    ["I John", "1JN"],
    ["1st John", "1JN"],
    ["1 Jn", "1JN"],
    ["iii John", "3JN"],
    ["2 Cor.", "2CO"],
    ["Second Corinthians", "2CO"],
    ["1 Sam", "1SA"],
    ["Psalm", "PSA"],
    ["Psalms", "PSA"],
    ["Ps.", "PSA"],
    ["Song of Songs", "SNG"],
    ["Song of Solomon", "SNG"],
    ["Canticles", "SNG"],
    ["Revelation", "REV"],
    ["Revelations", "REV"],
    ["Jn", "JHN"],
    ["John", "JHN"],
    ["Jon", "JON"],
    ["Jonah", "JON"],
    ["  gen  ", "GEN"],
    ["Matt", "MAT"],
    ["Mk", "MRK"],
    ["Ecclesiastes", "ECC"],
    ["Qoheleth", "ECC"],
  ];
  for (const [input, id] of cases) assertEquals(resolveBook(input)?.id, id, input);
});

Deno.test("a USFM id is a spelling too: JUD is Jude (Judges is JDG), JON is Jonah, JHN is John", () => {
  assertEquals(resolveBook("Jud")?.id, "JUD");
  assertEquals(resolveBook("jdg")?.id, "JDG");
  assertEquals(resolveBook("Judges")?.id, "JDG");
  assertEquals(resolveBook("Jon")?.id, "JON");
});

Deno.test("resolveBook guesses nothing", () => {
  // None of these is a book, or an exact spelling of one: nothing is matched by prefix or by likeness.
  for (
    const bad of ["Hezekiah", "", "   ", "John 3", "1", "4 John", "Phi", "Gene", "The Book of Ruth", "psalms 23"]
  ) {
    assertEquals(resolveBook(bad), null, JSON.stringify(bad));
  }
});
