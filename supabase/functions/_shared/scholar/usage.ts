import type { DayWindow, LimitProfile } from "../limits/weekly.ts";
import type { LimitStatus } from "../log.ts";
import type { ScholarUsage, ScholarUsageKind } from "../../process-entry/contracts.ts";
import { DEFAULT_FREE_DAILY_BUDGET, SCHOLAR_LIMITS } from "./constants.ts";

// Scholar's limits (step 38), decided on the server and sent to the app in every answer's `usage`, so the app holds no limit
// number. A free account sends SCHOLAR_LIMITS.freeMessagesPerDay messages a day, to read; trial and Pro proMessagesPerDay, and
// hear proListensPerDay answers read aloud. The day is the calendar day of the profile's time zone (dayWindow). A heavy
// conversation is exempt from all of it: it is never counted, never blocked and never sent to the Paywall.
//
// These functions are pure: the caller has already confirmed a paid row whose end date has passed (confirmPaidPlan in
// _shared/billing/expiry.ts), so an outage leaves the stored plan, and read today's counts.

// The shape every answer carries (process-entry/contracts.ts, the server's copy of the contract).
export type { ScholarUsage, ScholarUsageKind } from "../../process-entry/contracts.ts";

// "ok": this message or listen may go ahead, and `usage` counts it. "blocked": it may not, and `usage` is what was used.
export type Allowance = { kind: "exempt" } | { kind: "ok" | "blocked"; usage: ScholarUsage };

type Tier = LimitProfile["tier"];

const paid = (tier: Tier) => tier === "trial" || tier === "pro";

function usage(kind: ScholarUsageKind, used: number, limit: number, resetsAt: string | null): ScholarUsage {
  return { kind, used, limit, remaining: Math.max(0, limit - used), resetsAt };
}

// One more message today? `messagesToday` counts the clear messages already answered today.
export function checkAllowance(
  args: { heavy: boolean; tier: Tier; messagesToday: number; window: DayWindow },
): Allowance {
  if (args.heavy) return { kind: "exempt" };
  const kind = paid(args.tier) ? "pro_day" : "free_day";
  const limit = paid(args.tier) ? SCHOLAR_LIMITS.proMessagesPerDay : SCHOLAR_LIMITS.freeMessagesPerDay;
  const resetsAt = args.window.end.toISOString();
  if (args.messagesToday >= limit) return { kind: "blocked", usage: usage(kind, args.messagesToday, limit, resetsAt) };
  return { kind: "ok", usage: usage(kind, args.messagesToday + 1, limit, resetsAt) };
}

// One part of an answer read aloud? Listening is a Pro benefit (a free account is told by its plan, with no day to wait for),
// except in a heavy conversation, where it is open to everyone and never counted. The day's limit is checked and counted on
// part 0 only, so an answer already started is never cut off.
export function checkListen(
  args: { heavy: boolean; tier: Tier; listensToday: number; part: number; window: DayWindow },
): Allowance {
  if (args.heavy) return { kind: "exempt" };
  if (!paid(args.tier)) return { kind: "blocked", usage: usage("listen_plan", 0, 0, null) };
  const limit = SCHOLAR_LIMITS.proListensPerDay;
  const resetsAt = args.window.end.toISOString();
  if (args.part > 0) return { kind: "ok", usage: usage("listen_day", args.listensToday, limit, resetsAt) };
  if (args.listensToday >= limit) {
    return { kind: "blocked", usage: usage("listen_day", args.listensToday, limit, resetsAt) };
  }
  return { kind: "ok", usage: usage("listen_day", args.listensToday + 1, limit, resetsAt) };
}

// What the log line says about the limit (LimitStatus): exempt, or the plan and whether it went ahead, with ":bad_timezone" when
// the profile's zone was not one Intl knows.
export function allowanceStatus(allowance: Allowance, window: DayWindow): LimitStatus {
  if (allowance.kind === "exempt") return "exempt";
  const plan = allowance.usage.kind === "free_day" || allowance.usage.kind === "listen_plan" ? "free" : "pro";
  const status = `${plan}_${allowance.kind === "ok" ? "ok" : "blocked"}` as const;
  return window.zoneFallback ? `${status}:bad_timezone` : status;
}

// SCHOLAR_FREE_DAILY_BUDGET: a whole number above 0, or the default when it is not set or not one.
export function readFreeBudget(read: (name: string) => string | undefined): number {
  const raw = (read("SCHOLAR_FREE_DAILY_BUDGET") ?? "").trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_FREE_DAILY_BUDGET;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_FREE_DAILY_BUDGET;
}

// Whether a free account's clear message may still be answered today, against the project-wide ceiling (today's
// free_answered in scholar_safety_daily, a UTC day). Paying accounts and heavy conversations never reach this.
export function freeBudgetLeft(freeAnsweredToday: number, budget: number): boolean {
  return freeAnsweredToday < budget;
}

// The day's usage as it stands, counting nothing new: what a replayed answer carries (its message was counted when it was first
// answered).
export function currentUsage(args: { tier: Tier; messagesToday: number; window: DayWindow }): ScholarUsage {
  const kind = paid(args.tier) ? "pro_day" : "free_day";
  const limit = paid(args.tier) ? SCHOLAR_LIMITS.proMessagesPerDay : SCHOLAR_LIMITS.freeMessagesPerDay;
  return usage(kind, args.messagesToday, limit, args.window.end.toISOString());
}
