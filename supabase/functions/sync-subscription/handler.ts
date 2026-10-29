import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { readBillingConfig, syncSubscription } from "../_shared/billing/revenuecat.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { type BillingStatus, blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import type { SubscriptionTier, SyncSubscriptionResponse } from "../process-entry/contracts.ts";

// The app asks the server to re-read its own RevenueCat customer (step 30): after a purchase or a restore, and when the plan
// RevenueCat reports to the app differs from the server's. The server never takes the app's word for a purchase: it reads
// RevenueCat with its secret key and writes the plan itself (_shared/billing/revenuecat.ts). The caller comes only from the
// verified Clerk token, and the body is ignored, so nobody can sync another person.

// A sync answered under this long ago is answered as it stands, with no RevenueCat call: a purchase and the foreground check
// right after it, or a few quick taps, cost one read.
export const SYNC_THROTTLE_MS = 10_000;

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  authMs: number;
  dbMs: number;
  billing: BillingStatus | null;
  billingMs: number;
};

type StoredPlan = {
  subscription_tier: string | null;
  subscription_expires_at: string | null;
  subscription_synced_at: string | null;
};

const TIERS: readonly SubscriptionTier[] = ["free", "trial", "pro"];

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

async function readStoredPlan(admin: SupabaseClient, userId: string): Promise<StoredPlan | null> {
  const { data, error } = await admin.from("users_profile")
    .select("subscription_tier, subscription_expires_at, subscription_synced_at")
    .eq("id", userId).maybeSingle();
  if (error) throw new AppError("INTERNAL", "db:profile_read");
  return data as StoredPlan | null;
}

function answer(tier: string | null, expiresAt: string | null): SyncSubscriptionResponse {
  const known = TIERS.find((candidate) => candidate === tier);
  return { tier: known ?? "free", expiresAt };
}

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");

  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  context.userHash = await shortHash(user.userId);

  const config = readBillingConfig(optionalEnv);
  if (!config.ok) {
    context.billing = config.reason;
    throw new AppError("INTERNAL", config.reason);
  }

  const admin = createAdmin();
  const stored = await timed(context, "dbMs", () => readStoredPlan(admin, user.userId));
  // The profile is made at sign-in (the app's profile sync). With none there is nothing to write the plan on.
  if (stored === null) throw new AppError("NOT_FOUND", "profile_not_found");

  const syncedAt = stored.subscription_synced_at === null ? NaN : Date.parse(stored.subscription_synced_at);
  const age = Date.now() - syncedAt;
  if (Number.isFinite(age) && age >= 0 && age < SYNC_THROTTLE_MS) {
    context.billing = "throttled";
    return jsonResponse(200, answer(stored.subscription_tier, stored.subscription_expires_at), corsHeaders);
  }

  const syncStarted = Date.now();
  const synced = await syncSubscription(admin, config.apiKey, user.userId);
  context.billingMs = Date.now() - syncStarted;
  if (!synced.ok) {
    context.billing = `failed:${synced.reason}`;
    // RevenueCat that could not be read is worth trying again in a moment; a database that refused the write is ours.
    throw synced.reason.startsWith("db:")
      ? new AppError("INTERNAL", synced.reason)
      : new AppError("BILLING_UNAVAILABLE", `billing:${synced.reason}`);
  }
  // The row was there a moment ago; one that vanished in between (the account was deleted) has no plan to answer.
  if (!synced.updated) throw new AppError("NOT_FOUND", "profile_not_found");
  context.billing = "synced";
  return jsonResponse(200, answer(synced.plan.tier, synced.plan.expiresAt), corsHeaders);
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
    // The same allow-list as the other functions: one word about billing and its time, never an id, a key, a date or a plan.
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
        billing: context.billing,
        billingMs: context.billingMs,
      }),
    );
  }
}
