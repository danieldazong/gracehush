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
// A reflection has at most this many affirmations (2026-11-09): the three made with it, and up to seven more the person adds one
// at a time from Reflection. Keep in sync with AFFIRMATION_LIMIT in supabase/functions/process-entry/constants.ts.
export const MAX_AFFIRMATIONS = 10;

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
// Prayers (step 29): the most prayers the screen asks the server for at once, newest first. The cache keeps every prayer
// besides its ENTRY_CACHE_LIMIT other entries.
export const PRAYERS_LIMIT = 300;
// An entry that the server still calls "processing" this long after it was last touched belongs to a request that died
// (the server's claim lapses after 3 minutes, step 19): the Journal does not list it, or it would be a card that never finishes.
export const STALE_PROCESSING_MS = 10 * 60_000;
// A reflection whose passage is not verified asks the server to read it again at most this often (confirm-scripture, step 20).
export const SCRIPTURE_RETRY_MS = 60_000;
// A reflection that a server is still preparing is read again this often, for at most REFLECTION_POLL_MAX_MS (step 25).
export const REFLECTION_POLL_MS = 5_000;
export const REFLECTION_POLL_MAX_MS = 120_000;
// New Entry's handoff (2026-11-09; three seconds since 2026-11-10). The screen waits this long for the reflection before it
// hands it to Journal, where its card shows the progress: the server takes 10 to 30 seconds, and nobody is held on a screen
// for that. Its three step cards tick on real moments, and never before their place on the screen, so they are read in turn:
// "Saved" once the reflection is in the outbox (from NEW_ENTRY_STEP_SAVED_MS), "Sent" once the request has left (from
// NEW_ENTRY_STEP_SENT_MS), and "Preparing your devotional" is in progress when the screen leaves.
export const NEW_ENTRY_WAIT_MS = 3_000;
export const NEW_ENTRY_STEP_SAVED_MS = 400;
export const NEW_ENTRY_STEP_SENT_MS = 1_200;
// A finished reflection whose spoken devotional is still being made (2026-11-09): the server answers as soon as the text is
// saved and reads it aloud behind the answer, about fifteen seconds. For this long after the text was saved, a ready entry with
// no audio and no failure mark shows "Preparing your audio"; after it, the entry counts as having none.
export const AUDIO_PENDING_MS = 120_000;
// Realtime (step 33): a message about an entry, or about its affirmations, is acted on once this long has passed without another
// one about it, so a burst of writes (a reflection being made) is read once.
export const REALTIME_COALESCE_MS = 300;
// While the channel is live the session token is checked this often (step 33). Realtime's own refresh runs only at its heartbeat,
// every 25 s, and Clerk mints the next token 17 s before the old one expires, as a background fetch, and hands back the old one
// until 5 s are left when that fetch fails or is late; either way a token could expire on the channel and the server would close
// it (seen on the phone, twice). Each check reads Clerk's cached token (no network) and pushes it only when it changed.
export const REALTIME_TOKEN_CHECK_MS = 5_000;
// A cached token with this many seconds or fewer left means Clerk's own refresh has not landed, so the check asks Clerk's server
// for a new one itself, at least 10 s before the old one expires.
export const REALTIME_TOKEN_RENEW_S = 15;
// How long a call to an Edge Function may take. process-entry stops itself at about 145 seconds (the platform stops a function at
// 150, step 22), and the sync engine's own ceiling (200 seconds, step 24) is above this one.
export const PROCESS_ENTRY_TIMEOUT_MS = 155_000;
export const CONFIRM_SCRIPTURE_TIMEOUT_MS = 15_000;
// delete-entry (step 29b) makes a few Storage and database calls from a region far from the database: up to about 10 seconds. A
// request that times out may still have succeeded, and sending it again answers NOT_FOUND, which counts as deleted.
export const DELETE_ENTRY_TIMEOUT_MS = 30_000;
// add-affirmation (2026-11-09) makes one model call (two with a correction) and reads one verse from the Bible: about 5 to 15
// seconds, and the function stops itself at 40. The person waits on the button, so the call gives up a little after the function.
export const ADD_AFFIRMATION_TIMEOUT_MS = 45_000;
// sync-subscription (step 30) reads RevenueCat (two attempts of 8 seconds at most) and writes one row. The app waits for it after
// a purchase or a restore, so this caps how long "Welcome to Gracehush Pro" can take; a sync that times out changes nothing,
// and the webhook and the next foreground catch up.
export const SYNC_SUBSCRIPTION_TIMEOUT_MS = 10_000;
// export-data and delete-account (step 31) stop themselves at the platform's 150 seconds; the app waits a little longer, so it
// never gives up on an export or a deletion that is still running.
export const EXPORT_DATA_TIMEOUT_MS = 155_000;
export const DELETE_ACCOUNT_TIMEOUT_MS = 155_000;

// The one entitlement (AGENTS.md, Subscription Rules). The server's billing module has the same constant.
export const PRO_ENTITLEMENT_ID = "pro";

// A sheet whose choice opens another Modal (a dialog, another sheet) goes on from the sheet's onDismiss on iOS, which cannot present
// one Modal while another is still on its way out. If iOS never reports the dismissal, the choice goes on after this long.
export const MODAL_HANDOFF_FALLBACK_MS = 1_000;

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
} as const; // the store's own page; RevenueCat's managementURL, when it has one, wins (externalLinks.ts)
// Apple and Google both require the two policy pages to be reachable inside the app. They are the pages built from docs/ by
// docs/site/build.cjs and hosted at gracehush.com.
export const PRIVACY_POLICY_URL = "https://gracehush.com/privacy/";
export const TERMS_URL = "https://gracehush.com/terms/";
export const SUPPORT_EMAIL = "support@nouvrix.com";
// The web page where someone can ask for their account and its data to be deleted without the app (Google Play's Data safety
// form asks for it; step 31). It is not shown in the app.
export const ACCOUNT_DELETION_URL = "https://gracehush.com/delete-account/";

// Scholar (step 38). The day's limits are the server's and reach the app in each answer's `usage`: none is written here.
export const SCHOLAR_MAX_MESSAGE_LENGTH = 2_000; // the server's SCHOLAR_REQUEST.maxTextChars
export const SCHOLAR_MIN_SPOKEN_MS = 1_000; // a take under a second is discarded
export const SCHOLAR_MAX_SPOKEN_MS = 120_000; // a take stops at two minutes (the server takes up to 125 s)
export const SCHOLAR_SPOKEN_WARNING_MS = 105_000;
export const SCHOLAR_TURN_TIMEOUT_MS = 45_000; // above the server's 40 s for a typed message
export const SCHOLAR_SPOKEN_TURN_TIMEOUT_MS = 60_000; // above its 50 s for a spoken one
export const SCHOLAR_SPEAK_TIMEOUT_MS = 20_000;
export const SCHOLAR_RECENTS_LIMIT = 30; // conversations listed on the Scholar tab
export const SCHOLAR_MESSAGES_LIMIT = 200; // messages read when a conversation opens
export const SCHOLAR_PENDING_MS = 60_000; // an unanswered message younger than this is still being answered
export const SCHOLAR_PENDING_POLL_MS = 3_000;
export const SCHOLAR_LOW_REMAINING = 2; // a free account sees how many messages are left from this many
export const SCHOLAR_BREAK_NUDGE_TURNS = 20; // the break note, once a visit
// The AI reminder (2026-11-11, the public page and New York's companion law): at the start of a conversation, and again before a
// message sent this long after the last reminder.
export const SCHOLAR_AI_REMINDER_MS = 3 * 60 * 60 * 1000;
