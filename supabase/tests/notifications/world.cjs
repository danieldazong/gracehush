// Fakes for the step 28 checks: expo-notifications shaped like 58.1.x on iOS and Android (what the phone keeps scheduled, the
// notification center, the permission, the foreground handler, taps and the last response), the navigation container's ref,
// the sync engine's events and a repository whose newest reflection a check sets. The app's real planner, scheduler, tap
// routing, notifications service, zoned time and stores run on top of them, on the recording checks' virtual clock, so a
// week of notifications takes no real time.
const crypto = require("node:crypto");
const path = require("node:path");

// The loader reads GRACEHUSH_REPO when it is first required: default to this repo, or run against a copy of it.
const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
process.env.GRACEHUSH_REPO = REPO;
const recording = require("../recording/world.cjs");
const playback = require("../playback/world.cjs");
const { makeEnv, clock, installClock, uninstallClock, makeAppState } = recording;
const { flush } = playback;
const realSetImmediate = setImmediate;

// A run of the scheduler is a long chain of awaits (one per notification), so the app is let settle on the real event loop:
// a setImmediate runs only once every promise that is ready has run. Timers stay virtual.
async function settle(rounds = 2) {
  for (let i = 0; i < rounds; i += 1) {
    await flush();
    await new Promise((resolve) => realSetImmediate(resolve));
  }
}
// Runs every virtual timer that falls due in the next `ms` milliseconds, in order, letting the app settle after each one.
async function advance(ms) {
  await settle();
  const end = clock.now + ms;
  for (;;) {
    let next = null;
    for (const [id, timer] of clock.timers) {
      if (timer.at <= end && (next === null || timer.at < next.timer.at)) next = { id, timer };
    }
    if (next === null) break;
    clock.now = Math.max(clock.now, next.timer.at);
    if (next.timer.repeat) next.timer.at += next.timer.ms;
    else clock.timers.delete(next.id);
    next.timer.fn();
    await settle();
  }
  clock.now = end;
  await settle();
}

const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";
const sha16 = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

