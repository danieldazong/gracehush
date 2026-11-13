import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { confirmPaidPlan } from "../_shared/billing/expiry.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { type DayWindow, dayWindow } from "../_shared/limits/weekly.ts";
import {
  type BillingStatus,
  blankLogLine,
  type CrisisSource,
  type LimitStatus,
  type ScreenStatus,
  shortHash,
  writeLog,
} from "../_shared/log.ts";
import { helpFromPhraseGroup, isHelpKind, type Region, regionOf } from "../_shared/safety/helpKind.ts";
import { matchCrisisGroup } from "../_shared/safety/phrases.ts";
import type { ScreenInput } from "../_shared/safety/screen.ts";
import { type ChatContextMessage, confirmEmergency, screenTurn } from "../_shared/safety/screenTurn.ts";
import {
  ANSWER_MAX_OUTPUT_TOKENS,
  HEAVY_THINKING_LEVEL,
  SCHOLAR_CLAIM_LEASE_MS,
  SCHOLAR_LIMITS,
  SCHOLAR_REQUEST,
  scholarTiming,
  TITLE_LIMITS,
  WRITER_CONTEXT,
} from "../_shared/scholar/constants.ts";
import {
  ADULTS_ONLY_TEXT,
  ALL_PLAIN_NAMING_PHRASES,
  allowedPassageKeys,
  buildHeavyBlock,
  defaultPassageKey,
  type FallbackVariant,
  fallbackVariant,
  hardPassage,
  heavyChatFallback,
  localTime,
  type PlainNaming,
  usedPassageKeys,
} from "../_shared/scholar/heavyChat.ts";
import { judgeAnswer, judgeNote } from "../_shared/scholar/judge.ts";
import { type ParsedScholarReply, parseScholarReply, type ScholarAnswer } from "../_shared/scholar/output.ts";
import {
  findTypedVerse,
  type PassageCard,
  type ResolvedPassages,
  resolvePassages,
  TYPED_VERSE_NOTE,
} from "../_shared/scholar/passages.ts";
import {
  buildScholarInstruction,
  buildScholarSchema,
  buildScholarTurn,
  SCHOLAR_PROMPT_VERSION,
  type ScholarHistoryMessage,
  type ScholarReflectionContext,
  type StoredBlock,
} from "../_shared/scholar/prompt.ts";
import {
  allowanceStatus,
  checkAllowance,
  currentUsage,
  freeBudgetLeft,
  readFreeBudget,
  type ScholarUsage,
} from "../_shared/scholar/usage.ts";
import { findEntryById } from "../confirm-scripture/lifecycle.ts";
import { downloadRecording } from "../process-entry/audio.ts";
import type { HelpKind, ScholarInput, ScholarTurnResponse } from "../process-entry/contracts.ts";
import { GeminiBlocked, type GeminiStats, generate, newStats } from "../process-entry/gemini.ts";
import { ensureProfile, type EntryRow, readProfile, type StoredProfile } from "../process-entry/lifecycle.ts";
import { readJsonBody } from "../process-entry/validate.ts";
import {
  bumpSafety,
  bumpUsage,
  chatRecordingPath,
  closeScholar,
  type ConversationRow,
  countRecentMessages,
  failMessage,
  findAnswer,
  findConversation,
  findConversationForEntry,
  findMessage,
  finishMessage,
  insertConversation,
  insertMessage,
  listHistory,
  markConversationHeavy,
  markMessageHeavy,
  type MessageContent,
  type MessageRow,
  readFreeAnswered,
  readScholarClosedAt,
  readUsageRows,
  reclaimMessage,
  removeRecording,
  type SafetyCounter,
  saveWords,
  sweepStrayRecordings,
  touchConversation,
} from "./lifecycle.ts";
import { toScholarConversation, toScholarMessage, wordsOf } from "./response.ts";

// scholar-turn (step 38): one message of a Scholar conversation, and its answer, in one request. The order is fixed, and it is
// what keeps a person safe: the token; the body; one read of everything the request needs; a replay; the switch; the rate limit;
// the conversation; the claim of the message; the screening (with a typed message's everyday answer written at the same time and
// held until the screening says clear); then either the heavy answer (the heavy model only, under the heavy rules, or the written
// fallback) or, after the plan, the day's allowance and the free budget, the everyday answer. Nothing is ever written for a
// message that was not screened, and a message the phrase list, the screening or the writer flagged never gets LIMIT_REACHED,
// AI_UNAVAILABLE or SCHOLAR_UNAVAILABLE: it gets an answer, or the written fallback. The counters run after the response.
//
// scholar-v2 (2026-11-11, after the readers' review): a heavy answer is written with more thinking, under rules that make it answer
// this person, with a passage from the readers' list and a <heavy_moment> block that carries the help line for their situation and
// region, their local time and what the conversation has already had; a second model checks that it answered what they asked, and
// the heavy model is asked once more when it did not. Harm already underway gets the written emergency answer before any model is
// asked; since screen-chat-v4 an emergency named only in the light of earlier messages is first confirmed on the newest message
// alone. A person who says they are under 18 gets full care in a heavy moment, and otherwise a kind answer, after which Scholar
// closes for the account (scholar_closed_at): a clear message from a closed account is refused, a heavy one is still answered.
//
// The log line is the shared one (43 fields). Its reason says what happened in a word (scholar:answered,
// scholar:answered:typed_verse, scholar:heavy, scholar:heavy:closed, scholar:emergency, scholar:adults_only, scholar:fallback:<why>, scholar:replayed, scholar:off,
// scholar:budget, or an error's own); it never holds a message, an answer, a title, a passage, a conversation or message id, a help
// line or a phrase.

const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
// A conversation and a message id are made on the phone: a canonical, lowercase UUID v4.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A reflection's id is the database's.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  inputType: "text" | "audio" | null;
  screenStats: GeminiStats;
  writerStats: GeminiStats;
  // The model that wrote the saved answer (or tried to), else the screening's, else none.
  model: string | null;
  authMs: number;
  dbMs: number;
  bibleMs: number;
  screen: ScreenStatus | null;
  screenMs: number;
  crisisSource: CrisisSource | null;
  limit: LimitStatus | null;
  limitUsed: number | null;
  billing: BillingStatus | null;
  billingMs: number;
  // The 200 line's reason.
  outcome: string | null;
  // The anonymous counters this request adds to, and the work that runs after the response whatever it was.
  counters: SafetyCounter[];
  after: (() => Promise<unknown>)[];
};

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

