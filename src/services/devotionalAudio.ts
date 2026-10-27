import { StorageApiError } from "@supabase/supabase-js";
import { Directory, File, Paths } from "expo-file-system";

import {
  DEVOTIONAL_CACHE_FOLDER,
  DEVOTIONAL_EXTENSION,
  DEVOTIONAL_LINK_SECONDS,
  DEVOTIONAL_LINK_TIMEOUT_MS,
  MAX_CACHED_DEVOTIONALS,
  MIN_DEVOTIONAL_FILE_BYTES,
} from "@/constants/audio";
import { getSupabase } from "@/services/supabaseClient";
import { selectCanSend, useOfflineStore } from "@/store/offlineStore";
import { NO_SESSION_ERROR_NAME, toFailureCode } from "@/utils/supabaseErrors";

// A devotional is a lossless WAV of about 5 MB (step 22), so it is downloaded once and played from the phone: no link can
// expire in the middle of a prayer, a second listen costs no data, and a devotional that was played works offline. The
// file lives in the app's cache folder, which iOS leaves out of backups and may empty when space runs short (the next play
// then downloads it again). Only the newest MAX_CACHED_DEVOTIONALS are kept, and sign-out deletes all of them.
//
// The bucket is private (step 18): the link comes from Supabase for the signed-in user, is valid for a few minutes, is used
// for this one download and is never kept. Nothing here logs: a link, a path or an id is about a person's prayer.
const BUCKET = "journal_media";
const PART_SUFFIX = ".part";

export type DevotionalFailureCode = "NETWORK" | "UNAUTHORIZED" | "NOT_FOUND" | "UNKNOWN";

export type DevotionalFileResult = { ok: true; uri: string } | { ok: false; code: DevotionalFailureCode };

// An entry id comes from the server (a UUID) or from the mock data ("entry-anxious-yesterday"); both are safe in a file
// name. Anything else is refused rather than turned into a path.
const SAFE_ENTRY_ID = /^[A-Za-z0-9_-]{1,80}$/;

const UNKNOWN = { ok: false, code: "UNKNOWN" } as const;

function folder(): Directory {
  return new Directory(Paths.cache, DEVOTIONAL_CACHE_FOLDER);
}

function fileFor(entryId: string, suffix = ""): File {
  return new File(folder(), `${entryId}${DEVOTIONAL_EXTENSION}${suffix}`);
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Already gone, or left for the next clean-up.
  }
}

type Running = { promise: Promise<DevotionalFileResult>; abort: AbortController };

// One download per entry: a second request for the same devotional waits for the first. Sign-out stops them all.
const running = new Map<string, Running>();

// Pure: what Storage answered when asked for a link, as a failure code. A rejected request (offline, or a token that could
// not be fetched) is a StorageUnknownError that holds the original error, so it is read as "no answer".
export function toStorageFailure(error: unknown): DevotionalFailureCode {
  if (error instanceof StorageApiError) {
    // A missing object is HTTP 400 with a body that says 404 (newer builds send a real 404).
    if (error.status === 404 || error.statusCode === "404") return "NOT_FOUND";
    return toFailureCode(error.status, { message: error.message, code: error.code });
  }
  const original =
    typeof error === "object" && error !== null && "originalError" in error ? error.originalError : error;
  const name = original instanceof Error ? original.name : "";
  return name === NO_SESSION_ERROR_NAME ? "UNAUTHORIZED" : "NETWORK";
}

// Pure: what a failed download said. The text names the HTTP status when the server answered ("response has status 403" on
// iOS, "response has status: 403" or "HTTP 403" on Android) and names none when the connection failed.
export function toDownloadFailure(error: unknown): DevotionalFailureCode {
  const message = error instanceof Error ? error.message : "";
  const status = /(?:status:?|HTTP)\s*(\d{3})/i.exec(message);
  if (status === null) return "NETWORK";
  const code = Number(status[1]);
  if (code === 401 || code === 403) return "UNAUTHORIZED";
  if (code === 404) return "NOT_FOUND";
  return "UNKNOWN";
}

type LinkResult = { ok: true; url: string } | { ok: false; code: DevotionalFailureCode };

// A link that has not come after DEVOTIONAL_LINK_TIMEOUT_MS counts as no answer: the request is left to finish unseen and
// its late answer is dropped, so it can never start a download, or a devotional, later.
async function signedLink(path: string): Promise<LinkResult> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, code: "UNAUTHORIZED" };
  const ask = async (): Promise<LinkResult> => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, DEVOTIONAL_LINK_SECONDS);
      if (error !== null) return { ok: false, code: toStorageFailure(error) };
      return data?.signedUrl ? { ok: true, url: data.signedUrl } : UNKNOWN;
    } catch (error) {
      return { ok: false, code: toStorageFailure(error) };
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<LinkResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, code: "NETWORK" }), DEVOTIONAL_LINK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([ask(), late]);
  } finally {
    clearTimeout(timer);
  }
}

