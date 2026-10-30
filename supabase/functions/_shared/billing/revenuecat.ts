import type { SupabaseClient } from "@supabase/supabase-js";

// The only code that talks to RevenueCat (step 30). RevenueCat is the source of truth for a person's plan: the server never
// trusts what the app says it bought, and re-reads the customer instead (RevenueCat's own advice after any webhook event).
// That makes every sync harmless to repeat: a duplicate event, a retry or a late one reads the same current state.
//
// The plan is written only here, on users_profile (subscription_tier, subscription_expires_at, subscription_synced_at), by
// three callers: the webhook (revenuecat-webhook), the app after a purchase or a restore (sync-subscription), and
// process-entry's expiry guard. Nothing here logs: a caller logs one word (`billing`) and never a body, a key or an id.

// The one entitlement (AGENTS.md, Subscription Rules), a constant and never an environment variable. The app has the same.
export const PRO_ENTITLEMENT_ID = "pro";
export const REVENUECAT_API = "https://api.revenuecat.com/v1";

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export type PaidTier = "trial" | "pro";
export type Plan = { tier: "free" | PaidTier; expiresAt: string | null };

// From the environment: the V1 secret key (sk_). A public SDK key cannot read a customer, so anything else, or nothing, is
// bad_config, and the caller logs the secret's NAME.
export function readBillingConfig(
  env: (name: string) => string | undefined,
): { ok: true; apiKey: string } | { ok: false; reason: "bad_config:REVENUECAT_SECRET_API_KEY" } {
  const apiKey = env("REVENUECAT_SECRET_API_KEY")?.trim() ?? "";
  return apiKey.startsWith("sk_")
    ? { ok: true, apiKey }
    : { ok: false, reason: "bad_config:REVENUECAT_SECRET_API_KEY" };
}

// The fields this app reads from GET /v1/subscribers/{id}. Everything else in the answer is ignored and never logged.
export type SubscriberEntitlement = {
  expires_date: string | null;
  grace_period_expires_date: string | null;
  product_identifier: string;
};
export type SubscriberSubscription = { period_type: string; is_sandbox: boolean };
export type Subscriber = {
  entitlements: Record<string, SubscriberEntitlement>;
  subscriptions: Record<string, SubscriberSubscription>;
};

