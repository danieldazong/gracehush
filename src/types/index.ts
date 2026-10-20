export type AuthErrorCode =
  | "INVALID_EMAIL"
  | "INVALID_CODE"
  | "CANCELLED"
  | "NETWORK"
  | "RATE_LIMITED"
  | "NOT_SUPPORTED"
  | "UNKNOWN";
export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode; message: string };

// "undetermined" also covers a permission that can still be asked (see services/permissions.ts).
export type PermissionResult = "granted" | "denied" | "undetermined";

export type TimeSlot = "morning" | "afternoon" | "evening";
export type InputType = "text" | "audio";
export type SubscriptionTier = "free" | "trial" | "pro";
export type ProcessingStatus = "pending" | "uploading" | "processing" | "ready" | "failed";
export type EmotionKey = "anxious" | "weary" | "grateful" | "grieving" | "hopeful";
export type AmbientSound = "off" | "soft-rain" | "gentle-piano" | "morning-birds";
export type PrayerCategory =
  | "FAMILY & HEALING"
  | "VOCATION & CALLING"
  | "INNER PEACE"
  | "RELATIONSHIPS"
  | "PROVISION"
  | "GUIDANCE";

// Used by every repository write added in steps 14, 15, 17, 25 and 29. Step 17 adds "UNAUTHORIZED".
export type RepoResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "NOT_FOUND" | "INVALID" | "NETWORK" | "UNKNOWN"; message: string };

// App models. Plain JSON (step 24 caches them as JSON): ISO strings for dates, null instead of
// undefined, and no Date, Map or function values.

export interface UserProfile {
  id: string;
  createdAt: string;
  subscriptionTier: SubscriptionTier;
  reminders: Record<TimeSlot, string>; // "HH:mm", 24-hour
  timezone: string;
  ambientSound: AmbientSound;
  ambientVolume: number; // 0–1
  affirmationsEnabled: boolean;
}

export interface Scripture {
  reference: string; // e.g. "Philippians 4:6–7"
  text: string | null; // null unless verified
  translation: "BSB";
  verified: boolean;
}

export interface Devotional {
  title: string;
  script: string; // plain text, paragraphs separated by a blank line
  closingPrayer: string | null; // stored without the final "Amen" (step 11 shows it)
  audioPath: string | null; // a storage path, never a URL
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
  id: string; // the journal entry id: a prayer lives on its entry
  title: string;
  category: PrayerCategory | null;
  summary: string;
  scriptureReference: string | null;
  createdAt: string; // the entry's created_at
  isAnswered: boolean;
  answeredAt: string | null;
  answeredNote: string | null;
}

// scripture, devotional and prayer are null for crisis, pending, uploading, processing and failed
// entries. A crisis entry never has affirmations.
export interface JournalEntry {
  id: string;
  clientEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  inputType: InputType;
  transcript: string | null; // null while an audio entry has not been transcribed
  dominantEmotion: string | null; // raw lowercase AI string; null for crisis and unfinished entries
  status: ProcessingStatus;
  isCrisis: boolean;
  scripture: Scripture | null;
  devotional: Devotional | null;
  prayer: Prayer | null;
  failureCode: StoredErrorCode | null;
  isLocalOnly: boolean;
}

export interface PlanUsage {
  tier: SubscriptionTier;
  used: number;
  limit: number | null; // null for unlimited
  resetsAt: string;
}

// Keep in sync with supabase/functions/process-entry/contracts.ts (step 19)
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

// HTTP statuses for these are defined in step 19.
export type ProcessEntryErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "LIMIT_REACHED" // opens the Paywall (step 22)
  | "METHOD_NOT_ALLOWED"
  | "ALREADY_PROCESSING"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_SHORT"
  | "AUDIO_NOT_FOUND"
  | "NO_SPEECH"
  | "CONTENT_BLOCKED"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "AI_UNAVAILABLE";

// What `error_code` can hold. TTS_FAILED is stored only: the entry is still ready as text (step 22).
export type StoredErrorCode = ProcessEntryErrorCode | "TTS_FAILED";

export interface ProcessEntryError {
  error: { code: ProcessEntryErrorCode; message: string; requestId: string };
}

// A crisis entry comes back with `affirmations: []`. Steps 19, 21 and 22 add fields (the 402 body, signed audio URL).
export type ProcessEntryResponse = { entry: JournalEntry; affirmations: Affirmation[] };

// New Entry (step 10). Steps 23 and 25 swap the mock recorder and the mock submit without changing these.
export type RecorderStatus = { isRecording: boolean; durationMs: number; metering: number }; // metering 0..1
export type RecordingResult = { uri: string; durationMs: number; mimeType: AudioMimeType };
export type ProcessingStage = "receiving" | "reflecting" | "preparing";
export type SubmitResult =
  | { kind: "ready"; entryId: string }
  | { kind: "crisis"; entryId: string }
  | { kind: "error"; code: ProcessEntryErrorCode };

// The player (step 12). Steps 15, 26 and 27 read these names: they may add to them, never rename.
export type PlaybackStatus = "idle" | "playing" | "paused" | "ended";
export type PlaybackRate = 0.8 | 1 | 1.2;
// `subtitle` is "Gracehush • Philippians 4:6–7", the same string step 26 puts on the lock screen.
export type PlaybackTrack = { entryId: string; title: string; subtitle: string; durationMs: number };
export type AmbientDefault = Pick<UserProfile, "ambientSound" | "ambientVolume">;
