import { isUsfmBookId } from "../bible/books.ts";
import type { ScriptureRef } from "../bible/reference.ts";
import { SCRIPTURE_NUMBER_LIMITS } from "../../process-entry/constants.ts";
import {
  countWords,
  curlyApostrophes,
  finishSentence,
  OutputInvalid,
  removeAmen,
  singleLine,
  stripMarkup,
  tidyParagraphs,
} from "../../process-entry/output.ts";
import {
  correctionNote,
  echoProblem,
  firstHeavyNeverSay,
  firstNeverSay,
  hasQuotation,
  leaksPrivate,
  prayerPetitions,
  type PrayerVoice,
  prayerVoice,
  privateWords,
} from "../../process-entry/tone.ts";
import type { HelpKind } from "../../process-entry/contracts.ts";
import { ANSWER_WORDS, HEAVY_ANSWER_WORDS, PRAYER_WORDS, REPEAT_RUN, TITLE_LIMITS } from "./constants.ts";
import {
  type HardPassageKey,
  isHardPassageKey,
  type PlainNaming,
  plainNamingPhrases,
  STOCK_PHRASES,
} from "./heavyChat.ts";

// Reads, cleans and checks one Scholar reply (step 38). The schema guarantees the shape, not the meaning: everything is checked
// again here, and nothing is truncated (a reply out of range is asked for again; gemini.ts makes the one more attempt).
//
//   shape and lengths              every reply                    asked again once, with no note
//   the reflection's never-say     the reply and the prayer       asked again once, with a note
//   an echo that is not the        an everyday reply              asked again once, with a note
//     person's newest words
//   any quotation, the heavy list  a heavy reply and its prayer   asked again once, with a note; then the written fallback
//   naming it beyond what the      a heavy reply and its prayer   the same (scholar-v2)
//     <heavy_moment> block allows
//   to someone being hurt: an      a heavy reply and its prayer   the same (scholar-v2)
//     instruction to leave, stay
//     or act at a set time, or
//     not to be afraid
//   a stock phrase used before,    a heavy reply                  asked again once, with a note; then kept as it is (a soft
//     a run of words shared with                                    check: scholar-v2)
//     an earlier answer, a length
//     outside 40 to 120 words
//   a private word in the title    the title                      the title is dropped
//
// A typed verse is found after the passages are read (passages.ts), and the handler asks once more for it. A correction note
// names the rule and never a word of the person's (output_test.ts keeps it so). An everyday reply that flags itself heavy is not
// checked at all: the handler discards it and the heavy model writes the answer again.

// One answer, as it will be saved and shown. The prayer has no "Amen": the app adds it.
export type ScholarAnswer = {
  // The writer's own flag (the third layer). In a heavy writer's reply it changes nothing: the answer is heavy anyway.
  isHeavy: boolean;
  title: string | null;
  reply: string;
  leadPassage: ScriptureRef | null;
  passage: ScriptureRef | null;
  // A heavy answer's passage (scholar-v2): its key on the hard-moment list, or null. Whether the conversation may still show it
  // is the handler's to decide (heavyChat.ts allowedPassageKeys).
  passageKey: HardPassageKey | null;
  prayer: string | null;
  // The person said they are under 18 (scholar-v2): Scholar closes for the account after this answer.
  saysUnder18: boolean;
};

export type ParsedScholarReply = { kind: "flagged" } | ({ kind: "answer" } & ScholarAnswer);

export type ScholarParseContext = {
  // Written under the heavy rules (the heavy model's call): no quotation, the heavy list, and the reply is used even if it does
  // not flag itself.
  heavy: boolean;
  // The person's newest message (their typed words or the screening's transcript): the one echo may come only from it.
  message: string;
  // Whether the turn asked for a title. When it did not, any title is dropped.
  askTitle: boolean;
  // The person's words a title must not use (privateWords): their messages in this conversation.
  privateSource: string;
  // scholar-v2, a heavy reply only. The conversation's help line (abuse adds its own checks), how plainly it may be named this
  // turn, and the text of Scholar's earlier answers in this conversation (a stock phrase, or a run of words, said twice).
  help?: HelpKind;
  plainNaming?: PlainNaming;
  earlier?: readonly string[];
};

