import { exists } from "@/db/outbox";
import { deleteRecording, listRecordings } from "@/services/recordingFiles";

// A recording that belongs to no outbox item and has been on the phone for a week is a leftover (an entry that was never
// saved, or a delete that failed): it goes (step 24). A recording that has an outbox item is never touched, and neither
// is one whose age is not known. Runs once per launch, when the sync engine starts. Never throws; returns how many went.
export const RECORDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function cleanOldRecordings(now: number = Date.now()): Promise<number> {
  let removed = 0;
  try {
    for (const recording of listRecordings()) {
      if (recording.modifiedAt <= 0 || now - recording.modifiedAt < RECORDING_MAX_AGE_MS) continue;
      if (await exists(recording.clientEntryId)) continue;
      await deleteRecording(recording.clientEntryId);
      removed += 1;
    }
  } catch {
    // Nothing more can be done: the next launch tries again.
  }
  return removed;
}
