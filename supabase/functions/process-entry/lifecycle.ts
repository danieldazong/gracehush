import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../_shared/errors.ts";
import { CLAIM_LEASE_MS } from "./constants.ts";
import type { InputType, ProcessEntryRequest, TimeSlot } from "./contracts.ts";

// Every database call of the function lives here. The service-role client bypasses row level security, so each query
// on a user's table filters by the verified user id, with no exceptions.

export type EntryRow = {
  id: string;
  user_id: string;
  client_entry_id: string | null;
  created_at: string;
  updated_at: string;
  input_type: string;
  transcript: string | null;
  audio_path: string | null;
  processing_status: string;
  error_code: string | null;
  is_crisis: boolean;
  dominant_emotion: string | null;
  scripture_reference: string | null;
  scripture_text: string | null;
  scripture_verified: boolean;
  devotional_title: string | null;
  devotional_script: string | null;
  closing_prayer: string | null;
  devotional_audio_path: string | null;
  devotional_duration_ms: number | null;
  is_active_prayer: boolean;
  is_answered: boolean;
  answered_at: string | null;
  answered_notes: string | null;
  prayer_title: string | null;
  prayer_category: string | null;
  prayer_summary: string | null;
};

export type AffirmationRow = {
  id: string;
  user_id: string;
  entry_id: string;
  time_slot: string;
  headline: string;
  affirmation_text: string;
  is_favorite: boolean;
};

// What a database failure may tell the log: the operation and Postgres' own error code, never its message.
export function dbFailure(operation: string, error: { code?: string } | null): AppError {
  return new AppError("INTERNAL", `db:${operation}:${error?.code || "error"}`);
}

export async function ensureProfile(admin: SupabaseClient, userId: string): Promise<void> {
  // The profile row is what every entry belongs to. Insert it only when it is missing; never touch the plan or the
  // reminder times of a row that exists.
  const { error } = await admin.from("users_profile").upsert({ id: userId }, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) throw dbFailure("profile", error);
}

export async function findEntry(
  admin: SupabaseClient,
  userId: string,
  clientEntryId: string,
): Promise<EntryRow | null> {
  const { data, error } = await admin.from("journal_entries").select("*")
    .eq("user_id", userId).eq("client_entry_id", clientEntryId).maybeSingle();
  if (error) throw dbFailure("find", error);
  return data as EntryRow | null;
}

// How many entries this user started since `sinceIso`, not counting `excludeId` (the entry being retried).
export async function countRecentEntries(
  admin: SupabaseClient,
  userId: string,
  sinceIso: string,
  excludeId: string | null,
): Promise<number> {
  let query = admin.from("journal_entries").select("id", { count: "exact", head: true })
    .eq("user_id", userId).gte("created_at", sinceIso);
  if (excludeId) query = query.neq("id", excludeId);
  const { count, error } = await query;
  if (error) throw dbFailure("count", error);
  return count ?? 0;
}

export type ClaimDecision =
  | { kind: "ready" }
  | { kind: "busy" }
  // `fromStatus` is the status the row must still have when it is claimed; `staleBefore` only for a lapsed claim.
  | { kind: "reclaim"; fromStatus: string; staleBefore: string | null };

// What to do with a row that already exists for this clientEntryId.
export function decideClaim(
  existing: Pick<EntryRow, "processing_status" | "updated_at">,
  nowMs: number,
): ClaimDecision {
  if (existing.processing_status === "ready") return { kind: "ready" };
  if (existing.processing_status === "processing") {
    const age = nowMs - Date.parse(existing.updated_at);
    // A claim that is still fresh belongs to a request that is running. An unreadable date counts as stale.
    if (Number.isFinite(age) && age < CLAIM_LEASE_MS) return { kind: "busy" };
    return { kind: "reclaim", fromStatus: "processing", staleBefore: new Date(nowMs - CLAIM_LEASE_MS).toISOString() };
  }
  // failed, and the client-only statuses a server never writes: claim it again.
  return { kind: "reclaim", fromStatus: existing.processing_status, staleBefore: null };
}

export type ClaimResult =
  | { kind: "claimed"; row: EntryRow }
  | { kind: "ready"; row: EntryRow }
  | { kind: "busy" };

function sameKind(existing: EntryRow, inputType: InputType): void {
  // One clientEntryId is one reflection. Reusing it for the other kind of input is a client bug.
  if (existing.input_type !== inputType) throw new AppError("INVALID_REQUEST", "input_type_changed");
}

// Takes the right to process one entry. Exactly one of two requests that arrive together gets "claimed": the other
// one sees the fresh claim and gets "busy".
export async function claimEntry(
  admin: SupabaseClient,
  userId: string,
  request: ProcessEntryRequest,
  existing: EntryRow | null,
  nowMs: number,
): Promise<ClaimResult> {
  let row = existing;

  if (row === null) {
    // INSERT ... ON CONFLICT (user_id, client_entry_id) DO NOTHING: nothing comes back when the row already exists.
    const { data, error } = await admin.from("journal_entries").upsert({
      user_id: userId,
      client_entry_id: request.clientEntryId,
      input_type: request.inputType,
      transcript: request.inputType === "text" ? request.text : null,
      audio_path: request.inputType === "audio" ? request.audioPath : null,
      processing_status: "processing",
    }, { onConflict: "user_id,client_entry_id", ignoreDuplicates: true }).select();
    if (error) throw dbFailure("claim", error);
    const inserted = data as EntryRow[];
    if (inserted.length === 1) return { kind: "claimed", row: inserted[0] };
    // Another request inserted it a moment ago.
    row = await findEntry(admin, userId, request.clientEntryId);
    if (row === null) throw new AppError("INTERNAL", "db:claim:vanished");
  }

  sameKind(row, request.inputType);
  const decision = decideClaim(row, nowMs);
  if (decision.kind === "ready") return { kind: "ready", row };
  if (decision.kind === "busy") return { kind: "busy" };

  // Compare-and-set: the update only matches while the row is still in the state we decided on, so of two requests
  // that both saw "failed" exactly one wins.
  let query = admin.from("journal_entries")
    .update({ processing_status: "processing", error_code: null })
    .eq("id", row.id).eq("user_id", userId).eq("processing_status", decision.fromStatus);
  if (decision.staleBefore) query = query.lt("updated_at", decision.staleBefore);
  const { data, error } = await query.select();
  if (error) throw dbFailure("reclaim", error);
  const won = data as EntryRow[];
  return won.length === 1 ? { kind: "claimed", row: won[0] } : { kind: "busy" };
}

