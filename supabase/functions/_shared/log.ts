// One JSON line per request.
//
// Allowed: the request id, a short hash of the user id, the status, an error code or category, the input kind,
// durations, attempt and token counts, the model name, and (step 20) what became of the passage as one word. Never: a
// token or its claims, an email, a transcript, entry text, audio, model output, scripture (not even which book or
// chapter), SQL, or a provider's error message (those can quote what the user wrote).

// What became of the passage: verified on the first try, replaced by a second choice that was verified, kept without its
// text because the Bible text could not be read, or dropped because no valid passage was found. null: no passage was
// looked up (the request failed first, or it was a crisis entry).
export type ScriptureOutcome = "verified" | "replaced" | "unverified" | "dropped";

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
  model: string | null;
  promptVersion: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensThought: number | null;
  scripture: ScriptureOutcome | null;
  // Time spent reading the Bible text (the API calls of one request, or none when the chapter was already known).
  bibleMs: number;
};

// The first 8 hex characters of SHA-256(value): enough to follow one user through the logs, not to find them.
export async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function writeLog(line: LogLine): void {
  console.log(JSON.stringify(line));
}
