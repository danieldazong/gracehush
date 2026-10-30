import { deleteAccount as deleteAccountOnServer, exportData } from "@/api/journalApi";
import { copy } from "@/constants/copy";
import { simulateWrite } from "@/data/journalRepository";
import { getDataSource, takeMockPrayerMutationFailure } from "@/data/mock/scenario";
import { deleteUserDatabase } from "@/db/database";
import { clearAffirmations } from "@/services/affirmationScheduler";
import { deleteAllDevotionalAudio } from "@/services/devotionalAudio";
import { endOfflineSession } from "@/services/offlineSession";
import { cancelProfileSync, pauseProfileSync, resumeProfileSync } from "@/services/profileSync";
import { deleteAllRecordings } from "@/services/recordingFiles";
import { endRevenueCatSession } from "@/services/revenuecat";
import { startPlanWatch, stopPlanWatch } from "@/services/subscriptionSync";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { isSyncEngineStarted, startSyncEngine, stopSyncEngine } from "@/services/syncEngine";
import { useOnboardingStore } from "@/store/onboardingStore";
import { usePlayerStore } from "@/store/playerStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { RepoResult } from "@/types";

// Profile's two account actions, and the cleanup every sign-out shares. The export and the deletion run on the server (step 31:
// export-data and delete-account, called through src/api/journalApi.ts). The mock data source keeps the step 15 mocks, which a
// release build never reaches.

// How long a mock request waits, so a dialog shows its spinner.
const ACCOUNT_REQUEST_MS = 600;
// The mock export's link: a placeholder, development only.
const MOCK_EXPORT_URL = "https://example.com/gracehush-journal.zip";

// What Profile needs of a finished export: the one-hour link, and whether audio was left out or the ZIP was handed back again.
export type ExportLink = { url: string; expiresAt: string; partial: boolean; reused: boolean };

function failureCode(code: string): "NETWORK" | "UNAUTHORIZED" | "UNKNOWN" {
  return code === "NETWORK" || code === "UNAUTHORIZED" ? code : "UNKNOWN";
}

// A ZIP of everything the person has, prayers, answered dates and gratitude notes included, and a link to it. The mock shares
// the dev failure flag with the mock data's writes ("Fail next save (dev)").
export async function requestDataExport(): Promise<RepoResult<ExportLink>> {
  if (getDataSource() === "mock") {
    await simulateWrite(ACCOUNT_REQUEST_MS);
    if (takeMockPrayerMutationFailure()) return { ok: false, code: "NETWORK", message: copy.profile.errors.export };
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    return { ok: true, data: { url: MOCK_EXPORT_URL, expiresAt, partial: false, reused: false } };
  }
  const result = await exportData();
  if (!result.ok) return { ok: false, code: failureCode(result.code), message: copy.profile.errors.export };
  const { url, expiresAt, partial, reused } = result.data;
  return { ok: true, data: { url, expiresAt, partial, reused } };
}

// Deletes the account for good: its files, its rows, its RevenueCat customer and its Clerk user (delete-account). The caller
// signs out of Clerk afterwards.
//
// First this phone stops its own background work, so nothing it does can make the account's data again while the server
// deletes it: the sync engine (a reflection being prepared makes the profile row), the plan watch (a sync re-reads RevenueCat,
// which makes a customer) and the profile sync (it makes the profile row). A success, or UNAUTHORIZED (the account or its
// session is already gone), runs the sign-out cleanup and forgets the account's settings kept on this phone: signing out is
// always safe. A failure clears nothing and starts again what was stopped.
export async function deleteAccount(): Promise<RepoResult<null>> {
  if (getDataSource() === "mock") return await deleteMockAccount();
  const userId = getSupabaseUserId();
  const engineWasRunning = isSyncEngineStarted();
  stopSyncEngine();
  stopPlanWatch();
  if (userId !== null) pauseProfileSync(userId);
  const result = await deleteAccountOnServer();
  if (result.ok || result.code === "UNAUTHORIZED") {
    await signOutCleanup();
    if (userId !== null) useProfilePrefsStore.getState().forgetUser(userId);
    return { ok: true, data: null };
  }
  resumeProfileSync();
  if (engineWasRunning) startSyncEngine();
  if (userId !== null) startPlanWatch(userId);
  return { ok: false, code: failureCode(result.code), message: copy.profile.errors.delete };
}

// The step 15 mock: it waits, honours "Fail next save (dev)" and clears the phone as a real deletion does. It never deletes the
// real Clerk user.
async function deleteMockAccount(): Promise<RepoResult<null>> {
  await simulateWrite(ACCOUNT_REQUEST_MS);
  if (takeMockPrayerMutationFailure()) return { ok: false, code: "NETWORK", message: copy.profile.errors.delete };
  const userId = getSupabaseUserId();
  await signOutCleanup();
  if (userId !== null) useProfilePrefsStore.getState().forgetUser(userId);
  return { ok: true, data: null };
}

// Everything that belongs to the signed-in user and must not outlive the session. It runs before Clerk's
// signOut() for both sign out and account deletion, and never touches the onboarding store: that one is
// device-level (AGENTS.md, Authentication Rules). Steps 17, 24, 26, 28, 30, 33 and 34 each add their line (step 27's is
// inside the player store's stop()).
export async function signOutCleanup(): Promise<void> {
  // TODO(33): stopRealtime() first, before the database and the token go
  // A reminder edit that has not reached the server belongs to the account that made it: it must never be sent to
  // the next account that signs in on this phone. (The reminder times are device-wide. An unsent setting is kept
  // per user in the prefs store and is sent when that account signs in again.)
  cancelProfileSync();
  useOnboardingStore.getState().discardUnsyncedReminders();
  // The sync engine stops first, so nothing is sent or written while the files go. Then this user's database is deleted
  // with its key (the outbox, the cached entries and every written word in them: step 24), and every recording on this
  // phone: a prayer must not outlive the session (step 23). A take that is still being made cannot be running here: Sign
  // Out is on Profile, and New Entry, which owns the recorder, is a screen above the tabs. Profile has already asked
  // when reflections that were never sent would be lost.
  const userId = getSupabaseUserId();
  await endOfflineSession();
  if (userId !== null) await deleteUserDatabase(userId);
  await deleteAllRecordings();
  // A full reset of the player: the sound stops, the lock screen is cleared and the player is released, and the position,
  // the speed and the session's ambient choice go, with the ambient bed and Profile's preview (step 27). Then the
  // devotionals downloaded to this phone, and any download still running (step 26): a prayer's audio must not outlive the
  // session either.
  usePlayerStore.getState().stop();
  await deleteAllDevotionalAudio();
  // The affirmation notifications this account scheduled, and the ones still in the notification center (step 28): an
  // affirmation must not reach the phone, or open, after its account has gone.
  await clearAffirmations();
  // RevenueCat (step 30): the plan watch stops, so nothing asks the server about this account any more, then RevenueCat logs
  // out of it and the entitlement it reported is forgotten.
  stopPlanWatch();
  await endRevenueCatSession();
  // TODO(34): resetAnalytics()
}
