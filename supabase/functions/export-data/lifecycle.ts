import type { SupabaseClient } from "@supabase/supabase-js";

import { listAllFiles, removeAll, type StoredFile } from "../_shared/account/storageFiles.ts";
import { AppError } from "../_shared/errors.ts";
import { DOWNLOAD_NAME } from "./archive.ts";

// Every storage call of export-data (step 31). The ZIPs live in the private exports bucket at {userId}/{exportId}.zip (or
// -partial.zip when audio was left out); no storage policy names that bucket, so only this function (the service role) reads or
// writes it, and people get a signed link. The audio is read from journal_media, always inside the person's own folder.

export const EXPORTS_BUCKET = "exports";
export const MEDIA_BUCKET = "journal_media";
// How long a link to the ZIP lives: it is opened from the app right after the export is ready, and a link to someone's prayers
// should not stay usable for a day in a browser's history.
export const LINK_SECONDS = 3600;

export function listExports(admin: SupabaseClient, userId: string): Promise<StoredFile[]> {
  return listAllFiles(admin, EXPORTS_BUCKET, userId);
}

// Every audio file the person has, by path, with its size when Storage reports one.
export async function listMedia(admin: SupabaseClient, userId: string): Promise<Map<string, number | null>> {
  const files = await listAllFiles(admin, MEDIA_BUCKET, userId);
  return new Map(files.map((file) => [file.path, file.size]));
}

// One file's bytes, or why there are none: "missing" (Storage does not have it, or would not give it) or "timeout" (the export's
// time ran out while it was on its way). Neither is a failure of the export: the file is left out and listed.
export async function downloadMedia(
  admin: SupabaseClient,
  path: string,
  signal: AbortSignal,
): Promise<Uint8Array | "missing" | "timeout"> {
  try {
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).download(path, {}, { signal });
    if (error || !data) return signal.aborted ? "timeout" : "missing";
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return signal.aborted ? "timeout" : "missing";
  }
}

export async function removeExports(admin: SupabaseClient, paths: string[]): Promise<void> {
  await removeAll(admin, EXPORTS_BUCKET, paths);
}

export async function uploadExport(admin: SupabaseClient, path: string, zip: Uint8Array): Promise<void> {
  const { error } = await admin.storage.from(EXPORTS_BUCKET).upload(path, zip, {
    contentType: "application/zip",
    upsert: false,
  });
  if (error) throw new AppError("INTERNAL", "storage_upload");
}

// A link that downloads the ZIP as gracehush-journal.zip and lives LINK_SECONDS.
export async function signExport(admin: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(EXPORTS_BUCKET).createSignedUrl(path, LINK_SECONDS, {
    download: DOWNLOAD_NAME,
  });
  if (error || !data?.signedUrl) throw new AppError("INTERNAL", "storage_sign");
  return data.signedUrl;
}
