// Calendar days and wall-clock times in a named time zone, for the affirmation notifications (step 28). Only Intl is used
// (Hermes has it, with time zones), the same way as utils/week.ts, which is a copy of the server's week and is left alone.

export type CalendarDay = { year: number; month: number; day: number };

type Wall = CalendarDay & { hour: number; minute: number; second: number };

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

// Throws a RangeError for a time zone that does not exist. hourCycle h23 keeps midnight "00" (hour12: false says "24").
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
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
  };
}

// A wall clock written as milliseconds as if it were UTC, so two of them can be compared.
function wallMs(w: Wall): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

// Seconds are all Intl gives, so the instant is cut to a whole second first.
function offsetMs(instantMs: number, zone: string): number {
  return wallMs(wall(instantMs, zone)) - Math.floor(instantMs / 1000) * 1000;
}

export function isTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

// The calendar day the clock of `zone` shows at this instant.
export function calendarDayIn(instant: Date, zone: string): CalendarDay {
  const { year, month, day } = wall(instant.getTime(), zone);
  return { year, month, day };
}

// The calendar day that is `days` after this one (negative: before).
export function addDays(day: CalendarDay, days: number): CalendarDay {
  const moved = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

// The instant at which the clock of `zone` reads `hhmm` ("HH:mm", 24-hour) on this day. Every offset the zone uses within a
// day of that time is tried and the earliest instant that reads it wins, so a time the clocks pass twice (the autumn change)
// is its first occurrence. A time the clocks jump over (the spring change) does not exist: it becomes the first minute after
// the jump, found by stepping a minute at a time from just before it.
export function instantAt(day: CalendarDay, hhmm: string, zone: string): Date {
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(3, 5));
  const target = Date.UTC(day.year, day.month - 1, day.day, hour, minute, 0);
  const offsets = new Set([offsetMs(target - DAY_MS, zone), offsetMs(target, zone), offsetMs(target + DAY_MS, zone)]);
  const candidates = [...offsets].map((offset) => target - offset).sort((a, b) => a - b);
  const exact = candidates.find((at) => wallMs(wall(at, zone)) === target);
  if (exact !== undefined) return new Date(exact);
  let at = Math.floor(candidates[0] / 60_000) * 60_000;
  while (wallMs(wall(at, zone)) < target) at += 60_000;
  return new Date(at);
}
