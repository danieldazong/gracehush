import type { UsfmBookId } from "../bible/books.ts";
import { formatReference, type ScriptureRef } from "../bible/reference.ts";
import type { Region } from "../safety/helpKind.ts";
import {
  HEAVY_RULE_IF_HURT,
  HEAVY_RULE_NOT_DEATH,
  HEAVY_RULE_NOT_SIN,
  HEAVY_RULE_PASSAGE,
  HEAVY_RULE_WISH,
} from "../../process-entry/heavy.ts";
import type { HelpKind } from "../../process-entry/contracts.ts";

// A heavy moment in a Scholar conversation (step 38; scholar-v2 since 2026-11-11, after the readers' review). A message that shows
// a risk to the person (thoughts of ending their life or of self-harm, harm someone is doing to them, an intention to harm someone
// else, danger now) gets a whole answer, written with extra care. One flagged message marks the conversation heavy for good, and
// every later answer in it follows these rules too.
//
// The readers found the scholar-v1 answers safe and one script: fifteen prohibitions and a handful of approved phrases made a
// cautious model say the same thing to everyone. Version 2 keeps every prohibition and adds what to do: answer this person, in
// fresh words, briefly, with one step sized to the moment, and a passage chosen from a list the pastor has read in the BSB.
//
// Change nothing here without a run of the evaluation (_shared/scholar/eval/run_scholar_eval.ts, the heavy set) and the readers'
// approval of the review pack. Nothing here holds a method or means, and nothing here may ever be extended with one.

// ---- The hard-moment passages ----------------------------------------------------------------------------------------------

// The passages a heavy answer may show, and nothing else: the readers' list of 2026-11-11, each one read by the pastor in the
// Berean Standard Bible at exactly this range. The model names one by its key (prompt.ts, the heavy schema's passage_key enum);
// the words are read from the Bible like every passage (passages.ts), and a card that does not end a sentence is never shown.
export type HardPassageKey =
  | "ISA_41_10"
  | "DEU_31_8"
  | "ISA_43_2"
  | "ISA_42_3"
  | "LAM_3_22_23"
  | "PSA_121_3_4"
  | "PSA_147_3"
  | "PSA_56_8"
  | "PSA_9_9_10"
  | "PSA_4_4"
  | "ZEP_3_17"
  | "EXO_17_12"
  | "PSA_46_1";

export type HardPassage = { key: HardPassageKey; ref: ScriptureRef; goodFor: string };

const at = (bookId: UsfmBookId, chapter: number, verseStart: number, verseEnd = verseStart): ScriptureRef => ({
  bookId,
  chapter,
  verseStart,
  verseEnd,
});

export const HARD_MOMENT_PASSAGES: readonly HardPassage[] = [
  { key: "ISA_41_10", ref: at("ISA", 41, 10), goodFor: "fear and weakness" },
  { key: "DEU_31_8", ref: at("DEU", 31, 8), goodFor: "feeling abandoned by God" },
  { key: "ISA_43_2", ref: at("ISA", 43, 2), goodFor: "asking when it will end" },
  { key: "ISA_42_3", ref: at("ISA", 42, 3), goodFor: "feeling punished or crushed" },
  { key: "LAM_3_22_23", ref: at("LAM", 3, 22, 23), goodFor: "dread of each new day" },
  { key: "PSA_121_3_4", ref: at("PSA", 121, 3, 4), goodFor: "sleepless nights" },
  { key: "PSA_147_3", ref: at("PSA", 147, 3), goodFor: "heartbreak and separation" },
  { key: "PSA_56_8", ref: at("PSA", 56, 8), goodFor: "grief" },
  { key: "PSA_9_9_10", ref: at("PSA", 9, 9, 10), goodFor: "being harmed by someone" },
  { key: "PSA_4_4", ref: at("PSA", 4, 4), goodFor: "rage" },
  { key: "ZEP_3_17", ref: at("ZEP", 3, 17), goodFor: "shame and self-harm" },
  { key: "EXO_17_12", ref: at("EXO", 17, 12), goodFor: "leaders carrying it alone" },
  { key: "PSA_46_1", ref: at("PSA", 46, 1), goodFor: "general use" },
];

export const HARD_PASSAGE_KEYS: readonly HardPassageKey[] = HARD_MOMENT_PASSAGES.map((item) => item.key);

export function isHardPassageKey(value: unknown): value is HardPassageKey {
  return typeof value === "string" && (HARD_PASSAGE_KEYS as readonly string[]).includes(value);
}