type EdgeRuntimeLike = { waitUntil?: (promise: Promise<unknown>) => void };

function runInBackground(work: Promise<unknown>): void {
  const guarded = work.catch(() => undefined);
  (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime?.waitUntil?.(guarded);
}

const quietly = (work: Promise<unknown>) => work.then(() => undefined, () => undefined);

// ---- The secrets -------------------------------------------------------------------------------------------------------------

type EnabledConfig = {
  enabled: true;
  apiKey: string;
  // SCHOLAR_MODEL writes everyday answers, SCHOLAR_SCREENING_MODEL screens, SCHOLAR_HEAVY_MODEL writes every heavy answer and takes
  // the second attempt of the other two. No model name is written in code.
  model: string;
  screeningModel: string;
  heavyModel: string;
  thinkingLevel: string;
  screenFirst: boolean;
  freeBudget: number;
};
export type ScholarConfig = { enabled: false } | EnabledConfig;

function modelSecret(name: string): string {
  const value = optionalEnv(name);
  if (value === undefined || !MODEL_NAME.test(value)) throw new AppError("INTERNAL", `bad_config:${name}`);
  return value;
}

// SCHOLAR_ENABLED is read on every request: anything but "true" is off, and then no model is called and no model secret is read.
export function readScholarConfig(): ScholarConfig {
  if (optionalEnv("SCHOLAR_ENABLED") !== "true") return { enabled: false };
  const model = modelSecret("SCHOLAR_MODEL");
  const screeningModel = modelSecret("SCHOLAR_SCREENING_MODEL");
  const heavyModel = modelSecret("SCHOLAR_HEAVY_MODEL");
  const thinkingLevel = optionalEnv("GEMINI_THINKING_LEVEL") ?? "low";
  if (!["low", "medium", "high"].includes(thinkingLevel)) {
    throw new AppError("INTERNAL", "bad_config:GEMINI_THINKING_LEVEL");
  }
  return {
    enabled: true,
    apiKey: requireEnv("GEMINI_API_KEY"),
    model,
    screeningModel,
    heavyModel,
    thinkingLevel,
    screenFirst: optionalEnv("SCHOLAR_SCREEN_FIRST") === "true",
    freeBudget: readFreeBudget(optionalEnv),
  };
}

// ---- The request -------------------------------------------------------------------------------------------------------------

export type TurnRequest = {
  conversationId: string;
  messageId: string;
  input: ScholarInput;
  entryId: string | null;
  // The phone's region (2026-11-11): the US and its territories, or anywhere else. It chooses the emergency number a heavy answer
  // names and the words of the written answers. A request with none is the US.
  region: Region;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A key the contract does not name is refused, so no recording and no user id ever travel in a body.
function onlyKeys(value: Record<string, unknown>, keys: readonly string[], reason: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new AppError("INVALID_REQUEST", reason);
}

export async function readTurnRequest(req: Request): Promise<TurnRequest> {
  const body = await readJsonBody(req, SCHOLAR_REQUEST.maxBodyBytes);
  if (!isRecord(body)) throw new AppError("INVALID_REQUEST", "body_shape");
  onlyKeys(body, ["conversationId", "messageId", "input", "entryId", "region"], "body_keys");
  const { conversationId, messageId, input, entryId } = body;
  if (body.region !== undefined && (typeof body.region !== "string" || !/^[A-Za-z]{2}$/.test(body.region))) {
    throw new AppError("INVALID_REQUEST", "region");
  }
  const region = regionOf(typeof body.region === "string" ? body.region : null);
  if (typeof conversationId !== "string" || !UUID_V4.test(conversationId)) {
    throw new AppError("INVALID_REQUEST", "conversation_id");
  }
  if (typeof messageId !== "string" || !UUID_V4.test(messageId)) throw new AppError("INVALID_REQUEST", "message_id");
  if (entryId !== undefined && (typeof entryId !== "string" || !UUID.test(entryId))) {
    throw new AppError("INVALID_REQUEST", "entry_id");
  }
  if (!isRecord(input)) throw new AppError("INVALID_REQUEST", "input");
  const entry = typeof entryId === "string" ? entryId : null;
  if (input.type === "text") {
    onlyKeys(input, ["type", "text"], "input_keys");
    if (typeof input.text !== "string") throw new AppError("INVALID_REQUEST", "text");
    const text = input.text.trim();
    if (text === "") throw new AppError("INVALID_REQUEST", "text_empty");
    if (text.length > SCHOLAR_REQUEST.maxTextChars) throw new AppError("PAYLOAD_TOO_LARGE", "text_long");
    return { conversationId, messageId, input: { type: "text", text }, entryId: entry, region };
  }
  if (input.type === "audio") {
    onlyKeys(input, ["type", "durationMs"], "input_keys");
    const ms = input.durationMs;
    if (
      typeof ms !== "number" || !Number.isFinite(ms) || ms < SCHOLAR_REQUEST.minSpokenMs ||
      ms > SCHOLAR_REQUEST.maxSpokenMs
    ) {
      throw new AppError("INVALID_REQUEST", "duration");
    }
    return { conversationId, messageId, input: { type: "audio", durationMs: ms }, entryId: entry, region };
  }
  throw new AppError("INVALID_REQUEST", "input_type");
}

// ---- What the writer and the screening see -------------------------------------------------------------------------------

const textContent = (text: string): { blocks: StoredBlock[] } => ({ blocks: [{ type: "text", text }] });

// An answer's words for the screening's context: its text and its prayer, never a passage (Bible words are not the person's).
function answerText(row: MessageRow): string {
  const blocks = row.content?.blocks ?? [];
  return blocks.filter((block) => block.type !== "passage").map((block) => block.text).join("\n\n");
}

function chatContext(history: readonly MessageRow[]): ChatContextMessage[] {
  return history.map((row) => ({ role: row.role, text: row.role === "user" ? wordsOf(row) ?? "" : answerText(row) }))
    .filter((message) => message.text !== "");
}

function writerHistory(history: readonly MessageRow[]): ScholarHistoryMessage[] {
  return history.flatMap((row): ScholarHistoryMessage[] => {
    if (row.role === "scholar") {
      return row.content?.blocks?.length ? [{ role: "scholar", blocks: row.content.blocks }] : [];
    }
    const words = wordsOf(row);
    return words === null ? [] : [{ role: "user", text: words }];
  });
}

function reflectionContext(entry: EntryRow): ScholarReflectionContext {
  return {
    words: entry.transcript,
    title: entry.devotional_title,
    feeling: entry.dominant_emotion,
    passage: entry.scripture_reference,
    devotional: entry.devotional_script,
    closingPrayer: entry.closing_prayer,
  };
}

// A conversation opened from a reflection takes its title, when it is one a conversation may carry.
function titleOf(entry: EntryRow): string | null {
  const title = (entry.devotional_title ?? "").trim();
  return title !== "" && title.length <= TITLE_LIMITS.maxChars ? title : null;
}

// ---- The answer ----------------------------------------------------------------------------------------------------------------

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  return work.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
}

type FallbackWhy = "blocked" | "unwritten" | "screen_failed" | "off" | "emergency";

type Outcome =
  | { kind: "answer"; answer: ScholarAnswer; cards: ResolvedPassages }
  | {
    kind: "fallback";
    why: FallbackWhy;
    variant: FallbackVariant;
    help: HelpKind;
    reply: string;
    cards: ResolvedPassages;
  }
  | { kind: "adults_only"; reply: string; cards: ResolvedPassages };

const NO_CARDS: ResolvedPassages = { lead: null, support: null, bibleMs: 0 };

const cardsOf = (cards: ResolvedPassages): PassageCard[] =>
  [cards.lead, cards.support].filter((card): card is PassageCard => card !== null);

const spokenTexts = (answer: ScholarAnswer) => answer.prayer === null ? [answer.reply] : [answer.reply, answer.prayer];

const passageBlock = (card: PassageCard): StoredBlock => ({
  type: "passage",
  reference: card.reference,
  text: card.text,
});

// The saved order: the lead passage, the text, the supporting passage, the prayer.
function blocksFor(outcome: Outcome): StoredBlock[] {
  const reply = outcome.kind === "answer" ? outcome.answer.reply : outcome.reply;
  // The card a written answer carries comes after its text, like any supporting passage.
  const prayer = outcome.kind === "answer" ? outcome.answer.prayer : null;
  return [
    ...(outcome.cards.lead ? [passageBlock(outcome.cards.lead)] : []),
    { type: "text", text: reply },
    ...(outcome.cards.support ? [passageBlock(outcome.cards.support)] : []),
    ...(prayer ? [{ type: "prayer" as const, text: prayer }] : []),
  ];
}

const COUNTER_BY_SOURCE: Record<CrisisSource, SafetyCounter> = {
  phrase: "flagged_phrase",
  model: "flagged_model",
  uncertain: "flagged_uncertain",
  blocked: "flagged_blocked",
};

// Everything one message's answer needs, read before the claim.
type Turn = {
  admin: SupabaseClient;
  userId: string;
  request: TurnRequest;
  config: ScholarConfig;
  profile: StoredProfile;
  window: DayWindow;
  messagesToday: number;
  freeAnswered: number;
  utcDay: string;
  conversation: ConversationRow;
  reflection: EntryRow | null;
  history: MessageRow[];
  message: MessageRow;
  requestDeadline: number;
  // Scholar was closed for this account (the person said they are under 18): only a heavy message is answered.
  closed: boolean;
};

// The help line a conversation already carries: the newest answer's, else, for a conversation opened from a heavy reflection, the
// reflection's. Null when nothing has shown one yet.
function conversationHelp(history: readonly MessageRow[], reflection: EntryRow | null): HelpKind | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const help = history[index].role === "scholar" ? history[index].content?.help : undefined;
    if (isHelpKind(help)) return help;
  }
  if (reflection?.is_crisis === true) return isHelpKind(reflection.help_line) ? reflection.help_line : "crisis";
  return null;
}

