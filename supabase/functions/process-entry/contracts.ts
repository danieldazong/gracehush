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
  // The first line on the Reflection screen (step 36), written from the entry. Null for a reflection made before it.
  validation: string | null;
  script: string;
  closingPrayer: string | null;
  audioPath: string | null;
  durationMs: number | null;
}

// gen-v2.5 (step 37): the verse an affirmation carries, its reference and its exact Berean Standard Bible text, read from the
// Bible by the server. A notification shows it under the headline.
export interface AffirmationVerse {
  reference: string;
  text: string;
}

export interface Affirmation {
  id: string;
  entryId: string;
  // The lock-screen slot it carries, or null for an affirmation added beyond the first three (2026-11-09): the three slotted
  // ones are the notifications, and a new one may take a slot over when it fits that time of day better.
  slot: TimeSlot | null;
  // Its place among the reflection's affirmations, 1 to 10 (AFFIRMATION_LIMIT): the order the cards are shown in.
  position: number;
  headline: string;
  text: string;
  isFavorite: boolean;
  // Null for an affirmation saved before step 37, or one whose verse could not be found.
  verse: AffirmationVerse | null;
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

// The help line a heavy moment shows (2026-11-11, the readers' review): the 988 Lifeline ("crisis"), the National Domestic
// Violence Hotline with 911 ("abuse"), 988 with 911 ("harm_others"), or 911 first ("emergency"). The app picks the numbers for the
// phone's region; outside the US it shows a helpline directory and the local emergency number instead.
export type HelpKind = "crisis" | "abuse" | "harm_others" | "emergency";

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
  // The help line under a heavy moment: null for every other entry ("crisis" for one saved before 2026-11-11).
  helpLine: HelpKind | null;
  scripture: Scripture | null;
  devotional: Devotional | null;
  prayer: Prayer | null;
  failureCode: StoredErrorCode | null;
  isLocalOnly: boolean;
}

export type ProcessEntryResponse = { entry: JournalEntry; affirmations: Affirmation[] };

// add-affirmation (2026-11-09): one more affirmation for a finished reflection, up to AFFIRMATION_LIMIT (10) in all. The
// answer is every affirmation of the reflection as it now stands, in position order: the new one, and the slot a lock-screen
// affirmation may have lost to it. AFFIRMATION_LIMIT is a reflection that already has all ten; NOT_FOUND another person's
// entry or one that does not exist; ALREADY_PROCESSING a reflection still being made (or two requests at once).
export type AddAffirmationRequest = { entryId: string };
export type AddAffirmationResponse = { affirmations: Affirmation[] };
export type AddAffirmationErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "ALREADY_PROCESSING"
  | "AFFIRMATION_LIMIT"
  | "METHOD_NOT_ALLOWED"
  | "AI_UNAVAILABLE"
  | "INTERNAL";
export interface AddAffirmationError {
  error: { code: AddAffirmationErrorCode; message: string; requestId: string };
}

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
// Clerk user. The body must be { confirm: "DELETE" }, with Apple's one-time code beside it when the person signed in with Apple
// (step 35: it lets the server end Gracehush's access to their Sign in with Apple, and no code or a bad one never stops a deletion).
// DELETE_INCOMPLETE is a step that failed: what was done stays done, and the same request sent again continues.
export type DeleteAccountRequest = { confirm: "DELETE"; appleAuthorizationCode?: string };
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

// ---- Scholar (step 38): scholar-turn and scholar-speak --------------------------------------------------------------------
// The server's copy. The app's copy is in src/types/index.ts (Part two of step 38), and src/types/contractParity.ts compares
// the two.

// A typed message's words, or a spoken message's length (its recording is read from storage, never sent in a body).
export type ScholarInput = { type: "text"; text: string } | { type: "audio"; durationMs: number };

export type ScholarTurnRequest = {
  conversationId: string; // a lowercase UUID v4 made on the phone
  messageId: string; // the same, one per message; a retry reuses it
  input: ScholarInput;
  entryId?: string; // only when the conversation is opened from a reflection
  region?: string; // the phone's region, two capital letters ("US"); the US when missing. Chooses the emergency number.
};

// An answer's blocks, in the order they are drawn: the lead passage, the text, the supporting passage, the prayer.
export type ScholarBlock =
  | { type: "text"; text: string } // paragraphs separated by a blank line
  | { type: "passage"; scripture: Scripture } // always verified, translation "BSB"
  | { type: "prayer"; text: string }; // without "Amen": the app adds it

export type ScholarRole = "user" | "scholar";
export type ScholarMessageStatus = "pending" | "ready" | "failed";

export interface ScholarMessage {
  id: string;
  conversationId: string;
  role: ScholarRole;
  replyTo: string | null;
  inputType: "text" | "audio" | null;
  status: ScholarMessageStatus;
  errorCode: string | null;
  blocks: ScholarBlock[];
  isHeavy: boolean;
  // The help line under an answer to a flagged message and under the written fallback; null otherwise.
  helpLine: HelpKind | null;
  createdAt: string;
}

export interface ScholarConversation {
  id: string;
  entryId: string | null;
  title: string | null;
  isHeavy: boolean;
  lastMessageAt: string;
  createdAt: string;
}

export type ScholarUsageKind = "free_day" | "pro_day" | "listen_day" | "listen_plan";

export interface ScholarUsage {
  kind: ScholarUsageKind;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string | null;
}

export type ScholarTurnResponse = {
  conversation: ScholarConversation;
  message: ScholarMessage; // the person's, with the transcript for a spoken one
  answer: ScholarMessage; // role "scholar"
  usage: ScholarUsage | null; // null in a heavy conversation
};

export type ScholarTurnErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "LIMIT_REACHED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "ALREADY_PROCESSING"
  | "PAYLOAD_TOO_LARGE"
  | "AUDIO_NOT_FOUND"
  | "NO_SPEECH"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "SCHOLAR_UNAVAILABLE"
  | "SCHOLAR_ADULTS_ONLY"
  | "INTERNAL";
export interface ScholarTurnError {
  error: { code: ScholarTurnErrorCode; message: string; requestId: string };
}
// The 402 (after a clear screening only): the day's numbers beside `error`.
export interface ScholarLimitError {
  error: { code: "LIMIT_REACHED"; message: string; requestId: string };
  usage: ScholarUsage;
}

export type ScholarSpeakRequest = { messageId: string; part: number; region?: string };
export type ScholarSpeakResponse = { part: number; parts: number; audioBase64: string; durationMs: number };
export type ScholarSpeakErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "LIMIT_REACHED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "AI_UNAVAILABLE"
  | "INTERNAL";
export interface ScholarSpeakError {
  error: { code: ScholarSpeakErrorCode; message: string; requestId: string };
}