// Marks a claimed entry failed. The person's text or recording stays saved. Never throws: the error being handled is
// the one that matters.
export async function failEntry(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
  code: string,
): Promise<void> {
  try {
    await admin.from("journal_entries").update({ processing_status: "failed", error_code: code })
      .eq("id", entryId).eq("user_id", userId);
  } catch {
    // Nothing more can be done; the claim lapses after CLAIM_LEASE_MS and the entry can be retried.
  }
}

export async function listAffirmations(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
): Promise<AffirmationRow[]> {
  const { data, error } = await admin.from("daily_affirmations").select("*")
    .eq("user_id", userId).eq("entry_id", entryId);
  if (error) throw dbFailure("affirmations_read", error);
  return data as AffirmationRow[];
}

async function replaceAffirmations(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
  affirmations: { slot: TimeSlot; headline: string; text: string }[],
): Promise<void> {
  // A retried entry may have rows from an earlier run: start from none, so there are exactly three.
  const removed = await admin.from("daily_affirmations").delete().eq("entry_id", entryId).eq("user_id", userId);
  if (removed.error) throw dbFailure("affirmations_delete", removed.error);
  if (affirmations.length === 0) return;
  // TODO(28): scheduled_for and is_delivered stay unset, because the phone schedules the notifications; step 28
  // confirms that with the user and closes this note.
  const inserted = await admin.from("daily_affirmations").insert(affirmations.map((item) => ({
    user_id: userId,
    entry_id: entryId,
    time_slot: item.slot,
    headline: item.headline,
    affirmation_text: item.text,
  })));
  if (inserted.error) throw dbFailure("affirmations_insert", inserted.error);
}

export type ReadyFields = {
  transcript: string | null;
  dominant_emotion: string;
  devotional_title: string;
  devotional_script: string;
  closing_prayer: string;
  // The passage as scripture.ts resolved it: a verified reference with its exact text, an unverified reference with no
  // text, or nothing at all. The table's scripture_verified_check refuses a verified flag without both.
  scripture_reference: string | null;
  scripture_text: string | null;
  scripture_verified: boolean;
  is_active_prayer: boolean;
  prayer_title: string | null;
  prayer_category: string | null;
  prayer_summary: string | null;
};

// The last write of a good run is the status change: until it lands the entry is still "processing", so an entry is
// never "ready" without its affirmations.
export async function saveReadyEntry(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
  fields: ReadyFields,
  affirmations: { slot: TimeSlot; headline: string; text: string }[],
): Promise<EntryRow> {
  await replaceAffirmations(admin, userId, entryId, affirmations);
  const { data, error } = await admin.from("journal_entries").update({
    ...fields,
    is_crisis: false,
    // TODO(22): speech, devotional_audio_path and devotional_duration_ms.
    devotional_audio_path: null,
    devotional_duration_ms: null,
    processing_status: "ready",
    error_code: null,
  }).eq("id", entryId).eq("user_id", userId).select();
  if (error) throw dbFailure("save_ready", error);
  const rows = data as EntryRow[];
  if (rows.length !== 1) throw new AppError("INTERNAL", "db:save_ready:no_row");
  return rows[0];
}

// A crisis entry keeps only is_crisis and what the person said. Every devotional, scripture and prayer column is
// cleared in the same statement, which is what the table's crisis checks require, and its affirmations are removed
// (a retry of an entry that was once saved as a reflection starts from none). Nothing about why it is a crisis is kept:
// no category, no source, no phrase.
//
// If any part of this fails, the whole thing is a plain 500 with the reason crisis_save_failed and the caller never
// falls back to a devotional: the person can send the same entry again.
//
// TODO(22): a crisis entry never counts toward the free-tier limit, so the weekly count must skip is_crisis rows.
// TODO(28): never schedule affirmations for a crisis entry (it has none, and the phone must not make any up).
export async function saveCrisisEntry(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
  transcript: string | null,
): Promise<EntryRow> {
  try {
    await replaceAffirmations(admin, userId, entryId, []);
    const { data, error } = await admin.from("journal_entries").update({
      is_crisis: true,
      transcript,
      dominant_emotion: null,
      devotional_title: null,
      devotional_script: null,
      closing_prayer: null,
      devotional_audio_path: null,
      devotional_duration_ms: null,
      scripture_reference: null,
      scripture_text: null,
      scripture_verified: false,
      is_active_prayer: false,
      prayer_title: null,
      prayer_category: null,
      prayer_summary: null,
      processing_status: "ready",
      error_code: null,
    }).eq("id", entryId).eq("user_id", userId).select();
    if (error) throw dbFailure("save_crisis", error);
    const rows = data as EntryRow[];
    if (rows.length !== 1) throw new AppError("INTERNAL", "db:save_crisis:no_row");
    return rows[0];
  } catch {
    throw new AppError("INTERNAL", "crisis_save_failed");
  }
}
