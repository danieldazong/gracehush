import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../errors.ts";

// Writes a devotional's WAV to the private journal_media bucket (step 22; a WAV since 2026-10-24) and returns its path, which is all that is ever
// stored: never a URL. The app reads its own folder with a short-lived signed link that it asks Supabase for itself
// (createSignedUrl(path, 3600), allowed by the bucket's select policy for the folder named by the user id), so the
// function mints and returns no link. Only the function writes here (the service role): the app cannot overwrite or
// delete a devotional. A second write to the same path replaces the first, so a retry is safe.

export function devotionalAudioPath(userId: string, entryId: string): string {
  return `${userId}/devotionals/${entryId}.wav`;
}

// The two ids come from the verified token and the database, but they end up in a path, so a character that could change
// the folder is refused instead of trusted.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function storeDevotionalAudio(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
  audio: Uint8Array,
): Promise<string> {
  if (!SAFE_ID.test(userId) || !SAFE_ID.test(entryId)) throw new AppError("INTERNAL", "storage:bad_path");
  const path = devotionalAudioPath(userId, entryId);
  const { error } = await admin.storage.from("journal_media").upload(path, audio, {
    contentType: "audio/wav",
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw new AppError("INTERNAL", "storage:upload");
  return path;
}
