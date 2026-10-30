import { type ClerkResult, deleteClerkUser, getClerkUser, readClerkSecret } from "../_shared/account/clerk.ts";
import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { deleteSubscriber, readBillingConfig } from "../_shared/billing/revenuecat.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { AppError, type ErrorCode, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { type AccountStatus, blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import type { DeleteAccountResponse } from "../process-entry/contracts.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import { deleteUserRows, removeUserFiles } from "./lifecycle.ts";

// Deletes the caller's account for good (step 31): their files, their rows, their RevenueCat customer and their Clerk user.
//
// Every secret is read and checked, and Clerk is asked whether the caller exists, before anything is deleted: the token has just
// proved the user exists, so a 404 means the key belongs to another Clerk instance, and deleting with it would look like
// "already deleted". Then storage, the database, RevenueCat and Clerk, in that order (Clerk last, so the token keeps working for
// a retry until the end), and a final pass over storage and the database that catches anything a request still running wrote
// meanwhile. A step that fails stops with DELETE_INCOMPLETE: what was done stays done, and the same request sent again continues.
// Nothing is deleted without a verified token and the exact confirm body; the user id comes only from the token.

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  authMs: number;
  dbMs: number;
  account: AccountStatus | null;
  accountFiles: number;
};

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

// A step that failed: the log names the step and the short reason, never more.
function stepFailed(context: Context, step: string, reason: string, code: ErrorCode = "DELETE_INCOMPLETE"): AppError {
  context.account = `delete:failed:${step}:${reason}`;
  return new AppError(code, `${step}:${reason}`);
}

async function step<T>(context: Context, name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await timed(context, "dbMs", work);
  } catch (error) {
    throw stepFailed(context, name, error instanceof AppError ? error.reason : "unexpected");
  }
}

// The two-step dialog sends exactly { "confirm": "DELETE" }; anything else stops an accidental call.
async function readConfirm(req: Request): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof AppError && error.code === "PAYLOAD_TOO_LARGE") {
      throw new AppError("INVALID_REQUEST", "body_size");
    }
    throw error;
  }
  const exact = typeof body === "object" && body !== null && !Array.isArray(body) &&
    Object.keys(body).length === 1 && (body as Record<string, unknown>).confirm === "DELETE";
  if (!exact) throw new AppError("INVALID_REQUEST", "confirm");
}

function clerkFailed(context: Context, result: ClerkResult): AppError | null {
  return result.ok ? null : stepFailed(context, "clerk", result.reason);
}

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  context.userHash = await shortHash(user.userId);
  await readConfirm(req);
  const userId = user.userId;

  // 1. Every secret, and the caller on this Clerk instance. Nothing has been deleted yet.
  const clerk = readClerkSecret(optionalEnv);
  if (!clerk.ok) throw stepFailed(context, "config", "CLERK_SECRET_KEY", "INTERNAL");
  const billing = readBillingConfig(optionalEnv);
  if (!billing.ok) throw stepFailed(context, "config", "REVENUECAT_SECRET_API_KEY", "INTERNAL");
  const admin = createAdmin();
  const found = await getClerkUser(clerk.secretKey, userId);
  const unreachable = clerkFailed(context, found);
  if (unreachable) throw unreachable;
  if (found.ok && found.notFound) throw stepFailed(context, "config", "CLERK_SECRET_KEY", "INTERNAL");

  // 2. Storage, then 3. the database.
  context.accountFiles += await step(context, "storage", () => removeUserFiles(admin, userId));
  const rows = await step(context, "database", () => deleteUserRows(admin, userId));

  // 4. RevenueCat. A customer that does not exist is done. Deleting it does not cancel a store subscription: Profile says so
  // before the person gets here.
  const customer = await deleteSubscriber(billing.apiKey, userId);
  if (!customer.ok) throw stepFailed(context, "revenuecat", customer.reason);

  // 5. Clerk, last. A user that is already gone is done.
  // TODO(35): revoke Sign in with Apple here, before this call (AGENTS.md, Before a store build).
  const gone = await deleteClerkUser(clerk.secretKey, userId);
  const notDeleted = clerkFailed(context, gone);
  if (notDeleted) throw notDeleted;

  // 6. The final pass: anything written while this ran (a request that was still making an entry recreates the profile). The
  // account is gone by now, so this is best effort: logged, never a failure.
  let account: AccountStatus = rows.leftover > 0 ? "delete:done:cascade_missed" : "delete:done";
  try {
    const lateFiles = await timed(context, "dbMs", () => removeUserFiles(admin, userId));
    const lateRows = await timed(context, "dbMs", () => deleteUserRows(admin, userId));
    context.accountFiles += lateFiles;
    if (lateFiles > 0 || lateRows.profiles > 0 || lateRows.leftover > 0) account = "delete:done:late_data";
  } catch {
    account = "delete:done:final_pass_failed";
  }
  context.account = account;

  const body: DeleteAccountResponse = { deleted: true };
  return jsonResponse(200, body, corsHeaders);
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    authMs: 0,
    dbMs: 0,
    account: null,
    accountFiles: 0,
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
    // The same allow-list as the other functions: the step as one word and the files removed as a count. Never an id, a key or
    // a path.
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
        account: context.account,
        accountFiles: context.account === null ? null : context.accountFiles,
      }),
    );
  }
}
