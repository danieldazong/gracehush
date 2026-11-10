import { BSB_BOOKS } from "../_shared/bible/books.ts";
import { LIMITS } from "./constants.ts";
import type { TimeSlot } from "./contracts.ts";

// The pastoral tone's rules that code can check (step 32). Pure: no network, no clock, nothing logged.
//
// Three kinds. HARD checks (output.ts) make a reply unusable, because each one guards a person or the scripture: a phrase from
// the never-say list, and a devotional, prayer or validation line that points to a Bible passage (the app shows and reads the
// passage on its own). SOFT checks cost at most a retry, never a reflection: a name the person wrote in a title or a headline
// (both reach a lock screen, so a safe text takes its place), and since gen-v2.3 (step 36) a prayer that is not in the person's
// own voice, a reply that uses nothing they told, a validation line that is missing, a template or private, a quotation that is
// not their words, and the hook guard. STYLE measures (styleMeasures) never cost anything: the tone evaluation counts them.

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

// The id of the first phrase of `list` in the text (in the order of the list), or null.
function firstPhrase(list: readonly NeverSay[], text: string): string | null {
  for (const item of list) {
    for (const match of text.matchAll(item.pattern)) {
      if (item.negatable && NEGATION.test(clauseBefore(text, match.index ?? 0))) continue;
      return item.id;
    }
  }
  return null;
}

// The id of the first never-say phrase in the text (in the order of the list), or null.
export function firstNeverSay(text: string): string | null {
  return firstPhrase(NEVER_SAY, text);
}

// ---- A heavy moment (gen-v2.4, heavy.ts) -------------------------------------------------------------------------------

