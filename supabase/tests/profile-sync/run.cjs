// Profile sync checks (steps 17 and 18). They run the app's real stores, repository, sync and Supabase client in Node,
// against a fake PostgREST that enforces the same column grants and check constraints as the migration, so a request
// that carries a column the database would refuse fails here.
//
//   node supabase/tests/profile-sync/run.cjs                 (from the repo root; about 35 seconds)
//
// It needs no emulator and no Supabase project. Exit code 0 only when every check passes.
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://abcdefghij.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_testkey";

const assert = require("node:assert/strict");
const { makeEnv } = require("./loader.cjs");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (error) {
    failures.push(`${name}\n      ${String(error.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64u = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload) => ["header", b64u(payload), "sig"].join(".");

const DEFAULTS = { morning: "08:00", afternoon: "13:00", evening: "20:00" };
// The zone this process runs in: the app sends the device's zone, so a row that already has it needs no push.
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const row = ({
  id = "user_a",
  created = "2026-10-01T12:00:00+00:00",
  tier = "free",
  t = DEFAULTS,
  ambient = "off",
  volume = 0.5,
  affirm = true,
  zone = ZONE,
} = {}) => ({
  id,
  created_at: created,
  subscription_tier: tier,
  reminder_morning: `${t.morning}:00`,
  reminder_afternoon: `${t.afternoon}:00`,
  reminder_evening: `${t.evening}:00`,
  last_active_at: null,
  affirmations_enabled: affirm,
  ambient_sound: ambient,
  ambient_volume: volume,
  timezone: zone,
  updated_at: created,
});

// ============================================================================ A. pure helpers
(async () => {
  {
    const env = makeEnv();
    const { checkSupabaseEnv } = env.use("@/constants/env");
    const good = "sb_publishable_abc123";
    const url = "https://abcd1234.supabase.co";
    await test("env: a good pair is ok", () => assert.equal(checkSupabaseEnv(url, good).status, "ok"));
    await test("env: a trailing slash is ok", () => assert.equal(checkSupabaseEnv(url + "/", good).status, "ok"));
    await test("env: empty url or key is missing", () => {
      assert.equal(checkSupabaseEnv("", good).status, "missing");
      assert.equal(checkSupabaseEnv(url, "").status, "missing");
    });
    await test("env: a path, http or spaces in the url are invalid", () => {
      assert.equal(checkSupabaseEnv(url + "/rest/v1", good).status, "invalid");
      assert.equal(checkSupabaseEnv("http://abcd1234.supabase.co", good).status, "invalid");
      assert.equal(checkSupabaseEnv("https://abcd 1234.supabase.co", good).status, "invalid");
    });
    await test("env: a secret key is refused, in both formats", () => {
      const a = checkSupabaseEnv(url, "sb_secret_abc");
      assert.equal(a.status, "invalid");
      assert.match(a.message, /secret key/);
      assert.equal(checkSupabaseEnv(url, jwt({ role: "service_role" })).status, "invalid");
    });
    await test("env: a legacy anon JWT is ok, other JWTs and junk are not", () => {
      assert.equal(checkSupabaseEnv(url, jwt({ role: "anon" })).status, "ok");
      assert.equal(checkSupabaseEnv(url, jwt({ sub: "x" })).status, "invalid");
      assert.equal(checkSupabaseEnv(url, "hello").status, "invalid");
    });
    await test("env: the message never repeats the key", () => {
      const result = checkSupabaseEnv(url, "sb_secret_SUPERSECRETVALUE");
      assert.ok(!JSON.stringify(result).includes("SUPERSECRETVALUE"));
    });
    await test("env: this run's supabaseEnv is ok", () => assert.equal(env.use("@/constants/env").supabaseEnv.status, "ok"));

    const { toFailureCode, describeFailure, NoSessionError } = env.use("@/utils/supabaseErrors");
    await test("errors: status 0 is NETWORK, unless our own NoSessionError", () => {
      assert.equal(toFailureCode(0, { message: "TypeError: Network request failed" }), "NETWORK");
      assert.equal(toFailureCode(0, { message: "ClerkRuntimeError: Network error" }), "NETWORK");
      assert.equal(toFailureCode(0, { message: `${new NoSessionError().name}: ${new NoSessionError().message}` }), "UNAUTHORIZED");
    });
    await test("errors: 401, 403, PGRST30x and 42501 are UNAUTHORIZED", () => {
      assert.equal(toFailureCode(401, { code: "PGRST301" }), "UNAUTHORIZED");
      assert.equal(toFailureCode(401, {}), "UNAUTHORIZED");
      assert.equal(toFailureCode(401, { code: "PGRST303" }), "UNAUTHORIZED");
      assert.equal(toFailureCode(403, { code: "42501" }), "UNAUTHORIZED");
      assert.equal(toFailureCode(400, { code: "42501" }), "UNAUTHORIZED");
    });
    await test("errors: everything else is UNKNOWN", () => {
      for (const [status, code] of [[500, ""], [404, "PGRST205"], [409, "23505"], [429, ""], [400, "22P02"], [406, "PGRST116"]]) {
        assert.equal(toFailureCode(status, { code }), "UNKNOWN", `${status} ${code}`);
      }
    });
    await test("errors: describeFailure carries the table and a code only", () => {
      assert.equal(describeFailure("users_profile", 403, { code: "42501", message: "secret@example.com" }), "users_profile: 42501");
      assert.equal(describeFailure("users_profile", 0, { message: "x@y.z" }), "users_profile: no answer");
      assert.equal(describeFailure("users_profile", 500, {}), "users_profile: HTTP 500");
    });
    await test("errors: NoSessionError is an Error with the name the mapper looks for", () => {
      const e = new NoSessionError();
      assert.ok(e instanceof Error);
      assert.equal(e.name, "NoSessionError");
    });

    const { readJwtPayload } = env.use("@/utils/jwt");
    await test("jwt: reads a payload, base64url included", () => {
      assert.deepEqual(readJwtPayload(jwt({ role: "authenticated", n: "a?b>c" })), { role: "authenticated", n: "a?b>c" });
    });
    await test("jwt: junk answers null and never throws", () => {
      for (const junk of ["", "abc", "a.b.c", "a..c", "a.%%%.c", `a.${Buffer.from("[1,2]").toString("base64url")}.c`.replace("[1,2]", "")]) {
        assert.equal(readJwtPayload(junk), null, junk);
      }
      assert.equal(readJwtPayload(`h.${Buffer.from('"text"').toString("base64url")}.s`), null);
    });
  }

  // ========================================================================== B. onboarding store
  async function onboarding(stored) {
    const env = makeEnv({ stored: stored === undefined ? {} : { "gracehush.onboarding": JSON.stringify(stored) } });
    const store = env.use("@/store/onboardingStore").useOnboardingStore;
    await store.persist.rehydrate();
    return { env, store };
  }
  const v1 = (extra = {}) => ({
    state: { hasCompletedOnboarding: true, completedAt: "2026-10-18T09:00:00.000Z", reminders: { ...DEFAULTS }, permissionsPromptedAt: null, remindersSyncedAt: null, ...extra },
    version: 1,
  });
  await test("onboarding: a fresh install is not dirty and has the defaults", async () => {
    const { store } = await onboarding(undefined);
    assert.equal(store.getState().remindersDirty, false);
    assert.deepEqual(store.getState().reminders, DEFAULTS);
  });
  await test("onboarding: v1 with default times migrates to not dirty", async () => {
    const { store } = await onboarding(v1());
    assert.equal(store.getState().remindersDirty, false);
  });
  await test("onboarding: v1 with a changed time migrates to dirty and keeps the times", async () => {
    const { store } = await onboarding(v1({ reminders: { morning: "07:15", afternoon: "13:00", evening: "20:00" } }));
    assert.equal(store.getState().remindersDirty, true);
    assert.equal(store.getState().reminders.morning, "07:15");
    assert.equal(store.getState().hasCompletedOnboarding, true);
  });
  await test("onboarding: v1 with a changed time that was synced stays not dirty", async () => {
    const { store } = await onboarding(v1({ reminders: { morning: "07:15", afternoon: "13:00", evening: "20:00" }, remindersSyncedAt: "2026-10-19T10:00:00.000Z" }));
    assert.equal(store.getState().remindersDirty, false);
  });
  await test("onboarding: v1 with a garbage time ignores it (default) and is not dirty", async () => {
    const { store } = await onboarding(v1({ reminders: { morning: "7:15", afternoon: "99:99", evening: 5 } }));
    assert.deepEqual(store.getState().reminders, DEFAULTS);
    assert.equal(store.getState().remindersDirty, false);
  });
  await test("onboarding: v2 keeps dirty, and a non-boolean dirty is false", async () => {
    const a = await onboarding({ state: { ...v1().state, remindersDirty: true }, version: 2 });
    assert.equal(a.store.getState().remindersDirty, true);
    const b = await onboarding({ state: { ...v1().state, remindersDirty: "yes" }, version: 2 });
    assert.equal(b.store.getState().remindersDirty, false);
  });
  await test("onboarding: corrupt JSON loads the defaults", async () => {
    const env = makeEnv({ stored: { "gracehush.onboarding": "{not json" } });
    const store = env.use("@/store/onboardingStore").useOnboardingStore;
    await store.persist.rehydrate();
    assert.equal(store.persist.hasHydrated(), true);
    assert.equal(store.getState().remindersDirty, false);
  });
  await test("onboarding: actions", async () => {
    const { store } = await onboarding(undefined);
    const s = () => store.getState();
    s().setReminder("morning", "07:00");
    assert.equal(s().remindersDirty, true);
    assert.equal(s().remindersSyncedAt, null);
    s().markRemindersSynced();
    assert.equal(s().remindersDirty, false);
    assert.ok(s().remindersSyncedAt);
    s().setReminder("morning", "07:00"); // same value: nothing changes
    assert.equal(s().remindersDirty, false);
    s().setReminder("evening", "nope"); // invalid: ignored
    assert.equal(s().reminders.evening, "20:00");
    assert.equal(s().remindersDirty, false);
    s().setReminder("evening", "21:30");
    s().applyServerReminders({ morning: "06:00", afternoon: "bad", evening: "22:00" });
    assert.deepEqual(s().reminders, { morning: "06:00", afternoon: "13:00", evening: "22:00" });
    assert.equal(s().remindersDirty, false);
    s().setReminder("morning", "05:00");
    const syncedAt = s().remindersSyncedAt;
    s().discardUnsyncedReminders();
    assert.equal(s().remindersDirty, false);
    assert.equal(s().remindersSyncedAt, syncedAt);
    assert.equal(s().reminders.morning, "05:00"); // the time itself stays
  });
  await test("onboarding: what is saved is version 2 and includes remindersDirty", async () => {
    const { env, store } = await onboarding(undefined);
    store.getState().setReminder("afternoon", "14:00");
    await sleep(30);
    const saved = JSON.parse(env.storage.get("gracehush.onboarding"));
    assert.equal(saved.version, 2);
    assert.equal(saved.state.remindersDirty, true);
    assert.equal(saved.state.reminders.afternoon, "14:00");
    assert.equal(typeof saved.state.setReminder, "undefined");
  });
  await test("onboarding: resetOnboarding clears dirty", async () => {
    const { store } = await onboarding(undefined);
    store.getState().setReminder("morning", "07:00");
    store.getState().resetOnboarding();
    assert.equal(store.getState().remindersDirty, false);
    assert.deepEqual(store.getState().reminders, DEFAULTS);
  });

  // ========================================================================== C. profile prefs store (version 2)
  async function prefsStore(stored) {
    const env = makeEnv({ stored: stored === undefined ? {} : { "gracehush.profilePrefs": JSON.stringify(stored) } });
    const store = env.use("@/store/profilePrefsStore").useProfilePrefsStore;
    await store.persist.rehydrate();
    return { env, store };
  }
  const snap = {
    createdAt: "2026-10-01T12:00:00.000Z",
    subscriptionTier: "pro",
    syncedAt: "2026-10-22T10:00:00.000Z",
    affirmationsEnabled: false,
    ambientSound: "gentle-piano",
    ambientVolume: 0.2,
  };
  await test("prefs: save, merge, isolate users, forget", async () => {
    const { store } = await prefsStore(undefined);
    const s = () => store.getState();
    s().saveUnsent("u1", { ambientSound: "soft-rain" });
    s().saveUnsent("u1", { ambientVolume: 0.3, affirmationsEnabled: false });
    s().saveSnapshot("u1", snap);
    s().saveUnsent("u2", { affirmationsEnabled: true });
    assert.deepEqual(s().byUser.u1.unsent, { ambientSound: "soft-rain", ambientVolume: 0.3, affirmationsEnabled: false });
    assert.deepEqual(s().byUser.u1.snapshot, snap);
    assert.deepEqual(s().byUser.u2.unsent, { affirmationsEnabled: true });
    assert.equal(s().byUser.u2.snapshot, null);
    s().forgetUser("u1");
    assert.equal(s().byUser.u1, undefined);
    assert.ok(s().byUser.u2);
  });
  await test("prefs: clearUnsent drops only what was sent and not edited since", async () => {
    const { store } = await prefsStore(undefined);
    const s = () => store.getState();
    s().saveUnsent("u1", { ambientSound: "soft-rain", ambientVolume: 0.3, affirmationsEnabled: false });
    s().clearUnsent("u1", { ambientSound: "soft-rain", ambientVolume: 0.5 }); // the volume was edited after the request left
    assert.deepEqual(s().byUser.u1.unsent, { ambientVolume: 0.3, affirmationsEnabled: false });
    s().clearUnsent("nobody", { ambientSound: "off" });
    assert.equal(s().byUser.nobody, undefined, "no entry is made for an unknown user");
    const before = s().byUser;
    s().clearUnsent("u1", { ambientSound: "off" }); // nothing matches: the state object is not even replaced
    assert.equal(s().byUser, before);
    s().clearUnsent("u1", { ambientVolume: 0.3, affirmationsEnabled: false });
    assert.deepEqual(s().byUser.u1.unsent, {});
  });
  await test("prefs: damaged version 2 data is repaired field by field", async () => {
    const { store } = await prefsStore({
      state: {
        byUser: {
          u1: { unsent: { ambientVolume: 9, ambientSound: "rain", affirmationsEnabled: "yes" }, snapshot: { createdAt: "nope", subscriptionTier: "gold", syncedAt: "x" } },
          u2: 5,
          u3: { unsent: { ambientVolume: 0.3, ambientSound: "soft-rain", affirmationsEnabled: false }, snapshot: snap },
          u4: { unsent: null, snapshot: { createdAt: snap.createdAt, subscriptionTier: "free" } },
          u5: { unsent: {}, snapshot: { createdAt: snap.createdAt, subscriptionTier: "free", syncedAt: snap.syncedAt, ambientSound: "rain", ambientVolume: "loud", affirmationsEnabled: 1 } },
        },
      },
      version: 2,
    });
    const by = store.getState().byUser;
    assert.deepEqual(by.u1.unsent, { ambientVolume: 1 });
    assert.equal(by.u1.snapshot, null);
    assert.equal(by.u2, undefined);
    assert.deepEqual(by.u3, { unsent: { ambientVolume: 0.3, ambientSound: "soft-rain", affirmationsEnabled: false }, snapshot: snap });
    assert.deepEqual(by.u4, { unsent: {}, snapshot: null });
    assert.deepEqual(by.u5.snapshot, { createdAt: snap.createdAt, subscriptionTier: "free", syncedAt: snap.syncedAt, affirmationsEnabled: true, ambientSound: "off", ambientVolume: 0.5 });
  });
  await test("prefs: version 1 data migrates: the settings become unsent edits, an old snapshot gets the defaults", async () => {
    const { store } = await prefsStore({
      state: {
        byUser: {
          u1: { prefs: { ambientSound: "soft-rain", affirmationsEnabled: false }, snapshot: { createdAt: snap.createdAt, subscriptionTier: "pro", syncedAt: snap.syncedAt } },
          u2: { prefs: {}, snapshot: null },
          u3: 7,
        },
      },
      version: 1,
    });
    const by = store.getState().byUser;
    assert.deepEqual(by.u1.unsent, { ambientSound: "soft-rain", affirmationsEnabled: false });
    assert.deepEqual(by.u1.snapshot, { createdAt: snap.createdAt, subscriptionTier: "pro", syncedAt: snap.syncedAt, affirmationsEnabled: true, ambientSound: "off", ambientVolume: 0.5 });
    assert.deepEqual(by.u2, { unsent: {}, snapshot: null });
    assert.equal(by.u3, undefined);
  });
  await test("prefs: a __proto__ user id cannot pollute", async () => {
    const { store } = await prefsStore({ state: { byUser: JSON.parse('{"__proto__":{"unsent":{"ambientVolume":0.5},"snapshot":null}}') }, version: 2 });
    assert.equal({}.unsent, undefined);
    assert.equal(Object.keys(store.getState().byUser).length, 1);
  });
  await test("prefs: corrupt JSON and wrong shapes load empty", async () => {
    const a = makeEnv({ stored: { "gracehush.profilePrefs": "[[" } });
    const sa = a.use("@/store/profilePrefsStore").useProfilePrefsStore;
    await sa.persist.rehydrate();
    assert.deepEqual(sa.getState().byUser, {});
    const b = await prefsStore({ state: { byUser: [1, 2] }, version: 2 });
    assert.deepEqual(b.store.getState().byUser, {});
    const c = await prefsStore({ state: 7, version: 2 });
    assert.deepEqual(c.store.getState().byUser, {});
    const d = await prefsStore({ state: { byUser: [1, 2] }, version: 1 });
    assert.deepEqual(d.store.getState().byUser, {});
  });
  await test("prefs: only data is saved, as version 2", async () => {
    const { env, store } = await prefsStore(undefined);
    store.getState().saveUnsent("u1", { ambientSound: "off" });
    await sleep(30);
    const saved = JSON.parse(env.storage.get("gracehush.profilePrefs"));
    assert.deepEqual(Object.keys(saved.state), ["byUser"]);
    assert.equal(saved.version, 2);
  });

  // ========================================================================== fakes for D and E
  const ok = (data) => ({ ok: true, data });
  const bad = (code) => ({ ok: false, code, message: "x" });
  const reminderCols = (t) => ({
    reminder_morning: `${t.morning}:00`,
    reminder_afternoon: `${t.afternoon}:00`,
    reminder_evening: `${t.evening}:00`,
  });
  // The "database" is one row the fake keeps: a push changes it, as the real update would.
  function makeSyncEnv({ stored = {}, source = "supabase", server = row() } = {}) {
    const calls = {
      fetch: 0,
      push: [],
      recordingsDeleted: 0,
      devotionalsDeleted: 0,
      affirmationsCleared: 0,
      planWatchStopped: 0,
      revenueCatEnded: 0,
    };
    const remote = { server, fetchFails: null, pushFails: [], onPush: null, onFetch: null };
    const session = { userId: "user_a" };
    // The two pure column builders are the real ones, so what the sync sends is what the app would send.
    const realRemote = makeEnv({
      fakes: { "@/services/supabaseClient": { getSupabaseUserId: () => null, getSupabase: () => null } },
    }).use("@/data/profileRemote");
    const fakes = {
      "@/data/profileRemote": {
        fetchOrCreateProfileRow: async () => {
          calls.fetch++;
          if (remote.onFetch) await remote.onFetch();
          return remote.fetchFails ?? ok({ ...remote.server });
        },
        pushProfileColumns: async (columns) => {
          calls.push.push({ ...columns });
          if (remote.onPush) await remote.onPush(columns);
          const failure = remote.pushFails.shift();
          if (failure) return failure;
          Object.assign(remote.server, columns);
          return ok({ ...remote.server });
        },
        reminderColumns: realRemote.reminderColumns,
        settingColumns: realRemote.settingColumns,
        getLastProfileError: () => null,
      },
      "@/services/supabaseClient": {
        getSupabaseUserId: () => session.userId,
        setSupabaseSession: (next) => {
          session.userId = next === null ? null : next.userId;
        },
        getSupabase: () => null,
      },
    };
    // react-native cannot load in Node; the player store only matters to signOutCleanup's reset.
    fakes["@/store/playerStore"] = { usePlayerStore: { getState: () => ({ stop: () => undefined }) } };
    // expo-file-system cannot load in Node either; signOutCleanup only needs the recordings on the phone to be deleted.
    fakes["@/services/recordingFiles"] = { deleteAllRecordings: async () => void calls.recordingsDeleted++ };
    // Step 26: the same for the devotionals downloaded to the phone.
    fakes["@/services/devotionalAudio"] = { deleteAllDevotionalAudio: async () => void calls.devotionalsDeleted++ };
    // Step 28: the same for the affirmation notifications (expo-notifications cannot load in Node).
    fakes["@/services/affirmationScheduler"] = { clearAffirmations: async () => void calls.affirmationsCleared++ };
    // Step 30: the plan watch stops and RevenueCat logs out (react-native-purchases and expo cannot load in Node).
    fakes["@/services/subscriptionSync"] = { stopPlanWatch: () => void calls.planWatchStopped++ };
    fakes["@/services/revenuecat"] = { endRevenueCatSession: async () => void calls.revenueCatEnded++ };
    // Step 24: account.ts and journalRepository.ts import the user's database and the sync session, and plain Node cannot
    // load the native modules behind them. These checks are not about them.
    fakes["@/db/database"] = { isDatabaseOpen: () => false, deleteUserDatabase: async () => undefined };
    fakes["@/db/outbox"] = {};
    // Step 25: journalRepository.ts also imports the read cache, which needs the same native modules, and step 29 the
    // queue of prayer changes.
    fakes["@/db/cache"] = {};
    fakes["@/db/mutations"] = {};
    fakes["@/services/offlineSession"] = { endOfflineSession: async () => undefined };
    const env = makeEnv({ stored, fakes });
    // the real scenario + devStore decide the source
    env.use("@/store/devStore").useDevStore.getState().setDataSource(source);
    return { env, calls, remote, session };
  }
  // As the app does: both persisted stores have loaded before anything runs.
  async function syncCtx(opts) {
    const ctx = makeSyncEnv(opts);
    await ctx.env.use("@/store/onboardingStore").useOnboardingStore.persist.rehydrate();
    await ctx.env.use("@/store/profilePrefsStore").useProfilePrefsStore.persist.rehydrate();
    return ctx;
  }
  const obOf = (ctx) => ctx.env.use("@/store/onboardingStore").useOnboardingStore;
  const prefsOf = (ctx) => ctx.env.use("@/store/profilePrefsStore").useProfilePrefsStore;
  const syncOf = (ctx) => ctx.env.use("@/services/profileSync");
  const unsentOf = (ctx, id = "user_a") => prefsOf(ctx).getState().byUser[id]?.unsent;

  // ========================================================================== D. profileSync
  await test("sync: reminder decision table", () => {
    const { decideReminderSync } = makeSyncEnv().env.use("@/services/profileSync");
    const a = { morning: "07:00", afternoon: "13:00", evening: "20:00" };
    const b = { morning: "09:00", afternoon: "13:00", evening: "20:00" };
    assert.equal(decideReminderSync(a, a, false), "mark-synced");
    assert.equal(decideReminderSync(a, a, true), "mark-synced");
    assert.equal(decideReminderSync(a, b, true), "push");
    assert.equal(decideReminderSync(a, b, false), "apply-server");
  });
  await test("sync: settingsToPush sends only what the server does not have", () => {
    const { settingsToPush } = makeSyncEnv().env.use("@/services/profileSync");
    const server = { affirmationsEnabled: true, ambientSound: "off", ambientVolume: 0.5 };
    assert.deepEqual(settingsToPush(server, {}), {});
    assert.deepEqual(settingsToPush(server, { ambientSound: "off", ambientVolume: 0.5, affirmationsEnabled: true }), {});
    assert.deepEqual(settingsToPush(server, { ambientSound: "soft-rain", ambientVolume: 0.5, affirmationsEnabled: false }), {
      ambientSound: "soft-rain",
      affirmationsEnabled: false,
    });
    assert.deepEqual(settingsToPush({ ...server, ambientVolume: 0.7 }, { ambientVolume: 0.2 }), { ambientVolume: 0.2 });
  });
  await test("sync: a new account keeps this phone's times, and nothing is pushed", async () => {
    const mine = { morning: "07:30", afternoon: "12:00", evening: "21:00" };
    const ctx = await syncCtx({ server: row({ t: mine }) });
    const ob = obOf(ctx);
    ob.getState().setReminder("morning", mine.morning);
    ob.getState().setReminder("afternoon", mine.afternoon);
    ob.getState().setReminder("evening", mine.evening);
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.ok, true);
    assert.equal(ctx.calls.push.length, 0);
    assert.equal(ob.getState().remindersDirty, false);
    assert.ok(ob.getState().remindersSyncedAt);
    const snapshot = prefsOf(ctx).getState().byUser.user_a.snapshot;
    assert.equal(snapshot.subscriptionTier, "free");
    assert.equal(snapshot.createdAt, "2026-10-01T12:00:00+00:00");
    assert.deepEqual([snapshot.affirmationsEnabled, snapshot.ambientSound, snapshot.ambientVolume], [true, "off", 0.5]);
  });
  await test("sync: an existing account on a new phone takes the server's times and settings", async () => {
    const server = { morning: "06:45", afternoon: "12:15", evening: "21:30" };
    const ctx = await syncCtx({ server: row({ t: server, tier: "pro", ambient: "gentle-piano", volume: 0.8, affirm: false }) });
    const ob = obOf(ctx);
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.ok, true);
    assert.deepEqual(ob.getState().reminders, server);
    assert.equal(ob.getState().remindersDirty, false);
    assert.equal(ctx.calls.push.length, 0);
    const snapshot = prefsOf(ctx).getState().byUser.user_a.snapshot;
    assert.deepEqual(
      [snapshot.subscriptionTier, snapshot.ambientSound, snapshot.ambientVolume, snapshot.affirmationsEnabled],
      ["pro", "gentle-piano", 0.8, false],
    );
    assert.deepEqual(unsentOf(ctx), {});
  });
  await test("sync: an unsent reminder edit is pushed in one request with only the reminder columns", async () => {
    const ctx = await syncCtx();
    const ob = obOf(ctx);
    ob.getState().setReminder("morning", "09:15");
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.ok, true);
    assert.deepEqual(ctx.calls.push, [reminderCols({ morning: "09:15", afternoon: "13:00", evening: "20:00" })]);
    assert.equal(ob.getState().remindersDirty, false);
    assert.equal(ob.getState().reminders.morning, "09:15");
  });
  await test("sync: an unsent setting is pushed alone, then cleared, and the snapshot follows", async () => {
    const ctx = await syncCtx();
    prefsOf(ctx).getState().saveUnsent("user_a", { ambientSound: "soft-rain" });
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.ok, true);
    assert.deepEqual(ctx.calls.push, [{ ambient_sound: "soft-rain" }]);
    assert.deepEqual(unsentOf(ctx), {});
    assert.equal(prefsOf(ctx).getState().byUser.user_a.snapshot.ambientSound, "soft-rain");
    assert.equal(ctx.remote.server.ambient_sound, "soft-rain");
    await syncOf(ctx).syncProfile();
    assert.equal(ctx.calls.push.length, 1, "nothing is left to send");
  });
  await test("sync: an unsent setting the server already has is dropped without a request", async () => {
    const ctx = await syncCtx({ server: row({ ambient: "soft-rain", volume: 0.3 }) });
    prefsOf(ctx).getState().saveUnsent("user_a", { ambientSound: "soft-rain", ambientVolume: 0.3 });
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.ok, true);
    assert.equal(ctx.calls.push.length, 0);
    assert.deepEqual(unsentOf(ctx), {});
  });
  await test("sync: reminders, settings and the time zone go in ONE request", async () => {
    const ctx = await syncCtx({ server: row({ zone: "Mars/Olympus" }) });
    obOf(ctx).getState().setReminder("morning", "09:15");
    prefsOf(ctx).getState().saveUnsent("user_a", { affirmationsEnabled: false, ambientVolume: 0.2 });
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.ok, true);
    assert.equal(ctx.calls.push.length, 1);
    assert.deepEqual(Object.keys(ctx.calls.push[0]).sort(), [
      "affirmations_enabled",
      "ambient_volume",
      "reminder_afternoon",
      "reminder_evening",
      "reminder_morning",
      "timezone",
    ]);
    assert.equal(ctx.calls.push[0].timezone, ZONE);
    assert.equal(obOf(ctx).getState().remindersDirty, false);
    assert.deepEqual(unsentOf(ctx), {});
    const snapshot = prefsOf(ctx).getState().byUser.user_a.snapshot;
    assert.deepEqual([snapshot.affirmationsEnabled, snapshot.ambientVolume], [false, 0.2]);
  });
  await test("sync: a different time zone is pushed alone, the same one is not", async () => {
    const ctx = await syncCtx({ server: row({ zone: "Pacific/Auckland" === ZONE ? "UTC" : "Pacific/Auckland" }) });
    await syncOf(ctx).syncProfile();
    assert.deepEqual(ctx.calls.push, [{ timezone: ZONE }]);
    await syncOf(ctx).syncProfile();
    assert.equal(ctx.calls.push.length, 1);
  });
  await test("sync: a failed push leaves everything unsent, and the next sync sends it", async () => {
    const ctx = await syncCtx();
    obOf(ctx).getState().setReminder("evening", "22:00");
    prefsOf(ctx).getState().saveUnsent("user_a", { ambientSound: "morning-birds" });
    ctx.remote.pushFails = [bad("NETWORK")];
    const first = await syncOf(ctx).syncProfile();
    assert.equal(first.ok, false);
    assert.equal(first.code, "NETWORK");
    assert.equal(obOf(ctx).getState().remindersDirty, true);
    assert.deepEqual(unsentOf(ctx), { ambientSound: "morning-birds" });
    assert.ok(prefsOf(ctx).getState().byUser.user_a.snapshot, "the fetch still saved the snapshot, so Profile opens offline");
    const second = await syncOf(ctx).syncProfile();
    assert.equal(second.ok, true);
    assert.equal(ctx.calls.push.length, 2);
    assert.equal(obOf(ctx).getState().remindersDirty, false);
    assert.deepEqual(unsentOf(ctx), {});
    assert.equal(ctx.remote.server.ambient_sound, "morning-birds");
  });
  await test("sync: a failed fetch changes nothing", async () => {
    const ctx = await syncCtx();
    obOf(ctx).getState().setReminder("morning", "07:00");
    prefsOf(ctx).getState().saveUnsent("user_a", { ambientSound: "soft-rain" });
    ctx.remote.fetchFails = bad("UNAUTHORIZED");
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(obOf(ctx).getState().remindersDirty, true);
    assert.deepEqual(unsentOf(ctx), { ambientSound: "soft-rain" });
    assert.equal(prefsOf(ctx).getState().byUser.user_a.snapshot, null);
    assert.equal(ctx.calls.push.length, 0);
  });
  await test("sync: a setting edited while the push is away is not lost", async () => {
    const ctx = await syncCtx();
    const prefs = prefsOf(ctx);
    prefs.getState().saveUnsent("user_a", { ambientVolume: 0.3 });
    let edited = false;
    ctx.remote.onPush = async () => {
      if (!edited) {
        edited = true;
        prefs.getState().saveUnsent("user_a", { ambientVolume: 0.4 }); // the user moves the slider again
      }
    };
    await syncOf(ctx).syncProfile();
    assert.deepEqual(unsentOf(ctx), { ambientVolume: 0.4 }, "still unsent");
    await sleep(1300); // the sync schedules itself (800 ms debounce)
    assert.deepEqual(ctx.calls.push.map((columns) => columns.ambient_volume), [0.3, 0.4]);
    assert.deepEqual(unsentOf(ctx), {});
    assert.equal(ctx.remote.server.ambient_volume, 0.4);
  });
  await test("sync: a reminder edited while the push is away is not lost", async () => {
    const ctx = await syncCtx();
    const ob = obOf(ctx);
    ob.getState().setReminder("morning", "09:00");
    let edited = false;
    ctx.remote.onPush = async () => {
      if (!edited) {
        edited = true;
        ob.getState().setReminder("morning", "10:00");
      }
    };
    await syncOf(ctx).syncProfile();
    assert.equal(ob.getState().remindersDirty, true, "still unsent");
    await sleep(1300);
    assert.deepEqual(ctx.calls.push.map((columns) => columns.reminder_morning), ["09:00:00", "10:00:00"]);
    assert.equal(ob.getState().remindersDirty, false);
  });
  await test("sync: another account signing in mid-request writes nothing", async () => {
    const ctx = await syncCtx({ server: row({ t: { morning: "05:00", afternoon: "13:00", evening: "20:00" } }) });
    ctx.remote.onFetch = async () => {
      ctx.session.userId = "user_b";
    };
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.code, "UNAUTHORIZED");
    assert.deepEqual(obOf(ctx).getState().reminders, DEFAULTS);
    assert.deepEqual(prefsOf(ctx).getState().byUser, {});
    assert.equal(ctx.calls.push.length, 0);
  });
  await test("sync: signing out while the push is away keeps the edit unsent for that account", async () => {
    const ctx = await syncCtx();
    prefsOf(ctx).getState().saveUnsent("user_a", { ambientSound: "soft-rain" });
    ctx.remote.onPush = async () => {
      ctx.session.userId = "user_b";
    };
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.code, "UNAUTHORIZED");
    assert.deepEqual(unsentOf(ctx), { ambientSound: "soft-rain" }, "not cleared: the server's answer may not have been for this user's session");
  });
  await test("sync: two calls at once make one run plus one repeat", async () => {
    const ctx = await syncCtx();
    ctx.remote.onFetch = () => sleep(40);
    const { syncProfile } = syncOf(ctx);
    const [a, b, c] = await Promise.all([syncProfile(), syncProfile(), syncProfile()]);
    assert.equal(a.ok && b.ok && c.ok, true);
    assert.equal(ctx.calls.fetch, 2, "the running sync and one repeat, not three");
  });
  await test("sync: dropping the unsent reminder edit protects the next account, and unsent settings stay with their user", async () => {
    const ctx = await syncCtx({ server: row({ id: "user_b", t: { morning: "08:30", afternoon: "13:30", evening: "20:30" } }) });
    const ob = obOf(ctx);
    ob.getState().setReminder("morning", "05:30"); // account A, unsent
    prefsOf(ctx).getState().saveUnsent("user_a", { ambientSound: "soft-rain" }); // account A's setting
    ob.getState().discardUnsyncedReminders(); // what signOutCleanup does
    ctx.session.userId = "user_b";
    await syncOf(ctx).syncProfile();
    assert.equal(ctx.calls.push.length, 0, "account B's row was not overwritten");
    assert.equal(ob.getState().reminders.morning, "08:30");
    assert.deepEqual(unsentOf(ctx, "user_a"), { ambientSound: "soft-rain" }, "A's setting waits for A");
    assert.deepEqual(unsentOf(ctx, "user_b"), {});
  });
  await test("sync: the mock profile source sends nothing", async () => {
    const ctx = await syncCtx({ source: "mock" });
    const result = await syncOf(ctx).syncProfile();
    assert.equal(result.ok, true);
    assert.equal(ctx.calls.fetch, 0);
  });
  await test("sync: the reminder watcher sends one sync 800 ms after the last edit, and stops when told", async () => {
    const ctx = await syncCtx();
    const ob = obOf(ctx);
    const { watchReminderEdits } = syncOf(ctx);
    const stop = watchReminderEdits();
    ob.getState().setReminder("morning", "07:00");
    await sleep(300);
    ob.getState().setReminder("morning", "07:05");
    await sleep(500);
    assert.equal(ctx.calls.fetch, 0, "300 + 500 ms after the first edit is only 500 ms after the last");
    await sleep(500);
    assert.equal(ctx.calls.fetch, 1);
    assert.deepEqual(ctx.calls.push, [reminderCols({ morning: "07:05", afternoon: "13:00", evening: "20:00" })]);
    // applying the server's times is not an edit and schedules nothing
    ob.getState().applyServerReminders({ morning: "06:00", afternoon: "13:00", evening: "20:00" });
    await sleep(1000);
    assert.equal(ctx.calls.fetch, 1);
    ob.getState().setReminder("evening", "21:00");
    stop();
    await sleep(1000);
    assert.equal(ctx.calls.fetch, 1, "stopped before it fired");
  });
  await test("sync: scheduleProfileSync waits 800 ms after the last call and cancelProfileSync stops it", async () => {
    const ctx = await syncCtx();
    const { scheduleProfileSync, cancelProfileSync } = syncOf(ctx);
    scheduleProfileSync();
    await sleep(400);
    scheduleProfileSync();
    await sleep(600);
    assert.equal(ctx.calls.fetch, 0);
    await sleep(400);
    assert.equal(ctx.calls.fetch, 1);
    scheduleProfileSync();
    cancelProfileSync();
    await sleep(1000);
    assert.equal(ctx.calls.fetch, 1);
  });
  await test("sync: the foreground sync runs when a reminder or a setting is unsent, otherwise at most every 30 s", async () => {
    const ctx = await syncCtx();
    const { syncProfile, syncProfileOnForeground } = syncOf(ctx);
    await syncProfile();
    assert.equal(ctx.calls.fetch, 1);
    syncProfileOnForeground(); // just synced and nothing unsent: skipped
    await sleep(50);
    assert.equal(ctx.calls.fetch, 1);
    obOf(ctx).getState().setReminder("morning", "07:00");
    syncProfileOnForeground(); // a reminder is unsent: runs at once
    await sleep(80);
    assert.equal(ctx.calls.fetch, 2);
    prefsOf(ctx).getState().saveUnsent("user_a", { affirmationsEnabled: false });
    syncProfileOnForeground(); // a setting is unsent: runs at once
    await sleep(80);
    assert.equal(ctx.calls.fetch, 3);
    assert.deepEqual(unsentOf(ctx), {});
  });
  await test("sync: upgrading from step 17 sends the settings kept on the phone once, and only those that differ", async () => {
    const v1 = {
      state: {
        byUser: {
          user_a: {
            prefs: { ambientSound: "soft-rain", affirmationsEnabled: false, ambientVolume: 0.5 },
            snapshot: { createdAt: "2026-10-01T12:00:00.000Z", subscriptionTier: "free", syncedAt: "2026-10-22T10:00:00.000Z" },
          },
        },
      },
      version: 1,
    };
    const ctx = await syncCtx({ stored: { "gracehush.profilePrefs": JSON.stringify(v1) } });
    assert.deepEqual(unsentOf(ctx), { ambientSound: "soft-rain", affirmationsEnabled: false, ambientVolume: 0.5 });
    await syncOf(ctx).syncProfile();
    assert.deepEqual(ctx.calls.push, [{ affirmations_enabled: false, ambient_sound: "soft-rain" }], "the volume equals the column default");
    assert.deepEqual(unsentOf(ctx), {});
    await syncOf(ctx).syncProfile();
    assert.equal(ctx.calls.push.length, 1);
  });

  // ========================================================================== E. repository
  async function repoEnv(opts = {}) {
    const ctx = makeSyncEnv(opts);
    const repo = ctx.env.use("@/data/journalRepository");
    // The app waits for both stores to load before it renders (the splash gate), so a test must as well.
    await ctx.env.use("@/store/onboardingStore").useOnboardingStore.persist.rehydrate();
    await ctx.env.use("@/store/profilePrefsStore").useProfilePrefsStore.persist.rehydrate();
    return { ...ctx, repo };
  }
  await test("repo: the first getProfile waits for the sync, then reads locally", async () => {
    const ctx = await repoEnv({
      server: row({ created: "2026-09-12T08:00:00+00:00", tier: "trial", t: { morning: "07:00", afternoon: "12:00", evening: "21:00" }, ambient: "soft-rain", volume: 0.3, affirm: false }),
    });
    const profile = await ctx.repo.getProfile();
    assert.equal(profile.id, "user_a");
    assert.equal(profile.createdAt, "2026-09-12T08:00:00+00:00");
    assert.equal(profile.subscriptionTier, "trial");
    assert.deepEqual(profile.reminders, { morning: "07:00", afternoon: "12:00", evening: "21:00" });
    assert.equal(profile.ambientSound, "soft-rain");
    assert.equal(profile.ambientVolume, 0.3);
    assert.equal(profile.affirmationsEnabled, false);
    assert.equal(profile.timezone, ZONE);
    assert.equal(ctx.calls.fetch, 1);
    // every later call is local: no request, even when the server is down
    ctx.remote.fetchFails = bad("NETWORK");
    const again = await ctx.repo.getProfile();
    assert.deepEqual(again, profile);
    assert.equal(ctx.calls.fetch, 1);
  });
  await test("repo: getProfile follows a reminder edit at once", async () => {
    const ctx = await repoEnv();
    await ctx.repo.getProfile();
    obOf(ctx).getState().setReminder("afternoon", "14:30");
    assert.equal((await ctx.repo.getProfile()).reminders.afternoon, "14:30");
  });
  await test("repo: a first sync that fails makes getProfile reject", async () => {
    const ctx = await repoEnv();
    ctx.remote.fetchFails = bad("NETWORK");
    await assert.rejects(ctx.repo.getProfile(), /couldn.t load your profile/);
  });
  await test("repo: a first sync that reads the row but fails to send an edit still opens Profile", async () => {
    const ctx = await repoEnv({ server: row({ zone: "Pacific/Auckland" === ZONE ? "UTC" : "Pacific/Auckland" }) });
    ctx.remote.pushFails = [bad("NETWORK")]; // the time zone push fails right after a good fetch
    const profile = await ctx.repo.getProfile();
    assert.equal(profile.id, "user_a");
    assert.equal(ctx.calls.push.length, 1);
    const second = await syncOf(ctx).syncProfile();
    assert.equal(second.ok, true);
    assert.deepEqual(ctx.calls.push, [{ timezone: ZONE }, { timezone: ZONE }], "the next sync tries again");
  });
  await test("repo: getProfile with nobody signed in rejects", async () => {
    const ctx = await repoEnv();
    ctx.session.userId = null;
    await assert.rejects(ctx.repo.getProfile(), /no signed-in user/);
  });
  await test("repo: updateProfile answers at once, and a sync sends the change 800 ms later", async () => {
    const ctx = await repoEnv();
    await ctx.repo.getProfile();
    const result = await ctx.repo.updateProfile({ ambientSound: "soft-rain", ambientVolume: 7, affirmationsEnabled: false });
    assert.equal(result.ok, true);
    assert.equal(result.data.ambientSound, "soft-rain");
    assert.equal(result.data.ambientVolume, 1, "clamped");
    assert.equal(result.data.affirmationsEnabled, false);
    assert.equal(ctx.calls.push.length, 0, "nothing has been sent yet");
    assert.deepEqual(unsentOf(ctx), { ambientSound: "soft-rain", ambientVolume: 1, affirmationsEnabled: false });
    assert.equal((await ctx.repo.getProfile()).ambientSound, "soft-rain", "Profile shows the edit before it is sent");
    await sleep(1300);
    assert.deepEqual(ctx.calls.push, [{ affirmations_enabled: false, ambient_sound: "soft-rain", ambient_volume: 1 }]);
    assert.deepEqual(unsentOf(ctx), {});
    assert.equal(ctx.remote.server.ambient_sound, "soft-rain");
    assert.equal((await ctx.repo.getProfile()).ambientVolume, 1);
    // a second account on the same phone sees its own settings
    ctx.session.userId = "user_b";
    ctx.remote.server = row({ id: "user_b" });
    const b = await ctx.repo.getProfile();
    assert.equal(b.ambientSound, "off");
    assert.equal(b.affirmationsEnabled, true);
    ctx.session.userId = "user_a";
    assert.equal((await ctx.repo.getProfile()).ambientSound, "soft-rain");
  });
  await test("repo: updateProfile offline keeps the edit and shows it, and the next sync sends it", async () => {
    const ctx = await repoEnv();
    await ctx.repo.getProfile();
    ctx.remote.fetchFails = bad("NETWORK");
    await ctx.repo.updateProfile({ affirmationsEnabled: false });
    await sleep(1300); // the scheduled sync fails
    assert.equal(ctx.calls.push.length, 0);
    assert.deepEqual(unsentOf(ctx), { affirmationsEnabled: false });
    assert.equal((await ctx.repo.getProfile()).affirmationsEnabled, false);
    ctx.remote.fetchFails = null;
    ctx.env.use("@/services/profileSync").syncProfileOnForeground();
    await sleep(120);
    assert.deepEqual(ctx.calls.push, [{ affirmations_enabled: false }]);
    assert.deepEqual(unsentOf(ctx), {});
  });
  await test("repo: updateProfile rejects bad input and honours the dev failure flag", async () => {
    const ctx = await repoEnv();
    await ctx.repo.getProfile();
    assert.equal((await ctx.repo.updateProfile({ ambientSound: "rain" })).code, "INVALID");
    assert.equal((await ctx.repo.updateProfile({ ambientVolume: Number.NaN })).code, "INVALID");
    assert.equal((await ctx.repo.updateProfile({ affirmationsEnabled: "no" })).code, "INVALID");
    assert.equal((await ctx.repo.updateProfile({})).ok, true);
    assert.deepEqual(unsentOf(ctx), {}, "a bad or empty change is never kept");
    ctx.env.use("@/store/devStore").useDevStore.getState().setNextPrayerMutationFails(true);
    assert.equal((await ctx.repo.updateProfile({ ambientSound: "soft-rain" })).code, "NETWORK");
    assert.deepEqual(unsentOf(ctx), {}, "a refused save is not kept");
    assert.equal((await ctx.repo.updateProfile({ ambientSound: "off" })).ok, true, "the flag was spent");
  });
  await test("repo: the mock source still works as in step 15", async () => {
    const ctx = await repoEnv({ source: "mock" });
    const { repo, calls } = ctx;
    const profile = await repo.getProfile();
    assert.equal(profile.id, "user_mock_sarah");
    assert.equal(profile.subscriptionTier, "free");
    assert.deepEqual(profile.reminders, DEFAULTS);
    const saved = await repo.updateProfile({ ambientSound: "gentle-piano", ambientVolume: 0.4 });
    assert.equal(saved.ok, true);
    assert.equal(saved.data.ambientSound, "gentle-piano");
    assert.equal((await repo.getProfile()).ambientVolume, 0.4);
    assert.equal(calls.fetch, 0);
    repo.setMockSubscriptionTier("pro");
    assert.equal(repo.getMockSubscriptionTier(), "pro");
    assert.equal((await repo.getUsage()).limit, null);
  });
  await test("repo: in supabase mode the screens show RevenueCat's plan, then the server's; the engine follows the server only; the mock plan no longer counts", async () => {
    const ctx = await repoEnv({ server: row({ tier: "free" }) });
    ctx.repo.setMockSubscriptionTier("trial");
    assert.equal((await ctx.repo.getUsage()).tier, "free", "the mock plan does not count on the real data source (step 30)");
    assert.equal(ctx.repo.getKnownTier(), "free");
    const entitlement = ctx.env.use("@/store/entitlementStore").useEntitlementStore;
    entitlement.getState().start(ctx.session.userId, "test_store");
    entitlement.getState().setEntitlement(ctx.session.userId, "pro", null);
    assert.equal((await ctx.repo.getUsage()).tier, "pro", "RevenueCat's answer shows first");
    assert.equal((await ctx.repo.getUsage()).limit, null);
    assert.equal(ctx.repo.getKnownTier(), "free", "the sync engine follows the server's plan only");
    entitlement.getState().start("someone_else", "test_store");
    entitlement.getState().setEntitlement("someone_else", "pro", null);
    assert.equal((await ctx.repo.getUsage()).tier, "free", "another account's entitlement never counts");
    assert.equal((await ctx.repo.getProfile()).subscriptionTier, "free");
  });
  await test("account: sign-out cleanup drops the unsent reminder edit and keeps the user's unsent settings; delete forgets them", async () => {
    const ctx = await repoEnv();
    await ctx.repo.getProfile();
    await ctx.repo.updateProfile({ ambientSound: "soft-rain" });
    const ob = obOf(ctx);
    ob.getState().setReminder("morning", "05:00");
    const account = ctx.env.use("@/services/account");
    await account.signOutCleanup();
    assert.equal(ctx.calls.recordingsDeleted, 1, "sign out deletes the finished recordings on the phone");
    assert.equal(ctx.calls.devotionalsDeleted, 1, "sign out deletes the downloaded devotionals too");
    assert.equal(ctx.calls.affirmationsCleared, 1, "and clears the affirmation notifications");
    assert.equal(ctx.calls.planWatchStopped, 1, "and stops the plan watch");
    assert.equal(ctx.calls.revenueCatEnded, 1, "and logs out of RevenueCat");
    assert.equal(ob.getState().remindersDirty, false);
    assert.deepEqual(unsentOf(ctx), { ambientSound: "soft-rain" }, "sign out keeps the user's unsent setting");
    await sleep(1000);
    assert.equal(ctx.calls.fetch, 1, "the debounce was cancelled: nothing was sent after sign out");
    const deleted = await account.deleteAccount();
    assert.equal(deleted.ok, true);
    assert.equal(ctx.calls.recordingsDeleted, 2, "account deletion deletes the recordings too");
    assert.equal(ctx.calls.devotionalsDeleted, 2, "and the downloaded devotionals");
    assert.equal(ctx.calls.affirmationsCleared, 2, "and the affirmation notifications");
    assert.equal(ctx.calls.revenueCatEnded, 2, "and logs out of RevenueCat");
    assert.equal(prefsOf(ctx).getState().byUser.user_a, undefined, "delete forgets them");
  });

  // ========================================================================== F. client + remote over a fake PostgREST
  // The fake enforces what the migration enforces: the column grants (403 / 42501), the check constraints (400 / 23514),
  // float4 storage for the volume, and, when asked, a database that has not had the migration yet (PGRST204).
  const INSERT_COLUMNS = ["id", "reminder_morning", "reminder_afternoon", "reminder_evening", "timezone", "affirmations_enabled", "ambient_sound", "ambient_volume"];
  const UPDATE_COLUMNS = INSERT_COLUMNS.filter((column) => column !== "id");
  const STEP18_COLUMNS = ["timezone", "affirmations_enabled", "ambient_sound", "ambient_volume", "updated_at"];
  const SOUNDS = ["off", "soft-rain", "gentle-piano", "morning-birds"];
  // Postgres prints a float4 with the fewest digits that read back as the same float4.
  function float4(x) {
    for (let digits = 1; digits <= 9; digits++) {
      const candidate = Number(x.toPrecision(digits));
      if (Math.fround(candidate) === Math.fround(x)) return candidate;
    }
    return x;
  }
  function fakeBackend() {
    const table = new Map();
    const requests = [];
    const violations = [];
    const behavior = { mode: "normal", failWith: null, missingColumns: false };
    const tokens = { tokA: "user_a", tokB: "user_b" };
    const json = (status, body) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const stored = (body) => ("ambient_volume" in body ? { ...body, ambient_volume: float4(body.ambient_volume) } : body);
    const shown = (r) => (behavior.missingColumns ? Object.fromEntries(Object.entries(r).filter(([key]) => !STEP18_COLUMNS.includes(key))) : r);
    function refuse(body, allowed) {
      const extra = Object.keys(body).filter((key) => !allowed.includes(key));
      if (extra.length > 0) {
        violations.push(`grant: ${extra.join(", ")}`);
        return json(403, { code: "42501", message: "permission denied for table users_profile", details: null, hint: null });
      }
      if (behavior.missingColumns && Object.keys(body).some((key) => STEP18_COLUMNS.includes(key))) {
        return json(400, { code: "PGRST204", message: "Could not find a column of 'users_profile' in the schema cache", details: null, hint: null });
      }
      const check =
        ("ambient_sound" in body && !SOUNDS.includes(body.ambient_sound)) ||
        ("ambient_volume" in body && !(body.ambient_volume >= 0 && body.ambient_volume <= 1)) ||
        ("timezone" in body && !(typeof body.timezone === "string" && body.timezone.length >= 1 && body.timezone.length <= 64)) ||
        ("affirmations_enabled" in body && typeof body.affirmations_enabled !== "boolean");
      if (check) {
        violations.push("check constraint");
        return json(400, { code: "23514", message: "new row violates check constraint", details: null, hint: null });
      }
      return null;
    }
    async function fake(input, init = {}) {
      const url = new URL(typeof input === "string" ? input : input.url);
      // supabase-js hands over a Headers instance, postgrest-js a plain object: read both.
      const rawHeaders = init.headers instanceof Headers ? [...init.headers.entries()] : Object.entries(init.headers ?? {});
      const headers = Object.fromEntries(rawHeaders.map(([k, v]) => [k.toLowerCase(), v]));
      requests.push({ method: init.method ?? "GET", path: url.pathname, search: url.search, headers, body: init.body ? JSON.parse(init.body) : null });
      if (behavior.mode === "offline") throw new TypeError("Network request failed");
      if (behavior.failWith) return json(behavior.failWith.status, behavior.failWith.body);
      const bearer = (headers.authorization ?? "").replace(/^Bearer /, "");
      const sub = tokens[bearer];
      if (!sub) return json(401, { code: "PGRST301", message: "JWT invalid", details: null, hint: null });
      const idFilter = /^eq\.(.+)$/.exec(url.searchParams.get("id") ?? "")?.[1];
      const method = init.method ?? "GET";
      if (method === "GET") {
        const rows = [...table.values()].filter((r) => r.id === sub && (idFilter === undefined || r.id === idFilter));
        return json(200, rows.map(shown));
      }
      if (method === "HEAD") {
        const n = [...table.values()].filter((r) => r.id === sub).length;
        return new Response(null, { status: 200, headers: { "content-range": n === 0 ? "*/0" : `0-${n - 1}/${n}` } });
      }
      if (method === "POST") {
        const body = JSON.parse(init.body);
        const refused = refuse(body, INSERT_COLUMNS);
        if (refused) return refused;
        if (body.id !== sub) return json(403, { code: "42501", message: 'new row violates row-level security policy for table "users_profile"' });
        if (!table.has(body.id)) {
          table.set(body.id, {
            created_at: "2026-10-22T09:00:00+00:00",
            subscription_tier: "free",
            last_active_at: null,
            reminder_morning: "08:00:00",
            reminder_afternoon: "13:00:00",
            reminder_evening: "20:00:00",
            affirmations_enabled: true,
            ambient_sound: "off",
            ambient_volume: 0.5,
            timezone: "UTC",
            updated_at: "2026-10-22T09:00:00+00:00",
            ...stored(body),
          });
        }
        return new Response(null, { status: 201 });
      }
      if (method === "PATCH") {
        const body = JSON.parse(init.body);
        const refused = refuse(body, UPDATE_COLUMNS);
        if (refused) return refused;
        const found = [...table.values()].filter((r) => r.id === sub && (idFilter === undefined || r.id === idFilter));
        found.forEach((r) => Object.assign(r, stored(body), { updated_at: "2026-10-22T10:00:00+00:00" }));
        return json(200, found.map(shown));
      }
      return json(405, { message: "method" });
    }
    return { fake, table, requests, behavior, violations };
  }
  async function clientEnv(token = "tokA") {
    const backend = fakeBackend();
    globalThis.fetch = backend.fake;
    const env = makeEnv({
      fakes: {
        "@/store/playerStore": { usePlayerStore: { getState: () => ({ stop: () => undefined }) } },
        "@/services/recordingFiles": { deleteAllRecordings: async () => undefined },
        "@/services/devotionalAudio": { deleteAllDevotionalAudio: async () => undefined },
        "@/services/affirmationScheduler": { clearAffirmations: async () => undefined },
        "@/services/subscriptionSync": { stopPlanWatch: () => undefined },
        "@/services/revenuecat": { endRevenueCatSession: async () => undefined },
        "@/db/database": { isDatabaseOpen: () => false, deleteUserDatabase: async () => undefined },
        "@/db/outbox": {},
        "@/db/cache": {},
        "@/db/mutations": {},
        "@/services/offlineSession": { endOfflineSession: async () => undefined },
      },
    });
    await env.use("@/store/onboardingStore").useOnboardingStore.persist.rehydrate();
    await env.use("@/store/profilePrefsStore").useProfilePrefsStore.persist.rehydrate();
    const client = env.use("@/services/supabaseClient");
    const remote = env.use("@/data/profileRemote");
    env.use("@/store/devStore").useDevStore.getState().setDataSource("supabase");
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    const restore = () => {
      console.warn = originalWarn;
    };
    client.setSupabaseSession({ userId: token === "tokB" ? "user_b" : "user_a", getToken: async () => token });
    return { backend, client, remote, warnings, restore, env };
  }
  await test("client: no session, nothing is sent", async () => {
    const { client, remote, backend, restore } = await clientEnv();
    client.setSupabaseSession(null);
    assert.equal(client.getSupabase(), null);
    const result = await remote.selectProfileRow();
    restore();
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(backend.requests.length, 0);
  });
  await test("client: a session with no token fails fast, with no request and no retry delay", async () => {
    const { client, remote, backend, restore } = await clientEnv(null);
    client.setSupabaseSession({ userId: "user_a", getToken: async () => null });
    const started = Date.now();
    const result = await remote.selectProfileRow();
    const elapsed = Date.now() - started;
    restore();
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(backend.requests.length, 0);
    assert.ok(elapsed < 500, `took ${elapsed} ms`);
  });
  await test("client: create, then find it again: the headers and the one body are right", async () => {
    const { remote, backend, restore } = await clientEnv();
    const created = await remote.fetchOrCreateProfileRow();
    assert.equal(created.ok, true);
    assert.equal(created.data.id, "user_a");
    assert.equal(created.data.subscription_tier, "free");
    assert.deepEqual(backend.requests.map((r) => r.method), ["GET", "POST", "GET"]);
    const post = backend.requests[1];
    assert.deepEqual(Object.keys(post.body).sort(), ["id", "reminder_afternoon", "reminder_evening", "reminder_morning", "timezone"]);
    assert.equal(post.body.id, "user_a");
    assert.equal(post.body.reminder_morning, "08:00:00");
    assert.equal(post.body.timezone, ZONE);
    assert.match(post.search, /on_conflict=id/);
    assert.match(post.headers.prefer ?? "", /resolution=ignore-duplicates/);
    for (const r of backend.requests) {
      assert.equal(r.headers.authorization, "Bearer tokA", "the Clerk token is the bearer, never the publishable key");
      assert.equal(r.headers.apikey, "sb_publishable_testkey");
      assert.equal(r.headers["x-retry-count"], undefined);
    }
    backend.requests.length = 0;
    const second = await remote.fetchOrCreateProfileRow();
    restore();
    assert.equal(second.ok, true);
    assert.deepEqual(backend.requests.map((r) => r.method), ["GET"]);
    assert.deepEqual(backend.violations, []);
  });
  await test("client: the new row carries the settings the user changed before the account existed", async () => {
    const { remote, backend, env, restore } = await clientEnv();
    env.use("@/store/profilePrefsStore").useProfilePrefsStore.getState().saveUnsent("user_a", { ambientSound: "soft-rain", ambientVolume: 0.37 });
    const created = await remote.fetchOrCreateProfileRow();
    restore();
    assert.equal(created.ok, true);
    const post = backend.requests[1];
    assert.deepEqual(Object.keys(post.body).sort(), ["ambient_sound", "ambient_volume", "id", "reminder_afternoon", "reminder_evening", "reminder_morning", "timezone"]);
    assert.equal(created.data.ambient_sound, "soft-rain");
    assert.equal(created.data.ambient_volume, 0.37);
    assert.deepEqual(backend.violations, []);
  });
  await test("client: an existing row is returned with no insert", async () => {
    const { remote, backend, restore } = await clientEnv();
    backend.table.set("user_a", { ...row({ t: { morning: "06:00", afternoon: "12:00", evening: "21:00" } }) });
    const result = await remote.fetchOrCreateProfileRow();
    restore();
    assert.equal(result.ok, true);
    assert.equal(result.data.reminder_morning, "06:00:00");
    assert.deepEqual(backend.requests.map((r) => r.method), ["GET"]);
  });
  await test("client: pushProfileColumns sends exactly the columns it is given and answers with the row", async () => {
    const { remote, backend, restore } = await clientEnv();
    backend.table.set("user_a", row());
    const result = await remote.pushProfileColumns({ ambient_sound: "morning-birds", ambient_volume: 0.37 });
    restore();
    assert.equal(result.ok, true);
    assert.equal(result.data.ambient_sound, "morning-birds");
    assert.equal(result.data.ambient_volume, 0.37);
    assert.equal(result.data.updated_at, "2026-10-22T10:00:00+00:00");
    const patch = backend.requests[0];
    assert.equal(patch.method, "PATCH");
    assert.deepEqual(Object.keys(patch.body).sort(), ["ambient_sound", "ambient_volume"]);
    assert.match(patch.search, /id=eq\.user_a/);
    assert.deepEqual(backend.violations, []);
  });
  await test("client: reminderColumns and settingColumns build exactly the granted columns", async () => {
    const { remote, restore } = await clientEnv();
    restore();
    assert.deepEqual(remote.reminderColumns({ morning: "07:10", afternoon: "12:20", evening: "21:30" }), {
      reminder_morning: "07:10:00",
      reminder_afternoon: "12:20:00",
      reminder_evening: "21:30:00",
    });
    assert.deepEqual(remote.settingColumns({}), {});
    assert.deepEqual(remote.settingColumns({ ambientSound: "off" }), { ambient_sound: "off" });
    assert.deepEqual(remote.settingColumns({ affirmationsEnabled: false, ambientVolume: 0, ambientSound: "soft-rain" }), {
      affirmations_enabled: false,
      ambient_volume: 0,
      ambient_sound: "soft-rain",
    });
  });
  await test("client: an update that changes no row is NOT_FOUND", async () => {
    const { remote, restore } = await clientEnv();
    const result = await remote.pushProfileColumns({ reminder_morning: "07:10:00" });
    restore();
    assert.equal(result.code, "NOT_FOUND");
  });
  await test("client: the row count asks for a count and reads it back", async () => {
    const { remote, backend, restore } = await clientEnv();
    backend.table.set("user_a", row());
    backend.table.set("user_b", row({ id: "user_b" }));
    backend.table.set("user_c", row({ id: "user_c" }));
    const result = await remote.countVisibleProfileRows();
    restore();
    assert.deepEqual(result, { ok: true, data: 1 });
    assert.equal(backend.requests[0].method, "HEAD");
    assert.match(backend.requests[0].headers.prefer ?? "", /count=exact/);
  });
  await test("client: offline fails at once with NETWORK (no 7 s of retries)", async () => {
    const { remote, backend, restore } = await clientEnv();
    backend.behavior.mode = "offline";
    const started = Date.now();
    const result = await remote.selectProfileRow();
    const elapsed = Date.now() - started;
    restore();
    assert.equal(result.code, "NETWORK");
    assert.equal(backend.requests.length, 1, "one attempt");
    assert.ok(elapsed < 500, `took ${elapsed} ms`);
  });
  await test("client: Clerk failing to give a token (offline) is NETWORK", async () => {
    const { client, remote, backend, restore } = await clientEnv();
    client.setSupabaseSession({ userId: "user_a", getToken: async () => { throw new Error("ClerkRuntimeError: network_error"); } });
    const result = await remote.selectProfileRow();
    restore();
    assert.equal(result.code, "NETWORK");
    assert.equal(backend.requests.length, 0);
  });
  await test("client: HTTP failures map to the codes, and the dev hints name the fix", async () => {
    const { remote, backend, restore, warnings } = await clientEnv();
    backend.behavior.failWith = { status: 401, body: { code: "PGRST303", message: "JWT expired", details: null, hint: null } };
    assert.equal((await remote.selectProfileRow()).code, "UNAUTHORIZED");
    backend.behavior.failWith = { status: 403, body: { code: "42501", message: "permission denied for table users_profile", details: null, hint: null } };
    assert.equal((await remote.selectProfileRow()).code, "UNAUTHORIZED");
    assert.ok(warnings.some((w) => /row level security refused/.test(w) && /supabase\/migrations/.test(w)), "the dev hint is printed");
    backend.behavior.failWith = { status: 400, body: { code: "PGRST204", message: "Could not find the 'timezone' column of 'users_profile' in the schema cache", details: null, hint: null } };
    assert.equal((await remote.pushProfileColumns({ timezone: "UTC" })).code, "UNKNOWN");
    assert.equal(remote.getLastProfileError(), "users_profile: PGRST204");
    assert.ok(warnings.some((w) => /a column is missing/.test(w) && /20261022120100_gracehush_v1_schema/.test(w)), "the migration hint is printed");
    backend.behavior.failWith = { status: 500, body: { message: "boom" } };
    assert.equal((await remote.selectProfileRow()).code, "UNKNOWN");
    assert.equal(remote.getLastProfileError(), "users_profile: HTTP 500");
    backend.behavior.failWith = null;
    backend.table.set("user_a", row());
    assert.equal((await remote.selectProfileRow()).ok, true);
    assert.equal(remote.getLastProfileError(), null);
    restore();
    // nothing printed may carry a message, a row, a token or an id
    for (const line of warnings) {
      assert.ok(!/tokA|user_a|JWT|boom|permission denied|Could not find/i.test(line), line);
    }
  });
  await test("client: checkSessionToken reads a label and never the token", async () => {
    const { client, restore } = await clientEnv();
    client.setSupabaseSession({ userId: "user_a", getToken: async () => jwt({ role: "authenticated", sub: "user_a" }) });
    assert.equal(await client.checkSessionToken(), "ok");
    client.setSupabaseSession({ userId: "user_a", getToken: async () => jwt({ sub: "user_a" }) });
    assert.equal(await client.checkSessionToken(), "no-role-claim");
    client.setSupabaseSession({ userId: "user_a", getToken: async () => "junk" });
    assert.equal(await client.checkSessionToken(), "unreadable");
    client.setSupabaseSession({ userId: "user_a", getToken: async () => null });
    assert.equal(await client.checkSessionToken(), "no-session");
    client.setSupabaseSession({ userId: "user_a", getToken: async () => { throw new Error("offline"); } });
    assert.equal(await client.checkSessionToken(), "unreadable");
    client.setSupabaseSession(null);
    assert.equal(await client.checkSessionToken(), "no-session");
    restore();
  });
  await test("client: supabase.auth is unusable, as the docs say", async () => {
    const { client, restore } = await clientEnv();
    const supabase = client.getSupabase();
    restore();
    assert.throws(() => supabase.auth.getSession(), /accessToken option/);
  });
  await test("client: the fake database itself refuses the plan, a created_at and a bad value (so the checks below mean something)", async () => {
    const { client, backend, restore } = await clientEnv();
    backend.table.set("user_a", row());
    const supabase = client.getSupabase();
    const plan = await supabase.from("users_profile").update({ subscription_tier: "pro" }).eq("id", "user_a").select();
    const created = await supabase.from("users_profile").update({ created_at: "2020-01-01" }).eq("id", "user_a").select();
    const sound = await supabase.from("users_profile").update({ ambient_sound: "rain" }).eq("id", "user_a").select();
    const volume = await supabase.from("users_profile").update({ ambient_volume: 2 }).eq("id", "user_a").select();
    restore();
    assert.deepEqual([plan.error.code, created.error.code, sound.error.code, volume.error.code], ["42501", "42501", "23514", "23514"]);
    assert.equal(backend.violations.length, 4);
  });

  // ========================================================================== G. everything together
  async function wholeEnv() {
    const ctx = await clientEnv();
    const repo = ctx.env.use("@/data/journalRepository");
    return { ...ctx, repo, ob: ctx.env.use("@/store/onboardingStore").useOnboardingStore, prefs: ctx.env.use("@/store/profilePrefsStore").useProfilePrefsStore, sync: ctx.env.use("@/services/profileSync") };
  }
  await test("whole: sign-up creates the row from this phone in one POST, including settings changed before the account existed", async () => {
    const { backend, repo, ob, prefs, sync, restore } = await wholeEnv();
    ob.getState().setReminder("morning", "07:30");
    prefs.getState().saveUnsent("user_a", { ambientSound: "gentle-piano", affirmationsEnabled: false });
    const stop = sync.watchReminderEdits();
    const profile = await repo.getProfile(); // the first call waits for the sync
    const saved = backend.table.get("user_a");
    assert.equal(saved.reminder_morning, "07:30:00");
    assert.equal(saved.ambient_sound, "gentle-piano");
    assert.equal(saved.affirmations_enabled, false);
    assert.equal(saved.timezone, ZONE);
    assert.equal(profile.reminders.morning, "07:30");
    assert.equal(profile.ambientSound, "gentle-piano");
    assert.equal(ob.getState().remindersDirty, false);
    assert.deepEqual(prefs.getState().byUser.user_a.unsent, {}, "the server has them, so nothing is left to send");
    assert.deepEqual(backend.requests.map((r) => r.method), ["GET", "POST", "GET"], "one sign-in, no PATCH");
    stop();
    restore();
    assert.deepEqual(backend.violations, []);
  });
  await test("whole: Profile edits reach the table, one column set per edit", async () => {
    const { backend, repo, ob, sync, restore } = await wholeEnv();
    const stop = sync.watchReminderEdits();
    await repo.getProfile();
    backend.requests.length = 0;
    await repo.updateProfile({ ambientSound: "soft-rain" });
    await repo.updateProfile({ ambientVolume: 0.37 });
    ob.getState().setReminder("evening", "22:15");
    await sleep(1300);
    const saved = backend.table.get("user_a");
    assert.equal(saved.ambient_sound, "soft-rain");
    assert.equal(saved.ambient_volume, 0.37);
    assert.equal(saved.reminder_evening, "22:15:00");
    const patches = backend.requests.filter((r) => r.method === "PATCH");
    assert.equal(patches.length, 1, "three edits inside 800 ms are one request");
    assert.deepEqual(Object.keys(patches[0].body).sort(), ["ambient_sound", "ambient_volume", "reminder_afternoon", "reminder_evening", "reminder_morning"]);
    assert.equal(ob.getState().remindersDirty, false);
    stop();
    restore();
    assert.deepEqual(backend.violations, []);
  });
  await test("whole: another phone's change arrives with the next sync when nothing is unsent", async () => {
    const { backend, repo, ob, sync, restore } = await wholeEnv();
    await repo.getProfile();
    Object.assign(backend.table.get("user_a"), { reminder_morning: "05:45:00", ambient_sound: "morning-birds", ambient_volume: 0.9, affirmations_enabled: false });
    await sync.syncProfile();
    const after = await repo.getProfile();
    assert.equal(ob.getState().reminders.morning, "05:45");
    assert.deepEqual([after.reminders.morning, after.ambientSound, after.ambientVolume, after.affirmationsEnabled], ["05:45", "morning-birds", 0.9, false]);
    restore();
  });
  await test("whole: an unsent setting wins over the server's value and is sent after reconnecting", async () => {
    const { backend, repo, prefs, sync, restore } = await wholeEnv();
    await repo.getProfile();
    backend.behavior.mode = "offline";
    await repo.updateProfile({ ambientVolume: 0.2 });
    const failed = await sync.syncProfile();
    assert.equal(failed.code, "NETWORK");
    assert.equal((await repo.getProfile()).ambientVolume, 0.2, "Profile still shows the edit offline");
    assert.deepEqual(prefs.getState().byUser.user_a.unsent, { ambientVolume: 0.2 });
    backend.behavior.mode = "normal";
    backend.table.get("user_a").ambient_volume = 0.9; // meanwhile another phone set 0.9
    sync.syncProfileOnForeground();
    await sleep(150);
    assert.equal(backend.table.get("user_a").ambient_volume, 0.2, "the edit made on this phone is the newest");
    assert.deepEqual(prefs.getState().byUser.user_a.unsent, {});
    restore();
    assert.deepEqual(backend.violations, []);
  });
  await test("whole: offline reminder edit, reconnect, foreground: it syncs", async () => {
    const { backend, repo, ob, sync, restore } = await wholeEnv();
    await repo.getProfile();
    backend.behavior.mode = "offline";
    ob.getState().setReminder("afternoon", "15:45");
    const failed = await sync.syncProfile();
    assert.equal(failed.code, "NETWORK");
    assert.equal(ob.getState().remindersDirty, true);
    assert.equal((await repo.getProfile()).reminders.afternoon, "15:45", "Profile still shows the edit offline");
    backend.behavior.mode = "normal";
    sync.syncProfileOnForeground();
    await sleep(150);
    assert.equal(backend.table.get("user_a").reminder_afternoon, "15:45:00");
    assert.equal(ob.getState().remindersDirty, false);
    restore();
  });
  await test("whole: a second account never gets the first one's unsent edits, and the first still has its own", async () => {
    const { backend, client, ob, prefs, sync, env, restore } = await wholeEnv();
    backend.table.set("user_b", row({ id: "user_b", t: { morning: "09:00", afternoon: "14:00", evening: "21:00" } }));
    ob.getState().setReminder("morning", "05:00"); // account A, never sent
    prefs.getState().saveUnsent("user_a", { ambientSound: "soft-rain" }); // account A, never sent
    await env.use("@/services/account").signOutCleanup(); // A signs out
    client.setSupabaseSession({ userId: "user_b", getToken: async () => "tokB" });
    await sync.syncProfile();
    assert.equal(backend.table.get("user_b").reminder_morning, "09:00:00", "B's row is untouched");
    assert.equal(backend.table.get("user_b").ambient_sound, "off", "B's row is untouched");
    assert.equal(ob.getState().reminders.morning, "09:00");
    assert.deepEqual(prefs.getState().byUser.user_a.unsent, { ambientSound: "soft-rain" });
    // A signs back in: the setting that waited is sent now
    client.setSupabaseSession({ userId: "user_a", getToken: async () => "tokA" });
    await sync.syncProfile();
    assert.equal(backend.table.get("user_a").ambient_sound, "soft-rain");
    restore();
    assert.deepEqual(backend.violations, []);
  });
  await test("whole: upgrading from step 17 (settings kept on the phone, a row at the defaults on the server)", async () => {
    const backend = fakeBackend();
    globalThis.fetch = backend.fake;
    const v1 = {
      state: {
        byUser: {
          user_a: {
            prefs: { ambientSound: "soft-rain", affirmationsEnabled: false },
            snapshot: { createdAt: "2026-10-01T12:00:00.000Z", subscriptionTier: "free", syncedAt: "2026-10-22T10:00:00.000Z" },
          },
        },
      },
      version: 1,
    };
    backend.table.set("user_a", row());
    const env = makeEnv({
      stored: { "gracehush.profilePrefs": JSON.stringify(v1) },
      fakes: {
        "@/store/playerStore": { usePlayerStore: { getState: () => ({ stop: () => undefined }) } },
        // Step 24: journalRepository.ts imports the user's database, which plain Node cannot load.
        "@/db/database": { isDatabaseOpen: () => false },
        "@/db/outbox": {},
        "@/db/cache": {},
        "@/db/mutations": {},
      },
    });
    await env.use("@/store/onboardingStore").useOnboardingStore.persist.rehydrate();
    const prefs = env.use("@/store/profilePrefsStore").useProfilePrefsStore;
    await prefs.persist.rehydrate();
    env.use("@/store/devStore").useDevStore.getState().setDataSource("supabase");
    const client = env.use("@/services/supabaseClient");
    client.setSupabaseSession({ userId: "user_a", getToken: async () => "tokA" });
    const originalWarn = console.warn;
    console.warn = () => undefined;
    const repo = env.use("@/data/journalRepository");
    const before = await repo.getProfile(); // a snapshot from step 17: Profile opens at once, with the phone's settings on top
    assert.equal(before.ambientSound, "soft-rain");
    assert.equal(backend.requests.length, 0, "no request was needed to open Profile");
    await env.use("@/services/profileSync").syncProfile();
    console.warn = originalWarn;
    const saved = backend.table.get("user_a");
    assert.deepEqual([saved.ambient_sound, saved.affirmations_enabled, saved.ambient_volume], ["soft-rain", false, 0.5]);
    assert.deepEqual(prefs.getState().byUser.user_a.unsent, {});
    assert.deepEqual(backend.requests.map((r) => r.method), ["GET", "PATCH"]);
    assert.deepEqual(Object.keys(backend.requests[1].body).sort(), ["affirmations_enabled", "ambient_sound"]);
    assert.deepEqual(backend.violations, []);
  });
  await test("whole: a database that has not had the migration fails loudly and keeps the edit", async () => {
    const { backend, repo, prefs, sync, restore, warnings, env } = await wholeEnv();
    backend.behavior.missingColumns = true;
    backend.table.set("user_a", row());
    const profile = await repo.getProfile();
    assert.equal(profile.ambientSound, "off", "the mapper falls back to the defaults for the missing columns");
    await repo.updateProfile({ ambientSound: "soft-rain" });
    const result = await sync.syncProfile();
    assert.equal(result.ok, false);
    assert.equal(env.use("@/data/profileRemote").getLastProfileError(), "users_profile: PGRST204");
    assert.ok(warnings.some((w) => /a column is missing/.test(w)));
    assert.deepEqual(prefs.getState().byUser.user_a.unsent, { ambientSound: "soft-rain" }, "the edit is kept for after the migration");
    assert.equal((await repo.getProfile()).ambientSound, "soft-rain");
    sync.cancelProfileSync();
    restore();
  });

  // ------------------------------------------------------------------------ report
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