export function hardPassage(key: HardPassageKey): HardPassage {
  return HARD_MOMENT_PASSAGES.find((item) => item.key === key) as HardPassage;
}

// Both say "do not be afraid", which a person whose fear of someone is protecting them must never be told.
const NOT_WHEN_HURT: readonly HardPassageKey[] = ["ISA_41_10", "DEU_31_8"];

// The keys a heavy answer may still show: never one already shown in this conversation, and for a person someone is hurting,
// never one that tells them not to be afraid.
export function allowedPassageKeys(help: HelpKind, used: readonly HardPassageKey[]): HardPassageKey[] {
  return HARD_PASSAGE_KEYS.filter((key) => !used.includes(key) && !(help === "abuse" && NOT_WHEN_HURT.includes(key)));
}

// The keys a conversation has shown: each passage card of its earlier answers, by the reference the card carries.
export function usedPassageKeys(references: readonly string[]): HardPassageKey[] {
  const shown = new Set(references);
  return HARD_MOMENT_PASSAGES.filter((item) => shown.has(formatReference(item.ref))).map((item) => item.key);
}

// The first of `preferred` this conversation may still show, or null.
export function firstAllowed(
  preferred: readonly HardPassageKey[],
  help: HelpKind,
  used: readonly HardPassageKey[],
): HardPassageKey | null {
  const allowed = allowedPassageKeys(help, used);
  return preferred.find((key) => allowed.includes(key)) ?? null;
}

// The passage the first heavy answer of a conversation gets when the model chose none it may show (it is never without one).
export function defaultPassageKey(help: HelpKind, used: readonly HardPassageKey[]): HardPassageKey | null {
  return firstAllowed(
    help === "abuse" ? ["PSA_9_9_10", "PSA_46_1", "ISA_42_3"] : ["ISA_41_10", "PSA_46_1", "DEU_31_8"],
    help,
    used,
  );
}

// ---- The section of the instruction ----------------------------------------------------------------------------------------

// When the section applies, and that it comes first: the same framing as the reflection's section (heavy.ts HEAVY_INSTRUCTION),
// written for a conversation.
const INTRO =
  `Some messages carry a risk to the person: thoughts of ending their life or of harming themselves, harm someone is doing to them, an intention to harm someone else, or danger happening right now. When the message shows any of these, or a <heavy_moment> block follows it, set is_heavy to true and still write the whole answer, by every rule above and by these on top of them. These rules come first wherever they meet another rule, "How to answer" and "How to write" included. A <heavy_moment> block says what the help line under your answer is, what to do in danger now, their local time and what this conversation has already had: write by it.`;

// The shared rules of heavy.ts the reflection also follows, word for word, are WISH, NOT_DEATH, NOT_SIN, IF_HURT and PASSAGE. The
// reflection's STAY_FIRST, NEVER_DESCRIBE and NO_PROMISE carry the approved phrases the readers found in every answer, so a
// conversation has its own three, with every prohibition kept, and rule 4 below in place of A_PERSON.
export const RULE_STAY_FIRST =
  `- Stay with them first. Name the pain in plain words and honor it as real, without alarm and without a lecture. Then say who God is to them right now, present, tender and holding on to them, and let them know in fresh words that their life matters to him and to the people around them.`;
export const RULE_NEVER_DESCRIBE =
  `- Never repeat or describe what they wrote about dying, ending their life, harming themselves or someone else, or how: no method, no means, no place, no plan. Never say it in other words either, softened or denied: not sleeping and not waking, wanting it all to stop, disappearing, being gone, the only relief, a way out. Speak of it in general words, such as the dark thoughts. Only when the <heavy_moment> block says plain naming is allowed may you name it, once in the whole conversation, as thoughts of ending your life (or as thoughts of suicide when the block allows that), and never more directly than they did. Never name an act, a detail or a method.`;
export const RULE_NO_PROMISE =
  `- Never promise that the pain will end soon, that everything will be fine, or when it will ease.`;

// The readers' twelve instructions of 2026-11-11, in their own words where they gave them (numbered as they numbered them).
export const RULE_ANSWER_THIS_PERSON =
  `- Answer this person. Your first sentence responds to the most specific thing they said: the loss they named, the hour, their request or their question. If they asked you something directly, answer it, or say kindly why you won't. Never write past it.`;
