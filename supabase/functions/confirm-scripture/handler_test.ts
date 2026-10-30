import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { installWorld, post, unscopedRequests, type World } from "../process-entry/testing/fakes.ts";
import type { ConfirmScriptureError, ConfirmScriptureResponse } from "../process-entry/contracts.ts";
import { confirmTiming, forgetChecks, handle } from "./handler.ts";

const USER = "user_test";
const PHP_4_6_7 =
  "Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.";
const PSA_23_1_3 =
  "The LORD is my shepherd;\nI shall not want.\nHe makes me lie down in green pastures;\nHe leads me beside quiet waters.\nHe restores my soul;\nHe guides me in the paths of righteousness\nfor the sake of His name.";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

// A finished reflection whose passage was kept as a reference only (the Bible could not be read at the time).
function seed(world: World, over: Record<string, unknown> = {}) {
  return world.seedEntry({
    user_id: USER,
    client_entry_id: crypto.randomUUID(),
    input_type: "text",
    processing_status: "ready",
    dominant_emotion: "anxious",
    devotional_title: "Peace in the Waiting",
    devotional_script: "Words.",
    closing_prayer: "Lord, hear us.",
    scripture_reference: "Philippians 4:6–7",
    scripture_text: null,
    scripture_verified: false,
    updated_at: minutesAgo(5),
    ...over,
  });
}

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    const saved = { ...confirmTiming };
    forgetChecks();
    try {
      await work(world);
    } finally {
      Object.assign(confirmTiming, saved);
      forgetChecks();
      world.restore();
    }
  };
}

const ask = (world: World, entryId: unknown, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, { entryId }, options);
const answer = async (response: Response) => (await response.json()) as ConfirmScriptureResponse;
const failure = async (response: Response) => (await response.json()) as ConfirmScriptureError;
const lastLog = (world: World) => JSON.parse(world.logs.at(-1)!);
const writes = (world: World) =>
  world.requests.filter((request) => request.method !== "GET" && request.method !== "HEAD");

Deno.test(
  "an unverified passage is verified: the exact text is saved and returned",
  flow(async (world) => {
    const entry = seed(world);
    const response = await ask(world, entry.id);
    assertEquals(response.status, 200);
    assertEquals(await answer(response), {
      scripture: { reference: "Philippians 4:6–7", text: PHP_4_6_7, translation: "BSB", verified: true },
    });
    const [row] = world.entries;
    assertEquals(row.scripture_text, PHP_4_6_7);
    assertEquals(row.scripture_verified, true);
    assertEquals(row.scripture_reference, "Philippians 4:6–7");
    assertEquals(world.bibleCalls.length, 1);
    assertEquals(world.geminiCalls.length, 0, "this function never asks the model");
    assertEquals(unscopedRequests(world, USER), []);
    assertEquals(lastLog(world).scripture, "verified");
  }),
);

Deno.test(
  "an older spelling of the reference is read, and saved in the usual form (Psalms 23:1-3 becomes Psalm 23:1–3)",
  flow(async (world) => {
    const entry = seed(world, { scripture_reference: "Psalms 23:1-3" });
    const { scripture } = await answer(await ask(world, entry.id));
    assertEquals(scripture, { reference: "Psalm 23:1–3", text: PSA_23_1_3, translation: "BSB", verified: true });
    assertEquals(world.entries[0].scripture_reference, "Psalm 23:1–3");
  }),
);

Deno.test(
  "an entry that is already verified is returned as it is, with no Bible request and no write",
  flow(async (world) => {
    const entry = seed(world, { scripture_text: PHP_4_6_7, scripture_verified: true });
    const { scripture } = await answer(await ask(world, entry.id));
    assertEquals(scripture?.verified, true);
    assertEquals(scripture?.text, PHP_4_6_7);
    assertEquals(world.bibleCalls.length, 0);
    assertEquals(writes(world), []);
    assertEquals(lastLog(world).scripture, null);
  }),
);

Deno.test(
  "a crisis entry, an unfinished one and one with no passage have nothing to confirm",
  flow(async (world) => {
    const cases = [
      seed(world, {
        is_crisis: true,
        scripture_reference: null,
        devotional_title: null,
        devotional_script: null,
        closing_prayer: null,
        dominant_emotion: null,
      }),
      seed(world, { processing_status: "processing" }),
      seed(world, { processing_status: "failed", scripture_reference: null }),
      seed(world, { scripture_reference: null }),
    ];
    for (const entry of cases) {
      const response = await ask(world, entry.id);
      assertEquals(response.status, 200);
      assertEquals(await answer(response), { scripture: null });
    }
    assertEquals(world.bibleCalls.length, 0);
    assertEquals(writes(world), []);
  }),
);

