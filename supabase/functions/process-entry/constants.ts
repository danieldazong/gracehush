import { USFM_BOOK_IDS, type UsfmBookId } from "../_shared/bible/books.ts";
import type { AudioMimeType, EmotionKey, PrayerCategory, TimeSlot } from "./contracts.ts";

// The text and recording limits mirror src/constants/app.ts (MAX_TEXT_LENGTH, MIN_TEXT_LENGTH, MIN_RECORDING_MS,
// MAX_RECORDING_MS). Keep them in sync.
export const MAX_TEXT_LENGTH = 5_000;
export const MIN_TEXT_LENGTH = 10;
export const MIN_RECORDING_MS = 3_000;
export const MAX_RECORDING_MS = 300_000;
export const RECORDING_GRACE_MS = 2_000;

export const MAX_BODY_BYTES = 64 * 1024;

// Gemini takes 20 MB for the whole request, and base64 makes a file a third bigger: 15 MiB of audio is exactly 20 MiB
// of base64 before the prompt is added. 12 MiB leaves room. Five minutes of AAC is well under 6 MiB.
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const MAX_TRANSCRIPT_LENGTH = 20_000;

// The most entries one user may start in the window below. Counted from journal_entries, so it survives restarts.
export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 10 * 60_000;

// The model calls of one request must end this long after the request started. The platform stops a function at 150 s
// (free plan), and step 22's speech needs about 40 s of that.
export const GEMINI_DEADLINE_MS = 90_000;

// The rest of the time budget of one request, all counted from its start (step 22). It is an object so that a test can
// shorten it, like `timing` in gemini.ts and `screenTiming` in the screening.
//
//   the crisis screening, all its attempts   60 s    screenTiming.deadlineMs (_shared/safety/screen.ts)
//   the reflection and a second passage      90 s    GEMINI_DEADLINE_MS, above
//   speech may START                         in the first 100 s: later than that it is skipped, and sending the same request
//                                            again adds the audio
//   speech's calls all end                   by 135 s: 30 s a call, one retry after 1 s, none starts with under 8 s left
//                                            (ttsTiming in _shared/tts/synthesize.ts)
//   the upload                               20 s, and never later than 5 s after the 135 s (speech.ts)
//   the platform                             150 s of wall clock on the free plan, 2 s of CPU (waiting is free), 256 MB
//
// So even when every step is slow the answer is sent at about 145 s. A request that the platform does stop still leaves a
// good "ready" entry, and the same request sent again adds the audio.
export const speechTiming = { latestStartMs: 100_000, deadlineMs: 135_000, uploadTimeoutMs: 20_000 };

// The expiry guard (step 30): one look at RevenueCat, cut short, so a lapsed plan costs a reflection at most this long.
export const EXPIRY_CHECK = { attempts: 1, timeoutMs: 6_000 };

// A row that has been "processing" for longer than this belongs to a request that died, and may be claimed again.
// Longer than the platform's 150 s wall clock, so a request that is still running is never taken over.
export const CLAIM_LEASE_MS = 3 * 60_000;

export const AUDIO_MIME_TYPES = [
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
] as const satisfies readonly AudioMimeType[];

// Gemini's audio page lists audio/m4a for M4A and not audio/mp4 or audio/x-m4a, so that is what is always sent.
export const GEMINI_AUDIO_MIME = "audio/m4a";

export const EMOTIONS = [
  "anxious",
  "weary",
  "grateful",
  "grieving",
  "hopeful",
] as const satisfies readonly EmotionKey[];

export const PRAYER_CATEGORIES = [
  "FAMILY & HEALING",
  "VOCATION & CALLING",
  "INNER PEACE",
  "RELATIONSHIPS",
  "PROVISION",
  "GUIDANCE",
] as const satisfies readonly PrayerCategory[];

export const TIME_SLOTS = ["morning", "afternoon", "evening"] as const satisfies readonly TimeSlot[];

// What the model is allowed to write. Out of range counts as invalid (nothing is truncated). These are the hard bounds that
// stop a runaway reply; the targets the instruction asks for are tighter (step 32: a devotional of 110 to 150 words, a title of
// at most 40 characters), and the tone evaluation measures how close the model comes. A headline is a notification's whole
// body (step 28), so its 50 characters are a hard limit.
export const LIMITS = {
  title: { maxChars: 60 },
  devotional: { minWords: 80, maxWords: 220 },
  closingPrayer: { minWords: 10, maxWords: 100 },
  affirmationHeadline: { maxWords: 8, maxChars: 50 },
  affirmationText: { maxWords: 30, maxChars: 300 },
  prayerTitle: { maxChars: 60 },
  prayerSummary: { maxChars: 120 },
} as const;

// The largest chapter and verse numbers in the Bible (Psalm 150, Psalm 119:176). The model's passage is checked against
// the real book table by the Bible code (_shared/bible); these only keep an absurd number out of the log and the prompt.
export const SCRIPTURE_NUMBER_LIMITS = { chapter: 150, verse: 176 } as const;

// The books the model may choose from, for a reflection and for a replacement passage: every book but the Song of Solomon
// (step 32). Its verses carry speaker labels inside the text ("The Bride", "The Bridegroom": step 20's sweep), which the card
// would show as scripture, and a love poem rarely fits a prayer journal. The book table and the code that reads a stored
// reference keep all 66.
export const REFLECTION_BOOK_IDS: readonly UsfmBookId[] = USFM_BOOK_IDS.filter((id) => id !== "SNG");
