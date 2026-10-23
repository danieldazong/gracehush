import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import {
  type CrisisSource,
  type LogLine,
  type ScreenStatus,
  type ScriptureOutcome,
  shortHash,
  writeLog,
} from "../_shared/log.ts";
import { screenEntry, type ScreenInput, type ScreenResult, screenTiming } from "../_shared/safety/screen.ts";
import { downloadRecording } from "./audio.ts";
import { GEMINI_DEADLINE_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./constants.ts";
import type { ProcessEntryRequest } from "./contracts.ts";
import { GeminiBlocked, type GeminiStats, generate, newStats } from "./gemini.ts";
import {
  claimEntry,
  countRecentEntries,
  ensureProfile,
  type EntryRow,
  failEntry,
  findEntry,
  listAffirmations,
  saveCrisisEntry,
  saveReadyEntry,
} from "./lifecycle.ts";
import { parseReflection, type Reflection } from "./output.ts";
import { buildSystemInstruction, PROMPT_VERSION, wrapEntry } from "./prompt.ts";
import { toResponse } from "./response.ts";
import { buildSchema } from "./schema.ts";
import { resolveScripture } from "./scripture.ts";
import { readJsonBody, validateRequest } from "./validate.ts";

// The request flow, top to bottom. Each step that can fail throws an AppError; handle() turns it into the one error
// format. Once an entry is claimed, any failure also marks that entry failed, so the person's text or recording stays
// saved and the same clientEntryId can be sent again.
//
// The order matters for safety. A crisis screening comes first (_shared/safety): nothing is written for the person, no
// limit is counted and no reflection is asked for until the entry has been screened, and a crisis is answered at once.
// Only an entry the screening called clear is turned into a reflection, from its words alone.

type Counters = { authMs: number; dbMs: number };

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  inputType: "text" | "audio" | null;
  model: string | null;
  // Every model call of the request adds to this: the screening, the reflection's attempts and a replacement passage.
  stats: GeminiStats;
  scripture: ScriptureOutcome | null;
  bibleMs: number;
  screen: ScreenStatus | null;
  screenMs: number;
  screenAttempts: number;
  crisisSource: CrisisSource | null;
  counters: Counters;
};

async function timed<T>(context: Context, bucket: keyof Counters, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context.counters[bucket] += Date.now() - started;
  }
}

const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

function readGeminiConfig() {
  const model = requireEnv("GEMINI_MODEL");
  if (!MODEL_NAME.test(model)) throw new AppError("INTERNAL", "bad_config:GEMINI_MODEL");
  // The crisis screening may use a model of its own; without one it uses the reflection's.
  const screeningModel = optionalEnv("GEMINI_SCREENING_MODEL") ?? model;
  if (!MODEL_NAME.test(screeningModel)) throw new AppError("INTERNAL", "bad_config:GEMINI_SCREENING_MODEL");
  // Optional: a second model that every second attempt of the screening and of the reflection goes to.
  const fallbackModel = optionalEnv("GEMINI_FALLBACK_MODEL");
  if (fallbackModel !== undefined && !MODEL_NAME.test(fallbackModel)) {
    throw new AppError("INTERNAL", "bad_config:GEMINI_FALLBACK_MODEL");
  }
  const thinkingLevel = optionalEnv("GEMINI_THINKING_LEVEL") ?? "low";
  if (!["low", "medium", "high"].includes(thinkingLevel)) {
    throw new AppError("INTERNAL", "bad_config:GEMINI_THINKING_LEVEL");
  }
  return { apiKey: requireEnv("GEMINI_API_KEY"), model, screeningModel, fallbackModel, thinkingLevel };
}

async function respond(
  context: Context,
  admin: ReturnType<typeof createAdmin>,
  userId: string,
  row: EntryRow,
): Promise<Response> {
  const affirmations = row.is_crisis ? [] : await timed(context, "dbMs", () => listAffirmations(admin, userId, row.id));
  return jsonResponse(200, toResponse(row, affirmations), corsHeaders);
}

