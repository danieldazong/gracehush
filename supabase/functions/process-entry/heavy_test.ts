import { formatReference, type ScriptureRef } from "../_shared/bible/reference.ts";
import { assert, assertEquals } from "./testing/assert.ts";
import { LIMITS } from "./constants.ts";
import {
  DENIED_PASSAGES,
  HEAVY_FALLBACK_PASSAGE,
  HEAVY_INSTRUCTION,
  HEAVY_SHARED_RULES,
  heavyFallback,
  isDeniedPassage,
} from "./heavy.ts";
import { checkTone, countWords } from "./output.ts";
import {
  firstHeavyNeverSay,
  firstNeverSay,
  hasQuotation,
  hasStockOpening,
  hasVerseReference,
  HOOK_FEELING_WORDS,
  HOOK_MAX_WORDS,
  openingSentence,
  prayerVoice,
} from "./tone.ts";

// The written fallback (heavy.ts) and the passages a heavy moment never gets. The fallback is fixed text: these checks hold it
// to every rule a model's heavy reflection is held to, and to the instruction's targets.

const ref = (
  bookId: ScriptureRef["bookId"],
  chapter: number,
  verseStart: number,
  verseEnd = verseStart,
): ScriptureRef => ({
  bookId,
  chapter,
  verseStart,
  verseEnd,
});

// Made-up entries of every kind the fallback stands in for: it must pass whatever the person wrote.
const ENTRIES = [
  "",
  "I do not want to be alive anymore. I have been thinking about ending my life.",
  "My husband hit me again last night and I am scared to go home.",
  "Nothing feels worth it anymore.",
];

Deno.test("the fallback passes every hard and soft check, whatever the entry, as a heavy moment", () => {
  for (const entry of ENTRIES) {
    assertEquals(checkTone(heavyFallback(), entry), null, entry);
  }
});

Deno.test("the fallback keeps the instruction's targets: the hook, the lengths, the voice, nothing quoted or pointed to", () => {
  const fallback = heavyFallback();
  assertEquals(fallback.heavy, true);
  assertEquals(fallback.prayer, null, "a heavy moment is never made a prayer");
  // The devotional: 110 to 150 words in three or four paragraphs, a hook of at most twelve words with no feeling word.
  const words = countWords(fallback.devotional);
  assert(words >= 110 && words <= 150, `the devotional has ${words} words`);
  const paragraphs = fallback.devotional.split("\n\n");
  assert(paragraphs.length >= 3 && paragraphs.length <= 4);
  const hook = openingSentence(fallback.devotional);
  assert(countWords(hook) <= HOOK_MAX_WORDS, hook);
  assert(!HOOK_FEELING_WORDS.test(hook), hook);
  assert(!hasStockOpening(fallback.devotional));
  // Short sentences for the voice: none over 25 words, no numerals, no semicolons or parentheses.
  for (const sentence of fallback.devotional.split(/(?<=[.!?])\s+/)) {
    assert(countWords(sentence) <= 25, sentence);
  }
  assert(!/[\d;()]/.test(fallback.devotional + fallback.closingPrayer));
  // The prayer: the person's own, 30 to 50 words.
  const prayerWords = countWords(fallback.closingPrayer);
  assert(prayerWords >= 30 && prayerWords <= 50, `the prayer has ${prayerWords} words`);
  assertEquals(prayerVoice(fallback.closingPrayer, ""), "i");
  // Nothing quoted, no verse pointed to, nothing either never-say list holds, anywhere.
  const read = [
    fallback.title,
    fallback.validationLine ?? "",
    fallback.devotional,
    fallback.closingPrayer,
    ...fallback.affirmations.flatMap((item) => [item.headline, item.text]),
  ];
  for (const part of read) {
    assert(!hasQuotation(part), part);
    assert(!hasVerseReference(part), part);
    assertEquals(firstNeverSay(part), null, part);
    assertEquals(firstHeavyNeverSay(part), null, part);
    assert(!part.includes("'"), "typographic apostrophes only");
  }
  // The title and the headlines can reach a lock screen.
  assert(fallback.title.length <= 40 && /^(?:[A-Z][a-z]*)(?: [A-Z][a-z]*)+$/.test(fallback.title), fallback.title);
  for (const item of fallback.affirmations) {
    assert(item.headline.length <= LIMITS.affirmationHeadline.maxChars, item.headline);
    const textWords = countWords(item.text);
    assert(textWords >= 12 && textWords <= 30, item.text);
  }
  assertEquals(fallback.affirmations.map((item) => item.slot), ["morning", "afternoon", "evening"]);
  // The next step is a person, as the instruction asks.
  assert(fallback.devotional.includes("Reach out to someone you trust"));
});

Deno.test("the fallback's passage is Isaiah 41:10, never one a heavy moment is denied", () => {
  assertEquals(formatReference(HEAVY_FALLBACK_PASSAGE), "Isaiah 41:10");
  assertEquals(heavyFallback().scripture, HEAVY_FALLBACK_PASSAGE);
  assert(!isDeniedPassage(HEAVY_FALLBACK_PASSAGE));
});