// How plainly an answer may name it this turn (the counselor's narrow yes): once in the conversation, and only as plainly as the
// person did: their own words matched the first-person phrase list, and "suicide" only when they used the word.
function plainNamingFor(personWords: string, earlierAnswers: readonly string[]): PlainNaming {
  const flat = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'");
  if (earlierAnswers.some((answer) => ALL_PLAIN_NAMING_PHRASES.some((phrase) => flat(answer).includes(phrase)))) {
    return null;
  }
  if (matchCrisisGroup(personWords) !== "self") return null;
  return /suicid/i.test(personWords) ? "suicide" : "life";
}

async function answerMessage(turn: Turn, context: Context): Promise<Response> {
  const { admin, userId, request, config } = turn;
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const messageId = request.messageId;
  const heavyBefore = turn.conversation.is_heavy;
  const firstHeavyAnswer = !heavyBefore || !turn.history.some((row) => row.role === "scholar");
  const reflection = turn.reflection === null ? null : reflectionContext(turn.reflection);
  const history = writerHistory(turn.history);
  const askTitle = turn.conversation.title === null && turn.conversation.entry_id === null && !heavyBefore;
  const earlierWords = history.flatMap((message) => message.role === "user" ? [message.text] : []);
  // scholar-v2: what the conversation has already had, for the heavy rules and the written answers.
  const answers = turn.history.filter((row) => row.role === "scholar");
  const earlierAnswers = answers.map(answerText).filter((text) => text !== "");
  const usedPassages = usedPassageKeys(
    answers.flatMap((row) =>
      (row.content?.blocks ?? []).flatMap((block) => block.type === "passage" ? [block.reference] : [])
    ),
  );
  const writtenBefore = answers.some((row) => row.content?.fallback !== undefined);
  const helpBefore = conversationHelp(turn.history, turn.reflection);
  // What this request learns as it goes: the message's words (a spoken one's, once heard), whether it was flagged and by which
  // layer, the plan as confirmed, and the day's allowance for a clear message.
  const state: {
    words: string | null;
    flaggedBy: SafetyCounter | null;
    // The help line this message's flag chose (the screening's, the phrase list's, or the 988 line for the writer's own flag).
    help: HelpKind | null;
    tier: StoredProfile["tier"];
    allowance: ScholarUsage | null;
    // The person said they are under 18: Scholar closes for the account once this answer is saved.
    closeAfter: boolean;
    // The everyday reply still repeated a passage's words after the one retry, and is kept (scholar:answered:typed_verse).
    typedVerseKept: boolean;
  } = {
    words: request.input.type === "text" ? request.input.text : wordsOf(turn.message),
    flaggedBy: null,
    help: null,
    tier: turn.profile.tier,
    allowance: null,
    closeAfter: false,
    typedVerseKept: false,
  };
  const helpNow = (): HelpKind => state.help ?? helpBefore ?? "crisis";
  let outcome: Outcome | null = null;

  // A written answer: the emergency one for harm underway, the shorter one when a written answer has already appeared here, the
  // one for a person someone is hurting, or the general one; each with the card it prefers that this conversation may still show.
  const fallback = async (why: FallbackWhy): Promise<Outcome> => {
    const help = helpNow();
    const variant = why === "emergency" ? "emergency" : fallbackVariant(help, writtenBefore);
    const written = heavyChatFallback(variant, { help, region: request.region, usedPassages });
    const cards = written.passageKey === null
      ? NO_CARDS
      : await resolvePassages({ lead: null, support: hardPassage(written.passageKey).ref }, { heavy: true });
    context.bibleMs += cards.bibleMs;
    return { kind: "fallback", why, variant, help, reply: written.reply, cards };
  };

  // Marks this message and its conversation heavy (and clears the conversation's title) before any of the answer is written.
  const flag = async (counter: SafetyCounter, help: HelpKind) => {
    state.flaggedBy = counter;
    state.help = help;
    await db(() => markConversationHeavy(admin, userId, turn.conversation.id));
    await db(() => markMessageHeavy(admin, userId, messageId));
  };

  if (!config.enabled) {
    // 5. The switch is off: no model is called. Only a heavy conversation, or a message the phrase list matches, gets here (run()
    // refused everything else before the claim), and it gets the written fallback.
    const group = state.words === null ? null : matchCrisisGroup(state.words);
    if (group !== null) {
      context.screen = "crisis";
      context.crisisSource = "phrase";
      context.counters.push("screened");
      await flag("flagged_phrase", helpFromPhraseGroup(group));
    }
    // A recording that was never read is not kept: the message has its answer.
    if (request.input.type === "audio" && state.words === null) {
      await quietly(removeRecording(admin, userId, messageId));
    }
    outcome = await fallback("off");
  } else {
    // 9. A spoken message is screened from its saved words when it has them, otherwise from its recording.
    const recording = state.words === null
      ? await db(() => downloadRecording(admin, chatRecordingPath(userId, messageId)))
      : null;
    const screenInput: ScreenInput = recording === null
      ? { kind: "text", text: state.words as string }
      : { kind: "audio", bytes: recording };
    const phrase = screenInput.kind === "text" && matchCrisisGroup(screenInput.text) !== null;

    const writeEveryday = (message: string, correction: string | null) =>
      generate<ParsedScholarReply>({
        apiKey: config.apiKey,
        model: config.model,
        fallbackModel: config.heavyModel,
        thinkingLevel: config.thinkingLevel,
        system: buildScholarInstruction(),
        input: {
          kind: "text",
          text: buildScholarTurn({ reflection, history, message, askTitle, heavyBlock: null, correction }),
        },
        schema: buildScholarSchema(),
        deadlineAt: Math.min(turn.requestDeadline, Date.now() + scholarTiming.answer.totalMs),
        attemptTimeoutMs: scholarTiming.answer.attemptMs,
        maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
        validate: (text) =>
          parseScholarReply(text, {
            heavy: false,
            message,
            askTitle,
            privateSource: [...earlierWords, message].join("\n"),
          }),
      }, context.writerStats);

    // 10. The screening. A typed message's everyday answer is written at the same time and held until the screening says clear,
    // unless the switch says screen first, the conversation is already heavy, the phrase list matched, the stored plan has nothing
    // left today, or Scholar is closed for the account (that answer would only be thrown away).
    const storedAllowance = checkAllowance({
      heavy: false,
      tier: turn.profile.tier,
      messagesToday: turn.messagesToday,
      window: turn.window,
    });
    const storedBudget = turn.profile.tier !== "free" || freeBudgetLeft(turn.freeAnswered, config.freeBudget);
    const early = screenInput.kind === "text" && !config.screenFirst && !heavyBefore && !phrase && !turn.closed &&
        storedAllowance.kind === "ok" && storedBudget
      ? settle(writeEveryday(screenInput.text, null))
      : null;

    const screenStarted = Date.now();
    const screenContext = chatContext(turn.history);
    const screenConfig = {
      apiKey: config.apiKey,
      model: config.screeningModel,
      fallbackModel: config.heavyModel,
      thinkingLevel: config.thinkingLevel,
      deadlineAt: turn.requestDeadline,
      stats: context.screenStats,
    };
    const screened = await screenTurn(screenInput, screenContext, screenConfig);
    context.screenMs = Date.now() - screenStarted;

    // screen-chat-v4 (the step 38 walk-through's B9): an emergency named in the light of earlier messages is confirmed on the
    // newest message alone (safety/screenTurn.ts confirmEmergency), because the written emergency answer skips the model.
    const confirmAlone = async (words: string): Promise<HelpKind> => {
      const help = await confirmEmergency(words, screenConfig, helpBefore);
      context.screenMs = Date.now() - screenStarted;
      return help;
    };
    context.screen = screened.status;
    context.model = early === null ? config.screeningModel : config.model;
    context.counters.push("screened");

    // 11. After the screening.
    if (screened.status === "no_speech") {
      if (recording !== null) await quietly(removeRecording(admin, userId, messageId));
      throw new AppError("NO_SPEECH", "no_speech");
    }
    if (screened.status === "failed") {
      context.counters.push("screen_failed");
      // The recording is kept, so the person can send the message again.
      if (!heavyBefore && !phrase) throw new AppError("AI_UNAVAILABLE", `screen:${screened.reason}`);
      if (recording !== null) await quietly(removeRecording(admin, userId, messageId));
      outcome = await fallback("screen_failed");
    } else {
      if (recording !== null) {
        // A recording that was read: its words are saved, it is deleted, and so are the person's stray takes (after the response).
        const heard = screened.transcript;
        if (heard) {
          state.words = heard;
          await db(() => saveWords(admin, userId, messageId, heard));
        }
        await quietly(removeRecording(admin, userId, messageId));
        context.after.push(() => sweepStrayRecordings(admin, userId, Date.now()));
      }
      if (screened.status === "crisis") {
        context.crisisSource = screened.source;
        const help = screened.help === "emergency" && screenContext.length > 0 && state.words !== null
          ? await confirmAlone(state.words)
          : screened.help;
        await flag(COUNTER_BY_SOURCE[screened.source], help);
        // Harm already underway: the written emergency answer, before any model is asked, so nothing stands between the person
        // and the number (the readers' rule 12; the words are a draft for the counselor).
        if (help === "emergency") outcome = await fallback("emergency");
      }
    }

    let heavyAnswer = heavyBefore || state.flaggedBy !== null;

    // A clear message from an account Scholar was closed for (the person said they are under 18) is refused; a heavy one goes on.
    if (outcome === null && !heavyAnswer && turn.closed) {
      throw new AppError("SCHOLAR_ADULTS_ONLY", "scholar:adults_only");
    }

    if (outcome === null && !heavyAnswer) {
      // 13. Clear: the plan (a paid row whose end date has passed is read again), the day's allowance, the free budget.
      const confirmed = await confirmPaidPlan(admin, userId, turn.profile);
      context.billing = confirmed.billing;
      context.billingMs = confirmed.billingMs;
      state.tier = confirmed.profile.tier;
      const allowance = checkAllowance({
        heavy: false,
        tier: state.tier,
        messagesToday: turn.messagesToday,
        window: turn.window,
      });
      context.limit = allowanceStatus(allowance, turn.window);
      context.limitUsed = turn.messagesToday;
      if (allowance.kind === "blocked") throw new AppError("LIMIT_REACHED", "limit", { usage: allowance.usage });
      if (allowance.kind === "ok") state.allowance = allowance.usage;
      if (state.tier === "free" && !freeBudgetLeft(turn.freeAnswered, config.freeBudget)) {
        throw new AppError("SCHOLAR_UNAVAILABLE", "scholar:budget");
      }

      // 14. The everyday answer: its checks, its passages, then the typed-verse guard, which asks once more from here with the note
      // and keeps the second reply.
      context.model = config.model;
      const message = state.words as string;
      let pending = early ?? settle(writeEveryday(message, null));
      for (let round = 0; round < 2; round += 1) {
        const settled = await pending;
        if (!settled.ok) {
          // A safety block on the writer is heavy (the writer is the third layer). Any other failure is the person's to retry.
          if (!(settled.error instanceof GeminiBlocked)) throw settled.error;
          context.crisisSource = "blocked";
          await flag("flagged_writer", "crisis");
          heavyAnswer = true;
          break;
        }
        if (settled.value.kind === "flagged") {
          // The writer flagged its own reply: it is discarded, and the heavy model writes the answer.
          context.crisisSource = "model";
          await flag("flagged_writer", "crisis");
          heavyAnswer = true;
          break;
        }
        if (settled.value.saysUnder18) {
          // GraceHush is for adults: a kind answer, and Scholar closes for the account once it is saved.
          state.closeAfter = true;
          outcome = { kind: "adults_only", reply: ADULTS_ONLY_TEXT, cards: NO_CARDS };
          break;
        }
        const cards = await resolvePassages(
          { lead: settled.value.leadPassage, support: settled.value.passage },
          { heavy: false },
        );
        context.bibleMs += cards.bibleMs;
        const typed = await findTypedVerse(spokenTexts(settled.value), cardsOf(cards));
        if (!typed || round === 1) {
          // A reply that still repeats a passage's words after the one retry is kept, never "try again": the words the guard finds
          // are the verified Berean Standard Bible text, never in quotation marks (the echo check refuses those), and a question
          // such as "What is the fruit of the Spirit?" cannot be answered without them (step 38's walk-through, 2026-11-12).
          if (typed) state.typedVerseKept = true;
          outcome = { kind: "answer", answer: settled.value, cards };
          break;
        }
        pending = settle(writeEveryday(message, TYPED_VERSE_NOTE));
      }
    }

    if (outcome === null && heavyAnswer) {
      // 12. Heavy: the heavy model only, with no second model, more thinking, and the whole answer held for its checks. No answer
      // that passes in time, anything that fails, or a recording whose words were never read, is the written fallback. Never
      // "try again".
      context.model = config.heavyModel;
      if (state.words === null) {
        outcome = await fallback("blocked");
      } else {
        const message = state.words;
        const help = helpNow();
        const heavyDeadline = Math.min(turn.requestDeadline, Date.now() + scholarTiming.heavy.totalMs);
        const plainNaming = plainNamingFor([...earlierWords, message].join("\n"), earlierAnswers);
        const heavyBlock = buildHeavyBlock({
          help,
          region: request.region,
          firstAnswer: firstHeavyAnswer,
          answersBefore: answers.length,
          plainNaming,
          usedPassages,
          time: localTime(new Date(), turn.profile.timezone),
        });
        const writeHeavy = (correction: string | null) =>
          generate<ParsedScholarReply>({
            apiKey: config.apiKey,
            model: config.heavyModel,
            thinkingLevel: HEAVY_THINKING_LEVEL,
            system: buildScholarInstruction(),
            input: {
              kind: "text",
              text: buildScholarTurn({ reflection, history, message, askTitle: false, heavyBlock, correction }),
            },
            schema: buildScholarSchema({ heavy: true }),
            deadlineAt: heavyDeadline,
            attemptTimeoutMs: scholarTiming.heavy.attemptMs,
            maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
            validate: (text) =>
              parseScholarReply(text, {
                heavy: true,
                message,
                askTitle: false,
                privateSource: [...earlierWords, message].join("\n"),
                help,
                plainNaming,
                earlier: earlierAnswers,
              }),
          }, context.writerStats);
        // The card: the passage the model chose when this conversation may still show it; the first heavy answer is never without
        // one (the readers' default for its situation, when the model chose none it may show or that card cannot be shown).
        const allowed = allowedPassageKeys(help, usedPassages);
        const fallbackKey = firstHeavyAnswer ? defaultPassageKey(help, usedPassages) : null;
        const settleHeavy = async (written: ParsedScholarReply) => {
          if (written.kind !== "answer") throw new AppError("AI_UNAVAILABLE", "heavy_shape");
          const chosen = written.passageKey !== null && allowed.includes(written.passageKey)
            ? written.passageKey
            : null;
          const cards = await resolvePassages(
            { lead: null, support: chosen === null ? null : hardPassage(chosen).ref },
            { heavy: true, fallback: fallbackKey === null ? null : hardPassage(fallbackKey).ref },
          );
          context.bibleMs += cards.bibleMs;
          return { answer: written, cards, typed: await findTypedVerse(spokenTexts(written), cardsOf(cards)) };
        };
        const timeLeft = () => heavyDeadline - Date.now();
        try {
          let current = await settleHeavy(await writeHeavy(null));
          if (current.typed && timeLeft() >= scholarTiming.heavyRetryMinMs) {
            current = await settleHeavy(await writeHeavy(TYPED_VERSE_NOTE));
          }
          if (current.typed) {
            outcome = await fallback("unwritten");
          } else {
            // The judge: did it answer what they asked, and pray when asked? One more try when it missed, and the answer it has
            // is kept when that try fails or there is no time for it.
            const judgment = timeLeft() >= scholarTiming.judge.totalMs
              ? await judgeAnswer({
                previous: earlierAnswers.length === 0 ? null : earlierAnswers[earlierAnswers.length - 1],
                message,
                reply: current.answer.reply,
                prayer: current.answer.prayer,
              }, {
                apiKey: config.apiKey,
                model: config.screeningModel,
                deadlineAt: heavyDeadline,
                stats: context.writerStats,
              })
              : null;
            const note = judgeNote(judgment, current.answer.prayer !== null);
            if (note !== null && timeLeft() >= scholarTiming.heavyRetryMinMs) {
              try {
                const again = await settleHeavy(await writeHeavy(note));
                if (!again.typed) current = again;
              } catch {
                // Kept: the answer it has passed every check.
              }
            }
            outcome = { kind: "answer", answer: current.answer, cards: current.cards };
            if (current.answer.saysUnder18) state.closeAfter = true;
          }
        } catch (error) {
          outcome = await fallback(error instanceof GeminiBlocked ? "blocked" : "unwritten");
        }
      }
    }
  }

  if (outcome === null) throw new AppError("INTERNAL", "no_outcome");
  const done: Outcome = outcome;
  const flagged = state.flaggedBy !== null;
  const heavy = heavyBefore || flagged || done.kind === "fallback";
  // An answer to a flagged message, and a written answer, carry the help line: its kind is saved with it (one word).
  const carriesHelp = flagged || done.kind === "fallback";
  const content: MessageContent = {
    blocks: blocksFor(done),
    ...(carriesHelp ? { help: done.kind === "fallback" ? done.help : helpNow() } : {}),
    ...(done.kind === "fallback" ? { fallback: done.variant } : {}),
  };

  // 15. Save and respond: the answer, the person's message ready, the conversation's last message time and its title.
  const saved = await db(() =>
    insertAnswerRow(admin, {
      conversationId: turn.conversation.id,
      userId,
      replyTo: messageId,
      content,
      isHeavy: carriesHelp,
    })
  );
  if (saved === "duplicate") return await replay(turn, context);
  if (saved === "missing") throw new AppError("NOT_FOUND", "conversation_gone");
  const question = await db(() => finishMessage(admin, userId, messageId, flagged));
  if (question === null) throw new AppError("NOT_FOUND", "conversation_gone");
  const title = done.kind === "answer" && askTitle && !heavy ? done.answer.title : null;
  const conversation = await db(() =>
    touchConversation(admin, userId, turn.conversation.id, {
      last_message_at: saved.created_at,
      ...(title !== null ? { title } : {}),
    })
  );
  if (conversation === null) throw new AppError("NOT_FOUND", "conversation_gone");
  // Scholar closes for the account (the person said they are under 18). A failure here changes no answer.
  if (state.closeAfter) await quietly(db(() => closeScholar(admin, userId, saved.created_at)));

  if (state.flaggedBy !== null) context.counters.push(state.flaggedBy);
  // The emergency answer is not a failure to write one, so it is not counted as a fallback.
  if (done.kind === "fallback" && done.why !== "emergency") context.counters.push("fallbacks");
  if (heavy) {
    context.limit = "exempt";
    context.limitUsed = null;
  } else {
    // 16 (after the response): the person's day, and the free budget for a free account.
    context.after.push(() => bumpUsage(admin, userId, turn.window.day, 1, 0));
    if (state.tier === "free") context.counters.push("free_answered");
  }
  context.outcome = done.kind === "fallback"
    ? done.why === "emergency" ? "scholar:emergency" : `scholar:fallback:${done.why}`
    : done.kind === "adults_only"
    ? "scholar:adults_only"
    : heavy
    ? state.closeAfter ? "scholar:heavy:closed" : "scholar:heavy"
    : state.typedVerseKept
    ? "scholar:answered:typed_verse"
    : "scholar:answered";

  const body: ScholarTurnResponse = {
    conversation: toScholarConversation(conversation),
    message: toScholarMessage(question),
    answer: toScholarMessage(saved),
    usage: heavy ? null : state.allowance,
  };
  return jsonResponse(200, body, corsHeaders);
}

