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
// A sound that has a file to loop (step 27): every choice but "off".
export type AmbientLoop = Exclude<AmbientSound, "off">;
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

// What the affirmation notifications are made from (step 28): the newest finished reflection on the phone and, when it is not
// a crisis entry, its affirmations (a crisis entry has none).
export type AffirmationSource = { entryId: string; isCrisis: boolean; affirmations: Affirmation[] };

// The tabs of Reflection's carousel. A notification opens Reflection on "affirmations" (step 28).
export type ReflectionTab = "devotional" | "affirmations" | "prayer";

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
  | "RATE_LIMITED"
  | "INTERNAL"
  | "AI_UNAVAILABLE";

// What `error_code` can hold. TTS_FAILED is stored only: the entry is still ready as text (step 22).
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

// A crisis entry comes back with `affirmations: []`. A devotional's `audioPath` and `durationMs` are a path and a number:
// the function returns and stores no link (step 22), and the app asks Supabase for a short-lived link of its own to download
// the file once (step 26).
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

// New Entry (step 10). Step 23 swapped the mock recorder for the real one without changing these; step 24 moved the submit to the
// sync engine, and step 25 gave the engine the real server.
export type RecorderStatus = { isRecording: boolean; durationMs: number; metering: number }; // metering 0..1
export type RecordingResult = { uri: string; durationMs: number; mimeType: AudioMimeType };
// A finished recording as the rest of the app sees it (step 23): the file is recordings/{clientEntryId}.m4a on this
// phone and `sizeBytes` was measured on disk. Step 24 queues it and step 25 uploads it.
export type RecordedAudio = {
  clientEntryId: string;
  uri: string;
  durationMs: number;
  mimeType: AudioMimeType;
  sizeBytes: number;
};
export type ProcessingStage = "receiving" | "reflecting" | "preparing";

// The offline queue (step 24). An item is a reflection that is saved on this phone and has not been prepared yet.
//   queued         waiting its turn, or for the next retry
//   sending        being prepared now
//   needs_action   the server refused it for a reason only the person can fix (no speech heard, too short, ...)
//   limit_reached  the free limit stopped it: it goes again when the plan is paid or the week resets
//   paused_auth    the session was refused: it goes again at the next sign-in
export type OutboxStatus = "queued" | "sending" | "needs_action" | "limit_reached" | "paused_auth";
export type OutboxItem = {
  clientEntryId: string;
  inputType: InputType;
  text: string | null; // a written entry's words. null for a recording, and for words that could not be read
  durationMs: number | null; // a recording's length
  mimeType: AudioMimeType | null; // a recording's type
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number; // epoch ms
  lastErrorCode: string | null;
  serverEntryId: string | null; // the entry the server saved when the free limit stopped this one
  limitResetsAt: number | null; // epoch ms: when the week that holds it back ends
  createdAt: number; // epoch ms
  uploaded: boolean; // a recording is already in the journal_media bucket (step 25): it is not uploaded again
};

// What Journal Home knows about an entry that is still in the outbox: it is listed as an entry-shaped card.
export type PendingInfo = {
  status: OutboxStatus;
  lastErrorCode: string | null;
  serverEntryId: string | null;
  resetsAt: string | null; // ISO 8601
};
export type HomeEntry = JournalEntry & { pending?: PendingInfo };

// What preparing one item gives back (services/entryProcessor.ts). `code` is a process-entry error code, NETWORK when
// no answer came, or UNKNOWN for an answer the app does not know. A LIMIT_REACHED answer carries the entry the server
// saved and when the week resets.
export type ProcessOutcome =
  | { ok: true; entry: JournalEntry; affirmations: Affirmation[] }
  | {
      ok: false;
      code: ProcessEntryErrorCode | "NETWORK" | "UNKNOWN";
      entryId?: string;
      resetsAt?: string;
    };

// The player (step 12). Steps 15, 26 and 27 read these names: they may add to them, never rename.
export type PlaybackStatus = "idle" | "playing" | "paused" | "ended";
export type PlaybackRate = 0.8 | 1 | 1.2;
// Why a devotional's audio could not be had (step 26): the phone has no connection ("offline"), or the file is missing or
// would not open ("unavailable"). The next play tries again.
export type PlaybackError = "offline" | "unavailable";
// `subtitle` is "Gracehush • Philippians 4:6–7", the same string step 26 puts on the lock screen. `audioPath` is where the
// file is in Storage (step 22): the player downloads it once and plays it from the phone.
export type PlaybackTrack = {
  entryId: string;
  title: string;
  subtitle: string;
  durationMs: number;
  audioPath: string;
};
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
