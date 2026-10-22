import { copy } from "@/constants/copy";
import { getSupabase, getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import type { RepoResult, TimeSlot } from "@/types";
import type { UserProfileRow } from "@/types/database";
import { describeFailure, toFailureCode } from "@/utils/supabaseErrors";

// The only code that sends a request about users_profile. Step 17 reads and writes the row's reminder times and
// reads the rest; everything else about the profile is still on this device (TODO(18)).

let lastError: string | null = null;

// For the dev panel's Supabase check: the code of the last failure, or null after a success.
export function getLastProfileError(): string | null {
  return lastError;
}

function unauthorized(): RepoResult<never> {
  lastError = "no session";
  return { ok: false, code: "UNAUTHORIZED", message: copy.profile.errors.load };
}

function fail(status: number, error: { message?: string | null; code?: string | null }): RepoResult<never> {
  const code = toFailureCode(status, error);
  lastError = describeFailure("users_profile", status, error);
  if (__DEV__) {
    // Only the table and the code, never a message, a row, a token or an id.
    console.warn(`[supabase] ${lastError}`);
    if (error.code === "42501") {
      console.warn(
        "[supabase] row level security refused the request: check the Clerk integration and that supabase/schema.sql was run",
      );
    }
  }
  return { ok: false, code, message: copy.profile.errors.load };
}

// "08:00" to the "08:00:00" a TIME column takes.
function toTimeColumn(hhmm: string): string {
  return `${hhmm}:00`;
}

// The signed-in user's row, or null when there is none yet. RLS shows only their own row; the filter is for clarity.
export async function selectProfileRow(): Promise<RepoResult<UserProfileRow | null>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { data, error, status } = await supabase
    .from("users_profile")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error !== null) return fail(status, error);
  lastError = null;
  return { ok: true, data };
}

// How many rows of users_profile this user can see. Row level security must make it 1 (or 0 before the row exists),
// whatever the table holds: the dev panel's Supabase check shows it.
export async function countVisibleProfileRows(): Promise<RepoResult<number>> {
  const supabase = getSupabase();
  if (supabase === null) return unauthorized();
  const { count, error, status } = await supabase
    .from("users_profile")
    .select("*", { count: "exact", head: true });
  if (error !== null) return fail(status, error);
  lastError = null;
  return { ok: true, data: count ?? 0 };
}

// The row, created from this device's reminder times if the account has none yet. The insert never overwrites a
// row that exists (ON CONFLICT DO NOTHING), so two devices signing in together cannot fight over it. The app can
// send only the columns it has an INSERT grant on (id and the three times): the plan is always the database default.
export async function fetchOrCreateProfileRow(): Promise<RepoResult<UserProfileRow>> {
  const found = await selectProfileRow();
  if (!found.ok) return found;
  if (found.data !== null) return { ok: true, data: found.data };

  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { reminders } = useOnboardingStore.getState();
  const { error, status } = await supabase.from("users_profile").upsert(
    {
      id: userId,
      reminder_morning: toTimeColumn(reminders.morning),
      reminder_afternoon: toTimeColumn(reminders.afternoon),
      reminder_evening: toTimeColumn(reminders.evening),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error !== null) return fail(status, error);

  // Read it back: either this insert or another device's made the row.
  const created = await selectProfileRow();
  if (!created.ok) return created;
  return created.data === null
    ? { ok: false, code: "UNKNOWN", message: copy.profile.errors.load }
    : { ok: true, data: created.data };
}

// Writes the three reminder times. An update that changes no row means the row is missing or hidden from this user.
export async function pushReminderColumns(
  times: Record<TimeSlot, string>,
): Promise<RepoResult<UserProfileRow>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { data, error, status } = await supabase
    .from("users_profile")
    .update({
      reminder_morning: toTimeColumn(times.morning),
      reminder_afternoon: toTimeColumn(times.afternoon),
      reminder_evening: toTimeColumn(times.evening),
    })
    .eq("id", userId)
    .select();
  if (error !== null) return fail(status, error);
  lastError = null;
  const row = data[0];
  return row === undefined
    ? { ok: false, code: "NOT_FOUND", message: copy.profile.errors.load }
    : { ok: true, data: row };
}
