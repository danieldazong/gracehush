import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  geminiOk,
  installWorld,
  post,
  seedDevotional,
  TEXT,
  unscopedRequests,
  type World,
} from "../process-entry/testing/fakes.ts";
import type { AddAffirmationError, AddAffirmationResponse } from "../process-entry/contracts.ts";
import { OutputInvalid } from "../process-entry/output.ts";
import { addTiming, checkExtra, handle, readExtra } from "./handler.ts";
import { ADD_PROMPT_VERSION, buildAddTurn } from "./prompt.ts";

const USER = "user_test";
const PSA_46_1 = "God is our refuge and strength,\nan ever-present help in times of trouble.";
const PHP_4_19 = "And my God will supply all your needs according to His glorious riches in Christ Jesus.";

type Row = Record<string, unknown>;

// A finished reflection of the test user's, with its passage, and its three affirmations in their slots (the rows process-entry
// saved: positions 1 to 3, the verses named only where a test needs them).
function seedReflection(world: World, over: Row = {}, affirmations: Row[] = []) {
  const entry = seedDevotional(world, USER, {
    scripture_reference: "Philippians 4:6–7",
    scripture_text: "Be anxious for nothing…",
    scripture_verified: true,
    ...over,
  });
  const base = [
    { time_slot: "morning", headline: "You are held", affirmation_text: "Begin the day knowing you are held." },
    { time_slot: "afternoon", headline: "Rest is allowed", affirmation_text: "Pause and breathe; the work will wait." },
    { time_slot: "evening", headline: "It is enough", affirmation_text: "You did what you could today." },
  ];
  const rows = [...base, ...affirmations].map((row, index) => ({
    id: crypto.randomUUID(),
    user_id: USER,
    entry_id: entry.id,
    is_delivered: false,
    is_favorite: false,
    scheduled_for: null,
    created_at: world.now(),
    verse_reference: null,
    verse_text: null,
    position: index + 1,
    ...row,
  }));
  world.affirmations.push(...rows);
  return { entry, rows };
}

// A reply that passes every check against the seeded reflection: a new truth, a verse of its own, no slot taken.
function reply(over: Row = {}): Row {
  return {
    verse: { book_id: "PSA", chapter: 46, verse_start: 1, verse_end: 1 },
    headline: "Your refuge stands ready",
    text: "When the ground shifts under you today, God himself is the strength and the shelter you can lean on.",
    featured_slot: "none",
    ...over,
  };
}

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    const saved = { ...addTiming };
    try {
      await work(world);
    } finally {
      Object.assign(addTiming, saved);
      world.restore();
    }
  };
}

const ask = (world: World, entryId: unknown, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, { entryId }, options);
const answer = async (response: Response) => (await response.json()) as AddAffirmationResponse;
const failure = async (response: Response) => (await response.json()) as AddAffirmationError;
const lastLog = (world: World) => JSON.parse(world.logs.at(-1)!);
const inputOf = (request: { json: unknown }) =>
  String(((request.json as Row).input as Row[])?.[0]?.text ?? (request.json as Row).input ?? "");
const rpcCalls = (world: World) =>
  world.requests.filter((request) => request.url.pathname.endsWith("/rpc/feature_affirmation"));

// The reply is refused with the reason named (OutputInvalid), and not kept.
function assertThrows(work: () => unknown, _kind: typeof OutputInvalid, reason: string): void {
  try {
    work();
  } catch (error) {
    assert(error instanceof OutputInvalid, `expected OutputInvalid, got ${String(error)}`);
    assertEquals((error as OutputInvalid).reason, reason);
    return;
  }
  throw new Error(`expected a refusal for ${reason}`);
}

