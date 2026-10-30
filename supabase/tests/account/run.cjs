// The step 31 checks: exporting the journal and deleting the account, from the app's side. They run the app's real TypeScript (the
// Edge Function gateway, the account service, the sync engine, the profile sync, the offline session and the database) with the
// real supabase-js client against the fake Supabase of step 25 (../journal-data/world.cjs), whose export-data hands back a link
// and whose delete-account deletes the caller only for the exact confirm body, as the real functions do. Plain Node cannot load
// the player, the downloaded audio, the affirmation notifications or RevenueCat, so those are faked with counters, and so is the
// plan watch (its stops and starts are what these checks are about). Every check ends by asserting that nothing the database or
// AGENTS.md would refuse was sent, and that the development log holds no link, id, token or word.
//
//   node --no-warnings supabase/tests/account/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/account/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const W = require("../journal-data/world.cjs");

const {
  makeLiveWorld,
  json,
  fnError,
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

// Ids, tokens, links and words that must never reach the development log.
const FORBIDDEN_IN_LOGS = ["user_a", "user_b", "tokA", "tokB", "token=", "signed", "export.zip", "example.com", "DELETE"];

function assertQuiet(w) {
  for (const line of w.logs) {
    for (const word of FORBIDDEN_IN_LOGS) {
      assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
    }
  }
}

// What plain Node cannot load, counted. `order` records the plan watch's stops and starts with the requests the server took.
function serviceFakes() {
  const state = { order: [], playerStops: 0, audioDeletes: 0, notificationClears: 0, revenueCatLogouts: 0 };
  const fakes = {
    "@/store/playerStore": {
      __esModule: true,
      usePlayerStore: { getState: () => ({ entryId: null, stop: () => void (state.playerStops += 1) }) },
    },
    "@/services/devotionalAudio": {
      __esModule: true,
      deleteAllDevotionalAudio: async () => void (state.audioDeletes += 1),
      forgetDevotionalFile: () => undefined,
    },
    "@/services/affirmationScheduler": {
      __esModule: true,
      requestAffirmationReschedule: () => undefined,
      clearAffirmations: async () => void (state.notificationClears += 1),
    },
    "@/services/revenuecat": {
      __esModule: true,
      endRevenueCatSession: async () => void (state.revenueCatLogouts += 1),
    },
    "@/services/subscriptionSync": {
      __esModule: true,
      stopPlanWatch: () => void state.order.push("stop plan watch"),
      startPlanWatch: (id) => {
        state.order.push(`start plan watch ${id === "user_a" ? "for the account" : "for someone else"}`);
        return () => undefined;
      },
      syncPlanNow: async () => true,
    },
  };
  return { state, fakes };
}

async function test(name, run, options = {}) {
  // ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either).
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (stopped) return;
  const startedAt = process.hrtime.bigint();
  installClock();
  installVirtualDate();
  clock.now = options.now ?? BASE;
  const services = serviceFakes();
  const w = makeLiveWorld({ ...options, fakes: services.fakes });
  w.services = services.state;
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
const api = (w) => w.use("@/api/journalApi");
const account = (w) => w.use("@/services/account");
const engine = (w) => w.use("@/services/syncEngine");
const profileSync = (w) => w.use("@/services/profileSync");
const copyOf = (w) => w.use("@/constants/copy").copy;
const dev = (w) => w.use("@/store/devStore").useDevStore.getState();
const prefsOf = (w, id = "user_a") => w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState().byUser[id];
const dbOpen = (w) => w.use("@/db/database").isDatabaseOpen();
const calls = (w, name) => w.server.state.requests.filter((request) => request.path === `/functions/v1/${name}`);
const profileRequests = (w) => w.server.state.requests.filter((request) => request.path === "/rest/v1/users_profile").length;

// The mock data waits on timers (a simulated network), which run on the virtual clock.
async function finish(promise, ms = 1_000) {
  await advance(ms);
  return promise;
}

// ================================================================== the gateway
async function gatewayChecks() {
  await test("gateway: export-data sends an empty body, a well-formed answer is ok, and one that is not is UNKNOWN", async (w) => {
    const result = await api(w).exportData();
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.data).sort(), ["expiresAt", "partial", "reused", "sizeBytes", "url"]);
    assert.ok(result.data.url.startsWith("https://"));
    assert.deepEqual(calls(w, "export-data")[0].body, {});
    w.server.state.functions["export-data"].push(() => json(200, { url: 5, expiresAt: "x", partial: false, reused: false }));
    const bad = await api(w).exportData();
    assert.deepEqual({ ok: bad.ok, status: bad.status, code: bad.code }, { ok: false, status: 200, code: "UNKNOWN" });
  });

  await test("gateway: delete-account sends exactly { confirm: \"DELETE\" }, and its failures come back with their codes", async (w) => {
    const result = await api(w).deleteAccount();
    assert.deepEqual(result, { ok: true, data: { deleted: true } });
    assert.deepEqual(calls(w, "delete-account")[0].body, { confirm: "DELETE" });
    w.server.state.functions["delete-account"].push(() => fnError(500, "DELETE_INCOMPLETE"));
    const failed = await api(w).deleteAccount();
    assert.deepEqual({ ok: failed.ok, status: failed.status, code: failed.code }, { ok: false, status: 500, code: "DELETE_INCOMPLETE" });
    w.server.state.offline = true;
    const offline = await api(w).deleteAccount();
    assert.deepEqual({ status: offline.status, code: offline.code }, { status: 0, code: "NETWORK" });
  });

  await test("gateway: both calls wait 155 seconds before they give up, longer than the functions themselves run", async (w) => {
    const { EXPORT_DATA_TIMEOUT_MS, DELETE_ACCOUNT_TIMEOUT_MS } = w.use("@/constants/app");
    assert.equal(EXPORT_DATA_TIMEOUT_MS, 155_000);
    assert.equal(DELETE_ACCOUNT_TIMEOUT_MS, 155_000);
    for (const [name, call, timeout] of [
      ["export-data", () => api(w).exportData(), EXPORT_DATA_TIMEOUT_MS],
      ["delete-account", () => api(w).deleteAccount(), DELETE_ACCOUNT_TIMEOUT_MS],
    ]) {
      w.server.state.functions[name].push(() => new Promise(() => undefined));
      let settled = null;
      const pending = call().then((r) => (settled = r));
      await advance(timeout - 1000);
      assert.equal(settled, null, `${name} gave up before its timeout`);
      await advance(1500);
      const result = await pending;
      assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 0, code: "NETWORK" }, name);
    }
  });
}

