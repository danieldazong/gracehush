// The step 34 checks: product analytics. They run the app's real TypeScript (the policy and its filter, the client wrapper, the
// env check, and the onboarding and entitlement stores) against a fake posthog-react-native 4.85.1: a PostHog class that records
// its constructor options and every call, runs `before_send` on what it captures, keeps a queue, drops events while opted out,
// and clears what reset() clears (the opt-in, the super properties and the id, never the queue). The sync engine, the navigation
// ref and the player store are small stand-ins a check drives itself. Nothing reaches PostHog or the network.
//
//   node --no-warnings supabase/tests/analytics/run.cjs
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/analytics/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
process.env.GRACEHUSH_REPO = REPO;
const { makeEnv } = require("../profile-sync/loader.cjs");
const zustand = require(path.join(REPO, "node_modules", "zustand"));

// A made-up token of the right shape, never a real one.
const TOKEN = "phc_TestToken0123456789abcdefABCDEF";
const EU = "https://eu.i.posthog.com";
const US = "https://us.i.posthog.com";

let passed = 0;
const failures = [];
let stopped = false;

async function test(name, run) {
  // ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either).
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (stopped) return;
  let limit;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        limit = setTimeout(() => reject(new Error("the check never finished: a promise was never settled")), 10000);
      }),
    ]);
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 7).join("\n    ")}`);
    if (process.env.FAILFAST) stopped = true;
  } finally {
    clearTimeout(limit);
  }
}

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// ------------------------------------------------------------------ the fake SDK
// What posthog-react-native 4.85.1 adds to an event before before_send runs (React Native, with expo-device and without
// expo-application or expo-localization): the library, the OS and the device, the screen size, the session, the
// person-profile flag and the location flag. Locale and time zone are listed too, so the filter is seen to drop them.
const SDK_PROPERTIES = {
  $lib: "posthog-react-native",
  $lib_version: "4.85.1",
  $os: "iOS",
  $os_name: "iOS",
  $os_version: "26.1",
  $device_type: "Mobile",
  $device_name: "iPhone15,2",
  $device_manufacturer: "Apple",
  $is_emulator: false,
  $screen_height: 852,
  $screen_width: 393,
  $locale: "en-NG",
  $timezone: "Africa/Lagos",
  $session_id: "0192f0aa-0000-7000-8000-00000000abcd",
  $is_identified: false,
  $process_person_profile: false,
  $geoip_disable: true,
  $sr_debug: "replay",
};

function makePostHog() {
  const instances = [];
  let ids = 0;
  const nextId = () => {
    ids += 1;
    return `0192f0aa-1111-7aaa-8bbb-cccc${String(ids).padStart(8, "0")}`;
  };
  class PostHog {
    constructor(token, options) {
      this.token = token;
      this.options = options;
      this.calls = [];
      this.queue = [];
      this.sent = [];
      this.superProperties = {};
      this.session = {};
      this.distinctId = nextId();
      this.optedOut = !(options?.defaultOptIn ?? true);
      instances.push(this);
    }
    record(...args) {
      this.calls.push(args);
    }
    async optIn() {
      this.record("optIn");
      this.optedOut = false;
    }
    async optOut() {
      this.record("optOut");
      this.optedOut = true;
    }
    capture(...args) {
      this.record("capture", ...args);
      this.enqueue(args[0], args[1]);
    }
    enqueue(event, properties) {
      // The SDK drops an event captured while opted out.
      if (this.optedOut) return;
      const message = {
        uuid: `uuid-${this.calls.length}`,
        event,
        properties: { ...SDK_PROPERTIES, ...this.superProperties, ...this.session, ...(properties ?? {}) },
        $set: { $device_name: "iPhone15,2" },
        $set_once: { $initial_os: "iOS" },
        timestamp: new Date(0),
      };
      const out = this.options?.before_send ? this.options.before_send(message) : message;
      if (out !== null && out !== undefined) this.queue.push(out);
    }
    async screen(...args) {
      this.record("screen", ...args);
      // The SDK keeps the last screen's name for the session, so later events carry it.
      this.session.$screen_name = args[0];
      this.enqueue("$screen", { ...(args[1] ?? {}), $screen_name: args[0] });
    }
    async register(properties) {
      this.record("register", properties);
      Object.assign(this.superProperties, properties);
    }
    async unregister(key) {
      this.record("unregister", key);
      delete this.superProperties[key];
    }
    // As in 4.85.1: a new anonymous id, and every stored value cleared but the queue (the opt-in and the super properties go).
    reset() {
      this.record("reset");
      this.distinctId = nextId();
      this.superProperties = {};
      this.session = {};
      this.optedOut = !(this.options?.defaultOptIn ?? true);
    }
    setPersistedProperty(key, value) {
      this.record("setPersistedProperty", key, value);
      if (key === "queue") this.queue = value ?? [];
    }
    getPersistedProperty(key) {
      return key === "queue" ? this.queue : undefined;
    }
    getDistinctId() {
      return this.distinctId;
    }
    async flush() {
      this.record("flush");
      this.sent.push(...this.queue);
      this.queue = [];
    }
  }
  return {
    instances,
    module: { __esModule: true, PostHog, PostHogPersistedProperty: { Queue: "queue" } },
  };
}

// ------------------------------------------------------------------ one world per check
function setPostHogEnv(token, host) {
  if (token === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN;
  else process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN = token;
  if (host === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
  else process.env.EXPO_PUBLIC_POSTHOG_HOST = host;
}

// `consent` is what the onboarding store has saved on the phone (version 3), or undefined for a fresh install. A token or
// host given as undefined means the variable is not set (a destructuring default would put the test token back).
function world(options = {}) {
  const { consent } = options;
  const token = "token" in options ? options.token : TOKEN;
  const host = "host" in options ? options.host : US;
  setPostHogEnv(token, host);
  const posthog = makePostHog();
  const listeners = new Set();
  const sync = {
    __esModule: true,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const nav = { ready: true, route: undefined };
  const navigation = {
    __esModule: true,
    navigationRef: {
      isReady: () => nav.ready,
      getCurrentRoute: () => (nav.route === undefined ? undefined : { key: `${nav.route}-1`, name: nav.route, params: { entryId: "entry-secret" } }),
    },
  };
  const player = zustand.create(() => ({ entryId: null, status: "idle", rate: 1 }));
  const stored =
    consent === undefined
      ? {}
      : {
          "gracehush.onboarding": JSON.stringify({
            state: {
              hasCompletedOnboarding: true,
              completedAt: "2026-10-31T09:00:00.000Z",
              reminders: { morning: "08:00", afternoon: "13:00", evening: "20:00" },
              permissionsPromptedAt: null,
              remindersSyncedAt: null,
              remindersDirty: false,
              analyticsConsent: consent,
            },
            version: 3,
          }),
        };
  const env = makeEnv({
    stored,
    fakes: {
      "posthog-react-native": posthog.module,
      "expo-constants": { __esModule: true, default: { expoConfig: { version: "1.0.0" } } },
      "@/services/syncEngine": sync,
      "@/navigation/navigationRef": navigation,
      "@/store/playerStore": { __esModule: true, usePlayerStore: player },
    },
  });
  return {
    env,
    posthog,
    nav,
    player,
    emit: (event) => [...listeners].forEach((listener) => listener(event)),
    analytics: () => env.use("@/services/analytics"),
    policy: () => env.use("@/services/analyticsPolicy"),
    onboarding: () => env.use("@/store/onboardingStore").useOnboardingStore,
    entitlement: () => env.use("@/store/entitlementStore").useEntitlementStore,
    client: () => posthog.instances[0],
    // What the app does at launch: App.tsx starts analytics, and the onboarding store loads its saved state meanwhile.
    async start() {
      this.onboarding();
      this.analytics().startAnalytics();
      await settle();
    },
    // The events that left the filter and wait in the queue, by name.
    queued: () => (posthog.instances[0]?.queue ?? []).map((event) => event.event),
    captures: () => (posthog.instances[0]?.calls ?? []).filter((call) => call[0] === "capture"),
  };
}

// A message shaped like what the SDK hands to before_send.
function message(event, properties = {}, extra = {}) {
  return { uuid: "u-1", event, properties: { ...SDK_PROPERTIES, ...properties }, timestamp: new Date(0), ...extra };
}

const ALLOWED_COMMON = [
  "$lib",
  "$lib_version",
  "$os",
  "$os_name",
  "$os_version",
  "$device_type",
  "$session_id",
  "$is_identified",
  "$screen_name",
  "tier",
  "app_version",
  "build",
  "$process_person_profile",
  "$geoip_disable",
];

// ================================================================== the policy (pure)
async function policyChecks() {
  await test("policy: a valid catalog event keeps its own properties and the allowed SDK ones, loses $set and $set_once, and the two flags are forced", async () => {
    const { sanitizeEvent } = world().policy();
    const out = sanitizeEvent(
      message("devotional_played", { rate: 1.2, tier: "pro", app_version: "1.0.0", build: "release" }, { $set: { a: 1 }, $set_once: { b: 2 } }),
    );
    assert.notEqual(out, null);
    assert.equal(out.event, "devotional_played");
    assert.equal(out.uuid, "u-1");
    assert.equal(out.properties.rate, 1.2);
    assert.equal(out.properties.$lib, "posthog-react-native");
    assert.equal(out.properties.$os_version, "26.1");
    assert.equal(out.properties.tier, "pro");
    assert.equal(out.properties.$process_person_profile, false);
    assert.equal(out.properties.$geoip_disable, true);
    assert.equal(out.$set, undefined);
    assert.equal(out.$set_once, undefined);
    for (const key of Object.keys(out.properties)) assert.ok(ALLOWED_COMMON.includes(key) || key === "rate", key);
  });

  await test("policy: unknown events, every SDK event outside the list, and the names __proto__, constructor and the empty string are dropped", async () => {
    const { sanitizeEvent } = world().policy();
    for (const name of [
      "entry_submitted",
      "crisis_shown",
      "$autocapture",
      "$exception",
      "$feature_flag_called",
      "$identify",
      "$create_alias",
      "$groupidentify",
      "$pageview",
      "$snapshot",
      "$opt_in",
      "survey sent",
      "Application Installed",
      "Application Updated",
      "Deep Link Opened",
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "",
    ]) {
      assert.equal(sanitizeEvent(message(name, {})), null, name);
    }
  });

  await test("policy: ids, words, device details, the network address and location fields are dropped", async () => {
    const { sanitizeEvent } = world().policy();
    const out = sanitizeEvent(
      message("prayer_marked_answered", {
        has_note: true,
        entry_id: "00000000-0000-4000-8000-000000000001",
        note: "a gratitude note",
        title: "A prayer",
        distinct_id: "user_abc",
        $ip: "102.89.1.1",
        $geoip_city_name: "Lagos",
        $set: { email: "a@b.c" },
        $app_version: "1.0.0",
        $app_build: "1",
      }),
    );
    assert.notEqual(out, null);
    for (const key of [
      "entry_id",
      "note",
      "title",
      "distinct_id",
      "$ip",
      "$geoip_city_name",
      "$set",
      "$device_name",
      "$device_manufacturer",
      "$is_emulator",
      "$screen_height",
      "$screen_width",
      "$locale",
      "$timezone",
      "$sr_debug",
      "$app_version",
      "$app_build",
    ]) {
      assert.equal(key in out.properties, false, key);
    }
    assert.equal(out.properties.has_note, true);
  });

  await test("policy: a value outside its list, a wrong type, or a missing property drops the whole event", async () => {
    const { sanitizeEvent } = world().policy();
    const dropped = [
      ["devotional_played", { rate: 1.5 }],
      ["devotional_played", { rate: "1" }],
      ["devotional_completed", {}],
      ["ambient_changed", { sound: "rain", source: "profile" }],
      ["ambient_changed", { sound: "soft-rain", source: "settings" }],
      ["ambient_changed", { sound: "soft-rain" }],
      ["reflection_ready", { input: "audio", scripture_verified: true }],
      ["reflection_ready", { input: "text", scripture_verified: "yes" }],
      ["reflection_ready", { input: "text" }],
      ["entry_failed", { code: "AI_UNAVAILABLE" }],
      ["affirmation_favorited", {}],
      ["affirmation_notification_opened", { slot: "midday" }],
      ["paywall_viewed", { source: "limit_reached" }],
      ["purchase_completed", { plan: "weekly", trial: false }],
      ["purchase_completed", { plan: "annual" }],
      ["purchase_failed", { code: "STORE_PROBLEM" }],
      ["restore_completed", { found: 1 }],
      ["onboarding_completed", { permissions_prompted: null }],
      ["reflection_deleted", { source: "journal" }],
    ];
    for (const [name, props] of dropped) assert.equal(sanitizeEvent(message(name, props)), null, `${name} ${JSON.stringify(props)}`);
    const kept = [
      ["devotional_played", { rate: 0.8 }],
      ["devotional_completed", { rate: 1 }],
      ["ambient_changed", { sound: "off", source: "now_playing" }],
      ["reflection_ready", { input: "voice", scripture_verified: false }],
      ["entry_failed", { code: "OTHER" }],
      ["affirmation_notification_opened", { slot: "afternoon" }],
      ["purchase_failed", { code: "CANCELLED" }],
      ["data_export_requested", {}],
    ];
    for (const [name, props] of kept) assert.notEqual(sanitizeEvent(message(name, props)), null, `${name} ${JSON.stringify(props)}`);
  });

  await test("policy: data_export_requested keeps no property of its own, and an extra one is dropped", async () => {
    const { sanitizeEvent } = world().policy();
    const out = sanitizeEvent(message("data_export_requested", { size_bytes: 123, partial: true }));
    assert.notEqual(out, null);
    assert.equal("size_bytes" in out.properties, false);
    assert.equal("partial" in out.properties, false);
  });

  await test("policy: $screen keeps only a tracked name, and is dropped for Reflection, a Scholar conversation, Support Resources, Onboarding, Sign In, the tabs and no name", async () => {
    const { sanitizeEvent, TRACKED_SCREENS } = world().policy();
    assert.deepEqual([...TRACKED_SCREENS], ["Journal", "Scholar", "Prayers", "Profile", "NewEntry", "NowPlaying", "Paywall"]);
    for (const name of TRACKED_SCREENS) {
      const out = sanitizeEvent(message("$screen", { $screen_name: name, entryId: "x" }));
      assert.notEqual(out, null, name);
      assert.equal(out.properties.$screen_name, name);
      assert.equal("entryId" in out.properties, false);
    }
    for (const name of ["Reflection", "Conversation", "CrisisResources", "Onboarding", "SignIn", "MainTabs", "", undefined]) {
      assert.equal(sanitizeEvent(message("$screen", name === undefined ? {} : { $screen_name: name })), null, String(name));
    }
  });

  await test("policy: Scholar's two events keep only their fixed values, and the Paywall may say it came from Scholar", async () => {
    const { sanitizeEvent } = world().policy();
    const started = sanitizeEvent(message("scholar_conversation_started", { source: "reflection", conversationId: "c-1", text: "hello" }));
    assert.notEqual(started, null);
    assert.equal(started.properties.source, "reflection");
    assert.equal("conversationId" in started.properties, false, "never an id");
    assert.equal("text" in started.properties, false, "never a word of the conversation");
    assert.equal(sanitizeEvent(message("scholar_conversation_started", { source: "chat" })), null, "a source outside the list is dropped");
    const sent = sanitizeEvent(message("scholar_message_sent", { mode: "voice", turn: "follow_up", heavy: true }));
    assert.notEqual(sent, null);
    assert.deepEqual([sent.properties.mode, sent.properties.turn], ["voice", "follow_up"]);
    assert.equal("heavy" in sent.properties, false, "nothing about a heavy moment rides along");
    assert.equal(sanitizeEvent(message("scholar_message_sent", { mode: "text" })), null, "both properties are required");
    assert.equal(sanitizeEvent(message("scholar_message_sent", { mode: "video", turn: "first" })), null);
    assert.equal(sanitizeEvent(message("scholar_message_sent", { mode: "text", turn: "third" })), null, "a turn outside its list");
    assert.notEqual(sanitizeEvent(message("paywall_viewed", { source: "scholar" })), null);
    assert.equal(sanitizeEvent(message("paywall_viewed", { source: "chat" })), null);
  });

  await test("policy: the session's $screen_name rides along on other events only when it is a tracked screen", async () => {
    const { sanitizeEvent } = world().policy();
    assert.equal(sanitizeEvent(message("restore_completed", { found: true, $screen_name: "Profile" })).properties.$screen_name, "Profile");
    const fromReflection = sanitizeEvent(message("restore_completed", { found: true, $screen_name: "Reflection" }));
    assert.notEqual(fromReflection, null);
    assert.equal("$screen_name" in fromReflection.properties, false);
  });

  await test("policy: Application Opened loses its url, and the lifecycle events keep only the common properties", async () => {
    const { sanitizeEvent } = world().policy();
    const opened = sanitizeEvent(message("Application Opened", { url: "exp://192.168.1.5:8081", from_background: false }));
    assert.notEqual(opened, null);
    assert.equal("url" in opened.properties, false);
    assert.equal("from_background" in opened.properties, false);
    assert.notEqual(sanitizeEvent(message("Application Became Active", {})), null);
    assert.notEqual(sanitizeEvent(message("Application Backgrounded", {})), null);
  });

  await test("policy: the flags are forced whatever came in, and the super properties keep only their own values", async () => {
    const { sanitizeEvent } = world().policy();
    const out = sanitizeEvent(
      message("restore_completed", {
        found: false,
        $process_person_profile: true,
        $geoip_disable: false,
        $is_identified: true,
        tier: "enterprise",
        app_version: "1.0.0-beta.1",
        build: "staging",
        $lib: "x".repeat(65),
      }),
    );
    assert.equal(out.properties.$process_person_profile, false);
    assert.equal(out.properties.$geoip_disable, true);
    for (const key of ["$is_identified", "tier", "app_version", "build", "$lib"]) assert.equal(key in out.properties, false, key);
    const good = sanitizeEvent(message("restore_completed", { found: false, tier: "trial", app_version: "1.0", build: "development" }));
    assert.equal(good.properties.tier, "trial");
    assert.equal(good.properties.app_version, "1.0");
    assert.equal(good.properties.build, "development");
    assert.equal(good.properties.$is_identified, false);
  });

  await test("policy: screenToTrack and toEntryFailedCode", async () => {
    const { screenToTrack, toEntryFailedCode } = world().policy();
    assert.equal(screenToTrack("Journal"), "Journal");
    assert.equal(screenToTrack("NowPlaying"), "NowPlaying");
    assert.equal(screenToTrack("Reflection"), null);
    assert.equal(screenToTrack("CrisisResources"), null);
    assert.equal(screenToTrack(undefined), null);
    assert.equal(screenToTrack(""), null);
    for (const code of ["TOO_SHORT", "NO_SPEECH", "PAYLOAD_TOO_LARGE", "AUDIO_NOT_FOUND", "UNREADABLE"]) assert.equal(toEntryFailedCode(code), code);
    for (const code of ["INVALID_REQUEST", "METHOD_NOT_ALLOWED", "OTHER", "AI_UNAVAILABLE", "", null]) assert.equal(toEntryFailedCode(code), "OTHER", String(code));
  });

  await test("policy: the input is not changed", async () => {
    const { sanitizeEvent } = world().policy();
    const input = message("devotional_played", { rate: 1, $device_name: "iPhone" }, { $set: { a: 1 } });
    const before = JSON.stringify(input);
    sanitizeEvent(input);
    assert.equal(JSON.stringify(input), before);
  });
}

// ================================================================== env
async function envChecks() {
  await test("env: checkAnalyticsEnv answers missing, invalid and ok, and never echoes the token", async () => {
    const { checkAnalyticsEnv } = world().env.use("@/constants/env");
    assert.equal(checkAnalyticsEnv("", "").status, "missing");
    assert.equal(checkAnalyticsEnv("  ", " ").status, "missing");
    const personal = checkAnalyticsEnv("phx_PersonalKey0123456789abcdefABCDEF", US);
    assert.equal(personal.status, "invalid");
    assert.ok(personal.message.includes("personal API key"));
    assert.ok(!personal.message.includes("PersonalKey0123"), "the key itself is never in the message");
    for (const [token, host] of [
      ["abc", US],
      ["phc_short", US],
      [TOKEN, ""],
      ["", US],
      [TOKEN, "https://us.posthog.com"],
      [TOKEN, "https://eu.posthog.com"],
      [TOKEN, "https://us.i.posthog.com/batch"],
      [TOKEN, "http://us.i.posthog.com"],
      [TOKEN, "https://app.posthog.com"],
    ]) {
      const result = checkAnalyticsEnv(token, host);
      assert.equal(result.status, "invalid", `${token.slice(0, 4)} ${host}`);
      assert.ok(!result.message.includes(TOKEN), "the token is never in the message");
    }
    assert.deepEqual(checkAnalyticsEnv(` ${TOKEN} `, `${EU}/`), { status: "ok", token: TOKEN, host: EU });
    assert.deepEqual(checkAnalyticsEnv(TOKEN, `${US}//`), { status: "ok", token: TOKEN, host: US });
  });

  await test("env: analyticsEnv reads the two variables by their full names", async () => {
    assert.equal(world({ token: undefined, host: undefined }).env.use("@/constants/env").analyticsEnv.status, "missing");
    assert.equal(world({ token: TOKEN, host: US }).env.use("@/constants/env").analyticsEnv.status, "ok");
    assert.equal(world({ token: "phx_PersonalKey0123456789abcdef", host: US }).env.use("@/constants/env").analyticsEnv.status, "invalid");
    const source = fs.readFileSync(path.join(REPO, "src", "constants", "env.ts"), "utf8");
    assert.ok(source.includes("process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN"));
    assert.ok(source.includes("process.env.EXPO_PUBLIC_POSTHOG_HOST"));
  });
}

