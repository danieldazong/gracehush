import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { hydrateScripture } from "../_shared/bible/hydrate.ts";
import { parseReference } from "../_shared/bible/reference.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { type LogLine, type ScriptureOutcome, shortHash, writeLog } from "../_shared/log.ts";
import type { ConfirmScriptureResponse, Scripture } from "../process-entry/contracts.ts";
import type { EntryRow } from "../process-entry/lifecycle.ts";
import { toScripture } from "../process-entry/response.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import { findEntryById, saveScripture } from "./lifecycle.ts";

// Asked again for the passage of a reflection that was made while the Bible text could not be read (its reference was
// kept, its text and scripture_verified were not). It reads the text and saves it, or says what it found. It never
// calls the model and never invents a passage: a reference that turns out not to exist is removed.

// The app asks at most once a minute (step 25), and so does the function: an entry changed less than this ago, or checked
// less than this ago by this instance, is answered as it is.
export const confirmTiming = { windowMs: 60_000 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// When this instance last looked up an entry, so a client that keeps asking cannot make it read the Bible every time.
// A function instance forgets this when it stops, and the `updated_at` rule in decide() is the other half.
const lastChecked = new Map<string, number>();
const MAX_REMEMBERED = 500;

export function forgetChecks(): void {
  lastChecked.clear();
}

function remember(entryId: string, nowMs: number): void {
  lastChecked.delete(entryId);
  lastChecked.set(entryId, nowMs);
  while (lastChecked.size > MAX_REMEMBERED) {
    const oldest = lastChecked.keys().next().value;
    if (oldest === undefined) break;
    lastChecked.delete(oldest);
  }
}

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  scripture: ScriptureOutcome | null;
  bibleMs: number;
  dbMs: number;
  authMs: number;
};

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

async function readEntryId(req: Request): Promise<string> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
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
  const { entryId } = body as Record<string, unknown>;
  if (typeof entryId !== "string" || !UUID.test(entryId)) throw new AppError("INVALID_REQUEST", "entry_id");
  return entryId;
}

// What the passage of this entry is after this request.
async function confirm(
  context: Context,
  admin: ReturnType<typeof createAdmin>,
  userId: string,
  row: EntryRow,
): Promise<Scripture | null> {
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);

  // Nothing to confirm: a crisis entry has no passage, an unfinished entry has none yet, and a verified one is done.
  if (row.is_crisis || row.processing_status !== "ready" || row.scripture_reference === null) return null;
  if (row.scripture_verified) return toScripture(row);

  const now = Date.now();
  const changedAt = Date.parse(row.updated_at);
  const recentlyChanged = Number.isFinite(changedAt) && now - changedAt < confirmTiming.windowMs;
  const recentlyChecked = now - (lastChecked.get(row.id) ?? -Infinity) < confirmTiming.windowMs;
  if (recentlyChanged || recentlyChecked) {
    context.scripture = "unverified";
    return toScripture(row);
  }

  // A reference we cannot read can never be verified, and neither can one that names a passage that cannot exist.
  const ref = parseReference(row.scripture_reference);
  const remove = async (): Promise<null> => {
    await db(() =>
      saveScripture(admin, userId, row.id, {
        scripture_reference: null,
        scripture_text: null,
        scripture_verified: false,
      })
    );
    context.scripture = "dropped";
    return null;
  };
  if (!ref) return await remove();

  remember(row.id, now);
  const started = Date.now();
  const result = await hydrateScripture(ref);
  context.bibleMs += Date.now() - started;

  if (result.status === "invalid") return await remove();
  if (result.status === "unavailable") {
    context.scripture = "unverified";
    return toScripture(row);
  }

  const saved = await db(() =>
    saveScripture(admin, userId, row.id, {
      scripture_reference: result.reference,
      scripture_text: result.text,
      scripture_verified: true,
    })
  );
  context.scripture = "verified";
  if (saved) return toScripture(saved);
  // Another request changed the entry between our read and our write: answer with what is there now.
  const current = await db(() => findEntryById(admin, userId, row.id));
  return current ? toScripture(current) : null;
}

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");

  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  context.userHash = await shortHash(user.userId);
  const entryId = await readEntryId(req);

  const admin = createAdmin();
  const row = await timed(context, "dbMs", () => findEntryById(admin, user.userId, entryId));
  // Another person's entry looks exactly like one that does not exist.
  if (!row) throw new AppError("NOT_FOUND", "entry_not_found");

  const scripture = await confirm(context, admin, user.userId, row);
  const body: ConfirmScriptureResponse = { scripture };
  return jsonResponse(200, body, corsHeaders);
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    scripture: null,
    bibleMs: 0,
    dbMs: 0,
    authMs: 0,
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
    // The same line as process-entry's, with the fields that do not apply left empty.
    const line: LogLine = {
      requestId: context.requestId,
      status,
      code: failure?.code ?? null,
      reason: failure?.reason ?? null,
      inputType: null,
      user: context.userHash,
      authMs: context.authMs,
      dbMs: context.dbMs,
      geminiMs: 0,
      totalMs: Date.now() - context.startedAt,
      attempts: 0,
      fallbackAttempts: 0,
      model: null,
      promptVersion: null,
      tokensIn: null,
      tokensOut: null,
      tokensThought: null,
      scripture: context.scripture,
      bibleMs: context.bibleMs,
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
