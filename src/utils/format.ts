import { copy } from "@/constants/copy";
import type { EmotionKey, JournalEntry, Prayer } from "@/types";

const HEADLINE_EMOTIONS: readonly EmotionKey[] = [
  "anxious",
  "weary",
  "grieving",
  "grateful",
  "hopeful",
];

// The clock is built by hand: some ICU versions put a narrow no-break space (U+202F) before AM/PM,
// and then formatters that use toLocaleTimeString would disagree with each other.
function clock12(hours: number, minutes: number): string {
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

// Whole local calendar days from `from` to `to`. It compares dates, not 24-hour blocks, so a
// daylight-saving change cannot move an entry to another day.
export function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86400000);
}

// "Oct 21"
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "Oct 24, 2026", the local date
export function formatEntryDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// "Yesterday, 8:45 PM", "Today, 7:02 AM", "Oct 21, 7:15 AM" or, in another year, "Oct 21, 2025, 7:15 AM"
export function formatEntryTimestamp(iso: string, now: Date): string {
  const date = new Date(iso);
  const time = clock12(date.getHours(), date.getMinutes());
  const daysAgo = calendarDaysBetween(date, now);
  if (daysAgo <= 0) return `${copy.common.today}, ${time}`;
  if (daysAgo === 1) return `${copy.common.yesterday}, ${time}`;
  const year = date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;
  return `${formatShortDate(iso)}${year}, ${time}`;
}

// Milliseconds to "1:15". Rounds to the nearest second and does not cap the minutes.
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

