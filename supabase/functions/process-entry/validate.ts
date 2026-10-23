import { AppError } from "../_shared/errors.ts";
import {
  AUDIO_MIME_TYPES,
  MAX_BODY_BYTES,
  MAX_RECORDING_MS,
  MAX_TEXT_LENGTH,
  MIN_RECORDING_MS,
  MIN_TEXT_LENGTH,
  RECORDING_GRACE_MS,
} from "./constants.ts";
import type { AudioMimeType, ProcessEntryRequest } from "./contracts.ts";

// A canonical, lowercase UUID v4: the same string the app builds the storage path from.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The one place a recording may be read from: {userId}/raw/{clientEntryId}.m4a (the step 18 layout).
export function rawAudioPath(userId: string, clientEntryId: string): string {
  return `${userId}/raw/${clientEntryId}.m4a`;
}

// Reads at most MAX_BODY_BYTES, so a huge or endless body never sits in memory.
async function readLimited(req: Request): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE", "body_size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonBody(req: Request): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new AppError("INVALID_REQUEST", "content_type");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "body_size");
  const text = await readLimited(req);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_REQUEST", "json");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Checks the body against the contract and returns it in the contract's own shape. Any other field in the body,
// a user_id included, is never read. `userId` is the verified caller: it is only used to check the audio path.
export function validateRequest(body: unknown, userId: string): ProcessEntryRequest {
  if (!isRecord(body)) throw new AppError("INVALID_REQUEST", "body_shape");
  // Audio travels through storage now. A body that carries it is an old client or a mistake.
  if ("audioBase64" in body) throw new AppError("INVALID_REQUEST", "audio_base64");

  const { clientEntryId, inputType } = body;
  if (typeof clientEntryId !== "string" || !UUID_V4.test(clientEntryId)) {
    throw new AppError("INVALID_REQUEST", "client_entry_id");
  }

  if (inputType === "text") {
    if (typeof body.text !== "string") throw new AppError("INVALID_REQUEST", "text_type");
    const text = body.text.trim();
    if (text.length < MIN_TEXT_LENGTH) throw new AppError("TOO_SHORT", "text_short");
    if (text.length > MAX_TEXT_LENGTH) throw new AppError("PAYLOAD_TOO_LARGE", "text_long");
    return { clientEntryId, inputType, text };
  }

  if (inputType === "audio") {
    const { audioPath, durationMs, mimeType } = body;
    // Never read another person's file: the path must be exactly this user's, for this entry.
    if (audioPath !== rawAudioPath(userId, clientEntryId)) throw new AppError("INVALID_REQUEST", "audio_path");
    if (typeof mimeType !== "string" || !(AUDIO_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new AppError("INVALID_REQUEST", "audio_mime");
    }
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
      throw new AppError("INVALID_REQUEST", "audio_duration");
    }
    if (durationMs < MIN_RECORDING_MS) throw new AppError("TOO_SHORT", "audio_short");
    if (durationMs > MAX_RECORDING_MS + RECORDING_GRACE_MS) throw new AppError("PAYLOAD_TOO_LARGE", "audio_long");
    return { clientEntryId, inputType, audioPath, durationMs, mimeType: mimeType as AudioMimeType };
  }

  throw new AppError("INVALID_REQUEST", "input_type");
}