// ================================================================== the export
async function exportChecks() {
  await test("export: the real source answers the link, whether it is partial and whether it was reused; a failure is the calm line", async (w) => {
    w.server.state.functions["export-data"].push(() =>
      json(200, { url: "https://abcdefghij.supabase.co/x?token=t", expiresAt: "2026-10-25T13:00:00.000Z", partial: true, reused: true, sizeBytes: 9 })
    );
    const result = await account(w).requestDataExport();
    assert.deepEqual(result, {
      ok: true,
      data: { url: "https://abcdefghij.supabase.co/x?token=t", expiresAt: "2026-10-25T13:00:00.000Z", partial: true, reused: true },
    });
    w.server.state.functions["export-data"].push(() => fnError(500, "INTERNAL"));
    assert.deepEqual(await account(w).requestDataExport(), { ok: false, code: "UNKNOWN", message: copyOf(w).profile.errors.export });
    w.server.state.offline = true;
    assert.equal((await account(w).requestDataExport()).code, "NETWORK");
  });

  await test("export: the mock source answers a placeholder link after its wait, honours 'Fail next save (dev)' and sends nothing", async (w) => {
    dev(w).setDataSource("mock");
    const result = await finish(account(w).requestDataExport());
    assert.equal(result.ok, true);
    assert.ok(result.data.url.startsWith("https://"));
    assert.deepEqual([result.data.partial, result.data.reused], [false, false]);
    dev(w).setNextPrayerMutationFails(true);
    assert.deepEqual(await finish(account(w).requestDataExport()), { ok: false, code: "NETWORK", message: copyOf(w).profile.errors.export });
    assert.equal(calls(w, "export-data").length, 0);
  });
}