export const RULE_STOCK_PHRASES =
  `- Say these truths in fresh, plain words each time. Use "not the end of your story", "God is not finished with you", "your life matters deeply" and "what you are carrying" at most once in a conversation.`;
// The app's help line under a heavy answer begins with this sentence (src/constants/copy.ts reflection.help, and the spoken line
// below), so the answer above it never says it: in the evaluation of 2026-11-11, 7 of 18 answers did, and the line repeated them.
export const RULE_NOT_THE_LINE =
  `- The line under your answer begins “You don’t have to carry this alone.” Never write that sentence, or one close to it.`;
export const RULE_LENGTH =
  `- Write 50 to 110 words in two or three short paragraphs. Match how they wrote. A short message late at night gets a shorter, quieter answer.`;
export const RULE_ONE_STEP =
  `- One step, sized to the moment. If the danger is now or tonight, point to the help line under the message, as the <heavy_moment> block describes it, and say how they can reach it. Otherwise ask who one person is that they could tell today. Name at most two kinds of people.`;
export const RULE_ONE_QUESTION =
  `- Ask at most one question: who they could reach, or whether they will reach out now. On a later turn you may ask once whether they were able to tell someone. Never ask how, when or where, and never work through a list of questions.`;
export const RULE_LATER_TURNS =
  `- After the first heavy answer, do not repeat it. Answer what they ask now, with the same care, more briefly. Return to the next step every few turns, not every turn.`;
export const RULE_PRAY_WHEN_ASKED =
  `- If they ask for a prayer, pray. Never answer a request for prayer with advice alone. The prayer asks God for his nearness, for strength to get through today and for courage to reach out to someone, and it ends with trust in who he is.`;
export const RULE_HONEST_REFUSALS =
  `- When they ask for a promise you cannot make, or a ruling you should not give, say so kindly, then say what you can tell them.`;
export const RULE_WHEN_HURT =
  `- If someone is hurting them, do not tell them to leave, to stay, or to act at a particular time. Say that their fear is reasonable. Point them to the advocates at the help line under the message, and to the emergency number the <heavy_moment> block names if they are in danger now. Never tell them not to be afraid.`;
export const RULE_PASSAGE_LIST =
  `- Choose the passage only from the hard-moment passages below, by its key in passage_key, or none. Do not restate the passage. In one sentence, say why you chose it for them. Never use the same passage twice in a conversation.`;
export const RULE_NO_BUT = `- After naming their pain, never continue with "but". Use "and", or start a new sentence.`;
export const RULE_HARM_UNDERWAY =
  `- If they say they have already acted, or that danger is at the door, your first sentence tells them to call the emergency number the <heavy_moment> block names, now.`;

// The lines scholar-v1 had that only a conversation needs, kept: no quotation, no claim to be a person, no claim that anyone was
// told or that the conversation is confidential, and never an end to the conversation. And a line for a person under 18.
export const RULE_QUOTE_NOTHING =
  `- Quote nothing from their messages: no quotation marks anywhere in the reply or the prayer.`;
export const RULE_NOT_A_PERSON = `- Never claim to be a person, a pastor or a counselor.`;
export const RULE_NOBODY_TOLD =
  `- Never say that anyone has been told, that help is on its way, or that this conversation is confidential.`;
export const RULE_STAY = `- Never end the conversation, refuse to go on, or say you cannot talk about this. Stay.`;
export const RULE_UNDER_18 =
  `- If they say they are under 18, give them the same care, point them to the help line under the message and to a parent or another adult they trust, and set says_under_18 to true.`;

const PASSAGE_LINES = [
  `The hard-moment passages (passage_key, then what each is for):`,
  ...HARD_MOMENT_PASSAGES.map((item) => `- ${item.key} (${formatReference(item.ref)}): ${item.goodFor}.`),
];

// The rules of the section in the order it lists them.
export const HEAVY_CHAT_RULES: readonly string[] = [
  RULE_STAY_FIRST,
  RULE_ANSWER_THIS_PERSON,
  RULE_NEVER_DESCRIBE,
  HEAVY_RULE_WISH,
  HEAVY_RULE_NOT_DEATH,
  HEAVY_RULE_NOT_SIN,
  HEAVY_RULE_IF_HURT,
  RULE_WHEN_HURT,
  RULE_NO_PROMISE,
  RULE_HONEST_REFUSALS,
  RULE_ONE_STEP,
  RULE_ONE_QUESTION,
  RULE_LATER_TURNS,
  RULE_PRAY_WHEN_ASKED,
  HEAVY_RULE_PASSAGE,
  RULE_PASSAGE_LIST,
  RULE_STOCK_PHRASES,
  RULE_NOT_THE_LINE,
  RULE_LENGTH,
  RULE_NO_BUT,
  RULE_HARM_UNDERWAY,
  RULE_QUOTE_NOTHING,
  RULE_NOT_A_PERSON,
  RULE_NOBODY_TOLD,
  RULE_STAY,
  RULE_UNDER_18,
];

