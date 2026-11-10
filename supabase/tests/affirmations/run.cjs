// The "more affirmations" checks (2026-11-09): one more affirmation at a time for a finished reflection, up to MAX_AFFIRMATIONS,
// with a nullable lock-screen slot and a position on every affirmation. They run the app's real TypeScript (the Edge Function
// gateway, the repository and its mock branch, the read cache, the mapper, the selector, the notification planner, the Reflection
// hook and the analytics policy) with the real supabase-js client against the fake Supabase of step 25 (../journal-data/world.cjs),
// whose add-affirmation answers as the real function does: the caller's own finished reflection gets one more affirmation at the
// next position with no slot (or the slot a test asks it to take over), and the whole list comes back in position order; another
// person's entry and a missing one are the same 404, and a reflection with ten already is 409 AFFIRMATION_LIMIT. Every check ends
// by asserting that nothing the database or AGENTS.md would refuse was sent, and that the development log holds no headline, word,
// id or token.
//
//   node --no-warnings supabase/tests/affirmations/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/affirmations/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

const ROOT = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
let passed = 0;
const failures = [];
let finished = false;
let stopped = false;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const CHECK_LIMIT_MS = 20000;

// Headlines, words, ids and tokens that must never reach the development log.
const FORBIDDEN_IN_LOGS = [
  "the words of entry",
  "shepherd",
  "devotional of entry",
  "Headline morning",
  "Headline 4",
  "Text 4",
  "refuge and strength",
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
const copyOf = (w) => w.use("@/constants/copy").copy;
const addCalls = (w) => w.server.state.requests.filter((r) => r.path === "/functions/v1/add-affirmation");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// n rows on the server (1 is the newest), each finished one with its three affirmations. `build(n)` adds columns.
function seedServer(w, count, build = () => ({})) {
  for (let n = 1; n <= count; n += 1) {
    const row = serverRow(n, build(n));
    w.server.state.entries.push(row);
    if (row.processing_status === "ready" && !row.is_crisis) w.server.state.affirmations.push(...affirmationRows(row.id, row.user_id));
  }
}

// The server's rows, and the phone's cached copies of them, as an earlier visit leaves them.
async function seedBoth(w, count, build = () => ({})) {
  seedServer(w, count, build);
  const store = cache(w);
  const { toJournalEntry, toAffirmation } = w.use("@/data/mappers");
  for (const row of w.server.state.entries) {
    await store.upsertEntry(toJournalEntry(row));
    const own = w.server.state.affirmations.filter((a) => a.entry_id === row.id);
    if (own.length > 0) await store.upsertAffirmations(row.id, own.map(toAffirmation));
  }
}

// More rows on the server for entry n, from `from` to position 10 with no slot: a reflection that has them all.
function fillServer(w, n, from = 4) {
  const id = idOf(n);
  for (let position = from; position <= 10; position += 1) {
    w.server.state.affirmations.push({
      ...affirmationRows(id)[0],
      id: `aff-${id.slice(-12)}-p${position}`,
      time_slot: null,
      position,
      headline: `Headline ${position}`,
      affirmation_text: `Text ${position}`,
    });
  }
}

async function until(handle, predicate, label, rounds = 100) {
  for (let i = 0; i < rounds; i += 1) {
    if (predicate(handle.result.current)) return handle.result.current;
    await settle(2);
  }
  assert.fail(`${label}: the state never became what was waited for (last: ${handle.result.current?.status})`);
}

const positions = (list) => list.map((a) => a.position);
const slots = (list) => list.map((a) => a.slot);

// ================================================================== the gateway
async function gatewayChecks() {
  await test("gateway: addAffirmation sends the entry id and nothing else, and answers the whole list in position order, the new one last with no slot and its verse", async (w) => {
    seedServer(w, 1);
    const result = await api(w).addAffirmation(idOf(1));
    assert.equal(result.ok, true);
    assert.deepEqual(positions(result.data.affirmations), [1, 2, 3, 4]);
    assert.deepEqual(slots(result.data.affirmations), ["morning", "afternoon", "evening", null]);
    assert.deepEqual(result.data.affirmations[3].verse, {
      reference: "Psalm 46:1",
      text: "God is our refuge and strength,\nan ever-present help in times of trouble.",
    });
    assert.equal(addCalls(w).length, 1);
    assert.deepEqual(addCalls(w)[0].body, { entryId: idOf(1) });
    const last = api(w).getLastFunctionCall();
    assert.equal(last.name, "add-affirmation");
    assert.equal(last.status, 200);
  });

  await test("gateway: another person's entry and a missing one are NOT_FOUND, a reflection with ten is AFFIRMATION_LIMIT, no connection is NETWORK, and a list with no positions is filled from the slots", async (w) => {
    seedServer(w, 2);
    w.server.state.entries[1].user_id = "user_b";
    let result = await api(w).addAffirmation(idOf(2));
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_FOUND");
    result = await api(w).addAffirmation(serverRow(9).id);
    assert.equal(result.code, "NOT_FOUND");
    fillServer(w, 1);
    result = await api(w).addAffirmation(idOf(1));
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "AFFIRMATION_LIMIT");
    w.server.state.offline = true;
    result = await api(w).addAffirmation(idOf(1));
    assert.equal(result.code, "NETWORK");
    w.server.state.offline = false;
    // A function from before the column: slots and no positions.
    const bare = affirmationRows(idOf(1)).map((a) => ({
      id: a.id,
      entryId: a.entry_id,
      slot: a.time_slot,
      headline: a.headline,
      text: a.affirmation_text,
      isFavorite: false,
    }));
    w.server.state.functions["add-affirmation"] = [() => json(200, { affirmations: [bare[2], bare[0], bare[1]] })];
    result = await api(w).addAffirmation(idOf(1));
    assert.equal(result.ok, true);
    assert.deepEqual(positions(result.data.affirmations), [3, 1, 2]);
    assert.deepEqual(result.data.affirmations.map((a) => a.verse), [null, null, null]);
    // An answer that is not a list of affirmations is UNKNOWN, never a crash.
    w.server.state.functions["add-affirmation"] = [() => json(200, { affirmations: [{ id: "x" }] })];
    result = await api(w).addAffirmation(idOf(1));
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN");
  });
}