// What a reflection for a heavy moment never says, on top of NEVER_SAY: death as a way home, as rest or as a release, and a
// call to submit to, forgive, obey or stay with someone who does harm. Precise phrases again, never single words, so a
// devotional that says "you are held" or "rest in his care" passes. A hard check: a reply that says one is asked for again,
// and a second one is replaced by the written fallback (handler.ts), never kept.
export const HEAVY_NEVER_SAY: readonly NeverSay[] = [
  {
    id: "home",
    label: "God is calling you home",
    pattern:
      /\b(?:call(?:s|ing|ed)?|bring(?:s|ing)?|tak(?:e|es|ing)|welcom(?:e|es|ing))\s+you\s+home\b|\b(?:go(?:es|ing)?|went|gone)\s+home\s+to\s+(?:god|jesus|the\s+lord|heaven|be\s+with)\b/gi,
    negatable: false,
  },
  {
    id: "heaven_waiting",
    label: "heaven is waiting for you",
    pattern: /\bheaven\s+(?:is|will\s+be)\s+waiting\b|\bwaiting\s+for\s+you\s+in\s+heaven\b/gi,
    negatable: false,
  },
  {
    id: "at_last",
    label: "rest or peace at last",
    pattern: /\b(?:rest|peace)\s+at\s+last\b|\bfinally\s+(?:be\s+)?(?:at\s+)?(?:rest|peace|free)\b/gi,
    negatable: true,
  },
  {
    id: "release",
    label: "a release or an escape from this life",
    pattern:
      /\b(?:escape|release|relief)\s+from\s+(?:this\s+)?(?:life|world)\b|\bno\s+longer\s+(?:be\s+)?(?:here|in\s+this\s+world|alive)\b/gi,
    negatable: false,
  },
  {
    // A person, never a pronoun: God's pronouns are lowercase ("submit to him" can be about God).
    id: "submit",
    label: "submit to the person who hurts you",
    pattern:
      /\b(?:submit(?:ting)?|be\s+submissive)\s+to\s+your\s+(?:husband|wife|partner|spouse|boyfriend|girlfriend|father|mother|parents?|abuser)\b/gi,
    negatable: true,
  },
  {
    // "You need to forgive yourself" is left alone; "you don't have to forgive them yet" is a denial and passes.
    id: "must_forgive",
    label: "you must forgive, obey or stay",
    pattern:
      /\b(?:must|have\s+to|has\s+to|need\s+to|needs\s+to|should|ought\s+to)\s+(?:forgive(?!\s+yourself)|obey|submit|(?:stay\s+with|go\s+back\s+to|return\s+to)\s+(?:him|her|them))\b/gi,
    negatable: true,
  },
  // The four below (2026-11-08, found by the live check: a quiet heavy moment's first line said "never wake up", and its devotional
  // that "wanting it all to stop makes human sense"). A heavy reflection speaks of the pain and of God, never of dying, harm, a
  // method or the wish itself, in the person's words or in softer ones, and not even to deny it. None of them is negatable.
  {
    id: "dying",
    label: "dying or death",
    pattern: /\b(?:die|dies|died|dying|death|deaths|dead|kill\w*|suicid\w*)\b/gi,
    negatable: false,
  },
  {
    id: "self_harm",
    label: "harming yourself",
    pattern:
      /\b(?:hurt(?:ing)?|harm(?:ing)?|cut(?:ting)?)\s+(?:yourself|myself|themselves|himself|herself)\b|\bself-?harm\w*\b/gi,
    negatable: false,
  },
  {
    id: "wish",
    label: "wanting it all to stop, never waking up or disappearing",
    pattern: new RegExp(
      [
        String
          .raw`\b(?:want|wants|wanted|wanting|wish|wishes|wished|wishing|longing)\s+(?:for\s+)?(?:it\s+all|everything|things|it|life|living)\s+to\s+(?:stop|end|be\s+over)\b`,
        String.raw`\b(?:never|not)\s+(?:wake|waking|woke)(?:\s+up)?\b`,
        String.raw`\bsleep\s+forever\b`,
        // Sleep as a longing, a relief or the only thing left, in one sentence: an entry's euphemism for dying (the live check's
        // quiet heavy moment answered "Sleep feels like the only thing calling to you"). Sleep alone, as rest tonight, is left alone.
        String
          .raw`\b(?:sleep|sleeping|asleep)\b[^.?!]{0,60}\b(?:relief|escape|forever|only|calling|calls|long|longing|wants?|wish(?:es)?|end|peace)\b`,
        String
          .raw`\b(?:relief|escape|only|calling|longing|wants?|wanting|wish(?:es|ing)?)\b[^.?!]{0,60}\b(?:sleep|sleeping|asleep)\b`,
        String.raw`\bonly\s+(?:relief|escape|way\s+out)\b`,
        String.raw`\b(?:disappear|vanish)(?:ing)?\s+(?:forever|for\s+good|completely)\b`,
        String.raw`\byou\s+(?:could|would|want\s+to|wanted\s+to|wish\s+you\s+could)\s+(?:disappear|vanish)\b`,
      ].join("|"),
      "gi",
    ),
    negatable: false,
  },
  {
    id: "method",
    label: "a method or a means",
    pattern: /\b(?:pills?|overdos\w*|guns?|knife|knives|rope|noose|razors?|blades?)\b/gi,
    negatable: false,
  },
];

// The id of the first phrase a heavy moment never says, or null.
export function firstHeavyNeverSay(text: string): string | null {
  return firstPhrase(HEAVY_NEVER_SAY, text);
}

