import type { LimitProfile, MonthWindow } from "../limits/weekly.ts";
import type { ScholarUsage, ScholarUsageKind, ScholarVoiceLimits } from "../../process-entry/contracts.ts";
import { VOICE_LIMITS, VOICE_SESSION_MAX_SECONDS, VOICE_SESSION_TTL_MS } from "./constants.ts";

// A live talk's time (step 39), decided on the server: the app shows the numbers scholar-voice-start and scholar-voice-end send
// and holds none of its own.
//
// What a row of scholar_voice_sessions means here:
//   seconds      how long the talk has really lasted, from its start to its last activity (the table keeps it within 0 to 1,900).
//   cap_seconds  the talk's own cap, set when it started; null for a talk that started in a heavy conversation.
//   is_heavy     the conversation is heavy (from the start, or since a turn of this talk). Such a talk costs the person nothing.
//
// These functions are pure: the caller has confirmed the plan (confirmPaidPlan) and read the month's and the day's sessions.

type Tier = LimitProfile["tier"];

const paid = (tier: Tier) => tier === "trial" || tier === "pro";

// The part of a session's row the sums read.
export type TalkTime = { seconds: number; cap_seconds: number | null; is_heavy: boolean };

// Whole seconds from a talk's start to `until`, within the table's range. A start that cannot be read counts as no time.
export function elapsedSeconds(startedAt: string, until: number): number {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(until)) return 0;
  return Math.min(VOICE_SESSION_MAX_SECONDS, Math.max(0, Math.floor((until - start) / 1000)));
}

// What a talk costs the person: nothing in a heavy conversation, otherwise its time and never more than its own cap (a talk that
// ran a few seconds past its cap, while Scholar finished a sentence, costs the cap).
export function billableSeconds(session: TalkTime): number {
  if (session.is_heavy) return 0;
  const seconds = Math.max(0, session.seconds);
  return session.cap_seconds === null ? seconds : Math.min(seconds, session.cap_seconds);
}

// The talk time a month's sessions used.
export function monthSecondsUsed(sessions: readonly TalkTime[]): number {
  return sessions.reduce((sum, session) => sum + billableSeconds(session), 0);
}

// The real time of a day's talks in heavy conversations: what decision 25's second backstop counts.
export function heavySecondsUsed(sessions: readonly TalkTime[]): number {
  return sessions.reduce((sum, session) => sum + (session.is_heavy ? Math.max(0, session.seconds) : 0), 0);
}

function usage(kind: ScholarUsageKind, used: number, limit: number, resetsAt: string | null): ScholarUsage {
  return { kind, used, limit, remaining: Math.max(0, limit - used), resetsAt };
}

// What is left of the month, in seconds. Less than minTalkSeconds counts as used up, so the app never offers a talk of a few
// seconds and never needs to know that number.
function monthLeft(monthSeconds: number): number {
  const left = Math.max(0, VOICE_LIMITS.monthSeconds - Math.max(0, monthSeconds));
  return left < VOICE_LIMITS.minTalkSeconds ? 0 : left;
}

// The numbers a person sees: the cap a talk started now would have, what is left of the month, and when the month's time returns.
// In a heavy conversation both numbers are null: nothing there is counted, cut or said about minutes.
export function talkLimits(args: { heavy: boolean; monthSeconds: number; window: MonthWindow }): ScholarVoiceLimits {
  const resetsAt = args.window.end.toISOString();
  if (args.heavy) return { talkSeconds: null, monthSecondsLeft: null, resetsAt };
  const left = monthLeft(args.monthSeconds);
  return { talkSeconds: Math.min(VOICE_LIMITS.talkSeconds, left), monthSecondsLeft: left, resetsAt };
}

