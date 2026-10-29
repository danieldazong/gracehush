// The step 29b checks: deleting a reflection for good, and removing a prayer without deleting it. They run the app's real
// TypeScript (the Edge Function gateway, the repository, the deletion service, the change queue, the read cache, the sync
// engine's `deleted` event, the prayer menu and the Prayers, Journal and delete-dialog hooks) with the real supabase-js client
// against the fake Supabase of step 25 (../journal-data/world.cjs), whose delete-entry answers as the real function does: the
// caller's own reflection and its affirmations go, and another person's or a missing one is the same 404. The player store and
// the downloaded-audio module cannot load in plain Node (expo-audio, expo-file-system), so this suite fakes them. Every check ends
// by asserting that nothing the database or AGENTS.md would refuse was sent, and that the development log holds no word, note,
// id or token.
//
//   node --no-warnings supabase/tests/deletion/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/deletion/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const W = require("../journal-data/world.cjs");

const {
  makeLiveWorld,
  serverRow,
  affirmationRows,
  fnError,
  json,
  settle,
  advance,
  clock,
  BASE,
  installClock,
  uninstallClock,
  installVirtualDate,
  uninstallVirtualDate,
} = W;

let passed = 0;
const failures = [];
let finished = false;
let stopped = false;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const CHECK_LIMIT_MS = 20000;

const NOTE = "Thankful for a quiet heart";
const PRAYER = {
  is_active_prayer: true,
  prayer_title: "A prayer title",
  prayer_summary: "A short summary",
  prayer_category: "INNER PEACE",
};
const AT = "2026-10-27T12:00:00.000Z";
const ANSWERED = { ...PRAYER, is_answered: true, answered_at: AT, answered_notes: NOTE };
const TRACK_OFF = { is_active_prayer: false, is_answered: false, answered_at: null, answered_notes: null };

// Words, notes, ids and tokens that must never reach the development log.
const FORBIDDEN_IN_LOGS = [
  "the words of entry",
  "shepherd",
  "devotional of entry",
  "Title 1",
  "A prayer title",
  "A short summary",
  "quiet heart",
  "tokA",
  "tokB",
  "user_a",
  "user_b",
  "00000000-0000-4000",
  "c0000000-0000",
  "abcdefghij",
  "sb_publishable",
  "/raw/",
];

function assertQuiet(w) {
  for (const line of w.logs) {
    for (const word of FORBIDDEN_IN_LOGS) {
      assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
    }
  }
}