// ================================================================== the repository
async function repositoryChecks() {
  await test("repository: addAffirmation writes the server's whole list to the cache in position order, and a lock-screen slot that moved is right on both rows", async (w) => {
    await seedBoth(w, 1);
    w.server.state.addFeatures.push("morning");
    const result = await repo(w).addAffirmation(idOf(1));
    assert.equal(result.ok, true);
    assert.deepEqual(positions(result.data), [1, 2, 3, 4]);
    assert.deepEqual(slots(result.data), [null, "afternoon", "evening", "morning"]);
    const cached = await cache(w).listAffirmationsForEntry(idOf(1));
    assert.deepEqual(cached, result.data);
    // The next add takes no slot, and the list the screen gets is the cache's too.
    const again = await repo(w).addAffirmation(idOf(1));
    assert.deepEqual(positions(again.data), [1, 2, 3, 4, 5]);
    assert.equal(again.data[4].slot, null);
    assert.deepEqual(await repo(w).listAffirmationsForEntry(idOf(1)), again.data);
    assert.equal(addCalls(w).length, 2);
  });

  await test("repository: the server's limit is INVALID, a missing entry NOT_FOUND, no connection NETWORK and a refused session UNAUTHORIZED; nothing is queued and the cache is left as it was", async (w) => {
    await seedBoth(w, 1);
    const before = await cache(w).listAffirmationsForEntry(idOf(1));
    fillServer(w, 1);
    let result = await repo(w).addAffirmation(idOf(1));
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID");
    result = await repo(w).addAffirmation(serverRow(9).id);
    assert.equal(result.code, "NOT_FOUND");
    w.server.state.offline = true;
    result = await repo(w).addAffirmation(idOf(1));
    assert.equal(result.code, "NETWORK");
    w.server.state.offline = false;
    w.server.state.functions["add-affirmation"] = [() => fnError(401, "UNAUTHORIZED")];
    result = await repo(w).addAffirmation(idOf(1));
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(result.message, copyOf(w).reflection.affirmations.addError);
    assert.deepEqual(await cache(w).listAffirmationsForEntry(idOf(1)), before);
    assert.deepEqual(await w.use("@/db/mutations").listMutations(), []);
    assert.equal(await w.use("@/db/outbox").countUnsent(), 0);
  });

  await test("repository: on the mock data the add puts one of the extras at the next position with no slot, stops at ten, and fails once with Fail next save", async (w) => {
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    const { ANXIOUS_ENTRY_ID } = w.use("@/data/mock/entries");
    const { EXTRA_AFFIRMATIONS } = w.use("@/data/mock/affirmations");
    const mocked = async (work) => {
      const pending = work();
      await advance(400);
      return pending;
    };
    const first = await mocked(() => repo(w).listAffirmationsForEntry(ANXIOUS_ENTRY_ID));
    assert.deepEqual(positions(first), [1, 2, 3]);
    let result = await mocked(() => repo(w).addAffirmation(ANXIOUS_ENTRY_ID));
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 4);
    assert.equal(result.data[3].position, 4);
    assert.equal(result.data[3].slot, null);
    assert.equal(result.data[3].headline, EXTRA_AFFIRMATIONS[0].headline);
    assert.deepEqual(result.data[3].verse, EXTRA_AFFIRMATIONS[0].verse);
    for (let n = 5; n <= 10; n += 1) {
      result = await mocked(() => repo(w).addAffirmation(ANXIOUS_ENTRY_ID));
      assert.equal(result.data.length, n);
    }
    result = await mocked(() => repo(w).addAffirmation(ANXIOUS_ENTRY_ID));
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID");
    assert.equal((await mocked(() => repo(w).listAffirmationsForEntry(ANXIOUS_ENTRY_ID))).length, 10);
    w.use("@/store/devStore").useDevStore.getState().setNextPrayerMutationFails(true);
    result = await mocked(() => repo(w).addAffirmation(idOf(1)));
    assert.equal(result.code, "NETWORK");
    assert.equal(await w.use("@/data/mock/db").addMockAffirmation("no-such-entry"), false);
    assert.equal(w.server.state.requests.length, 0, "the mock data reaches no server");
  });
}