// A double quotation mark, straight or curly. In a heavy moment the devotional and the prayer quote nothing (no echo), so
// nothing the person wrote about dying or harm can come back to them in their own words.
export function hasQuotation(text: string): boolean {
  return /["“”]/.test(text);
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
  // The first line on the person's screen (gen-v2.3). Optional, so that a reflection of an older version can be measured.
  validationLine?: string | null;
  devotional: string;
  closingPrayer: string;
  affirmations: { slot: TimeSlot; headline: string; text: string }[];
};

// The tone example gen-v2.2 put in its instruction. gen-v2.3 (step 36, decision 6) took it out: one example in every prompt is
// a template the model copies. It stays here for the evaluation, which flags a reflection that copies one of its sentences
// (gen-v2.2's saved replies and the frozen copy in eval/prompt_v2_2.ts still quote it).
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
  prayerInRange: boolean; // 50 to 75 (gen-v2.6; 30 to 50 before)
  prayerSentences: number;
  prayerPetitions: number; // clauses that ask God for something (gen-v2.6 asks for two or three)
  titleWords: number;
  titleChars: number;
  titleInRange: boolean; // 2 to 6 words, at most 40 characters
  titleEndPunctuation: boolean;
  headlinesOutOfRange: number; // a headline that is not 2 to 8 words, or is over 50 characters
  textsOutOfRange: number; // an affirmation text that is not 12 to 30 words
  // gen-v2.3 (step 36). The content stems the entry shares with the line, the devotional and the prayer (0 with no entry);
  // the prayer's voice; and the validation line's words (0 when there is none).
  grounding: number;
  prayerVoice: PrayerVoice;
  validationWords: number;
};

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const sentences = (text: string) => text.split(/(?<=[.!?…]["”’)]*)\s+/).filter((part) => part.trim() !== "");
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const between = (value: number, min: number, max: number) => value >= min && value <= max;
const comparable = (text: string) => text.toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");

// `entry`: the words the reflection was written from, for the grounding count and the prayer's voice (optional, so a
// reflection can be measured on its own).
export function styleMeasures(reflection: ToneReflection, entry = ""): StyleMeasures {
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
    prayerInRange: between(prayerWords, 50, 75),
    prayerSentences: sentences(reflection.closingPrayer).length,
    prayerPetitions: prayerPetitions(reflection.closingPrayer),
    titleWords,
    titleChars: reflection.title.length,
    titleInRange: between(titleWords, 2, 6) && reflection.title.length <= 40,
    titleEndPunctuation: /[.!?…:;,]$/.test(reflection.title.trim()),
    headlinesOutOfRange:
      reflection.affirmations.filter((item) => !between(countWords(item.headline), 2, 8) || item.headline.length > 50)
        .length,
    textsOutOfRange: reflection.affirmations.filter((item) => !between(countWords(item.text), 12, 30)).length,
    grounding: entry.trim() === ""
      ? 0
      : groundingCount(entry, [reflection.validationLine ?? "", reflection.devotional, reflection.closingPrayer]),
    prayerVoice: prayerVoice(reflection.closingPrayer, entry),
    validationWords: countWords(reflection.validationLine ?? ""),
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
  if (reason.startsWith("heavy_never_say:")) {
    const item = HEAVY_NEVER_SAY.find((candidate) => `heavy_never_say:${candidate.id}` === reason);
    if (!item) return null;
    return `This is a heavy moment, and your last reply said “${item.label}” or something that means the same, which must never be said to them. Write the whole reply again without it, by "A heavy moment".`;
  }
  if (reason === "heavy_quote") {
    return `This is a heavy moment, and your last reply quoted words in the devotional or the closing prayer. Write the whole reply again with no quotation marks at all in either, and never repeat what they wrote about dying or harm, by "A heavy moment".`;
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

// ---- gen-v2.3 (step 36): the person's own words, in the prayer, the devotional and the first line -------------------------
//
// Three customers reported on 2026-11-07 that reflections did not answer what they said. These checks make "written from this
// entry" something code can see. Each costs at most a retry with a note, and never a reflection: when no clean reply comes,
// output.ts keeps the reply as its salvage and the log line says which check it was. Every note names the rule; none holds a
// word of the person's except the private-word note, which lists the words to avoid (as the title and headline notes do).

// A soft check's result: the reason the log names, the salvage it sets, and the note the retry carries.
export type SoftProblem = { reason: string; salvaged: SalvageReason; note: string };

// -- The prayer's voice --

// The person's own prayer is in the first person singular. "I’m" counts once; straight and curly apostrophes alike.
const SINGULAR = /(?<![\p{L}\p{N}'’])(?:i(?:['’](?:m|ve|ll|d))?|me|my|mine|myself)(?![\p{L}\p{N}])/giu;
const PLURAL = /(?<![\p{L}\p{N}'’])(?:we(?:['’](?:re|ve|ll|d))?|us|our|ours|ourselves)(?![\p{L}\p{N}])/giu;
const countMatches = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

export type PrayerVoice = "i" | "we" | "none";

// "i": at least two first-person singular pronouns, and no plural one unless the entry itself holds one ("I lift our family to
// you" after an entry about "our family"). "we": a plural one the entry does not explain, or a prayer the person themselves
// prayed as "we". "none": neither (a prayer about others, or a single "I").
export function prayerVoice(prayer: string, entry: string): PrayerVoice {
  const singular = countMatches(prayer, SINGULAR);
  const plural = countMatches(prayer, PLURAL);
  const entryPlural = countMatches(entry, PLURAL) > 0;
  if (singular >= 2 && (plural === 0 || entryPlural)) return "i";
  return plural > 0 ? "we" : "none";
}

// Only "i" passes, and "we" too when the person wrote as "we" (decision 1).
export function prayerVoiceProblem(prayer: string, entry: string): SoftProblem | null {
  const voice = prayerVoice(prayer, entry);
  if (voice === "i" || (voice === "we" && countMatches(entry, PLURAL) > 0)) return null;
  if (voice === "we") {
    return {
      reason: "prayer_voice:we",
      salvaged: "prayer_we",
      note:
        "Your last reply wrote the closing prayer as “we”. Write the whole reply again, and write the prayer as the person’s own prayer, in the first person singular: “I”, “my”, “me”, never “we”, “us” or “our”.",
    };
  }
  return {
    reason: "prayer_voice:none",
    salvaged: "prayer_none",
    note:
      "Your last reply did not write the closing prayer in the person’s own voice. Write the whole reply again, and write the prayer as the person’s own prayer, in the first person singular: “I”, “my”, “me”.",
  };
}

// -- The prayer's petitions (gen-v2.6) --

// The verbs a prayer asks with, at the start of a clause ("give me rest", "steady my hands", "be near me"). A statement
// opens with "you" or "I" instead ("you give rest", "I trust you"), so it is not counted; nor is thanks.
const PETITION_VERBS: ReadonlySet<string> = new Set(
  ("help give grant show teach lead guide keep let remind steady hold carry strengthen surround meet quiet calm settle bring " +
    "open send speak stay walk come fill cover provide lift heal forgive free draw wrap anchor restore renew comfort protect " +
    "watch supply lighten soften shape stir rebuild mend uphold sustain shelter breathe pour plant ground slow still move make " +
    "turn take be do don").split(" "),
);
// What a clause may begin with before its verb: how God is addressed, and a word that only leads in.
const PETITION_LEAD =
  /^(?:(?:o|oh|dear|please|and|so|now|today|tonight|lord|father|god|jesus|spirit|holy spirit|king|shepherd|savior|saviour|my (?:god|lord|father|king|shepherd|savior|saviour))[,:]?\s+)+/i;

// How many clauses of a prayer ask God for something: a clause that opens with a petition verb (after the address), or that
// says "I ask", "I pray" or "please". A style measure (gen-v2.6 asks for two or three petitions), never a reason to refuse
// a reply: the evaluation counts it and the instruction's wording fixes it.
export function prayerPetitions(prayer: string): number {
  let found = 0;
  for (const sentence of sentences(prayer)) {
    for (const clause of sentence.split(/[,;:]\s+|\s+(?:and|but|so|then)\s+/i)) {
      const bare = clause.trim().replace(PETITION_LEAD, "");
      const first = bare.match(/^\p{L}+/u)?.[0].toLowerCase();
      if ((first !== undefined && PETITION_VERBS.has(first)) || /\b(?:i ask|i pray|please)\b/i.test(clause)) found += 1;
    }
  }
  return found;
}
// -- Grounding --

// Common English words of four letters or more: they carry no part of what a person told.
export const STOPWORDS: ReadonlySet<string> = new Set([
  ..."about above across after again against almost already also although always among another anybody anyone anything"
    .split(" "),
  ..."anyway aren around away back because become been before behind being below beside besides best better between both"
    .split(" "),
  ..."came cannot come comes coming could couldn didn does doesn doing done down during each either else enough even ever"
    .split(" "),
  ..."every everybody everyone everything first from gave gets getting give given gives giving goes going gone gotten"
    .split(" "),
  ..."hadn hasn have haven having help helped helps hers herself himself however into itself just keep keeping keeps kept"
    .split(" "),
  ..."last least less like little lots made make makes making many maybe might mine more most much must mustn myself need"
    .split(" "),
  ..."needn needs neither never next nobody none nothing often okay once only onto other others ourselves over please"
    .split(" "),
  ..."quite rather really said same says seem seemed seems shall should shouldn since some somebody someone something"
    .split(" "),
  ..."sometimes soon such sure take takes taking tell tells than thank thanks that their theirs them themselves then there"
    .split(" "),
  ..."these they think this those though through throughout thus till told took toward towards under unless until upon"
    .split(" "),
  ..."very want wanted wants wasn well went were weren what whatever when where whether which while whom whose will with"
    .split(" "),
  ..."within without would wouldn yeah your yours yourself yourselves bless blessed blessing blessings".split(" "),
]);

// The words any devotional holds (the step 36 prompt's list): sharing them says nothing about this entry.
export const DEVOTIONAL_WORDS: ReadonlySet<string> = new Set(
  ("god lord jesus christ father spirit holy pray prayer amen grace faith love peace hope heart hearts today tonight " +
    "morning evening feel feeling feels felt moment carry carrying rest know knows hold holds held still here near close " +
    "alone true truth breath breathe step small good real right world thing things time day days life").split(" "),
);

// A word's stem: a plural, -ed or -ing cut when at least four letters remain ("interviews" is "interview", "waiting" is
// "wait"), "-ies" and "-ied" made "-y" ("surgeries" and "worried" meet "surgery" and "worry"), "-es" cut only after a sibilant
// ("classes" is "class", "houses" is "house") and a double "s" kept ("class", "miss").
export function stem(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length >= 5 && /(?:ies|ied)$/.test(lower)) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ing") && lower.length - 3 >= 4) return lower.slice(0, -3);
  if (lower.endsWith("ed") && lower.length - 2 >= 4) return lower.slice(0, -2);
  if (/(?:ss|x|z|ch|sh)es$/.test(lower) && lower.length - 2 >= 4) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length - 1 >= 4) return lower.slice(0, -1);
  return lower;
}

const STOPWORD_STEMS = new Set([...STOPWORDS].map(stem));
const DEVOTIONAL_STEMS = new Set([...DEVOTIONAL_WORDS].map(stem));

// The content stems of a text: words of four letters or more (an apostrophe ends a word, so a possessive is cut: "surgery's"
// is "surgery"), lowercased, never a common word or a word of any devotional, nor one of their stems.
export function contentStems(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\p{L}+/gu)) {
    const word = match[0].toLowerCase();
    if (word.length < 4 || STOPWORDS.has(word) || DEVOTIONAL_WORDS.has(word)) continue;
    const root = stem(word);
    if (STOPWORD_STEMS.has(root) || DEVOTIONAL_STEMS.has(root)) continue;
    found.add(root);
  }
  return found;
}

