import { processEntry, readLimitBody, type FunctionResult } from "@/api/journalApi";
import { processMock } from "@/data/journalRepository";
import { getDataSource } from "@/data/mock/scenario";
import * as outbox from "@/db/outbox";
import { rawRecordingPath, uploadRawRecording, type UploadFailureCode } from "@/services/mediaUpload";
import { recordingUri } from "@/services/recordingFiles";
import { getSupabaseUserId } from "@/services/supabaseClient";
import type {
  JournalEntry,
  OutboxItem,
  ProcessEntryErrorCode,
  ProcessEntryRequest,
  ProcessEntryResponse,
  ProcessingStage,
  ProcessOutcome,
} from "@/types";
import { normalizeTimestamp } from "@/utils/timestamp";

// The one place the sync engine hands an outbox item to be prepared (step 24; the real server since step 25). It answers with
// the finished entry, or with why not (a ProcessEntryErrorCode, or NETWORK when no answer came). It never throws and it reports
// its progress through `onStage`, which the New Entry overlay shows.
//
// A written reflection is sent as it is. A recording is uploaded first to {userId}/raw/{clientEntryId}.m4a in the private
// journal_media bucket (once: the outbox item remembers it), and then process-entry is asked to prepare it. The server keeps the
// reflection under the client entry id, so sending the same item again after a lost answer finds it finished or in progress
// and never makes a second one. The user id comes from the signed-in session and never travels in the body.
//
// While the data source is the mock (a development switch), the mock answers instead, and the engine does not write what it
// answers to the read cache: the mock's entries live in the in-memory mock database, and a persisted copy of them would outlive it.
export function isProcessorMock(): boolean {
  return getDataSource() === "mock";
}

const UPLOAD_CODES: Record<UploadFailureCode, ProcessEntryErrorCode | "NETWORK" | "UNKNOWN"> = {
  NETWORK: "NETWORK",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "AUDIO_NOT_FOUND",
  TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNKNOWN: "UNKNOWN",
};

const PROCESS_CODES: readonly ProcessEntryErrorCode[] = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "LIMIT_REACHED",
  "METHOD_NOT_ALLOWED",
  "ALREADY_PROCESSING",
  "PAYLOAD_TOO_LARGE",
  "TOO_SHORT",
  "AUDIO_NOT_FOUND",
  "NO_SPEECH",
  "RATE_LIMITED",
  "INTERNAL",
  "AI_UNAVAILABLE",
];

function toProcessCode(code: string): ProcessEntryErrorCode | "NETWORK" | "UNKNOWN" {
  if (code === "NETWORK") return "NETWORK";
  return PROCESS_CODES.find((candidate) => candidate === code) ?? "UNKNOWN";
}

// The function reports nothing while it works, so the overlay's steps follow the time a reflection usually takes (the hosted
// runs: a few seconds to read and screen it, then the reflection, then the passage and the spoken devotional). It is a
// progress indication and nothing more: the answer decides what happens.
const STAGE_TIMELINE: readonly (readonly [number, ProcessingStage])[] = [
  [4_000, "reflecting"],
  [12_000, "preparing"],
];

function followStages(onStage: (stage: ProcessingStage) => void): () => void {
  const timers = STAGE_TIMELINE.map(([after, stage]) => setTimeout(() => onStage(stage), after));
  return () => timers.forEach((timer) => clearTimeout(timer));
}

// The times of the entry the function answered with, in the form the app keeps them (utils/timestamp.ts), so a reflection that has
// just been prepared looks the same as the one read back from the server.
function withCanonicalTimes(entry: JournalEntry): JournalEntry {
  const { prayer } = entry;
  return {
    ...entry,
    createdAt: normalizeTimestamp(entry.createdAt),
    updatedAt: normalizeTimestamp(entry.updatedAt),
    prayer:
      prayer === null
        ? null
        : {
            ...prayer,
            createdAt: normalizeTimestamp(prayer.createdAt),
            answeredAt: prayer.answeredAt === null ? null : normalizeTimestamp(prayer.answeredAt),
          },
  };
}

function toOutcome(result: FunctionResult<ProcessEntryResponse>): ProcessOutcome {
  if (result.ok) return { ok: true, entry: withCanonicalTimes(result.data.entry), affirmations: result.data.affirmations };
  const code = toProcessCode(result.code);
  if (code === "LIMIT_REACHED") {
    // The 402 says which entry the server saved and when the week resets.
    const limit = readLimitBody(result.body);
    return limit === null ? { ok: false, code } : { ok: false, code, entryId: limit.entryId, resetsAt: limit.resetsAt };
  }
  return { ok: false, code };
}

async function rememberUpload(clientEntryId: string): Promise<void> {
  try {
    await outbox.markUploaded(clientEntryId);
  } catch {
    // The database closed (sign-out) or could not be written: the next attempt uploads again, and the server says "already there".
  }
}

async function processReal(
  item: OutboxItem,
  onStage: (stage: ProcessingStage) => void,
): Promise<ProcessOutcome> {
  const userId = getSupabaseUserId();
  if (userId === null) return { ok: false, code: "UNAUTHORIZED" };
  onStage("receiving");
  let request: ProcessEntryRequest;
  if (item.inputType === "text") {
    if (item.text === null) return { ok: false, code: "INVALID_REQUEST" };
    request = { clientEntryId: item.clientEntryId, inputType: "text", text: item.text };
  } else {
    if (item.durationMs === null || item.mimeType === null) return { ok: false, code: "INVALID_REQUEST" };
    if (!item.uploaded) {
      const sent = await uploadRawRecording({ clientEntryId: item.clientEntryId, uri: recordingUri(item.clientEntryId) }, userId);
      if (!sent.ok) return { ok: false, code: UPLOAD_CODES[sent.code] };
      await rememberUpload(item.clientEntryId);
    }
    request = {
      clientEntryId: item.clientEntryId,
      inputType: "audio",
      audioPath: rawRecordingPath(userId, item.clientEntryId),
      durationMs: item.durationMs,
      mimeType: item.mimeType,
    };
  }
  const stopFollowing = followStages(onStage);
  try {
    return toOutcome(await processEntry(request));
  } finally {
    stopFollowing();
  }
}

export function processItem(
  item: OutboxItem,
  onStage: (stage: ProcessingStage) => void,
): Promise<ProcessOutcome> {
  return isProcessorMock() ? processMock(item, onStage) : processReal(item, onStage);
}
