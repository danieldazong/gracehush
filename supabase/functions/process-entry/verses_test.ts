import type { ScriptureRef } from "../_shared/bible/reference.ts";
import { assert, assertEquals } from "./testing/assert.ts";
import { geminiError, geminiOk, type GeminiReply, installWorld, TEXT, type World } from "./testing/fakes.ts";
import { newStats, timing } from "./gemini.ts";
import { OutputInvalid, type ReplyAffirmation } from "./output.ts";
import { AFFIRMATION_VERSE_MAX_CHARS } from "./constants.ts";
import {
  flowText,
  givesAnOrder,
  isWholeSentence,
  parseVersePicks,
  resolveAffirmationVerses,
  speaksOfGod,
  type VersesArgs,
} from "./verses.ts";

// Step 37: every verse an affirmation shows is read from the Berean Standard Bible (the real chapters in
// _shared/bible/fixtures, or a chapter built here), never typed by the model or by this code.

const GEMINI = { apiKey: "test-gemini-key", model: "gemini-test-model", thinkingLevel: "low" };

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

const affirmation = (slot: ReplyAffirmation["slot"], verse: ScriptureRef | null): ReplyAffirmation => ({
  slot,
  headline: `${slot[0].toUpperCase()}${slot.slice(1)} truth for you`,
  text: "A short line of encouragement that speaks to you in the middle of your day.",
  verse,
});

const three = (morning: ScriptureRef | null, afternoon: ScriptureRef | null, evening: ScriptureRef | null) => [
  affirmation("morning", morning),
  affirmation("afternoon", afternoon),
  affirmation("evening", evening),
];

const args = (affirmations: ReplyAffirmation[], over: Partial<VersesArgs> = {}): VersesArgs => ({
  affirmations,
  passage: ref("PHP", 4, 6, 7),
  recent: [],
  heavy: false,
  title: "Peace in the Waiting",
  emotion: "anxious",
  gemini: GEMINI,
  deadlineAt: Date.now() + 60_000,
  stats: newStats(),
  ...over,
});

// The follow-up's reply: a verse per slot.
const picks = (...items: [string, string, number, number, number?][]): GeminiReply =>
  geminiOk({
    verses: items.map(([time_slot, book_id, chapter, verse_start, verse_end]) => ({
      time_slot,
      book_id,
      chapter,
      verse_start,
      verse_end: verse_end ?? verse_start,
    })),
  });

// A chapter in the API's simplified format, for texts of an exact length.
const chapterReply = (bookId: string, number: number, verses: Record<number, string>) => ({
  kind: "json" as const,
  body: {
    translation: { id: "BSB" },
    book: { id: bookId },
    numberOfVerses: Object.keys(verses).length,
    chapter: {
      number,
      content: Object.entries(verses).map(([verse, text]) => ({ type: "verse", number: Number(verse), text })),
    },
  },
});

function flow(replies: GeminiReply[], work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    const saved = { ...timing };
    timing.retryBackoffMs = 1;
    world.geminiQueue.push(...replies);
    try {
      await work(world);
    } finally {
      Object.assign(timing, saved);
      world.restore();
    }
  };
}

type FollowUpBody = {
  store: boolean;
  input: string;
  system_instruction: string;
  generation_config: { max_output_tokens: number };
  response_format: { schema: { properties: Record<string, unknown>; required: string[] } };
};
const followUp = (world: World) => world.geminiCalls[0].json as FollowUpBody;

// The real texts, as the fixtures hold them.
const PSA_46_1 = "God is our refuge and strength,\nan ever-present help in times of trouble.";
const PSA_23_1 = "The LORD is my shepherd;\nI shall not want.";
const PHP_4_13 = "I can do all things through Christ who gives me strength.";
const PHP_4_19 = "And my God will supply all your needs according to His glorious riches in Christ Jesus.";
const PSA_23_6 =
  "Surely goodness and mercy will follow me\nall the days of my life,\nand I will dwell in the house of the LORD\nforever.";