// Reads the recording if there is one, and screens the entry. The recording's bytes live only inside this function, so
// they are free to be collected before the reflection is written. The screening ends by its own deadline, earlier than
// the request's, so that the reflection always has time after it.
async function screenStage(
  context: Context,
  admin: ReturnType<typeof createAdmin>,
  input: ProcessEntryRequest,
  gemini: ReturnType<typeof readGeminiConfig>,
  deadlineAt: number,
): Promise<ScreenResult> {
  const subject: ScreenInput = input.inputType === "text"
    ? { kind: "text", text: input.text }
    : { kind: "audio", bytes: await timed(context, "dbMs", () => downloadRecording(admin, input.audioPath)) };

  const attemptsBefore = context.stats.attempts;
  const started = Date.now();
  try {
    return await screenEntry(subject, {
      apiKey: gemini.apiKey,
      model: gemini.screeningModel,
      fallbackModel: gemini.fallbackModel,
      thinkingLevel: gemini.thinkingLevel,
      deadlineAt: Math.min(deadlineAt, context.startedAt + screenTiming.deadlineMs),
      stats: context.stats,
    });
  } finally {
    context.screenMs = Date.now() - started;
    context.screenAttempts = context.stats.attempts - attemptsBefore;
  }
}

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");

  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  context.userHash = await shortHash(user.userId);
  const gemini = readGeminiConfig();
  context.model = gemini.model;

  const input: ProcessEntryRequest = validateRequest(await readJsonBody(req), user.userId);
  context.inputType = input.inputType;

  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);

  await db(() => ensureProfile(admin, user.userId));
  const existing = await db(() => findEntry(admin, user.userId, input.clientEntryId));
  // A retry of an entry that already finished costs nothing: no screening, no limit, no model call. A crisis entry that
  // was saved is answered the same way, as the crisis it is.
  if (existing?.processing_status === "ready") return await respond(context, admin, user.userId, existing);

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const recent = await db(() => countRecentEntries(admin, user.userId, since, existing?.id ?? null));
  if (recent >= RATE_LIMIT_MAX) throw new AppError("RATE_LIMITED", "rate_limit");

  const claim = await db(() => claimEntry(admin, user.userId, input, existing, Date.now()));
  if (claim.kind === "ready") return await respond(context, admin, user.userId, claim.row);
  if (claim.kind === "busy") throw new AppError("ALREADY_PROCESSING", "claim_busy");
  const entryId = claim.row.id;

  // A crisis entry keeps only the flag and the person's words. The reply is the same 200 shape as a reflection, built from
  // the saved row, with no devotional, no passage and no affirmations. Nothing is sent to anyone, nothing is waited for,
  // and only the source (one word) reaches the log.
  async function answerCrisis(words: string | null, source: CrisisSource): Promise<Response> {
    context.crisisSource = source;
    const row = await db(() => saveCrisisEntry(admin, user.userId, entryId, words));
    return await respond(context, admin, user.userId, row);
  }

  try {
    const deadlineAt = context.startedAt + GEMINI_DEADLINE_MS;

    // Screen first. No screening answer means no reflection: the entry is failed and can be sent again.
    const screening = await screenStage(context, admin, input, gemini, deadlineAt);
    context.screen = screening.status;
    if (screening.status === "failed") throw new AppError("AI_UNAVAILABLE", `screening_failed:${screening.reason}`);
    if (screening.status === "no_speech") throw new AppError("NO_SPEECH", "no_speech");
    if (screening.status === "crisis") return await answerCrisis(screening.transcript, screening.source);

    // Only a clear screening gets this far, so a crisis can never reach the limit below.
    // TODO(22): the free-tier weekly limit goes here: 402 LIMIT_REACHED. It is checked after the screening, never before.

    // The reflection is written from the screened words alone, never from the recording again.
    const words = screening.transcript;
    let reflection: Reflection;
    try {
      reflection = await generate({
        apiKey: gemini.apiKey,
        model: gemini.model,
        fallbackModel: gemini.fallbackModel,
        thinkingLevel: gemini.thinkingLevel,
        system: buildSystemInstruction(),
        input: { kind: "text", text: wrapEntry(words) },
        schema: buildSchema(),
        deadlineAt,
        validate: parseReflection,
      }, context.stats);
    } catch (error) {
      // The last of the three layers: a request a safety filter blocks is treated as a possible crisis.
      if (error instanceof GeminiBlocked) return await answerCrisis(words, "blocked");
      throw error;
    }
    // ... and so is the model's own flag, even when the screening said clear.
    if (reflection.kind === "crisis") return await answerCrisis(words, "model");

    // The model said where the passage is; the words come from the Bible. If that passage does not exist, one small
    // follow-up request chooses another, and if none can be found the reflection is saved without a passage.
    const scripture = await resolveScripture({
      ref: reflection.scripture,
      title: reflection.title,
      emotion: reflection.emotion,
      gemini,
      deadlineAt,
      stats: context.stats,
    });
    context.scripture = scripture.outcome;
    context.bibleMs = scripture.bibleMs;

    const row = await db(() =>
      saveReadyEntry(admin, user.userId, entryId, {
        transcript: words,
        dominant_emotion: reflection.emotion,
        devotional_title: reflection.title,
        devotional_script: reflection.devotional,
        closing_prayer: reflection.closingPrayer,
        scripture_reference: scripture.reference,
        scripture_text: scripture.text,
        scripture_verified: scripture.verified,
        is_active_prayer: reflection.prayer !== null,
        prayer_title: reflection.prayer?.title ?? null,
        prayer_category: reflection.prayer?.category ?? null,
        prayer_summary: reflection.prayer?.summary ?? null,
      }, reflection.affirmations)
    );
    return await respond(context, admin, user.userId, row);
  } catch (error) {
    const failure = error instanceof AppError
      ? error
      : new AppError("INTERNAL", `unhandled:${error instanceof Error ? error.name : "unknown"}`);
    await failEntry(admin, user.userId, entryId, failure.code);
    throw failure;
  }
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    inputType: null,
    model: null,
    stats: newStats(),
    scripture: null,
    bibleMs: 0,
    screen: null,
    screenMs: 0,
    screenAttempts: 0,
    crisisSource: null,
    counters: { authMs: 0, dbMs: 0 },
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
    // null tokens mean no model call was made (a refusal, a retry of a finished entry, or a phrase that decided alone).
    const called = context.stats.attempts > 0;
    const line: LogLine = {
      requestId: context.requestId,
      status,
      code: failure?.code ?? null,
      reason: failure?.reason ?? null,
      inputType: context.inputType,
      user: context.userHash,
      authMs: context.counters.authMs,
      dbMs: context.counters.dbMs,
      geminiMs: context.stats.ms,
      totalMs: Date.now() - context.startedAt,
      attempts: context.stats.attempts,
      fallbackAttempts: context.stats.fallbackAttempts,
      model: context.model,
      promptVersion: PROMPT_VERSION,
      tokensIn: called ? context.stats.usage.input : null,
      tokensOut: called ? context.stats.usage.output : null,
      tokensThought: called ? context.stats.usage.thought : null,
      scripture: context.scripture,
      bibleMs: context.bibleMs,
      screen: context.screen,
      screenMs: context.screenMs,
      screenAttempts: context.screenAttempts,
      crisisSource: context.crisisSource,
    };
    writeLog(line);
  }
}
