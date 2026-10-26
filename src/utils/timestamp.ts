// PostgREST writes a timestamptz as text with microseconds and a numeric offset: "2026-10-25T11:59:00.123456+00:00". The date format
// that every JavaScript engine must read has exactly three fractional digits (a "Z" or an offset after them), and the engine of the
// phone (Hermes) was not shown to read more, so the app keeps every time that comes from the server as "2026-10-25T11:59:00.123Z".
// The milliseconds are cut, not rounded. A text that is not a timestamp of this shape comes back as it is.
//
// The one place that must keep the server's own text is the cursor of the Journal's pages: it is sent back to PostgREST, which
// compares microseconds (data/entriesRemote.ts passes the last row's text on untouched).
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

export function normalizeTimestamp(text: string): string {
  const match = TIMESTAMP.exec(text);
  if (match === null) return text;
  const [, date, time, fraction = "", zone = "Z"] = match;
  const millis = `${fraction}000`.slice(0, 3);
  if (zone === "Z" || zone === "z") return `${date}T${time}.${millis}Z`;
  const sign = zone.slice(0, 1);
  const hours = zone.slice(1, 3);
  const minutes = zone.replace(":", "").slice(3, 5) || "00";
  return hours === "00" && minutes === "00" ? `${date}T${time}.${millis}Z` : `${date}T${time}.${millis}${sign}${hours}:${minutes}`;
}
