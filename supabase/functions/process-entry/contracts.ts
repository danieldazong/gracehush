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

// The 402 body (step 22): the usual error, the entry that was saved, and the numbers the Paywall needs. `used` is the real
// count and can be higher than `limit` (a person who was Pro earlier in the week and then lapsed), so a screen that shows
// it shows the smaller of the two.
export interface LimitUsage {
  used: number;
  limit: number;
  resetsAt: string; // ISO 8601: the start of next week on the person's clock
}
export interface ProcessEntryLimitError {
  error: { code: "LIMIT_REACHED"; message: string; requestId: string };
  entryId: string;
  usage: LimitUsage;
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

// delete-entry (step 29b): deletes one reflection for good: its recording, its devotional audio, its affirmations and the row.
// NOT_FOUND means it is already gone (or never was this person's): the app counts that as deleted. ALREADY_PROCESSING is a
// reflection that a request is still making.
export type DeleteEntryRequest = { entryId: string };
export type DeleteEntryResponse = { deleted: true };
export type DeleteEntryErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "ALREADY_PROCESSING"
  | "INTERNAL";
export interface DeleteEntryError {
  error: { code: DeleteEntryErrorCode; message: string; requestId: string };
}

// sync-subscription (step 30): the server re-reads the caller's RevenueCat customer and writes the plan on their profile, then
// answers it. The app calls it after a purchase or a restore, and when its plan and the server's differ; the body is ignored.
// NOT_FOUND is a caller with no profile yet; BILLING_UNAVAILABLE is RevenueCat that could not be read (the plan stays as it was).
export type SubscriptionTier = "free" | "trial" | "pro";
export type SyncSubscriptionResponse = { tier: SubscriptionTier; expiresAt: string | null };
export type SyncSubscriptionErrorCode =
  | "UNAUTHORIZED"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "BILLING_UNAVAILABLE"
  | "INTERNAL";
export interface SyncSubscriptionError {
  error: { code: SyncSubscriptionErrorCode; message: string; requestId: string };
}

// export-data (step 31): a ZIP of everything the person has (a README, the data as JSON, the journal as Markdown, and their audio
// while it fits), kept in the private exports bucket, and a link to it that lives one hour. `partial` is an export that left
// audio out (the README lists it); `reused` is the same ZIP handed back again within ten minutes. The body is ignored.
export type ExportDataResponse = {
  url: string;
  expiresAt: string;
  partial: boolean;
  reused: boolean;
  sizeBytes: number;
};
export type ExportDataErrorCode = "UNAUTHORIZED" | "METHOD_NOT_ALLOWED" | "INTERNAL";
export interface ExportDataError {
  error: { code: ExportDataErrorCode; message: string; requestId: string };
}

// delete-account (step 31): deletes the caller's account for good: their files, their rows, their RevenueCat customer and their
// Clerk user. The body must be exactly { confirm: "DELETE" }. DELETE_INCOMPLETE is a step that failed: what was done stays done,
// and the same request sent again continues.
export type DeleteAccountRequest = { confirm: "DELETE" };
export type DeleteAccountResponse = { deleted: true };
export type DeleteAccountErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "METHOD_NOT_ALLOWED"
  | "DELETE_INCOMPLETE"
  | "INTERNAL";
export interface DeleteAccountError {
  error: { code: DeleteAccountErrorCode; message: string; requestId: string };
}
