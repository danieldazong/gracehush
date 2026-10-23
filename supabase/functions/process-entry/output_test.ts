import { assert, assertEquals } from "./testing/assert.ts";
import { audioReadyOutput, crisisOutput, readyOutput } from "./testing/fakes.ts";
import {
  countWords,
  curlyApostrophes,
  finishSentence,
  OutputInvalid,
  parseReflection,
  parseScripturePick,
  removeAmen,
  singleLine,
  stripMarkup,
  tidyParagraphs,
} from "./output.ts";

const parse = (value: unknown, kind: "text" | "audio" = "text") =>
  parseReflection(typeof value === "string" ? value : JSON.stringify(value), kind);

function invalid(value: unknown, reason: string, kind: "text" | "audio" = "text") {
  try {
    parse(value, kind);
  } catch (error) {
    assert(error instanceof OutputInvalid, `expected OutputInvalid, got ${String(error)}`);
    assertEquals(error.reason, reason);
    return;
  }
  throw new Error(`expected "${reason}" but the output was accepted`);
}

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

Deno.test("a good written reflection is accepted and cleaned", () => {
  const result = parse(readyOutput());
  assert(result.kind === "ready");
  assertEquals(result.emotion, "anxious");
  assertEquals(result.title, "Peace in the Waiting");
  assertEquals(result.scripture, { bookId: "PHP", chapter: 4, verseStart: 6, verseEnd: 7 });
  assertEquals(/amen/i.test(result.closingPrayer), false);
  assertEquals(result.closingPrayer.endsWith("hearts."), true);
  assertEquals(result.prayer, {
    title: "Peace for the week",
    summary: "Peace and steadiness for a heavy week.",
    category: "INNER PEACE",
  });
  assertEquals(result.affirmations.map((item) => item.slot), ["morning", "afternoon", "evening"]);
  assertEquals(result.transcript, null);
});

Deno.test("a good spoken reflection keeps the model's transcript", () => {
  const result = parse(audioReadyOutput(), "audio");
  assert(result.kind === "ready");
  assertEquals(result.transcript, "I have been carrying a lot this week.");
});

Deno.test("a reply wrapped in a code fence is read", () => {
  assert(parse("```json\n" + JSON.stringify(readyOutput()) + "\n```").kind === "ready");
});

Deno.test("crisis wins over everything else the model said", () => {
  assertEquals(parse(crisisOutput()), { kind: "crisis", transcript: null });
  assertEquals(parse(crisisOutput("audio"), "audio"), { kind: "crisis", transcript: "a spoken crisis sentence" });
  // Scripture, devotional and affirmations returned beside is_crisis are ignored.
  assertEquals(parse({ ...readyOutput(), is_crisis: true }), { kind: "crisis", transcript: null });
  // A contradicting no_speech does not hide a crisis.
  assertEquals(parse({ ...crisisOutput("audio"), no_speech: true, transcript: "" }, "audio"), {
    kind: "crisis",
    transcript: null,
  });
});

Deno.test("no_speech is only a thing for audio", () => {
  assertEquals(parse({ ...audioReadyOutput(), no_speech: true, transcript: "" }, "audio"), { kind: "no_speech" });
  // A written entry has no such field, and an extra one is ignored.
  assert(parse({ ...readyOutput(), no_speech: true }).kind === "ready");
});

Deno.test("shape errors", () => {
  invalid("not json", "json");
  invalid([], "shape");
  invalid({ ...readyOutput(), is_crisis: "no" }, "is_crisis");
  invalid({ ...readyOutput(), dominant_emotion: "angry" }, "emotion");
  invalid({ ...audioReadyOutput(), no_speech: undefined }, "audio_fields", "audio");
  invalid({ ...audioReadyOutput(), transcript: "" }, "transcript_empty", "audio");
  invalid({ ...audioReadyOutput(), transcript: "a".repeat(20_001) }, "transcript_long", "audio");
});

Deno.test("title rules", () => {
  invalid({ ...readyOutput(), reflection_title: null }, "title");
  invalid({ ...readyOutput(), reflection_title: "   " }, "title");
  invalid({ ...readyOutput(), reflection_title: "a".repeat(61) }, "title");
  const result = parse({ ...readyOutput(), reflection_title: `  "A Quiet Title"\n` });
  assert(result.kind === "ready");
  assertEquals(result.title, "A Quiet Title");
});