Deno.test(
  "three good verses are kept with the Bible's own words, and the model is not asked again",
  flow([], async (world) => {
    const result = await resolveAffirmationVerses(
      args(three(ref("PSA", 46, 1), ref("PSA", 23, 1), ref("PHP", 4, 19))),
    );
    assertEquals(result.verses, [
      { reference: "Psalm 46:1", text: PSA_46_1 },
      { reference: "Psalm 23:1", text: PSA_23_1 },
      { reference: "Philippians 4:19", text: PHP_4_19 },
    ]);
    assertEquals({ kept: result.kept, replaced: result.replaced }, { kept: 3, replaced: 0 });
    assertEquals(world.geminiCalls.length, 0);
    assertEquals(world.bibleCalls.length, 3, "one read per chapter");
  }),
);

Deno.test(
  "a verse too long for a lock screen and a fragment are asked for again in ONE follow-up that never sees the entry",
  flow([picks(["afternoon", "PHP", 4, 13], ["evening", "PSA", 23, 6])], async (world) => {
    const stats = newStats();
    const result = await resolveAffirmationVerses(
      args(three(ref("PSA", 46, 1), ref("ISA", 41, 10), ref("PSA", 46, 7)), { stats }),
    );
    assertEquals(result.verses, [
      { reference: "Psalm 46:1", text: PSA_46_1 },
      { reference: "Philippians 4:13", text: PHP_4_13 },
      { reference: "Psalm 23:6", text: PSA_23_6 },
    ]);
    assertEquals({ kept: result.kept, replaced: result.replaced }, { kept: 1, replaced: 2 });
    assertEquals(world.geminiCalls.length, 1);
    assertEquals(stats.attempts, 1);

    const body = followUp(world);
    assertEquals(body.store, false);
    assertEquals(body.generation_config.max_output_tokens, 4096);
    assertEquals(Object.keys(body.response_format.schema.properties), ["verses"]);
    assert(body.input.includes(`<affirmation time_slot="afternoon">Afternoon truth for you</affirmation>`));
    assert(
      body.input.includes("Isaiah 41:10 is too long to read in full on a lock screen (163 characters, at most 140)"),
    );
    assert(body.input.includes(`<affirmation time_slot="evening">Evening truth for you</affirmation>`));
    assert(body.input.includes("Psalm 46:7 is not a whole sentence on its own"));
    assert(!body.input.includes(`time_slot="morning"`), "the kept verse is not asked for again");
    assert(body.input.includes("Do not choose: Philippians 4:6–7, Psalm 46:1, Isaiah 41:10, Psalm 46:7."));
    assert(body.input.includes("<reflection_title>Peace in the Waiting</reflection_title>"));
    assert(body.input.includes("<feeling>anxious</feeling>"));
    assert(!body.input.includes(TEXT) && !body.input.includes("encouragement"), "never the entry or the texts");
    assert(body.system_instruction.includes("lock screen") && !body.system_instruction.includes("<journal_entry>"));
  }),
);

Deno.test(
  "a verse is refused before its chapter is read when it is several verses or part of the passage",
  flow([picks(["morning", "PHP", 4, 13], ["afternoon", "PHP", 4, 19])], async (world) => {
    const result = await resolveAffirmationVerses(
      args(three(ref("PSA", 23, 1, 2), ref("PHP", 4, 7), ref("PSA", 46, 1))),
    );
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), [
      "Philippians 4:13",
      "Philippians 4:19",
      "Psalm 46:1",
    ]);
    const input = followUp(world).input;
    assert(input.includes("Psalm 23:1–2 is more than one verse"));
    assert(input.includes("Philippians 4:7 is part of the reflection's passage"));
    // The first round read only Psalm 46; the follow-up's two verses share Philippians 4.
    assertEquals(world.bibleCalls.map((call) => call.url.pathname), [
      "/api/BSB/PSA/46.simple.json",
      "/api/BSB/PHP/4.simple.json",
    ]);
  }),
);

