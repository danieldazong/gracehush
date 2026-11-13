import { AMBIENT_SOUNDS, DEFAULT_REMINDERS } from "@/constants/app";
import { copy } from "@/constants/copy";
import type {
  Affirmation,
  Devotional,
  HelpKind,
  InputType,
  JournalEntry,
  Prayer,
  PrayerCategory,
  ProcessingStatus,
  ScholarBlock,
  ScholarConversation,
  ScholarMessage,
  ScholarMessageStatus,
  Scripture,
  StoredErrorCode,
  SubscriptionTier,
  TimeSlot,
  UserProfile,
} from "@/types";
import type { AffirmationRow, ConversationRow, EntryRow, MessageRow } from "@/data/columns";
import type { UserProfileRow } from "@/types/database";
import { affirmationPosition } from "@/utils/affirmationOrder";

const TIME_SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];
const INPUT_TYPES: readonly InputType[] = ["text", "audio"];
const HELP_KINDS: readonly HelpKind[] = ["crisis", "abuse", "harm_others", "emergency"];
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
  "RATE_LIMITED",
  "INTERNAL",
  "AI_UNAVAILABLE",
  "TTS_FAILED",
];

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

export function toAffirmation(row: AffirmationRow): Affirmation {
  // 2026-11-09: an affirmation added beyond the first three carries no lock-screen slot, and a slot the app does not know reads
  // as none. Its position is the server's, or its slot's place for a row from before the column. The server's response.ts has
  // the same rules.
  const slot = pick(TIME_SLOTS, row.time_slot);
  return {
    id: row.id,
    entryId: row.entry_id,
    slot,
    position: affirmationPosition(row.position, slot),
    headline: row.headline,
    text: row.affirmation_text,
    isFavorite: row.is_favorite === true,
    // Step 37: both or neither (the table's affirmation_verse_pair rule); an affirmation without them has no verse.
    verse: row.verse_reference && row.verse_text ? { reference: row.verse_reference, text: row.verse_text } : null,
  };
}

function getStatus(row: EntryRow): ProcessingStatus {
  return pick(STATUSES, row.processing_status) ?? "ready";
}

// Scripture, devotional, prayer and emotion exist only on a finished entry. A heavy moment (is_crisis) is a whole reflection
// since 2026-11-08 and is mapped like any other; one saved before then holds none of them, so they come out empty from the row
// alone. The server's response.ts has the same rule.
function isFinished(row: EntryRow): boolean {
  return getStatus(row) === "ready";
}

function toScripture(row: EntryRow): Scripture | null {
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

function toDevotional(row: EntryRow): Devotional | null {
  if (!row.devotional_script) return null;
  return {
    title: row.devotional_title || copy.common.defaultDevotionalTitle,
    validation: row.validation_line ?? null,
    script: row.devotional_script,
    closingPrayer: row.closing_prayer ?? null,
    audioPath: row.devotional_audio_path || null,
    durationMs: row.devotional_duration_ms ?? null,
  };
}

// is_active_prayer means "tracked as a prayer"; an answered prayer may or may not keep it.
export function toPrayer(row: EntryRow): Prayer | null {
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

export function toJournalEntry(row: EntryRow): JournalEntry {
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
    // 2026-11-11: the help line a heavy moment shows. One saved before the column existed shows the 988 line.
    helpLine: row.is_crisis === true ? (pick(HELP_KINDS, row.help_line) ?? "crisis") : null,
    scripture: finished ? toScripture(row) : null,
    devotional: finished ? toDevotional(row) : null,
    prayer: toPrayer(row),
    failureCode: pick(ERROR_CODES, row.error_code),
    // A pending or uploading row exists only on this device (decision 9; step 24 may replace it).
    isLocalOnly: status === "pending" || status === "uploading",
  };
}

// ---- Scholar (step 38) -------------------------------------------------------------------------------------------------
// A saved conversation and message as the app shows them: the same rules as the server's supabase/functions/scholar-turn/
// response.ts, so a message read from the table equals the one an answer brought.

const MESSAGE_STATUSES: readonly ScholarMessageStatus[] = ["pending", "ready", "failed"];

export function toConversation(row: ConversationRow): ScholarConversation {
  return {
    id: row.id,
    entryId: row.entry_id,
    title: row.title,
    isHeavy: row.is_heavy,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A saved block, or null for one that does not have the shape of one (never shown). A passage is saved as its reference and the
// Bible's words, and Scholar never saves one it did not read: it is verified BSB scripture.
function toBlock(block: unknown): ScholarBlock | null {
  if (!isObject(block)) return null;
  const { type, text, reference } = block;
  if (typeof text !== "string" || text === "") return null;
  if (type === "text" || type === "prayer") return { type, text };
  if (type === "passage" && typeof reference === "string" && reference !== "") {
    return { type: "passage", scripture: { reference, text, translation: "BSB", verified: true } };
  }
  return null;
}

export function toScholarMessage(row: MessageRow): ScholarMessage {
  const content = isObject(row.content) ? row.content : null;
  const blocks = content !== null && Array.isArray(content.blocks) ? content.blocks : [];
  const help = content?.help;
  const role = row.role === "scholar" ? "scholar" : "user";
  const isHeavy = row.is_heavy === true;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role,
    replyTo: row.reply_to,
    inputType: row.input_type === "text" || row.input_type === "audio" ? row.input_type : null,
    status: pick(MESSAGE_STATUSES, row.status) ?? "failed",
    errorCode: row.error_code,
    blocks: blocks.map(toBlock).filter((block): block is ScholarBlock => block !== null),
    isHeavy,
    // An answer that carries a help line shows the one saved with it; one saved before 2026-11-11 shows the 988 line.
    helpLine: role === "scholar" && isHeavy ? (pick(HELP_KINDS, typeof help === "string" ? help : null) ?? "crisis") : null,
    createdAt: row.created_at,
  };
}
