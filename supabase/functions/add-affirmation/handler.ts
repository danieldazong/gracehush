import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { isUsfmBookId } from "../_shared/bible/books.ts";
import { parseReference, type ScriptureRef } from "../_shared/bible/reference.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import { findEntryById } from "../confirm-scripture/lifecycle.ts";
import { AFFIRMATION_LIMIT, LIMITS, SCRIPTURE_NUMBER_LIMITS, TIME_SLOTS } from "../process-entry/constants.ts";
import type { AddAffirmationResponse, TimeSlot } from "../process-entry/contracts.ts";
import { GeminiBlocked, type GeminiStats, generate, newStats } from "../process-entry/gemini.ts";
import { type AffirmationRow, listAffirmations, listRecentAffirmations } from "../process-entry/lifecycle.ts";
import { countWords, curlyApostrophes, OutputInvalid, singleLine, stripMarkup } from "../process-entry/output.ts";
import { toAffirmation } from "../process-entry/response.ts";
import {
  correctionNote,
  firstHeavyNeverSay,
  firstNeverSay,
  hasVerseReference,
  HEADLINE_FEELING_WORDS,
  headlineKey,
  leakedWords,
  privateWords,
  SAFE_HEADLINES,
} from "../process-entry/tone.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import { resolveAffirmationVerses } from "../process-entry/verses.ts";
import { featureAffirmation, insertAffirmation } from "./lifecycle.ts";
import {
  ADD_PROMPT_VERSION,
  buildAddInstruction,
  buildAddSchema,
  buildAddTurn,
  type ListedAffirmation,
} from "./prompt.ts";

// add-affirmation (2026-11-09): one more affirmation for a finished reflection, up to AFFIRMATION_LIMIT (10) in all, written by
// the same rules as the three the reflection was made with (process-entry gen-v2.5) and the heavy rules for a heavy moment. One
// model call writes it from the person's own entry and from what the reflection already says; its verse is read from the Bible
// like every verse (verses.ts, with its one follow-up); the row is inserted at the next position with no lock-screen slot; and
// when the model finds that it fits a time of day better than the affirmation carrying that slot, the migration's
// feature_affirmation moves the slot in one step, so the three slotted affirmations stay the lock-screen set and the phone
// replans the notifications by itself (Realtime). Nothing here counts toward the free week, and nothing is written when no
// usable reply comes: the person is told to try again. The log line is the shared one; its `reason` says what happened in a
// word, and no word of the person's or the model's ever reaches it.

// The model calls of one request end this long after it started, and no single attempt runs longer than the second number;
// the app gives up at 45 seconds (ADD_AFFIRMATION_TIMEOUT_MS). An object so that a test can shorten it.
export const addTiming = { deadlineMs: 40_000, attemptTimeoutMs: 30_000 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  model: string | null;
  stats: GeminiStats;
  bibleMs: number;
  authMs: number;
  dbMs: number;
  // The 200 line's reason: "affirmation:added", with the slot it took over or "feature_failed" after it, and the soft check it was
  // kept in spite of (":salvaged:<reason>"). Never what the model wrote or a word of the person's.
  outcome: string | null;
  // Whether the saved affirmation carries a verse (0 or 1), in the field process-entry uses for its three.
  affirmationVerses: number | null;
};

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

function readGeminiConfig() {
  const model = requireEnv("GEMINI_MODEL");
  if (!MODEL_NAME.test(model)) throw new AppError("INTERNAL", "bad_config:GEMINI_MODEL");
  const fallbackModel = optionalEnv("GEMINI_FALLBACK_MODEL");
  if (fallbackModel !== undefined && !MODEL_NAME.test(fallbackModel)) {
    throw new AppError("INTERNAL", "bad_config:GEMINI_FALLBACK_MODEL");
  }
  const thinkingLevel = optionalEnv("GEMINI_THINKING_LEVEL") ?? "low";
  if (!["low", "medium", "high"].includes(thinkingLevel)) {
    throw new AppError("INTERNAL", "bad_config:GEMINI_THINKING_LEVEL");
  }
  return { apiKey: requireEnv("GEMINI_API_KEY"), model, fallbackModel, thinkingLevel };
}

