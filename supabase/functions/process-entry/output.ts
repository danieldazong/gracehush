import { isUsfmBookId } from "../_shared/bible/books.ts";
import type { ScriptureRef } from "../_shared/bible/reference.ts";
import { EMOTIONS, LIMITS, PRAYER_CATEGORIES, SCRIPTURE_NUMBER_LIMITS, TIME_SLOTS } from "./constants.ts";
import type { EmotionKey, PrayerCategory, TimeSlot } from "./contracts.ts";
import {
  correctionNote,
  firstNeverSay,
  hasVerseReference,
  hookProblem,
  leakedWords,
  privateWords,
  type SalvageReason,
  salvageReflection,
} from "./tone.ts";

// The schema guarantees the shape, not the meaning. This checks the model's JSON again, cleans the text the person will
// read and hear, and returns a typed value. Anything out of range is invalid (nothing is truncated): the caller makes
// one more attempt and then answers AI_UNAVAILABLE.
//
// After the shape, the tone checks of step 32 (tone.ts), in this order: a verse reference in the devotional or the prayer,
// a never-say phrase anywhere the person reads or hears, and last a word the person wrote in the title or a headline (both
// reach a lock screen). A tone failure carries a note for the retry (gemini.ts sends it), and a reply whose only fault is a
// private word also carries itself with safe texts in the leaking fields, which is kept in case no clean reply comes.

export class OutputInvalid extends Error {
  // A short category for the log. Never the model's words.
  readonly reason: string;
  // What the next attempt is told to fix (tone.ts correctionNote). It can hold the person's own words, so it only ever goes
  // into the retry of the same request: never a log, a store or a print.
  readonly note?: string;
  // The reply with safe texts in place of the words that leaked, for a reply whose only fault that was.
  readonly salvage?: unknown;
  constructor(reason: string, extra: { note?: string | null; salvage?: unknown } = {}) {
    super(reason);
    this.name = "OutputInvalid";
    this.reason = reason;
    if (extra.note) this.note = extra.note;
    if (extra.salvage !== undefined) this.salvage = extra.salvage;
  }
}

function fail(reason: string): never {
  throw new OutputInvalid(reason);
}

export type ReadyReflection = {
  kind: "ready";
  emotion: EmotionKey;
  title: string;
  // Where the passage is. Whether it exists in the Berean Standard Bible is decided afterwards (scripture.ts), not here.
  scripture: ScriptureRef;
  devotional: string;
  closingPrayer: string;
  prayer: { title: string; summary: string; category: PrayerCategory } | null;
  affirmations: { slot: TimeSlot; headline: string; text: string }[];
  // Null for every clean reply. Set when this is a reply kept after a word from the entry stayed in its title or a headline,
  // with the safe text in its place (decision 17 of step 32): the log line says so.
  salvaged: SalvageReason | null;
};

// What the checks need besides the reply: the words the reflection was written from (the screened text).
// `recentFirstWords`: the first word of each recent devotional of the person's (tone.ts firstWord), for the hook guard.
export type ParseContext = { entry: string; recentFirstWords?: readonly string[] };

// The model's own is_crisis flag is the last of the three layers (the crisis screening is the first two). The words of a
// crisis entry are the screening's, so the flag carries nothing else.
export type Reflection = { kind: "crisis" } | ReadyReflection;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Tags, emoji and joiners are removed: the text is read aloud and shown as plain text.
export function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[‍︎️]/g, "");
}

