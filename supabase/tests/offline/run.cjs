// The step 24 checks: the encrypted per-user database, the outbox, the read cache, the failure policy, the sync engine and
// the sign-out cleanup, run against the app's real TypeScript with the fakes of world.cjs (real SQL through Node's SQLite).
//
//   node --no-warnings supabase/tests/offline/run.cjs          (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/offline/run.cjs
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { makeWorld, installClock, uninstallClock, advance, settle, clock } = require("./world.cjs");

let passed = 0;
const failures = [];

// The real timers, taken before any check installs the virtual clock: a check that waits for something that never happens
// (the engine did not run, so nothing ever answers) must fail by name, not leave Node to exit quietly with nothing printed.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const CHECK_LIMIT_MS = 20000;

async function test(name, run) {
  installClock();
  const w = makeWorld();
  let limit;
  try {
    await Promise.race([
      run(w),
      new Promise((_, reject) => {
        limit = realSetTimeout(() => reject(new Error("the check never finished: a promise was never settled")), CHECK_LIMIT_MS);
      }),
    ]);
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 6).join("\n    ")}`);
  } finally {
    realClearTimeout(limit);
    w.close();
    uninstallClock();
  }
}

const sha16 = (id) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
const WORDS = "I am carrying a secret prayer about my sister";
const text = (id, words = WORDS) => ({ clientEntryId: id, inputType: "text", text: words });
const audio = (id) => ({ clientEntryId: id, inputType: "audio", durationMs: 20000, mimeType: "audio/mp4" });

async function openAs(w, userId = "user_a") {
  const database = w.use("@/db/database");
  const db = await database.openUserDatabase(userId);
  return { database, db, outbox: w.use("@/db/outbox"), cache: w.use("@/db/cache") };
}

// The engine, started the way the auth bridge starts it.
async function startEngine(w, userId = "user_a") {
  const session = w.use("@/services/offlineSession");
  await session.startOfflineSession(userId);
  await settle();
  return { session, engine: w.use("@/services/syncEngine") };
}

const row = async (db, id) => db.getFirstAsync("SELECT * FROM outbox WHERE client_entry_id = ?", id);
const count = async (db, table = "outbox") => (await db.getFirstAsync(`SELECT COUNT(*) AS n FROM ${table}`)).n;

// ================================================================== database
async function databaseChecks() {
  await test("the file is named after a hash of the user id, in WAL mode, migrated to version 2, with a key in the keychain", async (w) => {
    const { db } = await openAs(w, "user_secret_id");
    const hash = sha16("user_secret_id");
    assert.deepEqual(w.sqlite.stats.opens, [`gracehush-${hash}.db`]);
    assert.ok(!w.sqlite.files().join(" ").includes("secret"));
    assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 2);
    assert.equal((await db.getFirstAsync("PRAGMA journal_mode")).journal_mode, "wal");
    const tables = (await db.getAllAsync("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name);
    for (const name of ["outbox", "entries_cache", "affirmations_cache"]) assert.ok(tables.includes(name), name);
    assert.ok(w.secure.items.has(`gracehush.dbkey.${hash}`));
    assert.equal(w.secure.options.get(`gracehush.dbkey.${hash}`).keychainAccessible, "when-unlocked-this-device-only");
    assert.ok(!w.logs.some((line) => line.includes("secret")));
  });

  await test("closing and opening again keeps the rows and the version, and opening twice is one connection", async (w) => {
    const { database, outbox } = await openAs(w);
    await outbox.enqueue(text("a"));
    assert.equal(await database.openUserDatabase("user_a"), database.getDb());
    assert.equal(w.sqlite.openCount(), 1);
    await database.closeUserDatabase();
    assert.equal(database.isDatabaseOpen(), false);
    assert.throws(() => database.getDb(), /not open/);
    await database.openUserDatabase("user_a");
    assert.equal((await outbox.get("a")).text, WORDS);
  });

  await test("a database from a newer app is refused and left as it was", async (w) => {
    const { database, db } = await openAs(w);
    await db.execAsync("PRAGMA user_version = 99");
    await database.closeUserDatabase();
    await assert.rejects(() => database.openUserDatabase("user_a"), /newer/);
    assert.equal(database.isDatabaseOpen(), false);
    const raw = w.sqlite.raw(`gracehush-${sha16("user_a")}.db`);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 99);
    raw.close();
  });

  await test("a migration that fails changes nothing", async (w) => {
    const database = w.use("@/db/database");
    const sqlite = w.sqlite.module;
    const db = await sqlite.openDatabaseAsync("scratch.db");
    await assert.rejects(() => database.migrate(db, [["CREATE TABLE ok (a TEXT)", "THIS IS NOT SQL"]]));
    assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 0);
    assert.equal((await db.getAllAsync("SELECT name FROM sqlite_master WHERE name = 'ok'")).length, 0);
    await db.closeAsync();
  });

  await test("a missing key for an existing file starts again with a new key and logs one code", async (w) => {
    const { database, outbox } = await openAs(w);
    await outbox.enqueue(text("a"));
    await database.closeUserDatabase();
    w.secure.items.clear();
    await database.openUserDatabase("user_a");
    assert.equal(await outbox.get("a"), null);
    assert.equal(w.sqlite.stats.deletes.length, 1);
    assert.ok(w.secure.items.has(`gracehush.dbkey.${sha16("user_a")}`));
    assert.ok(w.logs.includes("[db] db_key_reset"));
  });

  await test("a keychain that cannot be read does not delete anything", async (w) => {
    const { database, outbox } = await openAs(w);
    await outbox.enqueue(text("a"));
    await database.closeUserDatabase();
    w.secure.state.failRead = true;
    await assert.rejects(() => database.openUserDatabase("user_a"));
    assert.equal(w.sqlite.stats.deletes.length, 0);
    assert.equal(database.isDatabaseOpen(), false);
    w.secure.state.failRead = false;
    await database.openUserDatabase("user_a");
    assert.equal((await outbox.get("a")).text, WORDS);
  });

  await test("deleting a user's database removes the file, the sidecars and the key, and never throws", async (w) => {
    const { database } = await openAs(w);
    const name = `gracehush-${sha16("user_a")}.db`;
    await database.deleteUserDatabase("user_a");
    assert.equal(database.isDatabaseOpen(), false);
    assert.equal(w.sqlite.exists(name), false);
    assert.ok(!w.sqlite.files().some((file) => file.startsWith(name)));
    assert.equal(w.secure.items.size, 0);
    await database.deleteUserDatabase("user_a");
    await database.deleteUserDatabase("someone_never_seen");
  });

  await test("another user gets their own file and cannot see the first user's rows", async (w) => {
    const { database, outbox } = await openAs(w, "user_a");
    await outbox.enqueue(text("a"));
    await database.openUserDatabase("user_b");
    assert.equal(w.sqlite.openCount(), 1);
    assert.equal(await outbox.get("a"), null);
    assert.equal((await outbox.listPending()).length, 0);
    await database.openUserDatabase("user_a");
    assert.equal((await outbox.get("a")).text, WORDS);
    assert.equal(w.sqlite.files().filter((f) => f.endsWith(".db")).length, 2);
  });

  await test("opens, closes and deletes that overlap run one at a time and end consistent", async (w) => {
    const database = w.use("@/db/database");
    await Promise.all([
      database.openUserDatabase("user_a"),
      database.closeUserDatabase(),
      database.openUserDatabase("user_b"),
      database.deleteUserDatabase("user_a"),
      database.openUserDatabase("user_b"),
    ]);
    assert.equal(database.isDatabaseOpen(), true);
    assert.equal(w.sqlite.openCount(), 1);
    assert.equal(w.sqlite.exists(`gracehush-${sha16("user_a")}.db`), false);
    assert.equal(w.sqlite.exists(`gracehush-${sha16("user_b")}.db`), true);
  });
}

// ================================================================== field encryption
async function cryptoChecks() {
  await test("words are sealed with AES-GCM: a v1 token, never the same twice, and a changed or foreign token opens as nothing", async (w) => {
    const fieldCrypto = w.use("@/db/fieldCrypto");
    await assert.rejects(() => fieldCrypto.encryptText("x"), /not loaded/);
    assert.equal(await fieldCrypto.decryptText("v1.AAAA"), null);
    assert.equal(await fieldCrypto.loadFieldKey("h1", false), false);
    assert.equal(await fieldCrypto.loadFieldKey("h1", true), true);
    const a = await fieldCrypto.encryptText(WORDS);
    const b = await fieldCrypto.encryptText(WORDS);
    assert.ok(a.startsWith("v1.") && a !== b && !a.includes("secret"));
    assert.equal(await fieldCrypto.decryptText(a), WORDS);
    const emoji = "Lord, été ❤ 你好";
    assert.equal(await fieldCrypto.decryptText(await fieldCrypto.encryptText(emoji)), emoji);
    assert.equal(await fieldCrypto.decryptText(await fieldCrypto.encryptText("")), "");
    const tampered = a.slice(0, -4) + (a.endsWith("AAAA") ? "BBBB" : "AAAA");
    assert.equal(await fieldCrypto.decryptText(tampered), null);
    assert.equal(await fieldCrypto.decryptText("not a token"), null);
    // The right payload under another prefix is not one of ours either.
    assert.equal(await fieldCrypto.decryptText("v2." + a.slice(3)), null);
    assert.equal(await fieldCrypto.decryptText("v1.%%%"), null);
    // The same key is loaded again from the keychain, and a token made with it still opens.
    fieldCrypto.unloadFieldKey();
    assert.equal(await fieldCrypto.decryptText(a), null);
    assert.equal(await fieldCrypto.loadFieldKey("h1", false), true);
    assert.equal(await fieldCrypto.decryptText(a), WORDS);
    // Another user's key opens nothing of the first user's.
    await fieldCrypto.loadFieldKey("h2", true);
    assert.equal(await fieldCrypto.decryptText(a), null);
    await fieldCrypto.deleteStoredFieldKey("h1");
    assert.equal(w.secure.items.has("gracehush.dbkey.h1"), false);
  });
}

// ================================================================== outbox
async function outboxChecks() {
  await test("a written reflection is stored sealed, a double tap changes nothing, and a recording keeps no text", async (w) => {
    const { db, outbox } = await openAs(w);
    await outbox.enqueue(text("a"), 1000);
    await outbox.enqueue(text("a", "other words"), 2000);
    assert.equal(await count(db), 1);
    const stored = await row(db, "a");
    assert.ok(stored.text.startsWith("v1.") && !stored.text.includes("secret"));
    assert.equal(stored.status, "queued");
    assert.equal(stored.created_at, 1000);
    assert.equal((await outbox.get("a")).text, WORDS);
    await outbox.enqueue(audio("b"), 3000);
    const item = await outbox.get("b");
    assert.deepEqual([item.inputType, item.text, item.durationMs, item.mimeType], ["audio", null, 20000, "audio/mp4"]);
  });

  await test("nothing the person wrote is readable in the database files", async (w) => {
    const { db, outbox, cache } = await openAs(w);
    await outbox.enqueue(text("a"));
    const entry = { id: "e1", clientEntryId: "a", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", inputType: "text", transcript: WORDS, dominantEmotion: null, status: "ready", isCrisis: false, scripture: null, devotional: null, prayer: null, failureCode: null, isLocalOnly: false };
    await cache.upsertEntry(entry);
    await db.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");
    for (const name of w.sqlite.files()) {
      const bytes = fs.readFileSync(require("node:path").join(w.sqlite.dir, name));
      assert.ok(!bytes.includes("secret prayer"), name);
      assert.ok(!bytes.includes("my sister"), name);
    }
  });

  await test("a refused written reflection goes back in the queue with new words, and nothing else is rewritten", async (w) => {
    const { db, outbox } = await openAs(w);
    await outbox.enqueue(text("t"), 1000);
    await outbox.enqueue(audio("r"), 1000);
    await outbox.markNeedsAction("t", "TOO_SHORT", 1500);
    await outbox.markNeedsAction("r", "NO_SPEECH", 1500);
    await outbox.enqueue(text("t", "a longer prayer now"), 2000);
    const t = await outbox.get("t");
    assert.deepEqual([t.status, t.attempts, t.lastErrorCode, t.text, t.createdAt, t.nextAttemptAt], ["queued", 0, null, "a longer prayer now", 1000, 2000]);
    await outbox.enqueue(audio("r"), 2000);
    assert.equal((await outbox.get("r")).status, "needs_action");
    await outbox.enqueue(text("q"), 1000);
    await outbox.enqueue(text("q", "changed while queued"), 2000);
    assert.equal((await outbox.get("q")).text, WORDS);
    assert.equal(await count(db), 3);
  });

  await test("the oldest due reflection goes first; one that is not due, or not queued, never does", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("c"), 3000);
    await outbox.enqueue(text("a"), 1000);
    await outbox.enqueue(text("b"), 2000);
    assert.equal((await outbox.nextDue(5000)).clientEntryId, "a");
    await outbox.markQueued("a", 9000, "NETWORK", 5000);
    assert.equal((await outbox.nextDue(5000)).clientEntryId, "b");
    assert.equal((await outbox.nextDue(500)), null);
    assert.equal(await outbox.nextAttemptAt(), 2000);
    await outbox.markNeedsAction("b", "NO_SPEECH", 5000);
    await outbox.markPausedAuth(5000);
    assert.equal(await outbox.nextDue(99999), null);
    assert.deepEqual((await outbox.listPending()).map((i) => i.clientEntryId), ["c", "b", "a"]);
  });

  await test("taking a reflection for sending counts the attempt once and only when it is queued", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("a"), 1000);
    assert.equal(await outbox.markSending("a", 2000), true);
    assert.equal(await outbox.markSending("a", 2000), false);
    const item = await outbox.get("a");
    assert.deepEqual([item.status, item.attempts], ["sending", 1]);
    await outbox.resetSending(3000);
    assert.equal((await outbox.get("a")).status, "queued");
    assert.equal(await outbox.markSending("zzz", 2000), false);
  });

  await test("each way a reflection can stop keeps what the next step needs", async (w) => {
    const { outbox } = await openAs(w);
    for (const id of ["a", "b", "c", "d"]) await outbox.enqueue(text(id), 1000);
    await outbox.markLimitReached("a", "srv-1", 99000, 2000);
    await outbox.markNeedsAction("b", "TOO_SHORT", 2000);
    await outbox.markQueued("c", 8000, "NETWORK", 2000);
    const a = await outbox.get("a");
    assert.deepEqual([a.status, a.serverEntryId, a.limitResetsAt, a.lastErrorCode], ["limit_reached", "srv-1", 99000, "LIMIT_REACHED"]);
    assert.equal(await outbox.earliestLimitReset(), 99000);
    assert.equal((await outbox.get("b")).lastErrorCode, "TOO_SHORT");
    assert.equal(await outbox.exists("c"), true);
    assert.equal(await outbox.exists("nope"), false);
    await outbox.markPausedAuth(3000);
    assert.deepEqual((await outbox.listPending()).map((i) => [i.clientEntryId, i.status]).sort(), [["a", "limit_reached"], ["b", "needs_action"], ["c", "paused_auth"], ["d", "paused_auth"]]);
    assert.equal(await outbox.resumePausedAuth(4000), 2);
    assert.equal((await outbox.get("c")).attempts, 0);
    assert.equal(await outbox.resumeLimitReachedDue(98000), 0);
    assert.equal(await outbox.resumeLimitReachedDue(99000), 1);
    assert.equal((await outbox.get("a")).limitResetsAt, null);
    await outbox.markLimitReached("b", null, null, 5000);
    assert.equal(await outbox.resumeLimitReached(6000), 1);
    assert.deepEqual(await outbox.countsByStatus(), { queued: 4 });
  });

  await test("the unsent count leaves out what the free limit holds (the server has it)", async (w) => {
    const { outbox } = await openAs(w);
    for (const id of ["a", "b", "c"]) await outbox.enqueue(text(id));
    await outbox.markLimitReached("a", "srv", null, 1);
    await outbox.markNeedsAction("b", "NO_SPEECH", 1);
    assert.equal(await outbox.countUnsent(), 2);
  });

  await test("an id that looks like SQL is data, and the table constraints hold", async (w) => {
    const { db, outbox } = await openAs(w);
    const evil = "x'); DROP TABLE outbox;--";
    await outbox.enqueue(text(evil, "it's a \"quoted\" prayer; --"));
    assert.equal((await outbox.get(evil)).text, "it's a \"quoted\" prayer; --");
    assert.equal(await count(db), 1);
    await assert.rejects(() => db.runAsync("INSERT INTO outbox (client_entry_id, input_type, text, status, next_attempt_at, created_at, updated_at) VALUES ('x', 'text', 't', 'bogus', 1, 1, 1)"));
    await assert.rejects(() => db.runAsync("INSERT INTO outbox (client_entry_id, input_type, text, duration_ms, status, next_attempt_at, created_at, updated_at) VALUES ('y', 'text', 't', 5, 'queued', 1, 1, 1)"));
    await assert.rejects(() => db.runAsync("INSERT INTO outbox (client_entry_id, input_type, status, next_attempt_at, created_at, updated_at) VALUES ('z', 'audio', 'queued', 1, 1, 1)"));
  });

  await test("words that cannot be opened come back as null, and a damaged cache row is dropped without breaking the list", async (w) => {
    const { db, outbox, cache } = await openAs(w);
    await outbox.enqueue(text("a"));
    await db.runAsync("UPDATE outbox SET text = 'v1.AAAA' WHERE client_entry_id = 'a'");
    assert.equal((await outbox.get("a")).text, null);
    const make = (id, at) => ({ id, clientEntryId: null, createdAt: at, updatedAt: at, inputType: "text", transcript: null, dominantEmotion: null, status: "ready", isCrisis: false, scripture: null, devotional: null, prayer: null, failureCode: null, isLocalOnly: false });
    await cache.upsertEntry(make("e1", "2026-01-01T00:00:00.000Z"));
    await cache.upsertEntry(make("e2", "2026-01-02T00:00:00.000Z"));
    await db.runAsync("UPDATE entries_cache SET row_json = 'v1.garbage' WHERE id = 'e1'");
    assert.deepEqual((await cache.listEntries()).map((e) => e.id), ["e2"]);
    assert.equal(await count(db, "entries_cache"), 1);
    assert.ok(w.logs.includes("[db] cache_row_invalid"));
    const fieldCrypto = w.use("@/db/fieldCrypto");
    await db.runAsync("UPDATE entries_cache SET row_json = ? WHERE id = 'e2'", await fieldCrypto.encryptText('{"id": 5}'));
    assert.equal(await cache.getEntry("e2"), null);
    assert.equal(await count(db, "entries_cache"), 0);
  });
}

// ================================================================== read cache
async function cacheChecks() {
  await test("the cache keeps the newest entries, their affirmations, and nothing that was not stored", async (w) => {
    const { db, cache } = await openAs(w);
    const { entryFor, affirmationsFor } = require("./world.cjs");
    for (let i = 1; i <= 5; i += 1) {
      const entry = entryFor({ clientEntryId: `c${i}`, inputType: "text" }, { id: `e${i}`, createdAt: `2026-01-0${i}T00:00:00.000Z`, updatedAt: `2026-01-0${i}T00:00:00.000Z` });
      await cache.upsertEntry(entry);
      await cache.upsertAffirmations(entry.id, affirmationsFor(entry.id));
    }
    assert.deepEqual((await cache.listEntries(2)).map((e) => e.id), ["e5", "e4"]);
    assert.equal((await cache.getEntryByClientId("c3")).id, "e3");
    assert.equal((await cache.getEntry("missing")), null);
    assert.deepEqual((await cache.listAffirmationsForEntry("e2")).map((a) => a.slot), ["morning", "afternoon", "evening"]);
    await cache.upsertEntry({ ...(await cache.getEntry("e3")), status: "failed" });
    assert.equal(await count(db, "entries_cache"), 5);
    assert.equal((await cache.getEntry("e3")).status, "failed");
    assert.equal(await cache.pruneEntries(2), 3);
    assert.deepEqual((await cache.listEntries()).map((e) => e.id), ["e5", "e4"]);
    assert.equal(await count(db, "affirmations_cache"), 6);
    await cache.removeEntry("e5");
    assert.equal(await count(db, "affirmations_cache"), 3);
    await cache.clearAll();
    assert.equal(await count(db, "entries_cache") + (await count(db, "affirmations_cache")), 0);
  });
}

// ================================================================== policy, stores, pending cards, connectivity
async function pureChecks() {
  await test("every error code has one action, an unknown code is retried, and the delays grow with jitter and minimums", async (w) => {
    const { classify, retryDelayMs, BACKOFF_MS } = w.use("@/services/syncPolicy");
    const expected = { NETWORK: "retry", AI_UNAVAILABLE: "retry", INTERNAL: "retry", RATE_LIMITED: "retry", ALREADY_PROCESSING: "retry", UNKNOWN: "retry", LIMIT_REACHED: "limit", UNAUTHORIZED: "pause_auth", TOO_SHORT: "needs_action", NO_SPEECH: "needs_action", PAYLOAD_TOO_LARGE: "needs_action", INVALID_REQUEST: "needs_action", AUDIO_NOT_FOUND: "needs_action", METHOD_NOT_ALLOWED: "needs_action", UNREADABLE: "needs_action" };
    for (const [code, action] of Object.entries(expected)) assert.equal(classify(code), action, code);
    assert.equal(classify("SOMETHING_NEW"), "retry");
    assert.deepEqual([...BACKOFF_MS], [5000, 15000, 60000, 300000, 900000, 3600000]);
    const mid = () => 0.5;
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 40].map((n) => retryDelayMs("NETWORK", n, mid)), [5000, 15000, 60000, 300000, 900000, 3600000, 3600000, 3600000]);
    assert.equal(retryDelayMs("NETWORK", 0, mid), 5000);
    assert.equal(retryDelayMs("NETWORK", 1, () => 0), 4000);
    assert.equal(retryDelayMs("NETWORK", 1, () => 1), 6000);
    assert.equal(retryDelayMs("RATE_LIMITED", 1, mid), 60000);
    assert.equal(retryDelayMs("RATE_LIMITED", 3, mid), 60000);
    assert.equal(retryDelayMs("RATE_LIMITED", 4, mid), 300000);
    assert.equal(retryDelayMs("ALREADY_PROCESSING", 1, mid), 30000);
    assert.equal(retryDelayMs("ALREADY_PROCESSING", 3, mid), 60000);
  });

  await test("offline facts: unknown counts as online for sending and shows no banner, and a failed request clears with the next network event", async (w) => {
    const store = w.use("@/store/offlineStore");
    const { useOfflineStore, selectIsOnline, selectCanSend } = store;
    const s = (netConnected, netReachable, unreachable = false) => ({ netConnected, netReachable, unreachable });
    assert.equal(selectIsOnline(s(null, null)), null);
    assert.equal(selectCanSend(s(null, null)), true);
    assert.equal(selectIsOnline(s(true, null)), true);
    assert.equal(selectIsOnline(s(true, true)), true);
    assert.equal(selectIsOnline(s(false, null)), false);
    assert.equal(selectIsOnline(s(true, false)), false);
    assert.equal(selectCanSend(s(true, false)), false);
    assert.equal(selectIsOnline(s(true, true, true)), false);
    assert.equal(selectCanSend(s(true, true, true)), true);
    useOfflineStore.getState().setUnreachable(true);
    useOfflineStore.getState().setNet(true, true);
    assert.equal(useOfflineStore.getState().unreachable, false);
    useOfflineStore.getState().setDatabase("failed");
    assert.deepEqual([useOfflineStore.getState().dbReady, useOfflineStore.getState().dbFailed], [false, true]);
    useOfflineStore.getState().setDatabase("ready");
    assert.deepEqual([useOfflineStore.getState().dbReady, useOfflineStore.getState().dbFailed], [true, false]);
  });

  await test("connectivity: one listener, the first answer is kept as unknown, and a failed request marks the network until it answers", async (w) => {
    const connectivity = w.use("@/services/connectivity");
    const { useOfflineStore } = w.use("@/store/offlineStore");
    connectivity.startConnectivity();
    connectivity.startConnectivity();
    assert.equal(w.net.count(), 1);
    assert.deepEqual([useOfflineStore.getState().netConnected, useOfflineStore.getState().netReachable], [null, null]);
    w.net.emit({ isConnected: true, isInternetReachable: false });
    assert.deepEqual([useOfflineStore.getState().netConnected, useOfflineStore.getState().netReachable], [true, false]);
    connectivity.markUnreachable();
    assert.equal(useOfflineStore.getState().unreachable, true);
    connectivity.markReachable();
    assert.equal(useOfflineStore.getState().unreachable, false);
    connectivity.markUnreachable();
    w.net.emit({ isInternetReachable: true });
    assert.equal(useOfflineStore.getState().unreachable, false);
    connectivity.stopConnectivity();
    assert.equal(w.net.count(), 0);
  });

  await test("an outbox item is listed as an entry-shaped card without its words, and a server copy of it never shows twice", async (w) => {
    const { toPendingEntry, mergePending } = w.use("@/data/pendingEntries");
    const item = (id, status, createdAt, extra = {}) => ({ clientEntryId: id, inputType: "text", text: WORDS, durationMs: null, mimeType: null, status, attempts: 0, nextAttemptAt: 0, lastErrorCode: null, serverEntryId: null, limitResetsAt: null, createdAt, ...extra });
    const shown = (s) => toPendingEntry(item("a", s, 1_700_000_000_000));
    assert.deepEqual(["queued", "sending", "needs_action", "limit_reached", "paused_auth"].map((s) => shown(s).status), ["pending", "processing", "failed", "pending", "pending"]);
    const card = shown("queued");
    assert.deepEqual([card.id, card.clientEntryId, card.transcript, card.isLocalOnly, card.isCrisis, card.devotional, card.scripture, card.prayer], ["a", "a", null, true, false, null, null, null]);
    assert.ok(!JSON.stringify(card).includes("secret"));
    assert.equal(toPendingEntry(item("b", "limit_reached", 1_700_000_000_000, { limitResetsAt: Date.UTC(2026, 9, 26) })).pending.resetsAt, "2026-10-26T00:00:00.000Z");
    const server = (id, clientEntryId, at) => ({ id, clientEntryId, createdAt: new Date(at).toISOString() });
    const merged = mergePending([server("s1", null, 1000), server("s2", "a", 3000), server("s3", "z", 2000)], [toPendingEntry(item("a", "queued", 4000)), toPendingEntry(item("b", "queued", 500))]);
    assert.deepEqual(merged.map((e) => e.id), ["a", "s3", "s1", "b"]);
  });
}

// ================================================================== sync engine
async function engineChecks() {
  await test("reflections are prepared one at a time, oldest first, and a prepared one is cached, dequeued and its recording deleted, in that order", async (w) => {
    const { outbox, cache, db } = await openAs(w);
    const order = [];
    const spy = (target, name, label) => {
      const original = target[name];
      target[name] = async (...args) => {
        order.push(label);
        return original(...args);
      };
    };
    spy(cache, "upsertEntry", "cache");
    spy(cache, "upsertAffirmations", "affirmations");
    spy(outbox, "remove", "remove");
    spy(w.recordings.module, "deleteRecording", "recording");
    await outbox.enqueue(audio("a"), 1000);
    await outbox.enqueue(text("b"), 2000);
    await outbox.enqueue(audio("c"), 3000);
    for (const id of ["a", "c"]) w.recordings.files.set(id, clock.now);
    await startEngine(w);
    assert.deepEqual(w.processor.calls.map((c) => c.id), ["a", "b", "c"]);
    assert.equal(w.processor.maxConcurrent, 1);
    assert.equal(await count(db), 0);
    assert.equal(w.recordings.files.size, 0);
    assert.deepEqual(order.slice(0, 4), ["cache", "affirmations", "remove", "recording"]);
    assert.deepEqual((await cache.listEntries()).map((e) => e.id).sort(), ["entry-a", "entry-b", "entry-c"]);
    assert.equal((await cache.listAffirmationsForEntry("entry-b")).length, 3);
  });

  await test("a mock processor's entries are not written to the cache", async (w) => {
    const { outbox, cache, db } = await openAs(w);
    w.processor.isMock = true;
    await outbox.enqueue(text("a"));
    await startEngine(w);
    assert.equal(w.processor.calls.length, 1);
    assert.equal(await count(db), 0);
    assert.equal((await cache.listEntries()).length, 0);
  });

  await test("a failed call is tried again at about 5 s, then 15 s, then success, and never while the app is in the background", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("a"));
    w.processor.script = [{ ok: false, code: "NETWORK" }, { ok: false, code: "NETWORK" }];
    const t0 = clock.now;
    const { engine } = await startEngine(w);
    let item = await outbox.get("a");
    assert.deepEqual([item.status, item.attempts, item.lastErrorCode], ["queued", 1, "NETWORK"]);
    assert.ok(item.nextAttemptAt >= t0 + 4000 && item.nextAttemptAt <= t0 + 6000, String(item.nextAttemptAt - t0));
    await advance(3000);
    assert.equal(w.processor.calls.length, 1);
    await advance(3200);
    assert.equal(w.processor.calls.length, 2);
    item = await outbox.get("a");
    assert.equal(item.attempts, 2);
    const t2 = w.processor.calls[1].at;
    assert.ok(item.nextAttemptAt >= t2 + 12000 - 1 && item.nextAttemptAt <= t2 + 18000 + 1, String(item.nextAttemptAt - t2));
    w.appState.emit("background");
    await engine.syncNow("manual");
    await advance(120000);
    assert.equal(w.processor.calls.length, 2);
    w.appState.emit("active");
    await settle();
    assert.equal(w.processor.calls.length, 3);
    assert.equal(await outbox.get("a"), null);
  });

  await test("a busy server and a rate limit wait at least 30 and 60 seconds", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("a"), 1000);
    await outbox.enqueue(text("b"), 2000);
    w.processor.script = [{ ok: false, code: "ALREADY_PROCESSING" }, { ok: false, code: "RATE_LIMITED" }];
    const t0 = clock.now;
    await startEngine(w);
    assert.ok((await outbox.get("a")).nextAttemptAt >= t0 + 24000);
    assert.ok((await outbox.get("b")).nextAttemptAt >= t0 + 48000);
  });

  await test("the free limit holds a reflection until the plan is paid or the week ends, and never retries it by itself", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("a"));
    const resets = new Date(clock.now + 3_600_000).toISOString();
    w.processor.script = [{ ok: false, code: "LIMIT_REACHED", entryId: "srv-1", resetsAt: resets }];
    const { engine } = await startEngine(w);
    let item = await outbox.get("a");
    assert.deepEqual([item.status, item.serverEntryId, item.limitResetsAt], ["limit_reached", "srv-1", Date.parse(resets)]);
    await advance(1_800_000);
    assert.equal(w.processor.calls.length, 1);
    await engine.resumeAfterUpgrade();
    await settle();
    assert.equal((await outbox.get("a")).status, "limit_reached");
    w.world.tier = "pro";
    await engine.resumeAfterUpgrade();
    await settle();
    assert.equal(w.processor.calls.length, 2);
    assert.equal(await outbox.get("a"), null);
  });

  await test("a held reflection goes again when its week resets, by the timer", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("a"));
    w.processor.script = [{ ok: false, code: "LIMIT_REACHED", resetsAt: new Date(clock.now + 3_600_000).toISOString() }];
    await startEngine(w);
    await advance(3_599_000);
    assert.equal(w.processor.calls.length, 1);
    await advance(3000);
    await settle();
    assert.equal(w.processor.calls.length, 2);
    assert.equal(await outbox.get("a"), null);
  });

  await test("a refused session pauses everything without sending the rest, and the next visit asks again once", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("a"), 1000);
    await outbox.enqueue(text("b"), 2000);
    w.processor.script = [{ ok: false, code: "UNAUTHORIZED" }];
    await startEngine(w);
    assert.deepEqual(w.processor.calls.map((c) => c.id), ["a"]);
    assert.deepEqual((await outbox.listPending()).map((i) => i.status), ["paused_auth", "paused_auth"]);
    await advance(3_600_000);
    assert.equal(w.processor.calls.length, 1);
    w.appState.emit("background");
    w.appState.emit("active");
    await settle();
    assert.deepEqual(w.processor.calls.map((c) => c.id), ["a", "a", "b"]);
    assert.equal(await count((await openAs(w)).db), 0);
  });

  await test("a refusal only the person can fix is never retried, tells the waiting screen, and a rewritten one is sent again", async (w) => {
    const { outbox } = await openAs(w);
    const { engine } = await startEngine(w);
    await outbox.enqueue(text("a", "hi"));
    w.processor.script = [{ ok: false, code: "TOO_SHORT" }];
    const result = await engine.syncAndWait("a");
    assert.deepEqual(result, { kind: "needs_action", code: "TOO_SHORT" });
    await advance(3_600_000);
    assert.equal(w.processor.calls.length, 1);
    await outbox.enqueue(text("a", "a longer prayer for you"));
    const again = await engine.syncAndWait("a");
    assert.equal(again.kind, "ready");
    assert.equal(w.processor.calls.length, 2);
    assert.equal(await outbox.get("a"), null);
  });

  await test("nothing is sent while the phone is offline, and the first answer of NetInfo (unknown) does not stop it", async (w) => {
    const { outbox } = await openAs(w);
    const connectivity = w.use("@/services/connectivity");
    connectivity.startConnectivity();
    w.net.emit({ isConnected: false, isInternetReachable: false });
    await outbox.enqueue(text("a"));
    const { engine } = await startEngine(w);
    await engine.syncNow("manual");
    await advance(60000);
    assert.equal(w.processor.calls.length, 0);
    w.net.emit({ isConnected: true, isInternetReachable: true });
    await settle();
    assert.equal(w.processor.calls.length, 1);
  });

  await test("a reflection left in 'sending' by a closed app is queued again and sent once, with the same id", async (w) => {
    const { outbox, db } = await openAs(w);
    await outbox.enqueue(text("a"));
    await db.runAsync("UPDATE outbox SET status = 'sending', attempts = 1 WHERE client_entry_id = 'a'");
    await startEngine(w);
    assert.deepEqual(w.processor.calls.map((c) => c.id), ["a"]);
    assert.equal(await count(db), 0);
  });

  await test("an answer that arrives after sign-out is ignored: nothing is written and nothing is deleted", async (w) => {
    const { outbox, cache } = await openAs(w);
    await outbox.enqueue(audio("a"));
    w.recordings.files.set("a", clock.now);
    let release;
    w.processor.script = [() => new Promise((resolve) => (release = () => resolve(w.processor.ok({ clientEntryId: "a", inputType: "audio" }))))];
    let wrote = 0;
    const original = cache.upsertEntry;
    cache.upsertEntry = async (...args) => {
      wrote += 1;
      return original(...args);
    };
    const { session } = await startEngine(w);
    assert.equal(w.processor.concurrent, 1);
    await session.endOfflineSession();
    release();
    await settle();
    assert.equal(wrote, 0);
    assert.equal(w.recordings.files.has("a"), true);
    assert.equal(w.use("@/db/database").isDatabaseOpen(), false);
  });

  await test("the waiting screen is told how it ended, gives up after 90 seconds, and the engine goes on without it", async (w) => {
    const { outbox } = await openAs(w);
    const { engine } = await startEngine(w);
    await outbox.enqueue(text("a"));
    const crisis = await engine.syncAndWait("a");
    assert.equal(crisis.kind, "ready");
    assert.equal(crisis.isCrisis, false);
    await outbox.enqueue(text("b"));
    w.processor.script = [(item) => Promise.resolve(w.processor.ok(item, { isCrisis: true }))];
    const second = await engine.syncAndWait("b");
    assert.deepEqual([second.kind, second.entryId, second.isCrisis], ["ready", "entry-b", true]);
    await outbox.enqueue(text("c"));
    w.processor.script = [{ ok: false, code: "LIMIT_REACHED", entryId: "srv-c", resetsAt: new Date(clock.now + 1e6).toISOString() }];
    assert.deepEqual(await engine.syncAndWait("c"), { kind: "limit", entryId: "srv-c" });
    await outbox.enqueue(text("d"));
    let finish;
    w.processor.script = [() => new Promise((resolve) => (finish = () => resolve(w.processor.ok({ clientEntryId: "d", inputType: "text" }))))];
    const stages = [];
    let outcome = null;
    engine.syncAndWait("d", { onStage: (s) => stages.push(s) }).then((value) => (outcome = value));
    await advance(89_000);
    assert.equal(outcome, null);
    await advance(2000);
    assert.deepEqual(outcome, { kind: "later" });
    assert.deepEqual(stages, ["receiving"]);
    finish();
    await settle();
    assert.equal(await outbox.get("d"), null);
    w.use("@/services/offlineSession").endOfflineSession();
    await settle();
    assert.deepEqual(await engine.syncAndWait("zzz"), { kind: "later" });
  });

  await test("a call that never answers counts as no answer after 200 seconds, and one that throws is tried again", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("a"), 1000);
    await outbox.enqueue(text("b"), 2000);
    w.processor.script = [() => new Promise(() => undefined), () => Promise.reject(new Error("boom with secret words"))];
    await startEngine(w);
    assert.equal(w.processor.calls.length, 1);
    await advance(199_000);
    assert.equal((await outbox.get("a")).status, "sending");
    await advance(2000);
    await settle();
    assert.equal((await outbox.get("a")).lastErrorCode, "NETWORK");
    assert.equal(w.processor.calls.filter((c) => c.id === "b").length, 1);
    assert.equal((await outbox.get("b")).lastErrorCode, "UNKNOWN");
    assert.ok(!w.logs.some((line) => line.includes("secret")));
  });

  await test("a reflection saved while another is being prepared is prepared after it, in the same run", async (w) => {
    const { outbox } = await openAs(w);
    await outbox.enqueue(text("a"), 1000);
    let release;
    w.processor.script = [() => new Promise((resolve) => (release = () => resolve(w.processor.ok({ clientEntryId: "a", inputType: "text" }))))];
    const { engine } = await startEngine(w);
    await outbox.enqueue(text("b"), 2000);
    await engine.syncNow("submit");
    release();
    await settle();
    assert.deepEqual(w.processor.calls.map((c) => c.id), ["a", "b"]);
    assert.equal(w.processor.maxConcurrent, 1);
  });

  await test("words that cannot be read are never sent: the reflection needs the person", async (w) => {
    const { outbox, db } = await openAs(w);
    await outbox.enqueue(text("a"));
    await db.runAsync("UPDATE outbox SET text = 'v1.AAAA' WHERE client_entry_id = 'a'");
    await startEngine(w);
    assert.equal(w.processor.calls.length, 0);
    const item = await outbox.get("a");
    assert.deepEqual([item.status, item.lastErrorCode], ["needs_action", "UNREADABLE"]);
  });

  await test("discarding a reflection removes the item and its recording and tells the lists", async (w) => {
    const { outbox } = await openAs(w);
    const { engine } = await startEngine(w);
    await outbox.enqueue(audio("a"));
    w.recordings.files.set("a", clock.now);
    let changed = 0;
    engine.subscribe((event) => event.type === "changed" && (changed += 1));
    await engine.discardItem("a");
    assert.equal(await outbox.get("a"), null);
    assert.equal(w.recordings.files.has("a"), false);
    assert.ok(changed >= 1);
  });

  await test("a recording with no queue item that is over a week old goes, and every other recording stays", async (w) => {
    const { outbox } = await openAs(w);
    const { cleanOldRecordings } = w.use("@/services/recordingCleanup");
    const day = 86_400_000;
    const now = clock.now;
    w.recordings.files.set("old-orphan", now - 8 * day);
    w.recordings.files.set("old-queued", now - 8 * day);
    w.recordings.files.set("young-orphan", now - day);
    w.recordings.files.set("unknown-age", 0);
    await outbox.enqueue(audio("old-queued"));
    assert.equal(await cleanOldRecordings(now), 1);
    assert.deepEqual([...w.recordings.files.keys()].sort(), ["old-queued", "unknown-age", "young-orphan"]);
    w.use("@/services/offlineSession");
    assert.equal(await cleanOldRecordings(now), 0);
  });

  await test("the session starts the engine once the database is ready, fails visibly, and a stale open never starts anything", async (w) => {
    const { session } = { session: w.use("@/services/offlineSession") };
    const store = w.use("@/store/offlineStore").useOfflineStore;
    const engine = w.use("@/services/syncEngine");
    w.sqlite.stats.failOpen = true;
    await session.startOfflineSession("user_a");
    assert.deepEqual([store.getState().dbReady, store.getState().dbFailed, engine.isSyncEngineStarted()], [false, true, false]);
    w.sqlite.stats.failOpen = false;
    await session.startOfflineSession("user_a");
    assert.deepEqual([store.getState().dbReady, store.getState().dbFailed, engine.isSyncEngineStarted()], [true, false, true]);
    await session.endOfflineSession();
    assert.deepEqual([store.getState().dbReady, engine.isSyncEngineStarted(), w.use("@/db/database").isDatabaseOpen()], [false, false, false]);
    const opening = session.startOfflineSession("user_b");
    const ending = session.endOfflineSession();
    await Promise.all([opening, ending]);
    assert.deepEqual([store.getState().dbReady, engine.isSyncEngineStarted(), w.use("@/db/database").isDatabaseOpen()], [false, false, false]);
  });

  await test("nothing in the log is a word the person wrote, an id, a user, a path or a key", async (w) => {
    const { outbox } = await openAs(w, "user_secret_id");
    await outbox.enqueue(text("entry-id-1"));
    await outbox.enqueue(audio("entry-id-2"));
    w.processor.script = [{ ok: false, code: "NETWORK" }, { ok: false, code: "LIMIT_REACHED", resetsAt: new Date(clock.now + 1e6).toISOString() }];
    await startEngine(w, "user_secret_id");
    await advance(10000);
    assert.ok(w.logs.length > 0);
    for (const line of w.logs) {
      for (const bad of ["secret", "entry-id", "recordings", ".db", "gracehush.dbkey", "sister"]) assert.ok(!line.includes(bad), `${bad} in: ${line}`);
    }
  });
}

// ================================================================== sign out
async function accountChecks() {
  await test("signing out stops the engine first, then deletes the database file, its key and every recording, and clears the affirmations", async (w) => {
    const order = [];
    const extra = {
      "@/data/journalRepository": { __esModule: true, getKnownTier: () => "free", simulateWrite: async () => undefined },
      "@/services/profileSync": { __esModule: true, cancelProfileSync: () => order.push("cancel profile sync") },
      "@/services/supabaseClient": { __esModule: true, getSupabaseUserId: () => "user_a" },
      "@/store/onboardingStore": { __esModule: true, useOnboardingStore: { getState: () => ({ discardUnsyncedReminders: () => order.push("reminders") }) } },
      "@/store/playerStore": { __esModule: true, usePlayerStore: { getState: () => ({ stop: () => order.push("player") }) } },
      // Step 26: the devotionals downloaded to the phone go too (expo-file-system cannot load in plain Node).
      "@/services/devotionalAudio": { __esModule: true, deleteAllDevotionalAudio: async () => void order.push("devotional audio") },
      "@/store/profilePrefsStore": { __esModule: true, useProfilePrefsStore: { getState: () => ({ forgetUser: () => undefined }) } },
      // Step 28: the affirmation notifications go too (expo-notifications cannot load in plain Node).
      "@/services/affirmationScheduler": { __esModule: true, clearAffirmations: async () => void order.push("affirmations") },
    };
    const mod = makeWorld2(w, extra);
    const database = mod.use("@/db/database");
    const engine = mod.use("@/services/syncEngine");
    await mod.use("@/services/offlineSession").startOfflineSession("user_a");
    await settle();
    await mod.use("@/db/outbox").enqueue(text("a"));
    w.recordings.files.set("a", clock.now);
    const originalStop = engine.stopSyncEngine;
    engine.stopSyncEngine = () => {
      order.push("engine stopped");
      return originalStop();
    };
    const originalDelete = database.deleteUserDatabase;
    database.deleteUserDatabase = async (id) => {
      order.push("database deleted");
      return originalDelete(id);
    };
    await mod.use("@/services/account").signOutCleanup();
    assert.ok(order.indexOf("engine stopped") < order.indexOf("database deleted"), order.join(" > "));
    assert.equal(engine.isSyncEngineStarted(), false);
    assert.equal(database.isDatabaseOpen(), false);
    assert.equal(w.sqlite.exists(`gracehush-${sha16("user_a")}.db`), false);
    assert.equal(w.secure.items.size, 0);
    assert.equal(w.recordings.files.size, 0);
    assert.ok(order.includes("player") && order.includes("reminders") && order.includes("cancel profile sync"));
    assert.ok(order.indexOf("player") < order.indexOf("devotional audio"), `the player stops before its files go: ${order.join(" > ")}`);
    assert.equal(order.filter((step) => step === "affirmations").length, 1, "the affirmation notifications are cleared once");
    await mod.use("@/services/account").signOutCleanup();
  });
}

// A second module environment that shares this world's fakes and adds fakes of its own.
function makeWorld2(w, extra) {
  const { makeEnv } = require("../profile-sync/loader.cjs");
  const fakes = {
    "expo-sqlite": w.sqlite.module,
    "expo-crypto": require("./world.cjs").makeCrypto(),
    "expo-secure-store": w.secure.module,
    "@react-native-community/netinfo": w.net.module,
    "react-native": w.appState.module,
    "@/services/recordingFiles": w.recordings.module,
    "@/services/entryProcessor": w.processor.module,
    ...extra,
  };
  return makeEnv({ fakes });
}

(async () => {
  await databaseChecks();
  await cryptoChecks();
  await outboxChecks();
  await cacheChecks();
  await pureChecks();
  await engineChecks();
  await accountChecks();
  const total = passed + failures.length;
  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${total} FAILED:\n`);
    for (const failure of failures) console.error(` - ${failure}\n`);
    process.exit(1);
  }
  console.log(`${passed} of ${total} passed`);
})();
