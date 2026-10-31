import { assert, assertEquals } from "./testing/assert.ts";
import { crisisOutput, readyOutput, TEXT } from "./testing/fakes.ts";
import {
  countWords,
  curlyApostrophes,
  finishSentence,
  OutputInvalid,
  parseReflection,
  parseScripturePick,
  type ReadyReflection,
  removeAmen,
  singleLine,
  stripMarkup,
  tidyParagraphs,
} from "./output.ts";
import { SAFE_HEADLINES, SAFE_TITLE } from "./tone.ts";

const parse = (value: unknown, entry = TEXT) =>
  parseReflection(typeof value === "string" ? value : JSON.stringify(value), { entry });

function invalid(value: unknown, reason: string, entry = TEXT): OutputInvalid {
  try {
    parse(value, entry);
  } catch (error) {
    assert(error instanceof OutputInvalid, `expected OutputInvalid, got ${String(error)}`);
    assertEquals(error.reason, reason);
    return error;
  }
  throw new Error(`expected "${reason}" but the output was accepted`);
}

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
// Filler prose of `count` words whose first sentence is ten words long, so the hook guard (gen-v2.2) leaves it alone.
const prose = (count: number) => words(count).replace(/^((?:\S+ ){9}\S+)/, "$1.");

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
});

Deno.test("a reply wrapped in a code fence is read", () => {
  assert(parse("```json\n" + JSON.stringify(readyOutput()) + "\n```").kind === "ready");
});

Deno.test("crisis wins over everything else the model said, and carries nothing but the flag", () => {
  assertEquals(parse(crisisOutput()), { kind: "crisis" });
  // Scripture, devotional and affirmations returned beside is_crisis are ignored.
  assertEquals(parse({ ...readyOutput(), is_crisis: true }), { kind: "crisis" });
  // Even a reply whose other fields are broken is a crisis if it says so: the flag is read first.
  assertEquals(parse({ is_crisis: true, dominant_emotion: "angry", affirmations: "none", prayer: null }), {
    kind: "crisis",
  });
});

Deno.test("fields from the old spoken-entry flow are ignored: the reflection is text only now", () => {
  assert(parse({ ...readyOutput(), no_speech: true, transcript: "ignored" }).kind === "ready");
});

Deno.test("shape errors", () => {
  invalid("not json", "json");
  invalid([], "shape");
  invalid({ ...readyOutput(), is_crisis: "no" }, "is_crisis");
  invalid({ ...readyOutput(), dominant_emotion: "angry" }, "emotion");
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

Deno.test("devotional length: 79 words is too few, 80 and 220 pass, 221 is too many (nothing is truncated)", () => {
  invalid({ ...readyOutput(), devotional_text: prose(79) }, "devotional_words");
  assert(parse({ ...readyOutput(), devotional_text: prose(80) }).kind === "ready");
  assert(parse({ ...readyOutput(), devotional_text: prose(220) }).kind === "ready");
  invalid({ ...readyOutput(), devotional_text: prose(221) }, "devotional_words");
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
  // A headline is a notification's whole body: 50 characters at most (step 32).
  const fifty = "Your weary heart is held by unfailing faithfulness";
  assertEquals(fifty.length, 50);
  assert(parse(aff([one("morning", fifty), one("afternoon"), one("evening")])).kind === "ready");
  invalid(aff([one("morning", `${fifty}!`), one("afternoon"), one("evening")]), "affirmation_headline");
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
    devotional_text: `<speak>${prose(100)}</speak> 🙏`,
    closing_prayer: `${words(20)} <break/> 🙏 Amen`,
  });
  const result = parse(dirty);
  assert(result.kind === "ready");
  for (const field of [result.title, result.devotional, result.closingPrayer]) {
    assertEquals(/[<>]|\p{Extended_Pictographic}/u.test(field), false);
  }
});

// ---- The tone checks of step 32 -----------------------------------------------------------------------------------------

const BLESSING = "Please pray for my sister Blessing. She moved to Ibadan last month and I miss her.";
const devotionalWith = (sentence: string) => `${sentence}\n\n${readyOutput().devotional_text as string}`;
const headlines = (morning: string, evening = "It is enough") => ({
  ...readyOutput(),
  affirmations: [
    { time_slot: "morning", headline: morning, text: "Begin the day knowing you are held." },
    { time_slot: "afternoon", headline: "Rest is allowed", text: "Pause and breathe; the work will wait." },
    { time_slot: "evening", headline: evening, text: "You did what you could today." },
  ],
});

