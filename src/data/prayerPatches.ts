import { PRAYER_PATCH_COLUMNS, type PrayerPatch } from "@/data/columns";
import type { JournalEntry, Prayer } from "@/types";

// The prayer changes the app makes (step 29), as patches of journal_entries columns: what the phone shows at once, what the
// change queue keeps (db/mutations.ts) and what the sync engine sends. Pure, so it is tested without a device.

// Mark as Prayer Request on, and off. Off also clears the answer: an entry that is not a prayer has none.
export function trackPatch(tracked: boolean): PrayerPatch {
  return tracked
    ? { is_active_prayer: true }
    : { is_active_prayer: false, is_answered: false, answered_at: null, answered_notes: null };
}

// Answered on a day (answered_at is that day's stamp, utils/prayerDates.ts), with a note or none.
export function answerPatch(answeredAt: string, note: string | null): PrayerPatch {
  return { is_active_prayer: true, is_answered: true, answered_at: answeredAt, answered_notes: note };
}

// Back to Active. It stays a tracked prayer (step 14): an entry that is neither tracked nor answered is no prayer at all.
export function unanswerPatch(): PrayerPatch {
  return { is_active_prayer: true, is_answered: false, answered_at: null, answered_notes: null };
}

export function notePatch(note: string | null): PrayerPatch {
  return { answered_notes: note };
}

// A later change on top of an earlier one: a key the later one sets wins, the others stay.
export function mergePatches(earlier: PrayerPatch, later: PrayerPatch): PrayerPatch {
  return { ...earlier, ...later };
}

const COLUMNS: readonly string[] = PRAYER_PATCH_COLUMNS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// What a patch may hold: the prayer columns, each with a value of its type. Anything else is left out, and null means
// nothing usable is left.
export function sanitizePatch(value: unknown): PrayerPatch | null {
  if (!isRecord(value)) return null;
  const patch: PrayerPatch = {};
  for (const key of Object.keys(value)) {
    if (!COLUMNS.includes(key)) continue;
    const cell = value[key];
    if (key === "is_active_prayer" && typeof cell === "boolean") patch.is_active_prayer = cell;
    if (key === "is_answered" && typeof cell === "boolean") patch.is_answered = cell;
    if (key === "answered_at" && (cell === null || typeof cell === "string")) patch.answered_at = cell;
    if (key === "answered_notes" && (cell === null || typeof cell === "string")) patch.answered_notes = cell;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

// The entry once the patch is applied, by the rule of toPrayer (data/mappers.ts) on the changed row: only a finished entry that
// is not a crisis can be a prayer, so any other entry comes back unchanged. What the model wrote (the title, the summary, the
// category) stays as the entry had it; an entry that was not a prayer has none of it.
export function applyPrayerPatch(entry: JournalEntry, patch: PrayerPatch): JournalEntry {
  if (entry.status !== "ready" || entry.isCrisis) return entry;
  const before = entry.prayer;
  const wasPrayer = before !== null;
  const tracked = patch.is_active_prayer ?? wasPrayer;
  const answered = patch.is_answered ?? before?.isAnswered ?? false;
  if (!tracked && !answered) return { ...entry, prayer: null };
  const answeredAt = patch.answered_at !== undefined ? patch.answered_at : (before?.answeredAt ?? null);
  const answeredNote = patch.answered_notes !== undefined ? patch.answered_notes : (before?.answeredNote ?? null);
  const prayer: Prayer = {
    id: entry.id,
    title: before?.title ?? "",
    category: before?.category ?? null,
    summary: before?.summary ?? "",
    scriptureReference: before?.scriptureReference ?? entry.scripture?.reference ?? null,
    createdAt: entry.createdAt,
    isAnswered: answered,
    answeredAt: answered ? answeredAt : null,
    answeredNote: answered ? answeredNote : null,
  };
  return { ...entry, prayer };
}