// ================================================================== the deletion
async function deleteChecks() {
  await test("delete: the engine, the plan watch and the profile sync stop before the request leaves; then everything is cleared", async (w) => {
    await w.startEngine();
    assert.equal(engine(w).isSyncEngineStarted(), true);
    const seen = {};
    w.server.state.functions["delete-account"].push(async (call) => {
      w.services.order.push("delete-account");
      seen.engine = engine(w).isSyncEngineStarted();
      // A sync asked for while the server deletes (a foreground, a reminder edit) sends nothing: it would make the profile again.
      seen.sync = await profileSync(w).syncProfile();
      seen.profileRequests = profileRequests(w);
      seen.body = call.body;
      return json(200, { deleted: true });
    });
    const result = await account(w).deleteAccount();
    assert.deepEqual(result, { ok: true, data: null });
    assert.equal(seen.engine, false, "the sync engine was still running when the request left");
    assert.equal(seen.sync.ok, false);
    assert.equal(seen.profileRequests, 0, "the profile sync sent a request during the deletion");
    assert.deepEqual(w.services.order.slice(0, 2), ["stop plan watch", "delete-account"]);
    // Then the cleanup of a sign-out, and the account's settings kept on this phone are forgotten.
    assert.equal(dbOpen(w), false);
    assert.deepEqual(
      [w.services.playerStops, w.services.audioDeletes, w.services.notificationClears, w.services.revenueCatLogouts],
      [1, 1, 1, 1],
    );
    assert.equal(prefsOf(w), undefined);
    assert.ok(!w.services.order.some((step) => step.startsWith("start plan watch")), "nothing was started again");
    assert.equal(engine(w).isSyncEngineStarted(), false);
    // The deleted account's profile sync stays paused: its row can never be made again from this phone.
    await profileSync(w).syncProfile();
    assert.equal(profileRequests(w), 0);
  });

  await test("delete: a failure starts the engine and the plan watch again, resumes the profile sync, clears nothing, and says so calmly", async (w) => {
    await w.startEngine();
    w.server.state.functions["delete-account"].push(() => fnError(500, "DELETE_INCOMPLETE"));
    const result = await account(w).deleteAccount();
    assert.deepEqual(result, { ok: false, code: "UNKNOWN", message: copyOf(w).profile.errors.delete });
    await settle();
    assert.equal(engine(w).isSyncEngineStarted(), true);
    assert.deepEqual(w.services.order, ["stop plan watch", "start plan watch for the account"]);
    assert.equal(dbOpen(w), true);
    assert.ok(prefsOf(w), "the account's settings are still on the phone");
    assert.deepEqual([w.services.playerStops, w.services.audioDeletes, w.services.notificationClears], [0, 0, 0]);
    await profileSync(w).syncProfile();
    assert.ok(profileRequests(w) >= 1, "the profile sync works again");
    // No answer at all is a failure too.
    w.server.state.offline = true;
    assert.equal((await account(w).deleteAccount()).code, "NETWORK");
    w.server.state.offline = false;
    assert.equal(engine(w).isSyncEngineStarted(), true);
    assert.equal(dbOpen(w), true);
  });

  await test("delete: UNAUTHORIZED means the account or its session is already gone, so the app clears it and signs out the same way", async (w) => {
    w.server.state.functions["delete-account"].push(() => fnError(401, "UNAUTHORIZED"));
    assert.deepEqual(await account(w).deleteAccount(), { ok: true, data: null });
    assert.equal(dbOpen(w), false);
    assert.equal(prefsOf(w), undefined);
    assert.equal(w.services.notificationClears, 1);
  });

  await test("delete: with no session at all nothing is sent, and the phone is cleared the same way", async (w) => {
    w.use("@/services/supabaseClient").setSupabaseSession(null);
    assert.deepEqual(await account(w).deleteAccount(), { ok: true, data: null });
    assert.equal(calls(w, "delete-account").length, 0);
    assert.equal(w.services.notificationClears, 1);
  });

  await test("delete: the mock source keeps the step 15 mock: it waits, honours 'Fail next save (dev)', and never reaches the server", async (w) => {
    dev(w).setDataSource("mock");
    dev(w).setNextPrayerMutationFails(true);
    assert.deepEqual(await finish(account(w).deleteAccount()), { ok: false, code: "NETWORK", message: copyOf(w).profile.errors.delete });
    assert.equal(dbOpen(w), true, "a failure clears nothing");
    assert.deepEqual(await finish(account(w).deleteAccount()), { ok: true, data: null });
    assert.equal(dbOpen(w), false);
    assert.equal(prefsOf(w), undefined);
    assert.equal(calls(w, "delete-account").length, 0);
  });
}

(async () => {
  await gatewayChecks();
  await exportChecks();
  await deleteChecks();
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
