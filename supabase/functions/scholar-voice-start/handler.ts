import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { confirmPaidPlan } from "../_shared/billing/expiry.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { dayWindow, monthWindow } from "../_shared/limits/weekly.ts";
import { type BillingStatus, blankLogLine, type LimitStatus, shortHash, writeLog } from "../_shared/log.ts";
import { type Region, regionOf } from "../_shared/safety/helpKind.ts";
import { freeConversationOpen } from "../_shared/scholar/usage.ts";
import { checkTalkAllowance, elapsedSeconds, heavySecondsUsed, monthSecondsUsed } from "../_shared/voice/allowance.ts";
import {
  type ElevenLabsConfig,
  readElevenLabsConfig,
  readSessionSecret,
  voiceEnabled,
} from "../_shared/voice/config.ts";
import { VOICE_SESSION_TTL_MS, VOICE_START } from "../_shared/voice/constants.ts";
import { mintConversationToken } from "../_shared/voice/elevenlabs.ts";
import { signVoiceSession } from "../_shared/voice/session.ts";
import {
  closeSession,
  insertSession,
  listSessionsInConversation,
  listSessionsSince,
  type VoiceSessionRow,
} from "../_shared/voice/sessions.ts";
import { sweepBehind } from "../_shared/voice/sweep.ts";
import { DEFAULT_VOICE, voiceKeyOf } from "../_shared/voice/voices.ts";
import { findEntryById } from "../confirm-scripture/lifecycle.ts";
import type { ScholarVoiceStartResponse } from "../process-entry/contracts.ts";
import { ensureProfile, readProfile } from "../process-entry/lifecycle.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import {
  claimFreeConversation,
  findConversation,
  findConversationForEntry,
  readFreeUse,
  readScholarClosedAt,
} from "../scholar-turn/lifecycle.ts";

// scholar-voice-start (step 39): starts one live talk with Scholar. The phone sends its Clerk token, the conversation the talk
// belongs to and the voice it wants. The server checks that the account may talk and for how long, asks ElevenLabs for a one-time
// token for that voice's private agent (the API key never leaves the server), writes the talk's row, and signs who the talk
// belongs to and what it is about (_shared/voice/session.ts). The phone hands the token and the signed session to ElevenLabs;
// from then on ElevenLabs only hears and speaks, and every answer is written by scholar-voice-llm.
//
// The order is fixed: the method, the token and the body; the two switches; one read; a closed account; the plan; the day's
// starts; the month's time (for an account that is not Pro, its free conversation's talk time, 2026-11-20); the account's talks
// that never ended; the free conversation's claim; the voice; ElevenLabs' token; the row and the signed session; and, after the
// response, the deletion of finished talks at ElevenLabs. Nothing is written and no token is asked for until every check has
// passed, so a refused start costs nothing and counts as nothing.
//
// The log line is the shared one (43 fields). Its reason is voice:start, or the error's own word. It never holds the token, the
// session, the voice, a conversation or talk id.

// A conversation's id is made on the phone: a canonical, lowercase UUID v4. A reflection's id is the database's.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;
// The read of the account's talks goes back this far: every talk of the calendar month, whatever the profile's time zone.
const SESSIONS_BACK_MS = 32 * DAY_MS;

type StartRequest = { conversationId: string; entryId: string | null; voice: string; region: Region };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readStartRequest(req: Request): Promise<StartRequest> {
  const body = await readJsonBody(req, VOICE_START.maxBodyBytes);
  if (!isRecord(body)) throw new AppError("INVALID_REQUEST", "body_shape");
  // A key the contract does not name is refused, so no user id and no voice id ever travel in a body.
  for (const key of Object.keys(body)) {
    if (!["conversationId", "entryId", "voice", "region"].includes(key)) {
      throw new AppError("INVALID_REQUEST", "body_keys");
    }
  }
  const { conversationId, entryId, voice, region } = body;
  if (typeof conversationId !== "string" || !UUID_V4.test(conversationId)) {
    throw new AppError("INVALID_REQUEST", "conversation_id");
  }
  if (entryId !== undefined && (typeof entryId !== "string" || !UUID.test(entryId))) {
    throw new AppError("INVALID_REQUEST", "entry_id");
  }
  // One of Scholar's voice keys. A key the server does not know becomes the default (a newer app, or a voice that was retired);
  // anything that is not a short word is a malformed request.
  if (typeof voice !== "string" || !/^[a-z]{1,24}$/.test(voice)) throw new AppError("INVALID_REQUEST", "voice");
  if (region !== undefined && (typeof region !== "string" || !/^[A-Za-z]{2}$/.test(region))) {
    throw new AppError("INVALID_REQUEST", "region");
  }
  return {
    conversationId,
    entryId: typeof entryId === "string" ? entryId : null,
    voice,
    region: regionOf(typeof region === "string" ? region : null),
  };
}

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  authMs: number;
  dbMs: number;
  billing: BillingStatus | null;
  billingMs: number;
  limit: LimitStatus | null;
  limitUsed: number | null;
  // The work that runs after the response: deleting finished talks at ElevenLabs.
  sweep: ElevenLabsConfig | null;
};