async function test(name, run, options = {}) {
  // ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either).
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (stopped) return;
  const startedAt = process.hrtime.bigint();
  installClock();
  installVirtualDate();
  clock.now = options.now ?? BASE;
  const w = makeLiveWorld(options);
  let limit;
  try {
    if (options.signIn !== false) await w.signIn();
    await Promise.race([
      run(w),
      new Promise((_, reject) => {
        limit = realSetTimeout(() => reject(new Error("the check never finished: a promise was never settled")), CHECK_LIMIT_MS);
      }),
    ]);
    assert.deepEqual(w.server.state.violations, [], "the app sent something the database or AGENTS.md refuses");
    assertQuiet(w);
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 7).join("\n    ")}`);
    if (process.env.FAILFAST) stopped = true;
  } finally {
    realClearTimeout(limit);
    w.close();
    uninstallVirtualDate();
    uninstallClock();
    if (process.env.TIMINGS) process.stderr.write(`${Number((process.hrtime.bigint() - startedAt) / 1000000n)} ms  ${name.slice(0, 90)}${String.fromCharCode(10)}`);
  }
}

// ------------------------------------------------------------------ helpers
const idOf = (n) => serverRow(n).id;
const api = (w) => w.use("@/api/journalApi");
const repo = (w) => w.use("@/data/journalRepository");
const cache = (w) => w.use("@/db/cache");
const queue = (w) => w.use("@/db/mutations");
const engine = (w) => w.use("@/services/syncEngine");
const copyOf = (w) => w.use("@/constants/copy").copy;
const deleteCalls = (w) => w.server.state.requests.filter((r) => r.path === "/functions/v1/delete-entry");
const serverOf = (w, n) => w.server.state.entries.find((row) => row.id === idOf(n));
const setNet = (w, connected) => w.use("@/store/offlineStore").useOfflineStore.getState().setNet(connected, connected);

// n rows on the server (1 is the newest), each finished one with its affirmations. `build(n)` adds columns.
function seedServer(w, count, build = () => ({})) {
  for (let n = 1; n <= count; n += 1) {
    const row = serverRow(n, build(n));
    w.server.state.entries.push(row);
    if (row.processing_status === "ready" && !row.is_crisis) w.server.state.affirmations.push(...affirmationRows(row.id, row.user_id));
  }
}

// The server's rows, and the phone's cached copies of them (entries and affirmations), as an earlier visit leaves them.
async function seedBoth(w, count, build = () => ({})) {
  seedServer(w, count, build);
  const store = cache(w);
  const { toJournalEntry, toAffirmation } = w.use("@/data/mappers");
  for (const row of w.server.state.entries) {
    await store.upsertEntry(toJournalEntry(row));
    if (row.processing_status === "ready" && !row.is_crisis) {
      await store.upsertAffirmations(row.id, affirmationRows(row.id, row.user_id).map(toAffirmation));
    }
  }
}

async function untilState(handle, predicate, label, rounds = 100) {
  for (let i = 0; i < rounds; i += 1) {
    if (predicate(handle.result.current)) return handle.result.current;
    await settle(2);
  }
  assert.fail(`${label}: the state never became what was waited for (last: ${handle.result.current?.status ?? String(handle.result.current)})`);
}

async function untilTrue(read, label, rounds = 100) {
  for (let i = 0; i < rounds; i += 1) {
    if (await read()) return;
    await settle(2);
  }
  assert.fail(`${label}: never became true`);
}

// The mock data waits on timers (a simulated network), which run on the virtual clock.
async function finish(promise, ms = 1_000) {
  await advance(ms);
  return promise;
}

// The player store and the downloaded audio are faked (plain Node cannot load expo-audio or expo-file-system). `state` counts what
// the deletion service did to them.
function serviceFakes({ entryId = null, stopThrows = false } = {}) {
  const state = { entryId, stops: 0, forgotten: [] };
  const fakes = {
    "@/store/playerStore": {
      __esModule: true,
      usePlayerStore: {
        getState: () => ({
          entryId: state.entryId,
          stop: () => {
            state.stops += 1;
            if (stopThrows) throw new Error("the player has nothing to give up");
          },
        }),
      },
    },
    "@/services/devotionalAudio": {
      __esModule: true,
      forgetDevotionalFile: (id) => {
        state.forgotten.push(id);
      },
    },
  };
  return { state, fakes };
}

// ================================================================== the gateway
async function gatewayChecks() {
  await test("gateway: a delete sends the entry id and nothing else, and a deleted: true answer is ok", async (w) => {
    seedServer(w, 2);
    const result = await api(w).deleteEntry(idOf(1));
    assert.deepEqual(result, { ok: true, data: { deleted: true } });
    const calls = w.server.state.functionCalls.filter((call) => call.name === "delete-entry");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { entryId: idOf(1) }, "the user id never travels in a body");
    assert.equal(calls[0].sub, "user_a", "the Clerk session token told the function who was asking");
    assert.deepEqual(w.server.state.deletedEntries, [idOf(1)]);
    assert.deepEqual(w.server.state.entries.map((row) => row.id), [idOf(2)]);
    assert.equal(w.server.state.affirmations.some((row) => row.entry_id === idOf(1)), false, "its affirmations went with it");
    const last = api(w).getLastFunctionCall();
    assert.deepEqual(Object.keys(last).sort(), ["code", "ms", "name", "status"], "a name, a status, a code and a time: nothing else");
    assert.deepEqual({ name: last.name, status: last.status, code: last.code }, { name: "delete-entry", status: 200, code: null });
    assert.equal(typeof last.ms, "number");
  });

  await test("gateway: a failure keeps the function's own code and the HTTP status, and the parsed body", async (w) => {
    const cases = [
      [400, "INVALID_REQUEST"],
      [401, "UNAUTHORIZED"],
      [404, "NOT_FOUND"],
      [405, "METHOD_NOT_ALLOWED"],
      [409, "ALREADY_PROCESSING"],
      [413, "PAYLOAD_TOO_LARGE"],
      [500, "INTERNAL"],
    ];
    for (const [status, code] of cases) {
      w.server.state.functions["delete-entry"].push(() => fnError(status, code));
      const result = await api(w).deleteEntry(idOf(1));
      assert.equal(result.ok, false, code);
      assert.equal(result.status, status, code);
      assert.equal(result.code, code);
      assert.equal(result.body.error.code, code);
    }
    const last = api(w).getLastFunctionCall();
    assert.deepEqual({ name: last.name, status: last.status, code: last.code }, { name: "delete-entry", status: 500, code: "INTERNAL" });
  });

  await test("gateway: an answer with no code of ours falls back on the status, and a function that is not deployed is never NOT_FOUND", async (w) => {
    const cases = [
      [new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }), 502, "INTERNAL"],
      [new Response(null, { status: 401 }), 401, "UNAUTHORIZED"],
      [new Response(null, { status: 403 }), 403, "UNAUTHORIZED"],
      [new Response(null, { status: 429 }), 429, "RATE_LIMITED"],
      [json(404, { message: "Requested function was not found" }, { "x-relay-error": "true" }), 404, "UNKNOWN"],
      [new Response(null, { status: 404 }), 404, "UNKNOWN"],
      [json(500, { error: "a string, not an object" }), 500, "INTERNAL"],
    ];
    for (const [response, status, code] of cases) {
      w.server.state.functions["delete-entry"].push(() => response);
      const result = await api(w).deleteEntry(idOf(1));
      assert.equal(result.ok, false);
      assert.equal(result.status, status, code);
      assert.equal(result.code, code, `status ${status}`);
    }
  });

  await test("gateway: a 200 that is not { deleted: true } is UNKNOWN, never a delete", async (w) => {
    const bodies = [
      json(200, { deleted: false }),
      json(200, { deleted: "true" }),
      json(200, { scripture: null }),
      json(200, []),
      json(200, null),
      new Response("deleted", { status: 200, headers: { "content-type": "text/plain" } }),
    ];
    for (const [index, response] of bodies.entries()) {
      w.server.state.functions["delete-entry"].push(() => response);
      const result = await api(w).deleteEntry(idOf(1));
      assert.equal(result.ok, false, `case ${index}`);
      assert.equal(result.code, "UNKNOWN", `case ${index}`);
      assert.equal(result.status, 200, `case ${index}`);
    }
  });

  await test("gateway: no answer is NETWORK (status 0), and so is a request that outlasts its 30 seconds", async (w) => {
    const { DELETE_ENTRY_TIMEOUT_MS } = w.use("@/constants/app");
    assert.equal(DELETE_ENTRY_TIMEOUT_MS, 30_000);
    w.server.state.offline = true;
    let result = await api(w).deleteEntry(idOf(1));
    assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 0, code: "NETWORK" });
    w.server.state.offline = false;

    w.server.state.functions["delete-entry"].push(() => new Promise(() => undefined));
    let settled = null;
    const pending = api(w).deleteEntry(idOf(1)).then((r) => (settled = r));
    await advance(DELETE_ENTRY_TIMEOUT_MS - 1000);
    assert.equal(settled, null, "gave up before its timeout");
    await advance(1500);
    result = await pending;
    assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 0, code: "NETWORK" });
  });

  await test("gateway: signed out sends nothing, and a token that cannot be had is UNAUTHORIZED with no request", async (w) => {
    const client = w.use("@/services/supabaseClient");
    client.setSupabaseSession(null);
    let result = await api(w).deleteEntry(idOf(1));
    assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 0, code: "UNAUTHORIZED" });
    client.setSupabaseSession({ userId: "user_a", getToken: async () => null });
    result = await api(w).deleteEntry(idOf(1));
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(w.server.state.requests.length, 0, "no token, no request: the publishable key is never the bearer");
  });
}

// ================================================================== the repository
async function repositoryChecks() {
  await test("repository: with no connection nothing is sent, the answer is NETWORK, and the phone keeps everything", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    setNet(w, false);
    assert.equal(repo(w).canDeleteNow(), false);
    const result = await repo(w).deleteEntry(idOf(1));
    assert.deepEqual(result, { ok: false, code: "NETWORK", message: copyOf(w).deleteReflection.failed });
    assert.equal(deleteCalls(w).length, 0, "no request: a delete is online only and is never queued");
    assert.notEqual(await cache(w).getEntry(idOf(1)), null);
    assert.equal((await cache(w).listAffirmationsForEntry(idOf(1))).length, 3);
    assert.equal(w.server.state.entries.length, 2);
    setNet(w, true);
    assert.equal(repo(w).canDeleteNow(), true);
    assert.equal((await repo(w).deleteEntry(idOf(1))).ok, true, "back online it works, by the person pressing the button again");
  });

  await test("repository: once the server has deleted it, the phone forgets the entry, its affirmations and its waiting prayer change, and only those", async (w) => {
    await seedBoth(w, 3, () => PRAYER);
    await repo(w).setPrayerTracked(idOf(1), false);
    await repo(w).setPrayerTracked(idOf(2), false);
    assert.equal(await queue(w).countMutations(), 2);
    const result = await repo(w).deleteEntry(idOf(1));
    assert.deepEqual(result, { ok: true, data: null });
    assert.deepEqual(w.server.state.deletedEntries, [idOf(1)]);
    assert.equal(await cache(w).getEntry(idOf(1)), null);
    assert.deepEqual(await cache(w).listAffirmationsForEntry(idOf(1)), []);
    assert.equal(await queue(w).getMutation(idOf(1)), null, "the change that waited for it is dropped");
    assert.notEqual(await queue(w).getMutation(idOf(2)), null, "another entry's change stays");
    assert.notEqual(await cache(w).getEntry(idOf(2)), null);
    assert.equal((await cache(w).listAffirmationsForEntry(idOf(2))).length, 3);
    assert.notEqual(await cache(w).getEntry(idOf(3)), null);
    assert.deepEqual(deleteCalls(w).length, 1);
  });

  await test("repository: an entry the server no longer has (NOT_FOUND) counts as deleted, and the phone forgets it too", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    await repo(w).setPrayerTracked(idOf(1), false);
    w.server.state.entries = w.server.state.entries.filter((row) => row.id !== idOf(1));
    const result = await repo(w).deleteEntry(idOf(1));
    assert.deepEqual(result, { ok: true, data: null });
    assert.equal(w.server.state.deletedEntries.length, 0, "this call deleted nothing: it was already gone");
    assert.equal(deleteCalls(w).length, 1);
    assert.equal(await cache(w).getEntry(idOf(1)), null);
    assert.deepEqual(await cache(w).listAffirmationsForEntry(idOf(1)), []);
    assert.equal(await queue(w).countMutations(), 0);
  });

  await test("repository: a failure leaves the cache, the affirmations and the waiting change untouched, with the right code", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    await repo(w).setPrayerTracked(idOf(1), false);
    const message = copyOf(w).deleteReflection.failed;
    const scripts = [
      ["a busy server (409)", () => fnError(409, "ALREADY_PROCESSING"), "UNKNOWN"],
      ["a server error (500)", () => fnError(500, "INTERNAL"), "UNKNOWN"],
      ["a refused session (401)", () => fnError(401, "UNAUTHORIZED"), "UNAUTHORIZED"],
      ["a bad request (400)", () => fnError(400, "INVALID_REQUEST"), "UNKNOWN"],
      ["a function that is not deployed", () => json(404, { message: "Requested function was not found" }, { "x-relay-error": "true" }), "UNKNOWN"],
      ["an answer that is not a delete", () => json(200, { scripture: null }), "UNKNOWN"],
    ];
    for (const [label, answer, code] of scripts) {
      w.server.state.functions["delete-entry"].push(answer);
      const result = await repo(w).deleteEntry(idOf(1));
      assert.deepEqual(result, { ok: false, code, message }, label);
    }
    w.server.state.offline = true;
    assert.deepEqual(await repo(w).deleteEntry(idOf(1)), { ok: false, code: "NETWORK", message }, "no answer");
    w.server.state.offline = false;
    assert.equal(deleteCalls(w).length, scripts.length + 1, "every attempt went to the server");
    assert.equal(w.server.state.entries.length, 2, "the server still has both");
    assert.notEqual(await cache(w).getEntry(idOf(1)), null);
    assert.equal((await cache(w).listAffirmationsForEntry(idOf(1))).length, 3);
    assert.notEqual(await queue(w).getMutation(idOf(1)), null);
  });

  await test("repository: on the mock data it waits, honours the dev failure flag, removes the mock rows, and works with no connection", async (w) => {
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    const db = w.use("@/data/mock/db").getMockDb();
    const target = db.affirmations[0].entry_id;
    assert.ok(db.entries.some((row) => row.id === target));
    setNet(w, false);
    assert.equal(repo(w).canDeleteNow(), true, "the mock data needs no connection");

    let done = false;
    const waiting = repo(w).deleteEntry(target).then((result) => {
      done = true;
      return result;
    });
    await settle(5);
    assert.equal(done, false, "the mock waits a little, like a network");
    assert.deepEqual(await finish(waiting), { ok: true, data: null });
    assert.equal(db.entries.some((row) => row.id === target), false);
    assert.equal(db.affirmations.some((row) => row.entry_id === target), false, "its affirmations go with it");

    const next = db.entries[0].id;
    w.use("@/store/devStore").useDevStore.getState().setNextPrayerMutationFails(true);
    const failed = await finish(repo(w).deleteEntry(next));
    assert.deepEqual(failed, { ok: false, code: "NETWORK", message: copyOf(w).deleteReflection.failed });
    assert.ok(db.entries.some((row) => row.id === next), "a failed delete removes nothing");
    assert.equal((await finish(repo(w).deleteEntry(next))).ok, true, "the flag was used up");
    assert.equal(w.server.state.requests.length, 0, "the mock data never reaches the server");
  });

  await test("repository: the dev failure flag does nothing to a delete on the real data", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    w.use("@/store/devStore").useDevStore.getState().setNextPrayerMutationFails(true);
    assert.equal((await repo(w).deleteEntry(idOf(1))).ok, true);
    assert.equal(w.use("@/store/devStore").useDevStore.getState().nextPrayerMutationFails, true, "left for the mock data");
  });
}

// ================================================================== the service
async function serviceChecks() {
  // The cache must already be clear when the notifications are planned again, or the plan would still see the deleted entry.
  async function watchReplan(w, entryId) {
    const name = w.sqlite.files().find((file) => file.endsWith(".db"));
    const raw = w.sqlite.raw(name);
    const seen = [];
    w.use("@/services/affirmationScheduler").requestAffirmationReschedule = () => {
      seen.push({
        entries: raw.prepare("SELECT COUNT(*) AS n FROM entries_cache WHERE id = ?").get(entryId).n,
        affirmations: raw.prepare("SELECT COUNT(*) AS n FROM affirmations_cache WHERE entry_id = ?").get(entryId).n,
      });
    };
    return { seen, close: () => raw.close() };
  }

  const holding = serviceFakes({ entryId: idOf(1) });
  await test("service: the player is stopped when it holds that entry, the file is forgotten, deleted is announced once, and the plan is made again once, after the cache is clear", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    const events = [];
    engine(w).subscribe((event) => events.push(event));
    const replan = await watchReplan(w, idOf(1));
    try {
      const result = await w.use("@/services/entryDeletion").deleteReflection(idOf(1));
      assert.deepEqual(result, { ok: true, data: null });
      assert.equal(holding.state.stops, 1);
      assert.deepEqual(holding.state.forgotten, [idOf(1)]);
      assert.deepEqual(events.filter((event) => event.type === "deleted"), [{ type: "deleted", entryId: idOf(1) }]);
      assert.deepEqual(replan.seen, [{ entries: 0, affirmations: 0 }], "once, and only after the phone forgot the entry");
    } finally {
      // The second connection must be closed even when a check above fails: Windows cannot delete an open database file.
      replan.close();
    }
  }, { fakes: holding.fakes });

  const other = serviceFakes({ entryId: idOf(2) });
  await test("service: the player is left alone when it holds another devotional, and the other steps still run", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    const events = [];
    engine(w).subscribe((event) => events.push(event));
    const result = await w.use("@/services/entryDeletion").deleteReflection(idOf(1));
    assert.equal(result.ok, true);
    assert.equal(other.state.stops, 0, "the devotional that is playing is someone else's");
    assert.deepEqual(other.state.forgotten, [idOf(1)]);
    assert.equal(events.filter((event) => event.type === "deleted").length, 1);
    assert.equal(w.affirmationRequests(), 1);
  }, { fakes: other.fakes });

  const idle = serviceFakes({ entryId: null });
  await test("service: with nothing loaded in the player nothing is stopped", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    assert.equal((await w.use("@/services/entryDeletion").deleteReflection(idOf(1))).ok, true);
    assert.equal(idle.state.stops, 0);
    assert.deepEqual(idle.state.forgotten, [idOf(1)]);
  }, { fakes: idle.fakes });

  const throwing = serviceFakes({ entryId: idOf(1), stopThrows: true });
  await test("service: a player that cannot stop does not change the result, and the other steps still run", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    const events = [];
    engine(w).subscribe((event) => events.push(event));
    const result = await w.use("@/services/entryDeletion").deleteReflection(idOf(1));
    assert.deepEqual(result, { ok: true, data: null });
    assert.equal(throwing.state.stops, 1);
    assert.deepEqual(throwing.state.forgotten, [idOf(1)]);
    assert.equal(events.filter((event) => event.type === "deleted").length, 1);
    assert.equal(w.affirmationRequests(), 1);
  }, { fakes: throwing.fakes });

  const failing = serviceFakes({ entryId: idOf(1) });
  await test("service: a delete that failed changes nothing on the phone and tells nothing to the player, the files, the lists or the notifications", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    const events = [];
    engine(w).subscribe((event) => events.push(event));
    w.server.state.functions["delete-entry"].push(() => fnError(500, "INTERNAL"));
    const result = await w.use("@/services/entryDeletion").deleteReflection(idOf(1));
    assert.deepEqual(result, { ok: false, code: "UNKNOWN", message: copyOf(w).deleteReflection.failed });
    assert.equal(failing.state.stops, 0);
    assert.deepEqual(failing.state.forgotten, []);
    assert.deepEqual(events.filter((event) => event.type === "deleted"), []);
    assert.equal(w.affirmationRequests(), 0);
    assert.notEqual(await cache(w).getEntry(idOf(1)), null);
  }, { fakes: failing.fakes });

  const gone = serviceFakes({ entryId: idOf(1) });
  await test("service: an entry that is already gone on the server is forgotten here too, with every step", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    w.server.state.entries = w.server.state.entries.filter((row) => row.id !== idOf(1));
    const result = await w.use("@/services/entryDeletion").deleteReflection(idOf(1));
    assert.equal(result.ok, true);
    assert.equal(gone.state.stops, 1);
    assert.deepEqual(gone.state.forgotten, [idOf(1)]);
    assert.equal(w.affirmationRequests(), 1);
    assert.equal(await cache(w).getEntry(idOf(1)), null);
  }, { fakes: gone.fakes });

  const signedOut = serviceFakes({ entryId: idOf(1) });
  await test("service: signed out, it answers UNAUTHORIZED and never throws", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    w.use("@/services/supabaseClient").setSupabaseSession(null);
    const result = await w.use("@/services/entryDeletion").deleteReflection(idOf(1));
    assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: "UNAUTHORIZED" });
    assert.equal(signedOut.state.stops, 0);
    assert.notEqual(await cache(w).getEntry(idOf(1)), null);
  }, { fakes: signedOut.fakes });
}

// ================================================================== the hooks
async function hookChecks() {
  async function renderPrayers(w) {
    const { usePrayers } = w.use("@/hooks/usePrayers");
    const handle = w.renderHook(usePrayers);
    await untilState(handle, (state) => state.status === "ready", "Prayers ready");
    return handle;
  }

  await test("usePrayers: removing an Active prayer takes it off the list at once and queues one patch that clears the flags; the engine sends it", async (w) => {
    await seedBoth(w, 4, (n) => (n === 2 ? ANSWERED : n === 4 ? {} : PRAYER));
    await w.startEngine();
    const handle = await renderPrayers(w);
    assert.deepEqual(handle.result.current.active.map((prayer) => prayer.id).sort(), [idOf(1), idOf(3)]);
    assert.deepEqual(handle.result.current.answered.map((prayer) => prayer.id), [idOf(2)]);

    setNet(w, false);
    const removed = await handle.result.current.removeFromPrayers(idOf(1));
    assert.deepEqual(removed, { ok: true, data: null }, "no longer a prayer");
    const offline = await untilState(handle, (state) => state.status === "ready" && state.waitingOffline, "the offline line");
    assert.deepEqual(offline.active.map((prayer) => prayer.id), [idOf(3)]);
    assert.equal(offline.counts.total, 2);
    assert.equal(await queue(w).countMutations(), 1);
    assert.deepEqual((await queue(w).getMutation(idOf(1))).patch, TRACK_OFF);
    assert.equal(w.server.state.prayerUpdates.length, 0, "waiting while the phone is offline");
    assert.equal((await repo(w).getEntry(idOf(1))).prayer, null, "the Journal entry stays, only the prayer is gone");

    setNet(w, true);
    await untilTrue(async () => w.server.state.prayerUpdates.length === 1, "the patch was sent");
    assert.deepEqual(w.server.state.prayerUpdates[0], { body: TRACK_OFF, ids: [idOf(1)] });
    assert.equal(serverOf(w, 1).is_active_prayer, false);
    assert.equal(w.server.state.entries.some((row) => row.id === idOf(1)), true, "the reflection itself is not deleted");
    await untilTrue(async () => (await queue(w).countMutations()) === 0, "the queue emptied");
    assert.equal(deleteCalls(w).length, 0, "removing from Prayers never calls delete-entry");
    handle.unmount();
  });

  await test("usePrayers: removing an Answered prayer clears its answered date and gratitude note too", async (w) => {
    await seedBoth(w, 2, (n) => (n === 1 ? ANSWERED : PRAYER));
    await w.startEngine();
    const handle = await renderPrayers(w);
    assert.equal(handle.result.current.answered.length, 1);
    const removed = await handle.result.current.removeFromPrayers(idOf(1));
    assert.equal(removed.ok, true);
    const state = await untilState(handle, (s) => s.status === "ready" && s.answered.length === 0, "off the Answered list");
    assert.deepEqual(state.active.map((prayer) => prayer.id), [idOf(2)]);
    await untilTrue(async () => w.server.state.prayerUpdates.length === 1, "the patch was sent");
    const row = serverOf(w, 1);
    assert.deepEqual(
      { active: row.is_active_prayer, answered: row.is_answered, at: row.answered_at, note: row.answered_notes },
      { active: false, answered: false, at: null, note: null },
    );
    assert.equal(w.server.state.entries.length, 2);
    handle.unmount();
  });

  await test("usePrayers: a removal that fails (the phone has no such prayer) changes nothing", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    await w.startEngine();
    const handle = await renderPrayers(w);
    const before = handle.result.current.active.map((prayer) => prayer.id);
    const requests = w.server.state.requests.length;
    const result = await handle.result.current.removeFromPrayers("00000000-0000-4000-8000-000000000999");
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_FOUND");
    await settle(10);
    assert.deepEqual(handle.result.current.active.map((prayer) => prayer.id), before);
    assert.equal(await queue(w).countMutations(), 0);
    assert.equal(w.server.state.requests.length, requests, "nothing was sent");
    handle.unmount();
  });

  await test("usePrayers: a deleted event takes the prayer off the list, from either tab", async (w) => {
    await seedBoth(w, 3, (n) => (n === 2 ? ANSWERED : PRAYER));
    await w.startEngine();
    const handle = await renderPrayers(w);
    assert.equal(handle.result.current.counts.total, 3);
    engine(w).announceEntryDeleted(idOf(3));
    let state = await untilState(handle, (s) => s.status === "ready" && s.active.length === 1, "the Active prayer gone");
    assert.deepEqual(state.active.map((prayer) => prayer.id), [idOf(1)]);
    engine(w).announceEntryDeleted(idOf(2));
    state = await untilState(handle, (s) => s.status === "ready" && s.answered.length === 0, "the Answered prayer gone");
    assert.equal(state.counts.total, 1);
    engine(w).announceEntryDeleted("00000000-0000-4000-8000-000000000999");
    await settle(5);
    assert.equal(handle.result.current.counts.total, 1, "an id the list does not hold changes nothing");
    handle.unmount();
  });

  await test("useJournalHome: a deleted event drops the entry, also from an older page, its affirmations, and one from the count", async (w) => {
    seedServer(w, 12);
    w.use("@/store/devStore").useDevStore.getState().setPageSize(5);
    const { useJournalHome } = w.use("@/hooks/useJournalHome");
    const handle = w.renderHook(useJournalHome);
    let state = await untilState(handle, (s) => s.status === "ready" && s.entries.length === 5, "page 1");
    state.loadMore();
    state = await untilState(handle, (s) => s.status === "ready" && s.entries.length === 10 && !s.loadingMore, "page 2");
    assert.equal(state.entryCount, 12);
    // Journal loads the affirmations of the newest reflection only (they feed the card at the top).
    assert.deepEqual([...new Set(state.affirmations.map((affirmation) => affirmation.entryId))], [idOf(1)]);
    assert.equal(state.affirmations.length, 3);

    engine(w).announceEntryDeleted(idOf(8));
    state = await untilState(handle, (s) => s.status === "ready" && s.entries.length === 9, "an older entry gone");
    assert.equal(state.entries.some((entry) => entry.id === idOf(8)), false);
    assert.equal(state.affirmations.length, 3, "the card's affirmations are not touched by another entry's delete");
    assert.equal(state.entryCount, 11);

    engine(w).announceEntryDeleted(idOf(1));
    state = await untilState(handle, (s) => s.status === "ready" && s.entries.length === 8, "the newest entry gone");
    assert.equal(state.entries[0].id, idOf(2));
    assert.equal(state.affirmations.some((affirmation) => affirmation.entryId === idOf(1)), false, "its affirmations go with it");
    assert.equal(state.entryCount, 10);
    handle.unmount();
  });

  const journalFakes = serviceFakes();
  await test("useJournalHome: after a real delete the older pages still load, and the deleted entry does not come back", async (w) => {
    seedServer(w, 12);
    w.use("@/store/devStore").useDevStore.getState().setPageSize(5);
    const { useJournalHome } = w.use("@/hooks/useJournalHome");
    const handle = w.renderHook(useJournalHome);
    let state = await untilState(handle, (s) => s.status === "ready" && s.entries.length === 5, "page 1");
    state.loadMore();
    await untilState(handle, (s) => s.status === "ready" && s.entries.length === 10 && !s.loadingMore, "page 2");
    const requests = w.affirmationRequests();

    assert.equal((await w.use("@/services/entryDeletion").deleteReflection(idOf(3))).ok, true);
    assert.equal(w.affirmationRequests(), requests + 1, "the notifications are planned again");
    state = await untilState(handle, (s) => s.status === "ready" && s.entries.length === 9, "the deleted entry gone");
    assert.equal(state.entryCount, 11);
    state.loadMore();
    state = await untilState(handle, (s) => s.status === "ready" && s.entries.length === 11 && !s.loadingMore, "the last page");
    assert.equal(state.entries.some((entry) => entry.id === idOf(3)), false, "it did not come back");
    assert.equal(state.entryCount, 11);
    assert.deepEqual(state.entries.map((entry) => entry.id), [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(idOf));
    handle.unmount();
  }, { fakes: journalFakes.fakes });

  async function renderDialog(w, onDeleted) {
    const { useDeleteReflection } = w.use("@/hooks/useDeleteReflection");
    const handle = w.renderHook(useDeleteReflection, onDeleted);
    await settle(2);
    return handle;
  }

  const closed = serviceFakes();
  await test("useDeleteReflection: with no connection ask answers false and nothing opens", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    const deleted = [];
    const handle = await renderDialog(w, (id) => deleted.push(id));
    setNet(w, false);
    assert.equal(handle.result.current.ask({ entryId: idOf(1), answered: false }), false);
    await settle(3);
    assert.equal(handle.result.current.dialog.visible, false);
    assert.equal(deleteCalls(w).length, 0);
    setNet(w, true);
    assert.equal(handle.result.current.ask({ entryId: idOf(1), answered: false }), true);
    await untilState(handle, (s) => s.dialog.visible === true, "the dialog opens online");
    assert.equal(deleted.length, 0);
    handle.unmount();
  }, { fakes: closed.fakes });

  const happy = serviceFakes();
  await test("useDeleteReflection: confirming deletes, closes the dialog and calls onDeleted once with the id; an answered prayer says so", async (w) => {
    await seedBoth(w, 2, (n) => (n === 1 ? ANSWERED : PRAYER));
    const deleted = [];
    const handle = await renderDialog(w, (id) => deleted.push(id));
    assert.equal(handle.result.current.dialog.visible, false);
    assert.equal(handle.result.current.ask({ entryId: idOf(1), answered: true }), true);
    let state = await untilState(handle, (s) => s.dialog.visible === true, "open");
    assert.equal(state.dialog.answered, true);
    assert.equal(state.dialog.failed, false);
    assert.equal(state.dialog.running, false);
    await state.dialog.onConfirm();
    state = await untilState(handle, (s) => s.dialog.visible === false, "closed");
    assert.deepEqual(deleted, [idOf(1)]);
    assert.equal(state.dialog.failed, false);
    assert.equal(state.dialog.running, false);
    assert.deepEqual(w.server.state.deletedEntries, [idOf(1)]);
    assert.equal(await cache(w).getEntry(idOf(1)), null);
    handle.unmount();
  }, { fakes: happy.fakes });

  const failed = serviceFakes();
  await test("useDeleteReflection: a failure keeps the dialog open with failed set, and the confirm button tries again", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    const deleted = [];
    const handle = await renderDialog(w, (id) => deleted.push(id));
    handle.result.current.ask({ entryId: idOf(1), answered: false });
    let state = await untilState(handle, (s) => s.dialog.visible === true, "open");
    w.server.state.functions["delete-entry"].push(() => fnError(500, "INTERNAL"));
    await state.dialog.onConfirm();
    state = await untilState(handle, (s) => s.dialog.failed === true, "failed");
    assert.equal(state.dialog.visible, true, "the dialog stays");
    assert.equal(state.dialog.running, false);
    assert.deepEqual(deleted, []);
    assert.notEqual(await cache(w).getEntry(idOf(1)), null);
    await state.dialog.onConfirm();
    state = await untilState(handle, (s) => s.dialog.visible === false, "closed after the retry");
    assert.equal(state.dialog.failed, false);
    assert.deepEqual(deleted, [idOf(1)]);
    assert.equal(deleteCalls(w).length, 2);
    handle.unmount();
  }, { fakes: failed.fakes });

  const busy = serviceFakes();
  await test("useDeleteReflection: a second confirm and a cancel while one is running are ignored", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    const deleted = [];
    const handle = await renderDialog(w, (id) => deleted.push(id));
    handle.result.current.ask({ entryId: idOf(1), answered: false });
    await untilState(handle, (s) => s.dialog.visible === true, "open");
    let release;
    w.server.state.functions["delete-entry"].push(
      () => new Promise((resolve) => (release = () => resolve(json(200, { deleted: true })))),
    );
    const first = handle.result.current.dialog.onConfirm();
    const running = await untilState(handle, (s) => s.dialog.running === true, "running");
    await running.dialog.onConfirm();
    running.dialog.onCancel();
    await settle(3);
    assert.equal(handle.result.current.dialog.visible, true, "the dialog cannot be closed while a delete is on its way");
    assert.equal(deleteCalls(w).length, 1, "one request, however many times the button was pressed");
    release();
    await first;
    await untilState(handle, (s) => s.dialog.visible === false, "closed");
    assert.deepEqual(deleted, [idOf(1)], "onDeleted once");
    assert.equal(deleteCalls(w).length, 1);
    handle.unmount();
  }, { fakes: busy.fakes });

  const cancelled = serviceFakes();
  await test("useDeleteReflection: cancel closes the dialog when nothing is running, and nothing is sent", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    const handle = await renderDialog(w, () => undefined);
    handle.result.current.ask({ entryId: idOf(1), answered: false });
    const state = await untilState(handle, (s) => s.dialog.visible === true, "open");
    state.dialog.onCancel();
    await untilState(handle, (s) => s.dialog.visible === false, "closed");
    assert.equal(deleteCalls(w).length, 0);
    assert.notEqual(await cache(w).getEntry(idOf(1)), null);
    handle.unmount();
  }, { fakes: cancelled.fakes });
}

// ================================================================== the menu, the copy and the log
async function menuChecks() {
  await test("menu: Active offers Remove then Delete; Answered offers Edit, Move back, Remove then Delete; the delete is last and the only destructive one", async (w) => {
    const { getPrayerMenu } = w.use("@/utils/prayerMenu");
    const { copy } = w.use("@/constants/copy");
    const active = getPrayerMenu("active");
    const answered = getPrayerMenu("answered");
    assert.deepEqual(active.map((item) => item.action), ["remove", "delete"]);
    assert.deepEqual(answered.map((item) => item.action), ["editNote", "moveBack", "remove", "delete"]);
    for (const menu of [active, answered]) {
      assert.equal(menu[menu.length - 1].action, "delete", "the delete is always last");
      assert.deepEqual(menu.filter((item) => item.destructive).map((item) => item.action), ["delete"]);
      for (const item of menu) {
        assert.equal(typeof item.icon.ios, "string", `${item.action} has an iPhone symbol`);
        assert.equal(typeof item.icon.android, "string", `${item.action} has an Android symbol`);
      }
    }
    const labels = Object.fromEntries(answered.map((item) => [item.action, item.label]));
    assert.deepEqual(labels, {
      editNote: copy.prayers.menu.editNote,
      moveBack: copy.prayers.menu.moveBack,
      remove: copy.prayers.menu.removeFromPrayers,
      delete: copy.prayers.menu.deleteReflection,
    });
    assert.notEqual(getPrayerMenu("active"), getPrayerMenu("active"), "a fresh list each time, so a screen cannot change the next one");
  }, { signIn: false });

  await test("copy: the new strings use typographic punctuation, name what is deleted and promise nothing the app does not do", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const strings = [];
    const collect = (value) => {
      if (typeof value === "string") strings.push(value);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(copy.deleteReflection);
    collect(copy.prayers.menu);
    collect(copy.prayers.removeFromPrayers);
    strings.push(copy.prayers.notice.removed, copy.prayers.notice.deleted);
    assert.ok(strings.length >= 15);
    for (const string of strings) {
      assert.ok(!string.includes("'"), `a straight apostrophe in "${string}"`);
      assert.ok(!string.includes('"'), `a straight quote in "${string}"`);
      assert.ok(!string.includes("..."), `three dots instead of … in "${string}"`);
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(string), `an emoji in "${string}"`);
    }
    const text = copy.deleteReflection;
    assert.ok(/forever/i.test(text.title));
    assert.ok(/can’t be undone/.test(text.body) && /can’t be undone/.test(text.bodyAnswered));
    assert.ok(/gratitude note/.test(text.bodyAnswered) && !/gratitude note/.test(text.body), "only the answered prayer's dialog mentions the note");
    assert.ok(/internet/i.test(text.offline), "the offline line says what is needed");
    assert.ok(copy.prayers.menu.deleteReflection.endsWith("…"), "the delete row opens a dialog, so it ends in an ellipsis");
    assert.ok(!/delete|forever/i.test(copy.prayers.menu.removeFromPrayers), "Remove from Prayers does not sound like a delete");
    assert.ok(/still in your Journal/.test(copy.prayers.notice.removed));
  }, { signIn: false });
}

(async () => {
  await gatewayChecks();
  await repositoryChecks();
  await serviceChecks();
  await hookChecks();
  await menuChecks();
  finished = true;
  console.log(`${passed} checks passed${failures.length > 0 ? `, ${failures.length} FAILED` : ""}`);
  if (failures.length > 0) {
    console.log(failures.map((failure) => `  FAIL ${failure}`).join("\n"));
    process.exit(1);
  }
})().catch((error) => {
  console.log("THE RUN CRASHED", error);
  process.exit(1);
});

process.on("exit", (code) => {
  if (!finished && code === 0) {
    console.log("THE RUN ENDED BEFORE ITS SUMMARY: a promise was never settled");
    process.exitCode = 1;
  }
});
