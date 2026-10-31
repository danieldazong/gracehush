import { parseReference, spokenReference } from "../bible/reference.ts";

// The words that are read aloud (step 22), built from the saved devotional and written for Cloud Text-to-Speech's Chirp 3
// HD voices, which take a `markup` field: plain text with the pause tags [pause short], [pause] and [pause long]
// (docs.cloud.google.com/text-to-speech/docs/chirp3-hd, read on 2026-10-23: "pause tags will only work in the markup
// field"). Nothing the model wrote reaches the voice as it was: every field is cleaned first, and a tag in it is removed
// together with what is inside it, so the model cannot add a pause, a sound or an instruction.
//
// The order is: the devotional (a pause between paragraphs), the passage with a spoken reference (only when the caller
// says it is verified: the caller passes null otherwise), and the closing prayer ending in "Amen.". Nothing comes before
// the devotional: its first sentence is its hook, the first thing heard (decided 2026-10-31: a fixed "Here is your
// devotional." made every one sound the same, and a title read first delayed the hook and repeated across a person's
// devotionals). The request may hold 5,000 bytes (the quotas page), so when the whole script is over MAX_SCRIPT_BYTES the
// passage is left out first, then the prayer. The devotional is never cut. Where even it does not fit, there is no script
// (null).

// Cloud Text-to-Speech takes 5,000 bytes a request; this leaves a margin for what the count might include.
export const MAX_SCRIPT_BYTES = 4_800;

const PRAYER_INTRO = "Let's pray.";
const AMEN = "Amen.";

export type SpeechInput = {
  devotional: string;
  // Only a verified passage, with the stored reference ("Philippians 4:6–7") and its text. Null: no reading.
  scripture: { reference: string; text: string } | null;
  closingPrayer: string | null;
};

export type SpeechScript = {
  markup: string;
  chars: number; // what Google bills: every character of the markup, tags included
  bytes: number;
  scripture: boolean; // whether the passage is in the script
  prayer: boolean; // whether the closing prayer is in the script
};

const ZERO_WIDTH_AND_CONTROL = new RegExp(
  "[" + [
    "\\u0000-\\u0008",
    "\\u000b\\u000c",
    "\\u000e-\\u001f",
    "\\u007f-\\u009f",
    "\\u200b-\\u200d",
    "\\u2060",
    "\\ufe00-\\ufe0f", // the variation selectors that follow an emoji
    "\\u20e3", // the keycap mark
    "\\ufeff",
  ].join("") + "]",
  "g",
);

// Makes one piece of text safe to read aloud: no tag, bracket or markdown mark, no emoji, one kind of quote and dash,
// single spaces. A tag or a bracketed span goes with its content ("[pause long]" is not spoken as "pause long").
export function cleanForSpeech(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[[\]<>{}]/g, " ")
    .replace(/[*_#`~^|\\]/g, " ")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}]/gu, "")
    .replace(ZERO_WIDTH_AND_CONTROL, "") // not a tab or a line break: the whitespace step below handles those
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—―]/g, ", ")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,(\s*,)+/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .trim();
}

// The BSB writes God's name in capitals (the LORD, the Lord GOD), and a voice may spell a capitalised word out letter by
// letter. Said aloud they are Lord and God. Only used on the passage: no other text holds a word like that.
function wordsNotLetters(text: string): string {
  return text.replace(/\b[A-Z]{2,}\b/g, (word) => word[0] + word.slice(1).toLowerCase());
}

// A prayer that already ends in "Amen" (older rows may) is not given a second one, and a prayer always ends a sentence.
function prayerText(prayer: string): string {
  let text = prayer.replace(/[\s.!"']*\bamen\b[\s.!"']*$/i, "").trim();
  if (text === "") return "";
  if (!/[.!?"']$/.test(text)) text += ".";
  return text;
}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function buildSpeechScript(input: SpeechInput): SpeechScript | null {
  const paragraphs = input.devotional.split(/\n\s*\n/).map(cleanForSpeech).filter((paragraph) => paragraph !== "");
  if (paragraphs.length === 0) return null;

  let reading: string[] | null = null;
  if (input.scripture !== null) {
    const ref = parseReference(input.scripture.reference);
    const verse = cleanForSpeech(wordsNotLetters(input.scripture.text));
    // A reference that cannot be read, or a verse with nothing left, is no reading: never a guess.
    if (ref !== null && verse !== "") {
      reading = ["[pause long]", `A reading from ${spokenReference(ref)}.`, "[pause short]", verse];
    }
  }

  const cleanedPrayer = input.closingPrayer === null ? "" : prayerText(cleanForSpeech(input.closingPrayer));
  const prayer = cleanedPrayer === "" ? null : [PRAYER_INTRO, "[pause short]", cleanedPrayer, AMEN];

  // The most that fits comes first: everything, then without the passage, then without the prayer too.
  const attempts: { reading: boolean; prayer: boolean }[] = [
    { reading: reading !== null, prayer: prayer !== null },
    { reading: false, prayer: prayer !== null },
    { reading: false, prayer: false },
  ];
  const seen = new Set<string>();
  for (const attempt of attempts) {
    const key = `${attempt.reading}${attempt.prayer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = [paragraphs.join(" [pause] ")];
    if (attempt.reading && reading !== null) parts.push(...reading);
    // A pause before the prayer, longer after a reading. Nothing follows the last words: no silence at the end.
    if (attempt.prayer && prayer !== null) parts.push(attempt.reading ? "[pause long]" : "[pause]", ...prayer);
    const markup = parts.join(" ");
    const bytes = bytesOf(markup);
    if (bytes <= MAX_SCRIPT_BYTES) {
      return {
        markup,
        chars: Array.from(markup).length,
        bytes,
        scripture: attempt.reading && reading !== null,
        prayer: attempt.prayer && prayer !== null,
      };
    }
  }
  return null;
}