// The last section of Scholar's instruction (prompt.ts).
export const HEAVY_CHAT_SECTION = [`## A heavy moment`, INTRO, ...HEAVY_CHAT_RULES, ...PASSAGE_LINES].join("\n");

// ---- What the code holds every heavy answer to (output.ts) ------------------------------------------------------------------

// The phrases the readers counted in nearly every scholar-v1 answer. Each may appear once in a whole conversation (a soft check:
// a reply that repeats one is asked for again with a note, and kept when no better one comes).
export const STOCK_PHRASES: readonly string[] = [
  "not the end of your story",
  "god is not finished with you",
  "your life matters deeply",
  "what you are carrying",
  "glad you",
  // The help line's own first sentence (RULE_NOT_THE_LINE): counted here too, so a second use in a conversation is asked for again.
  "carry this alone",
];

// Plain naming (the counselor's question, answered yes narrowly): the one way an answer may name it, once in a conversation, and
// only when the person named it as plainly themselves. "life": they wrote it in words such as ending their life; "suicide": they
// used the word itself, which also allows the other phrase.
export type PlainNaming = "life" | "suicide" | null;

export function plainNamingPhrases(allowed: PlainNaming): string[] {
  if (allowed === "suicide") return ["thoughts of suicide", "thoughts of ending your life"];
  if (allowed === "life") return ["thoughts of ending your life"];
  return [];
}

export const ALL_PLAIN_NAMING_PHRASES: readonly string[] = plainNamingPhrases("suicide");

// ---- The block that follows the message (prompt.ts) ---------------------------------------------------------------------------

export type LocalTime = { label: string; part: "night" | "morning" | "afternoon" | "evening" };

// The person's clock, from the profile's time zone, so that "tonight" is said only at night. Null for a zone Intl does not know.
export function localTime(now: Date, zone: string): LocalTime | null {
  try {
    const format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const label = format.format(now).replace(/\s/g, " ");
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(now),
    );
    if (!Number.isInteger(hour)) return null;
    const part = hour < 5 || hour >= 21 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    return { label, part };
  } catch {
    return null;
  }
}

// What the help line under an answer is, in words the writer can point to, and what to do in danger now: both by the kind of help
// and the phone's region. Outside the US the app shows a directory of help lines, never a US number.
export function helpLineWords(help: HelpKind, region: Region): string {
  if (region === "other") {
    return help === "emergency"
      ? "their local emergency number"
      : "a link to a directory of help lines in their country";
  }
  if (help === "abuse") {
    return "the National Domestic Violence Hotline, whose advocates help with exactly this, day or night, by call or text";
  }
  if (help === "emergency") return "911";
  return "the 988 Suicide & Crisis Lifeline, by call or text, any time";
}

export function emergencyWords(region: Region): string {
  return region === "us" ? "911" : "their local emergency number (never name a number)";
}

export type HeavyFacts = {
  help: HelpKind;
  region: Region;
  // The first heavy answer of the conversation, or how many answers came before this one.
  firstAnswer: boolean;
  answersBefore: number;
  plainNaming: PlainNaming;
  usedPassages: readonly HardPassageKey[];
  time: LocalTime | null;
};

