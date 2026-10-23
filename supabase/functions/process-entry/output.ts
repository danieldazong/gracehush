import { isUsfmBookId } from "../_shared/bible/books.ts";
import type { ScriptureRef } from "../_shared/bible/reference.ts";
import {
  EMOTIONS,
  LIMITS,
  MAX_TRANSCRIPT_LENGTH,
  PRAYER_CATEGORIES,
  SCRIPTURE_NUMBER_LIMITS,
  TIME_SLOTS,
} from "./constants.ts";
import type { EmotionKey, PrayerCategory, TimeSlot } from "./contracts.ts";

// The schema guarantees the shape, not the meaning. This checks the model's JSON again, cleans the text the person will
// read and hear, and returns a typed value. Anything out of range is invalid (nothing is truncated): the caller makes
// one more attempt and then answers AI_UNAVAILABLE.

export class OutputInvalid extends Error {
  // A short category for the log. Never the model's words.
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "OutputInvalid";
    this.reason = reason;
  }
}

function fail(reason: string): never {
  throw new OutputInvalid(reason);
}

export type ReadyReflection = {
  kind: "ready";
  // What the model heard, for audio entries. A written entry keeps the person's own text instead.
  transcript: string | null;
  emotion: EmotionKey;
  title: string;
  // Where the passage is. Whether it exists in the Berean Standard Bible is decided afterwards (scripture.ts), not here.
  scripture: ScriptureRef;
  devotional: string;
  closingPrayer: string;
  prayer: { title: string; summary: string; category: PrayerCategory } | null;
  affirmations: { slot: TimeSlot; headline: string; text: string }[];
};

export type Reflection =
  | { kind: "no_speech" }
  | { kind: "crisis"; transcript: string | null }
  | ReadyReflection;

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

// `text` is the model's reply. `kind` is the kind of entry it answered.
export function parseReflection(text: string, kind: "text" | "audio"): Reflection {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return fail("json");
  }
  if (!isRecord(data)) fail("shape");
  if (typeof data.is_crisis !== "boolean") fail("is_crisis");

  let transcript: string | null = null;
  let noSpeech = false;
  if (kind === "audio") {
    if (typeof data.no_speech !== "boolean" || typeof data.transcript !== "string") fail("audio_fields");
    if (data.transcript.length > MAX_TRANSCRIPT_LENGTH) fail("transcript_long");
    noSpeech = data.no_speech;
    transcript = data.transcript.trim() || null;
  }

  // Crisis wins over everything else the model said, and over a contradicting no_speech.
  if (data.is_crisis) return { kind: "crisis", transcript };
  if (noSpeech) return { kind: "no_speech" };
  if (kind === "audio" && transcript === null) fail("transcript_empty");

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

  return {
    kind: "ready",
    transcript,
    emotion,
    title,
    scripture,
    devotional,
    closingPrayer,
    prayer: readPrayer(data.prayer),
    affirmations: readAffirmations(data.affirmations),
  };
}