Deno.test("a clean reply is not salvaged", () => {
  const result = parse(readyOutput());
  assert(result.kind === "ready");
  assertEquals(result.salvaged, null);
});

Deno.test("verse_reference: the devotional and the closing prayer never point to a passage", () => {
  invalid(readyOutput({ devotional_text: devotionalWith("Psalm 23 says you are not alone.") }), "verse_reference");
  invalid(readyOutput({ devotional_text: devotionalWith("This verse is for you tonight.") }), "verse_reference");
  invalid(
    readyOutput({
      closing_prayer: "Lord, as 1 Peter 5:7 says, we cast our cares on you and rest tonight in your care.",
    }),
    "verse_reference",
  );
  // A book's name alone is not a reference.
  assert(parse(readyOutput({ devotional_text: devotionalWith("Like Job, you have waited long.") })).kind === "ready");
  const error = invalid(readyOutput({ devotional_text: devotionalWith("The psalmist knew this.") }), "verse_reference");
  assert(error.note?.includes("Bible passage"));
  assertEquals(error.salvage, undefined, "a reply that points to scripture is never kept");
});

Deno.test("never_say: checked in the devotional, the prayer, the title, the headlines and the affirmation texts", () => {
  invalid(readyOutput({ devotional_text: devotionalWith("Everything happens for a reason.") }), "never_say:reason");
  invalid(
    readyOutput({ closing_prayer: "Lord, we know everything will work out, and we rest in you tonight with thanks." }),
    "never_say:work_out",
  );
  invalid(readyOutput({ reflection_title: "Just Trust Him" }), "never_say:just_believe");
  invalid(headlines("Heaven needed another angel"), "never_say:angel");
  const texts = readyOutput({
    affirmations: [
      { time_slot: "morning", headline: "You are held", text: "This is a punishment for nothing; you are loved." },
      { time_slot: "afternoon", headline: "Rest is allowed", text: "Pause and breathe." },
      { time_slot: "evening", headline: "It is enough", text: "You did what you could today." },
    ],
  });
  const error = invalid(texts, "never_say:punishment");
  assert(error.note?.includes("“suffering as a punishment”"));
  assertEquals(error.salvage, undefined);
  // A denial is what the instruction asks for, and it passes.
  assert(
    parse(readyOutput({ devotional_text: devotionalWith("This is not a punishment for anything you did.") })).kind ===
      "ready",
  );
});

Deno.test("title_private and headline_private: a name the person wrote never reaches a lock screen", () => {
  // The headline leaks "blessing": the failure carries a note naming it and the reply with the safe headline.
  const headline = invalid(headlines("You are a blessing"), "headline_private", BLESSING);
  assert(headline.note?.endsWith("any headline: blessing, ibadan."), headline.note);
  const kept = headline.salvage as ReadyReflection;
  assertEquals(kept.salvaged, "headline_private");
  assertEquals(kept.affirmations.map((item) => item.headline), [
    SAFE_HEADLINES.morning,
    "Rest is allowed",
    "It is enough",
  ]);
  assertEquals(kept.title, "Peace in the Waiting");

  // The title leaks: title_private, whatever the headlines do, and the note puts the leaked word first.
  const both = invalid(
    { ...headlines("You are a blessing", "Ibadan is near"), reflection_title: "Missing Ibadan" },
    "title_private",
    BLESSING,
  );
  assert(both.note?.endsWith("any headline: ibadan, blessing."), both.note);
  const salvaged = both.salvage as ReadyReflection;
  assertEquals(salvaged.salvaged, "title_private");
  assertEquals(salvaged.title, SAFE_TITLE);
  assertEquals(salvaged.affirmations.map((item) => item.headline), [
    SAFE_HEADLINES.morning,
    "Rest is allowed",
    SAFE_HEADLINES.evening,
  ]);

  // The same words from an entry that never wrote the name are fine, and the devotional may say it (it stays in the app).
  assert(parse(headlines("You are a blessing")).kind === "ready");
  assert(parse(readyOutput({ devotional_text: devotionalWith("Blessing is near.") }), BLESSING).kind === "ready");
});

Deno.test("the checks run in order: shape, then scripture, then never-say, and privacy last", () => {
  // A reply that both says a never-say phrase and leaks a name is a never-say failure, with no salvage.
  const error = invalid(
    { ...headlines("You are a blessing"), devotional_text: devotionalWith("Everything happens for a reason.") },
    "never_say:reason",
    BLESSING,
  );
  assertEquals(error.salvage, undefined);
  invalid(
    {
      ...headlines("You are a blessing"),
      devotional_text: devotionalWith("Psalm 23 is for you. Everything happens for a reason."),
    },
    "verse_reference",
    BLESSING,
  );
  // A shape problem comes first, and carries neither a note nor a salvage.
  const shape = invalid(
    { ...headlines(`You are a blessing ${"a".repeat(40)}`), reflection_title: "Missing Ibadan" },
    "affirmation_headline",
    BLESSING,
  );
  assertEquals([shape.note, shape.salvage], [undefined, undefined]);
});

