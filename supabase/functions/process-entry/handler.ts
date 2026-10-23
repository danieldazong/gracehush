import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { type LogLine, type ScriptureOutcome, shortHash, writeLog } from "../_shared/log.ts";
import { downloadRecording } from "./audio.ts";
import { GEMINI_DEADLINE_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./constants.ts";
import type { ProcessEntryRequest } from "./contracts.ts";
import { type GeminiInput, type GeminiStats, generate, newStats } from "./gemini.ts";
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
import { parseReflection } from "./output.ts";
import { AUDIO_USER_TURN, buildSystemInstruction, PROMPT_VERSION, wrapEntry } from "./prompt.ts";
import { toResponse } from "./response.ts";
import { buildSchema } from "./schema.ts";
import { resolveScripture } from "./scripture.ts";
import { readJsonBody, validateRequest } from "./validate.ts";

// The request flow, top to bottom. Each step that can fail throws an AppError; handle() turns it into the one error
// format. Once an entry is claimed, any failure also marks that entry failed, so the person's text or recording stays
// saved and the same clientEntryId can be sent again.

type Counters = { authMs: number; dbMs: number };

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  inputType: "text" | "audio" | null;
  model: string | null;
  // Every model call of the request adds to this: the reflection's attempts and a replacement passage.
  stats: GeminiStats;
  scripture: ScriptureOutcome | null;
  bibleMs: number;
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

function readGeminiConfig() {
  const model = requireEnv("GEMINI_MODEL");
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(model)) throw new AppError("INTERNAL", "bad_config:GEMINI_MODEL");
  const thinkingLevel = optionalEnv("GEMINI_THINKING_LEVEL") ?? "low";
  if (!["low", "medium", "high"].includes(thinkingLevel)) {
    throw new AppError("INTERNAL", "bad_config:GEMINI_THINKING_LEVEL");
  }
  return { apiKey: requireEnv("GEMINI_API_KEY"), model, thinkingLevel };
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
  // A retry of an entry that already finished costs nothing: no limit, no model call.
  if (existing?.processing_status === "ready") return await respond(context, admin, user.userId, existing);

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const recent = await db(() => countRecentEntries(admin, user.userId, since, existing?.id ?? null));
  if (recent >= RATE_LIMIT_MAX) throw new AppError("RATE_LIMITED", "rate_limit");
  // TODO(22): the free-tier weekly limit goes here, after screening (step 21): 402 LIMIT_REACHED.

  const claim = await db(() => claimEntry(admin, user.userId, input, existing, Date.now()));
  if (claim.kind === "ready") return await respond(context, admin, user.userId, claim.row);
  if (claim.kind === "busy") throw new AppError("ALREADY_PROCESSING", "claim_busy");
  const entryId = claim.row.id;

  try {
    let geminiInput: GeminiInput;
    if (input.inputType === "text") {
      geminiInput = { kind: "text", text: wrapEntry(input.text) };
    } else {
      const bytes = await db(() => downloadRecording(admin, input.audioPath));
      geminiInput = { kind: "audio", bytes, instruction: AUDIO_USER_TURN };
    }

    const kind = input.inputType;
    const deadlineAt = context.startedAt + GEMINI_DEADLINE_MS;
    const reflection = await generate({
      ...gemini,
      system: buildSystemInstruction(kind),
      input: geminiInput,
      schema: buildSchema(kind),
      deadlineAt,
      validate: (text) => parseReflection(text, kind),
    }, context.stats);

    if (reflection.kind === "no_speech") throw new AppError("NO_SPEECH", "no_speech");

    // A written entry keeps the person's own words; a spoken one keeps what the model heard.
    const own = input.inputType === "text" ? input.text : null;

    if (reflection.kind === "crisis") {
      // TODO(21): a dedicated screening call runs before generation and replaces this safety net.
      const row = await db(() => saveCrisisEntry(admin, user.userId, entryId, own ?? reflection.transcript));
      return await respond(context, admin, user.userId, row);
    }

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
        transcript: own ?? reflection.transcript,
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
    // null tokens mean no model call was made (a refusal, or a retry of a finished entry).
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
      model: context.model,
      promptVersion: PROMPT_VERSION,
      tokensIn: called ? context.stats.usage.input : null,
      tokensOut: called ? context.stats.usage.output : null,
      tokensThought: called ? context.stats.usage.thought : null,
      scripture: context.scripture,
      bibleMs: context.bibleMs,
    };
    writeLog(line);
  }
}
