import type { SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "../env.ts";
import type { LimitProfile } from "../limits/weekly.ts";
import type { BillingStatus } from "../log.ts";
import { readBillingConfig, syncSubscription } from "./revenuecat.ts";

// The expiry guard (step 30), shared since step 38 by process-entry and Scholar's two functions. A trial or Pro row whose end
// date has passed is read again from RevenueCat, once and briefly, so a plan that lapsed while no webhook arrived is not a free
// pass. RevenueCat that cannot be read, or billing that is not set up, leaves the stored plan: a paying person is never blocked by
// an outage. A row with no end date (from before step 30, or a lifetime grant) is left as it is, and so is a free one.

// One look at RevenueCat, cut short, so a lapsed plan costs a request at most this long.
export const EXPIRY_CHECK = { attempts: 1, timeoutMs: 6_000 };

// The plan as the profile row holds it.
export type StoredPlan = LimitProfile & { expiresAt: string | null };

// The plan to use, and what billing did for the log line (`billing` null and `billingMs` 0 when no look was needed).
export type ConfirmedPlan = { profile: LimitProfile; billing: BillingStatus | null; billingMs: number };

export async function confirmPaidPlan(
  admin: SupabaseClient,
  userId: string,
  profile: StoredPlan,
): Promise<ConfirmedPlan> {
  const ends = profile.expiresAt === null ? NaN : Date.parse(profile.expiresAt);
  if (profile.tier === "free" || !Number.isFinite(ends) || ends > Date.now()) {
    return { profile, billing: null, billingMs: 0 };
  }
  const config = readBillingConfig(optionalEnv);
  if (!config.ok) return { profile, billing: "off", billingMs: 0 };
  const started = Date.now();
  const synced = await syncSubscription(admin, config.apiKey, userId, new Date(), EXPIRY_CHECK);
  const billingMs = Date.now() - started;
  if (!synced.ok) return { profile, billing: `failed:${synced.reason}`, billingMs };
  return { profile: { ...profile, tier: synced.plan.tier }, billing: "synced", billingMs };
}
