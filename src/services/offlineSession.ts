import { closeUserDatabase, openUserDatabase } from "@/db/database";
import { startSyncEngine, stopSyncEngine } from "@/services/syncEngine";
import { useOfflineStore } from "@/store/offlineStore";

// The signed-in user's offline machinery (step 24): their database, then the sync engine that reads it. The auth bridge
// starts it when a user signs in and ends it when they sign out, and Journal's "Try again" starts it again when the
// database could not be opened. Only the newest start or end may act on what it finds: an open that finishes after
// the session has already ended must not mark the database ready or start the engine.
let session = 0;

function note(code: string) {
  if (__DEV__) {
    console.info(`[db] ${code}`);
  }
}

export async function startOfflineSession(userId: string): Promise<void> {
  session += 1;
  const mine = session;
  useOfflineStore.getState().setDatabase("closed");
  try {
    await openUserDatabase(userId);
  } catch {
    if (mine === session) {
      note("open_failed");
      useOfflineStore.getState().setDatabase("failed");
    }
    return;
  }
  if (mine !== session) return;
  useOfflineStore.getState().setDatabase("ready");
  startSyncEngine();
}

// Sign-out, or the user changed. The file stays on the phone, encrypted: signOutCleanup deletes it when the person
// signs out on purpose.
export async function endOfflineSession(): Promise<void> {
  session += 1;
  stopSyncEngine();
  useOfflineStore.getState().setDatabase("closed");
  await closeUserDatabase();
}
