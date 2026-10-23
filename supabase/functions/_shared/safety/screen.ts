import { MAX_TRANSCRIPT_LENGTH } from "../../process-entry/constants.ts";
import { GeminiBlocked, type GeminiStats, generate, type SafetySetting } from "../../process-entry/gemini.ts";
import { OutputInvalid } from "../../process-entry/output.ts";
import { wrapEntry } from "../../process-entry/prompt.ts";
import { AppError } from "../errors.ts";
import type { CrisisSource } from "../log.ts";
import { matchCrisisPhrase } from "./phrases.ts";
import { SCREEN_AUDIO_TURN, SCREEN_SYSTEM_INSTRUCTION } from "./screenPrompt.ts";

// Crisis screening, layers 1 and 2 (step 21). It runs before anything is written for the person: no devotional, passage,
// speech or affirmation is made for an entry that was not screened, and anything unclear is a crisis.
//
//   written entry   the phrase backstop first (a match needs no model), then one model call that classifies it
//   spoken entry    one model call that transcribes the recording and classifies the words in the same reply
//
// The model call is the same Interactions API request as the reflection's (process-entry/gemini.ts knows the wire format),
// with its own system instruction, a small schema, the safety filters turned off so that it can read what a person in
// distress writes, and a shorter timeout.

export type ScreenInput = { kind: "text"; text: string } | { kind: "audio"; bytes: Uint8Array };

export type ScreenResult =
  // The words the rest of the request works from: the person's own text, or what was heard in the recording.
  | { status: "clear"; transcript: string }
  // `transcript` is null for a recording whose words were never read (the request was blocked).
  | { status: "crisis"; transcript: string | null; source: CrisisSource }
  | { status: "no_speech" }
  // No answer could be had (the service is down, slow, or answered in a shape that could not be used). Nothing is made.
  // `reason` is a log-safe category from the call (such as gemini_http_503), never the model's or Google's words.
  | { status: "failed"; reason: string };

export type ScreenConfig = {
  apiKey: string;
  // GEMINI_SCREENING_MODEL when it is set, otherwise GEMINI_MODEL: chosen by the caller, never named in code.
  model: string;
  // GEMINI_FALLBACK_MODEL when it is set: every second attempt goes to it (see gemini.ts). It screens entries too, so
  // it must pass the evaluation in eval/ like the screening model.
  fallbackModel?: string;
  thinkingLevel: string;
  // Date.now() at which the last attempt must have ended: the request's start plus screenTiming.deadlineMs.
  deadlineAt: number;
  stats: GeminiStats;
};

// One attempt ends after this long (the reflection's attempts get 45 s), and the screening as a whole ends this long
// after the request started, so that a reflection always has 30 s of the request's 90 s after it. A busy service is tried
// again within that time (gemini.ts): two to four attempts, depending on how quickly each one fails.
export const screenTiming = { attemptTimeoutMs: 20_000, deadlineMs: 60_000 };

// The five filters the API lets a request adjust, all off. A person in distress writes the very things the filters are
// built to stop, and a blocked screening would never get to classify them (a block still counts as a crisis, see below,
// but a model that can read the entry classifies it better). Checked against the real API on 2026-10-23: it accepted
// these five types with threshold "off" and refused every other value with HTTP 400 invalid_request. "Off" is also the
// documented default for Gemini 2.5 and later, so this states the choice instead of changing it.
export const SCREEN_SAFETY_SETTINGS: SafetySetting[] = [
  "harassment",
  "hate_speech",
  "sexually_explicit",
  "dangerous_content",
  "jailbreak",
].map((type) => ({ type, threshold: "off" }));

const RISKS = ["none", "uncertain", "crisis"] as const;
type Risk = (typeof RISKS)[number];

// What kinds of concern the model may name. They are only checked: they are never stored, logged or acted on.
const CATEGORIES = ["self_harm", "suicide", "harm_to_others", "abuse_or_danger_now", "medical_emergency"] as const;

// Property order is the order the model writes them in: a recording is transcribed before it is judged.
export function buildScreenSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      no_speech: { type: "boolean", description: "True when the audio has no intelligible speech. False for text." },
      transcript: { type: "string", description: "The exact words that were spoken. An empty string for text." },
      risk: { type: "string", enum: [...RISKS] },
      categories: {
        type: "array",
        maxItems: CATEGORIES.length,
        description: "The kinds of concern in the entry. Empty when risk is none.",
        items: { type: "string", enum: [...CATEGORIES] },
      },
    },
    required: ["no_speech", "transcript", "risk", "categories"],
  };
}

