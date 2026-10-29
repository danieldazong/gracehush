import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../_shared/errors.ts";
import { dbFailure } from "../process-entry/lifecycle.ts";

// Every storage and database call of delete-entry (step 29b). The service-role client bypasses row level security, so each
// query on a user's table filters by the verified user id, with no exceptions.

const BUCKET = "journal_media";

// A record of a deleted devotional older than this can never fall inside a week (a week is at most 7 days, plus a day of
// daylight saving), so the next delete of the same person removes it.
export const RECORD_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

export type EntryToDelete = {
  id: string;
  client_entry_id: string | null;
  created_at: string;
  updated_at: string;
  processing_status: string;
  audio_path: string | null;
  devotional_audio_path: string | null;
  // The free tier counted this one: it is not a crisis entry and it holds a devotional (checkDevotionalLimit's own rule).
  counted: boolean;
};

type EntryRow = Omit<EntryToDelete, "counted"> & { is_crisis: boolean; devotional_script: string | null };

export async function findEntryToDelete(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
): Promise<EntryToDelete | null> {
  const { data, error } = await admin.from("journal_entries")
    .select(
      "id, client_entry_id, created_at, updated_at, processing_status, is_crisis, audio_path, devotional_audio_path, devotional_script",
    )
    .eq("user_id", userId).eq("id", entryId).maybeSingle();
  if (error) throw dbFailure("find_to_delete", error);
  if (data === null) return null;
  // devotional_script is read only to know whether it is there: it is never kept, logged or returned.
  const { is_crisis: isCrisis, devotional_script: script, ...rest } = data as EntryRow;
  return { ...rest, counted: !isCrisis && script !== null };
}

// What Storage holds for this reflection: what its columns say, plus the two names the functions give (so a file whose path was
// never saved is removed too). Only paths inside the person's own folder are ever removed, whatever a column holds.
export function deletableFiles(userId: string, entry: EntryToDelete): string[] {
  const own = `${userId}/`;
  const names = [
    entry.audio_path,
    entry.devotional_audio_path,
    entry.client_entry_id === null ? null : `${own}raw/${entry.client_entry_id}.m4a`,
    `${own}devotionals/${entry.id}.wav`,
  ];
  const safe = names.filter((name): name is string =>
    typeof name === "string" && name.startsWith(own) && !name.includes("..")
  );
  return [...new Set(safe)];
}

// A path that is not there is not an error: Storage answers with the objects it removed. The reason is ours, never the
// provider's words (those can quote a path).
export async function removeFiles(admin: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(BUCKET).remove(paths);
  if (error) throw new AppError("INTERNAL", "storage_remove_failed");
}

// One row for a devotional that counted this week, written before the reflection is deleted, so deleting it does not give the
// slot back. A second request for the same reflection leaves the first row as it is.
export async function recordDeletedDevotional(
  admin: SupabaseClient,
  userId: string,
  entry: EntryToDelete,
): Promise<void> {
  const { error } = await admin.from("deleted_devotionals").upsert(
    { entry_id: entry.id, user_id: userId, made_at: entry.created_at },
    { onConflict: "entry_id", ignoreDuplicates: true },
  );
  if (error) throw dbFailure("record_deleted", error);
}

// Best effort: the reflection is still there, so its devotional must not count twice while it waits for the retry.
export async function forgetDeletedDevotional(admin: SupabaseClient, userId: string, entryId: string): Promise<void> {
  try {
    await admin.from("deleted_devotionals").delete().eq("entry_id", entryId).eq("user_id", userId);
  } catch {
    // The retry settles it.
  }
}

// The affirmations go with the row (foreign key, on delete cascade). How many rows went: 0 means another request got there first.
export async function deleteEntryRow(admin: SupabaseClient, userId: string, entryId: string): Promise<number> {
  const { data, error } = await admin.from("journal_entries").delete()
    .eq("id", entryId).eq("user_id", userId).select("id");
  if (error) throw dbFailure("delete_entry", error);
  return (data as { id: string }[]).length;
}

// Housekeeping: this person's records that can never matter again. Its failure changes nothing.
export async function pruneDeletedDevotionals(
  admin: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<void> {
  try {
    await admin.from("deleted_devotionals").delete().eq("user_id", userId)
      .lt("made_at", new Date(nowMs - RECORD_KEEP_MS).toISOString());
  } catch {
    // Housekeeping.
  }
}