// ================================================================== the stored answer
async function storeChecks() {
  await test("store: a fresh install is unset; the answer is saved as version 4; reset clears it", async () => {
    const w = world({ token: undefined, host: undefined });
    const store = w.onboarding();
    await store.persist.rehydrate();
    assert.equal(store.getState().analyticsConsent, "unset");
    store.getState().setAnalyticsConsent("granted");
    assert.equal(store.getState().analyticsConsent, "granted");
    await settle();
    const saved = JSON.parse(w.env.storage.get("gracehush.onboarding"));
    assert.equal(saved.version, 4);
    assert.equal(saved.state.analyticsConsent, "granted");
    store.getState().setAnalyticsConsent("declined");
    assert.equal(store.getState().analyticsConsent, "declined");
    store.getState().resetOnboarding();
    assert.equal(store.getState().analyticsConsent, "unset");
  });

  await test("store: a version 2 save migrates to unset and keeps everything else; a bad value reads as unset", async () => {
    const v2 = {
      state: {
        hasCompletedOnboarding: true,
        completedAt: "2026-10-20T09:00:00.000Z",
        reminders: { morning: "07:15", afternoon: "13:00", evening: "20:00" },
        permissionsPromptedAt: "2026-10-20T09:00:00.000Z",
        remindersSyncedAt: null,
        remindersDirty: true,
      },
      version: 2,
    };
    const a = makeEnv({ stored: { "gracehush.onboarding": JSON.stringify(v2) } });
    const storeA = a.use("@/store/onboardingStore").useOnboardingStore;
    await storeA.persist.rehydrate();
    assert.equal(storeA.getState().analyticsConsent, "unset");
    assert.equal(storeA.getState().hasCompletedOnboarding, true);
    assert.equal(storeA.getState().reminders.morning, "07:15");
    assert.equal(storeA.getState().remindersDirty, true);
    for (const [value, expected] of [
      ["granted", "granted"],
      ["declined", "declined"],
      ["yes", "unset"],
      [true, "unset"],
      [null, "unset"],
      ["__proto__", "unset"],
    ]) {
      const b = makeEnv({ stored: { "gracehush.onboarding": JSON.stringify({ state: { ...v2.state, analyticsConsent: value }, version: 3 }) } });
      const storeB = b.use("@/store/onboardingStore").useOnboardingStore;
      await storeB.persist.rehydrate();
      assert.equal(storeB.getState().analyticsConsent, expected, String(value));
    }
  });
}