// ================================================================== the cache, the mapper, the selector, the planner
async function dataChecks() {
  await test("cache: a row cached before 2026-11-09 (a slot, no position) reads as its slot's place, an added one keeps its null slot and its position, and the list is in position order", async (w) => {
    const store = cache(w);
    const id = idOf(1);
    const old = (slot) => ({ id: `old-${slot}`, entryId: id, slot, headline: "H", text: "T", isFavorite: false, verse: null });
    await store.upsertAffirmations(id, [
      old("evening"),
      { id: "new-5", entryId: id, slot: null, position: 5, headline: "H5", text: "T5", isFavorite: false, verse: null },
      old("morning"),
      { id: "new-4", entryId: id, slot: null, position: 4, headline: "H4", text: "T4", isFavorite: true, verse: null },
      old("afternoon"),
    ]);
    const list = await store.listAffirmationsForEntry(id);
    assert.deepEqual(list.map((a) => a.id), ["old-morning", "old-afternoon", "old-evening", "new-4", "new-5"]);
    assert.deepEqual(positions(list), [1, 2, 3, 4, 5]);
    assert.deepEqual(slots(list), ["morning", "afternoon", "evening", null, null]);
    // A slot that is not one of the three is not an affirmation the cache keeps.
    await store.upsertAffirmations(id, [{ ...old("morning"), id: "bad", slot: "night" }]);
    const after = await store.listAffirmationsForEntry(id);
    assert.equal(after.length, 5);
    assert.ok(w.logs.some((line) => line.includes("cache_row_invalid")));
  }, { signIn: true });

  await test("mapper and selector: a null or unknown time_slot is no slot and the position comes from the row or the slot; Journal's card takes only an affirmation that carries its slot", async (w) => {
    const { toAffirmation } = w.use("@/data/mappers");
    const { getAffirmationForSlot } = w.use("@/data/selectors");
    const rows = affirmationRows(idOf(1));
    const added = toAffirmation({ ...rows[0], id: "added", time_slot: null, position: 7 });
    assert.equal(added.slot, null);
    assert.equal(added.position, 7);
    const unknown = toAffirmation({ ...rows[0], id: "unknown", time_slot: "night", position: null });
    assert.equal(unknown.slot, null);
    assert.equal(unknown.position, 1);
    const evening = toAffirmation({ ...rows[2], position: null });
    assert.equal(evening.slot, "evening");
    assert.equal(evening.position, 3);
    const moved = toAffirmation({ ...rows[0], id: "moved", time_slot: "morning", position: 4 });
    const list = [toAffirmation({ ...rows[0], time_slot: null }), toAffirmation(rows[1]), toAffirmation(rows[2]), moved];
    assert.equal(getAffirmationForSlot(list, "morning").id, "moved");
    assert.equal(getAffirmationForSlot(list, "afternoon").id, rows[1].id);
    assert.equal(getAffirmationForSlot([added, unknown], "morning"), null);
  }, { signIn: false });

  await test("planner: only the three that carry a slot reach the lock screen, so an added affirmation changes nothing and one that took a slot over is the one sent", async (w) => {
    const { planAffirmations } = w.use("@/services/affirmationPlanner");
    const { toAffirmation } = w.use("@/data/mappers");
    const rows = affirmationRows(idOf(1));
    const three = rows.map(toAffirmation);
    const input = (affirmations) => ({
      source: { entryId: idOf(1), affirmations },
      enabled: true,
      permission: "granted",
      userHash: "0123456789abcdef",
      timeZone: "UTC",
      now: new Date(BASE),
      reminders: { morning: "08:00", afternoon: "13:00", evening: "20:00" },
      days: 2,
    });
    const plain = planAffirmations(input(three));
    assert.ok(plain.length > 0);
    const extra = toAffirmation({ ...rows[0], id: "added", time_slot: null, position: 4, headline: "Added headline" });
    const withExtra = planAffirmations(input([...three, extra]));
    assert.deepEqual(withExtra.map((p) => p.identifier), plain.map((p) => p.identifier));
    assert.ok(withExtra.every((p) => p.title !== "Added headline" && p.body !== "Added headline"));
    // The added one took the morning over: it is the morning notification, and the old morning one is gone from the plan.
    const moved = [{ ...three[0], slot: null }, three[1], three[2], { ...extra, slot: "morning" }];
    const withMoved = planAffirmations(input(moved));
    assert.equal(withMoved.length, plain.length);
    assert.ok(withMoved.some((p) => p.body === "Added headline" || p.title === "Added headline"));
    assert.ok(withMoved.every((p) => p.title !== "Headline morning" && p.body !== "Headline morning"));
    // With one slot's affirmation gone (nothing took it over) nothing is sent, as before.
    assert.deepEqual(planAffirmations(input([{ ...three[0], slot: null }, three[1], three[2]])), []);
  }, { signIn: false });
}

