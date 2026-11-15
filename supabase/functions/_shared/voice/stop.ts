// A whole spoken turn that is only a stop word (step 39, decision 37). Speaking over Scholar already stops its voice; when the
// words that come with it are only "stop" or "wait", Scholar answers the stop line (lines.ts) with no model call and nothing
// is saved. The phrase list still reads the words first (scholar-voice-llm), and anything more than a stop word is an ordinary
// turn.

export const STOP_WORDS: readonly string[] = [
  "stop",
  "wait",
  "hold on",
  "pause",
  "one moment",
  "one second",
  "just a moment",
  "be quiet",
];

// What ElevenLabs' speech-to-text writes for a stop word that was said: on the owner's iPhone on 2026-11-14 a spoken "Wait."
// came out as "Weight." three times of three. A whole turn of one of these is never a question, so it counts as the stop word.
// The agents also listen harder for the stop words (agent_setup.ts, ASR_KEYWORDS).
export const STOP_HEARD_AS: readonly string[] = ["weight", "weigh"];

// Words a person puts around a stop word, which do not make it more than one.
export const STOP_AROUND = new Set(["okay", "ok", "please", "scholar"]);

// The turn in lowercase with no punctuation: letters, digits and single spaces.
function plain(words: string): string[] {
  return words.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((word) => word !== "");
}

export function isStopOnly(words: string): boolean {
  const tokens = plain(words);
  while (tokens.length > 0 && STOP_AROUND.has(tokens[0])) tokens.shift();
  while (tokens.length > 0 && STOP_AROUND.has(tokens[tokens.length - 1])) tokens.pop();
  const heard = tokens.join(" ");
  return STOP_WORDS.includes(heard) || STOP_HEARD_AS.includes(heard);
}
