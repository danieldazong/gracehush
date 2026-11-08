import { hydrateScripture } from "../_shared/bible/hydrate.ts";
import { formatReference, parseReference, type ScriptureRef } from "../_shared/bible/reference.ts";
import { AppError } from "../_shared/errors.ts";
import { AFFIRMATION_VERSE_MAX_CHARS, SCRIPTURE_NUMBER_LIMITS, TIME_SLOTS } from "./constants.ts";
import { isUsfmBookId } from "../_shared/bible/books.ts";
import type { AffirmationVerse, TimeSlot } from "./contracts.ts";
import { GeminiBlocked, type GeminiStats, generate } from "./gemini.ts";
import { isDeniedPassage } from "./heavy.ts";
import { OutputInvalid, type ReplyAffirmation } from "./output.ts";
import { buildVersesInstruction, buildVersesTurn, type VerseRequest } from "./prompt.ts";
import { buildVersesSchema } from "./schema.ts";

// gen-v2.5 (step 37): each affirmation carries a verse of its own, shown on the lock screen under its headline. The model says
// where the verse is; this turns that into what is stored. The words always come from the Berean Standard Bible (_shared/bible),
// never from the model or from this code, exactly as for the reflection's passage (scripture.ts).
//
// A verse is kept only when every rule holds:
//   one verse          verse_end equals verse_start
//   short              its text, with line breaks read as single spaces, is at most AFFIRMATION_VERSE_MAX_CHARS characters,
//                      so that it reads in full in the four lines a notification shows
//   a whole sentence   it starts with a capital (after any opening quote) and ends with . ! or ? (before any closing quote):
//                      not "‘May the LORD bless you and keep you;" nor "in all your ways acknowledge Him"
//   about God          it holds a name of God or a pronoun the BSB capitalizes for him (speaksOfGod)
//   no order           no sentence of it opens with an imperative (givesAnOrder)
//   its own            not inside the reflection's passage, not another affirmation's verse, and not a passage or verse of
//                      the person's recent reflections
//   for a heavy moment never one heavy.ts denies
//   real               the Bible has it
// The model is asked for a verse in the reflection itself. Every verse that breaks a rule (a verse the reply gave no verse for
// is simply left without one) goes into ONE small follow-up request, which sees the affirmations' headlines, the reasons, the
// references to avoid and the reflection's title and feeling, and never the person's words. A verse that still breaks a rule is
// left out: the affirmation is saved without one, and its notification keeps the older form (the headline alone). A chapter
// that cannot be read right now leaves its verse out too, with no follow-up: another verse would meet the same outage.

export type ResolvedVerses = {
  // One per affirmation, in the order given.
  verses: (AffirmationVerse | null)[];
  // How many were the reply's own, and how many came from the follow-up.
  kept: number;
  replaced: number;
  // Time spent reading the Bible. The follow-up counts as model time, in the stats.
  bibleMs: number;
};

export type VersesArgs = {
  affirmations: readonly ReplyAffirmation[];
  // The reflection's passage as it is stored, or null when it has none.
  passage: ScriptureRef | null;
  // References of the person's recent reflections: their passages and their affirmation verses (lifecycle.ts).
  recent: readonly string[];
  heavy: boolean;
  // What the follow-up is told about the reflection. Never the person's words.
  title: string;
  emotion: string;
  gemini: { apiKey: string; model: string; thinkingLevel: string };
  deadlineAt: number;
  stats: GeminiStats;
};

// The follow-up answers a few numbers, but thinking is counted in this cap: at 1,024 a model that thought longer about the
// rules left no room for the answer, and two follow-ups of the evaluation of 2026-11-08 came back cut off. Only the tokens
// used are billed.
const VERSES_MAX_OUTPUT_TOKENS = 4_096;
// How many verses the follow-up gives for each affirmation, best first: the next is tried when one breaks a rule.
export const VERSE_CANDIDATES = 2;