async function readEntryId(req: Request): Promise<string> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof AppError && error.code === "PAYLOAD_TOO_LARGE") {
      throw new AppError("INVALID_REQUEST", "body_size");
    }
    throw error;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST", "body_shape");
  }
  const { entryId } = body as Record<string, unknown>;
  if (typeof entryId !== "string" || !UUID.test(entryId)) throw new AppError("INVALID_REQUEST", "entry_id");
  return entryId;
}

// ---- The reply -------------------------------------------------------------------------------------------------------------

// What the model wrote, cleaned: the headline and the text, where its verse is (or none, read leniently like process-entry's),
// and the lock-screen slot it says the new affirmation should take over (null for "none" or anything else).
export type ExtraAffirmation = {
  headline: string;
  text: string;
  verse: ScriptureRef | null;
  featured: TimeSlot | null;
  // The soft check the reply was kept in spite of (the most recent salvage), or absent for a clean reply.
  salvaged?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function clean(text: string): string {
  return singleLine(curlyApostrophes(stripMarkup(text)));
}

function readVerse(value: unknown): ScriptureRef | null {
  if (!isRecord(value)) return null;
  const { book_id, chapter, verse_start, verse_end } = value;
  if (!isUsfmBookId(book_id)) return null;
  if (!isCount(chapter, 1, SCRIPTURE_NUMBER_LIMITS.chapter)) return null;
  if (!isCount(verse_start, 1, SCRIPTURE_NUMBER_LIMITS.verse)) return null;
  if (!isCount(verse_end, verse_start, SCRIPTURE_NUMBER_LIMITS.verse)) return null;
  return { bookId: book_id, chapter, verseStart: verse_start, verseEnd: verse_end };
}

function fail(reason: string): never {
  throw new OutputInvalid(reason);
}

// The shape and the cleaning (process-entry output.ts readAffirmations, for one affirmation). A reply outside the hard limits
// is asked for again with no note.
export function readExtra(text: string): ExtraAffirmation {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return fail("json");
  }
  if (!isRecord(data)) fail("shape");
  if (typeof data.headline !== "string" || typeof data.text !== "string") fail("affirmation_text");
  const headline = clean(data.headline).replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
  const body = clean(data.text);
  if (headline.length === 0 || headline.length > LIMITS.affirmationHeadline.maxChars) fail("affirmation_headline");
  if (countWords(headline) > LIMITS.affirmationHeadline.maxWords) fail("affirmation_headline");
  if (body.length === 0 || body.length > LIMITS.affirmationText.maxChars) fail("affirmation_body");
  if (countWords(body) > LIMITS.affirmationText.maxWords) fail("affirmation_body");
  const featured = (TIME_SLOTS as readonly string[]).find((slot) => slot === data.featured_slot) as
    | TimeSlot
    | undefined;
  return { headline, text: body, verse: readVerse(data.verse), featured: featured ?? null };
}

export type CheckContext = {
  // The person's words, for the private-word check.
  entry: string;
  heavy: boolean;
  // The headlines the reflection already has and the person's recent ones: a new one must not repeat them.
  existingHeadlines: readonly string[];
  recentHeadlines: readonly string[];
};

type SoftProblem = { reason: string; note: string; headline?: string };