// Keeps the newest MAX_CACHED_DEVOTIONALS files (the one just saved is always one of them) and clears the unfinished
// downloads that an earlier run left behind. Never throws: the cache is a convenience.
function pruneCache(keepEntryId: string): void {
  try {
    const directory = folder();
    if (!directory.exists) return;
    const files = directory.list().filter((item): item is File => item instanceof File);
    for (const file of files) {
      if (!file.name.endsWith(PART_SUFFIX)) continue;
      const entryId = file.name.slice(0, -(DEVOTIONAL_EXTENSION.length + PART_SUFFIX.length));
      if (!running.has(entryId)) deleteQuietly(file);
    }
    const keepName = `${keepEntryId}${DEVOTIONAL_EXTENSION}`;
    const older = files
      .filter((file) => file.name.endsWith(DEVOTIONAL_EXTENSION) && file.name !== keepName)
      .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
    for (const file of older.slice(Math.max(0, MAX_CACHED_DEVOTIONALS - 1))) deleteQuietly(file);
  } catch {
    // Left for the next download.
  }
}

async function fetchFile(entryId: string, audioPath: string, signal: AbortSignal): Promise<DevotionalFileResult> {
  try {
    const target = fileFor(entryId);
    if (target.exists) {
      if (target.size >= MIN_DEVOTIONAL_FILE_BYTES) return { ok: true, uri: target.uri };
      // Too small to be audio: a save that did not finish.
      deleteQuietly(target);
    }
    // Not on the phone, and NetInfo says there is no connection: say so now instead of asking for a link that cannot come.
    if (!selectCanSend(useOfflineStore.getState())) return { ok: false, code: "NETWORK" };
    const link = await signedLink(audioPath);
    if (!link.ok) return link;
    if (signal.aborted) return UNKNOWN;
    folder().create({ intermediates: true, idempotent: true });
    // The download goes to a file of its own and is moved into place when it is whole: on Android a failed download can
    // leave a half-written file at its destination, and a half-written devotional must never look like a finished one.
    const part = fileFor(entryId, PART_SUFFIX);
    try {
      await File.downloadFileAsync(link.url, part, { idempotent: true, signal });
    } catch (error) {
      deleteQuietly(part);
      return signal.aborted ? UNKNOWN : { ok: false, code: toDownloadFailure(error) };
    }
    if (!part.exists || part.size < MIN_DEVOTIONAL_FILE_BYTES) {
      deleteQuietly(part);
      return UNKNOWN;
    }
    await part.move(target, { overwrite: true });
    // Signed out while it ran (the abort cannot always reach a download that is nearly done): what arrived is not kept.
    if (signal.aborted) {
      deleteQuietly(target);
      return UNKNOWN;
    }
    pruneCache(entryId);
    return { ok: true, uri: target.uri };
  } catch {
    return UNKNOWN;
  }
}

// The devotional's audio as a file on the phone: the one already there, or one downloaded now. Never throws. The caller
// passes the entry id (the file's name) and the storage path from the entry (where it is).
export function getDevotionalFile(entryId: string, audioPath: string): Promise<DevotionalFileResult> {
  if (!SAFE_ENTRY_ID.test(entryId)) return Promise.resolve(UNKNOWN);
  const existing = running.get(entryId);
  if (existing !== undefined) return existing.promise;
  const abort = new AbortController();
  const promise = fetchFile(entryId, audioPath, abort.signal).finally(() => {
    if (running.get(entryId)?.abort === abort) running.delete(entryId);
  });
  running.set(entryId, { promise, abort });
  return promise;
}

// A file the player could not open is deleted, so the next request downloads it again. Never throws.
export function forgetDevotionalFile(entryId: string): void {
  if (!SAFE_ENTRY_ID.test(entryId)) return;
  deleteQuietly(fileFor(entryId));
}

// Sign-out and account deletion: a prayer's audio must not outlive the session. Downloads that are still running are
// stopped, and one that finishes anyway deletes its file (it checks its signal). Never throws.
export async function deleteAllDevotionalAudio(): Promise<void> {
  for (const { abort } of running.values()) abort.abort();
  running.clear();
  try {
    const directory = folder();
    if (directory.exists) directory.delete();
  } catch {
    // Left for the next download's clean-up.
  }
}