// A straight apostrophe after a letter becomes the curly one (don't, God's, parents'), as the rest of the app writes it.
export function curlyApostrophes(text: string): string {
  return text.replace(/(\p{L})'/gu, "$1’");
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

// Short paragraphs separated by exactly one blank line.
export function tidyParagraphs(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => lines(paragraph).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join(" "))
    .filter(Boolean);
  return paragraphs.join("\n\n");
}

export function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/^["“”']+|["“”']+$/g, "").trim();
}

// A sentence that stops without punctuation gets a full stop. The app shows its own "Amen." after the prayer, so a
// prayer that ends "... for complete restoration" (the real model did, on 2026-10-23) would read "restoration Amen.".
export function finishSentence(text: string): string {
  if (text === "" || /[.!?…"”’)]$/.test(text)) return text;
  return `${text.replace(/[,;:\s-]+$/, "")}.`;
}

// The app shows its own "Amen." under the prayer, so a stored one would be said twice. The sentence before it keeps
// its punctuation ("... our hearts. Amen." becomes "... our hearts.").
export function removeAmen(text: string): string {
  const closing = /\s*\bamen\b[\s.!"”’']*$/i;
  if (!closing.test(text)) return text;
  return finishSentence(text.replace(closing, "").trim());
}

function clean(text: string): string {
  return curlyApostrophes(stripMarkup(text));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

// Only the shape is checked here: a USFM id from the list and whole numbers no bigger than any in the Bible. Whether the
// chapter and the verses exist is for the Bible code to decide, and a passage that does not exist costs one small
// follow-up request (scripture.ts), not a second reflection.
function readScripture(value: unknown): ScriptureRef {
  if (!isRecord(value)) fail("scripture_missing");
  const { book_id, chapter, verse_start, verse_end } = value;
  if (!isUsfmBookId(book_id)) fail("scripture_book");
  if (!isCount(chapter, 1, SCRIPTURE_NUMBER_LIMITS.chapter)) fail("scripture_chapter");
  if (!isCount(verse_start, 1, SCRIPTURE_NUMBER_LIMITS.verse)) fail("scripture_verse");
  if (!isCount(verse_end, verse_start, SCRIPTURE_NUMBER_LIMITS.verse)) fail("scripture_verse");
  return { bookId: book_id, chapter, verseStart: verse_start, verseEnd: verse_end };
}

// The reply to a request for a different passage: the same four fields on their own.
export function parseScripturePick(text: string): ScriptureRef {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return fail("json");
  }
  return readScripture(data);
}

function readPrayer(value: unknown): ReadyReflection["prayer"] {
  if (!isRecord(value) || typeof value.is_active_prayer !== "boolean") fail("prayer_shape");
  if (!value.is_active_prayer) return null;
  if (typeof value.title !== "string" || typeof value.summary !== "string") fail("prayer_text");
  const title = singleLine(clean(value.title));
  const summary = singleLine(clean(value.summary));
  if (title.length === 0 || title.length > LIMITS.prayerTitle.maxChars) fail("prayer_title");
  if (summary.length === 0 || summary.length > LIMITS.prayerSummary.maxChars) fail("prayer_summary");
  const category = (PRAYER_CATEGORIES as readonly string[]).find((item) => item === value.category);
  if (!category) fail("prayer_category");
  return { title, summary, category: category as PrayerCategory };
}

function readAffirmations(value: unknown): ReadyReflection["affirmations"] {
  if (!Array.isArray(value) || value.length !== TIME_SLOTS.length) fail("affirmations_count");
  const bySlot = new Map<TimeSlot, { slot: TimeSlot; headline: string; text: string }>();
  for (const item of value) {
    if (!isRecord(item)) fail("affirmation_shape");
    const slot = (TIME_SLOTS as readonly string[]).find((candidate) => candidate === item.time_slot) as
      | TimeSlot
      | undefined;
    if (!slot || bySlot.has(slot)) fail("affirmation_slot");
    if (typeof item.headline !== "string" || typeof item.text !== "string") fail("affirmation_text");
    const headline = singleLine(clean(item.headline));
    const text = singleLine(clean(item.text));
    if (headline.length === 0 || headline.length > LIMITS.affirmationHeadline.maxChars) fail("affirmation_headline");
    if (countWords(headline) > LIMITS.affirmationHeadline.maxWords) fail("affirmation_headline");
    if (text.length === 0 || text.length > LIMITS.affirmationText.maxChars) fail("affirmation_body");
    if (countWords(text) > LIMITS.affirmationText.maxWords) fail("affirmation_body");
    bySlot.set(slot, { slot, headline, text });
  }
  return TIME_SLOTS.map((slot) => bySlot.get(slot)!);
}

// The tone checks on a reflection that has the right shape, in their order, or null when it passes them all. The tone
// evaluation calls this too, to measure replies the instruction's older version wrote.
export function checkTone(reflection: ReadyReflection, entry: string): OutputInvalid | null {
  const words = privateWords(entry);
  const toneFailure = (reason: string, leaked: string[] = [], salvage?: unknown) =>
    new OutputInvalid(reason, { note: correctionNote(reason, words, leaked), salvage });

  if (hasVerseReference(reflection.devotional) || hasVerseReference(reflection.closingPrayer)) {
    return toneFailure("verse_reference");
  }
  const read = [
    reflection.devotional,
    reflection.closingPrayer,
    reflection.title,
    ...reflection.affirmations.flatMap((item) => [item.headline, item.text]),
  ];
  for (const part of read) {
    const id = firstNeverSay(part);
    if (id) return toneFailure(`never_say:${id}`);
  }

  // Last and together: only a reply that passed everything else gets here, so its salvage is safe to keep.
  const titleLeaks = leakedWords(reflection.title, words);
  const headlineLeaks = leakedWords(reflection.affirmations.map((item) => item.headline).join("\n"), words);
  if (titleLeaks.length === 0 && headlineLeaks.length === 0) return null;
  const reason = titleLeaks.length > 0 ? "title_private" : "headline_private";
  return toneFailure(reason, [...titleLeaks, ...headlineLeaks], salvageReflection(reflection, words));
}

// `text` is the model's reply; `context.entry` the words it was written from.
export function parseReflection(text: string, context: ParseContext): Reflection {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return fail("json");
  }
  if (!isRecord(data)) fail("shape");
  if (typeof data.is_crisis !== "boolean") fail("is_crisis");

  // Crisis wins over everything else the model said.
  if (data.is_crisis) return { kind: "crisis" };

  const emotion = (EMOTIONS as readonly string[]).find((item) => item === data.dominant_emotion) as
    | EmotionKey
    | undefined;
  if (!emotion) fail("emotion");

  if (typeof data.reflection_title !== "string") fail("title");
  const title = singleLine(clean(data.reflection_title));
  if (title.length === 0 || title.length > LIMITS.title.maxChars) fail("title");

  const scripture = readScripture(data.scripture);

  if (typeof data.devotional_text !== "string") fail("devotional");
  const devotional = tidyParagraphs(clean(data.devotional_text));
  const devotionalWords = countWords(devotional);
  if (devotionalWords < LIMITS.devotional.minWords || devotionalWords > LIMITS.devotional.maxWords) {
    fail("devotional_words");
  }

  if (typeof data.closing_prayer !== "string") fail("closing_prayer");
  const closingPrayer = finishSentence(removeAmen(tidyParagraphs(clean(data.closing_prayer))));
  const prayerWords = countWords(closingPrayer);
  if (prayerWords < LIMITS.closingPrayer.minWords || prayerWords > LIMITS.closingPrayer.maxWords) {
    fail("closing_prayer_words");
  }

  const reflection: ReadyReflection = {
    kind: "ready",
    emotion,
    title,
    scripture,
    devotional,
    closingPrayer,
    prayer: readPrayer(data.prayer),
    affirmations: readAffirmations(data.affirmations),
    salvaged: null,
  };
  const problem = checkTone(reflection, context.entry);
  if (problem) throw problem;
  // The hook guard (gen-v2.2), last: only a reply that passed every hard check gets here, so it is safe to keep as it is.
  const hook = hookProblem(reflection.devotional, context.recentFirstWords ?? []);
  if (hook) {
    throw new OutputInvalid(hook.reason, { note: hook.note, salvage: { ...reflection, salvaged: hook.reason } });
  }
  return reflection;
}
