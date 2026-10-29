import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import { CLAIM_LEASE_MS } from "../process-entry/constants.ts";
import type { DeleteEntryResponse } from "../process-entry/contracts.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import {
  deletableFiles,
  deleteEntryRow,
  findEntryToDelete,
  forgetDeletedDevotional,
  pruneDeletedDevotionals,
  recordDeletedDevotional,
  removeFiles,
} from "./lifecycle.ts";

// Deletes one reflection for good (step 29b): its recording, its devotional audio, its affirmations and the row. The free tier
// keeps counting a devotional that was deleted (deleted_devotionals), so deleting does not give a free one back.
//
// The order is files, then the record, then the row, and each step treats "already done" as done, so a request sent again after
// a failure continues where the first stopped. A reflection that is already gone answers NOT_FOUND, and the app counts that as
// deleted. Another person's reflection looks exactly like one that does not exist.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
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

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");

  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  context.userHash = await shortHash(user.userId);
  const entryId = await readEntryId(req);

  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);

  const entry = await db(() => findEntryToDelete(admin, user.userId, entryId));
  // Another person's reflection looks exactly like one that does not exist.
  if (!entry) throw new AppError("NOT_FOUND", "entry_not_found");

  // A request that is still making this reflection will write to it: wait for it, or for its claim to lapse (CLAIM_LEASE_MS).
  const age = Date.now() - Date.parse(entry.updated_at);
  if (entry.processing_status === "processing" && age < CLAIM_LEASE_MS) {
    throw new AppError("ALREADY_PROCESSING", "still_processing");
  }

  // 1. the files, 2. the record that this devotional counted this week, 3. the reflection (its affirmations go with it).
  await db(() => removeFiles(admin, deletableFiles(user.userId, entry)));
  if (entry.counted) await db(() => recordDeletedDevotional(admin, user.userId, entry));
  try {
    await db(() => deleteEntryRow(admin, user.userId, entry.id));
  } catch (error) {
    // The reflection is still there, so its devotional must not count twice while it waits for the retry.
    if (entry.counted) await forgetDeletedDevotional(admin, user.userId, entry.id);
    throw error;
  }
  await pruneDeletedDevotionals(admin, user.userId);

  const body: DeleteEntryResponse = { deleted: true };
  return jsonResponse(200, body, corsHeaders);
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
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
    // The same allow-list as the other functions, with the fields that do not apply left empty. Never the entry id, a path or
    // any content.
    writeLog(
      blankLogLine({
        requestId: context.requestId,
        status,
        code: failure?.code ?? null,
        reason: failure?.reason ?? null,
        user: context.userHash,
        authMs: context.authMs,
        dbMs: context.dbMs,
        totalMs: Date.now() - context.startedAt,
      }),
    );
  }
}
