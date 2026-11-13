import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { confirmPaidPlan } from "../_shared/billing/expiry.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { checkDevotionalLimit, type LimitDecision } from "../_shared/limits/weekly.ts";
import {
  type BillingStatus,
  blankLogLine,
  type CrisisSource,
  type LimitStatus,
  type LogLine,
  type PrayerVoiceStatus,
  type ScreenStatus,
  type ScriptureOutcome,
  shortHash,
  type SpeechStatus,
  type ValidationLineStatus,
  writeLog,
} from "../_shared/log.ts";
import { screenEntry, type ScreenInput, type ScreenResult, screenTiming } from "../_shared/safety/screen.ts";
import { readTtsConfig } from "../_shared/tts/config.ts";
import { downloadRecording } from "./audio.ts";
import { GEMINI_DEADLINE_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./constants.ts";
import type { HelpKind, ProcessEntryRequest } from "./contracts.ts";
import { GeminiBlocked, type GeminiStats, generate, newStats } from "./gemini.ts";
import { heavyFallback } from "./heavy.ts";
import {
  claimEntry,
  countRecentEntries,
  ensureProfile,
  type EntryRow,
  failEntry,
  findEntry,
  listAffirmations,
  listRecentAffirmations,
  listRecentReflections,
  needsSpeech,
  readProfile,
  type RecentAffirmationRow,
  type RecentReflectionRow,
  saveReadyEntry,
  saveTranscript,
} from "./lifecycle.ts";
import { checkReflection, readReflection, type Reflection } from "./output.ts";
import { firstWord, groundingCount, prayerVoice } from "./tone.ts";
import { buildSystemInstruction, buildUserTurn, PROMPT_VERSION, type RecentReflection } from "./prompt.ts";
import { toResponse } from "./response.ts";
import { buildSchema } from "./schema.ts";
import { resolveScripture } from "./scripture.ts";
import { planSpeech, type SpeechJob, speechStage } from "./speech.ts";
import { resolveAffirmationVerses } from "./verses.ts";
import { readJsonBody, validateRequest } from "./validate.ts";

// The request flow, top to bottom. Each step that can fail throws an AppError; handle() turns it into the one error
// format. Once an entry is claimed, any failure also marks that entry failed, so the person's text or recording stays
// saved and the same clientEntryId can be sent again. The exception is an entry that has been saved: from then on nothing
// marks it failed, whatever goes wrong while the answer is built.
//
// The order matters for safety. A crisis screening comes first (_shared/safety): nothing is written for the person, no
// limit is counted and no reflection is asked for until the entry has been screened. Only an entry the screening called
// clear meets the free tier's limit. An entry it found a risk in is a heavy moment (gen-v2.4, heavy.ts, the owner's decision of
// 2026-11-08): it is never counted and never blocked, and it is written in full by the instruction's "A heavy moment", from its
// words alone. A heavy moment is never failed for want of a reply: when the model cannot write one (a safety filter blocks the
// request, a recording was blocked before its words were read, or no usable reply comes in time) it gets the written
// fallback. Speech comes last and is best effort: a reflection that was saved is never lost to it, and since 2026-11-09 it
// runs behind the answer (EdgeRuntime.waitUntil), so the person has the reflection the moment it is saved.

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
  // "salvaged:<check>" when the reflection was saved after a soft check still failed on the last try (step 32: a safe title or
  // headline, the hook; step 36: the prayer's voice, grounding, the line, the echo), and "fallback:<why>" when a heavy moment got
  // the written fallback (gen-v2.4: no_words, blocked or unwritten). It is the 200 line's `reason`: one word, never what the
  // model wrote or a word of the person's.
  salvaged: string | null;
  // Step 36, set once a reflection is saved: the shared content stems as a count, the prayer's voice, the line's source.
  grounding: number | null;
  prayerVoice: PrayerVoiceStatus | null;
  validationLine: ValidationLineStatus | null;
  // gen-v2.5 (step 37), set once a reflection is saved: how many of its three affirmations carry a verse.
  affirmationVerses: number | null;
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
  const affirmations = await timed(context, "dbMs", () => listAffirmations(admin, userId, row.id));
  return jsonResponse(200, toResponse(row, affirmations), corsHeaders);
}