Deno.test("scripture: the book is a USFM id from the list, the numbers are whole and in range of the Bible", () => {
  const scripture = (over: Record<string, unknown>) => ({
    ...readyOutput(),
    scripture: { book_id: "JHN", chapter: 3, verse_start: 16, verse_end: 16, ...over },
  });
  invalid({ ...readyOutput(), scripture: null }, "scripture_missing");
  invalid({ ...readyOutput(), scripture: "John 3:16" }, "scripture_missing");
  // The old free-text name is no longer accepted, nor is a lowercase id or a name in the id's place.
  invalid(scripture({ book_id: undefined, book_name: "John" }), "scripture_book");
  for (const bad of ["", "john", "John", "JOH", "PHI", "SOS", 7, null]) {
    invalid(scripture({ book_id: bad }), "scripture_book");
  }
  invalid(scripture({ chapter: 0 }), "scripture_chapter");
  invalid(scripture({ chapter: 3.5 }), "scripture_chapter");
  invalid(scripture({ chapter: 151 }), "scripture_chapter");
  invalid(scripture({ verse_start: 0 }), "scripture_verse");
  invalid(scripture({ verse_start: 177, verse_end: 177 }), "scripture_verse");
  invalid(scripture({ verse_start: 10, verse_end: 9 }), "scripture_verse");
  invalid(scripture({ verse_start: "16" }), "scripture_verse");
  assert(parse(scripture({ book_id: "1JN", chapter: 4, verse_start: 18, verse_end: 18 })).kind === "ready");
  assert(parse(scripture({ book_id: "SNG", chapter: 2, verse_start: 4, verse_end: 4 })).kind === "ready");
  assert(parse(scripture({ book_id: "PSA", chapter: 119, verse_start: 105, verse_end: 105 })).kind === "ready");
});

Deno.test("a passage that does not exist is not rejected here: it gets a cheaper second chance (scripture.ts)", () => {
  // Psalm 150:99 and John 3:99 are the right shape, so the reflection is accepted and the Bible code decides.
  const shaped = (scripture: Record<string, unknown>) => parse({ ...readyOutput(), scripture });
  assert(shaped({ book_id: "PSA", chapter: 150, verse_start: 99, verse_end: 99 }).kind === "ready");
  assert(shaped({ book_id: "JHN", chapter: 3, verse_start: 99, verse_end: 99 }).kind === "ready");
  // And a passage longer than the app allows is also left to the Bible code.
  assert(
    parse({ ...readyOutput(), scripture: { book_id: "JHN", chapter: 3, verse_start: 1, verse_end: 20 } }).kind ===
      "ready",
  );
});

Deno.test("the reply to a request for another passage is the same four fields on their own", () => {
  assertEquals(parseScripturePick(JSON.stringify({ book_id: "PHP", chapter: 4, verse_start: 6, verse_end: 7 })), {
    bookId: "PHP",
    chapter: 4,
    verseStart: 6,
    verseEnd: 7,
  });
  assertEquals(
    parseScripturePick(
      "```json\n" + JSON.stringify({ book_id: "PSA", chapter: 23, verse_start: 1, verse_end: 1 }) + "\n```",
    ),
    { bookId: "PSA", chapter: 23, verseStart: 1, verseEnd: 1 },
  );
  for (
    const bad of [
      "{ broken",
      "null",
      "[]",
      JSON.stringify({ book_id: "XXX", chapter: 1, verse_start: 1, verse_end: 1 }),
    ]
  ) {
    let reason = "";
    try {
      parseScripturePick(bad);
    } catch (error) {
      assert(error instanceof OutputInvalid);
      reason = error.reason;
    }
    assert(reason !== "", `expected ${bad} to be refused`);
  }
});

Deno.test("devotional length: 79 words is too few, 80 and 260 pass, 261 is too many (nothing is truncated)", () => {
  invalid({ ...readyOutput(), devotional_text: words(79) }, "devotional_words");
  assert(parse({ ...readyOutput(), devotional_text: words(80) }).kind === "ready");
  assert(parse({ ...readyOutput(), devotional_text: words(260) }).kind === "ready");
  invalid({ ...readyOutput(), devotional_text: words(261) }, "devotional_words");
  invalid({ ...readyOutput(), devotional_text: null }, "devotional");
});

Deno.test("closing prayer: needs words, and loses a trailing Amen", () => {
  invalid({ ...readyOutput(), closing_prayer: "Lord, hear us." }, "closing_prayer_words");
  invalid({ ...readyOutput(), closing_prayer: words(101) }, "closing_prayer_words");
  const result = parse({ ...readyOutput(), closing_prayer: `${words(20)}. Amen.` });
  assert(result.kind === "ready");
  assertEquals(result.closingPrayer.endsWith("Amen"), false);
});