Deno.test(
  "a verse already given to another affirmation, or in the person's recent reflections, is asked for again",
  flow([picks(["afternoon", "PHP", 4, 13], ["evening", "PHP", 4, 19])], async (world) => {
    const result = await resolveAffirmationVerses(
      args(three(ref("PSA", 46, 1), ref("PSA", 46, 1), ref("PSA", 23, 1)), {
        recent: ["Psalm 23:1–3", "Isaiah 41:10"],
      }),
    );
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), [
      "Psalm 46:1",
      "Philippians 4:13",
      "Philippians 4:19",
    ]);
    const input = followUp(world).input;
    assert(input.includes("Psalm 46:1 is already another affirmation's verse"));
    assert(input.includes("Psalm 23:1 was in one of their recent reflections"));
    assert(input.includes("Psalm 23:1–3") && input.includes("Isaiah 41:10"), "recent ones are avoided too");
  }),
);

Deno.test(
  "the follow-up's verses meet the same rules: one in the passage, or the same as another new one, is left out",
  flow(
    [picks(["morning", "PSA", 46, 1], ["afternoon", "PHP", 4, 6], ["evening", "PSA", 46, 1])],
    async () => {
      // Three verses too long for a lock screen (163, 148 and 145 characters as one line).
      const result = await resolveAffirmationVerses(
        args(three(ref("ISA", 41, 10), ref("ISA", 41, 9), ref("PSA", 23, 4))),
      );
      assertEquals(result.verses.map((verse) => verse?.reference ?? null), ["Psalm 46:1", null, null]);
      assertEquals({ kept: result.kept, replaced: result.replaced }, { kept: 0, replaced: 1 });
    },
  ),
);

Deno.test(
  "the follow-up's verses meet the same rules: one already kept, or several verses, is left out",
  flow([picks(["morning", "PSA", 23, 1], ["afternoon", "PSA", 46, 1, 2])], async () => {
    const result = await resolveAffirmationVerses(
      args(three(ref("ISA", 41, 10), ref("ISA", 41, 9), ref("PSA", 23, 1))),
    );
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), [null, null, "Psalm 23:1"]);
    assertEquals({ kept: result.kept, replaced: result.replaced }, { kept: 1, replaced: 0 });
  }),
);

Deno.test(
  "a verse that does not exist is asked for again, and one whose replacement does not exist either goes without",
  flow([picks(["morning", "PHP", 4, 99])], async (world) => {
    const result = await resolveAffirmationVerses(args(three(ref("PHP", 4, 24), ref("PSA", 46, 1), ref("PSA", 23, 1))));
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), [null, "Psalm 46:1", "Psalm 23:1"]);
    assert(followUp(world).input.includes("Philippians 4 has no verse 24 in the Berean Standard Bible"));
    assertEquals(world.geminiCalls.length, 1, "no third request");
  }),
);

Deno.test(
  "a chapter that cannot be read leaves its verse out with no follow-up: another verse would meet the same outage",
  flow([], async (world) => {
    world.bible.set("PSA/46", { kind: "status", status: 503 });
    const result = await resolveAffirmationVerses(args(three(ref("PSA", 46, 1), ref("PSA", 23, 1), ref("PHP", 4, 19))));
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), [null, "Psalm 23:1", "Philippians 4:19"]);
    assertEquals(world.geminiCalls.length, 0);
  }),
);

Deno.test(
  "an affirmation the reply gave no verse is left without one, with no follow-up",
  flow([], async (world) => {
    const result = await resolveAffirmationVerses(args(three(ref("PSA", 46, 1), null, ref("PSA", 23, 1))));
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), ["Psalm 46:1", null, "Psalm 23:1"]);
    assertEquals(world.geminiCalls.length, 0);
  }),
);

