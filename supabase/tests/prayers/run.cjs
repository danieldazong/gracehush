// The step 29 checks: the real prayer data. They run the app's real TypeScript (the prayer patches, the answered-day dates, the
// change queue, the read cache, the queries, the repository, the failure policy, the sync engine and the Prayers and Reflection
// hooks) with the real supabase-js client against the fake Supabase of step 25 (../journal-data/world.cjs), which answers a
// prayer update as the real table does: the app's column grant and the table's prayer rules (step 18). Every check ends by
// asserting that nothing the database or AGENTS.md would refuse was sent, and that the development log holds no word, note, id
// or token.
//
//   node --no-warnings supabase/tests/prayers/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/prayers/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const W = require("../journal-data/world.cjs");

const {
  makeLiveWorld,
  serverRow,
  affirmationRows,
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

// Words, notes, ids and tokens that must never reach the development log.
const FORBIDDEN_IN_LOGS = [
  "the words of entry",
  "shepherd",
  "devotional of entry",
  "Title 1",
  "A prayer title",
  "A short summary",
  "quiet heart",
  "a later note",
  "tokA",
  "tokB",
  "user_a",
  "user_b",
  "00000000-0000-4000",
  "abcdefghij",
  "sb_publishable",
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
const repo = (w) => w.use("@/data/journalRepository");
const queue = (w) => w.use("@/db/mutations");
const patches = (w) => w.use("@/data/prayerPatches");
const serverOf = (w, n) => w.server.state.entries.find((row) => row.id === idOf(n));
const updates = (w) => w.server.state.requests.filter((r) => r.method === "PATCH" && r.path.endsWith("/journal_entries"));
const prayerReads = (w) =>
  w.server.state.requests.filter((r) => r.method === "GET" && r.path.endsWith("/journal_entries") && new URLSearchParams(r.search).has("or"));
const setNet = (w, connected) => w.use("@/store/offlineStore").useOfflineStore.getState().setNet(connected, connected);

// n rows on the server (1 is the newest), each finished one with its affirmations. `build(n)` adds columns.
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
  const cache = w.use("@/db/cache");
  const { toJournalEntry } = w.use("@/data/mappers");
  for (const row of w.server.state.entries) await cache.upsertEntry(toJournalEntry(row));
}

async function cachedPrayer(w, n) {
  return (await w.use("@/db/cache").getEntry(idOf(n)))?.prayer ?? null;
}

async function until(read, predicate, label, rounds = 100) {
  for (let i = 0; i < rounds; i += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await settle(2);
  }
  assert.fail(`${label}: never became what was waited for`);
}

// The mock data waits on timers (a simulated network), which run on the virtual clock.
async function finish(promise, ms = 1_000) {
  await advance(ms);
  return promise;
}

// A screen's first load has asked the server (so a scripted answer that follows goes to the next request, not to it).
async function afterServerRead(w, table = "journal_entries") {
  await until(
    async () => w.server.state.requests.filter((r) => r.method === "GET" && r.path.endsWith(`/${table}`)).length,
    (count) => count > 0,
    "the first read",
  );
  await settle(5);
}

async function withZone(zone, run) {
  const saved = process.env.TZ;
  process.env.TZ = zone;
  try {
    return await run();
  } finally {
    process.env.TZ = saved;
  }
}

// ================================================================== the answered day
async function dateChecks() {
  await test("dates: an answered day is kept as 12:00 UTC and reads back as the same day in UTC-10, UTC, UTC+14 and five more zones", async (w) => {
    const dates = w.use("@/utils/prayerDates");
    const zones = ["Pacific/Honolulu", "UTC", "Pacific/Kiritimati", "Africa/Lagos", "America/New_York", "America/Los_Angeles", "Pacific/Auckland", "Pacific/Apia"];
    const days = [];
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 86_400_000) days.push(new Date(ms).toISOString().slice(0, 10));
    for (const writeZone of zones) {
      const stamps = await withZone(writeZone, async () => days.map((day) => dates.answeredDateToTimestamp(day)));
      for (const readZone of zones) {
        await withZone(readZone, async () => {
          stamps.forEach((text, i) => {
            assert.equal(text, `${days[i]}T12:00:00.000Z`, `${days[i]} written in ${writeZone}`);
            assert.equal(dates.answeredDayOf(text), days[i]);
            assert.equal(dates.toCalendarDate(dates.answeredLocalDate(text)), days[i], `${days[i]} written in ${writeZone}, read in ${readZone}`);
          });
        });
      }
    }
    // What the timeline prints, whatever zone the phone is in.
    for (const zone of ["Pacific/Kiritimati", "Pacific/Honolulu", "Africa/Lagos"]) {
      await withZone(zone, async () => {
        assert.equal(dates.formatAnsweredDay(AT, false), "Oct 27", zone);
        assert.equal(dates.formatAnsweredDay(AT, true), "Oct 27, 2026", zone);
      });
    }
    assert.equal(dates.answeredDayOf("not a time"), null);
    assert.equal(dates.answeredDateToTimestamp("2026-02-30"), null);
  }, { signIn: false });

  await test("dates: the day of creation and today are valid answered days, the day before creation and tomorrow are not, in every zone", async (w) => {
    const dates = w.use("@/utils/prayerDates");
    for (const zone of ["Pacific/Honolulu", "UTC", "Pacific/Kiritimati", "Africa/Lagos"]) {
      await withZone(zone, async () => {
        const now = new Date(2026, 9, 28, 9, 30);
        const created = new Date(2026, 9, 20, 23, 50).toISOString();
        assert.equal(dates.isValidAnsweredDate("2026-10-20", created, now), true, zone);
        assert.equal(dates.isValidAnsweredDate("2026-10-28", created, now), true, zone);
        assert.equal(dates.isValidAnsweredDate("2026-10-19", created, now), false, zone);
        assert.equal(dates.isValidAnsweredDate("2026-10-29", created, now), false, zone);
        assert.equal(dates.isValidAnsweredDate("2026-02-30", created, now), false, zone);
      });
    }
  }, { signIn: false });
}

