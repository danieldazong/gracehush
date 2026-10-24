import { Buffer } from "node:buffer";

import type { TtsConfig } from "./config.ts";
import { forgetAccessToken, getAccessToken, GoogleAuthError } from "./googleAuth.ts";
import { looksLikeWav } from "./wavDuration.ts";

// One call to Cloud Text-to-Speech: the script in, a WAV out (step 22; LINEAR16 since 2026-10-24).
//
//   POST https://texttospeech.googleapis.com/v1/text:synthesize   (docs.cloud.google.com/text-to-speech, read on 2026-10-23)
//   { input: { markup }, voice: { languageCode, name }, audioConfig: { audioEncoding: "LINEAR16", speakingRate } }
//   -> { audioContent: <the WAV, base64> }
//
// `markup` is the Chirp 3 HD field that understands [pause] tags. audioEncoding LINEAR16 is the lossless WAV: the MP3 these
// voices write is fixed at 32 kbps (a 64 kbps MP3 is refused for them, and Opus plays on no iPhone), and at 32 kbps the voice
// was heard as faintly robotic, so the WAV was chosen on 2026-10-24 (about 48 KB a second of speech). speakingRate runs from
// 0.25 to 2.0; pitch and effect profiles are not sent, because the Chirp 3 HD page lists neither. The request is signed in as
// a service account (googleAuth.ts), not with an API key.
//
// Nothing here throws for a failed call: the caller keeps the reflection either way, so the answer says what happened.
// The reasons are log-safe: Google's short status words (PERMISSION_DENIED, SERVICE_DISABLED...), never its message.

export const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

// One attempt ends after attemptTimeoutMs; a busy answer is tried once more after retryPauseMs; and no attempt starts with
// less than minAttemptMs left before the caller's deadline.
export const ttsTiming = { attemptTimeoutMs: 30_000, retryPauseMs: 1_000, minAttemptMs: 8_000 };

const MAX_ATTEMPTS = 2;
// Anything smaller is not speech. (A real devotional is several megabytes.)
const MIN_AUDIO_BYTES = 1_024;

// "TRANSIENT": busy, slow or down: try again later. "INVALID": Google refused the request itself or the account (a wrong
// voice, the API not enabled, billing off): trying again will not help. "AUTH": the sign-in failed.
export type SynthesizeResult =
  | { ok: true; audio: Uint8Array; attempts: number }
  | { ok: false; kind: "TRANSIENT" | "INVALID" | "AUTH"; reason: string; attempts: number };

type Failure = Extract<SynthesizeResult, { ok: false }>;
type Once = { ok: true; audio: Uint8Array } | { ok: false; status: number; kind: Failure["kind"]; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Google's own words for an error: its status ("PERMISSION_DENIED") and the reasons in its details ("SERVICE_DISABLED",
// "BILLING_DISABLED"), when they are ALL_CAPS words. Its message is never kept: it can name a project.
function googleWords(json: unknown): string {
  const error = isRecord(json) && isRecord(json.error) ? json.error : null;
  if (error === null) return "";
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  const words = [error.status, ...details.map((detail) => detail.reason)].filter(
    (word): word is string => typeof word === "string" && /^[A-Z][A-Z0-9_]{2,40}$/.test(word),
  );
  return [...new Set(words)].slice(0, 2).join("/");
}

async function callOnce(token: string, body: string, timeoutMs: number): Promise<Once> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    let raw: string;
    try {
      response = await fetch(SYNTHESIZE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body,
        signal: controller.signal,
      });
      raw = await response.text();
    } catch {
      return {
        ok: false,
        status: 0,
        kind: "TRANSIENT",
        reason: controller.signal.aborted ? "tts_timeout" : "tts_network",
      };
    }
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // A body that is not JSON is judged by its status.
    }
    if (!response.ok) {
      const words = googleWords(json);
      const reason = `tts_http_${response.status}${words ? `:${words}` : ""}`;
      const busy = response.status === 408 || response.status === 429 || response.status >= 500;
      const kind = response.status === 401 ? "AUTH" : busy ? "TRANSIENT" : "INVALID";
      return { ok: false, status: response.status, kind, reason };
    }
    if (!isRecord(json) || typeof json.audioContent !== "string") {
      return { ok: false, status: response.status, kind: "TRANSIENT", reason: "tts_shape" };
    }
    const audio = new Uint8Array(Buffer.from(json.audioContent, "base64"));
    if (audio.length < MIN_AUDIO_BYTES) {
      return { ok: false, status: response.status, kind: "INVALID", reason: "tts_empty" };
    }
    if (!looksLikeWav(audio)) return { ok: false, status: response.status, kind: "INVALID", reason: "tts_not_wav" };
    return { ok: true, audio };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `markup` is the script (script.ts); `deadlineAt` is the Date.now() by which the last attempt must have ended.
export async function synthesize(markup: string, config: TtsConfig, deadlineAt: number): Promise<SynthesizeResult> {
  const body = JSON.stringify({
    input: { markup },
    voice: { languageCode: config.languageCode, name: config.voiceName },
    audioConfig: { audioEncoding: "LINEAR16", speakingRate: config.speakingRate },
  });
  let attempts = 0;
  let last: { kind: Failure["kind"]; reason: string } = { kind: "TRANSIENT", reason: "tts_budget" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remaining = deadlineAt - Date.now();
    if (remaining < ttsTiming.minAttemptMs) break;
    attempts += 1;

    let token: string;
    try {
      token = await getAccessToken(config.account);
    } catch (error) {
      if (!(error instanceof GoogleAuthError)) throw error;
      last = { kind: error.kind === "invalid" ? "AUTH" : "TRANSIENT", reason: error.reason };
      if (error.kind === "invalid") break;
      if (attempt < MAX_ATTEMPTS) await sleep(ttsTiming.retryPauseMs);
      continue;
    }

    const outcome = await callOnce(token, body, Math.min(ttsTiming.attemptTimeoutMs, deadlineAt - Date.now()));
    if (outcome.ok) return { ok: true, audio: outcome.audio, attempts };
    last = { kind: outcome.kind, reason: outcome.reason };
    if (outcome.status === 401) {
      // A cached token that Google no longer accepts: sign in again and ask again at once.
      forgetAccessToken(config.account);
      continue;
    }
    if (outcome.kind !== "TRANSIENT") break;
    if (attempt < MAX_ATTEMPTS) await sleep(ttsTiming.retryPauseMs);
  }
  return { ok: false, kind: last.kind, reason: last.reason, attempts };
}
