import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../errors.ts";

// Everything one person has in the database, for the export (step 31): their profile row, every entry oldest first, and each
// entry's affirmations under it. The service role bypasses row level security, so every query filters by the person: the
// profile by its id, the other tables by user_id. The email is never read (Clerk has it; the session token does not carry it).

export const ROW_PAGE_SIZE = 500;
const SLOT_ORDER = ["morning", "afternoon", "evening"];

export type UserRow = Record<string, unknown>;
export type UserEntry = UserRow & { affirmations: UserRow[] };
export type UserData = { profile: UserRow | null; entries: UserEntry[] };

async function readAll(admin: SupabaseClient, table: string, userId: string): Promise<UserRow[]> {
  const rows: UserRow[] = [];
  for (let from = 0;; from += ROW_PAGE_SIZE) {
    const { data, error } = await admin.from(table).select("*").eq("user_id", userId)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + ROW_PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new AppError("INTERNAL", "db:export_read");
    rows.push(...(data as UserRow[]));
    if (data.length < ROW_PAGE_SIZE) return rows;
  }
}

export async function collectUserData(admin: SupabaseClient, userId: string): Promise<UserData> {
  const { data: profile, error } = await admin.from("users_profile").select("*").eq("id", userId).maybeSingle();
  if (error) throw new AppError("INTERNAL", "db:export_read");
  const entries = await readAll(admin, "journal_entries", userId);
  const affirmations = await readAll(admin, "daily_affirmations", userId);

  const byEntry = new Map<unknown, UserRow[]>();
  for (const row of affirmations) {
    const list = byEntry.get(row.entry_id) ?? [];
    list.push(row);
    byEntry.set(row.entry_id, list);
  }
  const slot = (row: UserRow) => SLOT_ORDER.indexOf(String(row.time_slot));
  return {
    profile: (profile as UserRow | null) ?? null,
    entries: entries.map((entry) => ({
      ...entry,
      affirmations: (byEntry.get(entry.id) ?? []).sort((a, b) => slot(a) - slot(b)),
    })),
  };
}
