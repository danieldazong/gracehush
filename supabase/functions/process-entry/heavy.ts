import type { UsfmBookId } from "../_shared/bible/books.ts";
import type { ScriptureRef } from "../_shared/bible/reference.ts";
import type { ReadyReflection } from "./output.ts";

// A heavy moment (gen-v2.4, 2026-11-08, the owner's decision). An entry that shows a risk to the person (thoughts of ending
// their life or of self-harm, harm someone is doing to them, an intention to harm someone else, danger now) gets a whole
// reflection like any other: a devotional, a passage, a closing prayer, three affirmations and the audio. Until 2026-11-08 it
// got a support screen and nothing else; the app now shows one quiet line with 988 under the devotional instead.
//
// Three things here, all pure: the instruction's section for a heavy moment, the passages a heavy moment never gets, and the
// written fallback for the rare reflection the model cannot write (a request a safety filter blocks, a recording blocked before
// its words were read, or no usable reply in the time there is). A person in a heavy moment never gets "try again".

// ---- The instruction ---------------------------------------------------------------------------------------------------

// The section prompt.ts puts at the end of the reflection's instruction. Its rules come first wherever they meet another one:
// nothing about dying or harm is repeated, death is never relief or a way home, nobody who is being hurt is told to forgive,
// obey or stay, and the gentle next step is always a person.
export const HEAVY_INSTRUCTION = `## A heavy moment
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

// ---- The passages a heavy moment never gets ----------------------------------------------------------------------------

// A chapter, or a run of verses in it. Typed by book id, so a misspelled id does not compile.
type DeniedRange = { book: UsfmBookId; chapter: number; from?: number; to?: number };

// Passages that could be heard as death being gain, rest or a way home, as someone asking to die or ending their own life, as
// the body being destroyed by God, as a call to submit to, forgive or endure someone who does harm, or as punishment. Each is
// right in its place in the Bible; none is right for someone in the darkest hour, so a heavy moment that is given one gets
// another (scripture.ts). The model is told the same in the instruction; this is the check.
export const DENIED_PASSAGES: readonly DeniedRange[] = [
  // Death as gain, as rest, as a departure or a release.
  { book: "PHP", chapter: 1, from: 20, to: 26 },
  { book: "2CO", chapter: 5, from: 1, to: 10 },
  { book: "REV", chapter: 14, from: 13, to: 13 },
  { book: "REV", chapter: 21, from: 1, to: 8 },
  { book: "1TH", chapter: 4, from: 13, to: 18 },
  { book: "JHN", chapter: 14, from: 1, to: 3 },
  { book: "ISA", chapter: 57, from: 1, to: 2 },
  { book: "PSA", chapter: 116, from: 15, to: 15 },
  { book: "ROM", chapter: 14, from: 7, to: 9 },
  { book: "1CO", chapter: 15, from: 50, to: 58 },
  { book: "2TI", chapter: 4, from: 6, to: 8 },
  { book: "LUK", chapter: 2, from: 29, to: 32 },
  { book: "ECC", chapter: 4, from: 1, to: 3 },
  { book: "ECC", chapter: 7, from: 1, to: 2 },
  // Someone asking to die, or a death by their own hand.
  { book: "JOB", chapter: 3 },
  { book: "JOB", chapter: 6, from: 8, to: 11 },
  { book: "JOB", chapter: 7, from: 15, to: 16 },
  { book: "JOB", chapter: 10, from: 1, to: 1 },
  { book: "JOB", chapter: 10, from: 18, to: 22 },
  { book: "JOB", chapter: 14, from: 13, to: 13 },
  { book: "NUM", chapter: 11, from: 15, to: 15 },
  { book: "1KI", chapter: 19, from: 4, to: 4 },
  { book: "1KI", chapter: 16, from: 18, to: 18 },
  { book: "JON", chapter: 4, from: 3, to: 3 },
  { book: "JON", chapter: 4, from: 8, to: 9 },
  { book: "PSA", chapter: 88 },
  { book: "MAT", chapter: 27, from: 3, to: 5 },
  { book: "2SA", chapter: 17, from: 23, to: 23 },
  { book: "1SA", chapter: 31, from: 3, to: 6 },
  { book: "JDG", chapter: 16, from: 28, to: 30 },
  { book: "ACT", chapter: 16, from: 27, to: 27 },
  // The body as a temple that God destroys, or as not one's own.
  { book: "1CO", chapter: 3, from: 16, to: 17 },
  { book: "1CO", chapter: 6, from: 19, to: 20 },
  // Submission, endurance and forgiveness, which can be heard as a call to stay with someone who does harm.
  { book: "EPH", chapter: 5, from: 21, to: 24 },
  { book: "COL", chapter: 3, from: 13, to: 13 },
  { book: "COL", chapter: 3, from: 18, to: 18 },
  { book: "1PE", chapter: 2, from: 18, to: 25 },
  { book: "1PE", chapter: 3, from: 1, to: 6 },
  { book: "TIT", chapter: 2, from: 3, to: 5 },
  { book: "MAT", chapter: 5, from: 38, to: 42 },
  { book: "MAT", chapter: 6, from: 14, to: 15 },
  { book: "MAT", chapter: 18, from: 21, to: 35 },
  { book: "MRK", chapter: 11, from: 25, to: 26 },
  { book: "LUK", chapter: 6, from: 27, to: 36 },
  { book: "LUK", chapter: 17, from: 3, to: 4 },
  { book: "ROM", chapter: 13, from: 1, to: 2 },
  { book: "1CO", chapter: 13, from: 4, to: 7 },
  // Discipline and punishment.
  { book: "HEB", chapter: 12, from: 5, to: 11 },
  { book: "PRO", chapter: 3, from: 11, to: 12 },
];

// True when any verse of the passage falls in a denied range (a whole chapter when the range names no verses).
export function isDeniedPassage(ref: ScriptureRef): boolean {
  return DENIED_PASSAGES.some((range) =>
    range.book === ref.bookId && range.chapter === ref.chapter &&
    (range.from === undefined || (ref.verseStart <= (range.to ?? range.from) && ref.verseEnd >= range.from))
  );
}

// ---- The written fallback ----------------------------------------------------------------------------------------------

// The passage of the fallback, and the one a heavy moment gets when no other comforting passage can be found: Isaiah 41:10
// (presence, strength, help; nothing about guilt). Its words are read from the Bible like any passage's, never typed here.
export const HEAVY_FALLBACK_PASSAGE: ScriptureRef = { bookId: "ISA", chapter: 41, verseStart: 10, verseEnd: 10 };

// Written for the owner's approval on 2026-11-08, for any heavy moment: it knows nothing of the entry, so it repeats nothing,
// and it follows every rule of the instruction (a hook of nine words, 148 words in four paragraphs, a first-person prayer of
// 44 words, lock-screen-safe title and headlines, no quotation, no verse named, the next step a person). The tests check it
// against every hard and soft check (heavy_test.ts).
export function heavyFallback(): ReadyReflection {
  return {
    kind: "ready",
    heavy: true,
    emotion: "weary",
    title: "You Are Not Alone",
    validationLine: "What you’re carrying right now is real, and you matter to God.",
    validationSource: "model",
    scripture: HEAVY_FALLBACK_PASSAGE,
    devotional: [
      "You brought this here instead of holding it all inside. That took courage. Whatever is pressing on you right now is real, and so is the pain of it.",
      "You don’t have to explain it well or make sense of it yet. God isn’t waiting for you to get it all together. He is with you in this moment, and he isn’t going anywhere.",
      "You are not a burden to him. You are not too much. Your life matters to him, and it matters to the people around you, even when it doesn’t feel that way.",
      "So please don’t carry this alone today. Reach out to someone you trust, a friend, a pastor or a counselor, and tell them what you shared here. If you are in danger, get help right away. Let someone sit with you. God often shows up through the people he puts beside us.",
    ].join("\n\n"),
    closingPrayer:
      "Lord, I don’t have the words for this, so I bring you the weight of it as it is. Stay with me right now. Give me the courage to reach out to someone today, and keep me close to you, because you are faithful.",
    prayer: null,
    affirmations: [
      {
        slot: "morning",
        headline: "You are not alone today",
        text:
          "Before this day asks anything of you, God is already here. Take one small step, and let someone take it with you.",
      },
      {
        slot: "afternoon",
        headline: "God is with you here",
        text: "In the middle of this day, you are held. Reach out to someone you trust, even with just a few words.",
      },
      {
        slot: "evening",
        headline: "You are held tonight",
        text:
          "You made it through today. Let tonight be gentle, and know that his love for you does not change in the dark.",
      },
    ],
    salvaged: null,
  };
}