Deno.test(
  "one more affirmation: written from the entry, its verse read from the Bible, saved at position 4 with no slot, and the whole list answered in order",
  flow(async (world) => {
    const { entry } = seedReflection(world);
    world.geminiQueue.push(geminiOk(reply()));
    const response = await ask(world, entry.id);
    assertEquals(response.status, 200);
    const { affirmations } = await answer(response);
    assertEquals(affirmations.length, 4);
    assertEquals(affirmations.map((item) => item.position), [1, 2, 3, 4]);
    assertEquals(affirmations.map((item) => item.slot), ["morning", "afternoon", "evening", null]);
    const added = affirmations[3];
    assertEquals(added.headline, "Your refuge stands ready");
    assertEquals(added.verse, { reference: "Psalm 46:1", text: PSA_46_1 });
    assertEquals(added.isFavorite, false);
    assertEquals(world.affirmations.length, 4);
    assertEquals(world.geminiCalls.length, 1, "one model call");
    assertEquals(world.bibleCalls.length, 1, "one chapter read");
    assertEquals(rpcCalls(world).length, 0, "no slot moved");
    assertEquals(unscopedRequests(world, USER), []);
    // The user turn: the person's words, the reflection's facts and the affirmations it already has (headlines and verses, never
    // their texts), and no heavy block.
    const turn = inputOf(world.geminiCalls[0]);
    assert(turn.includes(TEXT));
    assert(turn.includes("Passage: Philippians 4:6–7"));
    assert(turn.includes("- morning: “You are held” (no verse)"));
    assert(turn.includes("- evening: “It is enough” (no verse)"));
    assert(!turn.includes("Begin the day knowing"));
    assert(!turn.includes("<heavy_moment>"));
    // The log line: the shared 43 fields, the outcome as a word, the verse counted, and no word of anyone's.
    const line = lastLog(world);
    assertEquals(Object.keys(line).length, 43);
    assertEquals(line.status, 200);
    assertEquals(line.reason, "affirmation:added");
    assertEquals(line.promptVersion, ADD_PROMPT_VERSION);
    assertEquals(line.affirmationVerses, 1);
    assertEquals(line.attempts, 1);
    const text = JSON.stringify(line);
    for (const word of ["refuge", "Psalm", "anxious", entry.id, USER]) assert(!text.includes(word), word);
  }),
);

Deno.test(
  "the new affirmation takes the position after the highest one, not the count: a gap in the positions is never filled",
  flow(async (world) => {
    // Rows at 1, 2, 3 and 5: the count plus one would be 5, which is taken (the unique key would refuse it).
    const { entry } = seedReflection(world, {}, [
      { time_slot: null, position: 5, headline: "A fifth truth", affirmation_text: "Kept at position five." },
    ]);
    world.geminiQueue.push(geminiOk(reply()));
    const response = await ask(world, entry.id);
    assertEquals(response.status, 200);
    const { affirmations } = await answer(response);
    assertEquals(affirmations.map((item) => item.position), [1, 2, 3, 5, 6]);
    assertEquals(affirmations[4].headline, "Your refuge stands ready");
    assertEquals(world.affirmations.length, 5);
  }),
);

Deno.test(
  "the model may give the new affirmation a lock-screen slot: the holder loses it in one step, the new one carries it, and the log says which",
  flow(async (world) => {
    const { entry, rows } = seedReflection(world);
    world.geminiQueue.push(geminiOk(reply({ featured_slot: "morning" })));
    const { affirmations } = await answer(await ask(world, entry.id));
    assertEquals(affirmations.map((item) => item.slot), [null, "afternoon", "evening", "morning"]);
    assertEquals(affirmations.map((item) => item.position), [1, 2, 3, 4], "the order of the cards does not move");
    const old = world.affirmations.find((row) => row.id === rows[0].id)!;
    assertEquals(old.time_slot, null);
    assertEquals(rpcCalls(world).length, 1);
    assertEquals((rpcCalls(world)[0].json as Row).p_slot, "morning");
    assertEquals(lastLog(world).reason, "affirmation:added:morning");
  }),
);

Deno.test(
  "a slot move that fails leaves the affirmation saved and the lock screen as it was",
  flow(async (world) => {
    const { entry } = seedReflection(world);
    // The RPC refuses when the affirmation is not the entry's: make it refuse by naming a slot the migration does not know.
    world.geminiQueue.push(geminiOk(reply({ featured_slot: "evening" })));
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.endsWith("/rpc/feature_affirmation")) {
        return new Response(JSON.stringify({ code: "P0002", message: "no such affirmation" }), { status: 400 });
      }
      return await original(input, init);
    };
    try {
      const { affirmations } = await answer(await ask(world, entry.id));
      assertEquals(affirmations.length, 4);
      assertEquals(affirmations.map((item) => item.slot), ["morning", "afternoon", "evening", null]);
      assertEquals(lastLog(world).reason, "affirmation:added:feature_failed");
    } finally {
      globalThis.fetch = original;
    }
  }),
);