// The block that follows the message for a heavy answer (prompt.ts buildScholarTurn): what the help line under the answer is,
// what to do in danger now, the person's local time, whether this is a later turn, whether plain naming is allowed, and which
// passages may not be used. It comes from the app, never from the person, and it holds nothing they wrote.
export function buildHeavyBlock(facts: HeavyFacts): string {
  const naming = plainNamingPhrases(facts.plainNaming);
  const notAllowed = HARD_PASSAGE_KEYS.filter((key) =>
    !allowedPassageKeys(facts.help, facts.usedPassages).includes(key)
  );
  const lines = [
    "The app’s own check found signs of a risk to this person. Write by “A heavy moment”.",
    `The help line under your answer: ${helpLineWords(facts.help, facts.region)}.`,
    `If they are in danger right now: ${emergencyWords(facts.region)}.`,
    facts.help === "abuse"
      ? "Someone may be hurting them: write by the rules for when someone is hurting them, and never tell them not to be afraid."
      : "",
    facts.time === null ? "" : `Their local time: ${facts.time.label} (${facts.time.part}).`,
    facts.firstAnswer
      ? "This is the first heavy answer in this conversation."
      : `You have answered ${facts.answersBefore} ${
        facts.answersBefore === 1 ? "message" : "messages"
      } in this conversation already: do not repeat what you said, answer what they ask now, more briefly.`,
    naming.length === 0
      ? "Plain naming: not allowed. Speak of it only in general words."
      : `Plain naming: allowed once in this conversation, only as ${naming.join(" or as ")}.`,
    notAllowed.length === 0 ? "" : `Passages you may not use now: ${notAllowed.join(", ")}.`,
  ].filter((line) => line !== "");
  return ["<heavy_moment>", ...lines, "</heavy_moment>"].join("\n");
}

// ---- The written answers -----------------------------------------------------------------------------------------------------

// The written answer for a heavy message when no answer passes its checks in time, when anything fails in a conversation that is
// already heavy, or when the screening is down and the phrase list matched; and the emergency answer, which is written before any
// model is asked (harm already underway). The readers' words of 2026-11-11, with the app's curly apostrophes; the emergency one is
// a draft for the counselor to approve or replace, and every text outside the US is the app's adaptation, for the readers too.
// Each knows nothing of the conversation, so it repeats nothing: no quotation, no detail, no verse typed (its passage is read from
// the Bible like any passage, and left out when the Bible cannot be read).
export type FallbackVariant = "general" | "abuse" | "repeat" | "emergency";

const FALLBACK_TEXTS: Record<Region, Record<FallbackVariant, readonly string[]>> = {
  us: {
    general: [
      "Thank you for telling me. What you are carrying is real, and you don’t have to explain it well or make sense of it yet.",
      "God is with you in this moment, and he is not letting go of you. Your life matters to him, and it matters to people who would want to know how much you are hurting.",
      "Please don’t carry this alone today. Tell one person you trust what you told me, or call or text the line under this message. If you are in danger, get help right away. I’m still here, and you can keep talking with me.",
    ],
    abuse: [
      "Thank you for telling me. What is happening to you is not your fault, and you deserve to be safe.",
      "God sees you right now, and he is not far from you. He is on the side of the one being hurt.",
      "You don’t have to work this out by yourself. The people at the line under this message help with exactly this, day or night, by call or text. If you are in danger right now, call 911. I’m still here, and you can keep talking with me.",
    ],
    repeat: [
      "I’m still here. I may not have the right words for all of this, and I don’t want you to be alone with it.",
      "God has not moved away from you since you last wrote. He is as near now as he was then.",
      "If you haven’t yet, please tell one person today, or call or text the line under this message. You can keep talking with me too.",
    ],
    emergency: [
      "Please call 911 right now. If you can’t call, text 988 and tell them what has happened. If anyone is near you, go to them now.",
      "God is with you this minute, and he wants you to live. I’m staying here.",
    ],
  },
  other: {
    general: [
      "Thank you for telling me. What you are carrying is real, and you don’t have to explain it well or make sense of it yet.",
      "God is with you in this moment, and he is not letting go of you. Your life matters to him, and it matters to people who would want to know how much you are hurting.",
      "Please don’t carry this alone today. Tell one person you trust what you told me, or reach a help line in your country through the link under this message. If you are in danger, get help right away. I’m still here, and you can keep talking with me.",
    ],
    abuse: [
      "Thank you for telling me. What is happening to you is not your fault, and you deserve to be safe.",
      "God sees you right now, and he is not far from you. He is on the side of the one being hurt.",
      "You don’t have to work this out by yourself. A help line in your country can help with exactly this, and the link under this message finds one. If you are in danger right now, call your local emergency number. I’m still here, and you can keep talking with me.",
    ],
    repeat: [
      "I’m still here. I may not have the right words for all of this, and I don’t want you to be alone with it.",
      "God has not moved away from you since you last wrote. He is as near now as he was then.",
      "If you haven’t yet, please tell one person today, or reach a help line through the link under this message. You can keep talking with me too.",
    ],
    emergency: [
      "Please call your local emergency number right now. If anyone is near you, go to them now.",
      "God is with you this minute, and he wants you to live. I’m staying here.",
    ],
  },
};

