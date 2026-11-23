import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { confirmPaidPlan } from "../_shared/billing/expiry.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { dayWindow } from "../_shared/limits/weekly.ts";
import {
  type BillingStatus,
  blankLogLine,
  type LimitStatus,
  shortHash,
  type SpeechStatus,
  writeLog,
} from "../_shared/log.ts";
import { isHelpKind, type Region, regionOf } from "../_shared/safety/helpKind.ts";
import { SCHOLAR_REQUEST, scholarTiming } from "../_shared/scholar/constants.ts";
import { spokenHelpLine } from "../_shared/scholar/heavyChat.ts";
import { buildScholarSpeech } from "../_shared/scholar/script.ts";
import { allowanceStatus, checkListen, listenCost } from "../_shared/scholar/usage.ts";
import { readTtsConfig } from "../_shared/tts/config.ts";
import { synthesize } from "../_shared/tts/synthesize.ts";
import { wavDurationMs } from "../_shared/tts/wavDuration.ts";
import { listenVoiceEnabled, readElevenLabsKey } from "../_shared/voice/config.ts";
import { listenSpeechTiming } from "../_shared/voice/constants.ts";
import { deleteSpeech, type Kept, speakInVoice } from "../_shared/voice/elevenlabs.ts";
import { DEFAULT_VOICE, VOICE_IDS, type VoiceKey, voiceKeyOf } from "../_shared/voice/voices.ts";
import type { ScholarSpeakResponse } from "../process-entry/contracts.ts";
import { ensureProfile, readProfile } from "../process-entry/lifecycle.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import { bumpUsage, findSpokenAnswer, readCredits, readFreeUse, spendCredits } from "./lifecycle.ts";

// scholar-speak (step 38): one part of a saved Scholar answer, read aloud in the devotional's voice and rate. The answer's script
// is built from its saved blocks (script.ts: the lead reading, the answer, the supporting reading, the prayer), with the spoken
// help sentence last when the answer is to a flagged message; the app asks for the parts one after another and plays them as
// they come. Listening is a Pro benefit: the free plan and the free trial are told so by their plan on every part, except in a
// heavy conversation, where listening is open to everyone and never counted. A Pro account's credits are checked on part 0 only,
// and the whole answer is paid for then (usage.ts listenCost: by the length of its whole script), so an answer already started is
// never cut off. Nothing is stored. The log line is the shared one: its speech fields, never the script.
//
// The chosen voice (2026-11-19): a request that names one of the eight voices of a live talk (`voice`, which the app sends only
// once the person has allowed ElevenLabs) is read by ElevenLabs in that voice while SCHOLAR_LISTEN_VOICE_ENABLED is on, and by the
// devotional's Google voice when that reading fails, so the answer is always heard. ElevenLabs keeps every reading in its history
// (zero retention is for Enterprise accounts), so what it kept is deleted after the response, whatever happened; a deletion that
// fails writes a second log line. The plan, the credits and the cost are the same whichever voice reads the part.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  authMs: number;
  dbMs: number;
  tts: SpeechStatus | null;
  ttsMs: number;
  ttsAttempts: number;
  ttsChars: number;
  audioMs: number | null;
  limit: LimitStatus | null;
  limitUsed: number | null;
  billing: BillingStatus | null;
  billingMs: number;
  outcome: string | null;
  after: (() => Promise<unknown>) | null;
  // Deletes what ElevenLabs kept of a reading in the chosen voice. Run after the response, whether or not the request ended well.
  forget: (() => Promise<void>) | null;
};

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

type EdgeRuntimeLike = { waitUntil?: (promise: Promise<unknown>) => void };

