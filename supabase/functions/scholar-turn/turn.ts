import type { SupabaseClient } from "@supabase/supabase-js";

import { confirmPaidPlan } from "../_shared/billing/expiry.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { AppError } from "../_shared/errors.ts";
import { type DayWindow, dayWindow } from "../_shared/limits/weekly.ts";
import type { BillingStatus, CrisisSource, LimitStatus, LogLine, ScreenStatus } from "../_shared/log.ts";
import { helpFromPhraseGroup, isHelpKind, type Region } from "../_shared/safety/helpKind.ts";
import { matchCrisisGroup } from "../_shared/safety/phrases.ts";
import type { ScreenInput } from "../_shared/safety/screen.ts";
import { type ChatContextMessage, confirmEmergency, screenTurn } from "../_shared/safety/screenTurn.ts";
import {
  ANSWER_MAX_OUTPUT_TOKENS,
  HEAVY_THINKING_LEVEL,
  SCHOLAR_CLAIM_LEASE_MS,
  SCHOLAR_LIMITS,
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
  spokenFallback,
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
import { countTalkTurns } from "../_shared/voice/allowance.ts";
import {
  VOICE_PRAYER_WORDS,
  VOICE_SESSION_TTL_MS,
  VOICE_WRITER_THINKING,
  voiceTiming,
} from "../_shared/voice/constants.ts";
import { listSessionsSince } from "../_shared/voice/sessions.ts";
import { findEntryById } from "../confirm-scripture/lifecycle.ts";
import { downloadRecording } from "../process-entry/audio.ts";
import type { HelpKind, ScholarInput, ScholarMessage, ScholarTurnResponse } from "../process-entry/contracts.ts";
import {
  GeminiBlocked,
  type GeminiStats,
  generate,
  newStats,
  timing as transportTiming,
} from "../process-entry/gemini.ts";
import { ensureProfile, type EntryRow, readProfile, type StoredProfile } from "../process-entry/lifecycle.ts";
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
  listSpokenTimes,
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
import { blocksOf, toScholarConversation, toScholarMessage, wordsOf } from "./response.ts";

// Scholar's engine (step 38; its own file since step 39): one message of a Scholar conversation and its answer, whoever sends it.
// scholar-turn calls runTurn for a typed or recorded message, and scholar-voice-llm for a turn of a live talk. The order is fixed,
// and it is what keeps a person safe: one read of everything the request needs; a replay; the switch; the rate limit; the
// conversation; the claim of the message; the screening (with a typed message's everyday answer written at the same time and
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
// A live talk (step 39): `talk` is null for a typed or recorded message. For a turn of a talk it changes exactly five things, each
// marked "talk:" below. (1) The message is stored as a spoken one with its words at once: there is no recording. (2) The rate
// limit, the day's allowance, the free budget and the plan re-read are skipped (the plan and the month's time were checked when
// the talk started), and nothing is added to the day's count. (3) The everyday writer's turn carries the <spoken> block and ends
// by the talk's answerDeadlineAt. (4) The request's deadline is the talk's heavyDeadlineAt, and the heavy block and the written
// answers take their spoken forms. (5) A turn that another request is already answering is waited for, never refused with
// ALREADY_PROCESSING. And one thing the caller may ask for (`refuse`): a turn past the talk's cap, or after voice was switched
// off, is still screened, and only when the screening calls it clear is it released unanswered, with its words kept. So a
// hard moment is answered whatever the cap or the switch, as a typed message's limit comes only after a clear screening.
//
// The caller owns the request itself: who is asking (the user id it verified), the log line and the response. What it shares with
// the engine is the context below: the numbers of the log line, and the work that runs after the response.

const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const DAY_MS = 86_400_000;

export type TurnContext = {
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
  // Whether the conversation is heavy as far as this request knows: it was heavy before, this turn was flagged, or the turn
  // ended in a written answer. A live talk's caller reads it when the turn has no answer, to choose what the person hears.
  heavy: boolean;
  // A live talk only: this request waited for a turn that another request was already answering.
  joined: boolean;
  // The anonymous counters this request adds to, and the work that runs after the response whatever it was.
  counters: SafetyCounter[];
  after: (() => Promise<unknown>)[];
};

export function newTurnContext(): TurnContext {
  return {
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
    heavy: false,
    joined: false,
    counters: [],
    after: [],
  };
}

export async function timed<T>(context: TurnContext, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

type EdgeRuntimeLike = { waitUntil?: (promise: Promise<unknown>) => void };

export function runInBackground(work: Promise<unknown>): void {
  const guarded = work.catch(() => undefined);
  (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime?.waitUntil?.(guarded);
}

export const quietly = (work: Promise<unknown>) => work.then(() => undefined, () => undefined);

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
  // A turn of a live talk (step 39), or null for a typed or recorded message.
  talk: TalkTurn | null;
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

async function answerMessage(turn: Turn, context: TurnContext): Promise<ScholarTurnResponse> {
  const { admin, userId, request, config, talk } = turn;
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const messageId = request.messageId;
  const heavyBefore = turn.conversation.is_heavy;
  context.heavy = heavyBefore;
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
    // talk: a written answer is said, not shown. Its spoken form is what is saved, so the conversation holds what was heard.
    const reply = talk === null ? written.reply : spokenFallback(written.reply);
    return { kind: "fallback", why, variant, help, reply, cards };
  };

  // Marks this message and its conversation heavy (and clears the conversation's title) before any of the answer is written.
  const flag = async (counter: SafetyCounter, help: HelpKind) => {
    state.flaggedBy = counter;
    state.help = help;
    context.heavy = true;
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
        // talk: the everyday writer thinks as little as it can, so the answer is ready about when the screening clears it
        // (voice/constants.ts VOICE_WRITER_THINKING), unless the person asks Scholar to pray (VOICE_PRAYER_WORDS: a prayer is
        // written at the request's own level). A second attempt, on the heavy model, keeps the request's own level.
        thinkingLevel: talk === null || VOICE_PRAYER_WORDS.test(message) ? config.thinkingLevel : VOICE_WRITER_THINKING,
        fallbackThinkingLevel: config.thinkingLevel,
        system: buildScholarInstruction(),
        input: {
          kind: "text",
          text: buildScholarTurn({
            reflection,
            history,
            message,
            askTitle,
            heavyBlock: null,
            correction,
            // talk: the answer is read aloud (the <spoken> block), with a recap after a stop.
            spoken: talk !== null,
            resumed: talk?.resumed === true,
          }),
        },
        // talk: the fields carry the spoken descriptions (prompt.ts, spoken-v4).
        schema: buildScholarSchema({ heavy: false, spoken: talk !== null }),
        // talk: an everyday answer has the talk's own time. Past answerDeadlineAt the person hears the not-ready line.
        deadlineAt: talk === null
          ? Math.min(turn.requestDeadline, Date.now() + scholarTiming.answer.totalMs)
          : Math.min(turn.requestDeadline, talk.answerDeadlineAt),
        attemptTimeoutMs: talk === null ? scholarTiming.answer.attemptMs : voiceTiming.answer.attemptMs,
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
    // talk: a talk's turn has no day's allowance and no free budget to look at; one the caller will not answer (refuse) gets
    // no early answer either.
    const early = screenInput.kind === "text" && !config.screenFirst && !heavyBefore && !phrase && !turn.closed &&
        (talk !== null ? talk.refuse === null : (storedAllowance.kind === "ok" && storedBudget))
      ? settle(writeEveryday(screenInput.text, null))
      : null;

    const screenStarted = Date.now();
    const screenContext = chatContext(turn.history);
    const screenConfig = {
      apiKey: config.apiKey,
      model: config.screeningModel,
      fallbackModel: config.heavyModel,
      thinkingLevel: config.thinkingLevel,
      // talk: in a conversation that is clear so far the screening has an everyday answer's time (past it the person has heard
      // the not-ready line). A heavy conversation, and a turn the phrase list matched, keep the request's whole time.
      deadlineAt: talk !== null && !heavyBefore && !phrase
        ? Math.min(turn.requestDeadline, talk.answerDeadlineAt)
        : turn.requestDeadline,
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
      // 13. Clear: the plan (a paid row whose end date has passed is read again), the day's allowance, the free budget. talk: a
      // talk's turn skips all three (its plan and its time were checked when the talk started).
      if (talk === null) {
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
      } else if (talk.refuse === "cap") {
        // talk: the talk's own cap, as the day's limit above: only after a clear screening, and the turn keeps its words.
        throw new AppError("LIMIT_REACHED", "voice:cap");
      } else if (talk.refuse === "off") {
        throw new AppError("SCHOLAR_UNAVAILABLE", "voice:off");
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
        // talk: a turn right after a stop shows no reading (SPOKEN_RESUME asks for none, and one the model names anyway is
        // dropped): the reading came before the answer the person stopped, and reading it again would bury the recap. And a
        // talk never reads a supporting passage after the answer (spoken-v3 asks for none; spoken-v4 drops one named anyway), so
        // the answer's last sentence is the last thing heard.
        const noReading = talk?.resumed === true;
        const cards = await resolvePassages(
          {
            lead: noReading ? null : settled.value.leadPassage,
            support: noReading || talk !== null ? null : settled.value.passage,
          },
          { heavy: false },
        );
        context.bibleMs += cards.bibleMs;
        const typed = await findTypedVerse(spokenTexts(settled.value), cardsOf(cards));
        // talk: asking again needs time for a whole attempt before the answer's last moment. Without it the reply is kept.
        const noTimeToAsk = talk !== null && talk.answerDeadlineAt - Date.now() < transportTiming.minAttemptMs;
        if (!typed || round === 1 || noTimeToAsk) {
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
          // talk: the help line is on the screen and read aloud after the answer.
          spoken: talk !== null,
        });
        const writeHeavy = (correction: string | null) =>
          generate<ParsedScholarReply>({
            apiKey: config.apiKey,
            model: config.heavyModel,
            thinkingLevel: HEAVY_THINKING_LEVEL,
            // scholar-v2's instruction, the one the readers approved: the welcome additions are for everyday answers.
            system: buildScholarInstruction({ heavy: true }),
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
    // A welcome (scholar-v3): the app shows the situations' chips under it.
    ...(done.kind === "answer" && !heavy && done.answer.welcome ? { welcome: true as const } : {}),
  };

  // talk: the person hears the answer now, while it is saved (TalkTurn.onReady). It has passed its screening and every check.
  talk?.onReady?.({ blocks: blocksOf({ content }), helpLine: carriesHelp ? content.help ?? "crisis" : null });

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
  context.heavy = heavy;
  if (heavy) {
    context.limit = "exempt";
    context.limitUsed = null;
  } else if (talk === null) {
    // 16 (after the response): the person's day, and the free budget for a free account. talk: a talk's turn counts in neither
    // (a talk has its own time: scholar_voice_sessions).
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
  return body;
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
  turn: Pick<Turn, "admin" | "userId" | "request" | "profile" | "window" | "messagesToday" | "talk">,
  context: TurnContext,
): Promise<ScholarTurnResponse> {
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
  context.heavy = conversation.is_heavy;
  const body: ScholarTurnResponse = {
    conversation: toScholarConversation(conversation),
    message: toScholarMessage(question),
    answer: toScholarMessage(answer),
    // talk: a talk's turn carries no usage (nothing of it is counted in the day).
    usage: conversation.is_heavy || turn.talk !== null
      ? null
      : currentUsage({ tier: turn.profile.tier, messagesToday: turn.messagesToday, window: turn.window }),
  };
  return body;
}

// ---- The turn, up to the claim ---------------------------------------------------------------------------------------------

// One turn of a live talk (step 39), or null for a typed or recorded message. The caller sets the two moments, counted from when
// ElevenLabs asked for the turn: at answerDeadlineAt the writer and the screening of an everyday answer have ended (the person
// then hears the not-ready line), and at heavyDeadlineAt those of a hard-moment answer (the person then hears the written answer).
// `refuse` is null for a turn the caller wants answered. "cap": the talk has reached its own cap or its last turn; "off": voice
// was switched off while the talk ran. Then a turn the screening calls clear is not written: it is released with its words
// (LIMIT_REACHED voice:cap, or SCHOLAR_UNAVAILABLE voice:off) and the caller says its fixed line. A turn in a heavy
// conversation, and one the phrase list or the screening flags, is answered all the same.
export type TalkTurn = {
  talkId: string;
  startedAt: number;
  heavyDeadlineAt: number;
  answerDeadlineAt: number;
  refuse: "cap" | "off" | null;
  // The turn comes right after the person stopped Scholar with a stop word (scholar-voice-llm, readVoiceCall): the everyday
  // writer is told they did not hear all of the last answer (prompt.ts, SPOKEN_RESUME).
  resumed?: boolean;
  // Called once, as soon as the answer has passed its screening and its checks and before it is saved, with what the saved
  // answer will carry, so that the caller can speak it at once. The save is three writes in a row, which the walk-through of
  // 2026-11-14 measured as part of the wait before Scholar spoke. Not called for a replay or a joined turn, nor for a turn that
  // ends in an error before its answer is ready.
  onReady?: (ready: TalkReady) => void;
};

// What a talk's answer carries the moment it is ready: the blocks and the help line its saved message will have.
export type TalkReady = Pick<ScholarMessage, "blocks" | "helpLine">;

export type TurnArgs = {
  admin: SupabaseClient;
  // The caller verified it: a Clerk token (scholar-turn), or a session the server signed (scholar-voice-llm).
  userId: string;
  request: TurnRequest;
  config: ScholarConfig;
  context: TurnContext;
  talk: TalkTurn | null;
};

// Answers the turn's response, or throws the AppError the person is told.
export async function runTurn(args: TurnArgs): Promise<ScholarTurnResponse> {
  const { admin, userId, request, config, context, talk } = args;
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const now = Date.now();
  // talk: a turn of a talk carries its words (the caller has them from ElevenLabs), and is stored as a spoken message.
  if (talk !== null && request.input.type !== "text") throw new AppError("INVALID_REQUEST", "talk_input");
  const storedType = talk === null ? request.input.type : "audio";

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
    return await replay({ admin, userId, request, profile, window, messagesToday, talk }, context);
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
    if (message.input_type !== storedType) throw new AppError("INVALID_REQUEST", "message_input");
  }
  const heavyBefore = existing !== null ? existing.is_heavy : request.entryId !== null && entry?.is_crisis === true;
  context.heavy = heavyBefore;

  // 5. The switch. Off: nothing is answered but a heavy conversation and a message the phrase list matches, which get the written
  // fallback. A spoken message's recording is left for a retry.
  if (!config.enabled) {
    const known = request.input.type === "text" ? request.input.text : message === null ? null : wordsOf(message);
    if (!heavyBefore && !(known !== null && matchCrisisGroup(known) !== null)) {
      throw new AppError("SCHOLAR_UNAVAILABLE", "scholar:off");
    }
  }

  // 6. Rate limit: the only limit in front of the screening. talk: a talk has its own limits (its turns and its time), so
  // its turns are not counted here: not for the talk itself, and not against a typed message that follows it. They are saved
  // as spoken messages, so when the count reaches the limit the ones made while a talk ran are taken out of it. A read that
  // fails takes nothing out.
  if (talk === null && recent >= SCHOLAR_LIMITS.rateMax) {
    const since = now - SCHOLAR_LIMITS.rateWindowMs;
    const talkTurns = await db(async () => {
      const [times, talks] = await Promise.all([
        listSpokenTimes(admin, userId, new Date(since).toISOString(), request.messageId),
        listSessionsSince(admin, userId, new Date(since - VOICE_SESSION_TTL_MS).toISOString()),
      ]);
      return countTalkTurns(times, talks, now);
    }).catch(() => 0);
    if (recent - talkTurns >= SCHOLAR_LIMITS.rateMax) throw new AppError("RATE_LIMITED", "rate_limited");
  }

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

  // 8. Claim the message. talk: a turn that another request is already answering is waited for (joinTurn).
  let claimed: MessageRow;
  let conversationNow = resolved;
  let historyNow = turnHistory;
  try {
    claimed = await claim(admin, userId, request, storedType, resolved.id, message, db);
  } catch (error) {
    if (talk === null || !(error instanceof AppError) || error.code !== "ALREADY_PROCESSING") throw error;
    context.joined = true;
    const joined = await joinTurn(
      { admin, userId, request, profile, window, messagesToday, talk },
      context,
      resolved.id,
    );
    if ("answered" in joined) return joined.answered;
    claimed = joined.claimed;
    // What the other request did meanwhile is read again: the conversation may be heavy now.
    const [again, historyAgain] = await db(() =>
      Promise.all([
        findConversation(admin, userId, resolved.id),
        listHistory(admin, userId, resolved.id, WRITER_CONTEXT.messages + 1),
      ])
    );
    if (again === null) throw new AppError("NOT_FOUND", "conversation_gone");
    conversationNow = again;
    historyNow = historyAgain;
  }
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
    conversation: conversationNow,
    reflection,
    history: historyNow.filter((row) => row.id !== request.messageId).slice(-WRITER_CONTEXT.messages),
    message: claimed,
    // talk: the request ends when a hard-moment answer's time is up.
    requestDeadline: talk !== null
      ? talk.heavyDeadlineAt
      : context.startedAt + (request.input.type === "text" ? scholarTiming.requestTyped : scholarTiming.requestSpoken),
    closed: closedAt !== null,
    talk,
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
  storedType: "text" | "audio",
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
        input_type: storedType,
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 8, for a turn of a live talk that another request is already answering (ElevenLabs asked again for the same turn): this request
// waits for that answer, with a look every voiceTiming.joinPollMs, and replays it. It answers the turn itself when the other
// request gave up. In a conversation that is still clear it stops waiting when an everyday answer's time is up, and leaves the
// message to the other request. In a heavy conversation it waits until a hard-moment answer's time is up and then takes the turn
// over, whatever the other request's claim says: with no time left for a model the engine answers with the written answer, so
// a hard moment never ends in silence. Two answers cannot be saved: a question has at most one (the table's own rule), and
// the request that comes second replays the first one's.
async function joinTurn(
  turn: Pick<Turn, "admin" | "userId" | "request" | "profile" | "window" | "messagesToday"> & { talk: TalkTurn },
  context: TurnContext,
  conversationId: string,
): Promise<{ answered: ScholarTurnResponse } | { claimed: MessageRow }> {
  const { admin, userId, request, talk } = turn;
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const messageId = request.messageId;
  const fields = () => {
    const nowIso = new Date().toISOString();
    return {
      claimed_at: nowIso,
      created_at: nowIso,
      ...(request.input.type === "text" ? { content: textContent(request.input.text) } : {}),
    };
  };
  let forced = false;
  for (;;) {
    const [message, answer] = await db(() =>
      Promise.all([findMessage(admin, userId, messageId), findAnswer(admin, userId, messageId)])
    );
    if (message === null) throw new AppError("NOT_FOUND", "conversation_gone");
    if (answer !== null) return { answered: await replay(turn, context) };
    if (message.status === "failed") {
      // The other request gave up: this one answers the turn.
      const taken = await db(() =>
        reclaimMessage(admin, userId, messageId, { status: "failed", staleBefore: null }, fields())
      );
      if (taken !== null) return { claimed: taken };
    }
    const deadline = context.heavy ? talk.heavyDeadlineAt : talk.answerDeadlineAt;
    if (Date.now() + voiceTiming.joinPollMs < deadline) {
      await sleep(voiceTiming.joinPollMs);
      continue;
    }
    if (!context.heavy) {
      // The other request may have found a hard moment meanwhile: then the wait goes on.
      const conversation = await db(() => findConversation(admin, userId, conversationId));
      if (conversation === null) throw new AppError("NOT_FOUND", "conversation_gone");
      if (!conversation.is_heavy) throw new AppError("AI_UNAVAILABLE", "voice:join_timeout");
      context.heavy = true;
      continue;
    }
    // A hard moment whose answer never came. A claim made a minute from now would be the only one this does not take.
    if (forced) throw new AppError("AI_UNAVAILABLE", "voice:join_lost");
    forced = true;
    const taken = await db(() =>
      reclaimMessage(
        admin,
        userId,
        messageId,
        { status: "pending", staleBefore: new Date(Date.now() + SCHOLAR_CLAIM_LEASE_MS).toISOString() },
        fields(),
      )
    );
    if (taken !== null) return { claimed: taken };
    // Not pending any more: the other request has just answered or given up. One more look says which.
  }
}

// 16. The anonymous counters of one UTC day, after the response. Each one alone: one that fails is not retried.
async function runCounters(admin: SupabaseClient, day: string, counters: readonly SafetyCounter[]): Promise<void> {
  for (const counter of counters) await quietly(bumpSafety(admin, day, counter));
}
// The work that runs after the response, whatever it was (the anonymous counters, a person's day, stray recordings): each task
// alone, in order, and a failure changes nothing. The caller hands it to the runtime (runInBackground).
export async function runAfter(context: TurnContext): Promise<void> {
  const work = context.after.splice(0);
  for (const task of work) await quietly(task());
}

// What the engine adds to the shared log line (43 fields): times, attempts, tokens, and one word each about the screening and the
// limit. Never a message, an answer, an id, a help line or a phrase.
export function turnLogFields(context: TurnContext): Partial<LogLine> {
  const { screenStats: screen, writerStats: writer } = context;
  const called = screen.attempts + writer.attempts > 0;
  return {
    authMs: context.authMs,
    dbMs: context.dbMs,
    geminiMs: screen.ms + writer.ms,
    attempts: screen.attempts + writer.attempts,
    fallbackAttempts: screen.fallbackAttempts + writer.fallbackAttempts,
    model: context.model,
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
  };
}