// The checks process-entry runs on its three affirmations, on this one (output.ts hardProblem, privacyProblem and tone.ts
// headlineProblems). A hard fault (a never-say phrase, a heavy never-say phrase, a verse reference) refuses the reply: it is asked
// for again with a note and never kept. A soft fault (a word from the entry, a feeling word or a repeated headline) costs a retry
// with a note, and the reply is the salvage when no clean one comes: a safe headline for a leak, the model's own otherwise.
export function checkExtra(read: ExtraAffirmation, context: CheckContext): ExtraAffirmation {
  const words = privateWords(context.entry);
  const parts = [read.headline, read.text];
  const hard = (reason: string): never => {
    throw new OutputInvalid(reason, { note: correctionNote(reason, words) });
  };
  if (parts.some(hasVerseReference)) hard("verse_reference");
  for (const part of parts) {
    const id = firstNeverSay(part);
    if (id) hard(`never_say:${id}`);
  }
  if (context.heavy) {
    for (const part of parts) {
      const id = firstHeavyNeverSay(part);
      if (id) hard(`heavy_never_say:${id}`);
    }
  }

  const problems: SoftProblem[] = [];
  const leaks = leakedWords(read.headline, words);
  if (leaks.length > 0) {
    problems.push({
      reason: "headline_private",
      note: correctionNote("headline_private", words, leaks) ?? "",
      headline: SAFE_HEADLINES[read.featured ?? "afternoon"],
    });
  }
  const feeling = read.headline.match(HEADLINE_FEELING_WORDS)?.[0];
  if (feeling) {
    problems.push({
      reason: "headline_feeling",
      note:
        `Your last reply put a feeling word (“${feeling.toLowerCase()}”) in the headline, which a stranger can read on a lock screen. Write the whole reply again, and keep every feeling out of the headline: say the truth the verse holds for them, as "What to write" asks.`,
    });
  }
  const taken = new Set([...context.existingHeadlines, ...context.recentHeadlines].map(headlineKey).filter(Boolean));
  if (taken.has(headlineKey(read.headline))) {
    problems.push({
      reason: "headline_repeated",
      note:
        `Your last reply gave the headline “${read.headline}”, which this person already has. Write the whole reply again with a new headline, written from its own verse and saying a truth none of the listed affirmations says.`,
    });
  }
  if (problems.length === 0) return read;
  const safe = problems.find((problem) => problem.headline !== undefined)?.headline;
  const salvage: ExtraAffirmation = {
    ...read,
    headline: safe ?? read.headline,
    salvaged: problems[0].reason,
  };
  throw new OutputInvalid(problems[0].reason, {
    note: problems.map((problem) => problem.note).filter(Boolean).join("\n\n"),
    salvage,
  });
}

function slotOf(row: AffirmationRow): TimeSlot | null {
  return (TIME_SLOTS as readonly string[]).includes(String(row.time_slot)) ? row.time_slot as TimeSlot : null;
}