// The card each written answer prefers, in order: the first this conversation may still show is used, and none is used when all
// are spent. The emergency answer has none, so nothing stands between the person and the number.
const FALLBACK_PASSAGES: Record<FallbackVariant, Record<"hurt" | "other", readonly HardPassageKey[]>> = {
  general: { hurt: ["PSA_9_9_10", "PSA_46_1", "ISA_42_3"], other: ["ISA_41_10", "PSA_46_1", "DEU_31_8"] },
  abuse: { hurt: ["PSA_9_9_10", "PSA_46_1", "ISA_42_3"], other: ["PSA_9_9_10", "PSA_46_1", "ISA_42_3"] },
  repeat: { hurt: ["PSA_46_1", "PSA_9_9_10", "ISA_42_3"], other: ["DEU_31_8", "PSA_46_1", "ISA_41_10"] },
  emergency: { hurt: [], other: [] },
};

// Which written answer: the emergency one for harm underway; the shorter one when a written answer has already appeared in this
// conversation (the same words twice read as a broken machine); the one for a person someone is hurting; otherwise the general one.
export function fallbackVariant(help: HelpKind, writtenBefore: boolean): FallbackVariant {
  if (help === "emergency") return "emergency";
  if (writtenBefore) return "repeat";
  if (help === "abuse") return "abuse";
  return "general";
}

export type HeavyChatFallback = { variant: FallbackVariant; reply: string; passageKey: HardPassageKey | null };

export function heavyChatFallback(
  variant: FallbackVariant,
  options: { help: HelpKind; region: Region; usedPassages: readonly HardPassageKey[] },
): HeavyChatFallback {
  const preferred = FALLBACK_PASSAGES[variant][options.help === "abuse" ? "hurt" : "other"];
  return {
    variant,
    reply: FALLBACK_TEXTS[options.region][variant].join("\n\n"),
    passageKey: firstAllowed(preferred, options.help, options.usedPassages),
  };
}

// The answer a person who says they are under 18 gets in an everyday conversation, after which Scholar closes for the account
// (scholar_closed_at). A draft for the owner and a lawyer: GraceHush is made for adults (the App Store rating is 18+). It holds the
// support address, so an adult the writer took for a child can ask for Scholar back.
export const ADULTS_ONLY_TEXT = [
  "Thank you for telling me. GraceHush is made for adults, so Scholar can’t keep talking with you here. Please bring what’s on your heart to a parent, a pastor or another adult you trust. God is near to you, and he cares about you more than you know.",
  "If you think this is a mistake, write to support@nouvrix.com.",
].join("\n\n");

// ---- The spoken help line ----------------------------------------------------------------------------------------------------

// The sentence spoken once after an answer with a help line is listened to: the app's own line for that kind and region
// (copy.reflection.help) with the numbers spelled out, as a voice reads them. This is the one place the server holds the numbers: a
// test keeps every line equal to the app's line and to the numbers of src/constants/crisisResources.ts, and the release check of
// the help numbers names this file too.
const SPOKEN_HELP_LINES: Record<Region, Record<HelpKind, string>> = {
  us: {
    crisis:
      "You don’t have to carry this alone. Call or text nine eight eight any time, or nine one one if you’re in danger.",
    harm_others:
      "You don’t have to carry this alone. Call or text nine eight eight any time, or nine one one if anyone is in danger.",
    abuse:
      "You don’t have to carry this alone. The National Domestic Violence Hotline helps day and night: call one eight hundred, seven nine nine, seven two three three or text START to eight eight seven eight eight. If you’re in danger right now, call nine one one.",
    emergency: "If you or someone near you is in danger right now, call nine one one.",
  },
  other: {
    crisis:
      "You don’t have to carry this alone. If you’re in danger, call your local emergency number. You can find a help line in your country at find a helpline dot com.",
    harm_others:
      "You don’t have to carry this alone. If you’re in danger, call your local emergency number. You can find a help line in your country at find a helpline dot com.",
    abuse:
      "You don’t have to carry this alone. If you’re in danger, call your local emergency number. You can find a help line in your country at find a helpline dot com.",
    emergency: "If you or someone near you is in danger right now, call your local emergency number.",
  },
};

export function spokenHelpLine(help: HelpKind, region: Region): string {
  return SPOKEN_HELP_LINES[region][help];
}

// The crisis line in the US, as scholar-v1 spoke it under every flagged answer.
export const SPOKEN_HELP_LINE = SPOKEN_HELP_LINES.us.crisis;