const START = /^[“‘"']?\p{Lu}/u;
const END = /[.!?][”’"']*$/u;

// The Berean Standard Bible capitalizes every name of God and every pronoun that stands for him ("He", "His", "You", "My"),
// so a verse that holds none of these is about someone else: "I take great joy and encouragement in your love, because you,
// brother, have refreshed the hearts of the saints." (Philemon 1:7, seen in the live check of 2026-11-08). The check is a
// floor, not a judge: a capital at the start of a sentence counts too, so it only refuses a verse with no word for God at all.
const NAMES_GOD =
  /(?<![\p{L}])(?:God|LORD|Lord|Jesus|Christ|Spirit|Father|Almighty|Savior|Redeemer|Holy One|He|His|Him|Himself|You|Your|Yours|Yourself|Me|My|Mine|Myself)(?![\p{L}])/u;

// A verse as one line: a run of whitespace that holds a line break becomes one space, or nothing after an em dash, which the
// BSB closes ("my salvation—whom shall I fear?"). The app's flowVerse does the same.
export function flowText(text: string): string {
  return text.replace(/—\s*\n\s*/g, "—").replace(/\s*\n\s*/g, " ").trim();
}

export function isWholeSentence(text: string): boolean {
  const line = flowText(text);
  return START.test(line) && END.test(line);
}

export function speaksOfGod(text: string): boolean {
  return NAMES_GOD.test(text);
}

// A sentence of the verse that opens with an order: the word right after the start or after a sentence's end is an
// imperative the BSB uses ("Give thanks to the LORD", "Bear with one another", "Do not be afraid or discouraged."). The
// evaluation of 2026-11-08 found these chosen under a headline about God's care, and the instruction already says never a
// command; this keeps one off the lock screen. A floor: an order that opens with another word ("Therefore … clothe
// yourselves") is left to the instruction and the grader.
const COMMAND =
  /(?:^|[.;:!?—]\s*)[“‘"']?(?:Do not|Do|Give|Bear|Put|Trust|Be|Cast|Clothe|Rejoice|Pray|Let|Wait|Come|Seek|Praise|Sing|Fear|Commit|Delight|Take|Taste|Ask|Forgive|Humble|Submit|Rest|Remember|Consider|Keep|Guard|Walk|Hope|Call|Draw|Stand|Turn|Return|Believe|Bless|Exalt|Worship|Shout|Serve|Follow|Abide|Remain|Go|Listen|Hear|Know|Love|Pursue|Set|Lift)(?![\p{L}])/u;

export function givesAnOrder(text: string): boolean {
  return COMMAND.test(flowText(text));
}

function overlaps(a: ScriptureRef, b: ScriptureRef): boolean {
  return a.bookId === b.bookId && a.chapter === b.chapter && a.verseStart <= b.verseEnd && a.verseEnd >= b.verseStart;
}

type Rules = { passage: ScriptureRef | null; recent: readonly ScriptureRef[]; heavy: boolean };

// Why a verse cannot be used before its text is read, in words for the follow-up (built from our own book table), or null.
function refProblem(ref: ScriptureRef, rules: Rules, taken: readonly ScriptureRef[]): string | null {
  const name = formatReference(ref);
  if (ref.verseEnd !== ref.verseStart) return `${name} is more than one verse`;
  if (rules.passage && overlaps(ref, rules.passage)) return `${name} is part of the reflection's passage`;
  if (rules.heavy && isDeniedPassage(ref)) return `${name} is not right for this reflection`;
  if (taken.some((other) => overlaps(ref, other))) return `${name} is already another affirmation's verse`;
  if (rules.recent.some((other) => overlaps(ref, other))) return `${name} was in one of their recent reflections`;
  return null;
}

// Why a verse's text cannot be used, or null.
function textProblem(reference: string, text: string): string | null {
  const length = flowText(text).length;
  if (length > AFFIRMATION_VERSE_MAX_CHARS) {
    return `${reference} is too long to read in full on a lock screen (${length} characters, at most ${AFFIRMATION_VERSE_MAX_CHARS})`;
  }
  if (!isWholeSentence(text)) return `${reference} is not a whole sentence on its own`;
  if (!speaksOfGod(text)) return `${reference} does not speak of God`;
  if (givesAnOrder(text)) return `${reference} tells them what to do; choose a verse that says what God does`;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

// The follow-up's reply: up to VERSE_CANDIDATES verses per time slot, best first, in the order given. An item that does not
// have the shape of a verse is left out (that affirmation may then go without one); a reply that is not the object at all
// is unusable.
export function parseVersePicks(text: string): Map<TimeSlot, ScriptureRef[]> {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new OutputInvalid("verses_json");
  }
  if (!isRecord(data) || !Array.isArray(data.verses)) throw new OutputInvalid("verses_shape");
  const picks = new Map<TimeSlot, ScriptureRef[]>();
  for (const item of data.verses) {
    if (!isRecord(item)) continue;
    const slot = (TIME_SLOTS as readonly string[]).find((candidate) => candidate === item.time_slot) as
      | TimeSlot
      | undefined;
    const { book_id, chapter, verse_start, verse_end } = item;
    if (!slot || (picks.get(slot)?.length ?? 0) >= VERSE_CANDIDATES || !isUsfmBookId(book_id)) continue;
    if (!isCount(chapter, 1, SCRIPTURE_NUMBER_LIMITS.chapter)) continue;
    if (!isCount(verse_start, 1, SCRIPTURE_NUMBER_LIMITS.verse)) continue;
    if (!isCount(verse_end, verse_start, SCRIPTURE_NUMBER_LIMITS.verse)) continue;
    picks.set(slot, [...(picks.get(slot) ?? []), {
      bookId: book_id,
      chapter,
      verseStart: verse_start,
      verseEnd: verse_end,
    }]);
  }
  return picks;
}

export async function resolveAffirmationVerses(args: VersesArgs): Promise<ResolvedVerses> {
  let bibleMs = 0;
  const look = async (ref: ScriptureRef) => {
    const started = Date.now();
    try {
      return await hydrateScripture(ref);
    } finally {
      bibleMs += Date.now() - started;
    }
  };
  const rules: Rules = {
    passage: args.passage,
    recent: args.recent.map(parseReference).filter((ref): ref is ScriptureRef => ref !== null),
    heavy: args.heavy,
  };
  const verses: (AffirmationVerse | null)[] = args.affirmations.map(() => null);
  const taken: ScriptureRef[] = [];
  // The affirmations whose verse must be asked for again, with why and the reference that failed.
  const failed: { index: number; why: string; reference: string }[] = [];

  // One round of verses: the rules that need no text first, in order (so of two equal verses the second fails), then the
  // chapters read together, then the rules on the text. Returns how many were kept.
  const round = async (
    picks: { index: number; ref: ScriptureRef }[],
    onFail: (index: number, why: string, reference: string) => void,
  ) => {
    const pending: { index: number; ref: ScriptureRef }[] = [];
    const claimed = [...taken];
    for (const pick of picks) {
      const why = refProblem(pick.ref, rules, claimed);
      if (why) {
        onFail(pick.index, why, formatReference(pick.ref));
        continue;
      }
      claimed.push(pick.ref);
      pending.push(pick);
    }
    // Chapters are read together, each once: a second verse of a chapter waits for the first read and then finds it cached.
    const reads = new Map<string, Promise<unknown>>();
    const results = await Promise.all(pending.map(async (pick) => {
      const key = `${pick.ref.bookId}/${pick.ref.chapter}`;
      const first = reads.get(key);
      if (first) {
        await first;
        return await look(pick.ref);
      }
      const read = look(pick.ref);
      reads.set(key, read.catch(() => undefined));
      return await read;
    }));
    let kept = 0;
    results.forEach((result, position) => {
      const { index, ref } = pending[position];
      if (result.status === "unavailable") return;
      if (result.status === "invalid") {
        onFail(index, `${result.reference}: ${result.note}`, result.reference);
        return;
      }
      const why = textProblem(result.reference, result.text);
      if (why) {
        onFail(index, why, result.reference);
        return;
      }
      verses[index] = { reference: result.reference, text: result.text };
      taken.push(ref);
      kept += 1;
    });
    return kept;
  };

  const first = args.affirmations.flatMap((item, index) => (item.verse ? [{ index, ref: item.verse }] : []));
  const kept = await round(first, (index, why, reference) => failed.push({ index, why, reference }));
  if (failed.length === 0) return { verses, kept, replaced: 0, bibleMs };

  // One follow-up for every verse that broke a rule, in the time that is left. A blocked request, an unusable reply and a
  // spent time budget all leave those affirmations without a verse.
  const requests: VerseRequest[] = failed.map((item) => ({
    slot: args.affirmations[item.index].slot,
    headline: args.affirmations[item.index].headline,
    why: item.why,
  }));
  const avoid = [
    ...(args.passage ? [formatReference(args.passage)] : []),
    ...taken.map(formatReference),
    ...failed.map((item) => item.reference),
    ...args.recent,
  ];
  let picks: Map<TimeSlot, ScriptureRef[]>;
  try {
    picks = await generate({
      ...args.gemini,
      system: buildVersesInstruction(),
      input: {
        kind: "text",
        text: buildVersesTurn({ requests, avoid, title: args.title, emotion: args.emotion, heavy: args.heavy }),
      },
      schema: buildVersesSchema(),
      deadlineAt: args.deadlineAt,
      validate: parseVersePicks,
      maxAttempts: 1,
      maxOutputTokens: VERSES_MAX_OUTPUT_TOKENS,
    }, args.stats);
  } catch (error) {
    if (error instanceof AppError || error instanceof GeminiBlocked) return { verses, kept, replaced: 0, bibleMs };
    throw error;
  }
  // Each affirmation's first candidate, then the next for those still without a verse. Every candidate meets the same rules,
  // so one that a candidate before it already took is refused.
  let replaced = 0;
  let open = failed.map((item) => item.index);
  for (let candidate = 0; candidate < VERSE_CANDIDATES && open.length > 0; candidate += 1) {
    const tries = open.flatMap((index) => {
      const ref = picks.get(args.affirmations[index].slot)?.[candidate];
      return ref ? [{ index, ref }] : [];
    });
    replaced += await round(tries, () => {});
    open = open.filter((index) => verses[index] === null);
  }
  return { verses, kept, replaced, bibleMs };
}
