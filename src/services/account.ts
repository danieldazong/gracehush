// TEMP(31): replace internals with Edge Function calls, keep signatures
import { copy } from "@/constants/copy";
import { simulateWrite } from "@/data/journalRepository";
import { takeMockPrayerMutationFailure } from "@/data/mock/scenario";
import { cancelProfileSync } from "@/services/profileSync";
import { deleteAllRecordings } from "@/services/recordingFiles";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import { usePlayerStore } from "@/store/playerStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { RepoResult } from "@/types";

// How long a mock request waits, so a dialog shows its spinner.
const ACCOUNT_REQUEST_MS = 600;

// Asks for a copy of the user's data. The mock only answers; step 31 builds the ZIP and the download link.
// It shares the dev failure flag with the prayer changes and the profile save ("Fail next save (dev)").
export async function requestDataExport(): Promise<RepoResult<{ requestedAt: string }>> {
  await simulateWrite(ACCOUNT_REQUEST_MS);
  if (takeMockPrayerMutationFailure()) {
    return { ok: false, code: "NETWORK", message: copy.profile.errors.export };
  }
  return { ok: true, data: { requestedAt: new Date().toISOString() } };
}

// The caller signs out of Clerk afterwards. This never deletes the real Clerk user.
export async function deleteAccount(): Promise<RepoResult<null>> {
  await simulateWrite(ACCOUNT_REQUEST_MS);
  if (takeMockPrayerMutationFailure()) {
    return { ok: false, code: "NETWORK", message: copy.profile.errors.delete };
  }
  // TODO(31): the server deletes the Supabase rows, the storage files, the RevenueCat customer and the Clerk user.
  const userId = getSupabaseUserId();
  await signOutCleanup();
  // The settings kept on this device for the account go with it.
  if (userId !== null) useProfilePrefsStore.getState().forgetUser(userId);
  return { ok: true, data: null };
}

// Everything that belongs to the signed-in user and must not outlive the session. It runs before Clerk's
// signOut() for both sign out and account deletion, and never touches the onboarding store: that one is
// device-level (AGENTS.md, Authentication Rules). Steps 17, 24, 26, 27, 28, 30, 33 and 34 each add their line.
export async function signOutCleanup(): Promise<void> {
  // TODO(33): stopRealtime() first, before the database and the token go
  // A reminder edit that has not reached the server belongs to the account that made it: it must never be sent to
  // the next account that signs in on this phone. (The reminder times are device-wide. An unsent setting is kept
  // per user in the prefs store and is sent when that account signs in again.)
  cancelProfileSync();
  useOnboardingStore.getState().discardUnsyncedReminders();
  // A prayer's audio must not outlive the session: every finished recording on this phone goes (step 23). A take that
  // is still being made cannot be running here: Sign Out is on Profile, and New Entry, which owns the recorder, is a
  // screen above the tabs. Step 24 may decide to keep an unsent queue per user instead.
  await deleteAllRecordings();
  // TODO(24): stop the sync engine and clear this user's SQLite cache
  // A full reset of the player: the position, the speed and the session's ambient choice.
  usePlayerStore.getState().stop();
  // TODO(26): clear the lock screen and release the player
  // TODO(27): stop the ambient preview
  // TODO(28): cancel the scheduled affirmation notifications
  // TODO(30): Purchases.logOut()
  // TODO(34): resetAnalytics()
}