Deno.test(
  "a reflection with all ten affirmations answers AFFIRMATION_LIMIT with no model call and nothing written",
  flow(async (world) => {
    const extras = Array.from({ length: 7 }, (_, index) => ({
      time_slot: null,
      headline: `Truth ${index + 4}`,
      affirmation_text: "A line.",
    }));
    const { entry } = seedReflection(world, {}, extras);
    const response = await ask(world, entry.id);
    assertEquals(response.status, 409);
    assertEquals((await failure(response)).error.code, "AFFIRMATION_LIMIT");
    assertEquals(world.geminiCalls.length, 0);
    assertEquals(world.affirmations.length, 10);
    assertEquals(lastLog(world).reason, "affirmation_limit");
  }),
);

Deno.test(
  "another person's reflection, one that does not exist, one that failed and one still being made",
  flow(async (world) => {
    const { entry: foreign } = seedReflection(world, { user_id: "user_other" });
    const failed = seedDevotional(world, USER, { processing_status: "failed", devotional_script: null });
    const making = seedDevotional(world, USER, { processing_status: "processing", devotional_script: null });
    for (
      const [id, status, code] of [
        [foreign.id, 404, "NOT_FOUND"],
        [crypto.randomUUID(), 404, "NOT_FOUND"],
        [failed.id, 404, "NOT_FOUND"],
        [making.id, 409, "ALREADY_PROCESSING"],
      ] as const
    ) {
      const response = await ask(world, id);
      assertEquals(response.status, status);
      assertEquals((await failure(response)).error.code, code);
    }
    assertEquals(world.geminiCalls.length, 0);
    assertEquals(world.affirmations.length, 3, "the foreign reflection's three, untouched");
  }),
);

Deno.test(
  "a never-say phrase refuses the reply, which is asked for again with a note; a clean second reply is saved",
  flow(async (world) => {
    const { entry } = seedReflection(world);
    world.geminiQueue.push(
      geminiOk(reply({ text: "Everything happens for a reason, and God will carry you through this season today." })),
      geminiOk(reply()),
    );
    const { affirmations } = await answer(await ask(world, entry.id));
    assertEquals(affirmations.length, 4);
    assertEquals(world.geminiCalls.length, 2);
    assert(inputOf(world.geminiCalls[1]).includes("<correction>"));
    assertEquals(lastLog(world).reason, "affirmation:added");
  }),
);

Deno.test(
  "two replies that both break a hard rule save nothing: AI_UNAVAILABLE, and the person can try again",
  flow(async (world) => {
    const { entry } = seedReflection(world);
    world.geminiQueue.push(
      geminiOk(reply({ text: "God won't give you more than you can handle, so hold on through today." })),
      geminiOk(reply({ text: "God won't give you more than you can handle, so hold on through today." })),
    );
    const response = await ask(world, entry.id);
    assertEquals(response.status, 503);
    assertEquals((await failure(response)).error.code, "AI_UNAVAILABLE");
    assertEquals(world.affirmations.length, 3);
    assertEquals(world.geminiCalls.length, 2);
  }),
);

Deno.test(
  "a feeling word in the headline costs a retry with a note, and when the second reply has one too the reply is kept and the log says salvaged",
  flow(async (world) => {
    const { entry } = seedReflection(world);
    world.geminiQueue.push(
      geminiOk(reply({ headline: "Your grief is seen" })),
      geminiOk(reply({ headline: "Your worry has a keeper" })),
    );
    const { affirmations } = await answer(await ask(world, entry.id));
    assertEquals(affirmations[3].headline, "Your worry has a keeper");
    assertEquals(world.geminiCalls.length, 2);
    assert(inputOf(world.geminiCalls[1]).includes("feeling word"));
    assertEquals(lastLog(world).reason, "affirmation:added:salvaged:headline_feeling");
  }),
);

