// Crisis screening, layer 1 (step 21): a short backstop of explicit first-person statements about wanting to die, ending
// one's life, hurting oneself, not wanting to be alive, or hurting someone else.
//
// It exists so that the plainest statements never depend on a model's mood: a match is a crisis even if the screening
// model says the entry is clear, and for a written entry it is checked before the model is called at all. It is blunt on
// purpose. A negation ("I'm not suicidal anymore") still matches, and a rare figure of speech may too: a calm screen for
// someone who did not need it costs far less than a devotional for someone who did.
//
// Server-only. The list is never sent to the client, never shown to anyone and never logged, and neither is what matched.
// It holds no method or means of any kind, and nothing here may ever be extended with one.

// A template is a phrase with groups of alternatives: "i want to (die|be dead)" stands for two phrases. Every phrase is
// written in the form normalizeForMatch gives a text (lower case, no punctuation, contractions spelled out, no filler
// words), which phrases_test.ts checks.
const TEMPLATES = [
  // Wanting to die, or not wanting to be alive.
  "i want to (die|be dead)",
  "i (wish|wished) i (was|were) dead",
  "i do not want to be alive",
  // Plain "i do not want to live" is also what people pray about living in fear or in the past, so only the endings
  // that mean no more life count.
  "i do not want to live (anymore|any more|any longer|another day)",
  "better off dead",
  "suicidal",
  "i (want to|am going to|am planning to|will) commit suicide",
  // Ending one's own life. Not "take my life": that is a line of a hymn and of many prayers of surrender.
  "(end|ending|take|taking) my own life",
  "(end|ending) my life",
  "(want to|going to) end it all",
  // Hurting or killing oneself.
  "i want to (kill|hurt|harm) myself",
  "i am (going|planning|trying) to (kill|hurt|harm) myself",
  "i will (kill|hurt|harm) myself",
  "i (might|should) kill myself",
  "(thinking|thought|thoughts) (about|of) (killing|hurting|harming) myself",
  // Intent to harm someone else.
  "i want to (kill|murder|hurt) (him|her|them|someone|somebody)",
  "i am going to (kill|murder|hurt) (him|her|them|someone|somebody)",
  "i will (kill|murder|hurt) (him|her|them|someone|somebody)",
];

// Everyday Christian speech that contains a phrase above but means something else. It is removed from the text before
// the phrases are looked for, so "I want to die to self and live for Christ" is not a crisis and "I want to die to be
// with Jesus" still is.
const BENIGN_TEMPLATES = [
  "(die|dying|be dead|dead) to (self|myself|sin|sins|my flesh|the flesh|my pride|my ego|the world|my old self)",
  // "ready to end my life of sin", "that would end my life as I know it".
  "(end|ending) my life (of|as)",
];

function expand(template: string): string[] {
  const group = /\(([^()]*)\)/;
  const found = group.exec(template);
  if (!found) return [template];
  return found[1].split("|").flatMap((option) => expand(template.replace(group, () => option)));
}

// Exported for the tests only.
export const CRISIS_PHRASES: readonly string[] = TEMPLATES.flatMap(expand);
export const BENIGN_IDIOMS: readonly string[] = BENIGN_TEMPLATES.flatMap(expand);

const CONTRACTIONS = new Map([
  ["i'm", "i am"],
  ["im", "i am"],
  ["i'll", "i will"],
  ["don't", "do not"],
  ["dont", "do not"],
  ["wanna", "want to"],
  ["gonna", "going to"],
]);

// Words that only strengthen a statement ("I just want to die"). They are dropped so one phrase covers all of them.
const FILLERS = new Set([
  "just",
  "really",
  "truly",
  "honestly",
  "actually",
  "literally",
  "still",
  "now",
  "so",
  "also",
  "sometimes",
  "often",
  "always",
  "constantly",
]);

// The curly single quotes (U+2018, U+2019), the modifier apostrophe (U+02BC), the grave accent and the acute accent: the
// marks a phone keyboard or a speech transcript uses where a straight apostrophe belongs.
const QUOTE_LOOKALIKES = new RegExp(`[${String.fromCharCode(0x2018, 0x2019, 0x02bc, 0x60, 0xb4)}]`, "g");

// Lower case, curly quotes straightened, every character that is not a letter, a digit or an apostrophe turned into a
// space (so "die.Please" is two words), quote marks around a word removed, the common contractions spelled out and the
// filler words dropped. The result is single-spaced.
export function normalizeForMatch(text: string): string {
  const words = text
    .toLowerCase()
    .replace(QUOTE_LOOKALIKES, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
  return words
    .flatMap((word) => (CONTRACTIONS.get(word) ?? word).split(" "))
    .filter((word) => !FILLERS.has(word))
    .join(" ");
}

// True when the text holds one of the phrases as whole words. Spaces are put on both ends so "diet" is not "die".
export function matchCrisisPhrase(text: string): boolean {
  let padded = ` ${normalizeForMatch(text)} `;
  for (const idiom of BENIGN_IDIOMS) padded = padded.replaceAll(` ${idiom} `, "  ");
  return CRISIS_PHRASES.some((phrase) => padded.includes(` ${phrase} `));
}
