import { Buffer } from "node:buffer";

import { AppError } from "../_shared/errors.ts";
import { GEMINI_AUDIO_MIME } from "./constants.ts";
import { OutputInvalid } from "./output.ts";

// The only file that knows Gemini's wire format. It uses the Interactions API, the one Google's docs now show for
// every current model (ai.google.dev/gemini-api/docs/structured-output and /interactions, read on 2026-10-22).
// generateContent is the older, still supported API; if the Interactions shape ever changes, this is the file to edit.

export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

// Four attempts at most for a call (the crisis screening's and the reflection's; a replacement passage makes one, see
// scripture.ts), and one overall deadline for all of them: the platform stops a function at 150 s, and step 22's speech
// needs room after these calls. A service that is busy, down or slow is tried again after a pause that doubles each time,
// about 2, 4 and 8 s with a little jitter, which is what Google's troubleshooting page asks for 429 and 5xx answers
// (ai.google.dev/gemini-api/docs/troubleshooting, read on 2026-10-23). A reply that fails output.ts comes from a service
// that works, so it is asked for once more, at once, and no further.
export const MAX_ATTEMPTS = 4;
export const MAX_INVALID_REPLIES = 2;
export const timing = { attemptTimeoutMs: 45_000, retryBackoffMs: 2_000, minAttemptMs: 8_000 };

// The pause before the retry that follows the `failures`th busy failure (1, 2, 3, ...): retryBackoffMs doubled each
// time, up to a quarter either way, so that requests that failed together do not all come back together. `random` is a
// number in [0, 1).
export function backoffMs(failures: number, random: number): number {
  return Math.round(timing.retryBackoffMs * 2 ** (failures - 1) * (0.75 + random * 0.5));
}

// The reply (thinking included) never needs more than this; it also caps what one runaway reply can cost.
const MAX_OUTPUT_TOKENS = 8_192;

export type GeminiInput =
  | { kind: "text"; text: string }
  | { kind: "audio"; bytes: Uint8Array; instruction: string };

export type GeminiUsage = { input: number; output: number; thought: number };

// `fallbackAttempts` counts the attempts that went to the fallback model (they are also counted in `attempts`).
export type GeminiStats = { attempts: number; fallbackAttempts: number; ms: number; usage: GeminiUsage };

export function newStats(): GeminiStats {
  return { attempts: 0, fallbackAttempts: 0, ms: 0, usage: { input: 0, output: 0, thought: 0 } };
}

// One entry of a request's safety_settings: a harm category and the threshold at which it blocks (ai.google.dev/
// gemini-api/docs/safety-settings, read on 2026-10-23). The API accepts exactly the five categories the crisis screening
// lists (screen.ts) and refuses any other value with HTTP 400 invalid_request.
export type SafetySetting = { type: string; threshold: string };

export function buildRequestBody(args: {
  model: string;
  thinkingLevel: string;
  system: string;
  input: GeminiInput;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  safetySettings?: SafetySetting[];
}): Record<string, unknown> {
  const { input } = args;
  return {
    model: args.model,
    system_instruction: args.system,
    input: input.kind === "text" ? input.text : [
      { type: "text", text: input.instruction },
      { type: "audio", data: Buffer.from(input.bytes).toString("base64"), mime_type: GEMINI_AUDIO_MIME },
    ],
    response_format: { type: "text", mime_type: "application/json", schema: args.schema },
    // Gemini 3 and later models take no temperature, top_p or top_k. Thinking is kept low: this is writing, not proof.
    generation_config: {
      thinking_level: args.thinkingLevel,
      max_output_tokens: args.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    },
    // Only a request that asks for it carries safety settings; the others keep Google's defaults.
    ...(args.safetySettings ? { safety_settings: args.safetySettings } : {}),
    // The default (true) keeps the request and the reply on Google's servers for up to 55 days. A private prayer is
    // not stored.
    store: false,
  };
}

type Failure = "blocked" | "transient" | "fatal";

// A safety filter refused the request or the reply. It is not an error to show anyone: the crisis screening and the
// generation stage both treat it as a possible crisis (a person in distress is exactly who trips these filters), and the
// passage lookup treats it as "no passage". `reason` is a log-safe category.
export class GeminiBlocked extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "GeminiBlocked";
    this.reason = reason;
  }
}

