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

// Used by every repository write added in steps 14, 15, 17, 25 and 29.
export type RepoResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "NOT_FOUND" | "INVALID" | "NETWORK" | "UNAUTHORIZED" | "UNKNOWN";
      message: string;
    };

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

// What updateProfile can change (step 15). The reminder times are not here: they live in the onboarding store,
// and the profile sync (step 17) keeps them in step with users_profile.
export type ProfilePatch = Partial<
  Pick<UserProfile, "affirmationsEnabled" | "ambientSound" | "ambientVolume">
>;

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

// What marking a prayer answered needs (step 14). `answeredDate` is a local calendar day, "YYYY-MM-DD".
export type MarkAnsweredInput = { prayerId: string; answeredDate: string; note: string | null };

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

// The paywall (step 16). Shaped like RevenueCat's package and product so step 30 maps the SDK one to one:
// `id` is the package identifier, `priceString` is the store's localized price and `price` is only for sums.
export type PackageKind = "annual" | "monthly";
export type IntroOffer = { kind: "free_trial"; periodDays: number };
export type PlanPackage = {
  id: string;
  kind: PackageKind;
  productId: string;
  priceString: string;
  price: number;
  currencyCode: string;
  periodLabel: "year" | "month";
  pricePerMonthString: string | null; // the SDK's own per-month string, when it has one
  introOffer: IntroOffer | null;
};
export type Offering = { id: string; packages: PlanPackage[] };

export type PurchaseErrorCode =
  | "CANCELLED"
  | "PENDING"
  | "NETWORK"
  | "NOT_ALLOWED"
  | "ALREADY_OWNED"
  | "UNKNOWN";
export type PurchaseResult =
  | { ok: true; tier: "trial" | "pro" }
  | { ok: false; code: PurchaseErrorCode; message: string };
export type RestoreResult =
  | { ok: true; restored: boolean; tier: SubscriptionTier }
  | { ok: false; code: "NETWORK" | "UNKNOWN"; message: string };

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

// confirm-scripture (step 20): asked again for the passage of a reflection whose text could not be read when it was made.
// The answer is the entry's passage as it now stands: verified with its text, still unverified, or null when the entry has
// none (a crisis entry, one still being prepared, or a reference that turned out not to exist). Step 25 calls it.
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

// Crisis support (step 13). The data is in constants/crisisResources.ts.
export type CrisisActionKind = "call" | "text" | "web";
export type CrisisIcon = "call" | "text" | "emergency" | "web";
export type CrisisGroupId = "lifeline" | "other";

// One way to reach help: a row on the Reflection crisis view and on Support Resources.
export type CrisisResource = {
  id: string;
  title: string; // the service
  detail: string; // what a tap does, one short line
  group: CrisisGroupId; // the heading it sits under on Support Resources
  // What the row says under its group heading, where the heading already names the service. Falls back to
  // title and detail.
  grouped?: { title: string; detail: string };
  icon: CrisisIcon;
  kind: CrisisActionKind;
  value: string; // the number or the URL
  body?: string; // SMS prefill, text only
  urgent: boolean; // the crisis-red tile: only the lifeline call and 911
  onReflection: boolean; // on the Reflection crisis view (all of them are on Support Resources)
  accessibilityLabel: string; // says what the tap does
};

export type CrisisAction = Pick<CrisisResource, "kind" | "value" | "body">;
