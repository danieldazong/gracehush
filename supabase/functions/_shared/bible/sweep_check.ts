// A manual check of the whole Berean Standard Bible against the code that reads it. It is not a test and never runs on a
// deploy. Download the translation once (8.6 MB) and point this at it:
//
//   curl -o complete.simple.json https://bible.helloao.org/api/BSB/complete.simple.json
//   npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --allow-read \
//     supabase/functions/_shared/bible/sweep_check.ts complete.simple.json
//
// It feeds every chapter of every book through the real parser (parseChapter, tidyVerse) and checks, for all verses:
// the book and chapter counts match the table in books.ts, every chapter parses, no letter or mark was changed by the
// whitespace repair, and no verse is left with a glued word, a line that starts with a closing mark or a space before one.
// Run it again if bible.helloao.org says the data changed (its Last-Modified date was 2026-10-12 when this was written).
import { BSB_BOOKS } from "./books.ts";
import { parseChapter, tidyVerse } from "./helloao.ts";

const path = Deno.args[0];
if (!path) {
  console.error("usage: sweep_check.ts <complete.simple.json>");
  Deno.exit(2);
}

type Json = Record<string, unknown>;
const whole = JSON.parse(await Deno.readTextFile(path)) as { translation: Json; books: Json[] };

const strip = (text: string) => text.replace(/\s+/g, "");
let problems = 0;
const fail = (message: string) => {
  problems += 1;
  if (problems <= 20) console.log(`PROBLEM  ${message}`);
};

let chapters = 0;
let verses = 0;
let repaired = 0;
let longest = 0;
const gaps: string[] = [];

if (whole.books.length !== BSB_BOOKS.length) fail(`${whole.books.length} books, the table has ${BSB_BOOKS.length}`);

for (const book of whole.books) {
  const id = String(book.id);
  const known = BSB_BOOKS.find((item) => item.id === id);
  const list = book.chapters as Json[];
  if (!known) {
    fail(`book ${id} is not in the table`);
    continue;
  }
  if (list.length !== known.chapters) fail(`${id}: ${list.length} chapters, the table has ${known.chapters}`);

  for (const entry of list) {
    const chapter = entry.chapter as Json & { number: number; content: Json[] };
    chapters += 1;
    const parsed = parseChapter({ translation: { id: "BSB" }, book: { id }, chapter }, known.id, chapter.number);
    if (!parsed) {
      fail(`${id} ${chapter.number}: the chapter did not parse`);
      continue;
    }
    if (parsed.size !== entry.numberOfVerses) {
      fail(`${id} ${chapter.number}: ${parsed.size} verses, numberOfVerses says ${entry.numberOfVerses}`);
    }
    const highest = Math.max(...parsed.keys());
    if (highest !== parsed.size) gaps.push(`${id} ${chapter.number}`);

    for (const item of chapter.content) {
      if (item.type !== "verse") continue;
      const ref = `${id} ${chapter.number}:${item.number}`;
      const raw = String(item.text);
      const tidy = tidyVerse(raw);
      verses += 1;
      if (tidy !== raw) repaired += 1;
      if (strip(tidy) !== strip(raw)) fail(`${ref}: the repair changed a letter or a mark`);
      if (tidy === "") fail(`${ref}: empty`);
      if (/[.!?;:,)”]\p{L}/u.test(tidy)) fail(`${ref}: a word is still glued to the sentence before it`);
      if (/\n[”’)?!.,;:]/.test(tidy)) fail(`${ref}: a line still starts with a closing mark`);
      if (/\s[”’)?!.,;:]/.test(tidy)) fail(`${ref}: a space is still before a closing mark`);
      if (/ {2}|\n\n|^\s|\s$/.test(tidy)) fail(`${ref}: stray whitespace`);
      longest = Math.max(longest, tidy.length);
      if (tidyVerse(tidy) !== tidy) fail(`${ref}: the repair is not stable`);
    }
  }
}

const expected = Number((whole.translation as Json).totalNumberOfVerses);
if (verses !== expected) fail(`${verses} verses read, the translation says ${expected}`);
if (chapters !== Number((whole.translation as Json).totalNumberOfChapters)) fail(`${chapters} chapters read`);

console.log(`${whole.books.length} books, ${chapters} chapters, ${verses} verses read`);
console.log(`${repaired} verses had whitespace repaired; the longest verse is ${longest} characters`);
console.log(`${gaps.length} chapters leave verse numbers out: ${gaps.join(", ")}`);
console.log(problems === 0 ? "every check passed" : `${problems} problem(s)`);
Deno.exit(problems === 0 ? 0 : 1);