Deno.test("a denied passage is denied whenever any of its verses falls in a range; a whole chapter when the range names none", () => {
  assert(isDeniedPassage(ref("PHP", 1, 21)));
  assert(isDeniedPassage(ref("PHP", 1, 18, 20)), "the run overlaps the range's first verse");
  assert(isDeniedPassage(ref("PHP", 1, 26, 27)), "the run overlaps the range's last verse");
  assert(!isDeniedPassage(ref("PHP", 1, 6)), "the same chapter outside the range");
  assert(!isDeniedPassage(ref("PHP", 4, 6, 7)));
  assert(isDeniedPassage(ref("JOB", 3, 26)), "Job 3 is denied whole");
  assert(isDeniedPassage(ref("PSA", 88, 1)));
  assert(!isDeniedPassage(ref("PSA", 23, 1, 3)));
  assert(!isDeniedPassage(ref("PSA", 34, 18)));
  assert(isDeniedPassage(ref("EPH", 5, 22)), "a call to submit");
  assert(isDeniedPassage(ref("MAT", 18, 22)), "a call to forgive without end");
  assert(isDeniedPassage(ref("1CO", 13, 7)), "love bears all things");
  assert(isDeniedPassage(ref("2CO", 5, 8)), "away from the body, at home with the Lord");
  // Every range is well formed: a chapter, and a run whose end is not before its start.
  for (const range of DENIED_PASSAGES) {
    assert(range.chapter >= 1);
    if (range.from !== undefined) assert(range.to === undefined || range.to >= range.from, JSON.stringify(range));
  }
});

Deno.test("the instruction's heavy section holds no number and names no service: the app shows the one line itself", () => {
  assert(!/\d/.test(HEAVY_INSTRUCTION));
  assert(!/hotline|lifeline|988|911/i.test(HEAVY_INSTRUCTION));
});

// Step 38: HEAVY_INSTRUCTION is built from the shared rules (HEAVY_SHARED_RULES, which a Scholar answer follows too) and the
// lines only a reflection has. It must stay byte for byte what gen-v2.4 to gen-v2.6 sent: this is that text, frozen.
const FROZEN_HEAVY_INSTRUCTION = `## A heavy moment
Some entries carry a risk to the person: thoughts of ending their life or of harming themselves, harm someone is doing to them, an intention to harm someone else, or danger happening right now. When the entry shows any of these, or a <heavy_moment> block follows it, set is_crisis to true and still write the whole reflection in full, by every rule above and by these on top of them. These rules come first wherever they meet another rule, "The person" and "The first line" included. The person may be in the darkest hour they have known: every part of the reflection, the line, the devotional, the passage, the prayer and the affirmations, should lift them toward hope, toward God and toward the people around them.
- Stay with them first. Name the pain in plain words and honor it as real, without alarm and without a lecture. Then declare who God is to them right now: present, tender, holding on to them. Tell them their life matters to him and to the people around them.
- Never repeat or describe what they wrote about dying, ending their life, harming themselves or someone else, or how: no method, no means, no place, no plan. Never say it in other words either, softened or denied: not sleeping and not waking, wanting it all to stop, disappearing, being gone, the only relief, a way out. Speak of it only in general words, such as "the dark thoughts" or "what you are carrying right now". The title, the validation line, the first line and the headlines name the pain and the weariness, never the wish.
- Never say that the wish makes sense or is understandable. Honor the pain as real; never the wish.
- Never present death as rest, relief, release, peace, an escape or an answer, or as a way to be with God or with someone they lost. Never say that heaven is waiting or that God is calling them home. Speak of God's nearness in this life, here and now.
- Never call their thoughts or feelings a sin, selfish, weak or a lack of faith. Never suggest that God sent this pain, is testing them, or is disappointed in them.
- If someone is hurting them, say plainly that it is not their fault and that they deserve to be safe. Never tell them to forgive, obey, submit to, stay with or protect the person who is hurting them, and never suggest that they caused it.
- Never promise that the pain will end soon or that everything will be fine. You may say that this moment is not the end of their story, and that God is not finished with them.
- The gentle next step is a person: urge them, warmly and plainly, to reach out today to someone they trust, a pastor or a counselor, and to get help right away if they are in danger. Say it the way someone who loves them would.
- Quote nothing from the entry: no echo, and no quotation marks anywhere in the devotional or the closing prayer.
- The passage comforts and steadies: God's nearness, his care for the weak, his strength, a love that holds on. Never a passage that speaks of wanting to die, of death as gain or as rest, of departing to be with God, of judgment or punishment, or of submitting to or forgiving someone who does harm.
- The closing prayer asks God for his nearness, for strength to get through today and for courage to reach out to someone, and it ends with trust in who he is.
- The affirmations speak hope and God's presence for the hours ahead, never the danger.
- Set is_active_prayer to false: the person can keep praying about it from their own screen.`;

Deno.test("the reflection's heavy section is still the frozen text, and every shared rule is in it", () => {
  assertEquals(HEAVY_INSTRUCTION, FROZEN_HEAVY_INSTRUCTION);
  assertEquals(HEAVY_SHARED_RULES.length, 9);
  for (const rule of HEAVY_SHARED_RULES) {
    assert(rule.startsWith("- "), rule);
    assert(HEAVY_INSTRUCTION.includes(rule), rule);
  }
});