for (
  const [label, reply] of [
    ["a busy service", geminiError(503)],
    ["blocked content", geminiError(400, { error: { code: "safety", message: "x" } })],
    ["a reply that is not JSON", geminiOk("not json")],
    ["a reply with no verses list", geminiOk({ picks: [] })],
  ] as const
) {
  Deno.test(
    `a follow-up that fails (${label}) keeps the verses that were kept and leaves the others without one`,
    flow([reply], async (world) => {
      const result = await resolveAffirmationVerses(
        args(three(ref("PSA", 46, 1), ref("ISA", 41, 10), ref("PSA", 23, 1))),
      );
      assertEquals(result.verses.map((verse) => verse?.reference ?? null), ["Psalm 46:1", null, "Psalm 23:1"]);
      assertEquals({ kept: result.kept, replaced: result.replaced }, { kept: 2, replaced: 0 });
      assertEquals(world.geminiCalls.length, 1, "never retried");
    }),
  );
}

Deno.test(
  "a follow-up is not made when the time is spent",
  flow([picks(["afternoon", "PHP", 4, 13])], async (world) => {
    const result = await resolveAffirmationVerses(
      args(three(ref("PSA", 46, 1), ref("ISA", 41, 10), ref("PSA", 23, 1)), { deadlineAt: Date.now() + 1_000 }),
    );
    assertEquals(result.verses[1], null);
    assertEquals(world.geminiCalls.length, 0);
  }),
);

Deno.test(
  "for a heavy moment a denied verse is refused before it is read, and the follow-up carries the heavy note",
  flow([picks(["morning", "PSA", 46, 1])], async (world) => {
    const result = await resolveAffirmationVerses(
      args(three(ref("JHN", 14, 2), ref("PSA", 23, 1), ref("PHP", 4, 19)), { heavy: true }),
    );
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), [
      "Psalm 46:1",
      "Psalm 23:1",
      "Philippians 4:19",
    ]);
    const input = followUp(world).input;
    assert(input.includes("John 14:2 is not right for this reflection"));
    assert(input.includes("Choose verses of God’s nearness and care"));
    assert(!world.bibleCalls.some((call) => call.url.pathname.includes("/JHN/14.")), "a denied chapter is never read");
  }),
);

Deno.test(
  "the same denied verse is kept when the moment is not heavy (only heavy moments deny it)",
  flow([], async (world) => {
    world.bible.set("JHN/14", chapterReply("JHN", 14, { 2: "My Father’s house has many rooms." }));
    const result = await resolveAffirmationVerses(args(three(ref("JHN", 14, 2), null, null)));
    assertEquals(result.verses[0], { reference: "John 14:2", text: "My Father’s house has many rooms." });
    assertEquals(world.geminiCalls.length, 0);
  }),
);

Deno.test(
  "the length cap counts the verse as one line: 140 characters are kept, 141 are not",
  flow([picks(["afternoon", "PSA", 23, 1])], async (world) => {
    // "God " + 65 + a space + 69 + "." = 140 as one line.
    const fits = `God ${"a".repeat(65)}\n${"b".repeat(69)}.`;
    const over = `God ${"a".repeat(66)}\n${"b".repeat(69)}.`;
    assertEquals(flowText(fits).length, AFFIRMATION_VERSE_MAX_CHARS);
    assertEquals(flowText(over).length, AFFIRMATION_VERSE_MAX_CHARS + 1);
    world.bible.set("ROM/8", chapterReply("ROM", 8, { 1: fits, 2: over }));
    const result = await resolveAffirmationVerses(args(three(ref("ROM", 8, 1), ref("ROM", 8, 2), null)));
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), ["Romans 8:1", "Psalm 23:1", null]);
    assert(followUp(world).input.includes("Romans 8:2 is too long to read in full on a lock screen (141 characters"));
  }),
);

Deno.test("a whole sentence starts with a capital (after a quote) and ends with . ! or ? (before a quote)", () => {
  for (
    const text of [
      PSA_23_1,
      PHP_4_13,
      "“Be still and know that I am God;\nI will be exalted among the nations,\nI will be exalted over the earth.”",
      "Is anything too hard for the LORD?",
      "Rejoice in the Lord always!",
    ]
  ) assert(isWholeSentence(text), text);
  for (
    const text of [
      "that everyone who believes in Him may have eternal life.",
      "The LORD of Hosts is with us;\nthe God of Jacob is our fortress. Selah",
      "‘May the LORD bless you and keep you;",
      "in all your ways acknowledge Him,",
      "",
    ]
  ) assert(!isWholeSentence(text), text);
});