// ================================================================== the Reflection hook
async function hookChecks() {
  async function render(w, id) {
    const { useReflection } = w.use("@/hooks/useReflection");
    return w.renderHook(useReflection, id);
  }

  await test("hook: addAffirmation replaces the list on screen with the server's, plans the notifications again, and is null once the reflection has ten", async (w) => {
    seedServer(w, 1);
    const handle = await render(w, idOf(1));
    const ready = await until(handle, (s) => s.status === "ready" && s.affirmations.length === 3, "the entry");
    assert.equal(typeof ready.addAffirmation, "function");
    assert.equal(ready.adding, false);
    const requestsBefore = w.affirmationRequests();
    const result = await ready.addAffirmation();
    assert.equal(result.ok, true);
    const four = await until(handle, (s) => s.status === "ready" && s.affirmations.length === 4, "four affirmations");
    assert.deepEqual(positions(four.affirmations), [1, 2, 3, 4]);
    assert.equal(four.adding, false);
    assert.equal(w.affirmationRequests(), requestsBefore + 1);
    for (let n = 5; n <= 10; n += 1) {
      const state = handle.result.current;
      assert.equal(typeof state.addAffirmation, "function", `an add is offered at ${n - 1}`);
      await state.addAffirmation();
      await until(handle, (s) => s.status === "ready" && s.affirmations.length === n, `${n} affirmations`);
    }
    const full = handle.result.current;
    assert.equal(full.addAffirmation, null);
    assert.equal(addCalls(w).length, 7);
    handle.unmount();
  });

  await test("hook: a second tap while one is on its way does nothing, a server that calls the reflection full reloads the list, and a failure leaves the list as it was", async (w) => {
    seedServer(w, 1);
    const handle = await render(w, idOf(1));
    const ready = await until(handle, (s) => s.status === "ready" && s.affirmations.length === 3, "the entry");
    let release;
    w.server.state.gate = new Promise((resolve) => (release = resolve));
    const first = ready.addAffirmation();
    await settle(2);
    const during = await until(handle, (s) => s.status === "ready" && s.adding === true, "adding");
    const second = await during.addAffirmation();
    assert.equal(second.ok, false);
    release();
    w.server.state.gate = null;
    const result = await first;
    assert.equal(result.ok, true);
    await until(handle, (s) => s.status === "ready" && s.affirmations.length === 4 && s.adding === false, "four, not adding");
    assert.equal(addCalls(w).length, 1, "one request for two taps");
    // Another phone filled the reflection: the server says so, and the list on screen becomes the ten it has.
    fillServer(w, 1, 5);
    const limited = await handle.result.current.addAffirmation();
    assert.equal(limited.ok, false);
    assert.equal(limited.code, "INVALID");
    const ten = await until(handle, (s) => s.status === "ready" && s.affirmations.length === 10, "the server's ten");
    assert.equal(ten.addAffirmation, null);
    handle.unmount();
    // A failure (no connection) leaves the list as it was, with the add still offered.
    seedServer(w, 2);
    const other = await render(w, idOf(2));
    const before = await until(other, (s) => s.status === "ready" && s.affirmations.length === 3, "the second entry");
    w.server.state.offline = true;
    const failed = await before.addAffirmation();
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "NETWORK");
    await settle(4);
    assert.equal(other.result.current.affirmations.length, 3);
    assert.equal(typeof other.result.current.addAffirmation, "function");
    w.server.state.offline = false;
    other.unmount();
  });
}