// Milliseconds to "01:42" for a stopwatch. Whole seconds, floored (a timer never shows a second early),
// minutes zero-padded and not capped, "00:00" for a value that is not a positive number.
export function formatTimer(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

// Words separated by any whitespace. Zero for an empty or blank string.
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Milliseconds to words for a screen reader: "1 minute 15 seconds", "58 seconds", "2 minutes".
// Rounds like formatDuration.
export function formatDurationSpoken(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"}`;
  if (minutes === 0) return unit(seconds, "second");
  return seconds === 0
    ? unit(minutes, "minute")
    : `${unit(minutes, "minute")} ${unit(seconds, "second")}`;
}

// What an affirmation is tied to, by calendar days from `now`: "today's prayer", "yesterday's prayer"
// or "your Oct 21 prayer".
export function getAffirmationSource(createdAtIso: string, now: Date): string {
  const daysAgo = calendarDaysBetween(new Date(createdAtIso), now);
  if (daysAgo <= 0) return copy.journal.affirmation.sourceToday;
  if (daysAgo === 1) return copy.journal.affirmation.sourceYesterday;
  return copy.journal.affirmation.sourceOn(formatShortDate(createdAtIso));
}

// The fixed headline for the entry's emotion, now only the last fallback of getReflectionHeadline (step 36). The
// emotion is the raw AI string: it is trimmed and lowercased, and an unknown one (null, "", "overwhelmed") gets the
// generic line, never its own text.
export function getValidationHeadline(emotion: string | null): string {
  const normalized = emotion?.trim().toLowerCase();
  const known = HEADLINE_EMOTIONS.find((key) => key === normalized);
  return known ? copy.reflection.headlines[known] : copy.reflection.headlines.unknown;
}

// A devotional's first sentence, by the server's rule (openingSentence in process-entry/tone.ts): up to the first
// ".", "!" or "?" (and any closing quote) that is followed by a space or the end, with the whitespace made single. A
// first sentence over 160 characters is cut at a word boundary and ends with an ellipsis. Null when there is no text.
export function firstSentence(script: string | null | undefined): string | null {
  const text = (script ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  const end = /[.!?]["”’)]*(?=\s|$)/.exec(text);
  const sentence = end ? text.slice(0, end.index + end[0].length) : text;
  if (sentence.length <= 160) return sentence;
  const cut = sentence.slice(0, 159);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "") + "…";
}

// The Reflection headline (step 36): the validation line the model wrote from the entry; for a reflection made before
// it, the devotional's first sentence; and only when there is neither, the fixed line of its emotion.
export function getReflectionHeadline(entry: Pick<JournalEntry, "devotional" | "dominantEmotion">): string {
  const line = entry.devotional?.validation?.trim();
  if (line) return line;
  return firstSentence(entry.devotional?.script) ?? getValidationHeadline(entry.dominantEmotion);
}

// A verse in curly quotes, without changing a character of it. A verse with no double quote marks is
// wrapped. One that ends a speech begun in an earlier verse (Matthew 11:28–30 ends with ”) gets the
// opening mark it lacks, one that starts a speech that goes on gets the closing mark, and one whose
// marks already pair up (a verse that is all speech) is returned as it is.
export function quoteVerse(text: string): string {
  if (!/[“”]/.test(text)) return `“${text}”`;
  let missingOpens = 0;
  let missingCloses = 0;
  for (const char of text) {
    if (char === "“") {
      missingCloses += 1;
    } else if (char === "”") {
      if (missingCloses > 0) missingCloses -= 1;
      else missingOpens += 1;
    }
  }
  return "“".repeat(missingOpens) + text + "”".repeat(missingCloses);
}

// A verse as one flowing paragraph, for the card. The Bible's own lines of poetry are separated by line breaks, and on a
// phone those breaks fall in the wrong places: a long first line wraps and strands its last word ("has / said:"), and the
// rest end where the poet's lines do and not where the card's width does. So the card sets the lines as one paragraph and lets
// it wrap to the card. A run of whitespace that holds a line break becomes one space; nothing else changes, not a letter or
// a mark, and the stored verse and the share message keep their lines.
export function flowVerse(text: string): string {
  // A line that ends in an em dash joins the next with none, as the BSB closes its dashes ("my salvation—whom shall I
  // fear?", step 37).
  return text
    .replace(/\s+/g, (run: string, offset: number, whole: string) =>
      run.includes("\n") ? (whole[offset - 1] === "—" ? "" : " ") : run,
    )
    .trim();
}

// The prayer's own title, or "Prayer from Oct 2" when it has none. A title is never made up from the transcript.
export function getPrayerTitle(prayer: Pick<Prayer, "title" | "createdAt">): string {
  const title = prayer.title.trim();
  return title === "" ? copy.prayers.card.untitled(formatShortDate(prayer.createdAt)) : title;
}

// "08:00" or "08:00:00" to "8:00 AM". Anything else comes back unchanged.
export function formatTime12(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hhmm);
  return match ? clock12(Number(match[1]), Number(match[2])) : hhmm;
}

// "Thursday, October 24"
export function formatLongDate(now: Date): string {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// "October 20, 2026" from a calendar date "2026-10-20". The date is read as a local one: new Date("2026-10-20")
// is UTC midnight, which is the day before in the Americas. Anything that is not YYYY-MM-DD comes back unchanged.
export function formatCalendarDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return local.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// "October 2026"
export function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// "Monday, Nov 9": the day the free week resets, as a date, because a weekday alone ("Resets Monday") reads as today on
// that weekday (seen on a Monday, 2026-11-02). The reset is a local midnight, printed in the phone's zone like every other
// date the app formats.
export function formatResetDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

interface NameParts {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

// The first name when there is one. Otherwise the start of the email's local part ("sarah.j92@x.com"
// gives "Sarah"). Never returns an email address; callers pick their own fallback.
export function getDisplayName({ firstName, email }: NameParts): string | null {
  const first = firstName?.trim();
  if (first) return first;
  const at = email ? email.indexOf("@") : -1;
  if (!email || at < 1) return null;
  // Apple's Hide My Email address is random letters, so it never gives a name.
  if (email.toLowerCase().endsWith("@privaterelay.appleid.com")) return null;
  const word = /^[^._+\-\d]*/.exec(email.slice(0, at))?.[0] ?? "";
  if (word.replace(/[^a-z]/gi, "").length < 2) return null;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// The name line of the Profile header: first and last name when Clerk has both, else the first name, else the
// one getDisplayName finds in the email. A last name is never used alone, and an email address never comes back.
export function getFullName({ firstName, lastName, email }: NameParts): string | null {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (first && last) return `${first} ${last}`;
  return getDisplayName({ firstName: first, email });
}

export function getInitials({ firstName, lastName, email }: NameParts): string | null {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (first && last) return (first.charAt(0) + last.charAt(0)).toUpperCase();
  const name = first || getDisplayName({ email });
  return name ? name.charAt(0).toUpperCase() : null;
}