// ================================================================== the patches and the policy (pure)
async function patchChecks() {
  await test("patches: changes merge to their final values, and a patch keeps only the prayer columns", async (w) => {
    const p = patches(w);
    assert.deepEqual(p.mergePatches(p.trackPatch(false), p.answerPatch(AT, "n")), {
      is_active_prayer: true,
      is_answered: true,
      answered_at: AT,
      answered_notes: "n",
    });
    assert.deepEqual(p.mergePatches(p.answerPatch(AT, "n"), p.unanswerPatch()), p.unanswerPatch());
    assert.deepEqual(p.mergePatches(p.answerPatch(AT, "n"), p.notePatch("m")), p.answerPatch(AT, "m"));
    assert.deepEqual(p.mergePatches(p.mergePatches(p.answerPatch(AT, "n"), p.notePatch("m")), p.trackPatch(false)), p.trackPatch(false));
    assert.deepEqual(p.sanitizePatch({ is_answered: true, prayer_summary: "x", user_id: "u", answered_at: 5, answered_notes: null }), {
      is_answered: true,
      answered_notes: null,
    });
    assert.equal(p.sanitizePatch({ prayer_title: "x" }), null);
    assert.equal(p.sanitizePatch(null), null);
    assert.equal(p.sanitizePatch([true]), null);
  }, { signIn: false });

  await test("patches: what the phone shows after a change is what the mapper makes of the changed row, for every kind of entry and change", async (w) => {
    const p = patches(w);
    const { toJournalEntry } = w.use("@/data/mappers");
    const rows = [
      serverRow(1),
      serverRow(2, PRAYER),
      serverRow(3, { ...PRAYER, is_answered: true, answered_at: AT, answered_notes: "an old note" }),
      serverRow(4, { is_active_prayer: true }),
      serverRow(5, {
        is_crisis: true,
        dominant_emotion: null,
        scripture_reference: null,
        scripture_text: null,
        scripture_verified: false,
        devotional_title: null,
        devotional_script: null,
        closing_prayer: null,
      }),
      serverRow(6, { processing_status: "processing" }),
      serverRow(7, { processing_status: "failed", error_code: "AI_UNAVAILABLE" }),
    ];
    const changes = [p.trackPatch(true), p.trackPatch(false), p.answerPatch(AT, "a note"), p.answerPatch(AT, null), p.unanswerPatch(), p.notePatch("new"), p.notePatch(null), {}];
    for (const row of rows) {
      const before = toJournalEntry(row);
      for (const patch of changes) {
        const shown = p.applyPrayerPatch(before, patch);
        // A crisis or unfinished entry is never changed by the app; the mapper says it is no prayer either way.
        const real = before.status === "ready" && !before.isCrisis ? toJournalEntry({ ...row, ...patch }) : before;
        assert.deepEqual(shown.prayer, real.prayer, `${row.id.slice(-2)} ${JSON.stringify(patch)}`);
        assert.deepEqual({ ...shown, prayer: null }, { ...before, prayer: null }, "nothing but the prayer changes");
      }
    }
  }, { signIn: false });

  await test("policy: no answer, a timeout, too many requests and a server error are retried; a refused session pauses; a database refusal is dropped", async (w) => {
    const { classifyPrayerFailure } = w.use("@/services/syncPolicy");
    const cases = [
      [0, "", "retry"],
      [0, "NO_SESSION", "pause_auth"],
      [401, "PGRST301", "pause_auth"],
      [401, "PGRST303", "pause_auth"],
      [401, "", "pause_auth"],
      [403, "", "pause_auth"],
      [403, "42501", "drop"],
      [400, "23514", "drop"],
      [400, "22P02", "drop"],
      [400, "22001", "drop"],
      [409, "23505", "drop"],
      [400, "PGRST204", "drop"],
      [404, "PGRST205", "drop"],
      [408, "", "retry"],
      [429, "", "retry"],
      [500, "XX000", "retry"],
      [503, "", "retry"],
      [504, "PGRST003", "retry"],
    ];
    for (const [status, code, action] of cases) assert.equal(classifyPrayerFailure(status, code), action, `${status} ${code}`);
  }, { signIn: false });
}