// ---- The hook guard (gen-v2.2) -----------------------------------------------------------------------------------------

const parseAfter = (value: unknown, recentFirstWords: string[]) =>
  parseReflection(JSON.stringify(value), { entry: TEXT, recentFirstWords });

function hookInvalid(value: unknown, recentFirstWords: string[], reason: string): OutputInvalid {
  try {
    parseAfter(value, recentFirstWords);
  } catch (error) {
    assert(error instanceof OutputInvalid, `expected OutputInvalid, got ${String(error)}`);
    assertEquals(error.reason, reason);
    return error;
  }
  throw new Error(`expected "${reason}" but the output was accepted`);
}

Deno.test("the hook guard: a stock opening is asked for again, and the reply is kept as it was in case none is better", () => {
  for (
    const sentence of ["It sounds like a heavy week.", "The phone stayed quiet.", "Today was long.", "I hear you."]
  ) {
    const error = hookInvalid(readyOutput({ devotional_text: devotionalWith(sentence) }), [], "hook_stock");
    assert(error.note?.startsWith("Your last reply began the devotional with a stock opening."), error.note);
    const kept = error.salvage as ReadyReflection;
    assertEquals(kept.salvaged, "hook_stock");
    assert(kept.devotional.startsWith(sentence), "the salvage is the reply itself");
    assertEquals(kept.title, "Peace in the Waiting");
  }
  // A fresh opening passes, and with no recent devotionals nothing else is compared.
  assert(
    parseAfter(readyOutput({ devotional_text: devotionalWith("Another night at your desk.") }), []).kind === "ready",
  );
  assert(parseAfter(readyOutput(), []).kind === "ready");
});

Deno.test("the hook guard: a first word a recent devotional began with is asked for again, named in the note", () => {
  const error = hookInvalid(readyOutput(), ["paragraph", "another"], "hook_repeated");
  assert(error.note?.startsWith("Your last reply began the devotional with “paragraph”"), error.note);
  assert(error.note?.includes("not “paragraph”, “another”"), error.note);
  assertEquals((error.salvage as ReadyReflection).salvaged, "hook_repeated");
  // A stock opening names the recent first words too, so the retry avoids both.
  const stock = hookInvalid(
    readyOutput({ devotional_text: devotionalWith("The night was long.") }),
    ["waiting"],
    "hook_stock",
  );
  assert(stock.note?.includes("or with “waiting”, which began their recent devotionals"), stock.note);
  // Other first words pass; the comparison is by the whole first word.
  assert(parseAfter(readyOutput(), ["morning", "paragraphs", "para"]).kind === "ready");
});

Deno.test("the hook guard comes last: a hard check or a private word wins over it, with its own note and salvage", () => {
  // A never-say phrase in a devotional that also opens with a stock word is a never-say failure, with no salvage.
  const neverSay = hookInvalid(
    readyOutput({ devotional_text: devotionalWith("It happened for a reason.") }),
    [],
    "never_say:reason",
  );
  assertEquals(neverSay.salvage, undefined);
  // A name in a headline is the private-word salvage (its safe texts), not the hook's.
  try {
    parseReflection(
      JSON.stringify({ ...headlines("You are a blessing"), devotional_text: devotionalWith("The night was long.") }),
      {
        entry: BLESSING,
        recentFirstWords: [],
      },
    );
    throw new Error("accepted");
  } catch (error) {
    assert(error instanceof OutputInvalid);
    assertEquals(error.reason, "headline_private");
    assertEquals((error.salvage as ReadyReflection).salvaged, "headline_private");
  }
});

Deno.test("the hook guard: a first sentence over sixteen words is asked for again; sixteen or fewer is left alone", () => {
  const sentence = (count: number) => `${words(count - 1)} end.`;
  const error = hookInvalid(readyOutput({ devotional_text: devotionalWith(sentence(17)) }), [], "hook_long");
  assert(error.note?.startsWith("Your last reply began the devotional with a first sentence of 17 words."), error.note);
  assertEquals((error.salvage as ReadyReflection).salvaged, "hook_long");
  assert(parseAfter(readyOutput({ devotional_text: devotionalWith(sentence(16)) }), []).kind === "ready");
});