export type FetchOptions = {
  // 2 by default: one retry after about a second on 429, a 5xx, a timeout or a dropped connection, never on another 4xx.
  attempts?: number;
  // Each attempt's own limit, 8 seconds by default.
  timeoutMs?: number;
  // The pause before the retry. Tests shorten it.
  retryDelayMs?: number;
  fetch?: typeof fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `expires_date` is required (a date, or null for a lifetime grant): an answer without it is not one this code understands.
// The grace date and the product are optional and default to none.
function readEntitlement(value: unknown): SubscriberEntitlement | null {
  if (!isRecord(value)) return null;
  const expires = value.expires_date;
  if (expires !== null && typeof expires !== "string") return null;
  const grace = value.grace_period_expires_date;
  if (grace !== undefined && grace !== null && typeof grace !== "string") return null;
  const product = value.product_identifier;
  if (product !== undefined && typeof product !== "string") return null;
  return { expires_date: expires, grace_period_expires_date: grace ?? null, product_identifier: product ?? "" };
}

function readSubscription(value: unknown): SubscriberSubscription | null {
  if (!isRecord(value)) return null;
  const period = value.period_type;
  if (period !== undefined && typeof period !== "string") return null;
  const sandbox = value.is_sandbox;
  if (sandbox !== undefined && typeof sandbox !== "boolean") return null;
  return { period_type: period ?? "normal", is_sandbox: sandbox ?? false };
}

// The answer's `subscriber`, checked by hand. Both maps must be there (the real API sends them empty for a new customer: probed
// on 2026-10-29). The maps are built with Object.fromEntries, so an id such as "__proto__" stays an ordinary key.
export function readSubscriber(body: unknown): Subscriber | null {
  if (!isRecord(body) || !isRecord(body.subscriber)) return null;
  const { entitlements, subscriptions } = body.subscriber;
  if (!isRecord(entitlements) || !isRecord(subscriptions)) return null;
  const readEntitlements: [string, SubscriberEntitlement][] = [];
  for (const [id, value] of Object.entries(entitlements)) {
    const entitlement = readEntitlement(value);
    if (entitlement === null) return null;
    readEntitlements.push([id, entitlement]);
  }
  const readSubscriptions: [string, SubscriberSubscription][] = [];
  for (const [id, value] of Object.entries(subscriptions)) {
    const subscription = readSubscription(value);
    if (subscription === null) return null;
    readSubscriptions.push([id, subscription]);
  }
  return { entitlements: Object.fromEntries(readEntitlements), subscriptions: Object.fromEntries(readSubscriptions) };
}

type Attempt = { kind: "done"; result: FetchResult } | { kind: "retry"; reason: string };
export type FetchResult = { ok: true; subscriber: Subscriber } | { ok: false; reason: string };

async function attemptOnce(send: typeof fetch, url: string, apiKey: string, timeoutMs: number): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await send(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      return { kind: "retry", reason: response.status === 429 ? "http_429" : "http_5xx" };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { kind: "done", result: { ok: false, reason: `http_${response.status}` } };
    }
    // 200 for a customer RevenueCat knows, 201 for one it has just created (the GET creates it).
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { kind: "done", result: { ok: false, reason: "bad_body" } };
    }
    const subscriber = readSubscriber(body);
    return { kind: "done", result: subscriber === null ? { ok: false, reason: "bad_body" } : { ok: true, subscriber } };
  } catch {
    // Our own timer aborts the request: a timeout. Anything else that rejects is a connection that failed.
    return { kind: "retry", reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

// One read of the customer, with the secret key. The reasons are words only (http_401, http_404, http_429, http_5xx, timeout,
// network, bad_body), never a body or a message.
export async function fetchSubscriber(
  apiKey: string,
  userId: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const send = options.fetch ?? fetch;
  const url = `${REVENUECAT_API}/subscribers/${encodeURIComponent(userId)}`;
  let reason = "network";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    const outcome = await attemptOnce(send, url, apiKey, timeoutMs);
    if (outcome.kind === "done") return outcome.result;
    reason = outcome.reason;
  }
  return { ok: false, reason };
}

function parseDate(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Pure. `pro` is active when its expires_date is null (a lifetime grant) or later than now, or its grace period ends later
// than now. Active, and its product's subscription is in a trial period: trial. Active otherwise: pro. Not active: free.
// expiresAt is the later of the two dates (null for a lifetime grant; for free, the last date it had, or null). An unparsable
// date counts as absent, and an absent end date is never read as a lifetime grant: only null is.
export function planFromSubscriber(subscriber: Subscriber, now: Date): Plan {
  if (!Object.hasOwn(subscriber.entitlements, PRO_ENTITLEMENT_ID)) return { tier: "free", expiresAt: null };
  const pro = subscriber.entitlements[PRO_ENTITLEMENT_ID];
  const nowMs = now.getTime();
  const lifetime = pro.expires_date === null;
  const expires = parseDate(pro.expires_date);
  const grace = parseDate(pro.grace_period_expires_date);
  const active = lifetime || (expires !== null && expires > nowMs) || (grace !== null && grace > nowMs);
  const latest = Math.max(expires ?? -Infinity, grace ?? -Infinity);
  const expiresAt = lifetime || !Number.isFinite(latest) ? null : new Date(latest).toISOString();
  if (!active) return { tier: "free", expiresAt };
  const subscription = Object.hasOwn(subscriber.subscriptions, pro.product_identifier)
    ? subscriber.subscriptions[pro.product_identifier]
    : undefined;
  return { tier: subscription?.period_type === "trial" ? "trial" : "pro", expiresAt };
}

// Account deletion (step 31): DELETE /subscribers/{id} permanently deletes the customer (RevenueCat queues it and answers at once);
// 404 is a customer that does not exist, which counts as done. One attempt of 8 seconds, never a retry: a deletion that fails
// stops, and the person's next try continues it. Deleting the customer does not cancel an App Store or Google Play subscription.
export type DeleteSubscriberResult = { ok: true; notFound: boolean } | { ok: false; reason: string };

export async function deleteSubscriber(
  apiKey: string,
  userId: string,
  options: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<DeleteSubscriberResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? fetch)(`${REVENUECAT_API}/subscribers/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (response.ok) return { ok: true, notFound: false };
    if (response.status === 404) return { ok: true, notFound: true };
    return { ok: false, reason: response.status >= 500 ? "http_5xx" : `http_${response.status}` };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export type SyncResult = { ok: true; plan: Plan; updated: boolean } | { ok: false; reason: string };

// Reads RevenueCat and writes the plan on this user's row (service role, filtered by the id). No row: updated false, and
// nothing is created. It never throws.
export async function syncSubscription(
  admin: SupabaseClient,
  apiKey: string,
  userId: string,
  now: Date = new Date(),
  options: FetchOptions = {},
): Promise<SyncResult> {
  try {
    const fetched = await fetchSubscriber(apiKey, userId, options);
    if (!fetched.ok) return { ok: false, reason: fetched.reason };
    const plan = planFromSubscriber(fetched.subscriber, now);
    const { data, error } = await admin.from("users_profile").update({
      subscription_tier: plan.tier,
      subscription_expires_at: plan.expiresAt,
      subscription_synced_at: now.toISOString(),
    }).eq("id", userId).select("id");
    if (error) return { ok: false, reason: "db:update" };
    return { ok: true, plan, updated: Array.isArray(data) && data.length > 0 };
  } catch {
    return { ok: false, reason: "unexpected" };
  }
}
