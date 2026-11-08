import { assert, assertEquals } from "./testing/assert.ts";
import { heavyOutput, readyOutput, TEXT, VALIDATION_LINE } from "./testing/fakes.ts";
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
import { openingSentence, SAFE_HEADLINES, SAFE_TITLE } from "./tone.ts";

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
// A filler prayer in the person's own voice (gen-v2.3 asks for the first person singular): "I", "my", then `count` words.
const mine = (count: number) => `I lift my ${words(count)}`;

Deno.test("a good written reflection is accepted and cleaned", () => {
  const result = parse(readyOutput());
  assert(result.kind === "ready");
  assertEquals(result.emotion, "anxious");
  assertEquals(result.title, "Peace in the Waiting");
  assertEquals(result.validationLine, VALIDATION_LINE);
  assertEquals(result.validationSource, "model");
  assertEquals(result.scripture, { bookId: "PHP", chapter: 4, verseStart: 6, verseEnd: 7 });
  assertEquals(/amen/i.test(result.closingPrayer), false);
  assertEquals(result.closingPrayer.endsWith("my heart tonight."), true);
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

Deno.test("a heavy moment (gen-v2.4) is a whole reflection: the model's flag or the app's marks it, and every field is read", () => {
  const flagged = parse(heavyOutput());
  assertEquals(flagged.heavy, true);
  assertEquals(flagged.title, "Held Through the Night");
  assertEquals(flagged.affirmations.length, 3);
  assertEquals(flagged.scripture, { bookId: "PSA", chapter: 46, verseStart: 1, verseEnd: 1 });
  // The app's check marks it too, whatever the reply says.
  assertEquals(parseReflection(JSON.stringify(readyOutput()), { entry: TEXT, heavy: true }).heavy, true);
  assertEquals(parse(readyOutput()).heavy, false);
  // A flagged reply whose other fields are broken is no longer a crisis: it is an unusable reply, asked for again.
  invalid({ is_crisis: true, dominant_emotion: "angry", affirmations: "none", prayer: null }, "emotion");
});

// A devotional with one sentence added before its second sentence, for the heavy checks.
const withSentence = (sentence: string) =>
  String(readyOutput().devotional_text).replace("About rest", `${sentence} About rest`);
const heavyParse = (value: unknown, entry = TEXT) => parseReflection(JSON.stringify(value), { entry, heavy: true });

function heavyFails(value: unknown, reason: string) {
  try {
    heavyParse(value);
  } catch (error) {
    assert(error instanceof OutputInvalid, `expected OutputInvalid, got ${String(error)}`);
    assertEquals(error.reason, reason);
    assert(error.note?.includes("heavy moment"), "the retry is told why");
    assertEquals(error.salvage, undefined, "a reply that breaks a heavy rule is never kept");
    return;
  }
  throw new Error(`expected "${reason}" but the heavy reply was accepted`);
}

Deno.test("a heavy moment quotes nothing: a quotation in the devotional or the prayer is a hard fault", () => {
  // Their own words, which an ordinary reflection may echo once (gen-v2.3)...
  const echo = "“I can not seem to rest,” you wrote.";
  assertEquals(parse(readyOutput({ devotional_text: withSentence(echo) })).heavy, false);
  // ... never come back in a heavy moment, in the devotional or in the prayer.
  heavyFails(readyOutput({ devotional_text: withSentence(echo) }), "heavy_quote");
  heavyFails(
    readyOutput({ closing_prayer: "Lord, I said “I can not seem to rest” and I need you near me right now." }),
    "heavy_quote",
  );
});

Deno.test("a heavy moment never presents death as a way home, rest at last or a release, or tells someone to submit or forgive", () => {
  const cases: [string, string][] = [
    ["God is calling you home.", "home"],
    ["He will welcome you home soon.", "home"],
    ["Heaven is waiting for you.", "heaven_waiting"],
    ["You will find rest at last.", "at_last"],
    ["Soon you will finally be free.", "at_last"],
    ["There is a release from this life.", "release"],
    ["You will no longer be here to hurt.", "release"],
    ["Submit to your husband and pray.", "submit"],
    ["You must forgive him.", "must_forgive"],
    ["You should go back to him.", "must_forgive"],
    // 2026-11-08: dying, harm, a method or the wish itself, in any words (the live check's quiet heavy moment).
    ["You will not die tonight.", "dying"],
    ["Your thoughts of suicide are heavy.", "dying"],
    ["You have wanted to hurt yourself.", "self_harm"],
    ["Self-harm is not the answer.", "self_harm"],
    ["When living hurts this much, wanting it all to stop makes human sense.", "wish"],
    ["You want to close your eyes and never wake up.", "wish"],
    ["Going to sleep feels like the only relief right now.", "wish"],
    ["Sleep feels like the only thing calling to you right now.", "wish"],
    ["All you want is to sleep.", "wish"],
    ["You wish you could disappear.", "wish"],
    ["Put the pills away tonight.", "method"],
  ];
  for (const [sentence, id] of cases) {
    heavyFails(readyOutput({ devotional_text: withSentence(sentence) }), `heavy_never_say:${id}`);
    // An ordinary reflection is not held to these: they are not on NEVER_SAY.
    assertEquals(parse(readyOutput({ devotional_text: withSentence(sentence) })).heavy, false, sentence);
  }
  // A headline counts too.
  heavyFails(
    readyOutput({
      affirmations: [
        { time_slot: "morning", headline: "Peace at last", text: "Begin the day knowing you are held." },
        { time_slot: "afternoon", headline: "Rest is allowed", text: "Pause and breathe; the work will wait." },
        { time_slot: "evening", headline: "It is enough", text: "You did what you could today." },
      ],
    }),
    "heavy_never_say:at_last",
  );
});

Deno.test("what a heavy moment may still say: a denial, forgiving yourself, rest in his care, staying with God", () => {
  for (
    const sentence of [
      "You don’t have to forgive him today.",
      "You never have to go back to them.",
      "You need to forgive yourself for nothing here.",
      "Rest in his care tonight.",
      "He will stay with you.",
      "Submit to him in prayer, and let him carry you.",
      "It is not your fault, and you deserve to be safe.",
      // The pain itself may be named, and hope may be spoken (2026-11-08).
      "You want the pain to stop, and that pain is real.",
      "This moment is not the end of your story.",
      "There is a way through this darkness, and he walks it with you.",
      "The person who hurt you was wrong.",
      "Sleep gently tonight, held by him.",
      "You could not sleep last night, and your fear is real.",
      "You are too tired to keep going on your own.",
    ]
  ) {
    assertEquals(heavyParse(readyOutput({ devotional_text: withSentence(sentence) })).heavy, true, sentence);
  }
});

Deno.test("a heavy moment is never held to grounding or the echo: its own words may be about dying or harm", () => {
  const entry =
    "My manager shouted at me in front of the whole team during the budget meeting and now everyone thinks I failed the project deadline completely.";
  // An ordinary reflection that uses nothing from this long entry is asked for again (grounding_low)...
  const ordinary = (() => {
    try {
      parse(readyOutput(), entry);
      return "accepted";
    } catch (error) {
      return error instanceof OutputInvalid ? error.reason : String(error);
    }
  })();
  assertEquals(ordinary, "grounding_low");
  // ... a heavy moment is not.
  assertEquals(heavyParse(readyOutput(), entry).heavy, true);
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
  const result = parse({ ...readyOutput(), closing_prayer: `${mine(20)}. Amen.` });
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
  assertEquals(prayer(`${mine(20)} for complete restoration`).endsWith("restoration."), true);
  assertEquals(prayer(`${mine(20)} for rest,`).endsWith("rest."), true);
  // Punctuation the model already wrote is left alone.
  assertEquals(prayer(`${mine(20)} for rest!`).endsWith("rest!"), true);
  assertEquals(prayer(`${mine(20)} for rest.”`).endsWith("rest.”"), true);
  assertEquals(prayer(`${mine(20)} for rest…`).endsWith("rest…"), true);
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
  const fifty = "Your quiet heart is held by unfailing faithfulness";
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
    validation_line: "Work has kept you <b>anxious</b> all week 🙏",
    devotional_text: `<speak>${prose(100)}</speak> 🙏`,
    closing_prayer: `${mine(20)} <break/> 🙏 Amen`,
  });
  const result = parse(dirty);
  assert(result.kind === "ready");
  for (const field of [result.title, result.validationLine ?? "", result.devotional, result.closingPrayer]) {
    assertEquals(/[<>]|\p{Extended_Pictographic}/u.test(field), false);
  }
  assertEquals(result.validationLine, "Work has kept you anxious all week");
});