export type TalkAllowance =
  // A free account: a live talk is part of trial and Pro (LIMIT_REACHED with usage.kind talk_plan), in a heavy conversation too.
  | { kind: "plan"; usage: ScholarUsage }
  // startsPerDay talks were already started today (RATE_LIMITED): the one limit a heavy conversation shares.
  | { kind: "starts" }
  // Talks in heavy conversations for heavySecondsPerDay today (SCHOLAR_UNAVAILABLE): typing, speaking a message and Listen stay
  // open and uncounted.
  | { kind: "resting" }
  // The month's talk time is used up (LIMIT_REACHED with usage.kind talk_month and when it returns).
  | { kind: "month"; usage: ScholarUsage }
  // A talk may start. `capSeconds` is its own cap (the smaller of talkSeconds and what is left of the month), or null in a heavy
  // conversation, whose talk is never counted and never cut.
  | { kind: "ok"; capSeconds: number | null; limits: ScholarVoiceLimits };

// May a talk start? `monthSeconds` is monthSecondsUsed of the sessions that started in the profile's calendar month,
// `heavySecondsToday` is heavySecondsUsed of today's, and `startsToday` counts today's sessions, whatever became of them.
export function checkTalkAllowance(
  args: {
    tier: Tier;
    heavy: boolean;
    monthSeconds: number;
    heavySecondsToday: number;
    startsToday: number;
    window: MonthWindow;
  },
): TalkAllowance {
  if (!paid(args.tier)) return { kind: "plan", usage: usage("talk_plan", 0, 0, null) };
  if (args.startsToday >= VOICE_LIMITS.startsPerDay) return { kind: "starts" };
  const limits = talkLimits({ heavy: args.heavy, monthSeconds: args.monthSeconds, window: args.window });
  if (args.heavy) {
    if (args.heavySecondsToday >= VOICE_LIMITS.heavySecondsPerDay) return { kind: "resting" };
    return { kind: "ok", capSeconds: null, limits };
  }
  if (limits.talkSeconds === null || limits.talkSeconds === 0) {
    const used = Math.max(0, args.monthSeconds);
    return { kind: "month", usage: usage("talk_month", used, VOICE_LIMITS.monthSeconds, limits.resetsAt) };
  }
  return { kind: "ok", capSeconds: limits.talkSeconds, limits };
}

// How many of these moments fall inside one of the person's talks. The moments are when their spoken messages were made, and a
// spoken message made while a talk ran was a turn of that talk. A talk has its own limits (its turns and its time), so its
// turns are not part of a typed message's thirty in ten minutes (decision 23). A talk that never said it ended runs up to
// `now`, and never past the life of its signed session. The database and the functions keep time separately, so a few
// seconds either side still count.
const CLOCK_SLACK_MS = 5_000;

export function countTalkTurns(
  times: readonly string[],
  sessions: readonly { started_at: string; ended_at: string | null }[],
  now: number,
): number {
  const windows = sessions.flatMap((session) => {
    const start = Date.parse(session.started_at);
    if (!Number.isFinite(start)) return [];
    const ended = session.ended_at === null ? NaN : Date.parse(session.ended_at);
    const end = Number.isFinite(ended) ? ended : Math.min(now, start + VOICE_SESSION_TTL_MS);
    return [{ start: start - CLOCK_SLACK_MS, end: end + CLOCK_SLACK_MS }];
  });
  return times.filter((time) => {
    const at = Date.parse(time);
    return Number.isFinite(at) && windows.some((window) => at >= window.start && at <= window.end);
  }).length;
}

// Whether a talk in a clear conversation has reached its end: its own cap has passed, or it has had maxTurns turns. The caller
// never asks this for a heavy conversation.
export function talkCapReached(
  session: { started_at: string; cap_seconds: number | null; turns: number },
  now: number,
): boolean {
  if (session.turns >= VOICE_LIMITS.maxTurns) return true;
  if (session.cap_seconds === null) return false;
  const start = Date.parse(session.started_at);
  return Number.isFinite(start) && now - start >= session.cap_seconds * 1000;
}