// ================================================================== the change queue (real SQLite)
async function queueChecks() {
  await test("queue: changes to one entry merge into one row with the final values, one row per entry, sealed so the note cannot be read in the file", async (w) => {
    const q = queue(w);
    const p = patches(w);
    await q.enqueuePatch("e1", p.trackPatch(false));
    await q.enqueuePatch("e1", p.answerPatch(AT, NOTE));
    await q.enqueuePatch("e2", p.trackPatch(true));
    await q.enqueuePatch("e1", p.notePatch("a later note"));
    const list = await q.listMutations();
    assert.deepEqual(list.map((change) => change.entryId).sort(), ["e1", "e2"]);
    const e1 = list.find((change) => change.entryId === "e1");
    assert.deepEqual(e1.patch, { is_active_prayer: true, is_answered: true, answered_at: AT, answered_notes: "a later note" });
    assert.equal(e1.revision, 3);
    assert.equal(await q.countMutations(), 2);
    await q.enqueuePatch("e3", p.answerPatch(AT, NOTE));
    const db = w.use("@/db/database").getDb();
    await db.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");
    for (const name of w.sqlite.files()) {
      const bytes = fs.readFileSync(path.join(w.sqlite.dir, name));
      assert.ok(!bytes.includes(NOTE), name);
      assert.ok(!bytes.includes("a later note"), name);
    }
    // Two changes made at the same moment are both kept: merges run one at a time.
    await Promise.all([q.enqueuePatch("e4", { is_active_prayer: true }), q.enqueuePatch("e4", { is_answered: false })]);
    assert.deepEqual((await q.getMutation("e4")).patch, { is_active_prayer: true, is_answered: false });
  });

  await test("queue: a key that is not a prayer column throws in development and is never stored", async (w) => {
    const q = queue(w);
    assert.throws(() => q.enqueuePatch("e1", { is_active_prayer: true, prayer_summary: "made up" }), /prayer column/);
    assert.equal(await q.countMutations(), 0);
  });

  await test("queue: a row changed since it was read is not removed or rescheduled; a paused change is not due until it is resumed", async (w) => {
    const q = queue(w);
    await q.enqueuePatch("e1", { is_active_prayer: true });
    const read = await q.nextDueMutation(clock.now);
    await q.enqueuePatch("e1", { is_answered: false });
    assert.equal(await q.removeMutation("e1", read.revision), false, "a newer change is kept");
    await q.markRetry("e1", read.revision, clock.now + 60_000, "NETWORK");
    assert.equal((await q.nextDueMutation(clock.now)).entryId, "e1", "the newer change is still due now");
    await q.markPausedAuth();
    assert.equal(await q.nextDueMutation(clock.now + 86_400_000), null);
    assert.equal(await q.nextMutationAt(), null, "nothing to wake for while paused");
    assert.equal(await q.resumePausedMutations(clock.now), 1);
    const due = await q.nextDueMutation(clock.now);
    assert.equal(due.entryId, "e1");
    assert.equal(await q.removeMutation("e1", due.revision), true);
    assert.equal(await q.countMutations(), 0);
  });
}