Deno.test("a verse's lines become one line, with one space for each break, and none after a closed em dash", () => {
  assertEquals(flowText(PSA_46_1), "God is our refuge and strength, an ever-present help in times of trouble.");
  assertEquals(flowText("  a \n\n b  "), "a b");
  assertEquals(
    flowText("The LORD is my light and my salvation—\nwhom shall I fear?"),
    "The LORD is my light and my salvation—whom shall I fear?",
  );
});

Deno.test("a verse speaks of God when it names him or holds a pronoun the BSB capitalizes for him", () => {
  for (
    const text of [
      PSA_23_1,
      PHP_4_13,
      "Do not fear, for I am with you;\ndo not be afraid, for I am your God.",
      "He will not allow your foot to slip;\nyour Protector will not slumber.",
      "Come to Me, all you who are weary and burdened, and I will give you rest.",
      "Cast all your anxiety on Him, because He cares for you.",
    ]
  ) assert(speaksOfGod(text), text);
  for (
    const text of [
      "I take great joy and encouragement in your love, because you, brother, have refreshed the hearts of the saints.",
      "Love is patient, love is kind. It does not envy, it does not boast, it is not proud.",
      "Hope deferred makes the heart sick, but desire fulfilled is a tree of life.",
      // A lowercase "he" or "you" is a person's, never God's.
      "he is glad, and you are near.",
    ]
  ) assert(!speaksOfGod(text), text);
});

Deno.test(
  "the follow-up gives two verses per affirmation, best first: the second is read only when the first breaks a rule",
  flow(
    [picks(["afternoon", "ISA", 41, 9], ["afternoon", "PSA", 23, 1], ["evening", "PHP", 4, 13], [
      "evening",
      "PSA",
      23,
      6,
    ])],
    async (world) => {
      const result = await resolveAffirmationVerses(
        args(three(ref("PSA", 46, 1), ref("ISA", 41, 10), ref("PSA", 46, 7))),
      );
      // Afternoon: Isaiah 41:9 is too long, so its second, Psalm 23:1. Evening: its first, Philippians 4:13, and the second is
      // never needed.
      assertEquals(result.verses.map((verse) => verse?.reference ?? null), [
        "Psalm 46:1",
        "Psalm 23:1",
        "Philippians 4:13",
      ]);
      assertEquals({ kept: result.kept, replaced: result.replaced }, { kept: 1, replaced: 2 });
      assertEquals(world.geminiCalls.length, 1, "still one follow-up");
      assert(
        followUp(world).input.startsWith("Choose two different verses, best first, for each of these affirmations:"),
      );
      assertEquals((followUp(world).response_format.schema.properties.verses as { maxItems: number }).maxItems, 6);
      assertEquals(followUp(world).generation_config.max_output_tokens, 4096);
    },
  ),
);

Deno.test("a verse gives an order when a sentence of it opens with an imperative", () => {
  for (
    const text of [
      "Give thanks in every circumstance, for this is God’s will for you in Christ Jesus.",
      "Bear with one another and forgive any complaint you may have against someone else.",
      "The LORD Himself goes before you; He will be with you. He will never leave you nor forsake you. Do not be afraid or discouraged.”",
      "“Be still and know that I am God;\nI will be exalted among the nations,\nI will be exalted over the earth.”",
      "Trust in the LORD with all your heart,\nand lean not on your own understanding;",
      "Cast your burden upon the LORD and He will sustain you;\nHe will never let the righteous be shaken.",
    ]
  ) assert(givesAnOrder(text), text);
  for (
    const text of [
      PSA_46_1,
      PSA_23_1,
      PHP_4_19,
      PHP_4_13,
      "Because of the loving devotion of the LORD we are not consumed, for His mercies never fail.",
      "The LORD is my light and my salvation—\nwhom shall I fear?\nThe LORD is the stronghold of my life—\nwhom shall I dread?",
      // "Blessed" is not "Bless", and an imperative word inside a sentence is not an order.
      "Blessed be the God and Father of our Lord Jesus Christ, who has blessed us in Christ.",
      "He will not let your foot slip, and He who keeps you will not rest.",
    ]
  ) assert(!givesAnOrder(text), text);
});

