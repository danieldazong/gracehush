import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import { regionOf } from "../_shared/safety/helpKind.ts";
import { SCHOLAR_REQUEST } from "../_shared/scholar/constants.ts";
import { SCHOLAR_PROMPT_VERSION } from "../_shared/scholar/prompt.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import {
  newTurnContext,
  readScholarConfig,
  runAfter,
  runInBackground,
  runTurn,
  timed,
  type TurnContext,
  turnLogFields,
  type TurnRequest,
} from "./turn.ts";

// scholar-turn (step 38): one message of a Scholar conversation, and its answer, in one request. This file is the HTTP part: the
// method, the Clerk token, the body, the response and the log line. Everything from "one read of everything the request needs"
// to the saved answer is Scholar's engine (turn.ts, runTurn), which a turn of a live talk runs too (step 39), so a typed message
// and a spoken turn are screened, written and saved by the same code.
//
// The log line is the shared one (43 fields). Its reason says what happened in a word (scholar:answered,
// scholar:answered:typed_verse, scholar:heavy, scholar:heavy:closed, scholar:emergency, scholar:adults_only,
// scholar:fallback:<why>, scholar:replayed, scholar:off, or an error's own); it never holds a message, an answer, a title, a
// passage, a conversation or message id, a help line or a phrase.

// A conversation and a message id are made on the phone: a canonical, lowercase UUID v4.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A reflection's id is the database's.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- The request -------------------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A key the contract does not name is refused, so no recording and no user id ever travel in a body.
function onlyKeys(value: Record<string, unknown>, keys: readonly string[], reason: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new AppError("INVALID_REQUEST", reason);
}

export async function readTurnRequest(req: Request): Promise<TurnRequest> {
  const body = await readJsonBody(req, SCHOLAR_REQUEST.maxBodyBytes);
  if (!isRecord(body)) throw new AppError("INVALID_REQUEST", "body_shape");
  onlyKeys(body, ["conversationId", "messageId", "input", "entryId", "region"], "body_keys");
  const { conversationId, messageId, input, entryId } = body;
  if (body.region !== undefined && (typeof body.region !== "string" || !/^[A-Za-z]{2}$/.test(body.region))) {
    throw new AppError("INVALID_REQUEST", "region");
  }
  const region = regionOf(typeof body.region === "string" ? body.region : null);
  if (typeof conversationId !== "string" || !UUID_V4.test(conversationId)) {
    throw new AppError("INVALID_REQUEST", "conversation_id");
  }
  if (typeof messageId !== "string" || !UUID_V4.test(messageId)) throw new AppError("INVALID_REQUEST", "message_id");
  if (entryId !== undefined && (typeof entryId !== "string" || !UUID.test(entryId))) {
    throw new AppError("INVALID_REQUEST", "entry_id");
  }
  if (!isRecord(input)) throw new AppError("INVALID_REQUEST", "input");
  const entry = typeof entryId === "string" ? entryId : null;
  if (input.type === "text") {
    onlyKeys(input, ["type", "text"], "input_keys");
    if (typeof input.text !== "string") throw new AppError("INVALID_REQUEST", "text");
    const text = input.text.trim();
    if (text === "") throw new AppError("INVALID_REQUEST", "text_empty");
    if (text.length > SCHOLAR_REQUEST.maxTextChars) throw new AppError("PAYLOAD_TOO_LARGE", "text_long");
    return { conversationId, messageId, input: { type: "text", text }, entryId: entry, region };
  }
  if (input.type === "audio") {
    onlyKeys(input, ["type", "durationMs"], "input_keys");
    const ms = input.durationMs;
    if (
      typeof ms !== "number" || !Number.isFinite(ms) || ms < SCHOLAR_REQUEST.minSpokenMs ||
      ms > SCHOLAR_REQUEST.maxSpokenMs
    ) {
      throw new AppError("INVALID_REQUEST", "duration");
    }
    return { conversationId, messageId, input: { type: "audio", durationMs: ms }, entryId: entry, region };
  }
  throw new AppError("INVALID_REQUEST", "input_type");
}

async function run(req: Request, context: TurnContext): Promise<Response> {
  // 1, 2. Method, token, then the body (the token first, as every function here does, so a request with no token is a 401
  // whatever its body).
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  const userId = user.userId;
  context.userHash = await shortHash(userId);
  const request = await readTurnRequest(req);
  context.inputType = request.input.type;
  const config = readScholarConfig();
  const body = await runTurn({ admin: createAdmin(), userId, request, config, context, talk: null });
  return jsonResponse(200, body, corsHeaders);
}

export async function handle(req: Request): Promise<Response> {
  const context = newTurnContext();
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
    if (context.after.length > 0) runInBackground(runAfter(context));
    writeLog(blankLogLine({
      requestId: context.requestId,
      status,
      code: failure?.code ?? null,
      reason: failure?.reason ?? context.outcome,
      inputType: context.inputType,
      user: context.userHash,
      totalMs: Date.now() - context.startedAt,
      promptVersion: SCHOLAR_PROMPT_VERSION,
      ...turnLogFields(context),
    }));
  }
}