// ================================================================== the writes (the repository, real data)
async function writeChecks() {
  await test("write: marking answered shows at once on the phone and in the result, keeps one change, and sends nothing by itself", async (w) => {
    await seedBoth(w, 3, (n) => (n === 2 ? PRAYER : {}));
    const result = await repo(w).markPrayerAnswered({ prayerId: idOf(2), answeredDate: "2026-10-25", note: `  ${NOTE}  ` });
    assert.equal(result.ok, true);
    assert.deepEqual(
      { answered: result.data.isAnswered, at: result.data.answeredAt, note: result.data.answeredNote, title: result.data.title },
      { answered: true, at: "2026-10-25T12:00:00.000Z", note: NOTE, title: "A prayer title" },
    );
    assert.equal((await cachedPrayer(w, 2)).isAnswered, true);
    assert.equal(await repo(w).countPendingPrayerChanges(), 1);
    assert.equal(updates(w).length, 0, "the sync engine sends it, not the write");
  });

  await test("write: a crisis entry, an unfinished one and one not on the phone are refused, and nothing is written or kept", async (w) => {
    await seedBoth(w, 3, (n) =>
      n === 1
        ? { is_crisis: true, dominant_emotion: null, scripture_reference: null, scripture_text: null, scripture_verified: false, devotional_title: null, devotional_script: null, closing_prayer: null }
        : n === 2
          ? { processing_status: "processing" }
          : {},
    );
    const r = repo(w);
    assert.equal((await r.setPrayerTracked(idOf(1), true)).code, "NOT_FOUND");
    assert.equal((await r.setPrayerTracked(idOf(2), true)).code, "INVALID");
    assert.equal((await r.setPrayerTracked(idOf(9), true)).code, "NOT_FOUND");
    assert.equal((await r.markPrayerAnswered({ prayerId: idOf(3), answeredDate: "2026-10-25", note: null })).code, "NOT_FOUND", "not a prayer");
    assert.equal(await r.countPendingPrayerChanges(), 0);
    assert.equal(await cachedPrayer(w, 1), null);
    assert.equal(await cachedPrayer(w, 2), null);
  });

  await test("write: a day in the future, a day before the prayer and a note over 1,000 characters are INVALID; an empty note is no note", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    const r = repo(w);
    assert.equal((await r.markPrayerAnswered({ prayerId: idOf(1), answeredDate: "2026-10-26", note: null })).code, "INVALID");
    assert.equal((await r.markPrayerAnswered({ prayerId: idOf(1), answeredDate: "2026-10-24", note: null })).code, "INVALID");
    assert.equal((await r.markPrayerAnswered({ prayerId: idOf(1), answeredDate: "2026-10-25", note: "x".repeat(1001) })).code, "INVALID");
    assert.equal(await r.countPendingPrayerChanges(), 0);
    const ok = await r.markPrayerAnswered({ prayerId: idOf(1), answeredDate: "2026-10-25", note: "   " });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.answeredNote, null);
    assert.equal((await r.updateAnsweredNote(idOf(2), "a note on an open prayer")).code, "INVALID");
  }, { now: Date.parse("2026-10-25T15:00:00Z") });

  await test("write: Mark as Prayer Request makes a reflection a prayer titled by its date with the reflection's title as summary, never the words; off clears the answer", async (w) => {
    await seedBoth(w, 2, (n) => (n === 2 ? { ...PRAYER, is_answered: true, answered_at: AT, answered_notes: NOTE } : {}));
    const r = repo(w);
    const on = await r.setPrayerTracked(idOf(1), true);
    assert.equal(on.ok, true);
    assert.equal(on.data.title, "");
    assert.equal(on.data.summary, "Title 1", "the reflection's title");
    const listed = await r.readCachedPrayers();
    const shown = listed.find((prayer) => prayer.id === idOf(1));
    assert.equal(shown.summary, "Title 1");
    assert.ok(listed.every((prayer) => !prayer.summary.includes("the words of entry")), "never the transcript");
    assert.equal(w.use("@/utils/format").getPrayerTitle(shown), "Prayer from Oct 25");
    const off = await r.setPrayerTracked(idOf(2), false);
    assert.deepEqual(off, { ok: true, data: null });
    assert.equal(await cachedPrayer(w, 2), null);
    assert.deepEqual((await queue(w).getMutation(idOf(2))).patch, patches(w).trackPatch(false));
  });
}

