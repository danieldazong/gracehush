import { hydrateScripture } from "../bible/hydrate.ts";
import { formatReference, MAX_VERSE_SPAN, parseReference, type ScriptureRef } from "../bible/reference.ts";
import { isDeniedPassage } from "../../process-entry/heavy.ts";
import { TYPED_VERSE_LOOKUPS, TYPED_VERSE_RUN } from "./constants.ts";

// Scholar's passages (step 38). Bible words reach a person only as a passage card, read from the Berean Standard Bible by the
// Bible code (hydrateScripture): the model says where a passage is and never types it. Only a verified passage becomes a card;
// a passage that does not exist, is too long or cannot be read right now is left out (Scholar has no "confirming" state), and one
// that does not end a sentence is completed to its end in an everyday conversation, or left out (verify). In a heavy conversation a passage from DENIED_PASSAGES is never shown (since scholar-v2 a heavy answer
// chooses from the hard-moment list, heavyChat.ts), and the handler names a fallback card for an answer that must not be without
// one: the first heavy answer of a conversation.

export type PassageRole = "lead" | "support";

// A card: the passage's place, the reference as the app shows it, and the Bible's own words.
export type PassageCard = { role: PassageRole; ref: ScriptureRef; reference: string; text: string };

export type ResolvedPassages = { lead: PassageCard | null; support: PassageCard | null; bibleMs: number };

// True when a card ends a sentence (2026-11-11, the readers: Psalm 46:1–2 ended on a comma). A psalm verse may end with the
// BSB's "Selah" after its last sentence, and closing quote marks and brackets are set aside.
export function endsSentence(text: string): boolean {
  const tail = text.trim().replace(/\s+Selah$/, "").replace(/[”’"')\]]+$/, "");
  return /[.!?]$/.test(tail);
}

// A card that stops mid-sentence (the evaluation of 2026-11-11: Matthew 28:19 ends on a comma, Philippians 2:5 on a colon) is
// completed one verse at a time, within the chapter and within six verses (MAX_VERSE_SPAN), to the end of its sentence, and left
// out when the sentence goes on past that. It is grown only in an everyday conversation: a heavy answer's cards come from the
// readers' list, as the pastor read them, and one that stops mid-sentence is left out rather than grown past what they read.
async function verify(ref: ScriptureRef, role: PassageRole, complete: boolean): Promise<PassageCard | null> {
  const result = await hydrateScripture(ref);
  if (result.status !== "verified") return null;
  if (endsSentence(result.text)) return { role, ref: result.ref, reference: result.reference, text: result.text };
  if (!complete) return null;
  for (let verseEnd = result.ref.verseEnd + 1; verseEnd - result.ref.verseStart <= MAX_VERSE_SPAN; verseEnd += 1) {
    const longer = await hydrateScripture({ ...result.ref, verseEnd });
    // A verse the chapter does not have (its end, or a number the BSB leaves out), or a card grown too long: left out.
    if (longer.status !== "verified") return null;
    if (endsSentence(longer.text)) return { role, ref: longer.ref, reference: longer.reference, text: longer.text };
  }
  return null;
}

export async function resolvePassages(
  picks: { lead: ScriptureRef | null; support: ScriptureRef | null },
  // `fallback`: the card a heavy answer gets when neither pick can be shown, or null for none.
  options: { heavy: boolean; fallback?: ScriptureRef | null },
): Promise<ResolvedPassages> {
  const started = Date.now();
  const allowed = (ref: ScriptureRef | null): ref is ScriptureRef =>
    ref !== null && !(options.heavy && isDeniedPassage(ref));
  const complete = !options.heavy;
  const [lead, support] = await Promise.all([
    allowed(picks.lead) ? verify(picks.lead, "lead", complete) : Promise.resolve(null),
    allowed(picks.support) ? verify(picks.support, "support", complete) : Promise.resolve(null),
  ]);
  let supporting = support;
  if (options.heavy && options.fallback && lead === null && supporting === null) {
    supporting = await verify(options.fallback, "support", false);
  }
  return { lead, support: supporting, bibleMs: Date.now() - started };
}

// ---- The typed-verse guard ---------------------------------------------------------------------------------------------

// What the next attempt is told when a reply typed Bible words. It names the rule and nothing of the person's.
export const TYPED_VERSE_NOTE =
  "Your last reply typed the words of a Bible passage. Write the whole reply again: name each passage by its reference and say what it teaches in your own words, with no Bible words in the reply or the prayer.";

// Words, lowercased, with punctuation and quote marks set aside (an apostrophe inside a word is kept, in one shape).
function words(text: string): string[] {
  return text.toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

// True when the text and the passage share a run of `run` words in a row.
export function sharesRun(text: string, passage: string, run = TYPED_VERSE_RUN): boolean {
  const verse = words(passage);
  const said = words(text);
  if (verse.length < run || said.length < run) return false;
  const runs = new Set<string>();
  for (let start = 0; start + run <= verse.length; start += 1) runs.add(verse.slice(start, start + run).join(" "));
  for (let start = 0; start + run <= said.length; start += 1) {
    if (runs.has(said.slice(start, start + run).join(" "))) return true;
  }
  return false;
}

// A book name (with its number) followed by chapter:verse, or chapter:verse–verse. "John 3" alone names no verse to compare.
const NAMED =
  /(?<![\p{L}\p{N}])((?:[123]\s?)?\p{Lu}\p{Ll}+(?:\s+of\s+\p{Lu}\p{Ll}+)?)\.?\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/gu;

// The passages a text names, each once, in the order first named, as the Bible code reads a reference (parseReference).
export function namedReferences(text: string): ScriptureRef[] {
  const found: ScriptureRef[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(NAMED)) {
    const written = `${match[1]} ${match[2]}:${match[3]}${match[4] ? `–${match[4]}` : ""}`;
    const ref = parseReference(written);
    if (ref === null) continue;
    const key = formatReference(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(ref);
  }
  return found;
}

// Whether the reply or the prayer typed a passage's words: a card's, or a passage the reply names and the app does not show
// (at most TYPED_VERSE_LOOKUPS of those are read). A named passage that cannot be read is not checked.
export async function findTypedVerse(texts: readonly string[], cards: readonly PassageCard[]): Promise<boolean> {
  const passages = cards.map((card) => card.text);
  const shown = new Set(cards.map((card) => card.reference));
  const named = namedReferences(texts.join("\n"))
    .filter((ref) => !shown.has(formatReference(ref)))
    .slice(0, TYPED_VERSE_LOOKUPS);
  for (const result of await Promise.all(named.map(hydrateScripture))) {
    if (result.status === "verified") passages.push(result.text);
  }
  return texts.some((text) => passages.some((passage) => sharesRun(text, passage)));
}