// ================================================================== consent and the client
const DECISION_4 = {
  host: US,
  defaultOptIn: false,
  personProfiles: "never",
  disableGeoip: true,
  captureAppLifecycleEvents: true,
  enableSessionReplay: false,
  preloadFeatureFlags: false,
  disableRemoteFeatureFlags: true,
  sendFeatureFlagEvent: false,
  disableSurveys: true,
  setDefaultPersonProperties: false,
  errorTracking: { autocapture: false },
  capturePushNotificationSubscriptions: false,
  capturePushNotificationOpened: false,
  flushAt: 20,
  flushInterval: 30_000,
};

async function consentChecks() {
  await test("consent: with no token no PostHog is ever made, whatever the answer, and track and screens do nothing", async () => {
    const w = world({ token: undefined, host: undefined, consent: "granted" });
    await w.start();
    w.onboarding().getState().setAnalyticsConsent("declined");
    w.onboarding().getState().setAnalyticsConsent("granted");
    await settle();
    w.analytics().track("restore_completed", { found: true });
    w.nav.route = "Journal";
    w.analytics().trackCurrentScreen();
    assert.equal(w.posthog.instances.length, 0);
  });

  await test("consent: a personal API key in the token makes no client, even with the answer yes", async () => {
    const w = world({ token: "phx_PersonalKey0123456789abcdef", host: US, consent: "granted" });
    await w.start();
    w.analytics().track("restore_completed", { found: true });
    assert.equal(w.posthog.instances.length, 0);
  });

  await test("consent: unset or declined at start makes no client, and nothing is tracked", async () => {
    for (const consent of [undefined, "unset", "declined"]) {
      const w = world({ consent });
      await w.start();
      w.analytics().track("data_export_requested", {});
      w.nav.route = "Journal";
      w.analytics().trackCurrentScreen();
      w.emit({ type: "finished", clientEntryId: "c", entryId: "e", isCrisis: false, inputType: "text", scriptureVerified: true });
      w.player.setState({ entryId: "e1", status: "playing", rate: 1 });
      await settle();
      assert.equal(w.posthog.instances.length, 0, String(consent));
    }
  });

  await test("consent: yes at start (once the store has loaded) makes one client with exactly the options of decision 4, opts in and registers the super properties", async () => {
    const w = world({ consent: "granted" });
    w.entitlement().getState().start("user_a", "test_store");
    w.entitlement().getState().setEntitlement("user_a", "pro", null);
    await w.start();
    assert.equal(w.posthog.instances.length, 1);
    const client = w.client();
    assert.equal(client.token, TOKEN);
    const { before_send: beforeSend, customStorage, ...rest } = client.options;
    assert.deepEqual(rest, DECISION_4);
    assert.equal(typeof beforeSend, "function");
    assert.equal(customStorage, w.env.use("@react-native-async-storage/async-storage").default, "the app's AsyncStorage");
    assert.equal(client.optedOut, false);
    assert.ok(client.calls.some((call) => call[0] === "optIn"));
    assert.deepEqual(client.superProperties, { app_version: "1.0.0", build: "development", tier: "pro" });
  });

  await test("consent: the client waits for the saved answer to load, then follows it", async () => {
    const w = world({ consent: "granted" });
    w.onboarding();
    w.analytics().startAnalytics();
    // Nothing is decided before the store has loaded.
    assert.equal(w.posthog.instances.length, 0);
    await settle();
    assert.equal(w.posthog.instances.length, 1);
  });

  await test("consent: yes given later (the Profile switch) makes the client then, with no tier while the plan is unknown", async () => {
    const w = world({ consent: "unset" });
    await w.start();
    assert.equal(w.posthog.instances.length, 0);
    w.onboarding().getState().setAnalyticsConsent("granted");
    await settle();
    assert.equal(w.posthog.instances.length, 1);
    assert.equal(w.client().optedOut, false);
    assert.deepEqual(w.client().superProperties, { app_version: "1.0.0", build: "development" });
  });

  await test("consent: no after yes opts out and empties the queue, sends nothing more and makes no second client; yes again opts the same client in", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    w.analytics().track("restore_completed", { found: true });
    assert.deepEqual(w.queued(), ["restore_completed"]);
    const capturesBefore = w.captures().length;
    w.onboarding().getState().setAnalyticsConsent("declined");
    await settle();
    const client = w.client();
    assert.equal(client.optedOut, true);
    assert.ok(client.calls.some((call) => call[0] === "optOut"));
    assert.ok(client.calls.some((call) => call[0] === "setPersistedProperty" && call[1] === "queue" && call[2] === null));
    assert.deepEqual(w.queued(), [], "what was waiting is gone");
    w.analytics().track("restore_completed", { found: false });
    w.nav.route = "Prayers";
    w.analytics().trackCurrentScreen();
    w.player.setState({ entryId: "e1", status: "playing", rate: 1 });
    w.emit({ type: "finished", clientEntryId: "c", entryId: "e", isCrisis: false, inputType: "text", scriptureVerified: true });
    await settle();
    assert.equal(w.captures().length, capturesBefore, "nothing more is captured");
    assert.equal(client.calls.filter((call) => call[0] === "screen").length, 0);
    await client.flush();
    assert.deepEqual(client.sent, [], "nothing left the phone");
    w.onboarding().getState().setAnalyticsConsent("granted");
    await settle();
    assert.equal(w.posthog.instances.length, 1, "the same client");
    assert.equal(client.optedOut, false);
    w.analytics().track("data_export_requested", {});
    assert.deepEqual(w.queued(), ["data_export_requested"]);
  });

  await test("consent: track hands the catalog event to the SDK as given, and the filter drops what the type system would not allow", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    w.analytics().track("reflection_ready", { input: "voice", scripture_verified: true });
    w.analytics().track("devotional_played", { rate: 2 });
    w.analytics().track("made_up_event", { anything: "x" });
    const capture = w.captures()[0];
    assert.deepEqual(capture.slice(1), ["reflection_ready", { input: "voice", scripture_verified: true }]);
    assert.deepEqual(w.queued(), ["reflection_ready"]);
    const queued = w.client().queue[0];
    assert.equal(queued.properties.$process_person_profile, false);
    assert.equal(queued.properties.$geoip_disable, true);
    assert.equal(queued.$set, undefined);
    for (const key of Object.keys(queued.properties)) {
      assert.ok(ALLOWED_COMMON.includes(key) || ["input", "scripture_verified"].includes(key), key);
    }
  });
}

