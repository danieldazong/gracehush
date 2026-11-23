import type { LimitProfile } from "../limits/weekly.ts";
import type { LimitStatus } from "../log.ts";
import type { ScholarUsage, ScholarUsageKind } from "../../process-entry/contracts.ts";
import { SCHOLAR_CREDITS, SCHOLAR_FREE } from "./constants.ts";

// Scholar's plan and credits (2026-11-18; step 38's daily counts before), decided on the server and sent to the app in every
// answer's `usage`, so the app holds no limit number. Scholar is for paying Pro accounts: the free plan and the free trial are
// told so by their plan (`scholar_plan` for a message, `listen_plan` for an answer read aloud, `talk_plan` for a live talk), a
// trial with the day its plan begins, when Scholar opens. A Pro account spends credits from a window that renews
// SCHOLAR_CREDITS.windowSeconds after its first spend (scholar_credits, one row per person); anything may be sent while a credit
// is left. A heavy conversation is exempt from all of it: never counted, never refused and never sent to the Paywall.
//
// Since 2026-11-20 an account that is not Pro has one free conversation (SCHOLAR_FREE): its first SCHOLAR_FREE.messages answered
// messages, its answers read aloud and a few minutes of live talk, in the one conversation that claimed it (scholar_free_use).
// Any other conversation, and a message past the free ones, is told what it always was told (`scholar_plan`, and so on).
//
// These functions are pure: the caller has confirmed a paid row whose end date has passed (confirmPaidPlan in
// _shared/billing/expiry.ts), so an outage leaves the stored plan, and read the person's row of credits.

// The shape every answer carries (process-entry/contracts.ts, the server's copy of the contract).
export type { ScholarUsage, ScholarUsageKind } from "../../process-entry/contracts.ts";

// "ok": this message or listen may go ahead. "blocked": it may not, and `usage` says why (the plan, or no credit left).
export type Allowance = { kind: "exempt" } | { kind: "ok" | "blocked"; usage: ScholarUsage };

type Tier = LimitProfile["tier"];

// The plan as the server holds it: the tier and, for a trial, the end of the trial (when its Pro plan begins).
export type PlanState = { tier: Tier; expiresAt: string | null };

// A person's row of scholar_credits, or null when they have none.
export type CreditsRow = { used: number; allowance: number; renewsAt: string } | null;

// A person's free conversation (scholar_free_use), or null while it is not claimed: the conversation and how many of its
// messages were answered for free.
export type FreeRow = { conversationId: string; messages: number } | null;

// May this conversation be the free one? It is, or nothing has claimed the free conversation yet.
export function freeConversationOpen(free: FreeRow, conversationId: string): boolean {
  return free === null || free.conversationId === conversationId;
}

// The free conversation's messages as they stand: `used` answered of SCHOLAR_FREE.messages; nothing renews.
export function freeUsage(messages: number): ScholarUsage {
  const limit = SCHOLAR_FREE.messages;
  const used = Math.max(0, messages);
  return { kind: "free", used, limit, remaining: Math.max(0, limit - used), resetsAt: null };
}

// When Scholar opens for an account it is not part of yet: the end of a trial still running, or null (a free account, or a trial
// whose end has passed or cannot be read).
export function planOpensAt(plan: PlanState, now: number): string | null {
  const ends = plan.expiresAt === null ? NaN : Date.parse(plan.expiresAt);
  return plan.tier === "trial" && Number.isFinite(ends) && ends > now ? new Date(ends).toISOString() : null;
}

// The refusal for an account Scholar is not part of: no numbers, and the day it opens for a trial.
export function planUsage(
  kind: Extract<ScholarUsageKind, `${string}_plan`>,
  plan: PlanState,
  now: number,
): ScholarUsage {
  return { kind, used: 0, limit: 0, remaining: 0, resetsAt: planOpensAt(plan, now) };
}