async function insertAnswerRow(
  admin: SupabaseClient,
  row: { conversationId: string; userId: string; replyTo: string; content: MessageContent; isHeavy: boolean },
): Promise<MessageRow | "duplicate" | "missing"> {
  const made = await insertMessage(admin, {
    id: crypto.randomUUID(),
    conversation_id: row.conversationId,
    user_id: row.userId,
    role: "scholar",
    reply_to: row.replyTo,
    input_type: null,
    status: "ready",
    error_code: null,
    content: row.content,
    is_heavy: row.isHeavy,
    claimed_at: null,
  });
  return "refused" in made ? made.refused : made;
}

// 4. The answer already exists (the phone sent the message again, or another request answered it first): it is returned as it
// is, with no model call and nothing counted.
async function replay(
  turn: Pick<Turn, "admin" | "userId" | "request" | "profile" | "window" | "messagesToday">,
  context: Context,
) {
  const { admin, userId, request } = turn;
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const [message, answer] = await db(() =>
    Promise.all([findMessage(admin, userId, request.messageId), findAnswer(admin, userId, request.messageId)])
  );
  if (message === null || answer === null) throw new AppError("NOT_FOUND", "conversation_gone");
  const conversation = await db(() => findConversation(admin, userId, message.conversation_id));
  if (conversation === null) throw new AppError("NOT_FOUND", "conversation_gone");
  const question = message.status === "ready"
    ? message
    : (await db(() => finishMessage(admin, userId, message.id, message.is_heavy))) ?? message;
  context.outcome = "scholar:replayed";
  const body: ScholarTurnResponse = {
    conversation: toScholarConversation(conversation),
    message: toScholarMessage(question),
    answer: toScholarMessage(answer),
    usage: conversation.is_heavy
      ? null
      : currentUsage({ tier: turn.profile.tier, messagesToday: turn.messagesToday, window: turn.window }),
  };
  return jsonResponse(200, body, corsHeaders);
}