Deno.test(
  "a verse that gives an order is asked for again",
  flow([picks(["morning", "PSA", 23, 1])], async (world) => {
    world.bible.set(
      "1TH/5",
      chapterReply("1TH", 5, {
        18: "Give thanks in every circumstance, for this is God’s will for you in Christ Jesus.",
      }),
    );
    const result = await resolveAffirmationVerses(args(three(ref("1TH", 5, 18), ref("PSA", 46, 1), ref("PHP", 4, 19))));
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), [
      "Psalm 23:1",
      "Psalm 46:1",
      "Philippians 4:19",
    ]);
    assert(followUp(world).input.includes("1 Thessalonians 5:18 tells them what to do"), followUp(world).input);
  }),
);

Deno.test(
  "a verse about someone else is asked for again",
  flow([picks(["morning", "PSA", 23, 1])], async (world) => {
    world.bible.set(
      "PHM/1",
      chapterReply("PHM", 1, {
        7: "I take great joy and encouragement in your love, because you, brother, have refreshed the hearts of the saints.",
      }),
    );
    const result = await resolveAffirmationVerses(args(three(ref("PHM", 1, 7), ref("PSA", 46, 1), ref("PHP", 4, 19))));
    assertEquals(result.verses.map((verse) => verse?.reference ?? null), [
      "Psalm 23:1",
      "Psalm 46:1",
      "Philippians 4:19",
    ]);
    assert(followUp(world).input.includes("Philemon 1:7 does not speak of God"), followUp(world).input);
  }),
);

Deno.test("the follow-up's reply is read leniently: an item that is not a verse is left out", () => {
  const read = parseVersePicks(
    "```json\n" + JSON.stringify({
      verses: [
        { time_slot: "morning", book_id: "PSA", chapter: 46, verse_start: 1, verse_end: 1 },
        { time_slot: "morning", book_id: "PSA", chapter: 23, verse_start: 1, verse_end: 1 },
        { time_slot: "noon", book_id: "PSA", chapter: 23, verse_start: 1, verse_end: 1 },
        { time_slot: "afternoon", book_id: "XYZ", chapter: 1, verse_start: 1, verse_end: 1 },
        { time_slot: "afternoon", book_id: "PSA", chapter: 0, verse_start: 1, verse_end: 1 },
        { time_slot: "afternoon", book_id: "PSA", chapter: 23, verse_start: 3, verse_end: 2 },
        { time_slot: "evening", book_id: "PHP", chapter: 4, verse_start: 13, verse_end: 13 },
        "PSA 23:1",
      ],
    }) + "\n```",
  );
  // Two verses per slot at most, best first; a third for one slot would be left out.
  assertEquals([...read.entries()], [
    ["morning", [ref("PSA", 46, 1), ref("PSA", 23, 1)]],
    ["evening", [ref("PHP", 4, 13)]],
  ]);
  const three = parseVersePicks(JSON.stringify({
    verses: [1, 2, 3].map((verse) => ({
      time_slot: "morning",
      book_id: "PSA",
      chapter: 46,
      verse_start: verse,
      verse_end: verse,
    })),
  }));
  assertEquals(three.get("morning")?.length, 2);
  for (
    const [text, reason] of [["{", "verses_json"], ["[]", "verses_shape"], ["null", "verses_shape"], [
      '{"verses":{}}',
      "verses_shape",
    ]]
  ) {
    try {
      parseVersePicks(text);
      throw new Error(`no error for ${text}`);
    } catch (error) {
      assert(error instanceof OutputInvalid, text);
      assertEquals((error as OutputInvalid).reason, reason);
    }
  }
});
