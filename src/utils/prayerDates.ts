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

// What is stored for an answered day: 12:00 local on it, as an ISO string. Noon keeps the day the same when it
// is read back in any zone from UTC-11 to UTC+12 and across a daylight-saving change.
export function answeredDateToTimestamp(calendarDate: string): string | null {
  return parseCalendarDate(calendarDate)?.toISOString() ?? null;
}

// Between the day the prayer was created and today, both included.
export function isValidAnsweredDate(calendarDate: string, createdAtIso: string, now: Date): boolean {
  const date = parseCalendarDate(calendarDate);
  if (date === null) return false;
  return (
    calendarDaysBetween(new Date(createdAtIso), date) >= 0 && calendarDaysBetween(date, now) >= 0
  );
}
