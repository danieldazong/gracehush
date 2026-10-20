import { AMBIENT_SOUNDS, DEFAULT_REMINDERS } from "@/constants/app";
import { copy } from "@/constants/copy";
import type {
  Affirmation,
  Devotional,
  InputType,
  JournalEntry,
  Prayer,
  PrayerCategory,
  ProcessingStatus,
  Scripture,
  StoredErrorCode,
  SubscriptionTier,
  TimeSlot,
  UserProfile,
} from "@/types";
import type { DailyAffirmationRow, JournalEntryRow, UserProfileRow } from "@/types/database";

const TIME_SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];
const INPUT_TYPES: readonly InputType[] = ["text", "audio"];
const TIERS: readonly SubscriptionTier[] = ["free", "trial", "pro"];
const STATUSES: readonly ProcessingStatus[] = [
  "pending",
  "uploading",
  "processing",
  "ready",
  "failed",
];
const PRAYER_CATEGORIES: readonly PrayerCategory[] = [
  "FAMILY & HEALING",
  "VOCATION & CALLING",
  "INNER PEACE",
  "RELATIONSHIPS",
  "PROVISION",
  "GUIDANCE",
];
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

// Where the old public devotional URLs keep the storage path (the same backfill step 18 does).
const PUBLIC_AUDIO_MARKER = "/storage/v1/object/public/journal_media/";

// The allowed value equal to `value`, else null. Unknown strings never reach the app models.
function pick<T extends string>(allowed: readonly T[], value: string | null | undefined): T | null {
  return allowed.find((item) => item === value) ?? null;
}

// "08:00:00" to "08:00".
function toHHmm(value: string | null | undefined, fallback: string): string {
  const match = value ? /^(\d{2}:\d{2})(?::\d{2})?/.exec(value) : null;
  return match?.[1] ?? fallback;
}

export function getDeviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function toUserProfile(row: UserProfileRow): UserProfile {
  const volume = row.ambient_volume;
  return {
    id: row.id,
    createdAt: row.created_at,
    subscriptionTier: pick(TIERS, row.subscription_tier) ?? "free",
    reminders: {
      morning: toHHmm(row.reminder_morning, DEFAULT_REMINDERS.morning),
      afternoon: toHHmm(row.reminder_afternoon, DEFAULT_REMINDERS.afternoon),
      evening: toHHmm(row.reminder_evening, DEFAULT_REMINDERS.evening),
    },
    timezone: row.timezone || getDeviceTimezone(),
    ambientSound: pick(AMBIENT_SOUNDS, row.ambient_sound) ?? "off",
    ambientVolume:
      typeof volume === "number" && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.5,
    affirmationsEnabled: row.affirmations_enabled ?? true,
  };
}

export function toAffirmation(row: DailyAffirmationRow): Affirmation {
  return {
    id: row.id,
    entryId: row.entry_id,
    slot: pick(TIME_SLOTS, row.time_slot) ?? "morning",
    headline: row.headline,
    text: row.affirmation_text,
    isFavorite: row.is_favorite === true,
  };
}

function getStatus(row: JournalEntryRow): ProcessingStatus {
  return pick(STATUSES, row.processing_status) ?? "ready";
}

// Scripture, devotional, prayer and emotion exist only on a finished entry that is not a crisis.
function isFinished(row: JournalEntryRow): boolean {
  return getStatus(row) === "ready" && row.is_crisis !== true;
}

function toScripture(row: JournalEntryRow): Scripture | null {
  if (!row.scripture_reference) return null;
  const verified = row.scripture_verified === true;
  return {
    reference: row.scripture_reference,
    // Unverified scripture has no text, so a screen cannot render it by accident.
    text: verified ? (row.scripture_text ?? null) : null,
    translation: "BSB",
    verified,
  };
}

function audioPathFromPublicUrl(url: string | null): string | null {
  const start = url ? url.indexOf(PUBLIC_AUDIO_MARKER) : -1;
  if (!url || start === -1) return null;
  return url.slice(start + PUBLIC_AUDIO_MARKER.length) || null;
}

function toDevotional(row: JournalEntryRow): Devotional | null {
  if (!row.devotional_script) return null;
  return {
    title: row.devotional_title || copy.common.defaultDevotionalTitle,
    script: row.devotional_script,
    closingPrayer: row.closing_prayer ?? null,
    audioPath: row.devotional_audio_path || audioPathFromPublicUrl(row.devotional_audio_url),
    durationMs: row.devotional_duration_ms ?? null,
  };
}

// is_active_prayer means "tracked as a prayer"; an answered prayer may or may not keep it.
export function toPrayer(row: JournalEntryRow): Prayer | null {
  const isAnswered = row.is_answered === true;
  if (!isFinished(row) || !(row.is_active_prayer === true || isAnswered)) return null;
  return {
    id: row.id,
    title: row.prayer_title ?? "",
    category: pick(PRAYER_CATEGORIES, row.prayer_category),
    summary: row.prayer_summary ?? "",
    scriptureReference: row.scripture_reference ?? null,
    createdAt: row.created_at,
    isAnswered,
    answeredAt: isAnswered ? (row.answered_at ?? null) : null,
    answeredNote: isAnswered ? (row.answered_notes ?? null) : null,
  };
}

export function toJournalEntry(row: JournalEntryRow): JournalEntry {
  const status = getStatus(row);
  const finished = isFinished(row);
  return {
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
    prayer: toPrayer(row),
    failureCode: pick(ERROR_CODES, row.error_code),
    // A pending or uploading row exists only on this device (decision 9; step 24 may replace it).
    isLocalOnly: status === "pending" || status === "uploading",
  };
}
