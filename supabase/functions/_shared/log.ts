// One JSON line per request.
//
// Allowed: the request id, a short hash of the user id, the status, an error code or category, the input kind,
// durations, attempt and token counts, the model name, what became of the passage as one word (step 20), and what the
// crisis screening answered as one word, with the stage that decided (step 21). Never: a token or its claims, an email, a
// transcript, entry text, audio, model output, scripture (not even which book or chapter), the categories of concern the
// screening named, a phrase that matched, SQL, or a provider's error message (those can quote what the user wrote).

// What became of the passage: verified on the first try, replaced by a second choice that was verified, kept without its
// text because the Bible text could not be read, or dropped because no valid passage was found. null: no passage was
// looked up (the request failed first, or it was a crisis entry).
export type ScriptureOutcome = "verified" | "replaced" | "unverified" | "dropped";

// What the crisis screening answered (step 21). null in the log: screening did not run (a refused request, or a retry
// of an entry that was already finished).
export type ScreenStatus = "clear" | "crisis" | "no_speech" | "failed";

// Why an entry became a crisis entry: a phrase of the backstop list, the screening model saying so, the screening model
// being unsure (which counts as a crisis), or a safety filter blocking the request. The generation stage uses the same
// words when it is the one that catches a crisis the screening called clear.
export type CrisisSource = "phrase" | "model" | "uncertain" | "blocked";

export type LogLine = {
  requestId: string;
  status: number;
  code: string | null;
  reason: string | null;
  inputType: "text" | "audio" | null;
  user: string | null;
  authMs: number;
  dbMs: number;
  geminiMs: number;
  totalMs: number;
  attempts: number;
  // How many of `attempts` went to GEMINI_FALLBACK_MODEL (0 when it is not set, or when the first attempts answered).
  fallbackAttempts: number;
  model: string | null;
  promptVersion: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensThought: number | null;
  scripture: ScriptureOutcome | null;
  // Time spent reading the Bible text (the API calls of one request, or none when the chapter was already known).
  bibleMs: number;
  // The screening stage: its answer, how long it took and how many model attempts it made (they are also counted in
  // `attempts`). `crisisSource` is set whenever the entry ended as a crisis, whichever stage decided: with `screen`
  // "clear" it was the generation stage that caught it.
  screen: ScreenStatus | null;
  screenMs: number;
  screenAttempts: number;
  crisisSource: CrisisSource | null;
};

// The first 8 hex characters of SHA-256(value): enough to follow one user through the logs, not to find them.
export async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function writeLog(line: LogLine): void {
  console.log(JSON.stringify(line));
}
