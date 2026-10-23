import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../_shared/errors.ts";
import { MAX_AUDIO_BYTES } from "./constants.ts";

// Reads one recording from the private journal_media bucket. validateRequest has already proved that `path` is
// {userId}/raw/{clientEntryId}.m4a for the verified caller.
export async function downloadRecording(admin: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from("journal_media").download(path);
  if (error || !data) {
    const failure = (error ?? {}) as { status?: number; statusCode?: string | number; message?: string };
    // Storage answers a missing object with HTTP 400 and statusCode "404" (seen with supabase-js 2.118).
    const missing = String(failure.statusCode) === "404" || failure.status === 404 ||
      /not.?found/i.test(failure.message ?? "");
    throw missing ? new AppError("AUDIO_NOT_FOUND", "audio_missing") : new AppError("INTERNAL", "storage:download");
  }
  if (data.size === 0) throw new AppError("AUDIO_NOT_FOUND", "audio_empty");
  if (data.size > MAX_AUDIO_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "audio_size");
  return new Uint8Array(await data.arrayBuffer());
}
