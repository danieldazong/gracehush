import { parseReference, spokenReference } from "../bible/reference.ts";
import { cleanForSpeech } from "../tts/script.ts";
import { SPEECH_PART_CHARS } from "./constants.ts";
import type { StoredBlock } from "./prompt.ts";

// What scholar-speak reads aloud (step 38): one saved answer, in the order of its blocks, cut into parts the app plays one after
// another. The first part is short so that the voice starts soon; every part ends a sentence, and a sentence longer than a part
// stays whole. A block starts a new part, so a reading never runs on from the answer. Every piece of text goes through
// cleanForSpeech (tags, brackets, markdown and emoji removed), so nothing the model wrote reaches the voice as markup. The parts
// hold no pause tag: the gap between two parts is the pause.

const PRAYER_INTRO = "Let's pray.";
const AMEN = "Amen.";

// The Berean Standard Bible writes God's name in capitals (the LORD), which a voice may spell out letter by letter.
function wordsNotLetters(text: string): string {
  return text.replace(/\b[A-Z]{2,}\b/g, (word) => word[0] + word.slice(1).toLowerCase());
}

// The sentences of a cleaned text: a break after an end mark (and any closing quote or bracket), where a space follows.
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?]["')]*)\s+/).map((part) => part.trim()).filter((part) => part !== "");
}

// The sentences of one block, as they are spoken.
function blockSentences(block: StoredBlock): string[] {
  if (block.type === "text") {
    return block.text.split(/\n\s*\n/).flatMap((paragraph) => sentences(cleanForSpeech(paragraph)));
  }
  if (block.type === "passage") {
    const ref = parseReference(block.reference);
    const verse = cleanForSpeech(wordsNotLetters(block.text));
    // A reference that cannot be read, or a verse with nothing left, is no reading: never a guess.
    if (ref === null || verse === "") return [];
    return [`A reading from ${spokenReference(ref)}.`, ...sentences(verse)];
  }
  const prayer = cleanForSpeech(block.text).replace(/[\s.!"']*\bamen\b[\s.!"']*$/i, "").trim();
  if (prayer === "") return [];
  return [PRAYER_INTRO, ...sentences(/[.!?"']$/.test(prayer) ? prayer : `${prayer}.`), AMEN];
}

// `helpLine`: the sentence spoken once after the answer (heavyChat.ts spokenHelpLine, chosen by the answer's help line and the
// phone's region), or null for an answer that has none.
export function buildScholarSpeech(blocks: readonly StoredBlock[], options: { helpLine: string | null }): string[] {
  const parts: string[] = [];
  for (const block of blocks) {
    let current = "";
    for (const sentence of blockSentences(block)) {
      const limit = parts.length === 0 ? SPEECH_PART_CHARS.first : SPEECH_PART_CHARS.rest;
      if (current === "") {
        current = sentence;
      } else if (`${current} ${sentence}`.length <= limit) {
        current = `${current} ${sentence}`;
      } else {
        parts.push(current);
        current = sentence;
      }
    }
    if (current !== "") parts.push(current);
  }
  if (options.helpLine !== null && parts.length > 0) parts.push(cleanForSpeech(options.helpLine));
  return parts;
}