Deno.test(
  "an entry changed in the last minute is answered as it is, without reading the Bible",
  flow(async (world) => {
    const entry = seed(world, { updated_at: new Date().toISOString() });
    const { scripture } = await answer(await ask(world, entry.id));
    assertEquals(scripture, { reference: "Philippians 4:6–7", text: null, translation: "BSB", verified: false });
    assertEquals(world.bibleCalls.length, 0);
    assertEquals(writes(world), []);
    assertEquals(lastLog(world).scripture, "unverified");
  }),
);

Deno.test(
  "when the Bible still cannot be read the entry stays as it was, and asking again at once does not read it again",
  flow(async (world) => {
    world.bible.set("PHP/4", { kind: "status", status: 503 });
    const entry = seed(world);
    const first = await ask(world, entry.id);
    assertEquals(first.status, 200);
    assertEquals((await answer(first)).scripture?.verified, false);
    assertEquals(world.bibleCalls.length, 2, "one try and one more");
    assertEquals(writes(world), []);
    assertEquals(world.entries[0].scripture_reference, "Philippians 4:6–7");

    // Asked again straight away: answered from what is known, with no new Bible request.
    const again = await ask(world, entry.id);
    assertEquals((await answer(again)).scripture?.verified, false);
    assertEquals(world.bibleCalls.length, 2);

    // A minute later, with the Bible back, it is read and verified.
    confirmTiming.windowMs = 0;
    world.bible.delete("PHP/4");
    const later = await ask(world, entry.id);
    assertEquals((await answer(later)).scripture?.verified, true);
    assertEquals(world.entries[0].scripture_verified, true);
  }),
);

Deno.test(
  "a reference that cannot be read, or names a passage that does not exist, is removed",
  flow(async (world) => {
    const unreadable = seed(world, { scripture_reference: "Hezekiah 1:1" });
    const missing = seed(world, { scripture_reference: "Philippians 4:24–25" });
    for (const entry of [unreadable, missing]) {
      const response = await ask(world, entry.id);
      assertEquals(response.status, 200);
      assertEquals(await answer(response), { scripture: null });
      assertEquals(lastLog(world).scripture, "dropped");
    }
    for (const row of world.entries) {
      assertEquals(row.scripture_reference, null);
      assertEquals(row.scripture_text, null);
      assertEquals(row.scripture_verified, false);
    }
    // The first never reached the Bible (nothing to look up); the second did, and found no such verse.
    assertEquals(world.bibleCalls.length, 1);
  }),
);