Deno.test(
  "a headline the reflection already has, or one of the person's recent ones, is asked for again",
  flow(async (world) => {
    const { entry } = seedReflection(world);
    // A recent affirmation of another reflection of theirs.
    const other = seedDevotional(world, USER);
    world.affirmations.push({
      id: crypto.randomUUID(),
      user_id: USER,
      entry_id: other.id,
      time_slot: "morning",
      headline: "Peace keeps your heart",
      affirmation_text: "x",
      is_favorite: false,
      is_delivered: false,
      scheduled_for: null,
      created_at: world.now(),
      verse_reference: "Psalm 23:1",
      verse_text: "The LORD is my shepherd;\nI shall not want.",
      position: 1,
    });
    world.geminiQueue.push(
      geminiOk(reply({ headline: "you are held" })),
      geminiOk(reply({ headline: "Peace keeps your heart" })),
      geminiOk(reply()),
    );
    const { affirmations } = await answer(await ask(world, entry.id));
    // The second reply repeated a recent headline too, so it was kept as the salvage: two replies is the most one call asks for.
    assertEquals(world.geminiCalls.length, 2);
    assertEquals(affirmations[3].headline, "Peace keeps your heart");
    assertEquals(lastLog(world).reason, "affirmation:added:salvaged:headline_repeated");
    // The recent verse is one the new affirmation may not take.
    assert(inputOf(world.geminiCalls[0]).includes("- morning: “You are held” (no verse)"));
  }),
);

Deno.test(
  "a word from the entry in the headline is asked for again, and when it stays the headline is a safe one",
  flow(async (world) => {
    const { entry } = seedReflection(world, {
      transcript: "I keep thinking about Lagos and my manager Tunde all week.",
    });
    world.geminiQueue.push(
      geminiOk(reply({ headline: "Lagos is in his hands" })),
      geminiOk(reply({ headline: "Tunde is in his hands" })),
    );
    const { affirmations } = await answer(await ask(world, entry.id));
    assertEquals(affirmations[3].headline, "God is with you here");
    assertEquals(world.geminiCalls.length, 2);
    assertEquals(lastLog(world).reason, "affirmation:added:salvaged:headline_private");
    const text = JSON.stringify(lastLog(world));
    assert(!text.includes("Lagos") && !text.includes("Tunde"));
  }),
);

Deno.test(
  "a verse inside the reflection's passage, or one the reflection already has, costs one follow-up, whose verse is saved",
  flow(async (world) => {
    const { entry } = seedReflection(world, {}, []);
    // The reflection's evening affirmation already carries Psalm 46:1.
    world.affirmations[2].verse_reference = "Psalm 46:1";
    world.affirmations[2].verse_text = PSA_46_1;
    world.geminiQueue.push(
      geminiOk(reply({ verse: { book_id: "PHP", chapter: 4, verse_start: 6, verse_end: 6 } })),
      geminiOk({
        verses: [
          { time_slot: "morning", book_id: "PSA", chapter: 46, verse_start: 1, verse_end: 1 },
          { time_slot: "morning", book_id: "PHP", chapter: 4, verse_start: 19, verse_end: 19 },
        ],
      }),
    );
    const { affirmations } = await answer(await ask(world, entry.id));
    assertEquals(world.geminiCalls.length, 2, "the reply and one follow-up");
    // The follow-up's first candidate is already another affirmation's, so the second is the one kept.
    assertEquals(affirmations[3].verse, { reference: "Philippians 4:19", text: PHP_4_19 });
    assertEquals(lastLog(world).affirmationVerses, 1);
  }),
);

Deno.test(
  "a verse that still cannot be used leaves the affirmation without one, saved all the same",
  flow(async (world) => {
    const { entry } = seedReflection(world);
    world.geminiQueue.push(
      // Isaiah 41:10 is too long for a lock screen and gives an order.
      geminiOk(reply({ verse: { book_id: "ISA", chapter: 41, verse_start: 10, verse_end: 10 } })),
      geminiOk({ verses: [] }),
    );
    const { affirmations } = await answer(await ask(world, entry.id));
    assertEquals(affirmations[3].verse, null);
    assertEquals(world.affirmations[3].verse_reference, null);
    assertEquals(lastLog(world).affirmationVerses, 0);
  }),
);

