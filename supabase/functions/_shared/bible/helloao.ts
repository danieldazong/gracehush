import type { UsfmBookId } from "./books.ts";

// The only code that talks to the Free Use Bible API (bible.helloao.org). It reads the Berean Standard Bible only, as
// the SIMPLIFIED chapter format (docs: bible.helloao.org/docs/reference/translations/simplified.html), where each verse
// is one string with the lines of poetry separated by "\n". The standard format splits a verse into parts with no
// spaces between them, and rebuilding the spacing by hand is how a quotation ends up with a lone closing quote on its
// own line. Read and checked on 2026-10-23 against all 31,086 verses (supabase/functions/_shared/bible/sweep_check.ts).

export const BIBLE_API_BASE = "https://bible.helloao.org/api";
export const TRANSLATION_ID = "BSB";
// Chapters are 5 to 32 KB. A reply far bigger than that is not a chapter.
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_VERSE_NUMBER = 200;
export const CHAPTER_CACHE_SIZE = 64;

// Shortened by the tests.
export const bibleTiming = { requestTimeoutMs: 5_000, retryDelayMs: 500 };

export type VerseText = { text: string; poetic: boolean };

export type ChapterResult =
  | { ok: true; verses: ReadonlyMap<number, VerseText> }
  // NOT_FOUND: the API has no such chapter. TRANSIENT: it could not be reached (after one retry). INVALID: it answered
  // with something that is not the chapter that was asked for.
  | { ok: false; kind: "NOT_FOUND" | "TRANSIENT" | "INVALID" };

// The simplified text is the standard text with the spaces worked out, and for about 1 verse in 90 it worked them out
// wrongly: a word is glued onto the sentence before it ("mountain.Selah", "poor?”declares the LORD", "good.His loving
// devotion"), or a closing mark sits on its own line ("heel.\n”") or after a space ("offspring. ”"). This repairs only
// whitespace: not one letter or mark is added, removed or changed. Proven on every verse of the BSB by sweep_check.ts.
export function tidyVerse(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // No space or line break before a closing mark.
    .replace(/\s+(?=[”’)?!.,;:])/g, "")
    // A word that touches the sentence or the quote before it gets its space.
    .replace(/([.!?;:,)”])(?=\p{L})/gu, "$1 ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The verses of a chapter reply, or null when the reply is not the chapter asked for (another translation, another book
// or chapter, a different shape). A verse with no text counts as absent. Exported for sweep_check.ts and the tests.
export function parseChapter(json: unknown, bookId: UsfmBookId, chapter: number): Map<number, VerseText> | null {
  if (!isRecord(json) || !isRecord(json.translation) || json.translation.id !== TRANSLATION_ID) return null;
  if (!isRecord(json.book) || json.book.id !== bookId) return null;
  const data = json.chapter;
  if (!isRecord(data) || data.number !== chapter || !Array.isArray(data.content)) return null;

  const verses = new Map<number, VerseText>();
  for (const item of data.content) {
    if (!isRecord(item) || item.type !== "verse") continue;
    const { number, text, poem } = item;
    if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > MAX_VERSE_NUMBER) return null;
    if (typeof text !== "string" || verses.has(number)) return null;
    const tidy = tidyVerse(text);
    if (tidy !== "") verses.set(number, { text: tidy, poetic: Array.isArray(poem) && poem.length > 0 });
  }
  return verses.size > 0 ? verses : null;
}

type Attempt =
  | { kind: "json"; json: unknown }
  | { kind: "not_found" }
  | { kind: "invalid" }
  // A dropped connection, our own timeout, a 408, a 429 or a 5xx: worth one more try.
  | { kind: "retry" };

async function requestOnce(url: string): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bibleTiming.requestTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    const discard = () => response.body?.cancel().catch(() => undefined);
    if (response.status === 404) {
      await discard();
      return { kind: "not_found" };
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      await discard();
      return { kind: "retry" };
    }
    if (!response.ok) {
      await discard();
      return { kind: "invalid" };
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
      await discard();
      return { kind: "invalid" };
    }
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) return { kind: "invalid" };
    try {
      return { kind: "json", json: JSON.parse(raw) };
    } catch {
      return { kind: "invalid" };
    }
  } catch {
    return { kind: "retry" };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Chapters never change, so a chapter that was read once is kept for the life of the function instance (least recently
// used out first). Only a good chapter is kept.
const cache = new Map<string, ReadonlyMap<number, VerseText>>();

export function clearChapterCache(): void {
  cache.clear();
}

export async function fetchChapter(bookId: UsfmBookId, chapter: number): Promise<ChapterResult> {
  const key = `${TRANSLATION_ID}/${bookId}/${chapter}`;
  const kept = cache.get(key);
  if (kept) {
    cache.delete(key);
    cache.set(key, kept);
    return { ok: true, verses: kept };
  }

  const url = `${BIBLE_API_BASE}/${TRANSLATION_ID}/${bookId}/${chapter}.simple.json`;
  let attempt = await requestOnce(url);
  if (attempt.kind === "retry") {
    await sleep(bibleTiming.retryDelayMs);
    attempt = await requestOnce(url);
  }
  if (attempt.kind === "retry") return { ok: false, kind: "TRANSIENT" };
  if (attempt.kind === "not_found") return { ok: false, kind: "NOT_FOUND" };
  if (attempt.kind === "invalid") return { ok: false, kind: "INVALID" };

  const verses = parseChapter(attempt.json, bookId, chapter);
  if (!verses) return { ok: false, kind: "INVALID" };
  cache.set(key, verses);
  while (cache.size > CHAPTER_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return { ok: true, verses };
}