export type Verdict = { noSpeech: boolean; transcript: string; risk: Risk };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(reason: string): never {
  throw new OutputInvalid(reason);
}

// Checks the model's JSON again (the schema asks, this makes sure). A reply that cannot be used is OutputInvalid, which
// `generate` answers with one more attempt. For a recording that is judged "none", the speech must agree with itself:
// no speech means no words, and speech means words. A reply that flags a risk is accepted whatever else it says.
export function parseScreening(text: string, kind: "text" | "audio"): Verdict {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return invalid("json");
  }
  if (!isRecord(data)) return invalid("shape");
  const { no_speech, transcript, risk, categories } = data;
  if (typeof no_speech !== "boolean") return invalid("no_speech");
  if (typeof transcript !== "string") return invalid("transcript");
  const level = RISKS.find((item) => item === risk);
  if (!level) return invalid("risk");
  if (
    !Array.isArray(categories) || categories.length > CATEGORIES.length ||
    !categories.every((item) => (CATEGORIES as readonly unknown[]).includes(item))
  ) return invalid("categories");
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) return invalid("transcript_long");

  const words = transcript.trim();
  if (kind === "audio" && level === "none" && no_speech === (words !== "")) {
    return invalid(no_speech ? "no_speech_with_words" : "transcript_empty");
  }
  return { noSpeech: no_speech, transcript: words, risk: level };
}

export type Asked =
  | { kind: "verdict"; verdict: Verdict }
  | { kind: "blocked" }
  | { kind: "failed"; reason: string };

// One model call (four attempts at most, see gemini.ts). It does not look at the phrase list; screenEntry does, and so
// does the evaluation, which wants to see what the model alone says. A safety block is an answer, not an error.
export async function askModel(input: ScreenInput, config: ScreenConfig): Promise<Asked> {
  try {
    const verdict = await generate<Verdict>({
      apiKey: config.apiKey,
      model: config.model,
      fallbackModel: config.fallbackModel,
      thinkingLevel: config.thinkingLevel,
      system: SCREEN_SYSTEM_INSTRUCTION,
      input: input.kind === "text"
        ? { kind: "text", text: wrapEntry(input.text) }
        : { kind: "audio", bytes: input.bytes, instruction: SCREEN_AUDIO_TURN },
      schema: buildScreenSchema(),
      deadlineAt: config.deadlineAt,
      validate: (text) => parseScreening(text, input.kind),
      attemptTimeoutMs: screenTiming.attemptTimeoutMs,
      safetySettings: SCREEN_SAFETY_SETTINGS,
    }, config.stats);
    return { kind: "verdict", verdict };
  } catch (error) {
    if (error instanceof GeminiBlocked) return { kind: "blocked" };
    // Every other failure of the call (busy, down, slow, unusable twice) arrives as AI_UNAVAILABLE.
    if (error instanceof AppError) return { kind: "failed", reason: error.reason };
    throw error;
  }
}

// What an answer means. Uncertain and blocked are crises; a crisis outranks everything else the reply says, a
// contradicting no_speech included; and only a clear answer whose words match no phrase is clear.
export function interpret(input: ScreenInput, asked: Asked): ScreenResult {
  if (asked.kind === "failed") return { status: "failed", reason: asked.reason };
  // A written entry is its own transcript, whatever the model wrote in that field. A blocked recording was never read.
  const written = input.kind === "text" ? input.text : null;
  if (asked.kind === "blocked") return { status: "crisis", transcript: written, source: "blocked" };

  const { verdict } = asked;
  const words = written ?? (verdict.transcript === "" ? null : verdict.transcript);
  if (verdict.risk === "crisis") return { status: "crisis", transcript: words, source: "model" };
  if (verdict.risk === "uncertain") return { status: "crisis", transcript: words, source: "uncertain" };

  if (input.kind === "audio" && verdict.noSpeech) return { status: "no_speech" };
  // parseScreening guarantees words for a recording judged "none" that has speech, so this is only a safety net.
  if (words === null) return { status: "failed", reason: "no_words" };
  if (matchCrisisPhrase(words)) return { status: "crisis", transcript: words, source: "phrase" };
  return { status: "clear", transcript: words };
}

export async function screenEntry(input: ScreenInput, config: ScreenConfig): Promise<ScreenResult> {
  // The backstop comes first for a written entry: a match is decided without the model, so it cannot be argued out of it
  // and it works while the model is down.
  if (input.kind === "text" && matchCrisisPhrase(input.text)) {
    return { status: "crisis", transcript: input.text, source: "phrase" };
  }
  return interpret(input, await askModel(input, config));
}
