import { getDeviceTimezone, toUserProfile } from "@/data/mappers";
import { getProfileSource } from "@/data/mock/scenario";
import {
  fetchOrCreateProfileRow,
  pushProfileColumns,
  reminderColumns,
  settingColumns,
} from "@/data/profileRemote";
import { copy } from "@/constants/copy";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import { type ServerSnapshot, type Settings, useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { ProfilePatch, RepoResult, TimeSlot } from "@/types";
import type { UserProfileRow, UserProfileUpdate } from "@/types/database";

// Keeps this device and users_profile in step (steps 17 and 18): it makes sure the account has a row, remembers what
// the server says (the plan, the sign-up date, the settings), and moves whatever is newer in either direction: the
// reminder times, the three settings and the time zone. One request sends everything that needs sending.
// Nothing here shows an error to the user: a failure leaves the edit marked unsent and the next trigger tries again.

const SYNC_DEBOUNCE_MS = 800;
const FOREGROUND_SYNC_GAP_MS = 30_000;

const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

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

// The settings changed on this device that the server does not have. An unsent value equal to the server's is already
// there, so it needs no request. (Any other setting, edited on another phone, is simply the server's.)
export function settingsToPush(server: Settings, unsent: ProfilePatch): ProfilePatch {
  const push: ProfilePatch = {};
  if (unsent.affirmationsEnabled !== undefined && unsent.affirmationsEnabled !== server.affirmationsEnabled) {
    push.affirmationsEnabled = unsent.affirmationsEnabled;
  }
  if (unsent.ambientSound !== undefined && unsent.ambientSound !== server.ambientSound) {
    push.ambientSound = unsent.ambientSound;
  }
  if (unsent.ambientVolume !== undefined && unsent.ambientVolume !== server.ambientVolume) {
    push.ambientVolume = unsent.ambientVolume;
  }
  return push;
}

function hasUnsentSettings(userId: string | null): boolean {
  const unsent = userId === null ? undefined : useProfilePrefsStore.getState().byUser[userId]?.unsent;
  return unsent !== undefined && Object.keys(unsent).length > 0;
}

function toSnapshot(row: UserProfileRow): ServerSnapshot {
  const profile = toUserProfile(row);
  return {
    createdAt: profile.createdAt,
    subscriptionTier: profile.subscriptionTier,
    syncedAt: new Date().toISOString(),
    affirmationsEnabled: profile.affirmationsEnabled,
    ambientSound: profile.ambientSound,
    ambientVolume: profile.ambientVolume,
  };
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
  const server = toUserProfile(row);
  const prefs = useProfilePrefsStore.getState();
  prefs.saveSnapshot(userId, toSnapshot(row));

  // What this run decided to send, taken before the request: an edit made while it is away is not part of it.
  const unsent = prefs.byUser[userId]?.unsent ?? {};
  const onboarding = useOnboardingStore.getState();
  const reminderAction = decideReminderSync(server.reminders, onboarding.reminders, onboarding.remindersDirty);
  const sentReminders = { ...onboarding.reminders };
  const columns: UserProfileUpdate = settingColumns(settingsToPush(server, unsent));
  if (reminderAction === "push") Object.assign(columns, reminderColumns(sentReminders));
  // The server uses the zone for the week boundary of the free limit; a phone that travels updates it.
  const zone = getDeviceTimezone();
  if (row.timezone !== zone) columns.timezone = zone;

  if (reminderAction === "apply-server") {
    onboarding.applyServerReminders(server.reminders);
    // TODO(28): reschedule the affirmation notifications for the new times
  } else if (reminderAction === "mark-synced" && (onboarding.remindersDirty || onboarding.remindersSyncedAt === null)) {
    onboarding.markRemindersSynced();
  }

  if (Object.keys(columns).length > 0) {
    const written = await pushProfileColumns(columns);
    if (!written.ok) return written;
    if (getSupabaseUserId() !== userId) return unauthorized();
    useProfilePrefsStore.getState().saveSnapshot(userId, toSnapshot(written.data));
    if (reminderAction === "push") {
      const latest = useOnboardingStore.getState();
      // An edit made while the request was away is not on the server yet: it stays unsent and goes in a moment.
      if (sameTimes(latest.reminders, sentReminders)) latest.markRemindersSynced();
      else scheduleProfileSync();
    }
  }

  // The server now has every unsent setting that has not been edited again since this run began.
  useProfilePrefsStore.getState().clearUnsent(userId, unsent);
  if (hasUnsentSettings(userId)) scheduleProfileSync();
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

export function scheduleProfileSync(): void {
  cancelProfileSync();
  timer = setTimeout(() => {
    timer = null;
    syncProfile();
  }, SYNC_DEBOUNCE_MS);
}

export function cancelProfileSync(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

// Called when the app comes back to the foreground: at once when an edit is unsent, otherwise at most every 30 s.
export function syncProfileOnForeground(): void {
  const unsent = useOnboardingStore.getState().remindersDirty || hasUnsentSettings(getSupabaseUserId());
  if (unsent || Date.now() - lastOkAt >= FOREGROUND_SYNC_GAP_MS) {
    syncProfile();
  }
}

// Sends a reminder edit 800 ms after the last change (a setting edit schedules its own sync, in updateProfile).
// Returns the function that stops watching.
export function watchReminderEdits(): () => void {
  const unsubscribe = useOnboardingStore.subscribe((state, previous) => {
    if (state.remindersDirty && state.reminders !== previous.reminders) scheduleProfileSync();
  });
  return () => {
    unsubscribe();
    cancelProfileSync();
  };
}
