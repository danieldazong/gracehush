import { WEEK_STARTS_ON } from "@/constants/app";

// The free tier's week, worked out the same way the server does it (step 22). KEEP IN SYNC with weekWindow in
// supabase/functions/_shared/limits/weekly.ts: that function decides when the limit resets and its 402 says so, so this copy
// must give the same two instants for the same time and zone (supabase/tests/journal-data checks the two against each other).
//
// The week runs from the start-of-week day at 00:00 on the clock of the person's time zone to the same moment a week later.
// Only Intl is used (Hermes has it, with time zones), and a time zone that Intl does not know is read as UTC, with a flag.
// The week is not always 168 hours long: a daylight-saving change inside it makes it 167 or 169.

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
