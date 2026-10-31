// The step 33 checks: Realtime. They run the app's real TypeScript (the Realtime service and its handlers, the realtime store, the
// repository, the read cache, the outbox, the change queue, the sync engine, the account service and the Journal, Reflection and
// Prayers hooks) with the real supabase-js client against the fake Supabase of step 25 (../journal-data/world.cjs). The channel is
// faked on that real client (channel, removeChannel, realtime.setAuth, realtime.disconnect), so a check decides when a join
// succeeds or fails and delivers the messages the database would send. One check runs the real @supabase/realtime-js over a fake
// WebSocket instead, to read the frames it sends. The player store and the downloaded-audio module cannot load in plain Node
// (expo-audio, expo-file-system), so they are faked and counted, as in the step 29b checks. Every check ends by asserting that
// nothing the database or AGENTS.md would refuse was sent, and that the development log holds no id, topic, token or payload.
//
//   node --no-warnings supabase/tests/realtime/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/realtime/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const W = require("../journal-data/world.cjs");

const {
  makeLiveWorld,
  serverRow,
  affirmationRows,
  fnError,
  json,
  stamp,
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
let stopped = false;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const realSetImmediate = setImmediate;
const CHECK_LIMIT_MS = 30000;
const DAY = 86_400_000;

// Ids, topics, tokens and words that must never reach the development log.
const FORBIDDEN_IN_LOGS = [
  "user_a",
  "user_b",
  "user:",
  "tokA",
  "tokB",
  "00000000-0000-4000",
  "c0000000-0000",
  "the words of entry",
  "shepherd",
  "devotional of entry",
  "Headline",
  "updated_at",
  "entry_id",
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

// What plain Node cannot load, faked and counted: the player store (`entryId` is the loaded devotional), the downloaded audio, the
// affirmation notifications (requests to plan them again), RevenueCat and the plan watch (for the account checks).
function serviceFakes({ entryId = null } = {}) {
  const state = { entryId, stops: 0, forgotten: [], reschedules: 0, onReschedule: null, order: [] };
  const fakes = {
    "@/store/playerStore": {
      __esModule: true,
      usePlayerStore: {
        getState: () => ({
          entryId: state.entryId,
          stop: () => {
            state.stops += 1;
            state.entryId = null;
          },
        }),
      },
    },
    "@/services/devotionalAudio": {
      __esModule: true,
      forgetDevotionalFile: (id) => void state.forgotten.push(id),
      deleteAllDevotionalAudio: async () => void state.order.push("devotional audio"),
    },
    "@/services/affirmationScheduler": {
      __esModule: true,
      requestAffirmationReschedule: () => {
        state.reschedules += 1;
        state.onReschedule?.();
      },
      clearAffirmations: async () => void state.order.push("affirmations"),
    },
    "@/services/revenuecat": {
      __esModule: true,
      endRevenueCatSession: async () => void state.order.push("revenuecat"),
    },
    "@/services/subscriptionSync": {
      __esModule: true,
      stopPlanWatch: () => void state.order.push("stop plan watch"),
      startPlanWatch: () => {
        state.order.push("start plan watch");
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
  const services = serviceFakes(options.services);
  const w = makeLiveWorld({ ...options, realtime: "real", fakes: services.fakes });
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
    try {
      await w.use("@/services/realtime").stopRealtime();
    } catch {
      // The module could not be loaded in this world (the red run before step 33).
    }
    w.close();
    uninstallVirtualDate();
    uninstallClock();
    if (process.env.TIMINGS) process.stderr.write(`${Number((process.hrtime.bigint() - startedAt) / 1000000n)} ms  ${name.slice(0, 90)}${String.fromCharCode(10)}`);
  }
}

// ------------------------------------------------------------------ helpers
const idOf = (n) => serverRow(n).id;
const realtime = (w) => w.use("@/services/realtime");
const store = (w) => w.use("@/store/realtimeStore").useRealtimeStore;
const repo = (w) => w.use("@/data/journalRepository");
const cache = (w) => w.use("@/db/cache");
const outbox = (w) => w.use("@/db/outbox");
const queue = (w) => w.use("@/db/mutations");
const engine = (w) => w.use("@/services/syncEngine");
const offline = (w) => w.use("@/store/offlineStore").useOfflineStore;
const dev = (w) => w.use("@/store/devStore").useDevStore.getState();
const entryReads = (w, id) =>
  w.server.state.requests.filter(
    (r) => r.method === "GET" && r.path === "/rest/v1/journal_entries" && (id === undefined || r.search.includes(`id=eq.${id}`)),
  ).length;
const affirmationReads = (w, entryId) =>
  w.server.state.requests.filter(
    (r) => r.method === "GET" && r.path === "/rest/v1/daily_affirmations" && r.search.includes(`entry_id=eq.${entryId}`),
  ).length;
const serverOf = (w, n) => w.server.state.entries.find((row) => row.id === idOf(n));

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
  const { toJournalEntry, toAffirmation } = w.use("@/data/mappers");
  for (const row of w.server.state.entries) {
    await cache(w).upsertEntry(toJournalEntry(withMs(row)));
    if (row.processing_status === "ready" && !row.is_crisis) {
      await cache(w).upsertAffirmations(row.id, affirmationRows(row.id, row.user_id).map(toAffirmation));
    }
  }
}

// The app keeps server times with three digits and a Z (utils/timestamp.ts), as entriesRemote.ts does when it reads a row.
function withMs(row) {
  const canon = (text) => (text === null ? null : new Date(Date.parse(text)).toISOString());
  return { ...row, created_at: canon(row.created_at), updated_at: canon(row.updated_at) };
}

// The channel, faked on the real client: the service's calls are recorded in order, and a check makes the joins succeed or fail
// and delivers the database's messages.
async function fakeChannels(w) {
  const client = w.use("@/services/supabaseClient").getSupabase();
  // supabase-js pushes the first token to Realtime by itself just after the client is made: let it land on the real client.
  await settle();
  const rt = { calls: [], channels: [], authGate: null };
  client.realtime.setAuth = async () => {
    rt.calls.push("setAuth");
    if (rt.authGate !== null) await rt.authGate;
  };
  client.realtime.disconnect = async () => {
    rt.calls.push("disconnect");
    return "ok";
  };
  client.removeChannel = async (channel) => {
    rt.calls.push("removeChannel");
    channel.removed = true;
    return "ok";
  };
  client.channel = (topic, options) => {
    const channel = {
      topic,
      options,
      bindings: [],
      callback: null,
      removed: false,
      on(type, filter, callback) {
        this.bindings.push({ type, event: filter.event, callback });
        return this;
      },
      subscribe(callback) {
        rt.calls.push("subscribe");
        this.callback = callback;
        return this;
      },
      status(name, error) {
        this.callback?.(name, error);
      },
      deliver(event, payload) {
        for (const binding of this.bindings) {
          if (binding.type === "broadcast" && binding.event === event) binding.callback({ type: "broadcast", event, payload });
        }
      },
    };
    rt.calls.push("channel");
    rt.channels.push(channel);
    return channel;
  };
  rt.latest = () => rt.channels[rt.channels.length - 1];
  rt.count = (name) => rt.calls.filter((call) => call === name).length;
  return rt;
}

// Starts Realtime for the signed-in account and makes the join succeed.
async function startLive(w, rt) {
  realtime(w).startRealtime("user_a");
  await settle();
  const channel = rt.latest();
  assert.ok(channel !== undefined, "a channel was made");
  channel.status("SUBSCRIBED");
  await settle();
  assert.equal(store(w).getState().status, "live");
  return channel;
}

// One message as realtime.send delivers it: an entry change, or an affirmation change (with the affirmation's own id).
const entryMessage = (id, op, status, updatedAt) => ({ id, op, status, updated_at: updatedAt });
const affirmationsMessage = (entryId) => ({ id: "aff-00000000-0001", entry_id: entryId });

// Changes a server row as a write on the server would (its updated_at moves to the virtual now), and gives the message.
function touch(w, n, columns, op = "UPDATE") {
  const row = serverOf(w, n);
  Object.assign(row, columns, { updated_at: stamp(clock.now) });
  return entryMessage(row.id, op, row.processing_status, row.updated_at);
}

async function until(read, label, rounds = 100) {
  for (let i = 0; i < rounds; i += 1) {
    if (await read()) return;
    await settle(2);
  }
  assert.fail(`${label}: never became true`);
}

async function untilState(handle, predicate, label, rounds = 100) {
  for (let i = 0; i < rounds; i += 1) {
    if (handle.result.current !== null && predicate(handle.result.current)) return handle.result.current;
    await settle(2);
  }
  assert.fail(`${label}: the state never became what was waited for (last: ${handle.result.current?.status ?? String(handle.result.current)})`);
}

function collect(w) {
  const events = [];
  realtime(w).subscribeRealtime((event) => events.push(event));
  return events;
}

function deletedEvents(w) {
  const events = [];
  engine(w).subscribe((event) => {
    if (event.type === "deleted") events.push(event.entryId);
  });
  return events;
}

// ================================================================== the message contract
async function guardChecks() {
  await test("guards: an entry message and an affirmations message of the contract's shape pass, and anything else is ignored", async (w) => {
    const { readEntryChanged, readAffirmationsChanged } = realtime(w);
    const id = idOf(1);
    assert.deepEqual(readEntryChanged({ id, op: "UPDATE", status: "ready", updated_at: "2026-10-25T11:59:00.123456+00:00" }), {
      id,
      op: "UPDATE",
      status: "ready",
      updated_at: "2026-10-25T11:59:00.123456+00:00",
    });
    assert.deepEqual(
      readEntryChanged({ id, op: "DELETE", status: null, updated_at: null, transcript: "the words of entry 1" }),
      { id, op: "DELETE", status: null, updated_at: null },
      "only the contract's keys are read",
    );
    for (const bad of [
      null,
      "text",
      [id],
      {},
      { id: "not-an-id", op: "UPDATE", status: "ready", updated_at: null },
      { id, op: "TRUNCATE", status: "ready", updated_at: null },
      { id, op: "UPDATE", status: "done", updated_at: null },
      { id, op: "UPDATE", status: "ready", updated_at: 42 },
      { id: 7, op: "UPDATE", status: "ready", updated_at: null },
    ]) {
      assert.equal(readEntryChanged(bad), null, JSON.stringify(bad));
    }
    assert.deepEqual(readAffirmationsChanged({ id: "aff-1", entry_id: id }), { entry_id: id });
    for (const bad of [null, {}, { entry_id: "nope" }, { entry_id: 3 }, [id]]) {
      assert.equal(readAffirmationsChanged(bad), null, JSON.stringify(bad));
    }
  });

  await test("guards: a malformed message reaches no handler: nothing is read or counted, and the log has one line with no payload", async (w) => {
    await seedBoth(w, 1);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const events = collect(w);
    channel.deliver("entry_changed", { id: idOf(1), op: "UPDATE", status: "ready", updated_at: 7 });
    channel.deliver("affirmations_changed", { entry_id: "the words of entry 1" });
    await advance(1_000);
    assert.equal(entryReads(w), 0);
    assert.equal(events.length, 0);
    assert.equal(store(w).getState().events, 0, "only valid messages are counted");
    assert.equal(w.logs.filter((line) => line === "[realtime] realtime_bad_payload").length, 2);
  });
}

// ================================================================== start, stop, retry, resync
async function connectionChecks() {
  await test("start: the token is set before the channel is joined, on one private channel for the account with the two events, and a second start changes nothing", async (w) => {
    const rt = await fakeChannels(w);
    let release;
    rt.authGate = new Promise((resolve) => (release = resolve));
    realtime(w).startRealtime("user_a");
    await settle();
    assert.deepEqual(rt.calls, ["setAuth"], "nothing is joined while the token is being asked for");
    assert.equal(store(w).getState().status, "connecting");
    release();
    await settle();
    assert.deepEqual(rt.calls, ["setAuth", "channel", "subscribe"]);
    const channel = rt.latest();
    assert.equal(channel.topic, "user:user_a");
    assert.deepEqual(channel.options, { config: { private: true } });
    assert.deepEqual(
      channel.bindings.map((binding) => `${binding.type}:${binding.event}`).sort(),
      ["broadcast:affirmations_changed", "broadcast:entry_changed"],
    );
    realtime(w).startRealtime("user_a");
    await settle();
    assert.equal(rt.count("channel"), 1, "a second start changes nothing");
    channel.status("SUBSCRIBED");
    await settle();
    assert.equal(store(w).getState().status, "live");
    assert.equal(realtime(w).isRealtimeLive(), true);
  });

  await test("start: background, offline, the database closed, the mock data and Force polling each stop it, and it starts again when the condition returns", async (w) => {
    const rt = await fakeChannels(w);
    await startLive(w, rt);
    const conditions = [
      ["background", () => w.appState.emit("background"), () => w.appState.emit("active")],
      ["offline", () => offline(w).getState().setNet(false, false), () => offline(w).getState().setNet(true, true)],
      ["database closed", () => offline(w).getState().setDatabase("closed"), () => offline(w).getState().setDatabase("ready")],
      ["mock data", () => dev(w).setDataSource("mock"), () => dev(w).setDataSource("supabase")],
      ["Force polling", () => store(w).getState().setForcePolling(true), () => store(w).getState().setForcePolling(false)],
    ];
    for (const [label, end, resume] of conditions) {
      const channelsBefore = rt.channels.length;
      const removedBefore = rt.count("removeChannel");
      const disconnectsBefore = rt.count("disconnect");
      end();
      await settle();
      assert.equal(store(w).getState().status, "offline", `${label}: offline`);
      assert.equal(realtime(w).isRealtimeLive(), false, `${label}: not live`);
      assert.equal(rt.count("removeChannel"), removedBefore + 1, `${label}: the channel was removed`);
      assert.equal(rt.count("disconnect"), disconnectsBefore + 1, `${label}: the socket was closed`);
      await advance(10_000);
      assert.equal(rt.channels.length, channelsBefore, `${label}: nothing is joined while it lasts`);
      resume();
      await settle();
      assert.equal(rt.channels.length, channelsBefore + 1, `${label}: a new channel once it is over`);
      rt.latest().status("SUBSCRIBED");
      await settle();
      assert.equal(store(w).getState().status, "live", `${label}: live again`);
    }
  });

  await test("retry: a channel error, a timeout and a close it did not ask for retry with the step 24 backoff, and SUBSCRIBED resets it", async (w) => {
    const rt = await fakeChannels(w);
    await startLive(w, rt);
    const failOnce = async (status, reason, waitAtLeast, waitAtMost) => {
      const before = rt.channels.length;
      rt.latest().status(status, new Error("Unauthorized: You do not have permissions to read from this Channel topic: user:user_a"));
      await settle();
      assert.equal(store(w).getState().status, "offline", `${status}: offline while it waits, with its reason`);
      assert.equal(store(w).getState().reason, reason, "a short reason, never the server's words");
      assert.equal(realtime(w).isRealtimeLive(), false);
      assert.equal(rt.latest().removed, true, `${status}: the failed channel is removed`);
      await advance(waitAtLeast - 1);
      assert.equal(rt.channels.length, before, `${status}: not before ${waitAtLeast} ms`);
      await advance(waitAtMost - waitAtLeast + 2);
      assert.equal(rt.channels.length, before + 1, `${status}: again by ${waitAtMost} ms`);
      assert.equal(store(w).getState().status, "connecting", `${status}: connecting again`);
    };
    await failOnce("CHANNEL_ERROR", "unauthorized", 4_000, 6_000);
    await failOnce("TIMED_OUT", "timed_out", 12_000, 18_000);
    await failOnce("CLOSED", "closed", 48_000, 72_000);
    rt.latest().status("SUBSCRIBED");
    await settle();
    assert.equal(store(w).getState().status, "live");
    await failOnce("CHANNEL_ERROR", "unauthorized", 4_000, 6_000);
  });

  await test("token: while the channel is live the token is checked every 5 s, and never while it is stopped, joining or failed", async (w) => {
    // Every read of Clerk's token is counted: a check that is left running reads it even when it pushes nothing.
    let reads = 0;
    await w.signIn({
      getToken: async () => {
        reads += 1;
        return "tokA";
      },
    });
    const rt = await fakeChannels(w);
    await startLive(w, rt);
    assert.equal(rt.count("setAuth"), 1, "once, before the join");
    await advance(4_999);
    assert.equal(rt.count("setAuth"), 1, "not before 5 s");
    await advance(10_002);
    assert.equal(rt.count("setAuth"), 4, "every 5 s while live");
    const unchanged = async (ms, label) => {
      const before = { pushes: rt.count("setAuth"), reads };
      await advance(ms);
      assert.deepEqual({ pushes: rt.count("setAuth"), reads }, before, label);
    };
    w.appState.emit("background");
    await settle();
    await unchanged(30_000, "nothing is read or pushed while stopped");
    w.appState.emit("active");
    await settle();
    assert.equal(rt.count("setAuth"), 5, "once more before the new join");
    await unchanged(30_000, "nothing while the join waits for its answer");
    rt.latest().status("SUBSCRIBED");
    await settle();
    await advance(5_001);
    assert.equal(rt.count("setAuth"), 6, "every 5 s once live again");
    rt.latest().status("CHANNEL_ERROR", new Error("boom"));
    await settle();
    await unchanged(3_999, "nothing after a failure");
    await advance(2_002);
    assert.equal(store(w).getState().status, "connecting", "the retry joins again");
    assert.equal(rt.count("setAuth"), 7, "once more before the retry's join");
    await unchanged(30_000, "the failed channel's checks are gone, and none start before the join succeeds");
  }, { signIn: false });

  await test("token: a token with 15 s or fewer left is renewed by Clerk's server before it is pushed, a failed renewal is tried at the next check, and a fresh token is not renewed", async (w) => {
    // A Clerk token of 60 s, readable by the app (only its exp claim matters here), and a getToken that counts the renewals.
    const jwt = (exp) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
    let exp = Math.floor(clock.now / 1000) + 60;
    let failNext = false;
    const renewals = [];
    await w.signIn({
      getToken: async (options) => {
        if (options?.skipCache) {
          renewals.push({ at: clock.now, pushesBefore: rt.count("setAuth") });
          if (failNext) {
            failNext = false;
            throw new Error("network");
          }
          exp = Math.floor(clock.now / 1000) + 60;
        }
        return jwt(exp);
      },
    });
    const rt = await fakeChannels(w);
    const started = clock.now;
    await startLive(w, rt);
    await advance(40_001);
    assert.equal(renewals.length, 0, "nothing renewed while more than 15 s are left");
    const pushes = rt.count("setAuth");
    await advance(5_000);
    assert.equal(renewals.length, 1, "renewed at the check with 15 s or fewer left");
    assert.ok(renewals[0].at - started >= 45_000 && renewals[0].at - started < 46_000);
    assert.equal(renewals[0].pushesBefore, pushes, "the renewal comes before that check's push");
    assert.equal(rt.count("setAuth"), pushes + 1, "and the renewed token is pushed");
    failNext = true;
    await advance(45_000);
    assert.equal(renewals.length, 2, "the next renewal is due 45 s later");
    assert.equal(store(w).getState().status, "live", "a failed renewal changes nothing else");
    assert.equal(rt.count("setAuth"), pushes + 10, "and the check still pushes");
    await advance(5_000);
    assert.equal(renewals.length, 3, "a failed renewal is tried again at the next check");
    await advance(40_000);
    assert.equal(renewals.length, 3, "a fresh token is not renewed");
  }, { signIn: false });

  await test("resync: a channel that comes back after a drop while the app stayed in front sends resync once; the first join and a return to the front do not", async (w) => {
    const rt = await fakeChannels(w);
    const events = collect(w);
    await startLive(w, rt);
    assert.equal(events.filter((e) => e.type === "resync").length, 0, "not on the first join");
    rt.latest().status("CHANNEL_ERROR", new Error("boom"));
    await advance(6_000);
    rt.latest().status("SUBSCRIBED");
    await settle();
    assert.equal(events.filter((e) => e.type === "resync").length, 1, "after a drop in front");
    assert.equal(store(w).getState().reconnects, 1);
    w.appState.emit("background");
    await settle();
    w.appState.emit("active");
    await settle();
    rt.latest().status("SUBSCRIBED");
    await settle();
    assert.equal(events.filter((e) => e.type === "resync").length, 1, "not after a return to the front: the screens reload then");
    offline(w).getState().setNet(false, false);
    await settle();
    offline(w).getState().setNet(true, true);
    await settle();
    rt.latest().status("SUBSCRIBED");
    await settle();
    assert.equal(events.filter((e) => e.type === "resync").length, 2, "after being offline while in front");
    assert.equal(store(w).getState().reconnects, 2);
  });

  await test("stop: nothing lands after a stop: a read in the air writes nothing and emits nothing, and a late message is ignored", async (w) => {
    await seedBoth(w, 2);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const events = collect(w);
    let release;
    w.server.state.gate = new Promise((resolve) => (release = resolve));
    await advance(1_000);
    const message = touch(w, 1, { is_active_prayer: true, prayer_summary: "A short summary" });
    channel.deliver("entry_changed", message);
    await advance(300);
    assert.equal(entryReads(w, idOf(1)), 1, "the read is on its way");
    await realtime(w).stopRealtime();
    assert.equal(store(w).getState().status, "offline");
    release();
    w.server.state.gate = null;
    await settle(20);
    const cached = await cache(w).getEntry(idOf(1));
    assert.equal(cached.prayer, null, "the answer that came after the stop was not written");
    assert.equal(events.length, 0, "nor told to the screens");
    channel.deliver("entry_changed", touch(w, 2, { is_active_prayer: true }));
    await advance(1_000);
    assert.equal(entryReads(w, idOf(2)), 0, "a message to the old channel is ignored");
  });

  await test("account: sign-out stops Realtime before anything else, and an account deletion stops it before its request and starts it again when it fails", async (w) => {
    const rt = await fakeChannels(w);
    await startLive(w, rt);
    const order = [];
    const client = w.use("@/services/supabaseClient").getSupabase();
    const disconnect = client.realtime.disconnect;
    client.realtime.disconnect = async () => {
      order.push("realtime closed");
      return disconnect();
    };
    w.server.state.functions["delete-account"].push(() => {
      order.push("delete-account asked");
      return fnError(500, "DELETE_INCOMPLETE");
    });
    const failed = await w.use("@/services/account").deleteAccount();
    assert.equal(failed.ok, false);
    assert.ok(order.indexOf("realtime closed") >= 0 && order.indexOf("realtime closed") < order.indexOf("delete-account asked"), order.join(" > "));
    await settle();
    rt.latest().status("SUBSCRIBED");
    await settle();
    assert.equal(store(w).getState().status, "live", "started again after the failed deletion");
    order.length = 0;
    const database = w.use("@/db/database");
    const deleteDb = database.deleteUserDatabase;
    database.deleteUserDatabase = async (id) => {
      order.push("database deleted");
      return deleteDb(id);
    };
    await w.use("@/services/account").signOutCleanup();
    assert.equal(order[0], "realtime closed", order.join(" > "));
    assert.ok(order.indexOf("database deleted") > 0, order.join(" > "));
    assert.equal(store(w).getState().status, "offline");
  });
}

// ================================================================== the handlers
async function handlerChecks() {
  await test("handler: a message that is not newer than the cached entry reads nothing, whatever offset the server wrote", async (w) => {
    await seedBoth(w, 1);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const row = serverOf(w, 1);
    const cachedAt = Date.parse(row.updated_at);
    const offset = (ms, sign) => {
      const shifted = new Date(ms + (sign === "+" ? 3_600_000 : -3_600_000)).toISOString().replace("Z", "").replace(/\.(\d{3})$/, ".$1456");
      return `${shifted}${sign}01:00`;
    };
    for (const updatedAt of [row.updated_at, stamp(cachedAt - 60_000), offset(cachedAt, "+"), offset(cachedAt - 5_000, "-")]) {
      channel.deliver("entry_changed", entryMessage(row.id, "UPDATE", "ready", updatedAt));
    }
    await advance(2_000);
    assert.equal(entryReads(w, row.id), 0);
    channel.deliver("entry_changed", entryMessage(row.id, "UPDATE", "ready", stamp(cachedAt + 1_000)));
    await advance(2_000);
    assert.equal(entryReads(w, row.id), 1, "a newer one is read");
  });

  await test("handler: three quick messages for one entry are read once, 300 ms after the last", async (w) => {
    await seedBoth(w, 1);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const events = collect(w);
    for (let i = 0; i < 3; i += 1) {
      await advance(100);
      channel.deliver("entry_changed", touch(w, 1, { is_active_prayer: i % 2 === 0 }));
    }
    await advance(299);
    assert.equal(entryReads(w, idOf(1)), 0, "not before 300 ms of quiet");
    await advance(2);
    await settle(10);
    assert.equal(entryReads(w, idOf(1)), 1);
    await advance(2_000);
    assert.equal(entryReads(w, idOf(1)), 1, "once");
    assert.deepEqual(events, [{ type: "entry", entryId: idOf(1), op: "UPDATE" }]);
    assert.equal(store(w).getState().events, 3, "every message is counted");
  });

  await test("handler: a message that arrives during a read is read once more when the read brought an older version", async (w) => {
    await seedBoth(w, 1);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    await advance(1_000);
    const first = touch(w, 1, { is_active_prayer: true, prayer_summary: "A short summary" });
    const older = { ...serverOf(w, 1) };
    let release;
    w.server.state.rest.journal_entries.push(
      () => new Promise((resolve) => (release = () => resolve(json(200, [older])))),
    );
    channel.deliver("entry_changed", first);
    await advance(300);
    assert.equal(entryReads(w, idOf(1)), 1, "the first read is on its way");
    await advance(1_000);
    const second = touch(w, 1, { is_answered: true, answered_at: "2026-10-25T12:00:00+00:00" });
    channel.deliver("entry_changed", second);
    await advance(300);
    assert.equal(entryReads(w, idOf(1)), 1, "one read at a time");
    release();
    await advance(1_000);
    assert.equal(entryReads(w, idOf(1)), 2, "one more after it, because it brought the older version");
    assert.equal((await cache(w).getEntry(idOf(1))).prayer.isAnswered, true);
  });

  await test("handler: a read keeps this phone's waiting prayer change on top", async (w) => {
    await seedBoth(w, 1);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const { trackPatch } = w.use("@/data/prayerPatches");
    await queue(w).enqueuePatch(idOf(1), trackPatch(true));
    await advance(1_000);
    channel.deliver("entry_changed", touch(w, 1, { dominant_emotion: "weary" }));
    await advance(1_000);
    const cached = await cache(w).getEntry(idOf(1));
    assert.equal(cached.dominantEmotion, "weary", "the server's change is on the phone");
    assert.notEqual(cached.prayer, null, "and the change still waiting to be sent is on top of it");
  });

  await test("handler: a DELETE of an entry the phone holds forgets it once, its player and file with it; a second one, or one for an entry the phone never had, does nothing", async (w) => {
    await seedBoth(w, 2);
    w.services.entryId = idOf(1);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const deleted = deletedEvents(w);
    const { trackPatch } = w.use("@/data/prayerPatches");
    await queue(w).enqueuePatch(idOf(1), trackPatch(true));
    w.server.state.entries = w.server.state.entries.filter((row) => row.id !== idOf(1));
    channel.deliver("entry_changed", entryMessage(idOf(1), "DELETE", "ready", stamp(clock.now)));
    await advance(1_000);
    assert.equal(await cache(w).getEntry(idOf(1)), null, "the cached entry went");
    assert.equal(await queue(w).getMutation(idOf(1)), null, "with the change that waited for it");
    assert.deepEqual(deleted, [idOf(1)], "the lists were told");
    assert.equal(w.services.stops, 1, "the loaded devotional stopped");
    assert.deepEqual(w.services.forgotten, [idOf(1)], "its downloaded file went");
    assert.ok(w.services.reschedules >= 1, "the notifications are planned again");
    const reschedules = w.services.reschedules;
    channel.deliver("entry_changed", entryMessage(idOf(1), "DELETE", "ready", stamp(clock.now)));
    channel.deliver("entry_changed", entryMessage("00000000-0000-4000-8000-000000000777", "DELETE", "ready", stamp(clock.now)));
    await advance(1_000);
    assert.deepEqual(deleted, [idOf(1)], "a second delete, and one the phone never had, do nothing");
    assert.equal(w.services.stops, 1);
    assert.equal(w.services.reschedules, reschedules);
    assert.equal(entryReads(w), 0, "a delete is never read");
  });

  await test("handler: an entry the server no longer has is handled as a delete", async (w) => {
    await seedBoth(w, 2);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const deleted = deletedEvents(w);
    const message = touch(w, 2, { is_active_prayer: true });
    w.server.state.entries = w.server.state.entries.filter((row) => row.id !== idOf(2));
    channel.deliver("entry_changed", message);
    await advance(1_000);
    assert.equal(entryReads(w, idOf(2)), 1);
    assert.equal(await cache(w).getEntry(idOf(2)), null);
    assert.deepEqual(deleted, [idOf(2)]);
    assert.deepEqual(w.services.forgotten, [idOf(2)]);
  });

  await test("handler: a newly finished reflection reads its affirmations before the notifications are planned again; a crisis entry plans them without reading any; a change to a finished one does neither", async (w) => {
    seedServer(w, 1, () => ({ processing_status: "processing", devotional_title: null, devotional_script: null }));
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const seen = [];
    w.services.onReschedule = () => seen.push(affirmationReads(w, idOf(1)));
    channel.deliver("entry_changed", entryMessage(idOf(1), "INSERT", "processing", serverOf(w, 1).updated_at));
    await advance(1_000);
    assert.deepEqual(seen, [], "an entry still being prepared plans nothing");
    await advance(1_000);
    const ready = touch(w, 1, { processing_status: "ready", devotional_title: "Title 1", devotional_script: "The devotional of entry 1." });
    w.server.state.affirmations.push(...affirmationRows(idOf(1)));
    channel.deliver("entry_changed", ready);
    await advance(1_000);
    assert.deepEqual(seen, [1], "its affirmations were read before the notifications were planned");
    assert.equal((await cache(w).listAffirmationsForEntry(idOf(1))).length, 3);
    channel.deliver("entry_changed", touch(w, 1, { is_active_prayer: true }));
    await advance(1_000);
    assert.equal(affirmationReads(w, idOf(1)), 1, "a change to a finished reflection reads no affirmations");
    assert.deepEqual(seen, [1], "and plans nothing");
    const crisis = serverRow(9, { processing_status: "ready", is_crisis: true, devotional_title: null, devotional_script: null, closing_prayer: null, scripture_reference: null, scripture_text: null, scripture_verified: false, dominant_emotion: null, created_at: stamp(clock.now), updated_at: stamp(clock.now) });
    w.server.state.entries.push(crisis);
    channel.deliver("entry_changed", entryMessage(crisis.id, "INSERT", "ready", crisis.updated_at));
    await advance(1_000);
    assert.equal(affirmationReads(w, crisis.id), 0, "a crisis entry has no affirmations to read");
    assert.equal(seen.length, 2, "and the notifications are planned again");
  });

  await test("handler: an entry the sync engine is sending is not read", async (w) => {
    const { toJournalEntry } = w.use("@/data/mappers");
    seedServer(w, 1, () => ({ processing_status: "processing", client_entry_id: "c0000000-0000-4000-8000-000000000001" }));
    await cache(w).upsertEntry(toJournalEntry(withMs(serverOf(w, 1))));
    await outbox(w).enqueue({ clientEntryId: "c0000000-0000-4000-8000-000000000001", inputType: "text", text: "the words of entry 1" });
    assert.equal(await outbox(w).markSending("c0000000-0000-4000-8000-000000000001", clock.now), true);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    await advance(1_000);
    channel.deliver("entry_changed", touch(w, 1, { processing_status: "ready" }));
    await advance(1_000);
    assert.equal(entryReads(w, idOf(1)), 0, "the engine writes the server's answer itself");
  });

  await test("handler: a queued reflection this phone gave up waiting for is made due and the engine woken when its entry finishes", async (w) => {
    const clientId = "c0000000-0000-4000-8000-000000000001";
    await outbox(w).enqueue({ clientEntryId: clientId, inputType: "text", text: "the words of entry 1" });
    await outbox(w).markQueued(clientId, clock.now + 3_600_000, "NETWORK", clock.now);
    await w.startEngine();
    assert.equal((await outbox(w).get(clientId)).status, "queued");
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    // The server finished it after this phone stopped waiting. Sent again, it finds the entry it already has by its client entry id
    // and answers it with no model call.
    const made = W.readyResult({ clientEntryId: clientId, inputType: "text", text: "the words of entry 1" });
    w.server.state.entries.push(made.row);
    w.server.state.affirmations.push(...made.affirmations);
    w.server.state.functions["process-entry"].push(() => json(200, made.response));
    channel.deliver("entry_changed", entryMessage(made.row.id, "UPDATE", "ready", made.row.updated_at));
    await advance(2_000);
    assert.equal(await outbox(w).get(clientId), null, "the engine sent it at once and it left the outbox");
    assert.equal(w.server.state.functionCalls.filter((call) => call.name === "process-entry").length, 1);
    assert.ok(w.logs.includes("[sync] run (realtime)"), "the engine was woken by Realtime");
    assert.equal((await cache(w).getEntry(made.row.id)).status, "ready");
  });

  await test("handler: affirmations_changed reads the entry's affirmations once, 300 ms after the last message, and plans the notifications", async (w) => {
    await seedBoth(w, 1);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const events = collect(w);
    const before = affirmationReads(w, idOf(1));
    const target = w.server.state.affirmations.find((row) => row.entry_id === idOf(1) && row.time_slot === "morning");
    target.is_favorite = true;
    for (let i = 0; i < 3; i += 1) {
      channel.deliver("affirmations_changed", affirmationsMessage(idOf(1)));
      await advance(100);
    }
    await advance(150);
    assert.equal(affirmationReads(w, idOf(1)), before, "not before 300 ms of quiet");
    await advance(200);
    assert.equal(affirmationReads(w, idOf(1)), before + 1);
    const cached = await cache(w).listAffirmationsForEntry(idOf(1));
    assert.equal(cached.find((a) => a.slot === "morning").isFavorite, true);
    assert.ok(w.services.reschedules >= 1);
    assert.deepEqual(events, [{ type: "affirmations", entryId: idOf(1) }]);
  });
}

// ================================================================== the screens
async function screenChecks() {
  await test("reflection: an event for its entry is read from the phone; it polls only while Realtime is not live; a delete shows not-found", async (w) => {
    seedServer(w, 1, () => ({ processing_status: "processing", devotional_title: null, devotional_script: null }));
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const { useReflection } = w.use("@/hooks/useReflection");
    const handle = w.renderHook(useReflection, idOf(1));
    await untilState(handle, (s) => s.status === "ready" && s.entry.status === "processing", "the preparing entry");
    const reads = entryReads(w, idOf(1));
    await advance(12_000);
    assert.equal(entryReads(w, idOf(1)), reads, "no polling while Realtime is live");
    const ready = touch(w, 1, { processing_status: "ready", devotional_title: "Title 1", devotional_script: "The devotional of entry 1." });
    w.server.state.affirmations.push(...affirmationRows(idOf(1)));
    channel.deliver("entry_changed", ready);
    await advance(1_000);
    const state = await untilState(handle, (s) => s.status === "ready" && s.entry.status === "ready", "the finished reflection");
    assert.equal(state.affirmations.length, 3, "its affirmations came with it, from the phone");
    // Realtime goes away: the step 25 polling takes over for an entry still being prepared.
    channel.deliver("entry_changed", touch(w, 1, { processing_status: "processing" }));
    await advance(1_000);
    await untilState(handle, (s) => s.status === "ready" && s.entry.status === "processing", "preparing again");
    store(w).getState().setForcePolling(true);
    await settle();
    const before = entryReads(w, idOf(1));
    await advance(11_000);
    assert.ok(entryReads(w, idOf(1)) >= before + 2, "polling every 5 s while Realtime is not live");
    store(w).getState().setForcePolling(false);
    await settle();
    rt.latest().status("SUBSCRIBED");
    await settle();
    w.server.state.entries = w.server.state.entries.filter((row) => row.id !== idOf(1));
    rt.latest().deliver("entry_changed", entryMessage(idOf(1), "DELETE", "processing", stamp(clock.now)));
    await advance(1_000);
    await untilState(handle, (s) => s.status === "not-found", "the not-found state");
    handle.unmount();
  });

  await test("journal: an inserted entry joins the top and the count, a failed one leaves both, an update replaces it, and the newest reflection's affirmations are read again from the phone", async (w) => {
    seedServer(w, 3);
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const { useJournalHome } = w.use("@/hooks/useJournalHome");
    const handle = w.renderHook(useJournalHome);
    await untilState(handle, (s) => s.status === "ready" && s.entries.length === 3 && s.affirmations.length === 3, "the first page");
    assert.equal(handle.result.current.entryCount, 3);
    await advance(1_000);
    const fresh = serverRow(0, { processing_status: "processing", devotional_title: null, devotional_script: null, created_at: stamp(clock.now), updated_at: stamp(clock.now) });
    w.server.state.entries.push(fresh);
    channel.deliver("entry_changed", entryMessage(fresh.id, "INSERT", "processing", fresh.updated_at));
    await advance(1_000);
    let state = await untilState(handle, (s) => s.entries[0]?.id === fresh.id, "the new entry on top");
    assert.equal(state.entryCount, 4, "the count is one higher");
    await advance(1_000);
    Object.assign(fresh, { processing_status: "failed", error_code: "AI_UNAVAILABLE", updated_at: stamp(clock.now) });
    channel.deliver("entry_changed", entryMessage(fresh.id, "UPDATE", "failed", fresh.updated_at));
    await advance(1_000);
    state = await untilState(handle, (s) => !s.entries.some((e) => e.id === fresh.id), "the failed entry leaves the list");
    assert.equal(state.entryCount, 3, "and the count is as before");
    await advance(1_000);
    channel.deliver("entry_changed", touch(w, 2, { is_active_prayer: true, prayer_summary: "A short summary" }));
    await advance(1_000);
    state = await untilState(handle, (s) => s.entries.find((e) => e.id === idOf(2))?.prayer !== null, "the updated entry");
    assert.equal(state.entryCount, 3);
    w.server.state.affirmations.find((row) => row.entry_id === idOf(1) && row.time_slot === "evening").is_favorite = true;
    channel.deliver("affirmations_changed", affirmationsMessage(idOf(1)));
    await advance(1_000);
    await untilState(handle, (s) => s.affirmations.find((a) => a.slot === "evening")?.isFavorite === true, "the newest reflection's affirmations");
    handle.unmount();
  });

  await test("journal: the chip shows the server's run when it answers, and the phone's count with the mock data or before any answer", async (w) => {
    // Seven days in a row; the Journal holds only five of them (a page of 5).
    dev(w).setPageSize(5);
    seedServer(w, 7, (n) => ({ created_at: stamp(BASE - (n - 1) * DAY), updated_at: stamp(BASE - (n - 1) * DAY) }));
    w.server.state.streak.push(() => fnError(500, "INTERNAL"));
    const { useJournalHome } = w.use("@/hooks/useJournalHome");
    const handle = w.renderHook(useJournalHome);
    let state = await untilState(handle, (s) => s.status === "ready" && s.entries.length === 5, "the first page");
    await settle(10);
    assert.equal(handle.result.current.reflectionDays, 5, "the phone's count while the server has not answered");
    await handle.result.current.refresh();
    state = await untilState(handle, (s) => s.reflectionDays === 7, "the server's run");
    assert.equal(w.server.state.streakCalls.at(-1).body.tz, w.use("@/data/mappers").getDeviceTimezone(), "asked in the profile's zone");
    w.server.state.streak.push(() => fnError(500, "INTERNAL"));
    await handle.result.current.refresh();
    await settle(10);
    assert.equal(handle.result.current.reflectionDays, 7, "a failed call keeps the number from earlier the same day");
    dev(w).setDataSource("mock");
    // The mock data waits a moment before it answers (a virtual timer).
    await advance(5_000);
    state = await untilState(handle, (s) => s.status === "ready", "the mock data");
    const { getReflectionDays } = w.use("@/data/selectors");
    assert.equal(state.reflectionDays, getReflectionDays(state.entries, state.now), "the mock data has no server run");
    handle.unmount();
  });

  await test("prayers: an entry event reads the list again from the phone", async (w) => {
    await seedBoth(w, 2, (n) => (n === 2 ? { is_active_prayer: true, prayer_summary: "A short summary" } : {}));
    const rt = await fakeChannels(w);
    const channel = await startLive(w, rt);
    const { usePrayers } = w.use("@/hooks/usePrayers");
    const handle = w.renderHook(usePrayers);
    await untilState(handle, (s) => s.status === "ready" && s.active.length === 1, "one prayer");
    await advance(1_000);
    channel.deliver("entry_changed", touch(w, 1, { is_active_prayer: true, prayer_summary: "A short summary" }));
    await advance(1_000);
    await untilState(handle, (s) => s.status === "ready" && s.active.length === 2, "the other phone's new prayer");
    handle.unmount();
  });

  await test("resync: Journal, Reflection and Prayers load again from the server", async (w) => {
    await seedBoth(w, 2, (n) => (n === 2 ? { is_active_prayer: true, prayer_summary: "A short summary" } : {}));
    const rt = await fakeChannels(w);
    await startLive(w, rt);
    const journal = w.renderHook(w.use("@/hooks/useJournalHome").useJournalHome);
    const reflection = w.renderHook(w.use("@/hooks/useReflection").useReflection, idOf(1));
    const prayers = w.renderHook(w.use("@/hooks/usePrayers").usePrayers);
    await untilState(journal, (s) => s.status === "ready" && s.entries.length === 2, "Journal");
    await untilState(reflection, (s) => s.status === "ready", "Reflection");
    await untilState(prayers, (s) => s.status === "ready", "Prayers");
    await settle(10);
    const pages = () => w.server.state.requests.filter((r) => r.method === "GET" && r.path === "/rest/v1/journal_entries" && r.search.includes("order=created_at")).length;
    const pagesBefore = pages();
    const readsBefore = entryReads(w, idOf(1));
    rt.latest().status("CHANNEL_ERROR", new Error("boom"));
    await advance(6_000);
    rt.latest().status("SUBSCRIBED");
    await advance(1_000);
    assert.ok(pages() >= pagesBefore + 2, "Journal's first page and the prayers list were read again");
    assert.ok(entryReads(w, idOf(1)) > readsBefore, "Reflection read its entry again");
    journal.unmount();
    reflection.unmount();
    prayers.unmount();
  });
}

// ================================================================== the run of reflection days
async function streakChecks() {
  await test("repository: the run is kept for the account and the day; a failed call answers the number kept earlier that day, else null; the mock data answers null", async (w) => {
    seedServer(w, 3, (n) => ({ created_at: stamp(BASE - (n - 1) * DAY), updated_at: stamp(BASE - (n - 1) * DAY) }));
    assert.equal(await repo(w).getReflectionStreak("UTC"), 3);
    w.server.state.streak.push(() => fnError(500, "INTERNAL"));
    assert.equal(await repo(w).getReflectionStreak("UTC"), 3, "kept from earlier the same day");
    w.server.state.offline = true;
    assert.equal(await repo(w).getReflectionStreak("UTC"), 3, "with no answer too");
    clock.now = BASE + DAY;
    assert.equal(await repo(w).getReflectionStreak("UTC"), null, "not on the next day");
    w.server.state.offline = false;
    clock.now = BASE;
    assert.equal(await repo(w).getReflectionStreak("UTC"), 3);
    w.use("@/services/supabaseClient").setSupabaseSession({ userId: "user_b", getToken: async () => "tokB" });
    w.server.state.offline = true;
    assert.equal(await repo(w).getReflectionStreak("UTC"), null, "never another account's number");
    w.server.state.offline = false;
    const calls = w.server.state.streakCalls.length;
    dev(w).setDataSource("mock");
    assert.equal(await repo(w).getReflectionStreak("UTC"), null);
    assert.equal(w.server.state.streakCalls.length, calls, "the mock data asks nobody");
  });
}

// ================================================================== the real @supabase/realtime-js
// A WebSocket that answers what the Realtime server answers: a join and a heartbeat are acknowledged. It keeps every frame sent.
function makeSockets() {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.binaryType = "blob";
      this.sent = [];
      sockets.push(this);
      realSetImmediate(() => {
        this.readyState = 1;
        this.onopen?.({});
      });
    }
    send(data) {
      const frame = JSON.parse(String(data));
      this.sent.push(frame);
      const [joinRef, ref, topic, event] = frame;
      if (event === "phx_join" || event === "heartbeat" || event === "access_token") {
        realSetImmediate(() => this.onmessage?.({ data: JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]) }));
      }
    }
    close(code, reason) {
      this.readyState = 3;
      realSetImmediate(() => this.onclose?.({ code: code ?? 1000, reason: reason ?? "", wasClean: true }));
    }
  }
  FakeSocket.CONNECTING = 0;
  FakeSocket.OPEN = 1;
  FakeSocket.CLOSING = 2;
  FakeSocket.CLOSED = 3;
  return { sockets, FakeSocket };
}

