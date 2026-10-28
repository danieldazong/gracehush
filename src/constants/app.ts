import type { AmbientSound, PlaybackRate, TimeSlot } from "@/types";

// Keep in sync with supabase/functions/_shared/limits/constants.ts (step 22).
export const FREE_DEVOTIONALS_PER_WEEK = 3;
export const WEEK_STARTS_ON = 1; // Monday

// "HH:mm", 24-hour. Copy it (`{ ...DEFAULT_REMINDERS }`) so nothing shares the reference.
export const DEFAULT_REMINDERS: Record<TimeSlot, string> = {
  morning: "08:00",
  afternoon: "13:00",
  evening: "20:00",
};

// The Android notification channel for the three daily affirmations (step 28 reuses it).
export const AFFIRMATION_CHANNEL_ID = "affirmations";
// The affirmation notifications (step 28): the days the phone schedules ahead (refilled whenever the app comes to the front),
// the least time before a notification that one can still be scheduled (iOS refuses a time that has passed), and how long
// requests to plan again are gathered into one run.
export const AFFIRMATION_DAYS_AHEAD = 7;
export const AFFIRMATION_MIN_LEAD_MS = 10_000;
export const AFFIRMATION_RESCHEDULE_DEBOUNCE_MS = 500;

// Keep in sync with supabase/functions/process-entry/contracts.ts (step 19)
export const MAX_RECORDING_MS = 300_000;
export const MIN_RECORDING_MS = 3_000;
export const RECORDING_WARNING_MS = 270_000;
export const MAX_TEXT_LENGTH = 5_000;
export const MIN_TEXT_LENGTH = 10;
export const TEXT_COUNTER_FROM = 4_500;

// The bars on the New Entry waveform. Here and not in the component, so the recorder hook (the levels it
// keeps) and the component share it without the hook importing a component.
export const WAVEFORM_BAR_COUNT = 9;

// Prayers (step 14). A gratitude note is at most this long, and its counter shows from GRATITUDE_COUNTER_FROM.
export const MAX_GRATITUDE_NOTE_LENGTH = 1_000;
export const GRATITUDE_COUNTER_FROM = 900;

// Journal data (step 25). The Journal asks the server for ENTRIES_PAGE_SIZE entries at a time and keeps the newest
// ENTRY_CACHE_LIMIT on the phone (the read cache of step 24).
export const ENTRIES_PAGE_SIZE = 30;
export const ENTRY_CACHE_LIMIT = 200;
// An entry that the server still calls "processing" this long after it was last touched belongs to a request that died
// (the server's claim lapses after 3 minutes, step 19): the Journal does not list it, or it would be a card that never finishes.
export const STALE_PROCESSING_MS = 10 * 60_000;
// A reflection whose passage is not verified asks the server to read it again at most this often (confirm-scripture, step 20).
export const SCRIPTURE_RETRY_MS = 60_000;
// A reflection that a server is still preparing is read again this often, for at most REFLECTION_POLL_MAX_MS (step 25).
export const REFLECTION_POLL_MS = 5_000;
export const REFLECTION_POLL_MAX_MS = 120_000;
// How long a call to an Edge Function may take. process-entry stops itself at about 145 seconds (the platform stops a function at
// 150, step 22), and the sync engine's own ceiling (200 seconds, step 24) is above this one.
export const PROCESS_ENTRY_TIMEOUT_MS = 155_000;
export const CONFIRM_SCRIPTURE_TIMEOUT_MS = 15_000;

// The player (step 12). Back and forward skip this far; the speed chips and the ambient chips show these,
// in this order.
export const SKIP_MS = 15_000;
export const PLAYBACK_RATES: readonly PlaybackRate[] = [0.8, 1, 1.2];
export const AMBIENT_SOUNDS: readonly AmbientSound[] = [
  "off",
  "soft-rain",
  "gentle-piano",
  "morning-birds",
];

// Profile (step 15). Step 16 reads these three URL constants by name.
// Checked 2026-10-21: both addresses load (Apple's goes to the Apple ID sign-in, Google's to the Google sign-in).
export const MANAGE_SUBSCRIPTION_URL = {
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions",
} as const; // TODO(30): use RevenueCat's managementURL when available
// Apple and Google both require the two policy pages to be reachable inside the app.
export const PRIVACY_POLICY_URL = "https://example.com/TODO-privacy"; // TODO: real URL before release
export const TERMS_URL = "https://example.com/TODO-terms"; // TODO: real URL before release
export const SUPPORT_EMAIL = "support@example.com"; // TODO: real address before release