// ================================================================== the sync engine
async function engineChecks() {
  await test("engine: a waiting change goes as one update of its own columns, by id and user, and the server's row is what the phone then has", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    await w.startEngine();
    const events = [];
    w.use("@/services/syncEngine").subscribe((event) => events.push(event));
    await repo(w).markPrayerAnswered({ prayerId: idOf(1), answeredDate: "2026-10-25", note: NOTE });
    await w.use("@/services/syncEngine").syncNow("mutation");
    await settle();
    const [request] = updates(w);
    assert.equal(updates(w).length, 1);
    assert.deepEqual(Object.keys(request.body).sort(), ["answered_at", "answered_notes", "is_active_prayer", "is_answered"]);
    const query = new URLSearchParams(request.search);
    assert.equal(query.get("id"), `eq.${idOf(1)}`);
    assert.equal(query.get("user_id"), "eq.user_a");
    assert.equal(serverOf(w, 1).answered_at, "2026-10-25T12:00:00.000Z");
    assert.equal(serverOf(w, 1).answered_notes, NOTE);
    assert.equal(await queue(w).countMutations(), 0);
    const cached = await w.use("@/db/cache").getEntry(idOf(1));
    assert.equal(cached.updatedAt, w.use("@/utils/timestamp").normalizeTimestamp(serverOf(w, 1).updated_at), "the server's copy");
    assert.equal(cached.prayer.answeredNote, NOTE);
    assert.ok(events.some((event) => event.type === "prayer" && event.entryId === idOf(1) && event.saved));
  }, { now: Date.parse("2026-10-25T15:00:00Z") });

  await test("engine: offline, a prayer marked, edited and moved back goes as one update with the final values once the phone is online", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    await w.startEngine();
    setNet(w, false);
    const r = repo(w);
    const engine = w.use("@/services/syncEngine");
    assert.equal((await r.markPrayerAnswered({ prayerId: idOf(1), answeredDate: "2026-10-25", note: NOTE })).ok, true);
    await engine.syncNow("mutation");
    assert.equal((await r.updateAnsweredNote(idOf(1), "a later note")).ok, true);
    await engine.syncNow("mutation");
    assert.equal((await r.unmarkPrayerAnswered(idOf(1))).ok, true);
    await engine.syncNow("mutation");
    await advance(60_000);
    assert.equal(updates(w).length, 0, "nothing goes while offline");
    assert.equal(await r.countPendingPrayerChanges(), 1);
    setNet(w, true);
    await settle();
    assert.equal(updates(w).length, 1, "one request");
    assert.deepEqual(updates(w)[0].body, { is_active_prayer: true, is_answered: false, answered_at: null, answered_notes: null });
    assert.equal(await r.countPendingPrayerChanges(), 0);
    assert.equal(serverOf(w, 1).answered_notes, null);
  }, { now: Date.parse("2026-10-25T15:00:00Z") });

  await test("engine: prayer changes go before the reflections waiting in the outbox", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    await w.use("@/db/outbox").enqueue({ clientEntryId: "c1", inputType: "text", text: "A reflection that waits its turn" });
    await repo(w).setPrayerTracked(idOf(1), false);
    await w.startEngine();
    await settle();
    const order = w.server.state.requests
      .filter((r) => r.method === "PATCH" || r.path === "/functions/v1/process-entry")
      .map((r) => (r.method === "PATCH" ? "prayer" : "outbox"));
    assert.deepEqual(order, ["prayer", "outbox"]);
  });

  await test("engine: no answer is tried again after about 5 s and then 15 s, and the change stays shown meanwhile", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    await w.startEngine();
    w.server.state.offline = true;
    await repo(w).setPrayerTracked(idOf(1), false);
    await w.use("@/services/syncEngine").syncNow("mutation");
    await settle();
    assert.equal(updates(w).length, 1);
    assert.equal(await cachedPrayer(w, 1), null, "still shown as changed");
    assert.equal((await queue(w).getMutation(idOf(1))).lastErrorCode, "NETWORK");
    await advance(3_500);
    assert.equal(updates(w).length, 1, "not before 4 s");
    await advance(2_700);
    assert.equal(updates(w).length, 2, "again after about 5 s");
    w.server.state.offline = false;
    await advance(18_100);
    assert.equal(updates(w).length, 3, "and after about 15 s more");
    assert.equal(await queue(w).countMutations(), 0);
    assert.equal(serverOf(w, 1).is_active_prayer, false);
  });

  await test("engine: a server error is tried again; a refused session pauses every change until the app comes to the front", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    w.server.state.rest.journal_entries.push(json(503, { code: "", message: "busy", details: null, hint: null }));
    await repo(w).setPrayerTracked(idOf(1), false);
    await engine.syncNow("mutation");
    await settle();
    assert.equal(updates(w).length, 1);
    await advance(6_100);
    assert.equal(updates(w).length, 2, "the server error was tried again");
    assert.equal(await queue(w).countMutations(), 0);
    w.server.state.rest.journal_entries.push(json(401, { code: "PGRST301", message: "JWT expired", details: null, hint: null }));
    await repo(w).setPrayerTracked(idOf(2), false);
    await engine.syncNow("mutation");
    await settle();
    assert.equal(updates(w).length, 3);
    await advance(3 * 3_600_000);
    assert.equal(updates(w).length, 3, "never on a timer");
    assert.equal(await queue(w).countMutations(), 1);
    w.appState.emit("active");
    await settle();
    assert.equal(updates(w).length, 4, "asked again when the app comes to the front");
    assert.equal(await queue(w).countMutations(), 0);
  });

  await test("engine: a change the database refuses for good is dropped and never tried again, the entry is read again, and the notice names it", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    await w.startEngine();
    const events = [];
    w.use("@/services/syncEngine").subscribe((event) => events.push(event));
    // "Answered" with no date breaks the table's answered_fields_match rule.
    const changed = await w.use("@/data/entriesLive").changePrayer(idOf(1), () => ({ ok: true, data: { is_answered: true } }));
    assert.equal(changed.ok, true);
    assert.equal((await cachedPrayer(w, 1)).isAnswered, true, "shown at once");
    await w.use("@/services/syncEngine").syncNow("mutation");
    await settle();
    assert.equal(updates(w).length, 1);
    assert.equal(await queue(w).countMutations(), 0, "dropped");
    assert.equal((await cachedPrayer(w, 1)).isAnswered, false, "read again from the server");
    assert.equal(w.use("@/store/noticeStore").useNoticeStore.getState().prayerChangeFailed, idOf(1));
    assert.ok(events.some((event) => event.type === "prayer" && event.entryId === idOf(1) && !event.saved));
    await advance(6 * 3_600_000);
    assert.equal(updates(w).length, 1, "no retry loop");
    assert.equal(serverOf(w, 1).is_answered, false);
  });

  await test("engine: a change made while another is on its way is not lost: it goes next, and the phone keeps showing it", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    await w.startEngine();
    const r = repo(w);
    let releaseFirst;
    let releaseSecond;
    w.server.state.gate = new Promise((resolve) => (releaseFirst = resolve));
    await r.markPrayerAnswered({ prayerId: idOf(1), answeredDate: "2026-10-25", note: NOTE });
    const run = w.use("@/services/syncEngine").syncNow("mutation");
    await settle();
    assert.equal(updates(w).length, 1, "the first change is on its way");
    await r.updateAnsweredNote(idOf(1), "a later note");
    // The second request waits too, so the phone can be looked at between the two answers.
    w.server.state.gate = new Promise((resolve) => (releaseSecond = resolve));
    releaseFirst();
    await settle();
    assert.equal(updates(w).length, 2, "the later change goes next");
    assert.equal(serverOf(w, 1).answered_notes, NOTE, "the server has taken the first change only");
    assert.equal((await cachedPrayer(w, 1)).answeredNote, "a later note", "the phone still shows the later change");
    w.server.state.gate = null;
    releaseSecond();
    await run;
    await settle();
    assert.deepEqual(updates(w)[1].body.answered_notes, "a later note");
    assert.equal((await cachedPrayer(w, 1)).answeredNote, "a later note");
    assert.equal(await r.countPendingPrayerChanges(), 0);
    assert.equal(serverOf(w, 1).answered_notes, "a later note");
  }, { now: Date.parse("2026-10-25T15:00:00Z") });

  await test("engine: a change to an entry the server no longer has leaves the queue and the phone", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    await w.startEngine();
    await repo(w).setPrayerTracked(idOf(1), false);
    w.server.state.entries = [];
    await w.use("@/services/syncEngine").syncNow("mutation");
    await settle();
    assert.equal(await queue(w).countMutations(), 0);
    assert.equal(await w.use("@/db/cache").getEntry(idOf(1)), null);
  });
}

