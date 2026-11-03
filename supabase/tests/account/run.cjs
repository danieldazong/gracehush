// The step 31 checks: exporting the journal and deleting the account, from the app's side. They run the app's real TypeScript (the
// Edge Function gateway, the account service, the sync engine, the profile sync, the offline session and the database) with the
// real supabase-js client against the fake Supabase of step 25 (../journal-data/world.cjs), whose export-data hands back a link
// and whose delete-account deletes the caller only for the exact confirm body, as the real functions do. Plain Node cannot load
// the player, the downloaded audio, the affirmation notifications or RevenueCat, so those are faked with counters, and so is the
// plan watch (its stops and starts are what these checks are about). Apple's sheet (step 35) is faked too, with expo's Expo Go
// check and react-native's Platform. Every check ends by asserting that nothing the database or AGENTS.md would refuse was sent,
// and that the development log holds no link, id, token, Apple code or word.
//
//   node --no-warnings supabase/tests/account/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/account/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const W = require("../journal-data/world.cjs");

const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");

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

// What Apple's sheet answers in these checks: the Apple user id Clerk holds for the account, and a one-time code.
const APPLE_USER = "000123.apple-user.0456";
const APPLE_CODE = "c.apple-one-time-code";

// Ids, tokens, links and words that must never reach the development log.
const FORBIDDEN_IN_LOGS = ["user_a", "user_b", "tokA", "tokB", "token=", "signed", "export.zip", "example.com", "DELETE", APPLE_CODE, APPLE_USER];

function assertQuiet(w) {
  for (const line of w.logs) {
    for (const word of FORBIDDEN_IN_LOGS) {
      assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
    }
  }
}

