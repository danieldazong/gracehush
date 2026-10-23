// Keep in sync with src/types/index.ts (the app's copy of these types).
//
// Types only, and no imports, so that both Deno (this function) and the app's TypeScript can read this one file.
// src/types/contractParity.ts compares the two copies at compile time: a difference fails `npm run typecheck`.

export type TimeSlot = "morning" | "afternoon" | "evening";
export type InputType = "text" | "audio";
export type ProcessingStatus = "pending" | "uploading" | "processing" | "ready" | "failed";
export type EmotionKey = "anxious" | "weary" | "grateful" | "grieving" | "hopeful";
export type PrayerCategory =
  | "FAMILY & HEALING"
  | "VOCATION & CALLING"
  | "INNER PEACE"
  | "RELATIONSHIPS"
  | "PROVISION"
  | "GUIDANCE";

export type AudioMimeType = "audio/mp4" | "audio/m4a" | "audio/x-m4a" | "audio/aac";

export type ProcessEntryRequest =
  | { clientEntryId: string; inputType: "text"; text: string }
  | {
    clientEntryId: string;
    inputType: "audio";
    audioPath: string;
    durationMs: number;
    mimeType: AudioMimeType;
  };

export type ProcessEntryErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "LIMIT_REACHED"
  | "METHOD_NOT_ALLOWED"
  | "ALREADY_PROCESSING"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_SHORT"
  | "AUDIO_NOT_FOUND"
  | "NO_SPEECH"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "AI_UNAVAILABLE";

export type StoredErrorCode = ProcessEntryErrorCode | "TTS_FAILED";

export interface ProcessEntryError {
  error: { code: ProcessEntryErrorCode; message: string; requestId: string };
}

export interface Scripture {
  reference: string;
  text: string | null;
  translation: "BSB";
  verified: boolean;
}

export interface Devotional {
  title: string;
  script: string;
  closingPrayer: string | null;
  audioPath: string | null;
  durationMs: number | null;
}

export interface Affirmation {
  id: string;
  entryId: string;
  slot: TimeSlot;
  headline: string;
  text: string;
  isFavorite: boolean;
}

export interface Prayer {
  id: string;
  title: string;
  category: PrayerCategory | null;
  summary: string;
  scriptureReference: string | null;
  createdAt: string;
  isAnswered: boolean;
  answeredAt: string | null;
  answeredNote: string | null;
}

export interface JournalEntry {
  id: string;
  clientEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  inputType: InputType;
  transcript: string | null;
  dominantEmotion: string | null;
  status: ProcessingStatus;
  isCrisis: boolean;
  scripture: Scripture | null;
  devotional: Devotional | null;
  prayer: Prayer | null;
  failureCode: StoredErrorCode | null;
  isLocalOnly: boolean;
}

export type ProcessEntryResponse = { entry: JournalEntry; affirmations: Affirmation[] };

// confirm-scripture (step 20): asked again for the passage of a reflection whose text could not be read when it was made.
// The answer is the entry's passage as it now stands: verified with its text, still unverified, or null when the entry has
// none (a crisis entry, one still being prepared, or a reference that turned out not to exist).
export type ConfirmScriptureRequest = { entryId: string };
export type ConfirmScriptureResponse = { scripture: Scripture | null };
export type ConfirmScriptureErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL";
export interface ConfirmScriptureError {
  error: { code: ConfirmScriptureErrorCode; message: string; requestId: string };
}