// How many of the entry's content stems the reply must share (decision 9): at least 2 when the entry has 8 or more, at least 1
// with 3 to 7, and no check below 3 ("Thank you God for today" has nothing to share).
export function groundingThreshold(entry: string): number {
  const size = contentStems(entry).size;
  return size >= 8 ? 2 : size >= 3 ? 1 : 0;
}

// The entry's content stems that the texts hold, together (the validation line, the devotional and the prayer).
export function groundingCount(entry: string, texts: readonly string[]): number {
  const written = new Set(texts.flatMap((text) => [...contentStems(text)]));
  return [...contentStems(entry)].filter((root) => written.has(root)).length;
}

export function groundingProblem(entry: string, texts: readonly string[]): SoftProblem | null {
  const threshold = groundingThreshold(entry);
  if (threshold === 0 || groundingCount(entry, texts) >= threshold) return null;
  return {
    reason: "grounding_low",
    salvaged: "grounding_low",
    note:
      "Your last reply did not use what the person told you. Write the whole reply again, and build the validation line, the devotional and the prayer from the specific things in their entry: what happened, who it involves, what they asked for, in their words.",
  };
}

// -- The echo --

// One short phrase of the person's own, word for word (decision 3): at most this many words, once.
export const ECHO_MAX_WORDS = 8;