export class GeminiCallError extends Error {
  readonly failure: Failure;
  readonly reason: string;
  constructor(failure: Failure, reason: string) {
    super(reason);
    this.name = "GeminiCallError";
    this.failure = failure;
    this.reason = reason;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BLOCK_CODES = new Set(["safety", "jailbreak", "prohibited_content", "blocklist"]);

// The docs say a blocked request fails with HTTP 400 and an error code of safety, jailbreak, prohibited_content or
// blocklist (the last three with a message that starts "Input blocked:"). They do not show the body, so every place
// the error could sit is read. Google's error replies are sometimes wrapped in an array (seen on 2026-10-22: a bad key
// answers [{ "error": { "code", "message", "status", "details": [{ "reason": "API_KEY_INVALID", … }] } }]).
function errorObjects(json: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const root of Array.isArray(json) ? json : [json]) {
    if (!isRecord(root)) continue;
    if (isRecord(root.error)) found.push(root.error);
    if (Array.isArray(root.errors)) found.push(...root.errors.filter(isRecord));
  }
  return found;
}

// The words an error is described with: its code, status and reason, and the reasons in its details.
function errorWords(error: Record<string, unknown>): string[] {
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  return [error.code, error.status, error.reason, ...details.map((detail) => detail.reason)].filter(
    (value): value is string => typeof value === "string",
  );
}

export function isBlockedBody(json: unknown): boolean {
  return errorObjects(json).some((error) =>
    errorWords(error).some((word) => BLOCK_CODES.has(word.toLowerCase())) ||
    (typeof error.message === "string" && error.message.startsWith("Input blocked:"))
  );
}

// Google's own words (INVALID_ARGUMENT, NOT_FOUND, API_KEY_INVALID, ...) are safe to log. Its message is not: it can
// quote the input. The Interactions API names its errors in lowercase (service_unavailable, seen on 2026-10-23), so a
// word is kept when it is ALL_CAPS or snake_case, and never when it could be a sentence.
const PROVIDER_WORD = /^(?:[A-Z][A-Z_]{2,39}|[a-z][a-z_]{2,39})$/;

function providerWords(json: unknown): string {
  const words: string[] = [];
  for (const error of errorObjects(json)) {
    for (const word of errorWords(error)) {
      if (PROVIDER_WORD.test(word) && !words.includes(word)) words.push(word);
    }
  }
  return words.slice(0, 2).join("/");
}

function classifyHttp(status: number, json: unknown): GeminiCallError {
  if (isBlockedBody(json)) return new GeminiCallError("blocked", `gemini_blocked_${status}`);
  const detail = providerWords(json);
  const reason = `gemini_http_${status}${detail ? `:${detail}` : ""}`;
  const transient = status === 408 || status === 429 || status >= 500;
  return new GeminiCallError(transient ? "transient" : "fatal", reason);
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// The reply is a timeline of steps; the text is in the model_output step's content. (An older reply shape had an
// `outputs` list; it is read as a fallback.)
function findText(json: Record<string, unknown>): string {
  const collect = (content: unknown): string =>
    Array.isArray(content)
      ? content.filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
        .map((part) => (part as { text: string }).text).join("")
      : "";
  if (Array.isArray(json.steps)) {
    for (let index = json.steps.length - 1; index >= 0; index -= 1) {
      const step: unknown = json.steps[index];
      if (isRecord(step) && step.type === "model_output") {
        const text = collect(step.content);
        if (text) return text;
      }
    }
  }
  return Array.isArray(json.outputs) ? collect(json.outputs) : "";
}

export function parseInteraction(json: unknown): { text: string; usage: GeminiUsage } {
  if (!isRecord(json)) throw new GeminiCallError("transient", "gemini_shape");
  const status = typeof json.status === "string" ? json.status : "completed";
  if (status === "failed") {
    throw isBlockedBody(json)
      ? new GeminiCallError("blocked", "gemini_blocked_failed")
      : new GeminiCallError("transient", "gemini_failed");
  }
  if (status === "incomplete") throw new GeminiCallError("transient", "gemini_incomplete");
  if (status !== "completed") throw new GeminiCallError("fatal", "gemini_status");

  const text = findText(json);
  if (!text) throw new GeminiCallError("transient", "gemini_empty");
  const usage = isRecord(json.usage) ? json.usage : {};
  return {
    text,
    usage: {
      input: numberOrZero(usage.total_input_tokens),
      output: numberOrZero(usage.total_output_tokens),
      thought: numberOrZero(usage.total_thought_tokens),
    },
  };
}

async function callOnce(apiKey: string, body: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    let raw: string;
    try {
      response = await fetch(GEMINI_URL, {
        method: "POST",
        // The key goes in a header, never in the URL, so it cannot end up in a log.
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: controller.signal,
      });
      raw = await response.text();
    } catch {
      // Our own timeout, or a dropped connection: the log tells them apart.
      throw new GeminiCallError("transient", controller.signal.aborted ? "gemini_timeout" : "gemini_network");
    }
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // A non-JSON body is handled by the status below.
    }
    if (!response.ok) throw classifyHttp(response.status, json);
    return parseInteraction(json);
  } finally {
    clearTimeout(timer);
  }
}

