import { PRAYER_CATEGORIES, TIME_SLOTS } from "./constants.ts";
import type {
  Affirmation,
  Devotional,
  InputType,
  JournalEntry,
  Prayer,
  PrayerCategory,
  ProcessEntryResponse,
  ProcessingStatus,
  Scripture,
  StoredErrorCode,
  TimeSlot,
} from "./contracts.ts";
import type { AffirmationRow, EntryRow } from "./lifecycle.ts";

// Builds the response from the saved row. It must give exactly what the app's toJournalEntry and toAffirmation
// (src/data/mappers.ts) give for the same row: step 25 shows this entry without reading it back. The two are compared
// on shared fixtures (fixtures/ here, supabase/tests/process-entry/parity.cjs in the app).

const INPUT_TYPES: readonly InputType[] = ["text", "audio"];
const STATUSES: readonly ProcessingStatus[] = ["pending", "uploading", "processing", "ready", "failed"];
const ERROR_CODES: readonly StoredErrorCode[] = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "LIMIT_REACHED",
  "METHOD_NOT_ALLOWED",
  "ALREADY_PROCESSING",
  "PAYLOAD_TOO_LARGE",
  "TOO_SHORT",
  "AUDIO_NOT_FOUND",
  "NO_SPEECH",
  "CONTENT_BLOCKED",
  "RATE_LIMITED",
  "INTERNAL",
  "AI_UNAVAILABLE",
  "TTS_FAILED",
];

// The allowed value equal to `value`, else null: an unknown string never reaches the app.
function pick<T extends string>(allowed: readonly T[], value: string | null | undefined): T | null {
  return allowed.find((item) => item === value) ?? null;
}

export function toScripture(row: EntryRow): Scripture | null {
  if (!row.scripture_reference) return null;
  const verified = row.scripture_verified === true;
  return {
    reference: row.scripture_reference,
    // Unverified scripture has no text, so a screen cannot show it by accident.
    text: verified ? (row.scripture_text ?? null) : null,
    translation: "BSB",
    verified,
  };
}

function toDevotional(row: EntryRow): Devotional | null {
  if (!row.devotional_script) return null;
  return {
    title: row.devotional_title || "",
    script: row.devotional_script,
    closingPrayer: row.closing_prayer ?? null,
    audioPath: row.devotional_audio_path || null,
    durationMs: row.devotional_duration_ms ?? null,
  };
}

function toPrayer(row: EntryRow, finished: boolean): Prayer | null {
  const isAnswered = row.is_answered === true;
  if (!finished || !(row.is_active_prayer === true || isAnswered)) return null;
  return {
    id: row.id,
    title: row.prayer_title ?? "",
    category: pick<PrayerCategory>(PRAYER_CATEGORIES, row.prayer_category),
    summary: row.prayer_summary ?? "",
    scriptureReference: row.scripture_reference ?? null,
    createdAt: row.created_at,
    isAnswered,
    answeredAt: isAnswered ? (row.answered_at ?? null) : null,
    answeredNote: isAnswered ? (row.answered_notes ?? null) : null,
  };
}

function toAffirmation(row: AffirmationRow): Affirmation {
  return {
    id: row.id,
    entryId: row.entry_id,
    slot: pick<TimeSlot>(TIME_SLOTS, row.time_slot) ?? "morning",
    headline: row.headline,
    text: row.affirmation_text,
    isFavorite: row.is_favorite === true,
  };
}

export function toResponse(row: EntryRow, affirmations: AffirmationRow[]): ProcessEntryResponse {
  const status = pick(STATUSES, row.processing_status) ?? "ready";
  const finished = status === "ready" && row.is_crisis !== true;
  const entry: JournalEntry = {
    id: row.id,
    clientEntryId: row.client_entry_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    inputType: pick(INPUT_TYPES, row.input_type) ?? "text",
    transcript: row.transcript ?? null,
    dominantEmotion: finished ? (row.dominant_emotion ?? null) : null,
    status,
    isCrisis: row.is_crisis === true,
    scripture: finished ? toScripture(row) : null,
    devotional: finished ? toDevotional(row) : null,
    prayer: toPrayer(row, finished),
    failureCode: pick(ERROR_CODES, row.error_code),
    isLocalOnly: status === "pending" || status === "uploading",
  };
  const slotOrder = (item: Affirmation) => TIME_SLOTS.indexOf(item.slot);
  return {
    entry,
    // A crisis entry never has affirmations.
    affirmations: row.is_crisis === true
      ? []
      : affirmations.map(toAffirmation).sort((a, b) => slotOrder(a) - slotOrder(b)),
  };
}
