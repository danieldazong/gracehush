import { toUserProfile } from "@/data/mappers";
import { getProfileSource } from "@/data/mock/scenario";
import { fetchOrCreateProfileRow, pushReminderColumns } from "@/data/profileRemote";
import { copy } from "@/constants/copy";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { RepoResult, SubscriptionTier, TimeSlot } from "@/types";

// Keeps this device and users_profile in step (step 17): it makes sure the account has a row, remembers what the
// server says about the plan and the sign-up date, and moves the reminder times whichever way is newer.
// Nothing here shows an error to the user: a failure leaves the edit marked unsent and the next trigger tries again.

const REMINDER_SYNC_DEBOUNCE_MS = 800;
const FOREGROUND_SYNC_GAP_MS = 30_000;

const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];
const TIERS: readonly SubscriptionTier[] = ["free", "trial", "pro"];

type Times = Record<TimeSlot, string>;
export type ReminderAction = "mark-synced" | "push" | "apply-server";

export function sameTimes(a: Times, b: Times): boolean {
  return SLOTS.every((slot) => a[slot] === b[slot]);
}

// Equal: nothing to move. Different, and this device holds an edit the server has not seen: the edit wins, it is the
// newest thing the user did. Different and nothing unsent: the server has the newest times (another phone, or the
// table editor).
export function decideReminderSync(server: Times, local: Times, dirty: boolean): ReminderAction {
  if (sameTimes(server, local)) return "mark-synced";
  return dirty ? "push" : "apply-server";
}

function unauthorized(): RepoResult<never> {
  return { ok: false, code: "UNAUTHORIZED", message: copy.profile.errors.load };
}

let running: Promise<RepoResult<null>> | null = null;
let runAgain = false;
let lastOkAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

async function runOnce(): Promise<RepoResult<null>> {
  const userId = getSupabaseUserId();
  if (userId === null) return unauthorized();
  // The mock profile needs no network.
  if (getProfileSource() !== "supabase") return { ok: true, data: null };

  const fetched = await fetchOrCreateProfileRow();
  if (!fetched.ok) return fetched;
  // The user may have signed out, or another account signed in, while the request was away.
  if (getSupabaseUserId() !== userId) return unauthorized();

  const row = fetched.data;
  const tier = TIERS.find((item) => item === row.subscription_tier) ?? "free";
  useProfilePrefsStore.getState().saveSnapshot(userId, {
    createdAt: row.created_at,
    subscriptionTier: tier,
    syncedAt: new Date().toISOString(),
  });

  const server = toUserProfile(row).reminders;
  const onboarding = useOnboardingStore.getState();
  const action = decideReminderSync(server, onboarding.reminders, onboarding.remindersDirty);

  if (action === "apply-server") {
    onboarding.applyServerReminders(server);
    // TODO(28): reschedule the affirmation notifications for the new times
  } else if (action === "mark-synced") {
    if (onboarding.remindersDirty || onboarding.remindersSyncedAt === null) {
      onboarding.markRemindersSynced();
    }
  } else {
    const pushed = { ...onboarding.reminders };
    const written = await pushReminderColumns(pushed);
    if (!written.ok) return written;
    if (getSupabaseUserId() !== userId) return unauthorized();
    const latest = useOnboardingStore.getState();
    // An edit made while the request was away is not on the server yet: it stays unsent and goes in a moment.
    if (sameTimes(latest.reminders, pushed)) latest.markRemindersSynced();
    else scheduleReminderSync();
  }
  lastOkAt = Date.now();
  return { ok: true, data: null };
}

// One sync at a time. A call that arrives while one is running asks for another run right after it, so an edit
// that came in too late for the running one is never skipped.
export function syncProfile(): Promise<RepoResult<null>> {
  if (running !== null) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    let result = await runOnce();
    while (runAgain) {
      runAgain = false;
      result = await runOnce();
    }
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function scheduleReminderSync(): void {
  cancelReminderSync();
  timer = setTimeout(() => {
    timer = null;
    syncProfile();
  }, REMINDER_SYNC_DEBOUNCE_MS);
}

export function cancelReminderSync(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

// Called when the app comes back to the foreground: at once when an edit is unsent, otherwise at most every 30 s.
export function syncProfileOnForeground(): void {
  if (useOnboardingStore.getState().remindersDirty || Date.now() - lastOkAt >= FOREGROUND_SYNC_GAP_MS) {
    syncProfile();
  }
}

// Sends a reminder edit 800 ms after the last change. Returns the function that stops watching.
export function startReminderSync(): () => void {
  const unsubscribe = useOnboardingStore.subscribe((state, previous) => {
    if (state.remindersDirty && state.reminders !== previous.reminders) scheduleReminderSync();
  });
  return () => {
    unsubscribe();
    cancelReminderSync();
  };
}