// The text between curly double quotes, or between straight ones.
const QUOTED = /“([^“”]*)”|"([^"]*)"/g;
const echoWords = (text: string) =>
  text.toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];

function holdsRun(words: readonly string[], run: readonly string[]): boolean {
  for (let start = 0; start + run.length <= words.length; start += 1) {
    if (run.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}

// Every quotation in the devotional and the prayer together must be one run of the entry's words, at most eight, case,
// punctuation and the apostrophe's shape aside. None at all passes.
export function echoProblem(texts: readonly string[], entry: string): SoftProblem | null {
  const spans = texts
    .flatMap((text) => [...text.matchAll(QUOTED)].map((match) => echoWords(match[1] ?? match[2] ?? "")))
    .filter((words) => words.length > 0);
  if (spans.length === 0) return null;
  if (spans.length === 1 && spans[0].length <= ECHO_MAX_WORDS && holdsRun(echoWords(entry), spans[0])) return null;
  return {
    reason: "echo_invented",
    salvaged: "echo_invented",
    note:
      "The quoted words are not in the person’s entry. Write the whole reply again and quote only words they wrote, at most eight, once, or quote nothing.",
  };
}

// -- The validation line --

export type ValidationRule =
  | "validation_missing"
  | "validation_length"
  | "validation_stock"
  | "validation_person"
  | "validation_private";

const SECOND_PERSON = /(?<![\p{L}\p{N}])you(?:r|rs|rself|['’](?:re|ve|ll|d))?(?![\p{L}\p{N}])/iu;

// The line, in this order: there; 5 to 24 words and at most 240 characters; not a template (a stock opening, or "It seems");
// spoken to the person; and never a word the person capitalized (it is shown above the devotional, where anyone near the phone
// can read it). `words`: the entry's private words (privateWords).
export function validationProblem(line: string | null | undefined, words: readonly string[]): SoftProblem | null {
  const text = (line ?? "").trim();
  const problem = (reason: ValidationRule, note: string): SoftProblem => ({ reason, salvaged: reason, note });
  if (text === "") {
    return problem(
      "validation_missing",
      "Your last reply left validation_line empty. Write the whole reply again, with a validation_line of 8 to 18 words in the second person that names what the person is going through, in plain words from their entry.",
    );
  }
  const count = countWords(text);
  const limits = LIMITS.validationLine;
  if (count < limits.minWords || count > limits.maxWords || text.length > limits.maxChars) {
    return problem(
      "validation_length",
      "Your last reply wrote a validation_line that is too short or too long. Write the whole reply again, with a validation_line of one sentence and 8 to 18 words.",
    );
  }
  if (hasStockOpening(text) || /^["“‘']*it\s+seems\b/i.test(text)) {
    return problem(
      "validation_stock",
      'Your last reply began validation_line with a stock opening. Write the whole reply again, and begin validation_line with what the person is going through, never with “It sounds like”, “It feels like”, “It seems”, “Sometimes” or any first word that "The first line" forbids.',
    );
  }
  if (!SECOND_PERSON.test(text)) {
    return problem(
      "validation_person",
      "Your last reply did not write validation_line to the person. Write the whole reply again, and write validation_line in the second person, with “you” or “your”.",
    );
  }
  const leaked = leakedWords(text, words);
  if (leaked.length > 0) {
    const listed = [...new Set([...leaked, ...words])].slice(0, MAX_NOTE_WORDS);
    return problem(
      "validation_private",
      `Your last reply used a word from the entry in validation_line. Write the whole reply again, and do not use any of these words in validation_line: ${
        listed.join(", ")
      }.`,
    );
  }
  return null;
}

// What stands in for a line the model could not get right: the devotional's first sentence, the hook, when it holds no private
// word and fits the column; otherwise no line (the screen then shows the hook itself, from the devotional).
export function salvageLine(devotional: string, words: readonly string[]): string | null {
  const hook = openingSentence(devotional);
  if (hook === "" || hook.length > LIMITS.validationLine.maxChars || leaksPrivate(hook, words)) return null;
  return hook;
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

// title_private and headline_private: a safe text took the place of a word from the entry. hook_stock, hook_repeated and
// hook_long: the reply was kept as it was, with an opening the hook guard asked to change. gen-v2.3 (step 36): prayer_we and
// prayer_none, the prayer as the reply wrote it; grounding_low and echo_invented, the reply as it was; validation_<rule>, the
// devotional's first sentence (or nothing) in place of the line.
export type SalvageReason =
  | "title_private"
  | "headline_private"
  | HookProblem["reason"]
  | "prayer_we"
  | "prayer_none"
  | "grounding_low"
  | "echo_invented"
  | ValidationRule
  | HeadlineRule;

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

// ---- gen-v2.5 (step 37): the headline, a notification's bold title over its verse --------------------------------------
//
// Since step 37 a headline is the bold first line of a lock-screen notification, written from its verse. Two soft checks
// (each costs at most a retry with a note, never a reflection: output.ts keeps the reply as its salvage):
//   headline_feeling   a feeling word in a headline, which a stranger can read ("Leave your regret behind tonight" and "Lay down
//                      the irritation" in the step 37 prototype); the instruction names most of them, this is the net
//   headline_repeated  a headline this person has already received in one of their recent reflections (the step 36 evaluation
//                      found 14 of 96 headlines word for word another case's), compared without case or punctuation
export type HeadlineRule = "headline_feeling" | "headline_repeated";

// Whole words, any case, with their common forms.
export const HEADLINE_FEELING_WORDS = new RegExp(
  String
    .raw`(?<![\p{L}])(?:sorrow(?:s|ful)?|grie(?:f|fs|ve|ves|ving|ved)|regret(?:s|ted|ting)?|worr(?:y|ies|ied|ying)|anxi(?:ous|ety|eties)|fear(?:s|ful|ing)?|afraid|scared|guilt(?:y)?|shame(?:d|ful)?|ashamed|ang(?:er|ry)|irritat(?:ion|ed|ing)|frustrat(?:ion|ed|ing)|sad(?:ness)?|lonel(?:y|iness)|solitary|exhaust(?:ed|ion)|tired(?:ness)?|weary|weariness|burnout|depress(?:ed|ion)|despair|hopeless(?:ness)?|heartbr(?:oken|eak)|panic(?:ked)?|stress(?:ed|ful)?|overwhelm(?:ed|ing)?|tears|tearful|cry|crying|cried|weep(?:s|ing)?|wept|depleted|drained|hurting|heartache|wounded|ach(?:e|es|ing)|weak(?:ness)?|failing|failure)(?![\p{L}])`,
  "iu",
);

// A headline as it is compared with the person's recent ones: lowercase letters and digits, one space between words.
export function headlineKey(headline: string): string {
  return headline.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// The soft problems of the three headlines, feeling first. `recentHeadlines`: the person's newest headlines (lifecycle.ts
// listRecentAffirmations). The notes quote only what the model wrote (a headline, or the feeling word in it).
export function headlineProblems(
  affirmations: readonly { slot: TimeSlot; headline: string }[],
  recentHeadlines: readonly string[] = [],
): SoftProblem[] {
  const problems: SoftProblem[] = [];
  const feeling = affirmations
    .map((item) => item.headline.match(HEADLINE_FEELING_WORDS)?.[0])
    .find((word): word is string => word !== undefined);
  if (feeling) {
    problems.push({
      reason: "headline_feeling",
      salvaged: "headline_feeling",
      note:
        `Your last reply put a feeling word (“${feeling.toLowerCase()}”) in an affirmation headline, which a stranger can read on a lock screen. Write the whole reply again, and keep every feeling out of the three headlines: say the truth each verse holds for them, as "What to write" asks.`,
    });
  }
  const recent = new Set(recentHeadlines.map(headlineKey).filter((key) => key !== ""));
  const repeated = affirmations.find((item) => recent.has(headlineKey(item.headline)));
  if (repeated) {
    problems.push({
      reason: "headline_repeated",
      salvaged: "headline_repeated",
      note:
        `Your last reply gave the ${repeated.slot} affirmation the headline “${repeated.headline}”, which this person has already received. Write the whole reply again with three new headlines, each written from its own verse.`,
    });
  }
  return problems;
}
