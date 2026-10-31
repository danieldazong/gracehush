import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { readBillingConfig, syncSubscription } from "../_shared/billing/revenuecat.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { checkDevotionalLimit, type LimitDecision, type LimitProfile } from "../_shared/limits/weekly.ts";
import {
  type BillingStatus,
  type CrisisSource,
  type LimitStatus,
  type LogLine,
  type ScreenStatus,
  type ScriptureOutcome,
  shortHash,
  type SpeechStatus,
  writeLog,
} from "../_shared/log.ts";
import { screenEntry, type ScreenInput, type ScreenResult, screenTiming } from "../_shared/safety/screen.ts";
import { readTtsConfig } from "../_shared/tts/config.ts";
import { downloadRecording } from "./audio.ts";
import { EXPIRY_CHECK, GEMINI_DEADLINE_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./constants.ts";
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
  listRecentReflections,
  needsSpeech,
  readProfile,
  type RecentReflectionRow,
  saveCrisisEntry,
  saveReadyEntry,
  saveTranscript,
  type StoredProfile,
} from "./lifecycle.ts";
import { parseReflection, type Reflection } from "./output.ts";
import { firstWord } from "./tone.ts";
import { buildSystemInstruction, buildUserTurn, PROMPT_VERSION, type RecentReflection } from "./prompt.ts";
import { toResponse } from "./response.ts";
import { buildSchema } from "./schema.ts";
import { resolveScripture } from "./scripture.ts";
import { type SpeechOutcome, speechStage } from "./speech.ts";
import { readJsonBody, validateRequest } from "./validate.ts";

// The request flow, top to bottom. Each step that can fail throws an AppError; handle() turns it into the one error
// format. Once an entry is claimed, any failure also marks that entry failed, so the person's text or recording stays
// saved and the same clientEntryId can be sent again. The exception is an entry that has been saved: from then on nothing
// marks it failed, whatever goes wrong while the answer is built.
//
// The order matters for safety. A crisis screening comes first (_shared/safety): nothing is written for the person, no
// limit is counted and no reflection is asked for until the entry has been screened, and a crisis is answered at once.
// Only an entry the screening called clear meets the free tier's limit (a crisis is therefore never counted and never
// blocked) and is turned into a reflection, from its words alone. Speech comes last and is best effort: a reflection that
// was saved is never lost to it.

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
  tts: SpeechStatus | null;
  ttsMs: number;
  ttsAttempts: number;
  ttsChars: number;
  audioMs: number | null;
  limit: LimitStatus | null;
  limitUsed: number | null;
  billing: BillingStatus | null;
  billingMs: number;
  // "salvaged:title_private" or "salvaged:headline_private" when the reflection was saved with a safe title or headline
  // (step 32). It is the 200 line's `reason`: one word, never what the model wrote or a word of the person's.
  salvaged: string | null;
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

// What the speech step did goes into the request's log line, one word and the numbers.
function recordSpeech(context: Context, outcome: SpeechOutcome): void {
  context.tts = outcome.tts;
  context.ttsMs = outcome.ttsMs;
  context.ttsAttempts = outcome.ttsAttempts;
  context.ttsChars = outcome.ttsChars;
  context.audioMs = outcome.audioMs;
}

function limitStatus(decision: LimitDecision): LimitStatus {
  if (decision.kind === "exempt") return "exempt";
  const word = decision.allowed ? "free_ok" : "free_blocked";
  return decision.zoneFallback ? `${word}:bad_timezone` : word;
}

// Reads the recording if there is one, and screens the entry. The recording's bytes live only inside this function, so
// they are free to be collected before the reflection is written. The screening ends by its own deadline, earlier than
// the request's, so that the reflection always has time after it.
//
// A recording that the free limit held back has the words the screening heard saved on its entry (`savedWords`). Sent
// again, it is screened from those words as written text: the recording is not downloaded and not transcribed a second time.
// The expiry guard (step 30). A trial or Pro row whose end date has passed is read again from RevenueCat, once and briefly,
// so a plan that lapsed while no webhook arrived is not a free pass. RevenueCat that cannot be read, or billing that is not set
// up, leaves the stored plan: a paying person is never blocked by an outage. A row with no end date (from before step 30, or a
// lifetime grant) is left as it is, and so is a free one.
async function confirmPaidPlan(
  context: Context,
  admin: ReturnType<typeof createAdmin>,
  userId: string,
  profile: StoredProfile,
): Promise<LimitProfile> {
  const ends = profile.expiresAt === null ? NaN : Date.parse(profile.expiresAt);
  if (profile.tier === "free" || !Number.isFinite(ends) || ends > Date.now()) return profile;
  const config = readBillingConfig(optionalEnv);
  if (!config.ok) {
    context.billing = "off";
    return profile;
  }
  const started = Date.now();
  const synced = await syncSubscription(admin, config.apiKey, userId, new Date(), EXPIRY_CHECK);
  context.billingMs = Date.now() - started;
  if (!synced.ok) {
    context.billing = `failed:${synced.reason}`;
    return profile;
  }
  context.billing = "synced";
  return { ...profile, tier: synced.plan.tier };
}

