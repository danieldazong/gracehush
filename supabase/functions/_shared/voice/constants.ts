// Live talk (step 39): every limit, size and time of a talk, in one place. The app holds no limit number: scholar-voice-start and
// scholar-voice-end send the numbers a person sees, so a limit changes with a function deploy.

// Trial and Pro: monthSeconds of talk a calendar month (the profile's time zone) and at most talkSeconds a talk; less than
// minTalkSeconds left counts as used up. A talk has its own limits in place of the day's messages: maxTurns a talk and
// startsPerDay talks a day. A heavy conversation's talk is never counted and never cut, up to two backstops that stand in front
// of cost for everyone: ElevenLabs ends any talk at backstopSeconds (the agent's own limit), and one account can start heavy talks
// for at most heavySecondsPerDay in a day.
export const VOICE_LIMITS = {
  monthSeconds: 1_800,
  talkSeconds: 600,
  minTalkSeconds: 30,
  backstopSeconds: 1_800,
  maxTurns: 80,
  startsPerDay: 20,
  heavySecondsPerDay: 7_200,
} as const;

// The most a session's row may say a talk lasted: the table's own ceiling (scholar_voice_sessions_seconds_range), which leaves
// room after ElevenLabs' backstopSeconds.
export const VOICE_SESSION_MAX_SECONDS = 1_900;

// What scholar-voice-start and scholar-voice-end read of a request.
export const VOICE_START = { maxBodyBytes: 2_048 } as const;

// What scholar-voice-llm reads of a request, and what a turn may hold.
export const VOICE_REQUEST = {
  maxBodyBytes: 256 * 1024,
  // A turn's words are cut at this many characters (a typed message's own limit).
  maxWordsChars: 2_000,
} as const;

// The times of a turn, in milliseconds from the moment ElevenLabs asked. ElevenLabs gives an attempt up when no new piece of
// text has arrived for 15 seconds, counted from the request's start and from every piece (the agents' cascade_timeout_seconds;
// measured, 2026-11-12 and 2026-11-13), so our server speaks a holding line while an answer is written, and no two moments of a
// turn are 15 seconds apart: an everyday turn's are at 0, 7 and 13 seconds, a hard moment's at 0, 5, 13 and at most 23.5
// (constants_test.ts holds them to that). An object, so that a test can shorten it.
//   holdMs         an everyday turn with no answer yet: the holding line.
//   heavyHoldMs    a heavy conversation with no answer yet: its holding line, which comes sooner (silence weighs more there, and
//                  a hard-moment answer takes longer to write).
//   secondHoldMs   a heavy conversation only: the second holding line.
//   answer         an everyday answer: how long one attempt of the writer may take, and the moment by which the turn has ended,
//                  with an answer or with the not-ready line.
//   heavyTotalMs   a hard-moment answer: after this the person hears the written answer and the help line. Measured on
//                  2026-11-13: with a holding line at 5 and at 13 seconds, an answer sent at 22 seconds was spoken at 22.6, and
//                  one sent 14 seconds after the last line was still spoken; 17 seconds after it, ElevenLabs had asked again.
//   settleMs       what each of those two moments keeps for the passage and the save: the writer of an everyday answer has
//                  ended by totalMs - settleMs, that of a hard-moment answer by heavyTotalMs - settleMs. It is also how long
//                  past heavyTotalMs the stream waits for the engine's written answer before it says its own.
//   joinPollMs     a request for a turn that is already being answered looks for the answer this often.
//
// Measured on 2026-11-13 (20 made-up everyday questions as spoken turns, the everyday model at thinking low, one attempt each):
// the writer took a median of 4.3 s, 5.1 s at the ninetieth percentile and 5.6 s at most, and a spoken answer reaches ElevenLabs
// about a second after that (the screening runs beside it, then the passage and the save). So the everyday holding line waits
// 7 seconds: at the plan's 5 it would have been spoken before about half of all answers. And one attempt may take the whole 13
// seconds: the transport starts another attempt only while 8 seconds are left (gemini.ts, timing.minAttemptMs), so an attempt cut
// at the plan's 5 seconds could never be followed by a second one, and 2 of the 20 answers would have been thrown away for the
// not-ready line.
export const voiceTiming = {
  holdMs: 7_000,
  heavyHoldMs: 5_000,
  secondHoldMs: 13_000,
  answer: { attemptMs: 13_000, totalMs: 13_000 },
  heavyTotalMs: 22_000,
  settleMs: 1_500,
  joinPollMs: 300,
};