// ------------------------------------------------------------------ expo-notifications 58
// iOS turns a date trigger into a time interval counted from now and refuses one that is not ahead (UNTimeIntervalNotification
// Trigger throws), and reports it back as { type: "timeInterval" } with no date. Android keeps { type: "date", value }.
// In Expo Go the list holds the other projects' notifications too, with their scope taken off (expoGoOthers).
function makeNotifications({ platform = "ios", expoGoOthers = [] } = {}) {
  const scheduled = new Map(); // identifier -> { content, trigger, at }
  for (const other of expoGoOthers) scheduled.set(other, { content: { title: "x", body: "y", data: {} }, trigger: {}, at: Infinity });
  const presented = []; // { request: { identifier, content }, date }
  const listeners = new Set();
  const calls = { schedule: [], cancel: [], dismiss: [], handler: [], channels: [], list: 0, presentedList: 0 };
  const state = {
    permission: { granted: true, status: "granted", canAskAgain: true, ios: { status: 2 } },
    lastResponse: null,
    failSchedule: new Set(), // identifiers whose scheduling fails
    failScheduleAll: false,
    failList: false,
    // Native calls that take time, to test what happens meanwhile: scheduling, and listing or cancelling.
    scheduleLagMs: 0,
    otherLagMs: 0,
  };
  const lag = async (ms) => {
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    else await Promise.resolve();
  };
  const module = {
    DEFAULT_ACTION_IDENTIFIER: DEFAULT_ACTION,
    SchedulableTriggerInputTypes: { DATE: "date", DAILY: "daily", TIME_INTERVAL: "timeInterval" },
    IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
    AndroidImportance: { DEFAULT: 3 },
    getPermissionsAsync: async () => ({ ...state.permission }),
    requestPermissionsAsync: async () => ({ ...state.permission }),
    setNotificationChannelAsync: async (id, channel) => void calls.channels.push({ id, channel }),
    getAllScheduledNotificationsAsync: async () => {
      calls.list += 1;
      await lag(state.otherLagMs);
      if (state.failList) throw new Error("list failed");
      return [...scheduled.entries()].map(([identifier, request]) => ({
        identifier,
        content: request.content,
        trigger: platform === "ios" ? { type: "timeInterval", seconds: 1, repeats: false } : { type: "date", value: request.at },
      }));
    },
    scheduleNotificationAsync: async ({ identifier, content, trigger }) => {
      await lag(state.scheduleLagMs);
      calls.schedule.push({ identifier, content, trigger, now: Date.now() });
      if (state.failScheduleAll || state.failSchedule.has(identifier)) throw new Error("ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE");
      if (trigger?.type !== "date") throw new Error("only date triggers are expected");
      const at = trigger.date instanceof Date ? trigger.date.getTime() : trigger.date;
      if (platform === "ios" && Math.floor(at / 1000) * 1000 - Date.now() <= 0) {
        throw new Error("ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE: time interval must be greater than 0");
      }
      scheduled.set(identifier, { content, trigger, at });
      return identifier;
    },
    cancelScheduledNotificationAsync: async (identifier) => {
      await lag(state.otherLagMs);
      calls.cancel.push(identifier);
      scheduled.delete(identifier);
    },
    cancelAllScheduledNotificationsAsync: async () => {
      throw new Error("cancelAllScheduledNotificationsAsync must never be called (AGENTS.md)");
    },
    getPresentedNotificationsAsync: async () => {
      calls.presentedList += 1;
      return presented.map((notification) => ({ ...notification }));
    },
    dismissNotificationAsync: async (identifier) => {
      calls.dismiss.push(identifier);
      const at = presented.findIndex((notification) => notification.request.identifier === identifier);
      if (at >= 0) presented.splice(at, 1);
    },
    dismissAllNotificationsAsync: async () => {
      throw new Error("dismissAllNotificationsAsync is not expected");
    },
    setNotificationHandler: (handler) => void calls.handler.push(handler),
    addNotificationResponseReceivedListener: (listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    getLastNotificationResponse: () => state.lastResponse,
    clearLastNotificationResponse: () => {
      state.lastResponse = null;
    },
  };
  // The phone delivers every notification that is due: it leaves the scheduled list and enters the notification center.
  function deliverDue() {
    for (const [identifier, request] of [...scheduled.entries()]) {
      if (request.at <= Date.now()) {
        scheduled.delete(identifier);
        presented.push({ request: { identifier, content: request.content }, date: request.at });
      }
    }
  }
  // A tap on a notification in the notification center (or any request with this content).
  function responseFor(identifier, data, { action = DEFAULT_ACTION, date = Date.now() } = {}) {
    return { actionIdentifier: action, notification: { date, request: { identifier, content: { title: "t", body: "b", data } } } };
  }
  function tap(identifier, options = {}) {
    const shown = presented.find((notification) => notification.request.identifier === identifier);
    const data = options.data ?? shown?.request.content.data ?? scheduled.get(identifier)?.content.data ?? {};
    const response = responseFor(identifier, data, { ...options, date: options.date ?? shown?.date ?? Date.now() });
    state.lastResponse = response;
    for (const listener of [...listeners]) listener(response);
    return response;
  }
  // The app was closed: the tap is only kept as the last response, and no listener exists yet.
  function coldTap(identifier, data, options = {}) {
    state.lastResponse = responseFor(identifier, data, options);
  }
  const ours = () => [...scheduled.keys()].filter((identifier) => identifier.startsWith("aff-"));
  return { module, scheduled, presented, listeners, calls, state, deliverDue, tap, coldTap, ours };
}

// ------------------------------------------------------------------ the navigation container's ref
function makeNavigation() {
  const state = { ready: false, routeNames: ["Onboarding", "SignIn"] };
  const navigations = [];
  return {
    state,
    navigations,
    module: {
      navigationRef: {
        isReady: () => state.ready,
        getRootState: () => (state.ready ? { routeNames: state.routeNames } : undefined),
        navigate: (name, params) => void navigations.push({ name, params }),
      },
    },
    signedIn() {
      state.ready = true;
      state.routeNames = ["MainTabs", "NewEntry", "Reflection", "NowPlaying", "CrisisResources", "Paywall"];
    },
    signedOut() {
      state.ready = true;
      state.routeNames = ["SignIn"];
    },
  };
}

// ------------------------------------------------------------------ the sync engine's events
function makeSync() {
  const listeners = new Set();
  return {
    module: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    finished: (entryId, isCrisis = false) =>
      [...listeners].forEach((listener) => listener({ type: "finished", clientEntryId: "c", entryId, isCrisis })),
    count: () => listeners.size,
  };
}

// ------------------------------------------------------------------ the repository: the newest reflection on the phone
function affirmationsFor(entryId, headlines = {}) {
  return ["morning", "afternoon", "evening"].map((slot) => ({
    id: `${entryId}-${slot}`,
    entryId,
    slot,
    headline: headlines[slot] ?? `You are held this ${slot}`,
    text: `The longer words of the ${slot} affirmation, which the lock screen must never show.`,
    isFavorite: false,
  }));
}

function makeRepository(readPrefs) {
  const state = {
    source: { entryId: "entry-1", isCrisis: false, affirmations: affirmationsFor("entry-1") },
    // The Daily Affirmations switch: "prefs" reads it from the real prefs store as the real repository does (null until the
    // profile was read on the phone); true, false or null overrides it.
    enabled: "prefs",
    readFails: false,
    reads: 0,
  };
  return {
    state,
    module: {
      readAffirmationSource: async () => {
        state.reads += 1;
        if (state.readFails) throw new Error("the cache could not be read");
        return state.source === null ? null : JSON.parse(JSON.stringify(state.source));
      },
      getKnownAffirmationsEnabled: (userId) => {
        if (state.enabled !== "prefs") return state.enabled;
        const entry = readPrefs().byUser[userId];
        return entry?.unsent.affirmationsEnabled ?? entry?.snapshot?.affirmationsEnabled ?? null;
      },
    },
  };
}

// ------------------------------------------------------------------ a whole world
// `platform` "ios" or "android"; `expoGo` with `platform` "android" skips the module as the app does in Expo Go on Android.
function world({ platform = "ios", expoGo = false, zone = "America/New_York", expoGoOthers = [] } = {}) {
  installClock();
  const notifications = makeNotifications({ platform, expoGoOthers });
  const navigation = makeNavigation();
  const sync = makeSync();
  let env = null;
  const repository = makeRepository(() => env.use("@/store/profilePrefsStore").useProfilePrefsStore.getState());
  const appState = makeAppState();
  const device = { zone };
  const reactNative = { ...appState.module, Platform: { OS: platform, select: (choices) => choices[platform] ?? choices.default } };
  env = makeEnv({
    fakes: {
      "expo-notifications": notifications.module,
      expo: {
        isRunningInExpoGo: () => expoGo,
        PermissionStatus: { GRANTED: "granted", UNDETERMINED: "undetermined", DENIED: "denied" },
      },
      "react-native": reactNative,
      "@/navigation/navigationRef": navigation.module,
      "@/services/syncEngine": sync.module,
      "@/data/journalRepository": repository.module,
      "@/data/mappers": { getDeviceTimezone: () => device.zone },
      "@/db/database": { userHash: async (id) => sha16(id) },
    },
  });
  const use = (spec) => env.use(spec);
  return {
    env,
    use,
    notifications,
    navigation,
    sync,
    repository,
    appState,
    device,
    scheduler: () => use("@/services/affirmationScheduler"),
    routing: () => use("@/services/notificationRouting"),
    stores: () => ({
      onboarding: use("@/store/onboardingStore").useOnboardingStore,
      prefs: use("@/store/profilePrefsStore").useProfilePrefsStore,
      offline: use("@/store/offlineStore").useOfflineStore,
    }),
    // The two persisted stores load from storage first, as they do behind the splash screen: a write before that is lost.
    async hydrate() {
      const stores = this.stores();
      await stores.prefs.persist.rehydrate();
      await stores.onboarding.persist.rehydrate();
    },
    // What the auth bridge does at sign-in: the database opens, the profile has been read, and the scheduler starts.
    async signIn(userId = "user_a", { enabled = true, dbReady = true } = {}) {
      await this.hydrate();
      const stores = this.stores();
      stores.prefs.getState().saveSnapshot(userId, {
        createdAt: "2026-10-01T12:00:00.000Z",
        subscriptionTier: "free",
        syncedAt: new Date(Date.now()).toISOString(),
        affirmationsEnabled: enabled,
        ambientSound: "off",
        ambientVolume: 0.5,
      });
      if (dbReady) stores.offline.getState().setDatabase("ready");
      this.scheduler().startAffirmationSchedule(userId);
      await advance(1_000);
    },
  };
}

module.exports = {
  world,
  affirmationsFor,
  sha16,
  clock,
  installClock,
  uninstallClock,
  advance,
  settle,
  flush,
  DEFAULT_ACTION,
};