// ================================================================== the reads
async function readChecks() {
  await test("read: the server is asked for the finished, non-crisis entries that are tracked or answered, newest first, at most 300, by the explicit columns", async (w) => {
    seedServer(w, 6, (n) =>
      n === 1
        ? PRAYER
        : n === 2
          ? { ...PRAYER, is_answered: true, answered_at: AT }
          : n === 3
            ? { processing_status: "processing", is_active_prayer: true }
            : {},
    );
    const listed = await repo(w).listPrayers();
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.data.map((prayer) => prayer.id), [idOf(1), idOf(2)]);
    const [request] = prayerReads(w);
    const query = new URLSearchParams(request.search);
    assert.equal(query.get("is_crisis"), "eq.false");
    assert.equal(query.get("processing_status"), "eq.ready");
    assert.equal(query.get("or"), "(is_active_prayer.eq.true,is_answered.eq.true)");
    assert.equal(query.get("order"), "created_at.desc");
    assert.equal(query.get("limit"), "300");
    assert.equal(query.get("user_id"), "eq.user_a");
    assert.ok(!query.get("select").includes("*"));
    assert.deepEqual((await repo(w).readCachedPrayers()).map((prayer) => prayer.id), [idOf(1), idOf(2)], "written to the phone");
  });

  await test("read: offline, Prayers is what the phone has, with no error; a refused session is an error", async (w) => {
    await seedBoth(w, 3, (n) => (n === 3 ? {} : PRAYER));
    w.server.state.offline = true;
    const offline = await repo(w).listPrayers();
    assert.equal(offline.ok, true);
    assert.deepEqual(offline.data.map((prayer) => prayer.id), [idOf(1), idOf(2)]);
    w.server.state.offline = false;
    w.server.state.rest.journal_entries.push(json(401, { code: "PGRST301", message: "JWT expired", details: null, hint: null }));
    const refused = await repo(w).listPrayers();
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "UNAUTHORIZED");
  });

  await test("read: a change that waits is kept on top of the server's copy in Prayers, in a page of the Journal and in a reflection read again", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    setNet(w, false);
    await repo(w).setPrayerTracked(idOf(1), false);
    const listed = await repo(w).listPrayers();
    assert.deepEqual(listed.data.map((prayer) => prayer.id), [idOf(2)]);
    const page = await repo(w).loadEntriesPage(null);
    assert.equal(page.data.entries.find((entry) => entry.id === idOf(1)).prayer, null);
    const entry = await repo(w).getEntry(idOf(1));
    assert.equal(entry.prayer, null);
    assert.equal(await cachedPrayer(w, 1), null);
    assert.equal(serverOf(w, 1).is_active_prayer, true, "the server still has the old value");
  });

  await test("read: a prayer this phone cached that the server no longer counts as one stops being one here too", async (w) => {
    await seedBoth(w, 3, () => PRAYER);
    serverOf(w, 2).is_active_prayer = false;
    const listed = await repo(w).listPrayers();
    assert.deepEqual(listed.data.map((prayer) => prayer.id), [idOf(1), idOf(3)]);
    assert.deepEqual((await repo(w).readCachedPrayers()).map((prayer) => prayer.id), [idOf(1), idOf(3)]);
  });

  await test("read: the cache trim keeps every prayer and the newest 200 other entries", async (w) => {
    const cache = w.use("@/db/cache");
    const { toJournalEntry } = w.use("@/data/mappers");
    for (let n = 1; n <= 250; n += 1) await cache.upsertEntry(toJournalEntry(serverRow(n, n > 245 ? PRAYER : {})));
    const gone = await cache.pruneEntries(200);
    assert.equal(gone, 45);
    const left = await cache.listEntries(1000);
    assert.equal(left.length, 205);
    assert.equal((await cache.listPrayerEntries()).length, 5, "the five oldest entries are prayers and stay");
  });

  await test("read: a cache from before version 3 still finds its prayers, and each of its rows is opened only once", async (w) => {
    await seedBoth(w, 30, (n) => (n % 10 === 0 ? PRAYER : {}));
    const db = w.use("@/db/database").getDb();
    await db.execAsync("UPDATE entries_cache SET is_prayer = NULL");
    const cache = w.use("@/db/cache");
    const first = w.counts.decrypts;
    assert.deepEqual((await cache.listPrayerEntries()).map((entry) => entry.id), [idOf(10), idOf(20), idOf(30)]);
    const second = w.counts.decrypts;
    assert.equal(second - first, 30, "every unmarked row once");
    await cache.listPrayerEntries();
    assert.equal(w.counts.decrypts - second, 3, "then only the prayers");
  });
}