// ================================================================== sign-out
async function resetChecks() {
  await test("reset: with sharing on, reset() gives a new id and the consent is applied again (opt in, then the super properties)", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    const client = w.client();
    const before = client.getDistinctId();
    await w.analytics().resetAnalytics();
    await settle();
    const index = client.calls.findIndex((call) => call[0] === "reset");
    assert.ok(index >= 0);
    const after = client.calls.slice(index + 1).map((call) => call[0]);
    assert.ok(after.includes("optIn"), after.join(","));
    assert.ok(after.includes("register"), after.join(","));
    assert.notEqual(client.getDistinctId(), before);
    assert.equal(client.optedOut, false);
    assert.equal(client.superProperties.app_version, "1.0.0");
  });

  await test("reset: with sharing off it stays opted out with an empty queue; without a client nothing happens", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    w.onboarding().getState().setAnalyticsConsent("declined");
    await settle();
    await w.analytics().resetAnalytics();
    await settle();
    const client = w.client();
    const index = client.calls.findIndex((call) => call[0] === "reset");
    const after = client.calls.slice(index + 1).map((call) => call[0]);
    assert.ok(after.includes("optOut"), after.join(","));
    assert.ok(!after.includes("optIn"));
    assert.equal(client.optedOut, true);
    assert.deepEqual(w.queued(), []);
    const none = world({ consent: "declined" });
    await none.start();
    await none.analytics().resetAnalytics();
    assert.equal(none.posthog.instances.length, 0);
  });
}

