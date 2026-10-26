import { copy } from "@/constants/copy";
import {
  AFFIRMATION_COLUMNS,
  ENTRY_COLUMNS,
  type AffirmationRow,
  type EntryRow,
} from "@/data/columns";
import { getSupabase, getSupabaseUserId } from "@/services/supabaseClient";
import type { RepoResult } from "@/types";
import { describeFailure, toFailureCode } from "@/utils/supabaseErrors";
import { normalizeTimestamp } from "@/utils/timestamp";

// The only code that sends a request about journal_entries and daily_affirmations (step 25), as profileRemote.ts is for
// users_profile. It reads with the explicit column lists of data/columns.ts and writes only what the migration grants the app:
// is_favorite. Every query filters by the user's id as well as relying on row level security. Nothing here logs more than a
// table and an error code.

// The statuses the Journal lists. A failed entry is not listed: the phone that made it keeps it as a card of its own until it
// is prepared, and a refused or deleted one is no reflection (step 25).
const LISTED_STATUSES = ["ready", "processing"];

let lastError: string | null = null;

// For the dev panel's Supabase check: the table and code of the last failure, or null after a success.
export function getLastEntriesError(): string | null {
  return lastError;
}

function unauthorized(message: string): RepoResult<never> {
  lastError = "no session";
  return { ok: false, code: "UNAUTHORIZED", message };
}

function fail(
  table: string,
  status: number,
  error: { message?: string | null; code?: string | null },
  message: string,
): RepoResult<never> {
  lastError = describeFailure(table, status, error);
  if (__DEV__) {
    // Only the table and the code, never a message, a row, a token or an id.
    console.warn(`[supabase] ${lastError}`);
  }
  return { ok: false, code: toFailureCode(status, error), message };
}

export type EntryRows = {
  // The page, with its times in the form the app keeps (utils/timestamp.ts).
  rows: EntryRow[];
  // The created_at to ask the next page from, exactly as the server wrote it (microseconds and all: PostgREST compares them), or
  // null when there is no row older than this page (the page was asked for one row more than it holds).
  nextCursor: string | null;
  // How many entries the Journal lists in all. Known for the first page only: a later page counts only what is older.
  total: number | null;
};

// The times of a row in the form the app keeps them. The rest of the row is untouched.
function withCanonicalTimes(row: EntryRow): EntryRow {
  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
    answered_at: row.answered_at === null ? null : normalizeTimestamp(row.answered_at),
  };
}

// One page of the Journal, newest first. `cursor` is the created_at of the last row of the page before, or null for the first.
export async function selectEntriesPage(cursor: string | null, limit: number): Promise<RepoResult<EntryRows>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.journal.error.message);
  let query = supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .in("processing_status", LISTED_STATUSES)
    .order("created_at", { ascending: false });
  if (cursor !== null) query = query.lt("created_at", cursor);
  const { data, error, status, count } = await query.limit(limit + 1);
  if (error !== null) return fail("journal_entries", status, error, copy.journal.error.message);
  lastError = null;
  const page = data.slice(0, limit);
  const last = page[page.length - 1];
  return {
    ok: true,
    data: {
      rows: page.map(withCanonicalTimes),
      nextCursor: data.length > limit && last !== undefined ? last.created_at : null,
      total: cursor === null ? count : null,
    },
  };
}

// One entry of any status, or null when there is none (or it is not this user's).
export async function selectEntry(id: string): Promise<RepoResult<EntryRow | null>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.journal.error.message);
  const { data, error, status } = await supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) return fail("journal_entries", status, error, copy.journal.error.message);
  lastError = null;
  return { ok: true, data: data === null ? null : withCanonicalTimes(data) };
}

// The affirmations of one entry (three for a finished reflection, none for any other).
export async function selectAffirmations(entryId: string): Promise<RepoResult<AffirmationRow[]>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.journal.error.message);
  const { data, error, status } = await supabase
    .from("daily_affirmations")
    .select(AFFIRMATION_COLUMNS)
    .eq("entry_id", entryId)
    .eq("user_id", userId);
  if (error !== null) return fail("daily_affirmations", status, error, copy.journal.error.message);
  lastError = null;
  return { ok: true, data };
}

// The one column of daily_affirmations the app may write. An update that changes no row means the affirmation is missing or
// not this user's.
export async function updateAffirmationFavorite(id: string, value: boolean): Promise<RepoResult<AffirmationRow>> {
  const message = copy.journal.affirmation.saveError;
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(message);
  const { data, error, status } = await supabase
    .from("daily_affirmations")
    .update({ is_favorite: value })
    .eq("id", id)
    .eq("user_id", userId)
    .select(AFFIRMATION_COLUMNS);
  if (error !== null) return fail("daily_affirmations", status, error, message);
  lastError = null;
  const row = data[0];
  return row === undefined ? { ok: false, code: "NOT_FOUND", message } : { ok: true, data: row };
}
