import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../_shared/errors.ts";
import type { TimeSlot } from "../process-entry/contracts.ts";
import { type AffirmationRow, dbFailure } from "../process-entry/lifecycle.ts";

// Every database call of add-affirmation that process-entry and confirm-scripture do not already have. The service-role client
// bypasses row level security, so each query filters by the verified user id, with no exceptions.

export type NewAffirmation = {
  user_id: string;
  entry_id: string;
  // Null: an affirmation added beyond the first three carries no lock-screen slot until feature_affirmation gives it one.
  time_slot: null;
  position: number;
  headline: string;
  affirmation_text: string;
  verse_reference: string | null;
  verse_text: string | null;
};

// Inserts the one new affirmation and answers the row as the database wrote it. A position already taken (two requests at
// once) is the table's unique rule, 23505: the second request is told the reflection is busy and nothing is written.
export async function insertAffirmation(admin: SupabaseClient, row: NewAffirmation): Promise<AffirmationRow> {
  const { data, error } = await admin.from("daily_affirmations").insert(row).select();
  if (error) {
    if (error.code === "23505") throw new AppError("ALREADY_PROCESSING", "affirmation_position_taken");
    throw dbFailure("affirmation_insert", error);
  }
  const rows = data as AffirmationRow[];
  if (rows.length !== 1) throw new AppError("INTERNAL", "db:affirmation_insert:no_row");
  return rows[0];
}

// The migration's feature_affirmation (2026-11-09): the affirmation that carries `slot` loses it and `affirmationId` takes it,
// in one transaction, so no moment shows two or none. The function itself refuses an affirmation that is not the entry's.
export async function featureAffirmation(
  admin: SupabaseClient,
  entryId: string,
  affirmationId: string,
  slot: TimeSlot,
): Promise<void> {
  const { error } = await admin.rpc("feature_affirmation", {
    p_entry: entryId,
    p_affirmation: affirmationId,
    p_slot: slot,
  });
  if (error) throw dbFailure("feature_affirmation", error);
}