// ---- The request -----------------------------------------------------------------------------------------------------------

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");

  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  context.userHash = await shortHash(user.userId);
  const gemini = readGeminiConfig();
  context.model = gemini.model;
  const entryId = await readEntryId(req);

  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);

  // Another person's entry looks exactly like one that does not exist. A reflection still being made is busy; one that failed,
  // or a heavy moment saved before 2026-11-08 (words only), has no reflection to add to.
  const row = await db(() => findEntryById(admin, user.userId, entryId));
  if (!row) throw new AppError("NOT_FOUND", "entry_not_found");
  if (row.processing_status === "processing") throw new AppError("ALREADY_PROCESSING", "entry_processing");
  if (row.processing_status !== "ready" || row.devotional_script === null) {
    throw new AppError("NOT_FOUND", "entry_not_ready");
  }

  const existing = await db(() => listAffirmations(admin, user.userId, row.id));
  if (existing.length >= AFFIRMATION_LIMIT) throw new AppError("AFFIRMATION_LIMIT", "affirmation_limit");

  // The person's newest affirmations of other reflections, whose headlines and verses the new one must not repeat. A read that
  // fails means nothing to compare with, never a failed request.
  const recent = await listRecentAffirmations(admin, user.userId, row.id).catch(() => []);

  const heavy = row.is_crisis;
  const words = row.transcript ?? "";
  const listed: ListedAffirmation[] = existing.map((item) => ({
    slot: slotOf(item),
    headline: item.headline,
    verseReference: item.verse_reference ?? null,
  }));
  const passage = row.scripture_reference ? parseReference(row.scripture_reference) : null;
  const deadlineAt = context.startedAt + addTiming.deadlineMs;

  let extra: ExtraAffirmation;
  try {
    extra = await generate<ExtraAffirmation>({
      apiKey: gemini.apiKey,
      model: gemini.model,
      fallbackModel: gemini.fallbackModel,
      thinkingLevel: gemini.thinkingLevel,
      system: buildAddInstruction(),
      input: {
        kind: "text",
        text: buildAddTurn({
          entry: words,
          title: row.devotional_title ?? "",
          emotion: row.dominant_emotion ?? "",
          passage: row.scripture_reference,
          existing: listed,
          heavy,
        }),
      },
      schema: buildAddSchema(),
      deadlineAt,
      attemptTimeoutMs: addTiming.attemptTimeoutMs,
      validate: (reply) =>
        checkExtra(readExtra(reply), {
          entry: words,
          heavy,
          existingHeadlines: listed.map((item) => item.headline),
          recentHeadlines: recent.map((item) => item.headline),
        }),
    }, context.stats);
  } catch (error) {
    // A request a safety filter blocks is no affirmation: nothing is written, and the person can try again.
    if (error instanceof GeminiBlocked) throw new AppError("AI_UNAVAILABLE", "blocked");
    throw error;
  }

  // Its verse, read from the Bible like every verse (verses.ts): never the reflection's passage, never one the reflection or the
  // person's recent reflections already carry; one that breaks a rule costs one small follow-up, and one still unusable leaves the
  // affirmation without one. The resolver names affirmations by slot, so the new one borrows the slot it may take over (or
  // "morning") as a label only.
  const verses = await resolveAffirmationVerses({
    affirmations: [{
      slot: extra.featured ?? "morning",
      headline: extra.headline,
      text: extra.text,
      verse: extra.verse,
    }],
    passage,
    recent: [
      ...existing.flatMap((item) => (item.verse_reference ? [item.verse_reference] : [])),
      ...recent.flatMap((item) => (item.verse_reference ? [item.verse_reference] : [])),
    ],
    heavy,
    title: row.devotional_title ?? "",
    emotion: row.dominant_emotion ?? "",
    gemini: { apiKey: gemini.apiKey, model: gemini.model, thinkingLevel: gemini.thinkingLevel },
    deadlineAt,
    stats: context.stats,
  });
  context.bibleMs = verses.bibleMs;
  const verse = verses.verses[0] ?? null;

  const position = Math.max(existing.length, ...existing.map((item) => Number(item.position ?? 0))) + 1;
  const saved = await db(() =>
    insertAffirmation(admin, {
      user_id: user.userId,
      entry_id: row.id,
      time_slot: null,
      position,
      headline: extra.headline,
      affirmation_text: extra.text,
      verse_reference: verse?.reference ?? null,
      verse_text: verse?.text ?? null,
    })
  );
  context.affirmationVerses = verse === null ? 0 : 1;

  // The slot move is best effort: the affirmation is saved either way, and a move that failed leaves the lock screen as it was.
  let outcome = "affirmation:added";
  if (extra.featured !== null) {
    const slot = extra.featured;
    try {
      await db(() => featureAffirmation(admin, row.id, saved.id, slot));
      outcome = `affirmation:added:${slot}`;
    } catch {
      outcome = "affirmation:added:feature_failed";
    }
  }
  context.outcome = extra.salvaged ? `${outcome}:salvaged:${extra.salvaged}` : outcome;

  const rows = await db(() => listAffirmations(admin, user.userId, row.id));
  const body: AddAffirmationResponse = { affirmations: rows.map(toAffirmation) };
  return jsonResponse(200, body, corsHeaders);
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    model: null,
    stats: newStats(),
    bibleMs: 0,
    authMs: 0,
    dbMs: 0,
    outcome: null,
    affirmationVerses: null,
  };
  let status = 200;
  let failure: AppError | null = null;
  try {
    if (req.method === "OPTIONS") {
      status = 204;
      return preflightResponse();
    }
    const response = await run(req, context);
    status = response.status;
    return response;
  } catch (error) {
    failure = error instanceof AppError
      ? error
      : new AppError("INTERNAL", `unhandled:${error instanceof Error ? error.name : "unknown"}`);
    status = failure.status;
    return errorResponse(failure, context.requestId, corsHeaders);
  } finally {
    // The shared line (process-entry's), with the fields that do not apply left empty. null tokens mean no model call was made.
    const called = context.stats.attempts > 0;
    writeLog(blankLogLine({
      requestId: context.requestId,
      status,
      code: failure?.code ?? null,
      reason: failure?.reason ?? context.outcome,
      user: context.userHash,
      authMs: context.authMs,
      dbMs: context.dbMs,
      geminiMs: context.stats.ms,
      totalMs: Date.now() - context.startedAt,
      attempts: context.stats.attempts,
      fallbackAttempts: context.stats.fallbackAttempts,
      model: context.model,
      promptVersion: ADD_PROMPT_VERSION,
      tokensIn: called ? context.stats.usage.input : null,
      tokensOut: called ? context.stats.usage.output : null,
      tokensThought: called ? context.stats.usage.thought : null,
      bibleMs: context.bibleMs,
      affirmationVerses: context.affirmationVerses,
    }));
  }
}