async function screenStage(
  context: Context,
  admin: ReturnType<typeof createAdmin>,
  input: ProcessEntryRequest,
  savedWords: string | null,
  gemini: ReturnType<typeof readGeminiConfig>,
  deadlineAt: number,
): Promise<ScreenResult> {
  const subject: ScreenInput = input.inputType === "text"
    ? { kind: "text", text: input.text }
    : savedWords !== null && savedWords.trim() !== ""
    ? { kind: "text", text: savedWords }
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

  // Speech is optional and this never throws: with no secrets set it is simply off, a half-set or malformed secret is
  // logged by name, and a reflection is made and saved as text either way.
  const speech = readTtsConfig(optionalEnv);

  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);

  // An entry that already finished is answered as it is. The one exception is a reflection that has its devotional and no
  // audio, when speech is on: then the same request adds the audio, and only that (no screening, no limit, no model
  // call). A crisis entry is always answered as it is.
  async function answerReady(row: EntryRow): Promise<Response> {
    if (speech.state !== "ready" || !needsSpeech(row)) return await respond(context, admin, user.userId, row);
    const outcome = await speechStage({
      admin,
      userId: user.userId,
      row,
      setup: speech,
      startedAt: context.startedAt,
      db,
    });
    recordSpeech(context, outcome);
    return await respond(context, admin, user.userId, outcome.row);
  }

  await db(() => ensureProfile(admin, user.userId));
  const existing = await db(() => findEntry(admin, user.userId, input.clientEntryId));
  // A retry of an entry that already finished costs nothing: no screening, no limit, no model call, no rate limit.
  if (existing?.processing_status === "ready") return await answerReady(existing);

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const recent = await db(() => countRecentEntries(admin, user.userId, since, existing?.id ?? null));
  if (recent >= RATE_LIMIT_MAX) throw new AppError("RATE_LIMITED", "rate_limit");

  const claim = await db(() => claimEntry(admin, user.userId, input, existing, Date.now()));
  if (claim.kind === "ready") return await answerReady(claim.row);
  if (claim.kind === "busy") throw new AppError("ALREADY_PROCESSING", "claim_busy");
  const entryId = claim.row.id;

  // True once the entry has been saved as a reflection or as a crisis. From then on the catch below never marks it failed:
  // a database that hiccups while the answer is built answers a plain 500, and the entry stays as it was saved (the same
  // request sent again answers it from its saved row).
  let saved = false;

  // A crisis entry keeps only the flag and the person's words. The reply is the same 200 shape as a reflection, built from
  // the saved row, with no devotional, no passage and no affirmations. Nothing is sent to anyone, nothing is waited for,
  // and only the source (one word) reaches the log. It gets no speech and is never counted or blocked by the limit.
  async function answerCrisis(words: string | null, source: CrisisSource): Promise<Response> {
    context.crisisSource = source;
    const row = await db(() => saveCrisisEntry(admin, user.userId, entryId, words));
    saved = true;
    return await respond(context, admin, user.userId, row);
  }

  try {
    const deadlineAt = context.startedAt + GEMINI_DEADLINE_MS;

    // Screen first. No screening answer means no reflection: the entry is failed and can be sent again.
    const screening = await screenStage(context, admin, input, claim.row.transcript, gemini, deadlineAt);
    context.screen = screening.status;
    if (screening.status === "failed") throw new AppError("AI_UNAVAILABLE", `screening_failed:${screening.reason}`);
    if (screening.status === "no_speech") throw new AppError("NO_SPEECH", "no_speech");
    if (screening.status === "crisis") return await answerCrisis(screening.transcript, screening.source);

    // The reflection is written from the screened words alone, never from the recording again.
    const words = screening.transcript;

    // The person's last reflections (their titles, openings and passages, never their words), read while the profile and the
    // limit are, so that the model can vary its title, its opening and its passage (step 32). A read that fails means no block,
    // never a failed reflection, and its time is not part of dbMs.
    const recentReflections = listRecentReflections(admin, user.userId, entryId, claim.row.created_at)
      .catch((): RecentReflectionRow[] => []);

    // The free tier's limit. Only a clear screening gets this far, so a crisis is never counted and never blocked. An entry
    // over the limit is saved as failed with LIMIT_REACHED (the catch below does that) and answered with a 402 that carries
    // the entry and the week's numbers; sent again after an upgrade or when the week turns, it is claimed and checked again.
    const stored = await db(() => readProfile(admin, user.userId));
    const profile = await confirmPaidPlan(context, admin, user.userId, stored);
    const decision = await db(() => checkDevotionalLimit(admin, user.userId, profile, claim.row));
    context.limit = limitStatus(decision);
    context.limitUsed = decision.kind === "free" ? decision.used : null;
    if (decision.kind === "free" && !decision.allowed) {
      // A recording keeps the words that were heard in it, so that sending it again does not start from the recording.
      if (input.inputType === "audio") await db(() => saveTranscript(admin, user.userId, entryId, words));
      throw new AppError("LIMIT_REACHED", "free_limit", {
        entryId,
        usage: { used: decision.used, limit: decision.limit, resetsAt: decision.resetsAt },
      });
    }

    const recent: RecentReflection[] = (await recentReflections).map((row) => ({
      title: row.devotional_title,
      devotional: row.devotional_script,
      reference: row.scripture_reference,
    }));

    let reflection: Reflection;
    try {
      reflection = await generate({
        apiKey: gemini.apiKey,
        model: gemini.model,
        fallbackModel: gemini.fallbackModel,
        thinkingLevel: gemini.thinkingLevel,
        system: buildSystemInstruction(),
        input: { kind: "text", text: buildUserTurn(words, recent) },
        schema: buildSchema(),
        deadlineAt,
        // The hook guard compares the new opening with the first words the recent devotionals began with.
        validate: (reply) =>
          parseReflection(reply, {
            entry: words,
            recentFirstWords: recent.flatMap((item) => (item.devotional ? [firstWord(item.devotional)] : [])),
          }),
      }, context.stats);
    } catch (error) {
      // The last of the three layers: a request a safety filter blocks is treated as a possible crisis.
      if (error instanceof GeminiBlocked) return await answerCrisis(words, "blocked");
      throw error;
    }
    // ... and so is the model's own flag, even when the screening said clear.
    if (reflection.kind === "crisis") return await answerCrisis(words, "model");
    // A reflection kept with a safe title or headline is saved like any other, and its log line says so.
    if (reflection.salvaged) context.salvaged = `salvaged:${reflection.salvaged}`;

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
    saved = true;

    // Speech, best effort, from the row that was just saved. It never throws and never changes the status.
    const outcome = await speechStage({
      admin,
      userId: user.userId,
      row,
      setup: speech,
      startedAt: context.startedAt,
      db,
    });
    recordSpeech(context, outcome);
    return await respond(context, admin, user.userId, outcome.row);
  } catch (error) {
    const failure = error instanceof AppError
      ? error
      : new AppError("INTERNAL", `unhandled:${error instanceof Error ? error.name : "unknown"}`);
    if (!saved) await failEntry(admin, user.userId, entryId, failure.code);
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
    tts: null,
    ttsMs: 0,
    ttsAttempts: 0,
    ttsChars: 0,
    audioMs: null,
    limit: null,
    limitUsed: null,
    billing: null,
    billingMs: 0,
    salvaged: null,
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
      reason: failure?.reason ?? context.salvaged,
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
      tts: context.tts,
      ttsMs: context.ttsMs,
      ttsAttempts: context.ttsAttempts,
      ttsChars: context.ttsChars,
      audioMs: context.audioMs,
      limit: context.limit,
      limitUsed: context.limitUsed,
      billing: context.billing,
      billingMs: context.billingMs,
      billingEvent: null,
      account: null,
      accountEntries: null,
      accountFiles: null,
      accountLeftOut: null,
      accountBytes: null,
    };
    writeLog(line);
  }
}
