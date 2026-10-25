import { Directory, File, Paths } from "expo-file-system";

import { MIN_RECORDING_FILE_BYTES } from "@/constants/audio";

// Finished recordings live in the app's private document folder as recordings/{clientEntryId}.m4a, so a take survives
// a restart and the OS cleaning its caches. Only a finished take is ever here: one that was still being recorded when
// the app was killed stays in expo-audio's own folder and cannot be played (an .m4a is only valid once it is stopped).
// Nothing here logs: a path or a size is about a person's prayer.
const FOLDER = "recordings";
const EXTENSION = ".m4a";

function folder(): Directory {
  return new Directory(Paths.document, FOLDER);
}

function fileFor(clientEntryId: string): File {
  return new File(folder(), `${clientEntryId}${EXTENSION}`);
}

export function recordingUri(clientEntryId: string): string {
  return fileFor(clientEntryId).uri;
}

// Moves a take to its final place. useRecorder.stop() calls it once, so a take is already in recordings/ the moment it
// ends; a second call with that final address changes nothing. A file that is missing or under 1 KB is a failed
// recording: it is deleted and this throws, which the recorder shows as the step 10 "We couldn't save that recording"
// message.
export async function finalizeRecording(
  uri: string,
  clientEntryId: string,
): Promise<{ uri: string; sizeBytes: number }> {
  const target = fileFor(clientEntryId);
  const source = new File(uri);
  if (source.uri !== target.uri) {
    if (!source.exists) throw new Error("The recording file is missing");
    folder().create({ intermediates: true, idempotent: true });
    // A second take for the same entry replaces the first (move is asynchronous and only overwrites when told to).
    await source.move(target, { overwrite: true });
  }
  const sizeBytes = target.size;
  if (!target.exists || sizeBytes < MIN_RECORDING_FILE_BYTES) {
    if (target.exists) target.delete();
    throw new Error("The recording file is empty");
  }
  return { uri: target.uri, sizeBytes };
}

// Never throws: a file that cannot be deleted is left for the cleanup of step 24.
export async function deleteRecording(clientEntryId: string): Promise<void> {
  try {
    const file = fileFor(clientEntryId);
    if (file.exists) file.delete();
  } catch {
    // Left for the cleanup.
  }
}

// Sign-out and account deletion: a prayer's audio must not outlive the session. Never throws.
export async function deleteAllRecordings(): Promise<void> {
  try {
    const directory = folder();
    if (directory.exists) directory.delete();
  } catch {
    // Left for the cleanup.
  }
}

export type LocalRecording = {
  clientEntryId: string;
  uri: string;
  sizeBytes: number;
  modifiedAt: number; // milliseconds since the epoch, 0 when unknown
};

// Every finished recording on the phone. The developer panel and services/recordingCleanup.ts (which deletes a recording
// that has no queue item and is older than 7 days, by `modifiedAt`) use it.
export function listRecordings(): LocalRecording[] {
  const directory = folder();
  if (!directory.exists) return [];
  return directory.list().flatMap((entry) =>
    entry instanceof File && entry.name.endsWith(EXTENSION)
      ? [
          {
            clientEntryId: entry.name.slice(0, -EXTENSION.length),
            uri: entry.uri,
            sizeBytes: entry.size,
            modifiedAt: entry.lastModified ?? 0,
          },
        ]
      : [],
  );
}
