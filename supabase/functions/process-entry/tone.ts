import { BSB_BOOKS } from "../_shared/bible/books.ts";
import type { TimeSlot } from "./contracts.ts";

// The pastoral tone's rules that code can check (step 32). Pure: no network, no clock, nothing logged.
//
// Two kinds. HARD checks (output.ts) make a reply unusable, because each one guards a person or the scripture: a phrase from
// the never-say list, a devotional or prayer that points to a Bible passage (the app shows and reads the passage on its own),
// and a name the person wrote in a title or a headline (both reach a lock screen). STYLE measures (styleMeasures) never cost
// a reply: the tone evaluation counts them, and the instruction's wording is what fixes them.

// ---- Never say ---------------------------------------------------------------------------------------------------------

export type NeverSay = {
  id: string;
  // The plain words a correction note quotes. Typographic apostrophes, like everything the app writes.
  label: string;
  pattern: RegExp;
  // A phrase the model may deny ("This is not a punishment for anything you did" is what the instruction asks for): it is
  // not counted when its own sentence has a negation before it.
  negatable: boolean;
};

// Precise phrases, never single words. Case-insensitive, and straight and curly apostrophes both match.
export const NEVER_SAY: readonly NeverSay[] = [
  {
    id: "reason",
    label: "everything happens for a reason",
    pattern: /\b(?:everything|all things|things|this|it)\s+(?:all\s+)?(?:happens?|happened)\s+for\s+a\s+reason\b/gi,
    negatable: true,
  },
  {
    id: "handle",
    label: "God won’t give you more than you can handle",
    pattern:
      /\b(?:won['’]t|will\s+not|wouldn['’]t|would\s+not|doesn['’]t|does\s+not|never)\s+(?:gives?|puts?|hands?|sends?)\s+(?:you|us|anyone|someone|people)\s+(?:anything\s+)?more\s+than\s+(?:you|we|they|one)\s+can\s+(?:handle|bear|take)\b/gi,
    negatable: false,
  },
  {
    id: "just_believe",
    label: "just pray, just trust or just have faith",
    pattern: /\bjust\s+(?:pray(?:ing)?|trust(?:ing)?|believ(?:e|ing)|hav(?:e|ing)\s+(?:more\s+)?faith)\b/gi,
    negatable: false,
  },
  {
    id: "angel",
    label: "a reason why someone died",
    pattern:
      /\bneeded\s+(?:another|one\s+more|an)\s+angel\b|\b(?:called|took|brought|taken)\s+(?:them|him|her|your\s+\p{L}+)\s+home\s+(?:because|so|for|to)\b/giu,
    negatable: true,
  },
  {
    id: "work_out",
    label: "everything will work out",
    pattern:
      /\b(?:everything|it\s+all|all\s+of\s+(?:this|it)|things)(?:\s+(?:will|is\s+going\s+to|are\s+going\s+to|is\s+gonna)|['’]ll)\s+(?:all\s+)?(?:work\s+out|be\s+(?:okay|ok|fine|alright|all\s+right))\b|\bit\s+(?:will|['’]ll|is\s+going\s+to)\s+all\s+(?:work\s+out|be\s+(?:okay|ok|fine|alright|all\s+right))\b/gi,
    negatable: true,
  },
  {
    id: "punishment",
    label: "suffering as a punishment",
    pattern: /\b(?:a\s+punishment\s+for|(?:being|is|are|was|were|be)\s+punished\s+for|god\s+is\s+punishing)\b/gi,
    negatable: true,
  },
];

const NEGATION = /\b(?:not|never|no\s+one|nobody|cannot)\b|n['’]t\b/i;

// The part of the sentence before `index`: from the last sentence end (or the start) up to it.
function clauseBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(...[".", "!", "?", "…", "\n"].map((mark) => before.lastIndexOf(mark)));
  return before.slice(start + 1);
}

// The id of the first never-say phrase in the text (in the order of the list), or null.
export function firstNeverSay(text: string): string | null {
  for (const item of NEVER_SAY) {
    for (const match of text.matchAll(item.pattern)) {
      if (item.negatable && NEGATION.test(clauseBefore(text, match.index ?? 0))) continue;
      return item.id;
    }
  }
  return null;
}

// ---- Verse references --------------------------------------------------------------------------------------------------

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every book's name as the Berean Standard Bible table writes it, without a leading number (that is matched on its own), plus
// "Psalm". Longest first, so "Song of Solomon" wins over a shorter name.
const BOOK_NAMES = [
  ...new Set([...BSB_BOOKS.map((book) => book.name.replace(/^[123] /, "")), "Psalm"]),
].sort((a, b) => b.length - a.length).map((name) => escapeRegex(name).replace(/ /g, "\\s+"));

// A book's name, capitalized as the table writes it, then a space and a number: "Psalm 23", "1 Peter 5:7", "Philippians 4".
// A name alone ("Mark", "Job", "Acts") is not a reference.
const BOOK_WITH_NUMBER = new RegExp(`(?<![\\p{L}\\p{N}])(?:[123]\\s)?(?:${BOOK_NAMES.join("|")})\\s+\\d`, "u");

// Words that point to a passage without naming it.
const POINTERS = new RegExp(
  [
    String.raw`\b(?:this|these|that|today['’]s)\s+(?:verses?|passages?|scriptures?|psalm)\b`,
    String.raw`\bpsalmists?\b`,
    String.raw`\b(?:scripture|the\s+bible|god['’]s\s+word)\s+(?:says|tells\s+us|reminds\s+us|promises)\b`,
    String.raw`\bit\s+is\s+written\b`,
    String.raw`\bverses?\s+\d`,
    `\\bthe\\s+book\\s+of\\s+(?:${BOOK_NAMES.join("|")})\\b`,
  ].join("|"),
  "i",
);

export function hasVerseReference(text: string): boolean {
  return BOOK_WITH_NUMBER.test(text) || POINTERS.test(text);
}

// ---- The person's private words ----------------------------------------------------------------------------------------

// Never private, even capitalized in the middle of a sentence. The words of faith and the pronouns the instruction itself
// uses, the days and the months, a title before a name, and the common short words a person capitalizes for emphasis or in
// the name of a book or a show ("I watched The Chosen"): a title may always say "the".
const NEVER_PRIVATE = new Set([
  // Faith (the step 32 prompt's list, then the other names of God a prayer journal capitalizes).
  ..."god lord father jesus christ holy spirit bible scripture christmas easter".split(" "),
  ..."heavenly almighty savior saviour messiah creator redeemer emmanuel immanuel yahweh jehovah abba trinity".split(
    " ",
  ),
  ..."gospel church amen hallelujah psalm psalms".split(" "),
  // Pronouns.
  ..."he him his she her hers they them their theirs you your yours we us our ours me my mine".split(" "),
  ..."myself yourself himself herself ourselves themselves".split(" "),
  // Days and months.
  ..."monday tuesday wednesday thursday friday saturday sunday".split(" "),
  ..."january february march april may june july august september october november december".split(" "),
  // A title before a name.
  ..."mr mrs ms dr st rev prof sr jr pst".split(" "),
  // Common short words.
  ..."a an the and but or nor so yet for of in on at by to from with without into about after before as if then than"
    .split(" "),
  ..."that this these those there here it its is am are was were be been being do does did have has had will would"
    .split(" "),
  ..."shall should can could might must not no yes oh ok okay very too just really all any some every each more most"
    .split(" "),
  ..."much many only even also still again now today tonight tomorrow yesterday please why what how when where who"
    .split(" "),
  ..."which while because though until up down out off like ever never always".split(" "),
]);

// A title before a name: "Dr. Okafor" does not start a sentence.
const NAME_TITLES = new Set(["mr", "mrs", "ms", "dr", "st", "rev", "prof", "sr", "jr", "pst"]);

type Token = { word: string; initial: boolean };

// The words of a text, each with whether it starts a sentence: the first word, or one after `.`, `!`, `?`, `…` or a line
// break (a closing quote or bracket between them changes nothing).
function tokens(text: string): Token[] {
  const found: Token[] = [];
  let end = 0;
  let previous = "";
  for (const match of text.matchAll(/\p{L}[\p{L}\p{M}'’-]*/gu)) {
    const start = match.index ?? 0;
    const between = text.slice(end, start);
    const afterTitle = NAME_TITLES.has(previous.toLowerCase()) && /^\.\s+$/.test(between);
    const initial = found.length === 0 || (/[.!?…\n]/.test(between) && !afterTitle);
    const word = match[0].replace(/['’-]+$/, "");
    found.push({ word, initial });
    previous = word;
    end = start + match[0].length;
  }
  return found;
}

const apostrophes = (text: string) => text.replace(/'/g, "’");
const letterCount = (text: string) => (text.match(/\p{L}/gu) ?? []).length;

// The words the person capitalized that are not the first word of a sentence, lowercased, each once, in the order first
// written: the names of people and places, mostly. A possessive or a contraction is cut ("Blessing’s" is "blessing"), and a
// hyphenated name gives the whole name and its parts. Known limit: a name written only at the start of a sentence, or in
// lowercase, is not found (the instruction still forbids it).
export function privateWords(entry: string): string[] {
  const words: string[] = [];
  const add = (word: string) => {
    if (letterCount(word) >= 2 && !NEVER_PRIVATE.has(word) && !words.includes(word)) words.push(word);
  };
  for (const token of tokens(entry)) {
    if (token.initial || !/^\p{Lu}/u.test(token.word)) continue;
    const base = apostrophes(token.word).replace(/’(?:s|m|ve|ll|d|re|t)?$/i, "").toLowerCase();
    add(base);
    if (base.includes("-")) base.split("-").forEach(add);
  }
  return words;
}

function wordPattern(word: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{M}])${escapeRegex(apostrophes(word))}(?![\\p{L}\\p{M}])`, "iu");
}

// The private words that appear in the text as whole words, in any case, in the order of `words`.
export function leakedWords(text: string, words: readonly string[]): string[] {
  const normalized = apostrophes(text);
  return words.filter((word) => wordPattern(word).test(normalized));
}

export function leaksPrivate(text: string, words: readonly string[]): boolean {
  return leakedWords(text, words).length > 0;
}

// ---- What the checks and the evaluation read ---------------------------------------------------------------------------

export type ToneReflection = {
  title: string;
  devotional: string;
  closingPrayer: string;
  affirmations: { slot: TimeSlot; headline: string; text: string }[];
};

// The instruction's tone example (prompt.ts quotes it). The evaluation flags a reflection that copies one of its sentences.
// gen-v2.1: the strong example is in the narrated voice (short lines that build, sure of God) and no longer opens with "It
// sounds like", which the model had copied into 20 of 24 openings. gen-v2.2: it opens with a hook built from its entry
// (working late all week, which the instruction names), not with a general truth.
export const TONE_EXAMPLE = {
  weak: ["Don't worry!", "God has a plan and everything will work out.", "Just trust him."],
  strong: [
    "Another night at your desk, and the list still isn’t done.",
    "You gave it everything anyway, and now you’re running on empty.",
    "That kind of tired is not failure.",
    "It is love that has carried too much for too long.",
    "God is not waiting for you to be stronger.",
    "He is not counting what you left undone.",
    "He is here, in the late hours and the empty places, and his love has not moved.",
  ],
} as const;

// The first words a devotional must never begin with (gen-v2.1): stock openings that made every devotional sound the same.
// gen-v2.2 forbids every "The" (it had "The weight of"): hooks that begin with it ("The phone…", "The screen…", "The
// silence…") sound alike. The instruction lists them, and the evaluation counts a devotional that still begins with one.
// Never a reason to refuse a reply: only what protects privacy, scripture or the person is a hard check.
export const STOCK_OPENINGS = [
  "It",
  "I",
  "The",
  "Today",
  "Sometimes",
  "Dear",
  "You are not alone",
  "You’re not alone",
  "In this moment",
  "Let’s",
] as const;

const STOCK_OPENING = new RegExp(
  `^(?:${STOCK_OPENINGS.map((words) => escapeRegex(words).replace(/’/g, "['’]")).join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

// The devotional's first word, lowercased, with no apostrophe ending ("It’s" is "it", "You’re" is "you").
export function firstWord(devotional: string): string {
  return (devotional.trim().match(/^[\p{L}\p{N}]+/u)?.[0] ?? "").toLowerCase();
}

// The devotional's first two words, lowercased and with straight apostrophes ("Empty spaces", "You’re holding" is "you're
// holding"): the evaluation counts devotionals that begin the same way, the shape of a template.
export function openingStart(devotional: string): string {
  const words = devotional.trim().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  return words.slice(0, 2).join(" ").toLowerCase().replace(/’/g, "'");
}

export function hasStockOpening(devotional: string): boolean {
  return STOCK_OPENING.test(devotional.trim().replace(/^["“‘']+/, ""));
}

// The devotional's first sentence: up to the first `.`, `!` or `?` (and any closing quote) that is followed by a space or
// the end. It is the hook (gen-v2.2), and prompt.ts shows it to the model as each recent reflection's opening.
export function openingSentence(devotional: string): string {
  const text = devotional.replace(/\s+/g, " ").trim();
  const end = /[.!?]["”’)]*(?=\s|$)/.exec(text);
  return end ? text.slice(0, end.index + end[0].length) : text;
}

// The hook's length (gen-v2.2): at most this many words, so the whole first sentence is heard within about
// the first five seconds (Aoede at 0.88 reads about two and a half words a second). The instruction quotes the number.
export const HOOK_MAX_WORDS = 12;

// The feeling words that made hooks sound alike in the gen-v2.2 evaluation (12 of 24 leaned on "heavy" or "weight"). The
// instruction keeps them out of the hook, so that the concrete thing the person told carries the feeling.
export const HOOK_FEELING_WORDS = /\b(?:heav(?:y|ier|iest|iness)|weigh(?:t|ts|s|ed|ing)?|burden(?:s|ed)?)\b/i;

// ---- Style measures (the evaluation's, never a reason to refuse a reply) -----------------------------------------------

export type StyleMeasures = {
  longSentences: number; // sentences over 25 words, in the devotional and the prayer
  questions: number; // in the devotional
  symbols: number; // parentheses, brackets, slashes, semicolons and double quotes, in the devotional and the prayer
  numerals: number; // runs of digits, in the devotional and the prayer
  commands: number; // "at least", "you should", "you need to", "you must", "you have to"
  capitalPronouns: number; // He, Him, His, You, Your in the middle of a sentence (God's pronouns are lowercase)
  copiedExample: boolean; // a sentence of the instruction's tone example
  firstWord: string; // the devotional's first word, lowercased
  stockOpening: boolean; // the devotional begins with one of STOCK_OPENINGS
  openingWords: number; // words in the devotional's first sentence, the hook (at most HOOK_MAX_WORDS asked)
  openingStart: string; // the devotional's first two words, lowercased
  hookFeeling: boolean; // the hook leans on a feeling word (HOOK_FEELING_WORDS) instead of the concrete thing
  devotionalParagraphs: number;
  paragraphsInRange: boolean; // 3 or 4
  devotionalWords: number;
  devotionalInRange: boolean; // 110 to 150
  prayerWords: number;
  prayerInRange: boolean; // 30 to 50
  titleWords: number;
  titleChars: number;
  titleInRange: boolean; // 2 to 6 words, at most 40 characters
  titleEndPunctuation: boolean;
  headlinesOutOfRange: number; // a headline that is not 2 to 8 words, or is over 50 characters
  textsOutOfRange: number; // an affirmation text that is not 12 to 30 words
};

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const sentences = (text: string) => text.split(/(?<=[.!?…]["”’)]*)\s+/).filter((part) => part.trim() !== "");
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const between = (value: number, min: number, max: number) => value >= min && value <= max;
const comparable = (text: string) => text.toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");

export function styleMeasures(reflection: ToneReflection): StyleMeasures {
  const spoken = `${reflection.devotional}\n\n${reflection.closingPrayer}`;
  const texts = reflection.affirmations.map((item) => item.text).join("\n");
  const everything = comparable(`${spoken}\n${texts}`);
  const examples = [...TONE_EXAMPLE.weak, ...TONE_EXAMPLE.strong].filter((sentence) => countWords(sentence) >= 4);
  const pronouns = tokens(`${reflection.devotional}\n${reflection.closingPrayer}\n${texts}`)
    .filter((token) => !token.initial && /^(?:He|Him|His|You|Your)$/.test(token.word)).length;
  const paragraphs = reflection.devotional.split(/\n\s*\n/).filter((part) => part.trim() !== "").length;
  const devotionalWords = countWords(reflection.devotional);
  const prayerWords = countWords(reflection.closingPrayer);
  const titleWords = countWords(reflection.title);
  return {
    longSentences: sentences(spoken).filter((sentence) => countWords(sentence) > 25).length,
    questions: count(reflection.devotional, /\?/g),
    symbols: count(spoken, /[()[\]/;"“”]/g),
    numerals: count(spoken, /\d+/g),
    commands: count(`${spoken}\n${texts}`, /\b(?:at least|you should|you need to|you must|you have to)\b/gi),
    capitalPronouns: pronouns,
    copiedExample: examples.some((sentence) => everything.includes(comparable(sentence).replace(/[.!?]+$/, ""))),
    firstWord: firstWord(reflection.devotional),
    stockOpening: hasStockOpening(reflection.devotional),
    openingWords: countWords(openingSentence(reflection.devotional)),
    openingStart: openingStart(reflection.devotional),
    hookFeeling: HOOK_FEELING_WORDS.test(openingSentence(reflection.devotional)),
    devotionalParagraphs: paragraphs,
    paragraphsInRange: between(paragraphs, 3, 4),
    devotionalWords,
    devotionalInRange: between(devotionalWords, 110, 150),
    prayerWords,
    prayerInRange: between(prayerWords, 30, 50),
    titleWords,
    titleChars: reflection.title.length,
    titleInRange: between(titleWords, 2, 6) && reflection.title.length <= 40,
    titleEndPunctuation: /[.!?…:;,]$/.test(reflection.title.trim()),
    headlinesOutOfRange:
      reflection.affirmations.filter((item) => !between(countWords(item.headline), 2, 8) || item.headline.length > 50)
        .length,
    textsOutOfRange: reflection.affirmations.filter((item) => !between(countWords(item.text), 12, 30)).length,
  };
}

// Measured with the real voice (Chirp 3 HD Aoede at a speaking rate of 0.88, steps 22 and 26): a 1,688-character script took
// 115.2 s, and the audition's 1,445-character script 102.1 to 110.0 s on four runs, so about 13 to 15 characters of script a
// second, pause tags included. 14 is the middle.
export const SCRIPT_CHARS_PER_SECOND = 14;

export function estimatedSeconds(markupChars: number): number {
  return markupChars / SCRIPT_CHARS_PER_SECOND;
}

// ---- The correction note on a retry (decision 16) ----------------------------------------------------------------------

const MAX_NOTE_WORDS = 20;

// The note the next attempt carries after a reply failed a tone check, or null for any other reason (a reply that fails a
// shape check is asked for again with no note). For the two privacy checks it names the words to avoid: the ones that leaked
// first, then the entry's other private words, at most 20. They come from the entry the same request already carries.
export function correctionNote(
  reason: string,
  words: readonly string[],
  leaked: readonly string[] = [],
): string | null {
  if (reason === "verse_reference") {
    return "Your last reply named or pointed to a Bible passage in the devotional or the closing prayer. Write the whole reply again, and leave every book, chapter and verse out of both.";
  }
  if (reason.startsWith("never_say:")) {
    const item = NEVER_SAY.find((candidate) => `never_say:${candidate.id}` === reason);
    if (!item) return null;
    return `Your last reply said “${item.label}” or something that means the same. Write the whole reply again without it.`;
  }
  if (reason === "title_private" || reason === "headline_private") {
    const listed = [...new Set([...leaked, ...words])].slice(0, MAX_NOTE_WORDS);
    return `Your last reply used a word from the entry in the title or an affirmation headline. Write the whole reply again, and do not use any of these words in reflection_title or in any headline: ${
      listed.join(", ")
    }.`;
  }
  return null;
}

// ---- The hook guard (gen-v2.2) -----------------------------------------------------------------------------------------

// The one style rule that may cost a retry, because the user asked for it (2026-10-31): every devotional opens with a hook
// of its own, even for someone who has made a hundred. A devotional that begins with a stock opening, or with the first
// word one of the person's recent devotionals began with, is asked for once more with this note. It never costs a
// reflection: output.ts hands the reply over as its salvage, so when no better reply comes it is kept as it is. The note
// holds no word of the person's: only stock words and first words the model itself wrote.
export type HookProblem = { reason: "hook_stock" | "hook_repeated" | "hook_long"; note: string };

// A hook longer than this is asked for again (the instruction asks for HOOK_MAX_WORDS; the model counts loosely, so a few
// words over are left alone): past sixteen words, the first sentence is not heard within the first five seconds.
export const HOOK_RETRY_WORDS = 16;

export function hookProblem(devotional: string, recentFirstWords: readonly string[]): HookProblem | null {
  const word = firstWord(devotional);
  const hookWords = countWords(openingSentence(devotional));
  const recent = [...new Set(recentFirstWords.filter((item) => item !== ""))];
  const stock = STOCK_OPENINGS.map((item) => `“${item}”`).join(", ");
  const listed = recent.map((item) => `“${item}”`).join(", ");
  if (hasStockOpening(devotional)) {
    return {
      reason: "hook_stock",
      note:
        `Your last reply began the devotional with a stock opening. Write the whole reply again, and begin the devotional with a hook built from their own moment, as "The first line" asks. Do not begin with ${stock}${
          recent.length > 0 ? `, or with ${listed}, which began their recent devotionals` : ""
        }.`,
    };
  }
  if (word !== "" && recent.includes(word)) {
    return {
      reason: "hook_repeated",
      note:
        `Your last reply began the devotional with “${word}”, the way a recent devotional of theirs began. Write the whole reply again, and begin the devotional with a hook built from their own moment and a different first word, as "The first line" asks: not ${listed}, and not ${stock}.`,
    };
  }
  if (hookWords > HOOK_RETRY_WORDS) {
    return {
      reason: "hook_long",
      note:
        `Your last reply began the devotional with a first sentence of ${hookWords} words. Write the whole reply again, and make the devotional's first sentence a short hook of at most ${HOOK_MAX_WORDS} words, as "The first line" asks.`,
    };
  }
  return null;
}

// ---- The safe texts (decision 17) --------------------------------------------------------------------------------------

// Fixed texts for a title or a headline that kept a word from the entry after the retry. They hold nothing from any entry,
// and each passes every hard check, so a name never stops a reflection.
export const SAFE_TITLE = "A Quiet Moment with God";
export const SAFE_HEADLINES: Readonly<Record<TimeSlot, string>> = {
  morning: "You are not alone today",
  afternoon: "God is with you here",
  evening: "Rest in his care",
};

// title_private and headline_private: a safe text took the place of a word from the entry. hook_stock and hook_repeated: the
// reply was kept as it was, with an opening the hook guard asked to change (below).
export type SalvageReason = "title_private" | "headline_private" | HookProblem["reason"];

// The reflection with its title and each headline that leaks a private word replaced by its safe text; nothing else changes.
// `salvaged` says which check it was (title_private when the title leaked, otherwise headline_private), or null when nothing
// leaked.
export function salvageReflection<T extends ToneReflection>(
  reflection: T,
  words: readonly string[],
): T & { salvaged: SalvageReason | null } {
  const titleLeaks = leaksPrivate(reflection.title, words);
  let headlineLeaks = false;
  const affirmations = reflection.affirmations.map((item) => {
    if (!leaksPrivate(item.headline, words)) return item;
    headlineLeaks = true;
    return { ...item, headline: SAFE_HEADLINES[item.slot] };
  });
  return {
    ...reflection,
    title: titleLeaks ? SAFE_TITLE : reflection.title,
    affirmations,
    salvaged: titleLeaks ? "title_private" : headlineLeaks ? "headline_private" : null,
  };
}
