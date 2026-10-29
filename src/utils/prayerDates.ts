import { calendarDaysBetween } from "@/utils/format";

// A calendar day is "YYYY-MM-DD" in the device's local time. It is never built with `new Date("YYYY-MM-DD")`,
// which is UTC midnight and prints the day before in the Americas.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// The local calendar day of a Date: "2026-10-24".
export function toCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "2026-10-24" as a local Date at 12:00, or null when it is not a real day ("2026-02-30" is null).
export function parseCalendarDate(calendarDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(calendarDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 12);
  const real = date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
  return real ? date : null;
}

// What is stored for an answered day (step 29): 12:00 UTC on it, as an ISO string, read back with answeredDayOf. A calendar
// day has no time zone, so neither has its stamp: the day stays the same on a phone that moves to any zone, Pacific/Kiritimati
// (UTC+14) and Pacific/Honolulu (UTC-10) included. 12:00 in the phone's own zone (step 14) moved the day after a jump of more
// than 12 hours, and the profile's zone is the phone's (it follows the phone, step 18), so it would not have held either.
export function answeredDateToTimestamp(calendarDate: string): string | null {
  const date = parseCalendarDate(calendarDate);
  if (date === null) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)).toISOString();
}

// The day an answered_at stamp stands for, "2026-10-24": the stamp's UTC date. Null for text that is not a time.
export function answeredDayOf(answeredAtIso: string): string | null {
  const ms = Date.parse(answeredAtIso);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// The answered day as a local Date at 12:00 on it, for counting days on this phone's calendar.
export function answeredLocalDate(answeredAtIso: string): Date | null {
  const day = answeredDayOf(answeredAtIso);
  return day === null ? null : parseCalendarDate(day);
}

// "Oct 24", or "Oct 24, 2025" with the year: the stamp's day, printed in UTC, where it is the day itself. Neither the phone's
// zone nor a zone change the app has not caught up with yet can move it (on the iPhone, Hermes' local Date keeps the old zone
// until the app restarts while Intl follows the new one: step 28).
export function formatAnsweredDay(answeredAtIso: string, withYear: boolean): string {
  return new Date(answeredAtIso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

// Between the day the prayer was created and today, both included.
export function isValidAnsweredDate(calendarDate: string, createdAtIso: string, now: Date): boolean {
  const date = parseCalendarDate(calendarDate);
  if (date === null) return false;
  return (
    calendarDaysBetween(new Date(createdAtIso), date) >= 0 && calendarDaysBetween(date, now) >= 0
  );
}