Deno.test(
  "another person's entry and an entry that does not exist get the same answer, and nothing is read or written",
  flow(async (world) => {
    const theirs = seed(world, { user_id: "user_someone_else" });
    const first = await ask(world, theirs.id);
    const second = await ask(world, crypto.randomUUID());
    assertEquals(first.status, 404);
    assertEquals(second.status, 404);
    const a = await failure(first);
    const b = await failure(second);
    assertEquals(a.error.code, "NOT_FOUND");
    assertEquals(a.error.message, "We couldn’t find this reflection.");
    assertEquals(Object.keys(a.error).sort(), ["code", "message", "requestId"]);
    assertEquals({ ...a.error, requestId: "" }, { ...b.error, requestId: "" });
    assertEquals(world.bibleCalls.length, 0);
    assertEquals(writes(world), []);
    assertEquals(world.entries[0].scripture_verified, false);
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "who is asking comes only from the token: a user_id in the body changes nothing",
  flow(async (world) => {
    const theirs = seed(world, { user_id: "user_victim" });
    const response = await post(world, handle, { entryId: theirs.id, user_id: "user_victim", userId: "user_victim" }, {
      sub: "user_attacker",
    });
    assertEquals(response.status, 404);
    assertEquals(world.entries[0].scripture_verified, false);
    assertEquals(writes(world), []);
  }),
);

Deno.test(
  "a request that is not a clear request for one entry is refused before the database is touched",
  flow(async (world) => {
    const id = crypto.randomUUID();
    const bad: [string, () => Promise<Response>][] = [
      ["no entryId", () => post(world, handle, {})],
      ["a number", () => ask(world, 7)],
      ["not a uuid", () => ask(world, "not-a-uuid")],
      ["an uppercase uuid", () => ask(world, id.toUpperCase())],
      ["an array body", () => post(world, handle, [id])],
      ["a body that is not JSON", () => post(world, handle, null, { raw: "{ broken" })],
      ["a body that is far too big", () => post(world, handle, { entryId: id, pad: "x".repeat(70_000) })],
    ];
    for (const [what, send] of bad) {
      const response = await send();
      assertEquals(response.status, 400, what);
      assertEquals((await failure(response)).error.code, "INVALID_REQUEST", what);
    }
    assertEquals(world.requests.length, 0);
  }),
);

Deno.test(
  "only POST is answered, and a request with no valid token is refused first",
  flow(async (world) => {
    const preflight = await handle(new Request("https://x.test/", { method: "OPTIONS" }));
    assertEquals(preflight.status, 204);
    const get = await post(world, handle, null, { method: "GET" });
    assertEquals(get.status, 405);
    assertEquals((await failure(get)).error.code, "METHOD_NOT_ALLOWED");

    const none = await ask(world, crypto.randomUUID(), { token: null });
    assertEquals(none.status, 401);
    assertEquals((await failure(none)).error.code, "UNAUTHORIZED");
    const expired = await ask(world, crypto.randomUUID(), { token: await world.token({}, { expiresIn: -120 }) });
    assertEquals(expired.status, 401);
    assertEquals(world.requests.length, 0);
    assertEquals(world.bibleCalls.length, 0);
  }),
);

Deno.test(
  "two requests together verify the entry once",
  flow(async (world) => {
    const entry = seed(world);
    const [a, b] = await Promise.all([ask(world, entry.id), ask(world, entry.id)]);
    assertEquals([a.status, b.status], [200, 200]);
    const answers = [(await answer(a)).scripture, (await answer(b)).scripture];
    assert(answers.some((scripture) => scripture?.verified === true));
    assertEquals(world.entries[0].scripture_verified, true);
    assertEquals(writes(world).length, 1);
  }),
);

Deno.test(
  "the log line holds no passage, no entry id and no token",
  flow(async (world) => {
    const token = await world.token({ sub: USER });
    const entry = seed(world);
    assertEquals((await ask(world, entry.id, { token })).status, 200);
    assertEquals(world.logs.length, 1);
    const line = JSON.parse(world.logs[0]);
    assertEquals(Object.keys(line).sort(), [
      "account",
      "accountBytes",
      "accountEntries",
      "accountFiles",
      "accountLeftOut",
      "attempts",
      "audioMs",
      "authMs",
      "bibleMs",
      "billing",
      "billingEvent",
      "billingMs",
      "code",
      "crisisSource",
      "dbMs",
      "fallbackAttempts",
      "geminiMs",
      "inputType",
      "limit",
      "limitUsed",
      "model",
      "promptVersion",
      "reason",
      "requestId",
      "screen",
      "screenAttempts",
      "screenMs",
      "scripture",
      "status",
      "tokensIn",
      "tokensOut",
      "tokensThought",
      "totalMs",
      "tts",
      "ttsAttempts",
      "ttsChars",
      "ttsMs",
      "user",
    ]);
    assertEquals(line.status, 200);
    assertEquals(line.scripture, "verified");
    // Speech and the free limit are process-entry's: this function leaves their fields empty.
    assertEquals([line.tts, line.ttsMs, line.ttsAttempts, line.ttsChars, line.audioMs], [null, 0, 0, 0, null]);
    assertEquals([line.limit, line.limitUsed], [null, null]);
    for (
      const word of [
        String(entry.id),
        USER,
        token,
        "Philippians",
        "PHP",
        "Be anxious",
        "Christ Jesus",
        "sb_secret_test_key",
      ]
    ) {
      assert(!world.logs.join("\n").includes(word), `the log must not contain: ${word}`);
    }
  }),
);

Deno.test(
  "a database that cannot be reached is a plain 500, with no detail",
  flow(async (world) => {
    const real = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(new Request(input, init).url);
      return url.host.endsWith("supabase.test")
        ? Promise.reject(new TypeError("connect ECONNREFUSED 10.0.0.1:5432"))
        : real(input, init);
    };
    const response = await ask(world, crypto.randomUUID());
    globalThis.fetch = real;
    assertEquals(response.status, 500);
    const json = await failure(response);
    assertEquals(json.error.code, "INTERNAL");
    assert(!JSON.stringify(json).includes("ECONNREFUSED"));
  }),
);