// ================================================================== the hooks
async function hookChecks() {
  await test("hook: Prayers shows the phone's prayers, then the server's, and says changes will sync only while offline with changes waiting", async (w) => {
    await seedBoth(w, 3, () => PRAYER);
    await w.startEngine();
    const { usePrayers } = w.use("@/hooks/usePrayers");
    const handle = w.renderHook(usePrayers);
    const ready = await until(async () => handle.result.current, (state) => state.status === "ready", "ready");
    assert.equal(ready.active.length, 3);
    assert.equal(ready.waitingOffline, false);
    setNet(w, false);
    await settle(5);
    assert.equal(handle.result.current.waitingOffline, false, "offline with nothing waiting says nothing");
    const changed = await handle.result.current.markAnswered({ prayerId: idOf(1), answeredDate: "2026-10-25", note: null });
    assert.equal(changed.ok, true);
    const offline = await until(async () => handle.result.current, (state) => state.waitingOffline === true, "offline line");
    assert.equal(offline.answered.length, 1);
    assert.equal(offline.active.length, 2);
    setNet(w, true);
    await until(async () => handle.result.current, (state) => state.waitingOffline === false, "online");
    assert.equal(updates(w).length, 1);
    handle.unmount();
  }, { now: Date.parse("2026-10-25T15:00:00Z") });

  await test("hook: Prayers reads the list again from the phone when a change is refused, so the prayer goes back", async (w) => {
    await seedBoth(w, 2, () => PRAYER);
    await w.startEngine();
    const { usePrayers } = w.use("@/hooks/usePrayers");
    const handle = w.renderHook(usePrayers);
    await until(async () => handle.result.current, (state) => state.status === "ready", "ready");
    await afterServerRead(w);
    w.server.state.rest.journal_entries.push(json(400, { code: "23514", message: "violates check constraint", details: null, hint: null }));
    await handle.result.current.markAnswered({ prayerId: idOf(1), answeredDate: "2026-10-25", note: null });
    const back = await until(async () => handle.result.current, (state) => state.answered.length === 0 && state.active.length === 2, "back in Active");
    assert.equal(back.status, "ready");
    assert.equal(w.use("@/store/noticeStore").useNoticeStore.getState().prayerChangeFailed, idOf(1));
    handle.unmount();
  }, { now: Date.parse("2026-10-25T15:00:00Z") });

  await test("hook: Reflection's toggle changes the entry at once, and a refused change puts it back", async (w) => {
    await seedBoth(w, 1);
    await w.startEngine();
    const { useReflection } = w.use("@/hooks/useReflection");
    const handle = w.renderHook(useReflection, idOf(1));
    await until(async () => handle.result.current, (state) => state.status === "ready", "ready");
    assert.equal(handle.result.current.entry.prayer, null);
    await afterServerRead(w);
    w.server.state.rest.journal_entries.push(json(403, { code: "42501", message: "permission denied", details: null, hint: null }));
    const result = await handle.result.current.setTracked(true);
    assert.equal(result.ok, true);
    assert.notEqual(result.data, null, "the entry shows the change at once");
    await until(async () => handle.result.current, (state) => state.entry.prayer === null, "put back");
    assert.equal(w.use("@/store/noticeStore").useNoticeStore.getState().prayerChangeFailed, idOf(1));
    handle.unmount();
  });
}

