import type { DailyAffirmationRow, JournalEntryRow, JournalEntryUpdate } from "@/types/database";

// The columns the app reads from journal_entries and daily_affirmations (step 25): always an explicit list, never `*`.
// Left out on purpose: audio_path (where the raw recording is stored: the app wrote it and never shows it) and user_id (the
// filter uses it, nothing displays it). The lists are literal types, so supabase-js gives each query the exact row type,
// and the two types below make the compiler check that a list still holds every column the mappers read.
export const ENTRY_COLUMNS =
  "id, client_entry_id, input_type, transcript, dominant_emotion, processing_status, error_code, is_crisis, scripture_reference, scripture_text, scripture_verified, devotional_title, devotional_script, closing_prayer, devotional_audio_path, devotional_duration_ms, is_active_prayer, is_answered, answered_at, answered_notes, prayer_title, prayer_category, prayer_summary, created_at, updated_at" as const;

export const AFFIRMATION_COLUMNS = "id, entry_id, time_slot, headline, affirmation_text, is_favorite" as const;

// What toJournalEntry and toAffirmation (src/data/mappers.ts) read. A full row of either table is one of these too.
export type EntryRow = Omit<JournalEntryRow, "audio_path" | "user_id">;
export type AffirmationRow = Pick<
  DailyAffirmationRow,
  "id" | "entry_id" | "time_slot" | "headline" | "affirmation_text" | "is_favorite"
>;

// The prayer columns the app changes (step 29), and a change to them keyed by column. prayer_category is granted to the app
// too (step 18) and nothing in it writes the category; prayer_summary, prayer_title and every other column are the server's.
export const PRAYER_PATCH_COLUMNS = ["is_active_prayer", "is_answered", "answered_at", "answered_notes"] as const;
export type PrayerPatch = Pick<JournalEntryUpdate, (typeof PRAYER_PATCH_COLUMNS)[number]>;