// The credits as they stand at `now`. A window that has ended (or none) is a whole allowance with no renewal yet: the next spend
// starts the next window. The allowance is the server's current one.
export function creditsUsage(row: CreditsRow, now: number): ScholarUsage {
  const limit = SCHOLAR_CREDITS.allowance;
  const ends = row === null ? NaN : Date.parse(row.renewsAt);
  if (row === null || !Number.isFinite(ends) || ends <= now) {
    return { kind: "credits", used: 0, limit, remaining: limit, resetsAt: null };
  }
  const used = Math.max(0, row.used);
  return { kind: "credits", used, limit, remaining: Math.max(0, limit - used), resetsAt: new Date(ends).toISOString() };
}

// The credits once `cost` is spent at `now`, as spend_scholar_credits leaves them: what an answer carries.
export function creditsAfterSpend(row: CreditsRow, cost: number, now: number): ScholarUsage {
  const before = creditsUsage(row, now);
  const used = before.used + cost;
  const resetsAt = before.resetsAt ?? new Date(now + SCHOLAR_CREDITS.windowSeconds * 1000).toISOString();
  return { kind: "credits", used, limit: before.limit, remaining: Math.max(0, before.limit - used), resetsAt };
}

// One more message? Exempt in a heavy conversation; an account that is not Pro is answered in its free conversation while a free
// message is left, and gets the plan's refusal otherwise; a Pro account spends credits, and goes ahead while one is left.
export function checkMessage(
  args: { heavy: boolean; plan: PlanState; credits: CreditsRow; free: FreeRow; conversationId: string; now: number },
): Allowance {
  if (args.heavy) return { kind: "exempt" };
  if (args.plan.tier !== "pro") {
    if (freeConversationOpen(args.free, args.conversationId)) {
      const usage = freeUsage(args.free === null ? 0 : args.free.messages);
      if (usage.remaining > 0) return { kind: "ok", usage };
    }
    return { kind: "blocked", usage: planUsage("scholar_plan", args.plan, args.now) };
  }
  const usage = creditsUsage(args.credits, args.now);
  return usage.remaining > 0 ? { kind: "ok", usage } : { kind: "blocked", usage };
}

// One part of an answer read aloud? Exempt in a heavy conversation, where listening is open to everyone and never counted; for an
// account that is not Pro, free in the conversation that claimed its free conversation and the plan's refusal on every part
// elsewhere; for Pro, the credits are checked on part 0 only, so an answer already started is never cut off.
export function checkListen(
  args: {
    heavy: boolean;
    plan: PlanState;
    credits: CreditsRow;
    free: FreeRow;
    conversationId: string;
    part: number;
    now: number;
  },
): Allowance {
  if (args.heavy) return { kind: "exempt" };
  if (args.plan.tier !== "pro") {
    if (args.free !== null && args.free.conversationId === args.conversationId) {
      return { kind: "ok", usage: freeUsage(args.free.messages) };
    }
    return { kind: "blocked", usage: planUsage("listen_plan", args.plan, args.now) };
  }
  const usage = creditsUsage(args.credits, args.now);
  if (args.part > 0 || usage.remaining > 0) return { kind: "ok", usage };
  return { kind: "blocked", usage };
}

// What an answer read aloud costs: listenPer100Chars for every 100 characters of its whole script, rounded up, never nothing.
export function listenCost(scriptChars: number): number {
  const steps = Math.max(1, Math.ceil(Math.max(0, scriptChars) / 100));
  return steps * SCHOLAR_CREDITS.listenPer100Chars;
}

// What the log line says about the limit (LimitStatus): exempt; the free conversation as free_ok or trial_ok; the plan's refusal
// as free_blocked or trial_blocked; Pro's credits as pro_ok or pro_blocked.
export function allowanceStatus(allowance: Allowance, tier: Tier): LimitStatus {
  if (allowance.kind === "exempt") return "exempt";
  if (allowance.usage.kind === "free") return tier === "trial" ? "trial_ok" : "free_ok";
  if (allowance.usage.kind !== "credits") return tier === "trial" ? "trial_blocked" : "free_blocked";
  return allowance.kind === "ok" ? "pro_ok" : "pro_blocked";
}