// ---- The tone checks of step 32 -----------------------------------------------------------------------------------------

const BLESSING = "Please pray for my sister Blessing. She moved to Ibadan last month and I miss her.";
// A reply written for BLESSING (gen-v2.3 asks the line and the prayer to use what the person told), with no private word in it.
const blessingOutput = (over: Record<string, unknown> = {}) =>
  readyOutput({
    validation_line: "Your sister moved away last month, and you miss her every day.",
    closing_prayer: "Lord, I miss my sister since she moved. Keep her close to you, and keep my heart near hers. Amen.",
    ...over,
  });
const devotionalWith = (sentence: string) => `${sentence}\n\n${readyOutput().devotional_text as string}`;
const headlines = (morning: string, evening = "It is enough", base: Record<string, unknown> = readyOutput()) => ({
  ...base,
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
  const headline = invalid(
    headlines("You are a blessing", "It is enough", blessingOutput()),
    "headline_private",
    BLESSING,
  );
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
    { ...headlines("You are a blessing", "Ibadan is near", blessingOutput()), reflection_title: "Missing Ibadan" },
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
  assert(parse(blessingOutput({ devotional_text: devotionalWith("Blessing is near.") }), BLESSING).kind === "ready");
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
      JSON.stringify({
        ...headlines("You are a blessing", "It is enough", blessingOutput()),
        devotional_text: devotionalWith("The night was long."),
      }),
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

// ---- gen-v2.3: the validation line, the prayer's voice, grounding and the echo -------------------------------------------

Deno.test("the validation line is read and cleaned, and a good reply keeps the model's own line", () => {
  const result = parse(
    readyOutput({ validation_line: "  “Work has kept you anxious all week, and rest still won't come.”\n" }),
  );
  assert(result.kind === "ready");
  assertEquals(result.validationLine, VALIDATION_LINE);
  assertEquals([result.validationSource, result.salvaged], ["model", null]);
});

Deno.test("a missing, wrong-length, stock or impersonal line is asked for again, and the hook stands in when none is better", () => {
  const cases: [unknown, string][] = [
    [null, "validation_missing"],
    [undefined, "validation_missing"],
    [42, "validation_missing"],
    ["Your week was long.", "validation_length"],
    ["It sounds like work has kept you anxious all week.", "validation_stock"],
    ["Sometimes work keeps you anxious all week long.", "validation_stock"],
    ["Work has kept everyone anxious all week long.", "validation_person"],
  ];
  for (const [line, reason] of cases) {
    const error = invalid(readyOutput({ validation_line: line }), reason);
    assert(error.note?.includes("validation_line"), error.note);
    const kept = error.salvage as ReadyReflection;
    assertEquals(kept.salvaged, reason);
    assertEquals(kept.validationLine, openingSentence(kept.devotional), "the hook takes the line's place");
    assertEquals(kept.validationSource, "salvage");
  }
});

Deno.test("a private word in the line is asked for again; the hook stands in, or no line when the hook holds one too", () => {
  const leaky = "Your sister Blessing moved away last month, and you miss her.";
  const error = invalid(blessingOutput({ validation_line: leaky }), "validation_private", BLESSING);
  assert(error.note?.endsWith("in validation_line: blessing, ibadan."), error.note);
  assertEquals((error.salvage as ReadyReflection).validationLine, "Paragraph 1 holds a quiet thought.");
  const both = invalid(
    blessingOutput({ validation_line: leaky, devotional_text: devotionalWith("Blessing moved last month.") }),
    "validation_private",
    BLESSING,
  );
  assertEquals((both.salvage as ReadyReflection).validationLine, null, "a hook with the name is no line at all");
  // A hook over 240 characters cannot be stored as a line either.
  const long = invalid(
    readyOutput({ validation_line: null, devotional_text: `${"Word ".repeat(60)}end.\n\n${prose(90)}` }),
    "validation_missing",
  );
  assertEquals((long.salvage as ReadyReflection).validationLine, null);
});

Deno.test("the line meets the hard checks too: a verse or a never-say phrase fails it, with no salvage", () => {
  const verse = invalid(
    readyOutput({ validation_line: "Psalm 23 is for you after this anxious week at work." }),
    "verse_reference",
  );
  assertEquals(verse.salvage, undefined);
  const never = invalid(
    readyOutput({ validation_line: "Your week at work was hard, but everything happens for a reason." }),
    "never_say:reason",
  );
  assertEquals(never.salvage, undefined);
});

Deno.test('a prayer prayed as "we", or in no voice, is asked for again and kept as it was when none is better', () => {
  const we = invalid(
    readyOutput({ closing_prayer: "Lord, we bring you this anxious week of work and ask for peace on our hearts." }),
    "prayer_voice:we",
  );
  assert(we.note?.includes("first person singular"), we.note);
  const kept = we.salvage as ReadyReflection;
  assertEquals([kept.salvaged, kept.closingPrayer], [
    "prayer_we",
    "Lord, we bring you this anxious week of work and ask for peace on our hearts.",
  ]);
  const none = invalid(
    readyOutput({ closing_prayer: "Lord, hold this anxious week of work and give rest tonight." }),
    "prayer_voice:none",
  );
  assertEquals((none.salvage as ReadyReflection).salvaged, "prayer_none");
  // A person who wrote as "we" may pray as "we".
  const together = "Lord, our work has kept us anxious all week and we cannot rest.";
  assert(
    parse(readyOutput({ closing_prayer: "Lord, we bring you our anxious week of work and ask for rest." }), together)
      .kind === "ready",
  );
});

Deno.test("a reply that uses nothing the person told is asked for again, and kept as it was when none is better", () => {
  // Twelve content stems, none of them in the sample reply ("quiet" would be: its devotional holds "a quiet thought").
  const entry =
    "The landlord raised my rent, my daughter starts school, the generator broke, the mechanic wants cash, and my stall is empty.";
  const error = invalid(readyOutput(), "grounding_low", entry);
  assert(error.note?.startsWith("Your last reply did not use what the person told you."), error.note);
  assertEquals((error.salvage as ReadyReflection).salvaged, "grounding_low");
  // One shared word is not enough for an entry this long; two are.
  invalid(
    readyOutput({ validation_line: "Your rent went up again, and you are tired of counting." }),
    "grounding_low",
    entry,
  );
  assert(
    parse(readyOutput({ validation_line: "Your rent went up and the generator broke, and you are tired." }), entry)
      .kind ===
      "ready",
  );
  // A short entry is never measured.
  assert(parse(readyOutput(), "Thank you God for today.").kind === "ready");
});

Deno.test("a quotation that is not the person's own words is asked for again, and kept as it was when none is better", () => {
  const error = invalid(
    readyOutput({ devotional_text: devotionalWith("You said it yourself, “I am done with work.”") }),
    "echo_invented",
  );
  assert(error.note?.startsWith("The quoted words are not in the person’s entry."), error.note);
  assertEquals((error.salvage as ReadyReflection).salvaged, "echo_invented");
  assert(
    parse(readyOutput({ devotional_text: devotionalWith("You said it yourself, “I can not seem to rest.”") })).kind ===
      "ready",
  );
});

Deno.test("several soft faults at once: one retry carries every note, and the first fault names the salvage", () => {
  const error = invalid(
    readyOutput({
      validation_line: "It sounds like work has kept you anxious all week.",
      closing_prayer: "Lord, we bring you this anxious week of work and ask for peace on our hearts.",
    }),
    "prayer_voice:we",
  );
  assert(error.note?.includes("closing prayer") && error.note?.includes("validation_line"), error.note);
  const kept = error.salvage as ReadyReflection;
  assertEquals(kept.salvaged, "prayer_we");
  assertEquals(kept.validationLine, openingSentence(kept.devotional), "the line is replaced too");
  // A private title comes first, and its safe title is in the salvage with the line's replacement.
  const title = invalid(
    blessingOutput({ reflection_title: "Missing Blessing", validation_line: "It sounds like you miss your sister." }),
    "title_private",
    BLESSING,
  );
  const saved = title.salvage as ReadyReflection;
  assertEquals([saved.title, saved.validationSource], [SAFE_TITLE, "salvage"]);
});

// ---- Step 37 (gen-v2.5): a verse under each affirmation -------------------------------------------------------------------

const versed = (morning: unknown, over: Record<string, unknown> = {}) =>
  readyOutput({
    affirmations: [
      {
        time_slot: "morning",
        verse: morning,
        headline: "god is your refuge",
        text: "Begin the day knowing you are held.",
      },
      {
        time_slot: "afternoon",
        verse: { book_id: "PSA", chapter: 23, verse_start: 1, verse_end: 1 },
        headline: "He leads you gently",
        text: "Pause; the work will wait.",
      },
      { time_slot: "evening", headline: "Your needs are known", text: "You did what you could today." },
    ],
    ...over,
  });

Deno.test("an affirmation's verse is read where it is, and a headline starts with a capital", () => {
  const result = parse(versed({ book_id: "PSA", chapter: 46, verse_start: 1, verse_end: 1 }));
  assert(result.kind === "ready");
  assertEquals(result.affirmations.map((item) => item.verse ?? null), [
    { bookId: "PSA", chapter: 46, verseStart: 1, verseEnd: 1 },
    { bookId: "PSA", chapter: 23, verseStart: 1, verseEnd: 1 },
    null,
  ]);
  assertEquals(result.affirmations[0].headline, "God is your refuge");
});

Deno.test("a verse that is not where a verse can be is no verse, never a failed reply", () => {
  for (
    const bad of [
      null,
      "Psalm 46:1",
      { book_id: "XYZ", chapter: 1, verse_start: 1, verse_end: 1 },
      { book_id: "PSA", chapter: 0, verse_start: 1, verse_end: 1 },
      { book_id: "PSA", chapter: 46, verse_start: 3, verse_end: 2 },
      { book_id: "PSA", chapter: 46, verse_start: 1.5, verse_end: 2 },
    ]
  ) {
    const result = parse(versed(bad));
    assert(result.kind === "ready", JSON.stringify(bad));
    assertEquals(result.affirmations[0].verse, null);
  }
});

Deno.test("headline_feeling and headline_repeated: soft, so the reply is asked for once more and then kept", () => {
  const feeling = invalid(
    versed(null, {
      affirmations: [
        { time_slot: "morning", headline: "When you feel anxious", text: "Begin the day knowing you are held." },
        { time_slot: "afternoon", headline: "He leads you gently", text: "Pause; the work will wait." },
        { time_slot: "evening", headline: "Your needs are known", text: "You did what you could today." },
      ],
    }),
    "headline_feeling",
  );
  assert(feeling.note?.includes("(“anxious”)"), feeling.note);
  assertEquals((feeling.salvage as ReadyReflection).salvaged, "headline_feeling");

  let repeated: OutputInvalid | null = null;
  try {
    parseReflection(JSON.stringify(versed(null)), { entry: TEXT, recentHeadlines: ["He leads you gently!"] });
  } catch (error) {
    repeated = error as OutputInvalid;
  }
  assert(repeated instanceof OutputInvalid);
  assertEquals(repeated.reason, "headline_repeated");
  assert(repeated.note?.includes("afternoon"), repeated.note);
  assertEquals((repeated.salvage as ReadyReflection).salvaged, "headline_repeated");
  // Another person's earlier headlines are not this person's: with none given, the reply is clean.
  assert(parse(versed(null)).kind === "ready");
});
