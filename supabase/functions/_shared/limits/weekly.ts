import type { SupabaseClient } from "@supabase/supabase-js";

import { CLAIM_LEASE_MS } from "../../process-entry/constants.ts";
import { dbFailure } from "../../process-entry/lifecycle.ts";
import { FREE_DEVOTIONALS_PER_WEEK, WEEK_STARTS_ON } from "./constants.ts";

// The free tier's week: from the start-of-week day at 00:00 on the clock of the person's time zone, to the same moment a
// week later. Only Intl is used (no library), and a time zone that Intl does not know is read as UTC, with a flag so the
// caller can log it. The week is not always 168 hours long: a daylight-saving change inside it makes it 167 or 169.

export type WeekWindow = {
  start: Date; // the first instant of the week, inclusive
  end: Date; // the first instant of the next week: when the limit resets
  zone: string; // the zone that was used
  zoneFallback: boolean; // true when the zone was not valid and UTC was used instead
};

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

// Throws a RangeError for a time zone that does not exist. hourCycle h23 keeps midnight "00" (hour12: false says "24").
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, found);
  }
  return found;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// The clock and calendar of `zone` at this instant.
function wall(instantMs: number, zone: string): Wall {
  const values: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(instantMs))) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS[values.weekday] ?? 0,
  };
}

// A wall clock written as milliseconds as if it were UTC, so two of them can be compared and subtracted.
function wallMs(w: Wall): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

// Seconds are all Intl gives, so the instant is cut to a whole second first.
function offsetMs(instantMs: number, zone: string): number {
  return wallMs(wall(instantMs, zone)) - Math.floor(instantMs / 1000) * 1000;
}

// The first instant at which the clock of `zone` reads this calendar day, 00:00. The first guess uses the offset at the
// wrong instant on a daylight-saving day and the second pass corrects it, which settles almost every day at once.
// Where the clocks jumped over midnight there is no such instant, and the day starts when they land: that is found by
// stepping a minute at a time from a few hours before (and is also what would settle any day the two passes missed).
// Where midnight happens twice (Cuba's clocks go back from 01:00 to 00:00), the first pass uses the offset from before
// the change, so the earlier midnight is the one that is found.
function startOfDay(year: number, month: number, day: number, zone: string): number {
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = target - offsetMs(target, zone);
  guess = target - offsetMs(guess, zone);
  if (wallMs(wall(guess, zone)) === target) return guess;
  let at = guess - 3 * 3_600_000;
  while (wallMs(wall(at, zone)) < target) at += 60_000;
  return at;
}

// The calendar day that is `days` after this one (negative: before), in the proleptic Gregorian calendar.
function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

export function weekWindow(now: Date, timeZone: string, weekStartsOn: number = WEEK_STARTS_ON): WeekWindow {
  let zone = timeZone;
  let zoneFallback = false;
  try {
    formatter(zone);
  } catch {
    zone = "UTC";
    zoneFallback = true;
  }
  const here = wall(now.getTime(), zone);
  const sinceStart = (here.weekday - weekStartsOn + 7) % 7;
  const first = addDays(here.year, here.month, here.day, -sinceStart);
  const next = addDays(first.year, first.month, first.day, 7);
  return {
    start: new Date(startOfDay(first.year, first.month, first.day, zone)),
    end: new Date(startOfDay(next.year, next.month, next.day, zone)),
    zone,
    zoneFallback,
  };
}

// ---- The check itself (step 22) ----------------------------------------------------------------------------------------

export type LimitProfile = { tier: "free" | "trial" | "pro"; timezone: string };

// The entry being checked: the row that was just claimed.
export type LimitSubject = { id: string; created_at: string };

export type LimitDecision =
  // A trial or Pro account has no limit, so nothing is counted and no query is made.
  | { kind: "exempt" }
  // `used` is the real count (devotionals made this week, plus the ones being made that were started first). It can be
  // higher than `limit`, and it is never clamped here.
  | { kind: "free"; allowed: boolean; used: number; limit: number; resetsAt: string; zoneFallback: boolean };

// Whether one more devotional may be made for this person now. Every query filters by the verified user id (the service
// role bypasses row level security).
//
// A free account has FREE_DEVOTIONALS_PER_WEEK devotionals a week. What counts:
//   made       this user's entries from this week's start that are not a crisis and hold a devotional, not counting `current`
//   in flight  this user's entries from this week's start that are still being made (processing, no devotional yet, a claim
//              newer than the lease: an older one belongs to a request that died), that were started BEFORE `current`
//
// A failed entry (an AI error, or one the limit itself held back) holds no devotional and is not being made, so it never
// counts; a crisis entry never counts and never reaches this code; another user's entries are never read.
//
// Only the entries started first are counted among those in flight. Two requests that arrive together as the third and the
// fourth devotional would otherwise each count the other and both be refused; now the older one sees only the two that are
// made and passes, and the newer one sees the older one as well and stops, whichever of the two looks first. The order is
// the time the entries were created, to the millisecond, and the larger id comes later when two share a millisecond.
export async function checkDevotionalLimit(
  admin: SupabaseClient,
  userId: string,
  profile: LimitProfile,
  current: LimitSubject,
  now: Date = new Date(),
): Promise<LimitDecision> {
  if (profile.tier !== "free") return { kind: "exempt" };

  const window = weekWindow(now, profile.timezone);
  const since = window.start.toISOString();
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS).toISOString();

  // Asked together: one round trip to a database that is far from the function, not two.
  const [made, inFlight] = await Promise.all([
    admin.from("journal_entries").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("is_crisis", false).neq("id", current.id)
      .gte("created_at", since).not("devotional_script", "is", null),
    admin.from("journal_entries").select("id, created_at")
      .eq("user_id", userId).eq("is_crisis", false).neq("id", current.id)
      .gte("created_at", since).is("devotional_script", null)
      .eq("processing_status", "processing").gt("updated_at", leaseCutoff),
  ]);
  if (made.error) throw dbFailure("limit_made", made.error);
  if (inFlight.error) throw dbFailure("limit_in_flight", inFlight.error);

  const startedAt = Date.parse(current.created_at);
  const startedFirst = (inFlight.data as { id: string; created_at: string }[]).filter((other) => {
    const at = Date.parse(other.created_at);
    return at < startedAt || (at === startedAt && other.id < current.id);
  }).length;

  const used = (made.count ?? 0) + startedFirst;
  return {
    kind: "free",
    allowed: used < FREE_DEVOTIONALS_PER_WEEK,
    used,
    limit: FREE_DEVOTIONALS_PER_WEEK,
    resetsAt: window.end.toISOString(),
    zoneFallback: window.zoneFallback,
  };
}