function fail(reason: string, note?: string): never {
  throw new OutputInvalid(reason, { note: note ?? null });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

const clean = (text: string) => curlyApostrophes(stripMarkup(text));

// A passage is extra: one that does not have the shape of one is left out, never asked for again (and one that does not exist
// in the Bible is left out by passages.ts).
function readPassage(value: unknown): ScriptureRef | null {
  if (!isRecord(value)) return null;
  const { book_id, chapter, verse_start, verse_end } = value;
  if (!isUsfmBookId(book_id)) return null;
  if (!isCount(chapter, 1, SCRIPTURE_NUMBER_LIMITS.chapter)) return null;
  if (!isCount(verse_start, 1, SCRIPTURE_NUMBER_LIMITS.verse)) return null;
  if (!isCount(verse_end, verse_start, SCRIPTURE_NUMBER_LIMITS.verse)) return null;
  return { bookId: book_id, chapter, verseStart: verse_start, verseEnd: verse_end };
}

const samePassage = (a: ScriptureRef, b: ScriptureRef) =>
  a.bookId === b.bookId && a.chapter === b.chapter && a.verseStart === b.verseStart && a.verseEnd === b.verseEnd;

// A title is cosmetic: one that is missing, out of range, private or never-say is dropped, never asked for again.
function readTitle(value: unknown, context: ScholarParseContext): string | null {
  if (!context.askTitle || typeof value !== "string") return null;
  const title = singleLine(clean(value)).replace(/[.!?…:;,]+$/, "").trim();
  const words = countWords(title);
  if (words < TITLE_LIMITS.minWords || words > TITLE_LIMITS.maxWords || title.length > TITLE_LIMITS.maxChars) {
    return null;
  }
  if (leaksPrivate(title, privateWords(context.privateSource))) return null;
  if (firstNeverSay(title) !== null || firstHeavyNeverSay(title) !== null) return null;
  return title;
}

// The notes of the checks this module owns. Each names a rule and never a word of the person's.
const NOTE_ECHO =
  "Your last reply put words in quotation marks that are not a short phrase from the person’s newest message. Write the whole reply again: quote only a phrase they just wrote, at most eight words, once, or quote nothing, and never put Bible words in quotation marks.";
const NOTE_HEAVY_QUOTE =
  "This is a heavy moment, and your last reply quoted words. Write the whole reply again with no quotation marks at all, in the reply or the prayer, and never repeat what they wrote about dying or harm, by “A heavy moment”.";
const NOTE_NAMING =
  "This is a heavy moment, and your last reply named it more plainly than the <heavy_moment> block allows. Write the whole reply again and speak of it only as the block allows, by “A heavy moment”.";
const NOTE_HURT_INSTRUCTION =
  "Someone may be hurting this person, and your last reply told them to leave, to stay or to act at a particular time. Write the whole reply again: say their fear is reasonable and point them to the advocates at the help line under the message, by “A heavy moment”.";
const NOTE_HURT_FEAR =
  "Someone may be hurting this person, and your last reply told them not to be afraid. Their fear is protecting them. Write the whole reply again without it, by “A heavy moment”.";
const NOTE_STOCK =
  "Your last reply used a phrase this conversation has already had. Write the whole reply again, saying it in fresh, plain words, by “A heavy moment”.";
const NOTE_REPEAT =
  "Your last reply repeated words from an earlier answer in this conversation. Do not repeat it: answer what they ask now, in fresh words and more briefly, by “A heavy moment”.";
const NOTE_LENGTH =
  "Your last reply was not 50 to 110 words. Write the whole reply again in two or three short paragraphs, by “A heavy moment”.";

// ---- The scholar-v2 checks of a heavy reply -----------------------------------------------------------------------------------

// Lowercase, one apostrophe, one space: the shape the phrase checks compare.
function flat(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

// Naming it plainly, in any of the ways the heavy rules keep for the one allowed phrase: ending or taking a life.
const NAMED =
  /\b(?:end(?:s|ed|ing)?|tak(?:e|es|ing)|took)\s+(?:your|my|their|his|her|one's)\s+(?:own\s+)?li(?:fe|ves)\b/gi;

// The heavy list (tone.ts) and plain naming, with the one phrase the block allows taken out once, from the reply only: a second
// use, any other way of naming it, or any use in the prayer, fails.
function namingProblem(reply: string, prayer: string | null, allowed: PlainNaming): string | null {
  let text = flat(reply);
  for (const phrase of plainNamingPhrases(allowed)) {
    const at = text.indexOf(phrase);
    if (at >= 0) {
      text = `${text.slice(0, at)} ${text.slice(at + phrase.length)}`;
      break;
    }
  }
  for (const part of prayer === null ? [text] : [text, flat(prayer)]) {
    const said = firstHeavyNeverSay(part);
    if (said !== null) return `heavy_never_say:${said}`;
    NAMED.lastIndex = 0;
    if (NAMED.test(part)) return "heavy_naming";
  }
  return null;
}

// What an answer to someone being hurt never says (the readers' rule 9): an instruction to leave, to stay or to act at a set time,
// and not to be afraid. "Stay safe" and "stay close" are not an instruction to stay with anyone.
const HURT_INSTRUCTION = new RegExp(
  [
    String
      .raw`\b(?:you\s+(?:should|need\s+to|must|have\s+to|ought\s+to|could)|please|try\s+to|go\s+ahead\s+and)\s+(?:leave|get\s+out|move\s+out|go\s+back|stay(?!\s+(?:safe|close|connected|in\s+touch|with\s+me))|return|pack|run)\b`,
    String
      .raw`(?:^|[.!?]\s+|\n)(?:leave|get\s+out|move\s+out|go\s+back|stay(?!\s+(?:safe|close|connected|in\s+touch|with\s+me))|return|pack|run)\b`,
    String
      .raw`\bwhile\s+(?:he|she|they)(?:\s+(?:is|are|was|were)|'(?:s|re))?\s+(?:asleep|sleeping|out|away|gone|at\s+work)\b`,
    String.raw`\bbefore\s+(?:he|she|they)\s+(?:wakes?|comes?\s+(?:back|home)|gets?\s+(?:back|home)|returns?)\b`,
  ].join("|"),
  "i",
);
const NOT_AFRAID =
  /\b(?:do\s+not|don't|never)\s+(?:be\s+)?(?:afraid|fear|scared)\b|\bfear\s+not\b|\bhave\s+no\s+fear\b/i;

export function hurtProblem(texts: readonly string[]): "hurt_instruction" | "hurt_not_afraid" | null {
  for (const text of texts.map(flat)) {
    if (HURT_INSTRUCTION.test(text)) return "hurt_instruction";
    if (NOT_AFRAID.test(text)) return "hurt_not_afraid";
  }
  return null;
}

// A stock phrase that this answer and the earlier ones use more than once in all.
export function repeatedStock(text: string, earlier: readonly string[]): string | null {
  const all = [text, ...earlier].map(flat);
  for (const phrase of STOCK_PHRASES) {
    const count = all.reduce((sum, part) => sum + part.split(phrase).length - 1, 0);
    if (count > 1) return phrase;
  }
  return null;
}

// Words, lowercased, with punctuation set aside (an apostrophe inside a word is kept, in one shape).
function tokens(text: string): string[] {
  return flat(text).match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

// Pointing to the help line is the same words every time on purpose, so runs inside these are not counted as repeats.
const SHARED_WAYS = [
  "call or text the line under this message",
  "the line under this message",
  "call or text",
  // The help line by its name or number, as the <heavy_moment> block names it (heavyChat.ts helpLineWords).
  "the 988 suicide crisis lifeline",
  "the national domestic violence hotline",
  "988",
  "911",
  "lifeline",
  "hotline",
  "local emergency number",
  "help line",
];

function runs(text: string, size: number): Set<string> {
  const words = tokens(text);
  const shared = new Array(words.length).fill(false);
  for (const way of SHARED_WAYS.map((phrase) => phrase.split(" "))) {
    for (let start = 0; start + way.length <= words.length; start += 1) {
      if (way.every((word, index) => words[start + index] === word)) {
        for (let index = 0; index < way.length; index += 1) shared[start + index] = true;
      }
    }
  }
  const found = new Set<string>();
  for (let start = 0; start + size <= words.length; start += 1) {
    if (shared.slice(start, start + size).some(Boolean)) continue;
    found.add(words.slice(start, start + size).join(" "));
  }
  return found;
}

// True when the answer shares a run of REPEAT_RUN words with any earlier answer of the conversation.
export function repeatsEarlier(text: string, earlier: readonly string[], size = REPEAT_RUN): boolean {
  const mine = runs(text, size);
  return earlier.some((answer) => [...runs(answer, size)].some((run) => mine.has(run)));
}

export function parseScholarReply(text: string, context: ScholarParseContext): ParsedScholarReply {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return fail("json");
  }
  if (!isRecord(data)) fail("shape");
  if (typeof data.is_heavy !== "boolean") fail("is_heavy");
  // The everyday writer flagged its own reply: it is discarded and written again by the heavy model, so it is not checked.
  if (data.is_heavy && !context.heavy) return { kind: "flagged" };

  if (typeof data.reply !== "string") fail("reply_missing");
  const reply = finishSentence(tidyParagraphs(clean(data.reply)));
  const replyWords = countWords(reply);
  if (replyWords < ANSWER_WORDS.min || replyWords > ANSWER_WORDS.max) fail("reply_length");

  let prayer: string | null = null;
  if (data.prayer !== null && data.prayer !== undefined) {
    if (typeof data.prayer !== "string") fail("prayer_shape");
    const cleaned = removeAmen(finishSentence(singleLine(clean(data.prayer))));
    if (cleaned !== "") {
      const prayerWords = countWords(cleaned);
      if (prayerWords < PRAYER_WORDS.min || prayerWords > PRAYER_WORDS.max) fail("prayer_length");
      prayer = cleaned;
    }
  }

  const leadPassage = readPassage(data.lead_passage);
  const supporting = readPassage(data.passage);
  const passage = supporting !== null && leadPassage !== null && samePassage(supporting, leadPassage)
    ? null
    : supporting;
  const title = context.heavy ? null : readTitle(data.title, context);
  const passageKey = context.heavy && isHardPassageKey(data.passage_key) ? data.passage_key : null;
  const saysUnder18 = data.says_under_18 === true;

  const spoken = prayer === null ? [reply] : [reply, prayer];
  for (const part of spoken) {
    const said = firstNeverSay(part);
    if (said !== null) fail(`never_say:${said}`, correctionNote(`never_say:${said}`, []) ?? undefined);
  }
  const answer: ParsedScholarReply = {
    kind: "answer",
    isHeavy: data.is_heavy || context.heavy,
    title,
    reply,
    // A heavy answer has no lead passage and names its one passage by key (scholar-v2).
    leadPassage: context.heavy ? null : leadPassage,
    passage: context.heavy ? null : passage,
    passageKey,
    prayer,
    saysUnder18,
  };
  if (context.heavy) {
    if (spoken.some(hasQuotation)) fail("heavy_quote", NOTE_HEAVY_QUOTE);
    const naming = namingProblem(reply, prayer, context.plainNaming ?? null);
    if (naming === "heavy_naming") fail(naming, NOTE_NAMING);
    if (naming !== null) {
      // "Dying" also catches the word suicide, which the block may have allowed once: the note then says what the block allows.
      const note = naming === "heavy_never_say:dying" && (context.plainNaming ?? null) !== null
        ? NOTE_NAMING
        : correctionNote(naming, []) ?? undefined;
      fail(naming, note);
    }
    if (context.help === "abuse") {
      const hurt = hurtProblem(spoken);
      if (hurt !== null) fail(hurt, hurt === "hurt_instruction" ? NOTE_HURT_INSTRUCTION : NOTE_HURT_FEAR);
    }
    // The soft checks: a reply that only fails one of these is asked for again, and kept when no better one comes.
    const earlier = context.earlier ?? [];
    const soft = (reason: string, note: string): never => {
      throw new OutputInvalid(reason, { note, salvage: answer });
    };
    if (repeatedStock(spoken.join("\n"), earlier) !== null) soft("heavy_stock", NOTE_STOCK);
    if (repeatsEarlier(spoken.join("\n"), earlier)) soft("heavy_repeat", NOTE_REPEAT);
    if (replyWords < HEAVY_ANSWER_WORDS.min || replyWords > HEAVY_ANSWER_WORDS.max) soft("heavy_length", NOTE_LENGTH);
  } else if (echoProblem(spoken, context.message) !== null) {
    fail("echo_invented", NOTE_ECHO);
  }

  return answer;
}

// ---- Style measures (the evaluation), never a refusal ------------------------------------------------------------------

export type ScholarStyle = {
  replyWords: number;
  prayerWords: number | null;
  prayerVoice: PrayerVoice | null;
  prayerPetitions: number | null;
};

export function scholarStyle(answer: ScholarAnswer, message: string): ScholarStyle {
  return {
    replyWords: countWords(answer.reply),
    prayerWords: answer.prayer === null ? null : countWords(answer.prayer),
    prayerVoice: answer.prayer === null ? null : prayerVoice(answer.prayer, message),
    prayerPetitions: answer.prayer === null ? null : prayerPetitions(answer.prayer),
  };
}
