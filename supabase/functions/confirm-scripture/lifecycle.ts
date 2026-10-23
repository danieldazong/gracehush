import type { SupabaseClient } from "@supabase/supabase-js";

import { dbFailure, type EntryRow } from "../process-entry/lifecycle.ts";

// Every database call of confirm-scripture. The service-role client bypasses row level security, so each query filters
// by the verified user id, with no exceptions.

export async function findEntryById(admin: SupabaseClient, userId: string, entryId: string): Promise<EntryRow | null> {
  const { data, error } = await admin.from("journal_entries").select("*")
    .eq("user_id", userId).eq("id", entryId).maybeSingle();
  if (error) throw dbFailure("find_by_id", error);
  return data as EntryRow | null;
}

export type ScriptureFields = {
  scripture_reference: string | null;
  scripture_text: string | null;
  scripture_verified: boolean;
};

// Writes the passage of a finished entry that has not been verified yet. The update only matches while the entry is
// still ready, still not a crisis entry and still unverified, so a second request that got there first is not
// overwritten and a crisis entry is never given a passage. Null when nothing matched.
export async function saveScripture(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
  fields: ScriptureFields,
): Promise<EntryRow | null> {
  const { data, error } = await admin.from("journal_entries").update(fields)
    .eq("id", entryId).eq("user_id", userId)
    .eq("processing_status", "ready").eq("is_crisis", false).eq("scripture_verified", false)
    .select();
  if (error) throw dbFailure("save_scripture", error);
  const rows = data as EntryRow[];
  return rows.length === 1 ? rows[0] : null;
}
