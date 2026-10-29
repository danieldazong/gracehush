import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdmin } from "../_shared/admin.ts";
import { readBillingConfig, syncSubscription } from "../_shared/billing/revenuecat.ts";
import { optionalEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { type BillingStatus, blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import { constantTimeEqual, verifySignature } from "./signature.ts";

// RevenueCat's webhook (step 30). RevenueCat sends no Clerk token, so two checks of its own stand in for one, and both are
// required: the Authorization value set in its dashboard (REVENUECAT_WEBHOOK_AUTH) and the HMAC signature of the raw body
// (REVENUECAT_WEBHOOK_SIGNING_SECRET). The event itself is never trusted for the plan: every id it names is re-read from
// RevenueCat and its plan written (_shared/billing/revenuecat.ts), which makes a duplicate, a retry or a late event harmless.
//
// RevenueCat counts only a 200 (within 60 seconds) as delivered and otherwise sends the event again, up to five times over
// about 80 minutes, so the work is done before answering, and a sync that failed answers 500. Browsers never call this, so it
// sends no CORS headers. Nothing about the body reaches the log: only the event's type as one word.

export const MAX_BODY_BYTES = 256 * 1024;

// RevenueCat's event types (its docs, read 2026-10-29). Any other type is still synced (RevenueCat adds types) and logged as
// "other", so the log holds only words from this list.
const EVENT_TYPES = new Set([
  "TEST",
  "INITIAL_PURCHASE",
  "RENEWAL",
  "CANCELLATION",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_PAUSED",
  "EXPIRATION",
  "BILLING_ISSUE",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
  "REFUND_REVERSED",
  "INVOICE_ISSUANCE",
  "TRANSFER",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "VIRTUAL_CURRENCY_TRANSACTION",
  "EXPERIMENT_ENROLLMENT",
  "PURCHASE_REDEEMED",
  "SUBSCRIBER_ALIAS",
  "PRICE_INCREASE_CONSENT_REQUIRED",
  "PRICE_INCREASE_CONSENT_APPROVED",
]);

// An id RevenueCat made up for a customer that never logged in. The app always configures RevenueCat with the Clerk user id
// (step 30), so there should be none; one that arrives is not anyone's profile.
const ANONYMOUS_PREFIX = "$RCAnonymousID:";

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  dbMs: number;
  billing: BillingStatus | null;
  billingMs: number;
  event: string | null;
};

type Config = { auth: string; signingSecret: string; apiKey: string };

async function timed<T>(context: Context, bucket: "dbMs" | "billingMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

function readConfig(context: Context): Config {
  const fail = (reason: `bad_config:${string}`): never => {
    context.billing = reason;
    throw new AppError("INTERNAL", reason);
  };
  const auth = optionalEnv("REVENUECAT_WEBHOOK_AUTH") ?? fail("bad_config:REVENUECAT_WEBHOOK_AUTH");
  const signingSecret = optionalEnv("REVENUECAT_WEBHOOK_SIGNING_SECRET") ??
    fail("bad_config:REVENUECAT_WEBHOOK_SIGNING_SECRET");
  const billing = readBillingConfig(optionalEnv);
  if (!billing.ok) fail(billing.reason);
  return { auth, signingSecret, apiKey: billing.ok ? billing.apiKey : "" };
}

// The value as it was typed in RevenueCat's dashboard. One typed with "Bearer " in front is accepted too.
function authorized(header: string | null, expected: string): boolean {
  const value = (header ?? "").trim();
  const token = value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : value;
  return token.length > 0 && constantTimeEqual(token, expected);
}

// The raw body, at most MAX_BODY_BYTES, read before anything parses it: the signature is over these exact bytes.
async function readRawBody(req: Request): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "body_size");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE", "body_size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEvent(raw: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_REQUEST", "json");
  }
  if (!isRecord(body) || !isRecord(body.event)) throw new AppError("INVALID_REQUEST", "body_shape");
  return body.event;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// The ids an event is about: for a TRANSFER every id in both lists, otherwise its app_user_id. Duplicates and anonymous ids
// are dropped.
function idsOf(event: Record<string, unknown>): string[] {
  const named = event.type === "TRANSFER"
    ? [...strings(event.transferred_from), ...strings(event.transferred_to)]
    : strings([event.app_user_id]);
  return [...new Set(named)].filter((id) => id.length > 0 && !id.startsWith(ANONYMOUS_PREFIX));
}

async function hasProfile(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.from("users_profile").select("id").eq("id", userId).maybeSingle();
  if (error) throw new AppError("INTERNAL", "db:profile_read");
  return data !== null;
}

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const config = readConfig(context);

  // The Authorization value is a header, so a caller that is not RevenueCat is turned away before its body is read.
  if (!authorized(req.headers.get("authorization"), config.auth)) {
    context.billing = "bad_auth";
    throw new AppError("UNAUTHORIZED", "bad_auth");
  }
  const raw = await readRawBody(req);
  const signed = await verifySignature(
    raw,
    req.headers.get("x-revenuecat-webhook-signature"),
    config.signingSecret,
    Math.floor(Date.now() / 1000),
  );
  if (!signed) {
    context.billing = "bad_signature";
    throw new AppError("UNAUTHORIZED", "bad_signature");
  }

  const event = readEvent(raw);
  const type = typeof event.type === "string" ? event.type : "";
  context.event = EVENT_TYPES.has(type) ? type : "other";
  // The dashboard's "Send test event": nothing to read, nothing to write.
  if (type === "TEST") {
    context.billing = "skipped";
    return jsonResponse(200, { received: true });
  }

  const ids = idsOf(event);
  if (ids.length > 0) context.userHash = await shortHash(ids[0]);
  const admin = createAdmin();
  let synced = 0;
  let unknown = 0;
  for (const id of ids) {
    const known = await timed(context, "dbMs", () => hasProfile(admin, id));
    if (!known) {
      unknown += 1;
      continue;
    }
    const result = await timed(context, "billingMs", () => syncSubscription(admin, config.apiKey, id));
    if (!result.ok) {
      // RevenueCat sends the whole event again, and syncing again is harmless.
      context.billing = `failed:${result.reason}`;
      throw new AppError("INTERNAL", `billing:${result.reason}`);
    }
    synced += 1;
  }
  context.billing = synced > 0 ? "synced" : unknown > 0 ? "unknown_user" : "skipped";
  return jsonResponse(200, { received: true });
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    dbMs: 0,
    billing: null,
    billingMs: 0,
    event: null,
  };
  let status = 200;
  let failure: AppError | null = null;
  try {
    const response = await run(req, context);
    status = response.status;
    return response;
  } catch (error) {
    failure = error instanceof AppError
      ? error
      : new AppError("INTERNAL", `unhandled:${error instanceof Error ? error.name : "unknown"}`);
    status = failure.status;
    return errorResponse(failure, context.requestId);
  } finally {
    // The event's type as one word, the outcome and the times, and the hash of the first id. Never the body, an id, a price,
    // a product or a store transaction.
    writeLog(
      blankLogLine({
        requestId: context.requestId,
        status,
        code: failure?.code ?? null,
        reason: failure?.reason ?? null,
        user: context.userHash,
        dbMs: context.dbMs,
        totalMs: Date.now() - context.startedAt,
        billing: context.billing,
        billingMs: context.billingMs,
        billingEvent: context.event,
      }),
    );
  }
}
