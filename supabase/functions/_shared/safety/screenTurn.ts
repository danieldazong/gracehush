import type { HelpKind } from "../../process-entry/contracts.ts";
import { GeminiBlocked, type GeminiStats, generate } from "../../process-entry/gemini.ts";
import { AppError } from "../errors.ts";
import { scholarTiming, SCREEN_CONTEXT } from "../scholar/constants.ts";
import {
  type Asked,
  buildScreenSchema,
  interpret,
  parseScreening,
  phraseVerdict,
  SCREEN_SAFETY_SETTINGS,
  type ScreenInput,
  type ScreenResult,
  type Verdict,
} from "./screen.ts";
import { SCREEN_CHAT_AUDIO_TURN, SCREEN_CHAT_SYSTEM_INSTRUCTION } from "./screenChatPrompt.ts";

// The screening of one Scholar message (step 38), layers 1 and 2 of the three: the phrase list, then one model call that reads
// the new message with the messages before it (screenChatPrompt.ts). It runs before any of the answer is shown, spoken or saved, and
// it answers exactly what the reflection's screening answers (screen.ts ScreenResult), so the rules are the same: uncertain and a
// safety block are heavy, a heavy answer outranks a contradicting no_speech, and no answer at all is "failed".
//
// It makes its own model call (screen.ts askModel builds the reflection's request) and reuses everything else of screen.ts: the schema,
// the reading of the reply, the five safety filters turned off and what an answer means.

// One earlier message of the conversation, as the screening sees it: who said it, and its words.
export type ChatContextMessage = { role: "user" | "scholar"; text: string };

export type ChatScreenConfig = {
  apiKey: string;
  // SCHOLAR_SCREENING_MODEL: chosen by the caller, never named in code.
  model: string;
  // SCHOLAR_HEAVY_MODEL: the second attempt goes to it (gemini.ts sends every second attempt to the fallback).
  fallbackModel?: string;
  thinkingLevel: string;
  // Date.now() by which all model work of the request must have ended. The screening ends sooner when its own budget
  // (scholarTiming.screenTyped or screenSpoken) runs out first.
  deadlineAt: number;
  stats: GeminiStats;
};

// Every tag a Scholar prompt trusts, the judge's too (judge.ts). A person who types one cannot open or close a block: it is removed,
// again and again until none is left, so a tag hidden inside another cannot be put back together. The words between two of them
// are kept.
const CHAT_TAGS =
  /<\s*\/?\s*(?:message|conversation|reflection|heavy_moment|correction|answer|previous_answer)[^>]*>/gi;

export function stripChatTags(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(CHAT_TAGS, "");
    if (next === current) return current;
    current = next;
  }
}

// Cut at a word boundary with an ellipsis, so the result is at most `max` characters.
export function cutText(text: string, max: number): string {
  const tidy = text.replace(/\s+/g, " ").trim();
  if (tidy.length <= max) return tidy;
  const room = tidy.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > 0 ? room.slice(0, space) : room).replace(/[\s,;:]+$/, "")}…`;
}

// The messages before the new one, oldest first: the last SCREEN_CONTEXT.messages of them, each cut, each marked as the
// person's or the companion's. Empty when there are none.
export function buildScreenContext(context: readonly ChatContextMessage[]): string {
  const kept = context.slice(-SCREEN_CONTEXT.messages)
    .map((item) => ({ role: item.role, text: cutText(stripChatTags(item.text), SCREEN_CONTEXT.messageChars) }))
    .filter((item) => item.text !== "");
  if (kept.length === 0) return "";
  const lines = kept.map((item) => `${item.role === "user" ? "The person" : "The companion"}: ${item.text}`);
  return ["<conversation>", ...lines, "</conversation>"].join("\n");
}

// The user turn of a typed message: the conversation before it, then the message.
export function buildScreenChatText(text: string, context: readonly ChatContextMessage[]): string {
  const message = ["<message>", stripChatTags(text), "</message>"].join("\n");
  const before = buildScreenContext(context);
  return before === "" ? message : `${before}\n\n${message}`;
}

// The text that goes with a recording: the conversation before it, then what to do with the audio.
export function buildScreenChatAudioTurn(context: readonly ChatContextMessage[]): string {
  const before = buildScreenContext(context);
  return before === "" ? SCREEN_CHAT_AUDIO_TURN : `${before}\n\n${SCREEN_CHAT_AUDIO_TURN}`;
}

// One model call (gemini.ts: a busy service is tried again, a second unusable reply ends it). It does not look at the phrase
// list; screenTurn does, and so does the evaluation, which wants to see what the model alone says. A block is an answer.
export async function askChatModel(
  input: ScreenInput,
  context: readonly ChatContextMessage[],
  config: ChatScreenConfig,
): Promise<Asked> {
  const budget = input.kind === "text" ? scholarTiming.screenTyped : scholarTiming.screenSpoken;
  try {
    const verdict = await generate<Verdict>({
      apiKey: config.apiKey,
      model: config.model,
      fallbackModel: config.fallbackModel,
      thinkingLevel: config.thinkingLevel,
      system: SCREEN_CHAT_SYSTEM_INSTRUCTION,
      input: input.kind === "text"
        ? { kind: "text", text: buildScreenChatText(input.text, context) }
        : { kind: "audio", bytes: input.bytes, instruction: buildScreenChatAudioTurn(context) },
      schema: buildScreenSchema(),
      deadlineAt: Math.min(config.deadlineAt, Date.now() + budget.totalMs),
      validate: (text) => parseScreening(text, input.kind),
      attemptTimeoutMs: budget.attemptMs,
      safetySettings: SCREEN_SAFETY_SETTINGS,
    }, config.stats);
    return { kind: "verdict", verdict };
  } catch (error) {
    if (error instanceof GeminiBlocked) return { kind: "blocked" };
    // Every other failure of the call (busy, down, slow, unusable twice) arrives as AI_UNAVAILABLE, with a log-safe reason.
    if (error instanceof AppError) return { kind: "failed", reason: error.reason };
    throw error;
  }
}

// The phrase list comes first for a typed message (a match needs no model, cannot be argued out of, and works while the model is
// down), and runs on a recording's transcript afterwards (interpret).
export async function screenTurn(
  input: ScreenInput,
  context: readonly ChatContextMessage[],
  config: ChatScreenConfig,
): Promise<ScreenResult> {
  const matched = input.kind === "text" ? phraseVerdict(input.text) : null;
  if (matched !== null) return matched;
  return interpret(input, await askChatModel(input, context, config));
}

// screen-chat-v4 (the step 38 walk-through's B9): scholar-turn sends the written emergency answer without asking a model, and a
// thank-you after two disclosures was named an emergency in the light of the conversation half the time. So an emergency named
// with earlier messages before it is confirmed on the newest message alone: emergency again keeps it; another heavy line is that
// line; a clear message keeps the conversation's own line (never emergency), else the 988 line. A confirmation that cannot be
// had keeps emergency, the safe answer. eval/run_chat_eval.ts confirms the same way, so it measures what the person gets.
export async function confirmEmergency(
  words: string,
  config: ChatScreenConfig,
  conversationLine: HelpKind | null,
): Promise<HelpKind> {
  const alone = await screenTurn({ kind: "text", text: words }, [], config);
  if (alone.status === "failed") return "emergency";
  if (alone.status === "crisis") return alone.help;
  return conversationLine === null || conversationLine === "emergency" ? "crisis" : conversationLine;
}