// ================================================================== the sync engine
async function engineChecks() {
  // Since 2026-11-09 the event has two facts, not three: the audio is made behind the server's answer, so whether a reflection
  // has it at the moment it finishes would always be no.
  await test("engine: a finished reflection sends reflection_ready with its two facts; a crisis entry sends nothing", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    w.emit({ type: "finished", clientEntryId: "c1", entryId: "e1", isCrisis: false, inputType: "audio", scriptureVerified: true });
    w.emit({ type: "finished", clientEntryId: "c2", entryId: "e2", isCrisis: false, inputType: "text", scriptureVerified: false });
    w.emit({ type: "finished", clientEntryId: "c3", entryId: "e3", isCrisis: true, inputType: "text", scriptureVerified: false });
    const sent = w.captures().map((call) => [call[1], call[2]]);
    assert.deepEqual(sent, [
      ["reflection_ready", { input: "voice", scripture_verified: true }],
      ["reflection_ready", { input: "text", scripture_verified: false }],
    ]);
    assert.ok(!JSON.stringify(sent).includes("has_audio"), "no has_audio: it would always be false");
  });

  await test("engine: a reflection only the person can fix sends entry_failed with its mapped code; any other outcome sends nothing", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    w.emit({ type: "settled", clientEntryId: "c1", status: "needs_action", code: "TOO_SHORT", entryId: null });
    w.emit({ type: "settled", clientEntryId: "c2", status: "needs_action", code: "INVALID_REQUEST", entryId: null });
    for (const status of ["queued", "limit_reached", "paused_auth"]) {
      w.emit({ type: "settled", clientEntryId: "c3", status, code: "NETWORK", entryId: null });
    }
    w.emit({ type: "changed" });
    w.emit({ type: "stage", clientEntryId: "c1", stage: "reflecting" });
    w.emit({ type: "deleted", entryId: "e1" });
    w.emit({ type: "prayer", entryId: "e1", saved: true });
    assert.deepEqual(
      w.captures().map((call) => [call[1], call[2]]),
      [
        ["entry_failed", { code: "TOO_SHORT" }],
        ["entry_failed", { code: "OTHER" }],
      ],
    );
  });
}

