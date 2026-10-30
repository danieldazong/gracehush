import { CLAIM_LEASE_MS } from "../process-entry/constants.ts";
import type { DeleteEntryError, DeleteEntryResponse } from "../process-entry/contracts.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { installWorld, post, unscopedRequests, type World } from "../process-entry/testing/fakes.ts";
import { handle } from "./handler.ts";
import { RECORD_KEEP_MS } from "./lifecycle.ts";

// delete-entry (step 29b) against the fake Supabase: what it removes and in what order, what it keeps so that deleting does not
// give a free devotional back, who may delete what, and what a failure in the middle leaves behind.

const USER = "user_test";
const DAY = 24 * 3600 * 1000;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

// A finished reflection of the signed-in user with its devotional audio in the private bucket (and its recording when it was
// spoken) and its three affirmations.
function seed(world: World, over: Record<string, unknown> = {}, voice = false) {
  const id = crypto.randomUUID();
  const clientEntryId = crypto.randomUUID();
  const owner = String(over.user_id ?? USER);
  const entry = world.seedEntry({
    id,
    user_id: owner,
    client_entry_id: clientEntryId,
    input_type: voice ? "audio" : "text",
    transcript: "Words.",
    audio_path: voice ? `${owner}/raw/${clientEntryId}.m4a` : null,
    processing_status: "ready",
    dominant_emotion: "anxious",
    devotional_title: "Peace in the Waiting",
    devotional_script: "Words.",
    closing_prayer: "Lord, hear us.",
    devotional_audio_path: `${owner}/devotionals/${id}.wav`,
    ...over,
  });
  world.storage.set(`${owner}/devotionals/${id}.wav`, new Uint8Array([1, 2, 3]));
  if (voice) world.storage.set(`${owner}/raw/${clientEntryId}.m4a`, new Uint8Array([4, 5, 6]));
  for (const slot of ["morning", "afternoon", "evening"]) {
    world.affirmations.push({
      id: crypto.randomUUID(),
      user_id: owner,
      entry_id: id,
      time_slot: slot,
      headline: "A headline",
      affirmation_text: "Some words",
      is_delivered: false,
      is_favorite: false,
      scheduled_for: null,
      created_at: world.now(),
    });
  }
  return entry;
}

// A reflection with no devotional (a failed one) and a crisis entry: neither counts toward the free week.
const failedFields = {
  processing_status: "failed",
  error_code: "AI_UNAVAILABLE",
  dominant_emotion: null,
  devotional_title: null,
  devotional_script: null,
  closing_prayer: null,
  devotional_audio_path: null,
};
const crisisFields = { ...failedFields, processing_status: "ready", error_code: null, is_crisis: true };

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      await work(world);
    } finally {
      world.restore();
    }
  };
}

const ask = (world: World, entryId: unknown, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, { entryId }, options);
const answer = async (response: Response) => (await response.json()) as DeleteEntryResponse;
const failure = async (response: Response) => (await response.json()) as DeleteEntryError;
const lastLog = (world: World) => JSON.parse(world.logs.at(-1)!);
const writes = (world: World) =>
  world.requests.filter((request) => request.method !== "GET" && request.method !== "HEAD");