// Where a talk that never said it ended is closed: at its last turn (or its start, when it had none), with the time up to then.
function lastActivity(row: VoiceSessionRow): { ended_at: string; seconds: number } {
  const endedAt = row.last_turn_at ?? row.started_at;
  return { ended_at: endedAt, seconds: Math.max(row.seconds, elapsedSeconds(row.started_at, Date.parse(endedAt))) };
}

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

async function run(req: Request, context: Context): Promise<Response> {
  // 1. The method, the token, the body.
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  const userId = user.userId;
  context.userHash = await shortHash(userId);
  const request = await readStartRequest(req);

  // 2. The switches, read on every request. With either one off no talk starts, and no voice secret is read.
  if (!voiceEnabled()) throw new AppError("SCHOLAR_UNAVAILABLE", "voice:off");
  if (optionalEnv("SCHOLAR_ENABLED") !== "true") throw new AppError("SCHOLAR_UNAVAILABLE", "scholar:off");
  const eleven = readElevenLabsConfig();
  const sessionSecret = readSessionSecret();

  // 3. One read: the profile, whether Scholar is closed for the account, the conversation and its reflection, and the account's
  // talks of the last month.
  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const now = Date.now();
  const entryId = request.entryId;
  await db(() => ensureProfile(admin, userId));
  const [profile, closedAt, byId, byEntry, entry, sessions, free] = await db(() =>
    Promise.all([
      readProfile(admin, userId),
      readScholarClosedAt(admin, userId),
      findConversation(admin, userId, request.conversationId),
      entryId === null ? Promise.resolve(null) : findConversationForEntry(admin, userId, entryId),
      entryId === null ? Promise.resolve(null) : findEntryById(admin, userId, entryId),
      listSessionsSince(admin, userId, new Date(now - SESSIONS_BACK_MS).toISOString()),
      readFreeUse(admin, userId),
    ])
  );

  // 4. Scholar is closed for this account (the person said they are under 18): no talk. Typing stays as step 38 left it.
  if (closedAt !== null) throw new AppError("SCHOLAR_ADULTS_ONLY", "scholar:adults_only");

  // 5. The plan (a paid row whose end date has passed is read again from RevenueCat). A live talk is part of Pro; since 2026-11-20
  // a free account and a free trial have SCHOLAR_FREE.talkSeconds of it in their free conversation, never in a heavy one (the app
  // shows them no Talk button there, so no paywall appears in a hard moment). Outside it a trial is told the day its plan begins.
  const confirmed = await confirmPaidPlan(admin, userId, profile);
  context.billing = confirmed.billing;
  context.billingMs = confirmed.billingMs;
  const tier = confirmed.profile.tier;
  const month = monthWindow(new Date(now), profile.timezone);
  const day = dayWindow(new Date(now), profile.timezone);
  // A talk that never said it ended is counted as it will be closed below: up to its last activity.
  const settled = sessions.map((row) => (row.ended_at === null ? { ...row, ...lastActivity(row) } : row));
  const thisMonth = settled.filter((row) => Date.parse(row.started_at) >= month.start.getTime());
  const today = settled.filter((row) => Date.parse(row.started_at) >= day.start.getTime());
  const counts = {
    tier,
    expiresAt: confirmed.profile.expiresAt,
    now,
    monthSeconds: monthSecondsUsed(thisMonth),
    heavySecondsToday: heavySecondsUsed(today),
    startsToday: today.length,
    window: month,
  };
  const zone = month.zoneFallback ? ":bad_timezone" as const : "" as const;
  // An account that is not Pro is refused with its plan's usage: outside its free conversation, in a heavy conversation, or with
  // the free conversation's talk time used up (checked once the conversation is known, below).
  const blocked = (usage: unknown) => {
    context.limit = tier === "trial" ? "trial_blocked" : `free_blocked${zone}`;
    return new AppError("LIMIT_REACHED", "voice:plan", { usage });
  };

  // The conversation the talk's turns are saved in, by step 38's rules: the one with this id, else the person's conversation
  // about this reflection, else a new one (the first turn makes it). A conversation opened from a heavy reflection starts heavy.
  let conversationId = request.conversationId;
  let heavy = false;
  if (byId !== null) {
    if (entryId !== null && byId.entry_id !== entryId) throw new AppError("INVALID_REQUEST", "entry_mismatch");
    heavy = byId.is_heavy;
  } else if (entryId !== null) {
    if (entry === null || entry.processing_status !== "ready" || entry.devotional_script === null) {
      throw new AppError("NOT_FOUND", "entry_not_found");
    }
    if (byEntry !== null) {
      conversationId = byEntry.id;
      heavy = byEntry.is_heavy;
    } else {
      heavy = entry.is_crisis === true;
    }
  }

  // 6, 7. The day's starts, then the time: a heavy conversation's talk is never counted or capped (up to the day's backstop),
  // and any other talk needs at least half a minute of the month's time. An account that is not Pro: its free conversation's
  // talk time, over the talks already held in it (a talk that never said it ended counts as far as its last activity).
  const open = tier !== "pro" && freeConversationOpen(free, conversationId);
  const freeSeconds = open
    ? monthSecondsUsed(
      (await db(() => listSessionsInConversation(admin, userId, conversationId))).map((row) =>
        row.ended_at === null ? { ...row, ...lastActivity(row) } : row
      ),
    )
    : 0;
  const allowance = checkTalkAllowance({ ...counts, heavy, free: { open, secondsUsed: freeSeconds } });
  context.limitUsed = tier === "pro" ? counts.monthSeconds : freeSeconds;
  if (allowance.kind === "plan") throw blocked(allowance.usage);
  if (allowance.kind === "starts") throw new AppError("RATE_LIMITED", "voice:starts");
  if (allowance.kind === "resting") throw new AppError("SCHOLAR_UNAVAILABLE", "voice:heavy_day");
  if (allowance.kind === "month") {
    context.limit = `pro_blocked${zone}`;
    throw new AppError("LIMIT_REACHED", "voice:month", { usage: allowance.usage });
  }
  if (allowance.kind !== "ok") throw new AppError("INTERNAL", "voice:allowance");
  context.limit = heavy
    ? "exempt"
    : tier === "pro"
    ? `pro_ok${zone}`
    : tier === "trial"
    ? "trial_ok"
    : `free_ok${zone}`;

  // 8. The account's talks that never said they ended (the app was closed, the connection was lost) end at their last activity.
  // One account has one talk at a time: a talk still running elsewhere ends here too, and its next turn says so.
  for (const row of sessions) {
    if (row.ended_at === null) await db(() => closeSession(admin, userId, row.id, lastActivity(row)));
  }

  // The free conversation's claim (2026-11-20): a talk in it claims it when nothing has, and a claim that another conversation won
  // in the meantime (a message sent at the same moment elsewhere) refuses the talk. Nothing else has been written.
  if (tier !== "pro") {
    const claimed = await db(() => claimFreeConversation(admin, userId, conversationId));
    if (claimed !== conversationId) {
      const plan = checkTalkAllowance({ ...counts, heavy: false, free: { open: false, secondsUsed: 0 } });
      throw blocked(plan.kind === "plan" ? plan.usage : null);
    }
  }

  // 9, 10. The voice (the server's choice of agent: the phone cannot pass a voice id; the free plan has the default voice,
  // Hannah, whatever it asks for), then ElevenLabs' one-time token.
  const voice = tier === "free" ? DEFAULT_VOICE : voiceKeyOf(request.voice);
  const conversationToken = await mintConversationToken(eleven.apiKey, eleven.agents[voice]);

  // 11. The talk's row, then its signed session.
  const talkId = crypto.randomUUID();
  await db(() =>
    insertSession(admin, {
      id: talkId,
      user_id: userId,
      conversation_id: conversationId,
      voice,
      cap_seconds: allowance.capSeconds,
      is_heavy: heavy,
    })
  );
  const session = await signVoiceSession(sessionSecret, {
    userId,
    talkId,
    conversationId,
    reflectionId: entryId,
    region: request.region,
    voice,
    issuedAt: now,
    expiresAt: now + VOICE_SESSION_TTL_MS,
  });

  // 12. After the response: finished talks are deleted at ElevenLabs.
  context.sweep = eleven;
  const body: ScholarVoiceStartResponse = {
    talkId,
    conversationId,
    conversationToken,
    session,
    voice,
    heavy,
    limits: allowance.limits,
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
    billing: null,
    billingMs: 0,
    limit: null,
    limitUsed: null,
    sweep: null,
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
    // The shared allow-list: the token, the session, the voice and ElevenLabs' answer are never logged.
    writeLog(
      blankLogLine({
        requestId: context.requestId,
        status,
        code: failure?.code ?? null,
        reason: failure?.reason ?? (status === 200 ? "voice:start" : null),
        user: context.userHash,
        authMs: context.authMs,
        dbMs: context.dbMs,
        totalMs: Date.now() - context.startedAt,
        limit: context.limit,
        limitUsed: context.limitUsed,
        billing: context.billing,
        billingMs: context.billingMs,
      }),
    );
    if (context.sweep !== null) sweepBehind(context.requestId, context.userHash, context.sweep);
  }
}