// ================================================================== the player
async function playerChecks() {
  await test("player: the first play sends devotional_played once; pause and play send nothing; the end sends devotional_completed; a replay and another devotional count again", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    const set = (patch) => w.player.setState(patch);
    set({ entryId: "e1", status: "paused", rate: 1.2 });
    set({ status: "playing" });
    set({ status: "paused" });
    set({ status: "playing" });
    set({ status: "ended" });
    set({ status: "playing" });
    set({ entryId: "e2", status: "paused", rate: 0.8 });
    set({ status: "playing" });
    assert.deepEqual(
      w.captures().map((call) => [call[1], call[2]]),
      [
        ["devotional_played", { rate: 1.2 }],
        ["devotional_completed", { rate: 1.2 }],
        ["devotional_played", { rate: 1.2 }],
        ["devotional_played", { rate: 0.8 }],
      ],
    );
  });

  // Found in the step 34 walk-through (B4): a devotional played before sharing was on was remembered, so its first play
  // after sharing turned on looked like a resume and was never sent.
  await test("player: a devotional played while sharing was off counts once when it is played again after sharing turns on", async () => {
    const w = world({ consent: "unset" });
    await w.start();
    const set = (patch) => w.player.setState(patch);
    set({ entryId: "e1", status: "paused", rate: 1 });
    set({ status: "playing" });
    set({ status: "paused" });
    assert.deepEqual(w.captures(), [], "nothing is sent while sharing is unset");
    w.onboarding().getState().setAnalyticsConsent("granted");
    set({ status: "playing" });
    set({ status: "paused" });
    set({ status: "playing" });
    assert.deepEqual(
      w.captures().map((call) => [call[1], call[2]]),
      [["devotional_played", { rate: 1 }]],
    );
  });
}