Deno.test(
  "a) a finished reflection is deleted: the row, its affirmations, its recording and its devotional audio; one record keeps its week",
  flow(async (world) => {
    const entry = seed(world, {}, true);
    const response = await ask(world, entry.id);
    assertEquals(response.status, 200);
    assertEquals(await answer(response), { deleted: true });
    assertEquals(world.entries.length, 0);
    assertEquals(world.affirmations.length, 0);
    assertEquals([...world.storage.keys()], []);
    assertEquals(world.deletedDevotionals.length, 1);
    const [record] = world.deletedDevotionals;
    assertEquals(
      [record.entry_id, record.user_id, record.made_at],
      [entry.id, USER, entry.created_at],
    );
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "b) the order is the files, then the record, then the row",
  flow(async (world) => {
    const entry = seed(world);
    assertEquals((await ask(world, entry.id)).status, 200);
    const steps = writes(world).map((request) => {
      const table = request.url.pathname.split("/").at(-1);
      return `${request.method} ${table}`;
    });
    assertEquals(steps.slice(0, 3), [
      "DELETE journal_media",
      "POST deleted_devotionals",
      "DELETE journal_entries",
    ]);
  }),
);

Deno.test(
  "c) a crisis entry and a failed entry are deleted and get no record: neither counted toward the week",
  flow(async (world) => {
    const crisis = seed(world, crisisFields);
    const failed = seed(world, failedFields);
    assertEquals((await ask(world, crisis.id)).status, 200);
    assertEquals((await ask(world, failed.id)).status, 200);
    assertEquals(world.entries.length, 0);
    assertEquals(world.deletedDevotionals, []);
  }),
);

Deno.test(
  "d) another person's reflection answers the same 404 as one that does not exist, and nothing is removed anywhere",
  flow(async (world) => {
    const theirs = seed(world, { user_id: "user_victim" }, true);
    const before = [...world.storage.keys()].sort();
    const first = await ask(world, theirs.id);
    const second = await ask(world, crypto.randomUUID());
    assertEquals([first.status, second.status], [404, 404]);
    const a = await failure(first);
    const b = await failure(second);
    assertEquals(a.error.code, "NOT_FOUND");
    assertEquals(a.error.message, "We couldn’t find this reflection.");
    assertEquals({ ...a.error, requestId: "" }, { ...b.error, requestId: "" });
    assertEquals(world.entries.length, 1);
    assertEquals(world.affirmations.length, 3);
    assertEquals([...world.storage.keys()].sort(), before);
    assertEquals(world.removals, []);
    assertEquals(world.deletedDevotionals, []);
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "e) a path in the row that is outside the person's own folder is never removed",
  flow(async (world) => {
    world.storage.set("user_victim/raw/victim.m4a", new Uint8Array([9]));
    world.storage.set("user_victim/devotionals/victim.wav", new Uint8Array([9]));
    const entry = seed(world, {
      audio_path: "user_victim/raw/victim.m4a",
      devotional_audio_path: "user_victim/devotionals/victim.wav",
    });
    assertEquals((await ask(world, entry.id)).status, 200);
    assertEquals([...world.storage.keys()].sort(), [
      "user_victim/devotionals/victim.wav",
      "user_victim/raw/victim.m4a",
    ]);
    for (const paths of world.removals) assert(paths.every((path) => path.startsWith(`${USER}/`)));
  }),
);

Deno.test(
  "f) a reflection still being made is not deleted; one whose claim has lapsed is",
  flow(async (world) => {
    const busy = seed(world, { processing_status: "processing", updated_at: minutesAgo(0) });
    const refused = await ask(world, busy.id);
    assertEquals(refused.status, 409);
    const refusedBody = await failure(refused);
    assertEquals(refusedBody.error.code, "ALREADY_PROCESSING");
    assertEquals(world.entries.length, 1);
    assertEquals(world.removals, []);
    assertEquals(writes(world), []);

    world.entries[0].updated_at = new Date(Date.now() - CLAIM_LEASE_MS - 60_000).toISOString();
    assertEquals((await ask(world, busy.id)).status, 200);
    assertEquals(world.entries.length, 0);
  }),
);

Deno.test(
  "g) when Storage fails nothing else changes, and the same request again completes",
  flow(async (world) => {
    const entry = seed(world, {}, true);
    world.fail.storageRemove = 1;
    const response = await ask(world, entry.id);
    assertEquals(response.status, 500);
    assertEquals((await failure(response)).error.code, "INTERNAL");
    assertEquals(lastLog(world).reason, "storage_remove_failed");
    assertEquals(world.entries.length, 1);
    assertEquals(world.affirmations.length, 3);
    assertEquals(world.deletedDevotionals, []);
    assertEquals(world.storage.size, 2);

    assertEquals((await ask(world, entry.id)).status, 200);
    assertEquals(world.entries.length, 0);
    assertEquals(world.deletedDevotionals.length, 1);
    assertEquals(world.storage.size, 0);
  }),
);

Deno.test(
  "h) when the record cannot be written the reflection stays, and the request again completes with one record",
  flow(async (world) => {
    const entry = seed(world);
    world.fail.recordDeleted = 1;
    const response = await ask(world, entry.id);
    assertEquals(response.status, 500);
    assertEquals(lastLog(world).reason, "db:record_deleted:XX000");
    assertEquals(world.entries.length, 1);
    assertEquals(world.deletedDevotionals, []);
    assertEquals(world.storage.size, 0, "the files went first, so the retry has only the rest to do");

    assertEquals((await ask(world, entry.id)).status, 200);
    assertEquals(world.entries.length, 0);
    assertEquals(world.deletedDevotionals.length, 1);
  }),
);

Deno.test(
  "i) when the row cannot be deleted the record is taken back, so the devotional does not count twice; again completes",
  flow(async (world) => {
    const entry = seed(world);
    world.fail.deleteEntry = 1;
    const response = await ask(world, entry.id);
    assertEquals(response.status, 500);
    assertEquals(lastLog(world).reason, "db:delete_entry:XX000");
    assertEquals(world.entries.length, 1);
    assertEquals(world.affirmations.length, 3);
    assertEquals(world.deletedDevotionals, [], "the record was rolled back");

    assertEquals((await ask(world, entry.id)).status, 200);
    assertEquals(world.entries.length, 0);
    assertEquals(world.deletedDevotionals.length, 1);
  }),
);

Deno.test(
  "j) after success the same request answers 404, which the app counts as deleted, and writes no second record",
  flow(async (world) => {
    const entry = seed(world);
    assertEquals((await ask(world, entry.id)).status, 200);
    const again = await ask(world, entry.id);
    assertEquals(again.status, 404);
    assertEquals((await failure(again)).error.code, "NOT_FOUND");
    assertEquals(world.deletedDevotionals.length, 1);
  }),
);

Deno.test(
  "k) a request that is not a clear request for one reflection is refused before the database is touched",
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
  "k2) only POST is answered, the preflight is answered, and a request with no valid token is refused first",
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
    const tampered = await ask(world, crypto.randomUUID(), { token: `${await world.token()}x` });
    assertEquals(tampered.status, 401);
    assertEquals(world.requests.length, 0);
  }),
);

Deno.test(
  "l) who is asking comes only from the token: a user_id in the body changes nothing, and no response holds the service key",
  flow(async (world) => {
    const theirs = seed(world, { user_id: "user_victim" });
    const response = await post(world, handle, { entryId: theirs.id, user_id: "user_victim", userId: "user_victim" }, {
      sub: "user_attacker",
    });
    assertEquals(response.status, 404);
    assertEquals(world.entries.length, 1);
    assertEquals(writes(world), []);
    assertEquals(unscopedRequests(world, "user_attacker"), [], "the attacker's own id is what was asked for");

    world.requests.length = 0;
    const mine = seed(world);
    const ok = await ask(world, mine.id);
    assert(!(await ok.text()).includes("sb_secret_test_key"));
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "m) the log is one line with the allowed fields and holds no entry id, path, title, token or key",
  flow(async (world) => {
    const token = await world.token({ sub: USER });
    const entry = seed(world, {}, true);
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
    assertEquals([line.code, line.reason], [null, null]);
    for (
      const word of [
        String(entry.id),
        String(entry.client_entry_id),
        USER,
        token,
        "journal_media",
        "devotionals",
        ".wav",
        ".m4a",
        "Peace in the Waiting",
        "sb_secret_test_key",
      ]
    ) {
      assert(!world.logs.join("\n").includes(word), `the log must not contain: ${word}`);
    }
  }),
);

Deno.test(
  "n) housekeeping removes this person's records older than two weeks and nobody else's, and its failure fails nothing",
  flow(async (world) => {
    const old = { entry_id: crypto.randomUUID(), user_id: USER, made_at: daysAgo(15), deleted_at: daysAgo(15) };
    const recent = { entry_id: crypto.randomUUID(), user_id: USER, made_at: daysAgo(2), deleted_at: daysAgo(1) };
    const theirs = {
      entry_id: crypto.randomUUID(),
      user_id: "user_other",
      made_at: daysAgo(20),
      deleted_at: daysAgo(20),
    };
    world.seedUser("user_other");
    world.deletedDevotionals.push(old, recent, theirs);
    const entry = seed(world);
    assertEquals((await ask(world, entry.id)).status, 200);
    assertEquals(
      world.deletedDevotionals.map((row) => row.entry_id).sort(),
      [recent.entry_id, theirs.entry_id, entry.id].sort(),
    );
    assert(RECORD_KEEP_MS === 14 * DAY);

    // A prune that fails changes nothing about the answer.
    const real = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const request = new Request(input, init);
      if (request.method === "DELETE" && request.url.includes("/rest/v1/deleted_devotionals")) {
        const body = JSON.stringify({ code: "XX000", message: "a secret detail" });
        return Promise.resolve(new Response(body, { status: 500, headers: { "Content-Type": "application/json" } }));
      }
      return real(input, init);
    };
    try {
      const next = seed(world);
      assertEquals((await ask(world, next.id)).status, 200);
    } finally {
      globalThis.fetch = real;
    }
  }),
);

Deno.test(
  "o) two requests together for one reflection end with the reflection gone and one record",
  flow(async (world) => {
    const entry = seed(world, {}, true);
    const [a, b] = await Promise.all([ask(world, entry.id), ask(world, entry.id)]);
    assert([a.status, b.status].every((status) => status === 200 || status === 404));
    assert([a.status, b.status].includes(200));
    assertEquals(world.entries.length, 0);
    assertEquals(world.deletedDevotionals.length, 1);
    assertEquals(world.storage.size, 0);
  }),
);

Deno.test(
  "p) a database that cannot be reached is a plain 500, with no detail",
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
