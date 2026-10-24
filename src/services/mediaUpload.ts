import { StorageApiError } from "@supabase/supabase-js";
import { File } from "expo-file-system";

import { MAX_RECORDING_FILE_BYTES, RECORDING_MIME_TYPE } from "@/constants/audio";
import { getSupabase } from "@/services/supabaseClient";
import type { RecordedAudio } from "@/types";
import { NO_SESSION_ERROR_NAME, toFailureCode } from "@/utils/supabaseErrors";

// Uploads the raw recording to the private journal_media bucket (step 23). process-entry (step 19) reads it from exactly
// {userId}/raw/{clientEntryId}.m4a, and the bucket's policy lets a user write only into their own raw/ folder, never
// overwrite and never delete (step 18). Nothing here logs: a path, an id or a size is about a person's prayer.
const BUCKET = "journal_media";
const NETWORK_RETRY_MS = 1_500;

export type UploadFailureCode = "NETWORK" | "UNAUTHORIZED" | "TOO_LARGE" | "NOT_FOUND" | "UNKNOWN";

// All an upload needs of a recording. A RecordedAudio fits, and so does a file listed from recordings/.
export type UploadSource = Pick<RecordedAudio, "clientEntryId" | "uri">;

export type UploadResult = { ok: true; path: string } | { ok: false; code: UploadFailureCode };

export function rawRecordingPath(userId: string, clientEntryId: string): string {
  return `${userId}/raw/${clientEntryId}.m4a`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// What Storage says when the object is already there. The service answers HTTP 400 with a body that says 409, and
// newer builds send a real 409, so all three signs count.
function isDuplicate(error: unknown): boolean {
  if (!(error instanceof StorageApiError)) return false;
  return (
    error.status === 409 ||
    error.statusCode === "409" ||
    error.code === "ResourceAlreadyExists" ||
    /already exists|duplicate/i.test(error.message)
  );
}

// Pure: turns what the Storage client reported into a failure code. A rejected request (offline, or a Clerk token that
// could not be fetched) is a StorageUnknownError that holds the original error, so it is read as "no answer".
export function toUploadFailure(error: unknown): UploadFailureCode {
  if (error instanceof StorageApiError) {
    if (error.status === 413 || error.statusCode === "413") return "TOO_LARGE";
    return toFailureCode(error.status, { message: error.message, code: error.code });
  }
  const original =
    typeof error === "object" && error !== null && "originalError" in error ? error.originalError : error;
  const name = original instanceof Error ? original.name : "";
  return toFailureCode(0, { message: name === NO_SESSION_ERROR_NAME ? NO_SESSION_ERROR_NAME : "" });
}

async function send(path: string, body: ArrayBuffer): Promise<UploadResult> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, code: "UNAUTHORIZED" };
  try {
    // upsert is false on purpose: the policy refuses an overwrite, so a second send of the same entry says
    // "already exists", which is a success below.
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, { contentType: RECORDING_MIME_TYPE, upsert: false });
    if (error === null || isDuplicate(error)) return { ok: true, path };
    return { ok: false, code: toUploadFailure(error) };
  } catch (error) {
    return { ok: false, code: toUploadFailure(error) };
  }
}

// Never throws. The caller passes the Clerk user id (from useAuth, or getSupabaseUserId in the developer panel).
export async function uploadRawRecording(audio: UploadSource, userId: string): Promise<UploadResult> {
  if (getSupabase() === null) return { ok: false, code: "UNAUTHORIZED" };
  let body: ArrayBuffer;
  try {
    const file = new File(audio.uri);
    if (!file.exists) return { ok: false, code: "NOT_FOUND" };
    // The real size, not the caller's claim: the function refuses a file over 12 MiB, so none is sent.
    if (file.size > MAX_RECORDING_FILE_BYTES) return { ok: false, code: "TOO_LARGE" };
    body = await file.arrayBuffer();
  } catch {
    return { ok: false, code: "NOT_FOUND" };
  }
  const path = rawRecordingPath(userId, audio.clientEntryId);
  const first = await send(path, body);
  if (first.ok || first.code !== "NETWORK") return first;
  await wait(NETWORK_RETRY_MS);
  return send(path, body);
}

export type CountResult = { ok: true; count: number } | { ok: false; code: UploadFailureCode };

// For the developer panel: how many raw recordings this user has in the bucket. Returns the count and nothing else.
export async function countRawUploads(userId: string): Promise<CountResult> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, code: "UNAUTHORIZED" };
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(`${userId}/raw`, { limit: 1_000 });
    if (error !== null) return { ok: false, code: toUploadFailure(error) };
    return { ok: true, count: data.length };
  } catch (error) {
    return { ok: false, code: toUploadFailure(error) };
  }
}