// ================================================================== screens
async function screenChecks() {
  await test("screens: a tracked route sends screen(name) with no second argument; Reflection and Support Resources send nothing; the same route twice sends once; a return after Reflection sends again", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    const go = (route) => {
      w.nav.route = route;
      w.analytics().trackCurrentScreen();
    };
    go("Journal");
    go("Journal");
    go("Reflection");
    go("Journal");
    go("CrisisResources");
    go("Onboarding");
    go("SignIn");
    go("NowPlaying");
    const screens = w.client().calls.filter((call) => call[0] === "screen");
    assert.deepEqual(screens, [["screen", "Journal"], ["screen", "Journal"], ["screen", "NowPlaying"]]);
    w.nav.ready = false;
    go("Prayers");
    assert.equal(w.client().calls.filter((call) => call[0] === "screen").length, 3, "nothing while the navigator is not ready");
    assert.deepEqual(w.queued(), ["$screen", "$screen", "$screen"]);
    for (const event of w.client().queue) assert.equal("entryId" in event.properties, false);
  });
}

// ================================================================== the plan
async function tierChecks() {
  await test("tier: a plan change registers the new tier, and a plan that becomes unknown unregisters it", async () => {
    const w = world({ consent: "granted" });
    await w.start();
    const store = w.entitlement();
    store.getState().start("user_a", "test_store");
    store.getState().setEntitlement("user_a", "trial", null);
    await settle();
    assert.equal(w.client().superProperties.tier, "trial");
    store.getState().setEntitlement("user_a", "pro", null);
    await settle();
    assert.equal(w.client().superProperties.tier, "pro");
    store.getState().clear();
    await settle();
    assert.equal("tier" in w.client().superProperties, false);
    assert.ok(w.client().calls.some((call) => call[0] === "unregister" && call[1] === "tier"));
  });
}

