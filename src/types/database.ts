// Hand-written until step 18. Step 18 generates src/types/supabase.ts and this file then re-exports the row types from it.
// No Supabase project existed when this was written, so there was no live schema to copy. The base
// columns follow prompt 06 step 0, the planned ones follow AGENTS.md "Known Schema Gaps", and
// anything unsure is typed nullable. Step 18 checks all of it against the real database.

export interface UserProfileRow {
  id: string; // Clerk user id (text, never uuid)
  created_at: string;
  subscription_tier: string | null;
  reminder_morning: string | null; // TIME, "HH:mm:ss"
  reminder_afternoon: string | null;
  reminder_evening: string | null;
  last_active_at: string | null;

  // planned: migration in step 18
  timezone?: string | null;
  ambient_sound?: string | null;
  ambient_volume?: number | null;
  affirmations_enabled?: boolean | null;
  updated_at?: string | null;
}

// `embedding` (V2) is left out on purpose.
export interface JournalEntryRow {
  id: string;
  user_id: string;
  created_at: string;
  input_type: string | null;
  transcript: string | null;
  dominant_emotion: string | null;
  scripture_reference: string | null;
  scripture_text: string | null;
  devotional_script: string | null;
  devotional_audio_url: string | null; // DEPRECATED: use devotional_audio_path (step 22)
  is_active_prayer: boolean | null;
  is_answered: boolean | null;
  answered_at: string | null;

  // planned: migration in step 18
  client_entry_id?: string | null;
  processing_status?: string | null;
  error_code?: string | null;
  is_crisis?: boolean | null;
  audio_path?: string | null;
  devotional_audio_path?: string | null;
  devotional_duration_ms?: number | null;
  scripture_verified?: boolean | null;
  devotional_title?: string | null;
  closing_prayer?: string | null;
  prayer_title?: string | null;
  prayer_category?: string | null;
  prayer_summary?: string | null;
  answered_notes?: string | null;
  updated_at?: string | null;
}

export interface DailyAffirmationRow {
  id: string;
  user_id: string;
  entry_id: string;
  time_slot: string;
  headline: string;
  affirmation_text: string;
  is_delivered: boolean | null;
  created_at: string;

  // planned: migration in step 18
  is_favorite?: boolean | null;
  scheduled_for?: string | null;
}