// ---- The request, up to the claim ------------------------------------------------------------------------------------------

async function run(req: Request, context: Context): Promise<Response> {
  // 1, 2. Method, token, then the body (the token first, as every function here does, so a request with no token is a 401
  // whatever its body).
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  const userId = user.userId;
  context.userHash = await shortHash(userId);
  const request = await readTurnRequest(req);
  context.inputType = request.input.type;
  const config = readScholarConfig();

  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const now = Date.now();

  // 3. One read of everything the request needs.
  await db(() => ensureProfile(admin, userId));
  const [profile, byId, byEntry, message, answer, recent, history, usageRows, freeAnswered, entry, closedAt] = await db(
    () =>
      Promise.all([
        readProfile(admin, userId),
        findConversation(admin, userId, request.conversationId),
        request.entryId === null ? Promise.resolve(null) : findConversationForEntry(admin, userId, request.entryId),
        findMessage(admin, userId, request.messageId),
        findAnswer(admin, userId, request.messageId),
        countRecentMessages(
          admin,
          userId,
          new Date(now - SCHOLAR_LIMITS.rateWindowMs).toISOString(),
          request.messageId,
        ),
        listHistory(admin, userId, request.conversationId, WRITER_CONTEXT.messages + 1),
        // The profile's day is the UTC day, the day before or the day after: its row is picked once the zone is known.
        readUsageRows(admin, userId, new Date(now - DAY_MS).toISOString().slice(0, 10)),
        readFreeAnswered(admin, new Date(now).toISOString().slice(0, 10)),
        request.entryId === null ? Promise.resolve(null) : findEntryById(admin, userId, request.entryId),
        readScholarClosedAt(admin, userId),
      ]),
  );
  const window = dayWindow(new Date(now), profile.timezone);
  const messagesToday = usageRows.find((row) => row.day === window.day)?.messages ?? 0;

  // 4. Replay.
  if (answer !== null && message !== null) {
    return await replay({ admin, userId, request, profile, window, messagesToday }, context);
  }

  // 7 (what it will be). The conversation this message belongs to: the one with this id, else the person's conversation about
  // this reflection, else a new one. Another person's conversation or reflection and a missing one look the same.
  let existing: ConversationRow | null = byId;
  if (byId !== null) {
    if (request.entryId !== null && byId.entry_id !== request.entryId) {
      throw new AppError("INVALID_REQUEST", "entry_mismatch");
    }
  } else if (request.entryId !== null) {
    if (entry === null || entry.processing_status !== "ready" || entry.devotional_script === null) {
      throw new AppError("NOT_FOUND", "entry_not_found");
    }
    existing = byEntry;
  }
  const conversationId = existing?.id ?? request.conversationId;
  if (message !== null) {
    if (message.role !== "user") throw new AppError("INVALID_REQUEST", "message_role");
    if (message.conversation_id !== conversationId) throw new AppError("INVALID_REQUEST", "message_conversation");
    if (message.input_type !== request.input.type) throw new AppError("INVALID_REQUEST", "message_input");
  }
  const heavyBefore = existing !== null ? existing.is_heavy : request.entryId !== null && entry?.is_crisis === true;

  // 5. The switch. Off: nothing is answered but a heavy conversation and a message the phrase list matches, which get the written
  // fallback. A spoken message's recording is left for a retry.
  if (!config.enabled) {
    const known = request.input.type === "text" ? request.input.text : message === null ? null : wordsOf(message);
    if (!heavyBefore && !(known !== null && matchCrisisGroup(known) !== null)) {
      throw new AppError("SCHOLAR_UNAVAILABLE", "scholar:off");
    }
  }

  // 6. Rate limit: the only limit in front of the screening.
  if (recent >= SCHOLAR_LIMITS.rateMax) throw new AppError("RATE_LIMITED", "rate_limited");

  // 7. The conversation.
  let conversation = existing;
  if (conversation === null) {
    const fromEntry = request.entryId !== null ? entry : null;
    const made = await db(() =>
      insertConversation(admin, {
        id: request.conversationId,
        user_id: userId,
        entry_id: fromEntry?.id ?? null,
        title: fromEntry !== null && !fromEntry.is_crisis ? titleOf(fromEntry) : null,
        is_heavy: fromEntry?.is_crisis === true,
      })
    );
    if ("refused" in made) {
      if (made.refused === "missing") throw new AppError("NOT_FOUND", "entry_gone");
      // Made at the same moment by another request of this person's, or an id another person has.
      const entryId = request.entryId;
      conversation = await db(() => findConversation(admin, userId, request.conversationId)) ??
        (entryId === null ? null : await db(() => findConversationForEntry(admin, userId, entryId)));
      if (conversation === null) throw new AppError("NOT_FOUND", "conversation_taken");
      if (entryId !== null && conversation.entry_id !== entryId) {
        throw new AppError("INVALID_REQUEST", "entry_mismatch");
      }
    } else {
      conversation = made;
    }
  }
  const resolved: ConversationRow = conversation;
  const reflectionId = resolved.entry_id;
  const [turnHistory, reflection] = await db(() =>
    Promise.all([
      resolved.id === request.conversationId
        ? Promise.resolve(history)
        : listHistory(admin, userId, resolved.id, WRITER_CONTEXT.messages + 1),
      reflectionId === null
        ? Promise.resolve(null)
        : entry !== null && entry.id === reflectionId
        ? Promise.resolve(entry)
        : findEntryById(admin, userId, reflectionId),
    ])
  );

  // 8. Claim the message.
  const claimed = await claim(admin, userId, request, resolved.id, message, db);
  const turn: Turn = {
    admin,
    userId,
    request,
    config,
    profile,
    window,
    messagesToday,
    freeAnswered,
    utcDay: new Date(now).toISOString().slice(0, 10),
    conversation: resolved,
    reflection,
    history: turnHistory.filter((row) => row.id !== request.messageId).slice(-WRITER_CONTEXT.messages),
    message: claimed,
    requestDeadline: context.startedAt +
      (request.input.type === "text" ? scholarTiming.requestTyped : scholarTiming.requestSpoken),
    closed: closedAt !== null,
  };
  context.after.unshift(() => runCounters(admin, turn.utcDay, context.counters));
  try {
    return await answerMessage(turn, context);
  } catch (error) {
    // The message is released with the code the person was told (a spoken one keeps its words), so it can be sent again.
    const code = error instanceof AppError ? error.code : "INTERNAL";
    await quietly(db(() => failMessage(admin, userId, request.messageId, code)));
    throw error;
  }
}