// ================================================================== the developer summary
async function devChecks() {
  await test("dev: the summary holds names, keys, counts and an 8-character id tail, never a value", async () => {
    const off = world({ consent: "unset" });
    await off.start();
    assert.deepEqual(off.analytics().getAnalyticsSummary(), {
      env: "ok",
      consent: "unset",
      client: false,
      optedOut: null,
      queued: 0,
      idTail: null,
      recent: [],
    });
    const w = world({ consent: "granted" });
    await w.start();
    w.analytics().track("devotional_played", { rate: 1.2 });
    w.analytics().track("ambient_changed", { sound: "morning-birds", source: "profile" });
    const summary = w.analytics().getAnalyticsSummary();
    assert.equal(summary.env, "ok");
    assert.equal(summary.consent, "granted");
    assert.equal(summary.client, true);
    assert.equal(summary.optedOut, false);
    assert.equal(summary.queued, 2);
    assert.equal(summary.idTail.length, 8);
    assert.equal(summary.idTail, w.client().getDistinctId().slice(-8));
    assert.equal(summary.recent.length, 2);
    assert.ok(summary.recent[0].startsWith("ambient_changed ["));
    const text = JSON.stringify(summary);
    for (const value of ["1.2", "morning-birds", "profile\"", TOKEN, "posthog-react-native", "26.1"]) {
      assert.ok(!text.includes(value), `the summary holds a value: ${value}`);
    }
    await w.analytics().flushAnalytics();
    assert.equal(w.analytics().getAnalyticsSummary().queued, 0);
  });
}

// ================================================================== contracts
async function contractChecks() {
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
  function walk(dir) {
    const out = [];
    for (const name of fs.readdirSync(path.join(REPO, dir))) {
      const rel = path.join(dir, name);
      if (fs.statSync(path.join(REPO, rel)).isDirectory()) out.push(...walk(rel));
      else if (/\.(ts|tsx|cjs)$/.test(name)) out.push(rel.split(path.sep).join("/"));
    }
    return out;
  }

  await test("contract: a send that fails with no connection keeps its events and draws no toast in a development build", async () => {
    const core = read("node_modules/@posthog/core/dist/posthog-core-stateless.js");
    // The SDK's own words, which App.tsx must ignore exactly, and its rule that a network failure leaves the queue alone.
    assert.ok(core.includes("console.error('Error while flushing PostHog', err)"));
    assert.ok(core.includes("if (!(err instanceof PostHogFetchNetworkError)) await persistQueueChange();"));
    assert.ok(read("App.tsx").includes('LogBox.ignoreLogs(["Error while flushing PostHog"]);'));
  });

  await test("contract: only services/analytics.ts imports posthog-react-native, and nothing identifies, groups, records or logs", async () => {
    const files = walk("src");
    const importers = files.filter((rel) => /from "posthog-react-native"|require\("posthog-react-native"\)/.test(read(rel)));
    assert.deepEqual(importers, ["src/services/analytics.ts"]);
    for (const rel of files) {
      const text = read(rel);
      for (const word of ["identify(", ".alias(", ".group(", "captureException", "captureLog", ".debug(", "PostHogProvider", "startSessionRecording"]) {
        assert.ok(!text.includes(word), `${rel} holds ${word}`);
      }
    }
  });

  await test("contract: no TODO(34) is left, and no event name or analytics string says crisis", async () => {
    for (const rel of [...walk("src"), ...walk("supabase/tests").filter((rel) => !rel.startsWith("supabase/tests/analytics/"))]) {
      assert.ok(!read(rel).includes("TODO(34)"), rel);
    }
    const policy = read("src/services/analyticsPolicy.ts");
    const names = [...policy.matchAll(/name: "([a-z_]+)"/g)].map((match) => match[1]);
    assert.equal(names.length, 20, names.join(","));
    for (const name of names) assert.ok(!/crisis|support|sign/.test(name), name);
  });
}

(async () => {
  await policyChecks();
  await envChecks();
  await storeChecks();
  await consentChecks();
  await resetChecks();
  await engineChecks();
  await playerChecks();
  await screenChecks();
  await tierChecks();
  await devChecks();
  await contractChecks();
  const total = passed + failures.length;
  if (failures.length > 0) {
    console.error(`\n${passed} checks passed, ${failures.length} FAILED:\n`);
    for (const failure of failures) console.error(` - ${failure}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`${total} checks passed`);
})();