// Supabase's Edge Runtime keeps the instance alive for work handed to EdgeRuntime.waitUntil after the answer has gone out
// (its "Background Tasks"). Plain Deno (the tests, a local run) has no EdgeRuntime: the work then runs detached, and a test
// awaits it through the fake it installs. What is handed over never rejects.
type EdgeRuntimeLike = { waitUntil?: (promise: Promise<unknown>) => void };

function runInBackground(work: Promise<void>): void {
  const guarded = work.catch(() => undefined);
  (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime?.waitUntil?.(guarded);
}

// The speech stage behind an answer (2026-11-09), and the line it writes when it is done: the same request id, the reason
// "speech", the stage's word and numbers, its database time and the time since the request began; everything else empty.
async function speakBehind(context: Context, job: Omit<SpeechJob, "db">): Promise<void> {
  let dbMs = 0;
  const outcome = await speechStage({
    ...job,
    db: async <T>(work: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        return await work();
      } finally {
        dbMs += Date.now() - started;
      }
    },
  });
  writeLog(blankLogLine({
    requestId: context.requestId,
    status: 200,
    reason: "speech",
    inputType: context.inputType,
    user: context.userHash,
    dbMs,
    totalMs: Date.now() - context.startedAt,
    tts: outcome.tts,
    ttsMs: outcome.ttsMs,
    ttsAttempts: outcome.ttsAttempts,
    ttsChars: outcome.ttsChars,
    audioMs: outcome.audioMs,
  }));
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

  // Answers with the row as it is and, when there is a spoken devotional to make, makes it behind the answer (2026-11-09):
  // the person has the reflection the moment it is saved, and the audio lands on the row about fifteen seconds later (the
  // app shows "Preparing your audio" meanwhile and learns of it through Realtime, or by reading the entry again). The
  // request's own log line says "background" then, and the stage writes a line of its own when it is done; when nothing
  // will be read aloud (speech off, a half-set secret, no time left) the line says why, as before.
  function speakThenRespond(row: EntryRow): Promise<Response> {
    const plan = planSpeech(row, speech, context.startedAt);
    if (plan.kind === "skip") {
      context.tts = plan.tts;
    } else {
      context.tts = "background";
      runInBackground(
        speakBehind(context, { admin, userId: user.userId, row, setup: speech, startedAt: context.startedAt }),
      );
    }
    return respond(context, admin, user.userId, row);
  }

  // An entry that already finished is answered as it is. The one exception is a reflection that has its devotional and no
  // audio, when speech is on: then the same request adds the audio behind the answer, and only that (no screening, no
  // limit, no model call). A heavy moment saved before 2026-11-08 has no devotional, so it is always answered as it is.
  async function answerReady(row: EntryRow): Promise<Response> {
    if (speech.state !== "ready" || !needsSpeech(row)) return await respond(context, admin, user.userId, row);
    return await speakThenRespond(row);
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

  // True once the entry has been saved as a reflection. From then on the catch below never marks it failed: a database that
  // hiccups while the answer is built answers a plain 500, and the entry stays as it was saved (the same request sent again
  // answers it from its saved row).
  let saved = false;

  try {
    const deadlineAt = context.startedAt + GEMINI_DEADLINE_MS;

    // Screen first. No screening answer means no reflection: the entry is failed and can be sent again.
    const screening = await screenStage(context, admin, input, claim.row.transcript, gemini, deadlineAt);
    context.screen = screening.status;
    if (screening.status === "failed") throw new AppError("AI_UNAVAILABLE", `screening_failed:${screening.reason}`);
    if (screening.status === "no_speech") throw new AppError("NO_SPEECH", "no_speech");

    // A heavy moment (gen-v2.4): the screening found a risk to the person. Its source (one word) reaches the log, and nothing
    // else of the screening's answer does.
    let heavy = screening.status === "crisis";
    if (screening.status === "crisis") context.crisisSource = screening.source;
    // Which help line a heavy moment shows (helpKind.ts, 2026-11-11): the screening's choice, saved as one word with the
    // reflection. A heavy moment the screening did not find (the writer's own flag, a blocked reflection) shows the 988 line.
    const helpLine: HelpKind = screening.status === "crisis" ? screening.help : "crisis";

    // The reflection is written from the screened words alone, never from the recording again. A recording a safety filter
    // blocked before its words were read has none, and gets the written fallback.
    const words = screening.transcript;

    // The person's last ten reflections, read while the profile and the limit are, so that the model can vary its title, its
    // first word and its passage (step 32). Since step 36 only their first words, their titles' main words and their passages
    // reach the model, after the entry (prompt.ts), never a sentence they said and never the person's words. A read that fails
    // means no block, never a failed reflection, and its time is not part of dbMs.
    const recentReflections = words === null
      ? Promise.resolve<RecentReflectionRow[]>([])
      : listRecentReflections(admin, user.userId, entryId, claim.row.created_at)
        .catch((): RecentReflectionRow[] => []);
    // gen-v2.5 (step 37): beside it, the person's newest affirmations, whose headlines and verses a new reflection must not
    // repeat. A read that fails means nothing to compare with, never a failed reflection.
    const recentAffirmations = words === null
      ? Promise.resolve<RecentAffirmationRow[]>([])
      : listRecentAffirmations(admin, user.userId, entryId).catch((): RecentAffirmationRow[] => []);

    // The free tier's limit. Only a clear screening meets it, so a heavy moment is never counted and never blocked. An entry
    // over the limit is saved as failed with LIMIT_REACHED (the catch below does that) and answered with a 402 that carries
    // the entry and the week's numbers; sent again after an upgrade or when the week turns, it is claimed and checked again.
    if (!heavy && words !== null) {
      const stored = await db(() => readProfile(admin, user.userId));
      // The expiry guard (step 30, _shared/billing/expiry.ts since step 38).
      const confirmed = await confirmPaidPlan(admin, user.userId, stored);
      context.billing = confirmed.billing;
      context.billingMs = confirmed.billingMs;
      const profile = confirmed.profile;
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
    }

    const recent: RecentReflection[] = (await recentReflections).map((row) => ({
      title: row.devotional_title,
      devotional: row.devotional_script,
      reference: row.scripture_reference,
    }));
    const recentAffirmed = await recentAffirmations;
    const recentVerses = recentAffirmed.flatMap((row) => (row.verse_reference ? [row.verse_reference] : []));

    // The reflection. For a heavy moment the user turn says so (a <heavy_moment> block) and the heavy rules check the reply. The
    // last of the three layers is the model's own: a reply it flags is a heavy moment even when the screening said clear (its
    // reply was already checked by the heavy rules), and a request a safety filter blocks is treated as one.
    let reflection: Reflection | null = null;
    let fallbackWhy: "no_words" | "blocked" | "unwritten" | null = words === null ? "no_words" : null;
    if (words !== null) {
      // Set when any reply flagged a heavy moment, so a reply that then fails its checks still ends as one (the fallback).
      let flagged = false;
      try {
        reflection = await generate({
          apiKey: gemini.apiKey,
          model: gemini.model,
          fallbackModel: gemini.fallbackModel,
          thinkingLevel: gemini.thinkingLevel,
          system: buildSystemInstruction(),
          input: { kind: "text", text: buildUserTurn(words, recent, heavy, recentVerses) },
          schema: buildSchema(),
          deadlineAt,
          // The hook guard compares the new opening with the first words the recent devotionals began with.
          validate: (reply) => {
            const read = readReflection(reply);
            if (read.heavy) flagged = true;
            return checkReflection(read, {
              entry: words,
              heavy,
              recentFirstWords: recent.flatMap((item) => (item.devotional ? [firstWord(item.devotional)] : [])),
              recentHeadlines: recentAffirmed.map((row) => row.headline),
            });
          },
        }, context.stats);
      } catch (error) {
        if (error instanceof GeminiBlocked) {
          fallbackWhy = "blocked";
          heavy = true;
          context.crisisSource ??= "blocked";
        } else if (error instanceof AppError && (heavy || flagged)) {
          // A heavy moment is never failed for want of a reply.
          fallbackWhy = "unwritten";
          heavy = true;
          context.crisisSource ??= "model";
        } else {
          throw error;
        }
      }
      if (reflection?.heavy && !heavy) {
        heavy = true;
        context.crisisSource = "model";
      }
    }
    if (reflection === null) {
      reflection = heavyFallback();
      context.salvaged = `fallback:${fallbackWhy ?? "unwritten"}`;
    } else if (reflection.salvaged) {
      // A reflection kept after a soft check is saved like any other, and its log line says so.
      context.salvaged = `salvaged:${reflection.salvaged}`;
    }
    const fromModel = fallbackWhy === null;

    // The model said where the passage is; the words come from the Bible. If that passage does not exist (or, for a heavy
    // moment, is one a heavy moment never gets), one small follow-up request chooses another, and if none can be found the
    // reflection is saved without a passage (a heavy moment with the fallback's).
    const scripture = await resolveScripture({
      ref: reflection.scripture,
      title: reflection.title,
      emotion: reflection.emotion,
      gemini,
      deadlineAt,
      stats: context.stats,
      heavy,
    });
    context.scripture = scripture.outcome;
    context.bibleMs = scripture.bibleMs;

    // gen-v2.5 (step 37): each affirmation's verse, read from the Bible like the passage (verses.ts). A verse that cannot be
    // used costs one small follow-up request for all of them; one still unusable leaves its affirmation without a verse. The
    // written fallback names none, so nothing is read or asked for it (an affirmation without a verse costs no follow-up).
    const affirmationVerses = await resolveAffirmationVerses({
      affirmations: reflection.affirmations,
      passage: scripture.ref,
      recent: [
        ...recent.flatMap((item) => (item.reference ? [item.reference] : [])),
        ...recentVerses,
      ],
      heavy,
      title: reflection.title,
      emotion: reflection.emotion,
      gemini,
      deadlineAt,
      stats: context.stats,
    });
    context.bibleMs += affirmationVerses.bibleMs;
    const affirmations = reflection.affirmations.map((item, index) => ({
      slot: item.slot,
      headline: item.headline,
      text: item.text,
      verse: affirmationVerses.verses[index] ?? null,
    }));

    const row = await db(() =>
      saveReadyEntry(
        admin,
        user.userId,
        entryId,
        {
          transcript: words,
          dominant_emotion: reflection.emotion,
          devotional_title: reflection.title,
          validation_line: reflection.validationLine,
          devotional_script: reflection.devotional,
          closing_prayer: reflection.closingPrayer,
          scripture_reference: scripture.reference,
          scripture_text: scripture.text,
          scripture_verified: scripture.verified,
          // A heavy moment is never made a prayer by the server: the person can track it from their own screen.
          is_active_prayer: !heavy && reflection.prayer !== null,
          prayer_title: heavy ? null : reflection.prayer?.title ?? null,
          prayer_category: heavy ? null : reflection.prayer?.category ?? null,
          prayer_summary: heavy ? null : reflection.prayer?.summary ?? null,
        },
        affirmations,
        heavy,
        helpLine,
      )
    );
    saved = true;
    context.affirmationVerses = affirmations.filter((item) => item.verse !== null).length;
    // How the saved reflection is written from the entry, as a count and two words (step 36): never a word of either. The
    // written fallback is not written from the entry, so it has none.
    if (fromModel && words !== null) {
      context.grounding = groundingCount(words, [
        reflection.validationLine ?? "",
        reflection.devotional,
        reflection.closingPrayer,
      ]);
      context.prayerVoice = prayerVoice(reflection.closingPrayer, words);
      context.validationLine = reflection.validationSource === "model" ? "ok" : "salvaged";
    }

    // Speech, best effort, from the row that was just saved, behind the answer. It never throws and never changes the status.
    return await speakThenRespond(row);
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
    grounding: null,
    prayerVoice: null,
    validationLine: null,
    affirmationVerses: null,
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
      accountApple: null,
      grounding: context.grounding,
      prayerVoice: context.prayerVoice,
      validationLine: context.validationLine,
      affirmationVerses: context.affirmationVerses,
    };
    writeLog(line);
  }
}
