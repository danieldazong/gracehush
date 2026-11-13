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
import { allowanceStatus, checkListen } from "../_shared/scholar/usage.ts";
import { readTtsConfig } from "../_shared/tts/config.ts";
import { synthesize } from "../_shared/tts/synthesize.ts";
import { wavDurationMs } from "../_shared/tts/wavDuration.ts";
import type { ScholarSpeakResponse } from "../process-entry/contracts.ts";
import { ensureProfile, readProfile } from "../process-entry/lifecycle.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import { bumpUsage, findSpokenAnswer, readUsageRows } from "./lifecycle.ts";

// scholar-speak (step 38): one part of a saved Scholar answer, read aloud in the devotional's voice and rate. The answer's script
// is built from its saved blocks (script.ts: the lead reading, the answer, the supporting reading, the prayer), with the spoken
// help sentence last when the answer is to a flagged message; the app asks for the parts one after another and plays them as
// they come. Listening is a Pro benefit: a free account is told so by its plan on every part, except in a heavy conversation,
// where listening is open to everyone and never counted. Pro's day of answers read aloud is checked and counted on part 0 only,
// so an answer already started is never cut off. Nothing is stored. The log line is the shared one: its speech fields, never the
// script.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;

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

// `region` (2026-11-11): the phone's region, which chooses the spoken help line's numbers; the US when it is missing.
export type SpeakRequest = { messageId: string; part: number; region: Region };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readSpeakRequest(req: Request): Promise<SpeakRequest> {
  const body = await readJsonBody(req, SCHOLAR_REQUEST.maxBodyBytes);
  if (!isRecord(body)) throw new AppError("INVALID_REQUEST", "body_shape");
  for (const key of Object.keys(body)) {
    if (key !== "messageId" && key !== "part" && key !== "region") throw new AppError("INVALID_REQUEST", "body_keys");
  }
  const { messageId, part } = body;
  if (body.region !== undefined && (typeof body.region !== "string" || !/^[A-Za-z]{2}$/.test(body.region))) {
    throw new AppError("INVALID_REQUEST", "region");
  }
  if (typeof messageId !== "string" || !UUID_V4.test(messageId)) throw new AppError("INVALID_REQUEST", "message_id");
  if (typeof part !== "number" || !Number.isInteger(part) || part < 0) throw new AppError("INVALID_REQUEST", "part");
  return { messageId, part, region: regionOf(typeof body.region === "string" ? body.region : null) };
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
  const [profile, found, usageRows] = await db(() =>
    Promise.all([
      readProfile(admin, userId),
      findSpokenAnswer(admin, userId, request.messageId),
      readUsageRows(admin, userId, new Date(now - DAY_MS).toISOString().slice(0, 10)),
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

  // The plan on every part (a paid row whose end date has passed is read again; an outage leaves the stored plan), then the day.
  const heavy = conversation.is_heavy;
  const window = dayWindow(new Date(now), profile.timezone);
  let tier = profile.tier;
  if (!heavy) {
    const confirmed = await confirmPaidPlan(admin, userId, profile);
    context.billing = confirmed.billing;
    context.billingMs = confirmed.billingMs;
    tier = confirmed.profile.tier;
  }
  const listensToday = usageRows.find((row) => row.day === window.day)?.listens ?? 0;
  const allowance = checkListen({ heavy, tier, listensToday, part: request.part, window });
  context.limit = allowanceStatus(allowance, window);
  context.limitUsed = heavy ? null : listensToday;
  if (allowance.kind === "blocked") throw new AppError("LIMIT_REACHED", "listen_limit", { usage: allowance.usage });

  // Speech: the devotional's voice and rate. Off, or set up wrong, or Google failing, the person is told to try again.
  const setup = readTtsConfig(optionalEnv);
  if (setup.state === "off") {
    context.tts = "off";
    throw new AppError("AI_UNAVAILABLE", "speech_off");
  }
  if (setup.state === "bad") {
    context.tts = `bad_config:${setup.name}`;
    throw new AppError("AI_UNAVAILABLE", `bad_config:${setup.name}`);
  }
  const text = parts[request.part];
  const started = Date.now();
  const spoken = await synthesize(text, setup.config, started + scholarTiming.speechPart.totalMs);
  context.ttsMs = Date.now() - started;
  context.ttsAttempts = spoken.attempts;
  if (!spoken.ok) {
    context.tts = `failed:${spoken.reason}`;
    throw new AppError("AI_UNAVAILABLE", `tts:${spoken.kind.toLowerCase()}`);
  }
  const durationMs = wavDurationMs(spoken.audio);
  if (durationMs === null) {
    context.tts = "failed:tts_not_wav";
    throw new AppError("AI_UNAVAILABLE", "tts:not_wav");
  }
  context.tts = "ok";
  context.ttsChars = text.length;
  context.audioMs = durationMs;
  // Part 0 of a counted answer is counted after the response, once the audio is on its way.
  if (allowance.kind === "ok" && request.part === 0) {
    context.after = () => bumpUsage(admin, userId, window.day, 0, 1);
  }
  context.outcome = "scholar:spoken";

  const body: ScholarSpeakResponse = {
    part: request.part,
    parts: parts.length,
    audioBase64: Buffer.from(spoken.audio).toString("base64"),
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