// ================================================================== the mock data, and the end of a session
async function otherChecks() {
  await test("mock: the step 14 writes work on the mock data with the dev failure flag, and touch no database and no server", async (w) => {
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    const r = repo(w);
    const listed = await finish(r.listPrayers());
    assert.equal(listed.ok, true);
    const open = listed.data.find((prayer) => !prayer.isAnswered);
    w.use("@/store/devStore").useDevStore.getState().setNextPrayerMutationFails(true);
    assert.equal((await finish(r.unmarkPrayerAnswered(open.id))).code, "NETWORK");
    const today = w.use("@/utils/prayerDates").toCalendarDate(new Date());
    const marked = await finish(r.markPrayerAnswered({ prayerId: open.id, answeredDate: today, note: NOTE }));
    assert.equal(marked.ok, true);
    assert.equal(marked.data.answeredAt, `${today}T12:00:00.000Z`);
    assert.equal((await finish(r.setPrayerTracked(open.id, false))).ok, true);
    assert.equal((await finish(r.listPrayers())).data.some((prayer) => prayer.id === open.id), false);
    assert.deepEqual(await r.readCachedPrayers(), []);
    assert.equal(await r.countPendingPrayerChanges(), 0);
    assert.equal(w.server.state.requests.length, 0);
  });

  await test("mock: the dev failure flag does nothing to a write on the real data", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    w.use("@/store/devStore").useDevStore.getState().setNextPrayerMutationFails(true);
    assert.equal((await repo(w).setPrayerTracked(idOf(1), false)).ok, true);
    assert.equal(w.use("@/store/devStore").useDevStore.getState().nextPrayerMutationFails, true, "left for the mock data");
  });

  await test("sign out: the warning counts the prayers with changes waiting, one per prayer, beside the reflections", async (w) => {
    const body = w.use("@/constants/copy").copy.profile.dialogs.signOutUnsent.body;
    assert.equal(body(1, 0), "1 reflection on this phone hasn’t been sent yet. If you sign out, it will be deleted from this phone.");
    assert.equal(body(2, 0), "2 reflections on this phone haven’t been sent yet. If you sign out, they’ll be deleted from this phone.");
    assert.equal(body(0, 1), "Changes to 1 prayer on this phone haven’t been sent yet. If you sign out, they won’t be saved.");
    assert.equal(body(0, 3), "Changes to 3 prayers on this phone haven’t been sent yet. If you sign out, they won’t be saved.");
    assert.equal(body(1, 2), "1 reflection and changes to 2 prayers on this phone haven’t been sent yet. If you sign out, they won’t be saved.");
    assert.equal(body(2, 1), "2 reflections and changes to 1 prayer on this phone haven’t been sent yet. If you sign out, they won’t be saved.");
    for (const text of [body(1, 0), body(2, 0), body(0, 1), body(0, 3), body(1, 2), body(2, 1)]) {
      assert.ok(!/['"]/.test(text), `straight punctuation in: ${text}`);
    }
    // What the dialog is given: one per prayer, however many changes were made to it.
    await seedBoth(w, 2, () => PRAYER);
    const r = repo(w);
    await r.setPrayerTracked(idOf(1), false);
    await r.setPrayerTracked(idOf(1), true);
    await r.setPrayerTracked(idOf(2), false);
    assert.equal(await r.countPendingPrayerChanges(), 2);
    assert.equal(updates(w).length, 0, "nothing was sent: the engine was not started");
  });

  await test("session: the waiting changes go with the user's database file, and a notice does not outlive the session", async (w) => {
    await seedBoth(w, 1, () => PRAYER);
    await w.startEngine();
    setNet(w, false);
    await repo(w).setPrayerTracked(idOf(1), false);
    w.use("@/store/noticeStore").useNoticeStore.getState().pushPrayerChangeFailed(idOf(1));
    w.use("@/services/syncEngine").stopSyncEngine();
    assert.equal(w.use("@/store/noticeStore").useNoticeStore.getState().prayerChangeFailed, null);
    const database = w.use("@/db/database");
    await database.deleteUserDatabase("user_a");
    await database.openUserDatabase("user_a");
    assert.equal(await queue(w).countMutations(), 0);
  });
}

(async () => {
  await dateChecks();
  await patchChecks();
  await queueChecks();
  await writeChecks();
  await engineChecks();
  await readChecks();
  await hookChecks();
  await otherChecks();
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