Deno.test("closing prayer: a prayer that stops without punctuation is closed with a full stop", () => {
  const prayer = (text: string) => {
    const result = parse({ ...readyOutput(), closing_prayer: text });
    assert(result.kind === "ready");
    return result.closingPrayer;
  };
  // What the real model returned on 2026-10-23: no full stop, so the app would show "... restoration Amen.".
  assertEquals(prayer(`${words(20)} for complete restoration`).endsWith("restoration."), true);
  assertEquals(prayer(`${words(20)} for rest,`).endsWith("rest."), true);
  // Punctuation the model already wrote is left alone.
  assertEquals(prayer(`${words(20)} for rest!`).endsWith("rest!"), true);
  assertEquals(prayer(`${words(20)} for rest.”`).endsWith("rest.”"), true);
  assertEquals(prayer(`${words(20)} for rest…`).endsWith("rest…"), true);
});

Deno.test("affirmation rules", () => {
  const aff = (items: unknown) => ({ ...readyOutput(), affirmations: items });
  const one = (slot: string, headline = "Short", text = "A short line.") => ({ time_slot: slot, headline, text });
  invalid(aff([one("morning"), one("afternoon")]), "affirmations_count");
  invalid(aff([one("morning"), one("morning"), one("evening")]), "affirmation_slot");
  invalid(aff([one("morning"), one("afternoon"), one("night")]), "affirmation_slot");
  invalid(aff([one("morning", words(9)), one("afternoon"), one("evening")]), "affirmation_headline");
  invalid(aff([one("morning", "Short", words(31)), one("afternoon"), one("evening")]), "affirmation_body");
  invalid(aff([one("morning", "", "x"), one("afternoon"), one("evening")]), "affirmation_headline");
  // Any order in, canonical order out.
  const result = parse(aff([one("evening"), one("morning"), one("afternoon")]));
  assert(result.kind === "ready");
  assertEquals(result.affirmations.map((item) => item.slot), ["morning", "afternoon", "evening"]);
});

Deno.test("prayer rules: off means none, on needs a title, a summary and a real category", () => {
  const prayer = (over: Record<string, unknown>) => ({
    ...readyOutput(),
    prayer: { is_active_prayer: true, title: "T", summary: "S", category: "GUIDANCE", ...over },
  });
  const off = parse({
    ...readyOutput(),
    prayer: { is_active_prayer: false, title: "ignored", summary: "ignored", category: "NONE" },
  });
  assert(off.kind === "ready");
  assertEquals(off.prayer, null);
  invalid(prayer({ category: "NONE" }), "prayer_category");
  invalid(prayer({ category: "MONEY" }), "prayer_category");
  invalid(prayer({ title: "" }), "prayer_title");
  invalid(prayer({ title: "a".repeat(61) }), "prayer_title");
  invalid(prayer({ summary: "a".repeat(121) }), "prayer_summary");
  invalid({ ...readyOutput(), prayer: null }, "prayer_shape");
});

Deno.test("cleaning: markup, emoji, apostrophes, paragraphs, Amen", () => {
  assertEquals(stripMarkup("Rest <break time='1s'/> now 🙏 and <b>breathe</b>."), "Rest  now  and breathe.");
  assertEquals(curlyApostrophes("don't, God's, parents' and 'quoted'"), "don’t, God’s, parents’ and 'quoted’");
  assertEquals(tidyParagraphs("One\n\n\n\nTwo  lines\nhere \r\n\r\n  Three  "), "One\n\nTwo lines here\n\nThree");
  assertEquals(singleLine("  “Hello\n  there”  "), "Hello there");
  assertEquals(removeAmen("We rest in you. Amen."), "We rest in you.");
  assertEquals(removeAmen("We rest in you, amen"), "We rest in you.");
  assertEquals(removeAmen("We rest in you amen."), "We rest in you.");
  assertEquals(removeAmen("We rest in you."), "We rest in you.");
  assertEquals(removeAmen("Amen."), "");
  assertEquals(removeAmen("Amen to that, Lord."), "Amen to that, Lord.");
  assertEquals(finishSentence("We rest in you"), "We rest in you.");
  assertEquals(finishSentence("We rest in you; "), "We rest in you.");
  assertEquals(finishSentence("We rest in you."), "We rest in you.");
  assertEquals(finishSentence("Do we rest in you?"), "Do we rest in you?");
  assertEquals(finishSentence("“We rest in you”"), "“We rest in you”");
  assertEquals(finishSentence(""), "");
  assertEquals(countWords("  one two\nthree  "), 3);
});

Deno.test("the cleaned reply never carries tags or emoji into the saved text", () => {
  const dirty = readyOutput({
    reflection_title: "Rest <i>now</i> 🙏",
    devotional_text: `<speak>${words(100)}</speak> 🙏`,
    closing_prayer: `${words(20)} <break/> 🙏 Amen`,
  });
  const result = parse(dirty);
  assert(result.kind === "ready");
  for (const field of [result.title, result.devotional, result.closingPrayer]) {
    assertEquals(/[<>]|\p{Extended_Pictographic}/u.test(field), false);
  }
});