// ================================================================== analytics, source and copy
async function policyChecks() {
  await test("analytics: affirmation_added carries a position of 4 to 10 and nothing else, and a position outside that, or none, drops the event", async (w) => {
    const { sanitizeEvent } = w.use("@/services/analyticsPolicy");
    const sent = sanitizeEvent({ event: "affirmation_added", properties: { position: 4, entry_id: "x", headline: "H" } });
    assert.deepEqual(sent.properties, { position: 4, $process_person_profile: false, $geoip_disable: true });
    assert.notEqual(sanitizeEvent({ event: "affirmation_added", properties: { position: 10 } }), null);
    for (const position of [3, 11, 0, "4", null]) {
      assert.equal(sanitizeEvent({ event: "affirmation_added", properties: { position } }), null, String(position));
    }
    assert.equal(sanitizeEvent({ event: "affirmation_added", properties: {} }), null);
  }, { signIn: false });

  await test("source: the screen sends affirmation_added only after a success and never for a heavy moment, the button is a quiet ghost with no haptic, the planner skips a null slot, and the copy is typographic", async (w) => {
    const screen = read("src/screens/journal/ReflectionScreen.tsx");
    const tracks = screen.match(/track\("affirmation_added"/g) ?? [];
    assert.equal(tracks.length, 1);
    const at = screen.indexOf('track("affirmation_added"');
    const guard = screen.slice(Math.max(0, at - 400), at);
    assert.ok(/added\.ok/.test(guard), "the event waits for the server's answer");
    assert.ok(/!state\.entry\.isCrisis/.test(guard), "a heavy moment sends no event");
    const carousel = read("src/components/ReflectionCarousel.tsx");
    assert.ok(/tone="ghost"/.test(carousel), "the add button is a ghost button");
    assert.ok(!/haptics/.test(carousel), "no haptic in the carousel");
    assert.ok(!/console\./.test(carousel));
    const hook = read("src/hooks/useReflection.ts");
    assert.ok(/added\.ok[\s\S]{0,400}requestAffirmationReschedule\(\)/.test(hook), "the notifications are planned again after a success");
    assert.ok(!/console\./.test(hook));
    assert.ok(/if \(affirmation\.slot === null\) continue;/.test(read("src/services/affirmationPlanner.ts")));
    assert.ok(/Affirmation & \{ slot: TimeSlot \}/.test(read("src/components/AffirmationCard.tsx")));
    assert.ok(!/MAX_AFFIRMATIONS = (?!10)/.test(read("src/constants/app.ts")));
    const { affirmations: text } = copyOf(w).reflection;
    for (const value of [text.add, text.adding, text.addError, text.addOffline, text.allAdded(10), text.remaining(1), text.remaining(6), text.addLabel(1), text.addLabel(6)]) {
      assert.equal(typeof value, "string");
      assert.ok(!value.includes("'"), value);
      assert.ok(value.length > 3);
    }
    assert.ok(text.allAdded(10).includes("10"));
    assert.equal(text.remaining(1), "1 more");
    assert.equal(text.remaining(6), "6 more");
    assert.ok(/internet/i.test(text.addOffline));
  }, { signIn: false });

  await test("mock data: the extras' verses are the Berean Standard Bible's own words, seven of them, with one-line headlines of at most 38 characters", async (w) => {
    const { EXTRA_AFFIRMATIONS } = w.use("@/data/mock/affirmations");
    assert.equal(EXTRA_AFFIRMATIONS.length, 7);
    const books = { Psalm: "PSA", Philippians: "PHP" };
    const seen = new Set();
    for (const extra of EXTRA_AFFIRMATIONS) {
      const match = /^(Psalm|Philippians) (\d+):(\d+)$/.exec(extra.verse.reference);
      assert.ok(match, extra.verse.reference);
      assert.ok(!seen.has(extra.verse.reference), `${extra.verse.reference} is used once`);
      seen.add(extra.verse.reference);
      const file = path.join(ROOT, "supabase", "functions", "_shared", "bible", "fixtures", `${books[match[1]]}_${match[2]}.simple.json`);
      const chapter = JSON.parse(fs.readFileSync(file, "utf8"));
      const verse = chapter.chapter.content.find((item) => item.type === "verse" && item.number === Number(match[3]));
      assert.equal(extra.verse.text, verse.text.trim(), extra.verse.reference);
      assert.ok(extra.headline.length <= 38, extra.headline);
      assert.ok(!extra.headline.includes("\n"));
      assert.ok(!extra.text.includes("'") && !extra.headline.includes("'"), extra.headline);
    }
  }, { signIn: false });
}

(async () => {
  await gatewayChecks();
  await repositoryChecks();
  await dataChecks();
  await hookChecks();
  await policyChecks();
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
