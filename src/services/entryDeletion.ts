import { deleteEntry } from "@/data/journalRepository";
import { requestAffirmationReschedule } from "@/services/affirmationScheduler";
import { forgetDevotionalFile } from "@/services/devotionalAudio";
import { announceEntryDeleted } from "@/services/syncEngine";
import { usePlayerStore } from "@/store/playerStore";
import type { RepoResult } from "@/types";

// Deletes a reflection for good and makes this phone forget every copy of it (step 29b). Never throws.
//
// The repository asks the server first (nothing is queued: a delete is online only) and, once the server has deleted it or says
// it is already gone, removes the cached entry, its affirmations and any prayer change that waits for it. This function then lets
// go of what the rest of the app holds: the player, the downloaded audio, the lists on screen and the affirmation notifications.
// A step that fails never turns the server's success into an error: the reflection is gone for good either way.
export async function deleteReflection(entryId: string): Promise<RepoResult<null>> {
  const deleted = await deleteEntry(entryId);
  if (deleted.ok) forgetOnThisPhone(entryId);
  return deleted;
}

// Also what a Realtime DELETE does on this phone. TODO(33): step 33 calls this from its DELETE handler.
export function forgetOnThisPhone(entryId: string): void {
  // The sound, the lock screen and the ambient bed stop when that devotional is the loaded one.
  try {
    const player = usePlayerStore.getState();
    if (player.entryId === entryId) player.stop();
  } catch {
    // The player has nothing more to give up.
  }
  // Its downloaded file (never throws).
  forgetDevotionalFile(entryId);
  // The lists that are on screen drop it.
  announceEntryDeleted(entryId);
  // The affirmation notifications are planned again: when this was the newest reflection they come from the one before it, or
  // stop, instead of going on with the headlines of a reflection that no longer exists.
  requestAffirmationReschedule();
}