Deno.test(
  "a heavy moment: the user turn says so, a heavy never-say phrase refuses the reply, and a denied verse is replaced",
  flow(async (world) => {
    const { entry } = seedReflection(world, { is_crisis: true });
    world.geminiQueue.push(
      geminiOk(reply({ text: "Soon you will find rest at last in his arms, whatever this day holds for you." })),
      geminiOk(reply({ verse: { book_id: "PHP", chapter: 1, verse_start: 21, verse_end: 21 } })),
      geminiOk({ verses: [{ time_slot: "morning", book_id: "PSA", chapter: 46, verse_start: 1, verse_end: 1 }] }),
    );
    const { affirmations } = await answer(await ask(world, entry.id));
    assert(inputOf(world.geminiCalls[0]).includes("<heavy_moment>"));
    assertEquals(world.geminiCalls.length, 3, "the refused reply, the clean one and the verse follow-up");
    assertEquals(affirmations[3].verse?.reference, "Psalm 46:1");
    const avoid = inputOf(world.geminiCalls[2]);
    assert(avoid.includes("Philippians 1:21"), "the denied verse is one not to choose again");
    assertEquals(lastLog(world).reason, "affirmation:added");
  }),
);

Deno.test(
  "the body, the method and the token: a bad id is 400, GET is 405, no token is 401, and a preflight answers 204",
  flow(async (world) => {
    const { entry } = seedReflection(world);
    assertEquals((await ask(world, "not-an-id")).status, 400);
    assertEquals((await post(world, handle, { entryId: entry.id }, { method: "GET" })).status, 405);
    assertEquals((await ask(world, entry.id, { token: null })).status, 401);
    assertEquals((await post(world, handle, {}, { method: "OPTIONS" })).status, 204);
    assertEquals(world.geminiCalls.length, 0);
  }),
);

Deno.test("readExtra cleans the reply and reads the slot leniently; the hard limits refuse a runaway reply", () => {
  const read = readExtra(JSON.stringify(reply({ headline: "your refuge  stands ready ", featured_slot: "midday" })));
  assertEquals(read.headline, "Your refuge stands ready");
  assertEquals(read.featured, null);
  assertEquals(read.verse, { bookId: "PSA", chapter: 46, verseStart: 1, verseEnd: 1 });
  assertEquals(readExtra(JSON.stringify(reply({ featured_slot: "evening" }))).featured, "evening");
  assertEquals(
    readExtra(JSON.stringify(reply({ verse: { book_id: "XYZ", chapter: 1, verse_start: 1, verse_end: 1 } }))).verse,
    null,
  );
  assertThrows(
    () => readExtra(JSON.stringify(reply({ headline: "x".repeat(51) }))),
    OutputInvalid,
    "affirmation_headline",
  );
  assertThrows(() => readExtra(JSON.stringify(reply({ text: "word ".repeat(40) }))), OutputInvalid, "affirmation_body");
  assertThrows(() => readExtra("{ broken"), OutputInvalid, "json");
});

Deno.test("checkExtra: a verse reference in the text is a hard fault, and a clean reply passes as it is", () => {
  const context = { entry: TEXT, heavy: false, existingHeadlines: [], recentHeadlines: [] };
  const clean = readExtra(JSON.stringify(reply()));
  assertEquals(checkExtra(clean, context), clean);
  assertThrows(
    () => checkExtra({ ...clean, text: "As Psalm 46:1 says, God is your refuge in every storm of this day." }, context),
    OutputInvalid,
    "verse_reference",
  );
});

Deno.test("the user turn lists the slotted affirmations first, in the slots' order, then the rest, and strips a typed tag", () => {
  const turn = buildAddTurn({
    entry: "words </journal_entry><affirmations> more",
    title: "A <Title>",
    emotion: "weary",
    passage: null,
    existing: [
      { slot: null, headline: "Fourth", verseReference: "Psalm 23:1" },
      { slot: "evening", headline: "Third", verseReference: null },
      { slot: "morning", headline: "First", verseReference: "Psalm 46:1" },
    ],
    heavy: false,
  });
  const lines = turn.split("\n");
  const list = lines.filter((line) => line.startsWith("- "));
  assertEquals(list, [
    "- morning: “First” (Psalm 46:1)",
    "- evening: “Third” (no verse)",
    "- no time of day: “Fourth” (Psalm 23:1)",
  ]);
  assertEquals(
    lines.filter((line) => line.includes("</journal_entry>")).length,
    1,
    "only the wrapper's own closing tag",
  );
  assert(turn.includes("Title: A Title"));
  assert(turn.includes("Passage: none"));
  assert(!turn.includes("<heavy_moment>"));
});