// What plain Node cannot load, counted. `order` records the plan watch's stops and starts with the requests the server took.
function serviceFakes() {
  const state = {
    order: [],
    playerStops: 0,
    audioDeletes: 0,
    notificationClears: 0,
    revenueCatLogouts: 0,
    // Apple's sheet (step 35): what it was asked, and what it answers.
    expoGo: false,
    appleAvailable: () => true,
    appleAsks: [],
    appleAnswer: () => ({ user: APPLE_USER, authorizationCode: APPLE_CODE, identityToken: "id" }),
  };
  const fakes = {
    expo: { __esModule: true, isRunningInExpoGo: () => state.expoGo },
    "expo-apple-authentication": {
      __esModule: true,
      isAvailableAsync: async () => state.appleAvailable(),
      signInAsync: async (options) => {
        state.appleAsks.push(options);
        return state.appleAnswer();
      },
    },
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
  // react-native's Platform, beside the world's AppState (read when a module uses it, so this is in time).
  w.appState.module.Platform = { OS: options.platform ?? "ios" };
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
const apple = (w) => w.use("@/services/appleReauth");
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
    const result = await api(w).deleteAccount(null);
    assert.deepEqual(result, { ok: true, data: { deleted: true } });
    assert.deepEqual(calls(w, "delete-account")[0].body, { confirm: "DELETE" });
    w.server.state.functions["delete-account"].push(() => fnError(500, "DELETE_INCOMPLETE"));
    const failed = await api(w).deleteAccount(null);
    assert.deepEqual({ ok: failed.ok, status: failed.status, code: failed.code }, { ok: false, status: 500, code: "DELETE_INCOMPLETE" });
    w.server.state.offline = true;
    const offline = await api(w).deleteAccount(null);
    assert.deepEqual({ status: offline.status, code: offline.code }, { status: 0, code: "NETWORK" });
  });

  await test("gateway: an Apple code goes beside the confirm, under its own key, and the gateway remembers nothing of it", async (w) => {
    assert.deepEqual(await api(w).deleteAccount(APPLE_CODE), { ok: true, data: { deleted: true } });
    assert.deepEqual(calls(w, "delete-account")[0].body, { confirm: "DELETE", appleAuthorizationCode: APPLE_CODE });
    assert.ok(!JSON.stringify(api(w).getLastFunctionCall()).includes(APPLE_CODE));
  });

  await test("gateway: both calls wait 155 seconds before they give up, longer than the functions themselves run", async (w) => {
    const { EXPORT_DATA_TIMEOUT_MS, DELETE_ACCOUNT_TIMEOUT_MS } = w.use("@/constants/app");
    assert.equal(EXPORT_DATA_TIMEOUT_MS, 155_000);
    assert.equal(DELETE_ACCOUNT_TIMEOUT_MS, 155_000);
    for (const [name, call, timeout] of [
      ["export-data", () => api(w).exportData(), EXPORT_DATA_TIMEOUT_MS],
      ["delete-account", () => api(w).deleteAccount(null), DELETE_ACCOUNT_TIMEOUT_MS],
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

// ================================================================== Sign in with Apple (step 35)
async function appleChecks() {
  await test("apple: skipped with no Apple id, in Expo Go, on the mock data and when Apple is unavailable, and Apple is asked nothing", async (w) => {
    assert.deepEqual(await apple(w).confirmWithApple(null), { kind: "skipped" });
    w.services.expoGo = true;
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
    w.services.expoGo = false;
    dev(w).setDataSource("mock");
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
    dev(w).setDataSource("supabase");
    w.services.appleAvailable = () => false;
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
    assert.deepEqual(w.services.appleAsks, []);
  });

  await test("apple: skipped on Android, and Apple is asked nothing", async (w) => {
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
    assert.deepEqual(w.services.appleAsks, []);
  }, { platform: "android" });

  await test("apple: it asks with no scopes, and answers the code for the same Apple user", async (w) => {
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "code", code: APPLE_CODE });
    assert.deepEqual(w.services.appleAsks, [{ requestedScopes: [] }]);
  });

  await test("apple: another Apple Account on the phone, or an answer with no code, is skipped: a code is never sent for someone else", async (w) => {
    w.services.appleAnswer = () => ({ user: "000999.someone-else.0111", authorizationCode: APPLE_CODE, identityToken: "id" });
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
    w.services.appleAnswer = () => ({ user: APPLE_USER, authorizationCode: null, identityToken: "id" });
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
    w.services.appleAnswer = () => ({ user: APPLE_USER, authorizationCode: "", identityToken: "id" });
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
  });

  await test("apple: only ERR_REQUEST_CANCELED is a cancel; any other error goes on without a code", async (w) => {
    const coded = (code) => () => {
      throw Object.assign(new Error("Apple's own words"), { code });
    };
    w.services.appleAnswer = coded("ERR_REQUEST_CANCELED");
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "cancelled" });
    for (const code of ["ERR_REQUEST_FAILED", "ERR_REQUEST_NOT_HANDLED", "ERR_REQUEST_UNKNOWN", undefined]) {
      w.services.appleAnswer = coded(code);
      assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" }, String(code));
    }
    w.services.appleAnswer = () => {
      throw "not even an error";
    };
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
    // Asking whether Apple is available failing is not a cancel either.
    w.services.appleAvailable = () => {
      throw Object.assign(new Error("no"), { code: "ERR_REQUEST_FAILED" });
    };
    assert.deepEqual(await apple(w).confirmWithApple(APPLE_USER), { kind: "skipped" });
  });

  await test("delete: the code goes to the server, after the background work has stopped, and the phone is cleared as before", async (w) => {
    await w.startEngine();
    const seen = {};
    w.server.state.functions["delete-account"].push(async (call) => {
      seen.engine = engine(w).isSyncEngineStarted();
      seen.order = [...w.services.order];
      seen.body = call.body;
      return json(200, { deleted: true });
    });
    assert.deepEqual(await account(w).deleteAccount(APPLE_CODE), { ok: true, data: null });
    assert.deepEqual(seen.body, { confirm: "DELETE", appleAuthorizationCode: APPLE_CODE });
    assert.equal(seen.engine, false);
    assert.deepEqual(seen.order, ["stop plan watch"]);
    assert.equal(dbOpen(w), false);
    assert.equal(prefsOf(w), undefined);
  });

  await test("delete: with no code the body is exactly { confirm: \"DELETE\" }, and the fake server deletes on both", async (w) => {
    assert.deepEqual(await account(w).deleteAccount(null), { ok: true, data: null });
    assert.deepEqual(calls(w, "delete-account")[0].body, { confirm: "DELETE" });
    assert.deepEqual(w.server.state.appleCodesSent, [false]);
  });

  await test("delete: called with nothing, as the older callers do, it is the same as null", async (w) => {
    assert.deepEqual(await account(w).deleteAccount(), { ok: true, data: null });
    assert.deepEqual(calls(w, "delete-account")[0].body, { confirm: "DELETE" });
  });

  await test("delete: a failed deletion with a code starts the background work again and clears nothing", async (w) => {
    await w.startEngine();
    w.server.state.functions["delete-account"].push(() => fnError(500, "DELETE_INCOMPLETE"));
    assert.deepEqual(await account(w).deleteAccount(APPLE_CODE), { ok: false, code: "UNKNOWN", message: copyOf(w).profile.errors.delete });
    await settle();
    assert.equal(engine(w).isSyncEngineStarted(), true);
    assert.equal(dbOpen(w), true);
  });

  await test("delete: the mock source takes a code and sends nothing, and account.ts never imports Apple's package", async (w) => {
    dev(w).setDataSource("mock");
    assert.deepEqual(await finish(account(w).deleteAccount(APPLE_CODE)), { ok: true, data: null });
    assert.equal(calls(w, "delete-account").length, 0);
    const source = fs.readFileSync(path.join(REPO, "src", "services", "account.ts"), "utf8");
    assert.ok(!source.includes("expo-apple-authentication"));
    assert.ok(!source.includes("appleReauth"));
  });

  await test("screen: Profile asks Apple before it deletes, a cancel returns with the calm line, and it reads Apple's id from Clerk", async () => {
    const source = fs.readFileSync(path.join(REPO, "src", "screens", "profile", "ProfileScreen.tsx"), "utf8");
    const asked = source.indexOf("await confirmWithApple(appleUserId)");
    const cancel = source.indexOf('apple.kind === "cancelled"', asked);
    const line = source.indexOf("setDialogError(text.errors.deleteAppleCancelled)", cancel);
    const leave = source.indexOf("return;", line);
    const remove = source.indexOf('await deleteAccount(apple.kind === "code" ? apple.code : null)', leave);
    assert.ok(asked >= 0, "the screen asks Apple");
    assert.ok(cancel > asked && line > cancel && leave > line && remove > leave, "ask, then a cancel returns, then delete");
    assert.equal(source.split("await deleteAccount(").length - 1, 1, "there is one way to delete");
    assert.ok(source.includes('account.provider === "apple"'));
    assert.ok(source.includes("?.providerUserId ?? null"));
    assert.ok(source.includes("deleteFinal.bodyApple"));
    assert.ok(/appleUserId !== null/.test(source), "the final dialog says so first, only for an Apple account");
  });

  await test("copy: the two new lines say what happens and where to go, in curly punctuation", async (w) => {
    const { profile } = copyOf(w);
    const body = profile.dialogs.deleteFinal.bodyApple;
    const cancelled = profile.errors.deleteAppleCancelled;
    assert.equal(
      body,
      "Your sanctuary and everything in it will be removed. Apple will ask you to confirm, so Gracehush stops using your Apple sign-in. If it can\u2019t, you can remove Gracehush in Settings, under your name, Sign-In & Security.",
    );
    assert.equal(cancelled, "Nothing was deleted. Apple\u2019s confirmation was cancelled.");
    for (const text of [body, cancelled]) assert.ok(!text.includes("'"), "no straight apostrophe");
  });
}

(async () => {
  await gatewayChecks();
  await exportChecks();
  await deleteChecks();
  await appleChecks();
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