export type GenerateArgs<T> = {
  apiKey: string;
  model: string;
  thinkingLevel: string;
  system: string;
  input: GeminiInput;
  schema: Record<string, unknown>;
  // Date.now() at which the last attempt must have ended.
  deadlineAt: number;
  // Turns the reply text into the value the caller wants, or throws OutputInvalid.
  validate: (text: string) => T;
  // Fewer than MAX_ATTEMPTS, for a small follow-up request that is not worth a second try.
  maxAttempts?: number;
  // A lower cap than the reflection's, for a request whose answer is a few numbers.
  maxOutputTokens?: number;
  // Replaces timing.attemptTimeoutMs for this call (the crisis screening ends its attempts sooner).
  attemptTimeoutMs?: number;
  safetySettings?: SafetySetting[];
  // GEMINI_FALLBACK_MODEL, when it is set: every second attempt goes to it. Under heavy demand one model answers 503s
  // while another answers (seen on the free tier on 2026-10-23), so a retry on a second model gets through more often.
  fallbackModel?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The input of a retry after a reply broke a tone rule (step 32): the same text with the note after a blank line, in a
// <correction> block the instruction says comes from the app. Always built from the original input, so a newer note
// replaces an older one instead of adding to it. A recording is never sent for the reflection, so audio is left as it is.
export function withCorrection(input: GeminiInput, note: string): GeminiInput {
  if (input.kind !== "text") return input;
  return { kind: "text", text: `${input.text}\n\n<correction>\n${note}\n</correction>` };
}

// Calls Gemini until `validate` accepts a reply, at most MAX_ATTEMPTS times (or `maxAttempts`) and never past
// `deadlineAt`. `stats` is filled in as it goes, so the log line has the attempt count and the tokens even when this
// throws; a second call with the same `stats` adds to the first one's counts. A request a safety filter blocks throws
// GeminiBlocked at once and is never retried, a request Google refuses (a 4xx that is not a block) is not retried, and
// every failure ends as AI_UNAVAILABLE with the reason of the last attempt.
//
// Step 32: a reply refused with a note (a tone rule it broke) makes the following attempts carry that note, and a reply
// refused with a salvage (its only fault was a word from the entry in its title or a headline) is kept. When no clean reply
// comes in the attempts and the time there are, the most recent salvage is the answer instead of AI_UNAVAILABLE. Only
// parseReflection sets a note or a salvage, so the crisis screening and a replacement passage behave as before.
export async function generate<T>(args: GenerateArgs<T>, stats: GeminiStats): Promise<T> {
  const fallbackModel = args.fallbackModel || null;
  let body = JSON.stringify(buildRequestBody(args));
  // Built only when an attempt needs it: a recording's body can be 16 MB.
  let fallbackBody: string | undefined;
  let input = args.input;
  let salvage: { value: T } | null = null;
  const started = Date.now();
  const maxAttempts = args.maxAttempts ?? MAX_ATTEMPTS;
  let last = new AppError("AI_UNAVAILABLE", "gemini_budget");
  let busyFailures = 0;
  let invalidReplies = 0;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const remaining = args.deadlineAt - Date.now();
      if (remaining < timing.minAttemptMs) break;
      const model = fallbackModel !== null && attempt % 2 === 0 ? fallbackModel : args.model;
      // A fallback that names the main model changes nothing, and is not counted.
      const onFallback = model !== args.model;
      stats.attempts += 1;
      if (onFallback) stats.fallbackAttempts += 1;

      let pause = 0;
      try {
        const result = await callOnce(
          args.apiKey,
          onFallback ? (fallbackBody ??= JSON.stringify(buildRequestBody({ ...args, input, model }))) : body,
          Math.min(args.attemptTimeoutMs ?? timing.attemptTimeoutMs, remaining),
        );
        stats.usage.input += result.usage.input;
        stats.usage.output += result.usage.output;
        stats.usage.thought += result.usage.thought;
        return args.validate(result.text);
      } catch (error) {
        if (error instanceof GeminiCallError) {
          if (error.failure === "blocked") throw new GeminiBlocked(error.reason);
          last = new AppError("AI_UNAVAILABLE", error.reason);
          if (error.failure === "fatal") break;
          busyFailures += 1;
          pause = backoffMs(busyFailures, Math.random());
        } else if (error instanceof OutputInvalid) {
          last = new AppError("AI_UNAVAILABLE", `output_invalid:${error.reason}`);
          // Only parseReflection's salvage reaches here, and it is the reflection T stands for.
          if (error.salvage !== undefined) salvage = { value: error.salvage as T };
          if (error.note && args.input.kind === "text") {
            input = withCorrection(args.input, error.note);
            body = JSON.stringify(buildRequestBody({ ...args, input }));
            fallbackBody = undefined;
          }
          invalidReplies += 1;
          if (invalidReplies >= MAX_INVALID_REPLIES) break;
        } else {
          throw error;
        }
      }
      if (attempt === maxAttempts) break;
      // A pause that would leave too little time for another attempt ends the call now, instead of waiting for nothing.
      if (args.deadlineAt - Date.now() - pause < timing.minAttemptMs) break;
      if (pause > 0) await sleep(pause);
    }
    if (salvage !== null) return salvage.value;
    throw last;
  } finally {
    stats.ms += Date.now() - started;
  }
}
