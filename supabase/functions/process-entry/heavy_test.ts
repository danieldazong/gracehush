import { formatReference, type ScriptureRef } from "../_shared/bible/reference.ts";
import { assert, assertEquals } from "./testing/assert.ts";
import { LIMITS } from "./constants.ts";
import { DENIED_PASSAGES, HEAVY_FALLBACK_PASSAGE, HEAVY_INSTRUCTION, heavyFallback, isDeniedPassage } from "./heavy.ts";
import { checkTone, countWords } from "./output.ts";
import {
  firstHeavyNeverSay,
  firstNeverSay,
  hasQuotation,
  hasStockOpening,
  hasVerseReference,
  HOOK_FEELING_WORDS,
  HOOK_MAX_WORDS,
  openingSentence,
  prayerVoice,
} from "./tone.ts";

// The written fallback (heavy.ts) and the passages a heavy moment never gets. The fallback is fixed text: these checks hold it
// to every rule a model's heavy reflection is held to, and to the instruction's targets.

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

// Made-up entries of every kind the fallback stands in for: it must pass whatever the person wrote.
const ENTRIES = [
  "",
  "I do not want to be alive anymore. I have been thinking about ending my life.",
  "My husband hit me again last night and I am scared to go home.",
  "Nothing feels worth it anymore.",
];

Deno.test("the fallback passes every hard and soft check, whatever the entry, as a heavy moment", () => {
  for (const entry of ENTRIES) {
    assertEquals(checkTone(heavyFallback(), entry), null, entry);
  }
});

Deno.test("the fallback keeps the instruction's targets: the hook, the lengths, the voice, nothing quoted or pointed to", () => {
  const fallback = heavyFallback();
  assertEquals(fallback.heavy, true);
  assertEquals(fallback.prayer, null, "a heavy moment is never made a prayer");
  // The devotional: 110 to 150 words in three or four paragraphs, a hook of at most twelve words with no feeling word.
  const words = countWords(fallback.devotional);
  assert(words >= 110 && words <= 150, `the devotional has ${words} words`);
  const paragraphs = fallback.devotional.split("\n\n");
  assert(paragraphs.length >= 3 && paragraphs.length <= 4);
  const hook = openingSentence(fallback.devotional);
  assert(countWords(hook) <= HOOK_MAX_WORDS, hook);
  assert(!HOOK_FEELING_WORDS.test(hook), hook);
  assert(!hasStockOpening(fallback.devotional));
  // Short sentences for the voice: none over 25 words, no numerals, no semicolons or parentheses.
  for (const sentence of fallback.devotional.split(/(?<=[.!?])\s+/)) {
    assert(countWords(sentence) <= 25, sentence);
  }
  assert(!/[\d;()]/.test(fallback.devotional + fallback.closingPrayer));
  // The prayer: the person's own, 30 to 50 words.
  const prayerWords = countWords(fallback.closingPrayer);
  assert(prayerWords >= 30 && prayerWords <= 50, `the prayer has ${prayerWords} words`);
  assertEquals(prayerVoice(fallback.closingPrayer, ""), "i");
  // Nothing quoted, no verse pointed to, nothing either never-say list holds, anywhere.
  const read = [
    fallback.title,
    fallback.validationLine ?? "",
    fallback.devotional,
    fallback.closingPrayer,
    ...fallback.affirmations.flatMap((item) => [item.headline, item.text]),
  ];
  for (const part of read) {
    assert(!hasQuotation(part), part);
    assert(!hasVerseReference(part), part);
    assertEquals(firstNeverSay(part), null, part);
    assertEquals(firstHeavyNeverSay(part), null, part);
    assert(!part.includes("'"), "typographic apostrophes only");
  }
  // The title and the headlines can reach a lock screen.
  assert(fallback.title.length <= 40 && /^(?:[A-Z][a-z]*)(?: [A-Z][a-z]*)+$/.test(fallback.title), fallback.title);
  for (const item of fallback.affirmations) {
    assert(item.headline.length <= LIMITS.affirmationHeadline.maxChars, item.headline);
    const textWords = countWords(item.text);
    assert(textWords >= 12 && textWords <= 30, item.text);
  }
  assertEquals(fallback.affirmations.map((item) => item.slot), ["morning", "afternoon", "evening"]);
  // The next step is a person, as the instruction asks.
  assert(fallback.devotional.includes("Reach out to someone you trust"));
});

Deno.test("the fallback's passage is Isaiah 41:10, never one a heavy moment is denied", () => {
  assertEquals(formatReference(HEAVY_FALLBACK_PASSAGE), "Isaiah 41:10");
  assertEquals(heavyFallback().scripture, HEAVY_FALLBACK_PASSAGE);
  assert(!isDeniedPassage(HEAVY_FALLBACK_PASSAGE));
});

Deno.test("a denied passage is denied whenever any of its verses falls in a range; a whole chapter when the range names none", () => {
  assert(isDeniedPassage(ref("PHP", 1, 21)));
  assert(isDeniedPassage(ref("PHP", 1, 18, 20)), "the run overlaps the range's first verse");
  assert(isDeniedPassage(ref("PHP", 1, 26, 27)), "the run overlaps the range's last verse");
  assert(!isDeniedPassage(ref("PHP", 1, 6)), "the same chapter outside the range");
  assert(!isDeniedPassage(ref("PHP", 4, 6, 7)));
  assert(isDeniedPassage(ref("JOB", 3, 26)), "Job 3 is denied whole");
  assert(isDeniedPassage(ref("PSA", 88, 1)));
  assert(!isDeniedPassage(ref("PSA", 23, 1, 3)));
  assert(!isDeniedPassage(ref("PSA", 34, 18)));
  assert(isDeniedPassage(ref("EPH", 5, 22)), "a call to submit");
  assert(isDeniedPassage(ref("MAT", 18, 22)), "a call to forgive without end");
  assert(isDeniedPassage(ref("1CO", 13, 7)), "love bears all things");
  assert(isDeniedPassage(ref("2CO", 5, 8)), "away from the body, at home with the Lord");
  // Every range is well formed: a chapter, and a run whose end is not before its start.
  for (const range of DENIED_PASSAGES) {
    assert(range.chapter >= 1);
    if (range.from !== undefined) assert(range.to === undefined || range.to >= range.from, JSON.stringify(range));
  }
});

Deno.test("the instruction's heavy section holds no number and names no service: the app shows the one line itself", () => {
  assert(!/\d/.test(HEAVY_INSTRUCTION));
  assert(!/hotline|lifeline|988|911/i.test(HEAVY_INSTRUCTION));
});
