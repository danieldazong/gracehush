import type {
  DailyAffirmationRow,
  JournalEntryRow,
  JournalEntryUpdate,
  ScholarConversationRow,
  ScholarMessageRow,
} from "@/types/database";

// The columns the app reads from journal_entries and daily_affirmations (step 25): always an explicit list, never `*`.
// Left out on purpose: audio_path (where the raw recording is stored: the app wrote it and never shows it) and user_id (the
// filter uses it, nothing displays it). The lists are literal types, so supabase-js gives each query the exact row type,
// and the two types below make the compiler check that a list still holds every column the mappers read.
export const ENTRY_COLUMNS =
  "id, client_entry_id, input_type, transcript, dominant_emotion, processing_status, error_code, is_crisis, help_line, scripture_reference, scripture_text, scripture_verified, devotional_title, validation_line, devotional_script, closing_prayer, devotional_audio_path, devotional_duration_ms, is_active_prayer, is_answered, answered_at, answered_notes, prayer_title, prayer_category, prayer_summary, created_at, updated_at" as const;

// Step 37: verse_reference and verse_text, the Bible verse under the affirmation (both or neither; null before step 37).
// 2026-11-09: position, its place among the reflection's affirmations (1 to 10), and time_slot is null for an added one.
export const AFFIRMATION_COLUMNS =
  "id, entry_id, time_slot, position, headline, affirmation_text, is_favorite, verse_reference, verse_text" as const;

// What toJournalEntry and toAffirmation (src/data/mappers.ts) read. A full row of either table is one of these too.
export type EntryRow = Omit<JournalEntryRow, "audio_path" | "user_id">;
export type AffirmationRow = Pick<
  DailyAffirmationRow,
  | "id"
  | "entry_id"
  | "time_slot"
  | "position"
  | "headline"
  | "affirmation_text"
  | "is_favorite"
  | "verse_reference"
  | "verse_text"
>;

// The prayer columns the app changes (step 29), and a change to them keyed by column. prayer_category is granted to the app
// too (step 18) and nothing in it writes the category; prayer_summary, prayer_title and every other column are the server's.
export const PRAYER_PATCH_COLUMNS = ["is_active_prayer", "is_answered", "answered_at", "answered_notes"] as const;
export type PrayerPatch = Pick<JournalEntryUpdate, (typeof PRAYER_PATCH_COLUMNS)[number]>;

// Scholar (step 38): the app reads its own conversations and messages, and writes nothing but a conversation's deletion. Left out:
// user_id (the filter uses it) and claimed_at (the server's lock on a message it is answering).
export const CONVERSATION_COLUMNS = "id, entry_id, title, is_heavy, last_message_at, created_at" as const;
export const SCHOLAR_MESSAGE_COLUMNS =
  "id, conversation_id, role, reply_to, input_type, status, error_code, content, is_heavy, created_at" as const;
export type ConversationRow = Omit<ScholarConversationRow, "user_id">;
export type MessageRow = Omit<ScholarMessageRow, "user_id" | "claimed_at">;