// How hard the everyday writer of a live talk thinks (scholar-turn/turn.ts; a typed message's writer, the screening and every
// hard-moment answer keep theirs). Measured on 2026-11-14 (made-up questions as spoken turns, SCHOLAR_MODEL gemini-3.1-flash-lite):
// at "low" it spent 107 to 1,347 thinking tokens and took a median of 3.0 s (5.0 s at most) to write a spoken answer; at
// "minimal" it spent none and took 1.2 to 1.5 s, which is about the screening's own time (1.0 to 1.4 s), so the answer is ready
// about when the screening clears it. The owner heard 3 to 4 seconds before an answer as slow. An attempt on the fallback model
// keeps the request's own level (gemini.ts fallbackThinkingLevel): gemini-3.8-flash refuses "minimal" with HTTP 400. SCHOLAR_MODEL
// must accept "minimal"; a model that does not fails every talk's everyday turn on its first attempt (the spoken evaluation
// shows it).
export const VOICE_WRITER_THINKING = "minimal";

// A turn that asks Scholar to pray, or for a prayer, keeps the writer's own level (GEMINI_THINKING_LEVEL, "low"): at "minimal" the
// writer asked "would you like me to pray?" instead of praying, or folded the prayer into the reply, in about one prayer request
// of three (the spoken evaluation, 2026-11-14), while at "low" every prayer met the need (5.00). A prayer is a moment where a few
// seconds of quiet is natural. Only a request: a turn that is about prayer ("How do I pray when I feel far from God?") is
// answered at the talk's own level. The first rule, any word starting "pray", sent that question to "low", where it took 3.2 s
// once and 8.1 s (2,683 thinking tokens) another time (the walk-through, 2026-11-14). Every prayer request of the evaluation sets
// (three everyday, one hard moment) matches, and no other case does.
export const VOICE_PRAYER_WORDS =
  /\b(?:pray(?:ing)?\s+(?:for|with|over)\s+(?:me|us|him|her|them|my|our)\b|(?:can|could|would|will)\s+you\s+pray\b|(?:can|could|shall|should)\s+we\s+pray\b|let[’']?s\s+pray\b|let\s+us\s+pray\b|help\s+me\s+pray\b|a\s+prayer\b)/i;

// A signed session is accepted this long: ElevenLabs' own limit for a talk (backstopSeconds) and two minutes of room.
export const VOICE_SESSION_TTL_MS = 32 * 60_000;

// The one-time token ElevenLabs gives for a talk.
export const VOICE_TOKEN_TIMEOUT_MS = 8_000;

// Deleting finished talks at ElevenLabs (sweep.ts): how many a run, and how long one may take (a delete answered in 1 to 8 seconds
// when it was measured, 2026-11-13).
export const VOICE_SWEEP = { maxDeletes: 30, requestTimeoutMs: 15_000 } as const;

// After the end of a talk the sweep runs again at these moments (from the end's answer) while one of our agents still lists a
// talk ElevenLabs is working on: four runs at most. The phone ends a talk the moment End is pressed, and the walk-through of
// 2026-11-14 saw the first run find that talk still being closed and leave it, with its words, for the next talk. Tests shorten it.
export const endSweepTiming: { retryAtMs: number[] } = { retryAtMs: [10_000, 20_000, 30_000] };
