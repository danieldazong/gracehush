import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { monthWindow } from "../_shared/limits/weekly.ts";
import { blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import { elapsedSeconds, freeTalkLimits, monthSecondsUsed, talkLimits } from "../_shared/voice/allowance.ts";
import { type ElevenLabsConfig, readElevenLabsConfig } from "../_shared/voice/config.ts";
import { endSweepTiming, VOICE_START } from "../_shared/voice/constants.ts";
import {
  closeSession,
  findSession,
  listSessionsInConversation,
  listSessionsSince,
  markSessionHeavy,
} from "../_shared/voice/sessions.ts";
import { sweepBehind } from "../_shared/voice/sweep.ts";
import type { ScholarVoiceEndResponse } from "../process-entry/contracts.ts";
import { readProfile } from "../process-entry/lifecycle.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import { findConversation } from "../scholar-turn/lifecycle.ts";

// scholar-voice-end (step 39): the phone says a live talk is over. The talk's row gets its end and its length, and the answer is
// what is left of the month's talk time (for an account that is not Pro, what is left of its free conversation's talk time,
// 2026-11-20), so the app never counts for itself.
//
// What a talk costs the person is decided in _shared/voice/allowance.ts: its time from the start to this call (which is later
// than its last turn), never more than its own cap, and nothing in a heavy conversation. A talk nobody ended (the app was closed,
// the connection was lost) is closed at its last turn by the next start, so this call is not what the count depends on.
//
// Ending always works: it reads neither switch, and it needs no voice secret. Another person's talk and one that does not exist
// are the same NOT_FOUND. Calling it twice changes nothing. After the response the finished talks of our agents are deleted at
// ElevenLabs (sweep.ts).
//
// The log line is the shared one (43 fields). Its reason is voice:end (voice:end:no_sweep when the voice secrets cannot be read,
// so the deletion could not run), or the error's own word. It never holds a talk or conversation id.

// A talk's id is made by scholar-voice-start: crypto.randomUUID(), a lowercase UUID.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The read of the account's talks goes back this far: every talk of the calendar month, whatever the profile's time zone.
const SESSIONS_BACK_MS = 32 * 86_400_000;

async function readTalkId(req: Request): Promise<string> {
  let body: unknown;
  try {
    body = await readJsonBody(req, VOICE_START.maxBodyBytes);
  } catch (error) {
    // Nothing this function accepts is anywhere near the size limit, so a body that is too big is just a bad request.
    if (error instanceof AppError && error.code === "PAYLOAD_TOO_LARGE") {
      throw new AppError("INVALID_REQUEST", "body_size");
    }
    throw error;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST", "body_shape");
  }
  // Only the talk's id: how long it lasted is the server's to say, and the user comes from the token.
  if (Object.keys(body).some((key) => key !== "talkId")) throw new AppError("INVALID_REQUEST", "body_keys");
  const { talkId } = body as Record<string, unknown>;
  if (typeof talkId !== "string" || !UUID.test(talkId)) throw new AppError("INVALID_REQUEST", "talk_id");
  return talkId;
}

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  authMs: number;
  dbMs: number;
  limitUsed: number | null;
  ended: boolean;
  // The work that runs after the response: deleting finished talks at ElevenLabs. Null when the voice secrets cannot be read.
  sweep: ElevenLabsConfig | null;
};

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  const userId = user.userId;
  context.userHash = await shortHash(userId);
  const talkId = await readTalkId(req);

  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const found = await db(() => findSession(admin, userId, talkId));
  if (found === null) throw new AppError("NOT_FOUND", "talk_not_found");

  // The talk's end and its length. A talk that has already ended (this call came twice, or a newer start closed it) is left as it
  // is; the update itself only touches a talk that has not ended, so two calls at once cannot both set it.
  const now = Date.now();
  if (found.ended_at === null) {
    const seconds = Math.max(found.seconds, elapsedSeconds(found.started_at, now));
    await db(() => closeSession(admin, userId, talkId, { ended_at: new Date(now).toISOString(), seconds }));
  }

  const [profile, conversation, sessions] = await db(() =>
    Promise.all([
      readProfile(admin, userId),
      findConversation(admin, userId, found.conversation_id),
      listSessionsSince(admin, userId, new Date(now - SESSIONS_BACK_MS).toISOString()),
    ])
  );

  // A conversation that became heavy in the talk's last turn: the turn marks the talk's row after its answer was spoken, which
  // this call can overtake. The conversation itself is what counts, so the talk is marked here and costs nothing.
  const heavy = found.is_heavy || conversation?.is_heavy === true;
  if (heavy && !found.is_heavy) await db(() => markSessionHeavy(admin, userId, talkId));

  // What is left of the month, from the rows as they now stand. A talk of this account that is still running is counted as far
  // as its last turn.
  const window = monthWindow(new Date(now), profile.timezone);
  const monthSeconds = monthSecondsUsed(
    sessions
      .filter((row) => Date.parse(row.started_at) >= window.start.getTime())
      .map((row) => (row.id === talkId ? { ...row, is_heavy: heavy } : row)),
  );
  // An account that is not Pro has no month: what is left of its free conversation's talk time, over every talk held in the
  // conversation this talk belonged to (the stored plan: a purchase made during the talk shows at the next start).
  let limits = talkLimits({ heavy, monthSeconds, window });
  context.limitUsed = monthSeconds;
  if (!heavy && profile.tier !== "pro") {
    const held = await db(() => listSessionsInConversation(admin, userId, found.conversation_id));
    const freeSeconds = monthSecondsUsed(held);
    limits = freeTalkLimits(freeSeconds, window);
    context.limitUsed = freeSeconds;
  }
  context.ended = true;
  try {
    context.sweep = readElevenLabsConfig();
  } catch {
    context.sweep = null;
  }
  const body: ScholarVoiceEndResponse = { limits };
  return jsonResponse(200, body, corsHeaders);
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    authMs: 0,
    dbMs: 0,
    limitUsed: null,
    ended: false,
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
    const done = context.ended ? (context.sweep === null ? "voice:end:no_sweep" : "voice:end") : null;
    writeLog(
      blankLogLine({
        requestId: context.requestId,
        status,
        code: failure?.code ?? null,
        reason: failure?.reason ?? done,
        user: context.userHash,
        authMs: context.authMs,
        dbMs: context.dbMs,
        totalMs: Date.now() - context.startedAt,
        limitUsed: context.limitUsed,
      }),
    );
    if (context.ended && context.sweep !== null) {
      sweepBehind(context.requestId, context.userHash, context.sweep, endSweepTiming.retryAtMs);
    }
  }
}