function runInBackground(work: Promise<unknown>): void {
  const guarded = work.catch(() => undefined);
  (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime?.waitUntil?.(guarded);
}

// A write after the response that fails changes nothing, and does not stop the one beside it.
const quietly = (work: Promise<unknown>) => work.then(() => undefined, () => undefined);

// `region` (2026-11-11): the phone's region, which chooses the spoken help line's numbers; the US when it is missing. `voice`
// (2026-11-19): the voice to read the part in, one of the eight keys of a live talk (one the server does not know is the default,
// as for a talk); null when the request names none, and then the devotional's Google voice reads it.
export type SpeakRequest = { messageId: string; part: number; region: Region; voice: VoiceKey | null };

const SPEAK_KEYS = new Set(["messageId", "part", "region", "voice"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readSpeakRequest(req: Request): Promise<SpeakRequest> {
  const body = await readJsonBody(req, SCHOLAR_REQUEST.maxBodyBytes);
  if (!isRecord(body)) throw new AppError("INVALID_REQUEST", "body_shape");
  for (const key of Object.keys(body)) {
    if (!SPEAK_KEYS.has(key)) throw new AppError("INVALID_REQUEST", "body_keys");
  }
  const { messageId, part } = body;
  if (body.region !== undefined && (typeof body.region !== "string" || !/^[A-Za-z]{2}$/.test(body.region))) {
    throw new AppError("INVALID_REQUEST", "region");
  }
  if (body.voice !== undefined && (typeof body.voice !== "string" || !/^[a-z]{1,32}$/.test(body.voice))) {
    throw new AppError("INVALID_REQUEST", "voice");
  }
  if (typeof messageId !== "string" || !UUID_V4.test(messageId)) throw new AppError("INVALID_REQUEST", "message_id");
  if (typeof part !== "number" || !Number.isInteger(part) || part < 0) throw new AppError("INVALID_REQUEST", "part");
  return {
    messageId,
    part,
    region: regionOf(typeof body.region === "string" ? body.region : null),
    voice: typeof body.voice === "string" ? voiceKeyOf(body.voice) : null,
  };
}

// The second log line of a reading whose ElevenLabs copy could not be deleted, under the request's own id: "voice:history_missing"
// (ElevenLabs named no item), "voice:history_unknown" (it never answered, so whether it kept one is not known) or the deletion's
// own failure ("voice:history_http_401:missing_permissions").
function logKept(context: Context, word: string): void {
  writeLog(blankLogLine({
    requestId: context.requestId,
    status: 200,
    reason: `voice:${word}`,
    user: context.userHash,
    totalMs: Date.now() - context.startedAt,
  }));
}

// One part read by ElevenLabs in the chosen voice, with its length, or why it was not (the Google voice reads it then). Whatever
// ElevenLabs kept of the reading is deleted after the response (context.forget), the reading usable or not.
async function readInVoice(
  context: Context,
  voice: VoiceKey,
  text: string,
): Promise<{ ok: true; audio: Uint8Array; durationMs: number } | { ok: false; reason: string }> {
  let apiKey: string;
  try {
    apiKey = readElevenLabsKey();
  } catch (error) {
    return { ok: false, reason: error instanceof AppError ? error.reason : "bad_config" };
  }
  const speech = await speakInVoice(apiKey, VOICE_IDS[voice], text);
  context.ttsAttempts += 1;
  context.forget = async () => {
    const kept: Kept = await speech.kept;
    if (kept === null) return;
    if ("lost" in kept) return logKept(context, `history_${kept.lost}`);
    const deleted = await deleteSpeech(apiKey, kept.historyId, listenSpeechTiming);
    if (!deleted.ok) logKept(context, deleted.reason);
  };
  if (!speech.ok) return { ok: false, reason: speech.reason };
  const durationMs = wavDurationMs(speech.audio);
  if (durationMs === null) return { ok: false, reason: "speech_not_wav" };
  return { ok: true, audio: speech.audio, durationMs };
}

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  const userId = user.userId;
  context.userHash = await shortHash(userId);
  const request = await readSpeakRequest(req);

  const admin: SupabaseClient = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const now = Date.now();
  await db(() => ensureProfile(admin, userId));
  const [profile, found, credits, free] = await db(() =>
    Promise.all([
      readProfile(admin, userId),
      findSpokenAnswer(admin, userId, request.messageId),
      readCredits(admin, userId),
      readFreeUse(admin, userId),
    ])
  );
  if (found === null) throw new AppError("NOT_FOUND", "answer_not_found");
  const { answer, conversation } = found;

  // The script, with the help sentence last for an answer that carries a help line (an answer to a flagged message, and a written
  // answer): the line for its kind (saved with it; the 988 line for one saved before 2026-11-11) and the phone's region.
  const help = answer.content?.help;
  const parts = buildScholarSpeech(answer.content?.blocks ?? [], {
    helpLine: answer.is_heavy ? spokenHelpLine(isHelpKind(help) ? help : "crisis", request.region) : null,
  });
  if (request.part >= parts.length) throw new AppError("INVALID_REQUEST", "part");

  // The plan on every part (a paid row whose end date has passed is read again; an outage leaves the stored plan), then the
  // credits on part 0.
  const heavy = conversation.is_heavy;
  const window = dayWindow(new Date(now), profile.timezone);
  let plan = { tier: profile.tier, expiresAt: profile.expiresAt };
  if (!heavy) {
    const confirmed = await confirmPaidPlan(admin, userId, profile);
    context.billing = confirmed.billing;
    context.billingMs = confirmed.billingMs;
    plan = { tier: confirmed.profile.tier, expiresAt: confirmed.profile.expiresAt };
  }
  const allowance = checkListen({
    heavy,
    plan,
    credits,
    free,
    conversationId: conversation.id,
    part: request.part,
    now,
  });
  context.limit = allowanceStatus(allowance, plan.tier);
  context.limitUsed = allowance.kind !== "exempt" && allowance.usage.kind === "credits" ? allowance.usage.used : null;
  if (allowance.kind === "blocked") throw new AppError("LIMIT_REACHED", "listen_limit", { usage: allowance.usage });

  // The voice (2026-11-20): an account on the free plan hears the default voice (Hannah) whatever it asks for; a trial and Pro hear
  // the voice they chose.
  const voice: VoiceKey | null = request.voice === null ? null : plan.tier === "free" ? DEFAULT_VOICE : request.voice;

  // Speech: the chosen voice through ElevenLabs when the request names one and the switch is on, otherwise (or when that reading
  // fails) the devotional's voice and rate through Google. Off, or set up wrong, or Google failing, the person is told to try again.
  const text = parts[request.part];
  const started = Date.now();
  let read: { audio: Uint8Array; durationMs: number } | null = null;
  let fallback: string | null = null;
  if (voice !== null && listenVoiceEnabled()) {
    const voiced = await readInVoice(context, voice, text);
    if (voiced.ok) read = voiced;
    else fallback = voiced.reason;
  }
  if (read === null) {
    const setup = readTtsConfig(optionalEnv);
    if (setup.state === "off") {
      context.tts = "off";
      throw new AppError("AI_UNAVAILABLE", "speech_off");
    }
    if (setup.state === "bad") {
      context.tts = `bad_config:${setup.name}`;
      throw new AppError("AI_UNAVAILABLE", `bad_config:${setup.name}`);
    }
    // Google's own time, counted from now: after a failed reading in the chosen voice it still has all of it.
    const spoken = await synthesize(text, setup.config, Date.now() + scholarTiming.speechPart.totalMs);
    context.ttsMs = Date.now() - started;
    context.ttsAttempts += spoken.attempts;
    if (!spoken.ok) {
      context.tts = `failed:${spoken.reason}`;
      throw new AppError("AI_UNAVAILABLE", `tts:${spoken.kind.toLowerCase()}`);
    }
    const durationMs = wavDurationMs(spoken.audio);
    if (durationMs === null) {
      context.tts = "failed:tts_not_wav";
      throw new AppError("AI_UNAVAILABLE", "tts:not_wav");
    }
    read = { audio: spoken.audio, durationMs };
    context.tts = fallback === null ? "ok" : `voice_fallback:${fallback}`;
  } else {
    context.ttsMs = Date.now() - started;
    context.tts = "voice";
  }
  const { audio, durationMs } = read;
  context.ttsChars = text.length;
  context.audioMs = durationMs;
  // Part 0 of a Pro account's answer pays for the whole answer after the response, once the audio is on its way, and goes in the
  // day's record. An answer of the free conversation is free: it only goes in the day's record.
  if (allowance.kind === "ok" && request.part === 0) {
    if (allowance.usage.kind === "credits") {
      const cost = listenCost(parts.reduce((sum, script) => sum + script.length, 0));
      context.after = () =>
        Promise.all([spendCredits(admin, userId, cost), bumpUsage(admin, userId, window.day, 0, 1)].map(quietly));
    } else {
      context.after = () => quietly(bumpUsage(admin, userId, window.day, 0, 1));
    }
  }
  context.outcome = "scholar:spoken";

  const body: ScholarSpeakResponse = {
    part: request.part,
    parts: parts.length,
    audioBase64: Buffer.from(audio).toString("base64"),
    durationMs,
  };
  return jsonResponse(200, body, corsHeaders);
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    authMs: 0,
    dbMs: 0,
    tts: null,
    ttsMs: 0,
    ttsAttempts: 0,
    ttsChars: 0,
    audioMs: null,
    limit: null,
    limitUsed: null,
    billing: null,
    billingMs: 0,
    outcome: null,
    after: null,
    forget: null,
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
    if (context.after !== null && failure === null) runInBackground(context.after());
    if (context.forget !== null) runInBackground(context.forget());
    writeLog(blankLogLine({
      requestId: context.requestId,
      status,
      code: failure?.code ?? null,
      reason: failure?.reason ?? context.outcome,
      user: context.userHash,
      authMs: context.authMs,
      dbMs: context.dbMs,
      totalMs: Date.now() - context.startedAt,
      tts: context.tts,
      ttsMs: context.ttsMs,
      ttsAttempts: context.ttsAttempts,
      ttsChars: context.ttsChars,
      audioMs: context.audioMs,
      limit: context.limit,
      limitUsed: context.limitUsed,
      billing: context.billing,
      billingMs: context.billingMs,
    }));
  }
}