async function claim(
  admin: SupabaseClient,
  userId: string,
  request: TurnRequest,
  conversationId: string,
  message: MessageRow | null,
  db: <T>(work: () => Promise<T>) => Promise<T>,
): Promise<MessageRow> {
  const nowIso = new Date().toISOString();
  const typed = request.input.type === "text" ? textContent(request.input.text) : null;
  if (message === null) {
    const made = await db(() =>
      insertMessage(admin, {
        id: request.messageId,
        conversation_id: conversationId,
        user_id: userId,
        role: "user",
        reply_to: null,
        input_type: request.input.type,
        status: "pending",
        error_code: null,
        content: typed,
        is_heavy: false,
        claimed_at: nowIso,
      })
    );
    if (!("refused" in made)) return made;
    if (made.refused === "missing") throw new AppError("NOT_FOUND", "conversation_gone");
    const own = await db(() => findMessage(admin, userId, request.messageId));
    throw own !== null
      ? new AppError("ALREADY_PROCESSING", "message_busy")
      : new AppError("NOT_FOUND", "message_taken");
  }
  const claimedAt = message.claimed_at === null ? NaN : Date.parse(message.claimed_at);
  if (message.status === "pending" && Number.isFinite(claimedAt) && Date.now() - claimedAt < SCHOLAR_CLAIM_LEASE_MS) {
    throw new AppError("ALREADY_PROCESSING", "message_busy");
  }
  const staleBefore = new Date(Date.now() - SCHOLAR_CLAIM_LEASE_MS).toISOString();
  const reclaimed = await db(() =>
    reclaimMessage(
      admin,
      userId,
      request.messageId,
      { status: message.status, staleBefore: message.status === "pending" ? staleBefore : null },
      { claimed_at: nowIso, created_at: nowIso, ...(typed !== null ? { content: typed } : {}) },
    )
  );
  if (reclaimed === null) throw new AppError("ALREADY_PROCESSING", "message_busy");
  return reclaimed;
}

