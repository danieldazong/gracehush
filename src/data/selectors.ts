import { copy } from "@/constants/copy";
import type {
  Affirmation,
  EmotionKey,
  HomeEntry,
  JournalEntry,
  PlaybackTrack,
  Prayer,
  TimeSlot,
} from "@/types";
import { calendarDaysBetween } from "@/utils/format";

const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

export type JournalFilter = "all" | EmotionKey | "prayers";

function minutesOfDay(hhmm: string): number {
  const [hours = 0, minutes = 0] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// The most recent slot whose time has passed. Before the first reminder of the day it is the
// last one, so before the morning time the answer is the evening slot.
export function getCurrentSlot(now: Date, reminders: Record<TimeSlot, string>): TimeSlot {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const latestFirst = [...SLOTS].sort(
    (a, b) => minutesOfDay(reminders[b]) - minutesOfDay(reminders[a]),
  );
  return (
    latestFirst.find((slot) => minutesOfDay(reminders[slot]) <= nowMinutes) ??
    latestFirst[0] ??
    "evening"
  );
}

export function getAffirmationForSlot(
  affirmations: Affirmation[],
  slot: TimeSlot,
): Affirmation | null {
  return affirmations.find((affirmation) => affirmation.slot === slot) ?? null;
}

// Consecutive local days with at least one finished, non-crisis entry, ending today or yesterday.
// Crisis, failed, processing and pending entries do not count, and nothing negative is surfaced.
export function getReflectionDays(entries: JournalEntry[], now: Date): number {
  const days = new Set(
    entries
      .filter((entry) => entry.status === "ready" && !entry.isCrisis)
      .map((entry) => dayKey(new Date(entry.createdAt))),
  );
  const dayAt = (offset: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  let offset = days.has(dayKey(now)) ? 0 : 1;
  let count = 0;
  while (days.has(dayKey(dayAt(offset)))) {
    count += 1;
    offset += 1;
  }
  return count;
}

export function getPrayerCounts(prayers: Prayer[]): {
  active: number;
  answered: number;
  total: number;
} {
  const answered = prayers.filter((prayer) => prayer.isAnswered).length;
  return { active: prayers.length - answered, answered, total: prayers.length };
}

// Open prayers, the one that has waited longest first. Filtering copies the list, so the sort never touches the input.
export function selectActivePrayers(prayers: Prayer[]): Prayer[] {
  return prayers
    .filter((prayer) => !prayer.isAnswered)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

// Answered prayers, the latest answer first. One with no answer date sorts by when it was created.
export function selectAnsweredPrayers(prayers: Prayer[]): Prayer[] {
  const answeredTime = (prayer: Prayer) => Date.parse(prayer.answeredAt ?? prayer.createdAt);
  return prayers
    .filter((prayer) => prayer.isAnswered)
    .sort((a, b) => answeredTime(b) - answeredTime(a));
}

// What Profile's "Offline Reflections" row shows. An entry that exists only on this device is pending, every
// other one is synced. `unsent` is how many reflections the outbox holds (step 24): they are not entries yet, so they
// are pending and no part of the synced count.
export function getSyncSummary(
  entries: readonly JournalEntry[],
  unsent: number = 0,
): { synced: number; pending: number } {
  const local = entries.filter((entry) => entry.isLocalOnly).length;
  return { synced: entries.length - local, pending: local + unsent };
}

// How many reflections the phone will send by itself once it can: the ones waiting or being sent, and the mock's
// local-only entries. A refused one (needs the person), one held by the free limit and one waiting for a sign-in are
// not counted: reconnecting does not send them. The offline banner says this number.
export function getUnsentCount(entries: readonly HomeEntry[]): number {
  return entries.filter(
    (entry) =>
      entry.isLocalOnly &&
      (entry.pending === undefined ||
        entry.pending.status === "queued" ||
        entry.pending.status === "sending"),
  ).length;
}

// Whole local calendar days, never negative: a prayer started yesterday at 11 PM is 1 day old at 1 AM.
export function getDaysSince(iso: string, now: Date): number {
  return Math.max(0, calendarDaysBetween(new Date(iso), now)) || 0;
}

// Any filter except "all" hides crisis, pending, uploading, processing and failed entries: they have
// no emotion and no prayer (the mappers null both), so they never match.
export function filterEntries<T extends JournalEntry>(entries: T[], filter: JournalFilter): T[] {
  if (filter === "all") return entries;
  if (filter === "prayers") return entries.filter((entry) => entry.prayer !== null);
  return entries.filter((entry) => entry.dominantEmotion?.toLowerCase() === filter);
}

// What a player plays for this entry, or null when there is nothing to play: a crisis entry (it never
// reaches a player), an entry that is not finished, and a devotional with no audio or no measured length
// (a length is never invented). The mini player and Now Playing both build their track with it.
export function getPlaybackTrack(entry: JournalEntry): PlaybackTrack | null {
  const { devotional } = entry;
  if (entry.isCrisis || entry.status !== "ready" || devotional === null) return null;
  const { audioPath, durationMs } = devotional;
  if (audioPath === null || durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  return {
    entryId: entry.id,
    title: devotional.title,
    subtitle: copy.nowPlaying.subtitle(entry.scripture?.reference ?? null),
    durationMs,
  };
}

export function getGreeting(now: Date): TimeSlot {
  const hour = now.getHours();
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 16) return "afternoon";
  return "evening";
}
