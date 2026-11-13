// Scholar (step 38): every limit, size and time budget of the conversation engine, in one place. The app holds no limit
// number: each answer carries the numbers in its `usage`, so a limit changes with a function deploy.

// Free accounts may send this many messages a day, to read. Pro and trial accounts this many, and have this many answers read
// aloud. Everyone: at most rateMax messages in rateWindowMs. The day is the calendar day of the profile's time zone. A heavy
// conversation is exempt from every count and limit but the rate.
export const SCHOLAR_LIMITS = {
  freeMessagesPerDay: 5,
  proMessagesPerDay: 40,
  proListensPerDay: 5,
  rateMax: 30,
  rateWindowMs: 600_000,
} as const;

// The project-wide ceiling on free messages a UTC day (SCHOLAR_FREE_DAILY_BUDGET when it is set). Above it a free account's
// clear message gets the resting line; paying accounts and heavy conversations are never affected.
export const DEFAULT_FREE_DAILY_BUDGET = 3_000;

// A request: its body, a typed message and a spoken one. A recording is never in a body: it is read from storage.
export const SCHOLAR_REQUEST = {
  maxBodyBytes: 8 * 1024,
  maxTextChars: 2_000,
  minSpokenMs: 1_000,
  maxSpokenMs: 125_000,
} as const;

// What the writer sees: the last ready messages of the conversation, each cut, and, for a conversation opened from a
// reflection, the person's words, the title, the feeling, the passage, the devotional and the closing prayer.
export const WRITER_CONTEXT = {
  messages: 20,
  messageChars: 1_200,
  reflectionWordsChars: 1_500,
  devotionalChars: 1_600,
} as const;

// What the screening sees besides the new message: the messages before it, each cut.
export const SCREEN_CONTEXT = { messages: 6, messageChars: 600 } as const;

// An answer's length: asked for (ask) and accepted (min, max). Nothing is ever cut: a reply outside what is accepted is asked for
// again. The output cap covers the thinking too.
export const ANSWER_WORDS = { askMin: 40, askMax: 140, min: 8, max: 260 } as const;
// A heavy answer (scholar-v2, the readers): 50 to 110 words asked, 40 to 120 kept without a second try. A reply outside it is asked
// for once more with a note, and kept when no better one comes (a soft check: length never costs a person their answer).
export const HEAVY_ANSWER_WORDS = { askMin: 50, askMax: 110, min: 40, max: 120 } as const;
// A run of this many words a heavy answer shares with an earlier answer of the conversation is the script run again (a soft check).
export const REPEAT_RUN = 6;
// How long the heavy model thinks. scholar-v2 first gave it "medium" (2026-11-11), and the evaluation measured the cost: 7 of 26
// hard moments ran past the 20-second attempt budget into the written answer, and the median wait was 17.4 s. A person in a hard
// moment should get an answer written for them in seconds, so it is "low", Part One's level; one line to change back.
export const HEAVY_THINKING_LEVEL = "low";
// What the judge sees of each text (judge.ts).
export const JUDGE_CONTEXT = { chars: 1_200 } as const;
export const ANSWER_MAX_OUTPUT_TOKENS = 4_096;
export const PRAYER_WORDS = { askMin: 50, askMax: 75, min: 20, max: 100 } as const;
export const TITLE_LIMITS = { minWords: 2, maxWords: 6, maxChars: 60 } as const;

// At most two passages an answer (the one asked about and one that helps), each a verified card of at most six verses in one
// chapter and 1,200 characters (the Bible code's own limits, _shared/bible).
export const PASSAGE_LIMITS = { max: 2 } as const;

// A run of this many words shared with a passage's text is a verse the model typed (passages.ts), which is never kept.
export const TYPED_VERSE_RUN = 6;
// How many references named in a reply (and not shown as a card) are read to check for a typed verse.
export const TYPED_VERSE_LOOKUPS = 3;

// The parts an answer is read aloud in (scholar-speak): the first short, so the voice starts soon.
export const SPEECH_PART_CHARS = { first: 160, rest: 280 } as const;

// A message claimed this long ago without an answer belongs to a request that died, and may be claimed again.
export const SCHOLAR_CLAIM_LEASE_MS = 60_000;

// A person's chat- recordings older than this are removed whenever one of theirs is transcribed (a take that was uploaded and
// never sent).
export const STRAY_RECORDING_MS = 60 * 60_000;

// The time budgets, in milliseconds: one attempt of a call, and the call in all. Each call also ends by what is left of the
// request's own budget for model work (`requestTyped`, `requestSpoken`), whichever comes first. The Gemini transport starts
// another attempt only while 8 seconds are left (gemini.ts timing.minAttemptMs), so the screening's numbers leave room for a
// second attempt after a first one that timed out. An object, so that a test can shorten it.
export const scholarTiming = {
  screenTyped: { attemptMs: 6_000, totalMs: 17_000 },
  screenSpoken: { attemptMs: 15_000, totalMs: 27_000 },
  answer: { attemptMs: 15_000, totalMs: 20_000 },
  heavy: { attemptMs: 20_000, totalMs: 32_000 },
  // The judge of a heavy answer (judge.ts): one short attempt on the screening model. Its whole budget is more than the 8 s the
  // transport needs left to start an attempt at all, or the judge would never be asked.
  judge: { attemptMs: 5_000, totalMs: 9_000 },
  speechPart: { attemptMs: 10_000, totalMs: 10_000 },
  requestTyped: 40_000,
  requestSpoken: 50_000,
  // A typed verse found in a heavy answer is asked for once more only when at least this much of its budget is left.
  heavyRetryMinMs: 12_000,
};
