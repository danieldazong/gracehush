import type { SupabaseClient } from "@supabase/supabase-js";

import { listAllFiles, removeAll } from "../_shared/account/storageFiles.ts";
import { AppError } from "../_shared/errors.ts";

// The storage and database halves of delete-account (step 31). The service role bypasses row level security, so every query
// filters by the verified user id: the profile by its id, the other tables by user_id, and every path removed is inside the
// person's own folder ({userId}/) of a bucket.

const BUCKETS = ["journal_media", "exports"] as const;
// Deleted one by one when the profile's cascade left rows behind. The affirmations go before their entries.
const TABLES = ["daily_affirmations", "journal_entries", "deleted_devotionals"] as const;

// Every file of the person in both buckets: recordings, devotional audio and exports. Answers how many went.
export async function removeUserFiles(admin: SupabaseClient, userId: string): Promise<number> {
  let removed = 0;
  for (const bucket of BUCKETS) {
    const files = await listAllFiles(admin, bucket, userId);
    removed += await removeAll(admin, bucket, files.map((file) => file.path));
  }
  return removed;
}

// The profile row, and with it (each table's user_id foreign key, on delete cascade) every entry, affirmation and record of a
// deleted devotional. Then each table is counted for this user, and anything left is deleted by hand: a cascade that did not
// happen is reported (`leftover`), never hidden. `profiles` is how many profile rows went: 1 the first time, 0 after.
export async function deleteUserRows(
  admin: SupabaseClient,
  userId: string,
): Promise<{ profiles: number; leftover: number }> {
  const { data, error } = await admin.from("users_profile").delete().eq("id", userId).select("id");
  if (error) throw new AppError("INTERNAL", "db:delete_profile");
  let leftover = 0;
  for (const table of TABLES) {
    const { count, error: countError } = await admin.from(table).select("user_id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw new AppError("INTERNAL", `db:count_${table}`);
    if (!count) continue;
    leftover += count;
    const { error: deleteError } = await admin.from(table).delete().eq("user_id", userId);
    if (deleteError) throw new AppError("INTERNAL", `db:delete_${table}`);
  }
  return { profiles: Array.isArray(data) ? data.length : 0, leftover };
}