async function libraryChecks() {
  await test("realtime-js: the join for realtime:user:<id> is private and carries the account's token, and a new token reaches the channel within 5 s, before the heartbeat, and only once", async (w) => {
    const { sockets, FakeSocket } = makeSockets();
    const previous = globalThis.WebSocket;
    globalThis.WebSocket = FakeSocket;
    let token = "tokA";
    try {
      await w.signIn({ getToken: async () => token });
      realtime(w).startRealtime("user_a");
      await until(() => store(w).getState().status === "live", "live on the real library");
      assert.equal(sockets.length, 1);
      assert.ok(sockets[0].url.includes("/realtime/v1/websocket"));
      assert.ok(sockets[0].url.includes("vsn=2.0.0"));
      const join = sockets[0].sent.find((frame) => frame[3] === "phx_join");
      assert.ok(join !== undefined, "a join was sent");
      assert.equal(join[2], "realtime:user:user_a");
      assert.equal(join[4].config.private, true);
      assert.equal(join[4].access_token, "tokA");
      assert.equal(join[4].config.presence.enabled, false, "no presence");
      // Clerk hands out its next token 17 s before the old one expires; Realtime's own refresh waits for its heartbeat (25 s).
      token = "tokA2";
      await advance(5_500);
      await settle(10);
      const frames = (event) => sockets[0].sent.filter((frame) => frame[3] === event);
      assert.equal(frames("heartbeat").length, 0, "before Realtime's own heartbeat");
      assert.equal(frames("access_token").length, 1, "the app's check pushed the new token to the channel");
      assert.equal(frames("access_token")[0][4].access_token, "tokA2");
      assert.equal(frames("access_token")[0][2], "realtime:user:user_a");
      await advance(25_000);
      await settle(10);
      assert.ok(frames("heartbeat").length >= 1, "the heartbeat ran meanwhile");
      assert.equal(frames("access_token").length, 1, "an unchanged token is not sent again");
      await realtime(w).stopRealtime();
      assert.equal(store(w).getState().status, "offline");
    } finally {
      globalThis.WebSocket = previous;
    }
  }, { signIn: false });
}

(async () => {
  await guardChecks();
  await connectionChecks();
  await handlerChecks();
  await screenChecks();
  await streakChecks();
  await libraryChecks();
  const total = passed + failures.length;
  if (failures.length > 0) {
    console.error(`\n${passed} checks passed, ${failures.length} FAILED:\n`);
    for (const failure of failures) console.error(` - ${failure}\n`);
    process.exit(1);
  }
  console.log(`${total} checks passed`);
})();
