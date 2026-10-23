// The database types. The row types come from src/types/supabase.ts, which is generated from the real database and
// never edited by hand (see "Regenerating the types" in AGENTS.md, Database Rules). This file only narrows what the
// signed-in app may SEND, so a column the database would refuse is a compile error here instead of an HTTP 403.
import type { Database as GeneratedDatabase } from "@/types/supabase";

type GeneratedTables = GeneratedDatabase["public"]["Tables"];

export type UserProfileRow = GeneratedTables["users_profile"]["Row"];
export type JournalEntryRow = GeneratedTables["journal_entries"]["Row"];
export type DailyAffirmationRow = GeneratedTables["daily_affirmations"]["Row"];

// The columns the `authenticated` role is granted (supabase/migrations/20261022120100_gracehush_v1_schema.sql, section 6).
// subscription_tier, created_at, updated_at and last_active_at are not here on purpose: only the server writes them.
export type UserProfileInsert = Pick<
  GeneratedTables["users_profile"]["Insert"],
  | "id"
  | "reminder_morning"
  | "reminder_afternoon"
  | "reminder_evening"
  | "timezone"
  | "affirmations_enabled"
  | "ambient_sound"
  | "ambient_volume"
>;
export type UserProfileUpdate = Omit<UserProfileInsert, "id">;

// The app never inserts or deletes an entry or an affirmation (the Edge Function does), and changes only these.
export type JournalEntryUpdate = Pick<
  GeneratedTables["journal_entries"]["Update"],
  "is_active_prayer" | "is_answered" | "answered_at" | "answered_notes" | "prayer_category"
>;
export type DailyAffirmationUpdate = Pick<GeneratedTables["daily_affirmations"]["Update"], "is_favorite">;

// The shape supabase-js wants: the generated database with the three tables narrowed. `Insert: never` makes
// `.insert()` and `.upsert()` on a table the app may not insert into a type error.
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & {
    Tables: {
      users_profile: Omit<GeneratedTables["users_profile"], "Insert" | "Update"> & {
        Insert: UserProfileInsert;
        Update: UserProfileUpdate;
      };
      journal_entries: Omit<GeneratedTables["journal_entries"], "Insert" | "Update"> & {
        Insert: never;
        Update: JournalEntryUpdate;
      };
      daily_affirmations: Omit<GeneratedTables["daily_affirmations"], "Insert" | "Update"> & {
        Insert: never;
        Update: DailyAffirmationUpdate;
      };
    };
  };
};