// 16. The anonymous counters of one UTC day, after the response. Each one alone: one that fails is not retried.
async function runCounters(admin: SupabaseClient, day: string, counters: readonly SafetyCounter[]): Promise<void> {
  for (const counter of counters) await quietly(bumpSafety(admin, day, counter));
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    inputType: null,
    screenStats: newStats(),
    writerStats: newStats(),
    model: null,
    authMs: 0,
    dbMs: 0,
    bibleMs: 0,
    screen: null,
    screenMs: 0,
    crisisSource: null,
    limit: null,
    limitUsed: null,
    billing: null,
    billingMs: 0,
    outcome: null,
    counters: [],
    after: [],
  };
  let status = 200;
  let failure: AppError | null = null;
  try {
    if (req.method === "OPTIONS") {
      status = 204;
      return preflightResponse();
    }
    const response = await run(req, context);
    status = response.status;
    return response;
  } catch (error) {
    failure = error instanceof AppError
      ? error
      : new AppError("INTERNAL", `unhandled:${error instanceof Error ? error.name : "unknown"}`);
    status = failure.status;
    return errorResponse(failure, context.requestId, corsHeaders);
  } finally {
    if (context.after.length > 0) {
      const work = context.after.splice(0);
      runInBackground((async () => {
        for (const task of work) await quietly(task());
      })());
    }
    const { screenStats: screen, writerStats: writer } = context;
    const called = screen.attempts + writer.attempts > 0;
    writeLog(blankLogLine({
      requestId: context.requestId,
      status,
      code: failure?.code ?? null,
      reason: failure?.reason ?? context.outcome,
      inputType: context.inputType,
      user: context.userHash,
      authMs: context.authMs,
      dbMs: context.dbMs,
      geminiMs: screen.ms + writer.ms,
      totalMs: Date.now() - context.startedAt,
      attempts: screen.attempts + writer.attempts,
      fallbackAttempts: screen.fallbackAttempts + writer.fallbackAttempts,
      model: context.model,
      promptVersion: SCHOLAR_PROMPT_VERSION,
      tokensIn: called ? screen.usage.input + writer.usage.input : null,
      tokensOut: called ? screen.usage.output + writer.usage.output : null,
      tokensThought: called ? screen.usage.thought + writer.usage.thought : null,
      bibleMs: context.bibleMs,
      screen: context.screen,
      screenMs: context.screenMs,
      screenAttempts: screen.attempts,
      crisisSource: context.crisisSource,
      limit: context.limit,
      limitUsed: context.limitUsed,
      billing: context.billing,
      billingMs: context.billingMs,
    }));
  }
}
