// The step 30 checks: purchases on RevenueCat and the server's plan. They run the app's real TypeScript (the key choice, the
// RevenueCat service, the purchases service, the plan sync and its watch, the repository's plan, the entitlement store, the
// upgrade watcher, the sync engine and the Edge Function gateway) with the real supabase-js client against the fake Supabase of
// step 25 (../journal-data/world.cjs), whose sync-subscription answers as the real function does: it reads what RevenueCat says
// the caller's plan is and writes it as the server's plan. Under them is a fake react-native-purchases shaped like 10.16.0, with
// two profiles: Expo Go's Browser Mode (no customer-info events, trial eligibility always unknown, the Test Store's three-button
// alert: cancel, a failed purchase, a valid purchase) and a native build. The profile sync is faked too: it brings the server's
// plan into the profile prefs store, as the real one does. Every check ends by asserting that nothing the database or AGENTS.md
// would refuse was sent, and that the development log holds no id, key, price or plan.
//
//   node --no-warnings supabase/tests/billing/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/billing/run.cjs
process.env.TZ = "UTC";
// The app reads its public keys by their full names when its env module loads.
const TEST_KEY = "test_billing_key";
process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY = TEST_KEY;
process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "";
process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = "";

const assert = require("node:assert/strict");
const W = require("../journal-data/world.cjs");

const {
  makeLiveWorld,
  json,
  fnError,
  limitBody,
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

// Ids, keys, prices and products that must never reach the development log.
const FORBIDDEN_IN_LOGS = [
  "user_a",
  "user_b",
  "tokA",
  "tokB",
  TEST_KEY,
  "appl_",
  "goog_",
  "59.99",
  "9.99",
  "gracehush_pro_yearly",
  "gracehush_pro_monthly",
  "$RCAnonymousID",
  "apps.apple.com/account/subscriptions/manage",
];

function assertQuiet(w) {
  for (const line of w.logs) {
    for (const word of FORBIDDEN_IN_LOGS) {
      assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
    }
    if (line.includes("[billing]")) assert.match(line, /^\[billing\] sync (ok|[A-Z_]+)$/, `a billing line says more than a code: ${line}`);
  }
}

// ------------------------------------------------------------------ the fake react-native-purchases (10.16.0)
const PACKAGE_TYPE = {
  UNKNOWN: "UNKNOWN",
  CUSTOM: "CUSTOM",
  LIFETIME: "LIFETIME",
  ANNUAL: "ANNUAL",
  SIX_MONTH: "SIX_MONTH",
  THREE_MONTH: "THREE_MONTH",
  TWO_MONTH: "TWO_MONTH",
  MONTHLY: "MONTHLY",
  WEEKLY: "WEEKLY",
};
const INTRO_ELIGIBILITY_STATUS = {
  INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
  INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
  INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
  INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3,
};
const PURCHASES_ERROR_CODE = {
  UNKNOWN_ERROR: "0",
  PURCHASE_CANCELLED_ERROR: "1",
  STORE_PROBLEM_ERROR: "2",
  PURCHASE_NOT_ALLOWED_ERROR: "3",
  PURCHASE_INVALID_ERROR: "4",
  PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: "5",
  PRODUCT_ALREADY_PURCHASED_ERROR: "6",
  NETWORK_ERROR: "10",
  PAYMENT_PENDING_ERROR: "20",
  CONFIGURATION_ERROR: "23",
  OFFLINE_CONNECTION_ERROR: "35",
};
const LOG_LEVEL = { VERBOSE: "VERBOSE", DEBUG: "DEBUG", INFO: "INFO", WARN: "WARN", ERROR: "ERROR" };

function product(identifier, price, period, extra = {}) {
  return {
    identifier,
    description: "",
    title: identifier,
    price,
    priceString: `$${price.toFixed(2)}`,
    pricePerWeek: null,
    pricePerMonth: null,
    pricePerYear: null,
    pricePerWeekString: null,
    pricePerMonthString: null,
    pricePerYearString: null,
    currencyCode: "USD",
    introPrice: null,
    discounts: null,
    productCategory: "SUBSCRIPTION",
    productType: "AUTO_RENEWABLE_SUBSCRIPTION",
    subscriptionPeriod: period,
    defaultOption: null,
    subscriptionOptions: null,
    ...extra,
  };
}

function sdkPackage(identifier, packageType, item) {
  return {
    identifier,
    packageType,
    product: item,
    offeringIdentifier: "default",
    presentedOfferingContext: { offeringIdentifier: "default", placementIdentifier: null, targetingContext: null },
    webCheckoutUrl: null,
  };
}

// The offering as section B set it up: Monthly listed first (the Paywall puts the yearly one first itself), and a lifetime
// package the Paywall must leave out.
function defaultOffering() {
  return {
    identifier: "default",
    serverDescription: "Gracehush Pro",
    metadata: {},
    availablePackages: [
      sdkPackage("$rc_monthly", PACKAGE_TYPE.MONTHLY, product("gracehush_pro_monthly", 9.99, "P1M")),
      sdkPackage("$rc_annual", PACKAGE_TYPE.ANNUAL, product("gracehush_pro_yearly", 59.99, "P1Y")),
      sdkPackage("$rc_lifetime", PACKAGE_TYPE.LIFETIME, product("gracehush_lifetime", 99.99, null)),
    ],
    lifetime: null,
    annual: null,
    sixMonth: null,
    threeMonth: null,
    twoMonth: null,
    monthly: null,
    weekly: null,
    webCheckoutUrl: null,
  };
}

// RevenueCat's plans live on the fake server (state.revenueCatPlans), which sync-subscription reads as the real function reads
// RevenueCat. `mode` is "browser" (Expo Go) or "native".
function makePurchases(mode) {
  let world = null;
  const state = {
    mode,
    apiKey: null,
    appUserId: null,
    anonymous: false,
    logLevel: null,
    calls: [],
    managementURL: null,
    offering: defaultOffering(),
    // The Test Store's alert, one answer per purchase: "valid" (the default), "failed", "cancel", "unattached" (a valid purchase
    // of a product that is not attached to pro), or an error object to throw.
    alert: [],
    eligibility: {},
    failNext: {},
    listeners: [],
  };
  const call = (name) => {
    state.calls.push(name);
    world?.order.push(`rc:${name}`);
    const error = state.failNext[name];
    if (error !== undefined) {
      delete state.failNext[name];
      throw error;
    }
  };
  const tierOf = (id) => (world?.server.state.revenueCatPlans[id]) ?? "free";
  const customerInfo = (id) => {
    const tier = tierOf(id);
    const active = tier === "free" ? {} : { pro: { identifier: "pro", isActive: true, periodType: tier === "trial" ? "TRIAL" : "NORMAL" } };
    return {
      entitlements: { all: active, active, verification: "NOT_REQUESTED" },
      activeSubscriptions: [],
      allPurchasedProductIdentifiers: [],
      latestExpirationDate: null,
      firstSeen: "2026-10-29T12:00:00.000Z",
      originalAppUserId: id ?? "",
      requestDate: "2026-10-29T12:00:00.000Z",
      allExpirationDates: {},
      allPurchaseDates: {},
      originalApplicationVersion: null,
      originalPurchaseDate: null,
      managementURL: state.managementURL,
    };
  };
  const Purchases = {
    async setLogLevel(level) {
      call("setLogLevel");
      state.logLevel = level;
    },
    configure({ apiKey, appUserID }) {
      call("configure");
      // Browser Mode takes only a Test Store or a Web Billing key, as react-native-purchases 10.16.0 does in Expo Go.
      if (state.mode === "browser" && !/^(test_|rcb_)/.test(String(apiKey))) {
        throw new Error("Invalid API key. The native store is not available when running inside Expo Go.");
      }
      state.apiKey = apiKey;
      state.appUserId = appUserID ?? null;
      state.anonymous = appUserID == null;
    },
    async logIn(id) {
      call("logIn");
      state.appUserId = id;
      state.anonymous = false;
      return { customerInfo: customerInfo(id), created: false };
    },
    async logOut() {
      call("logOut");
      if (state.anonymous) throw Object.assign(new Error("LogOut was called but the current user is anonymous."), { code: "22" });
      state.appUserId = "$RCAnonymousID:test";
      state.anonymous = true;
      return customerInfo(state.appUserId);
    },
    async isAnonymous() {
      call("isAnonymous");
      return state.anonymous;
    },
    async getCustomerInfo() {
      call("getCustomerInfo");
      return customerInfo(state.appUserId);
    },
    async getOfferings() {
      call("getOfferings");
      return { current: state.offering, all: state.offering === null ? {} : { default: state.offering } };
    },
    async checkTrialOrIntroductoryPriceEligibility(ids) {
      call("checkEligibility");
      // Browser Mode cannot tell: every answer is UNKNOWN.
      const answer = (id) =>
        state.mode === "browser" ? INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN : (state.eligibility[id] ?? 1);
      return Object.fromEntries(ids.map((id) => [id, { status: answer(id), description: "" }]));
    },
    async purchasePackage(pkg) {
      call("purchasePackage");
      const outcome = state.alert.shift() ?? "valid";
      if (outcome === "cancel") throw { code: "1", userCancelled: true, message: "Purchase was cancelled." };
      if (outcome === "failed") throw { code: "5", userCancelled: false, message: "Test purchase failure." };
      if (typeof outcome === "object") throw outcome;
      if (outcome !== "unattached") world.server.state.revenueCatPlans[state.appUserId] = outcome === "trial" ? "trial" : "pro";
      return { productIdentifier: pkg.product.identifier, customerInfo: customerInfo(state.appUserId), transaction: {} };
    },
    async restorePurchases() {
      call("restorePurchases");
      return customerInfo(state.appUserId);
    },
    addCustomerInfoUpdateListener(listener) {
      call("addListener");
      state.listeners.push(listener);
    },
  };
  // A native build's RevenueCat telling the app about a change. Browser Mode never does.
  const emit = () => {
    if (state.mode === "browser") return;
    for (const listener of state.listeners) listener(customerInfo(state.appUserId));
  };
  const module = { __esModule: true, default: Purchases, PACKAGE_TYPE, INTRO_ELIGIBILITY_STATUS, PURCHASES_ERROR_CODE, LOG_LEVEL };
  return { module, state, emit, attach: (w) => void (world = w) };
}

// The profile sync, as far as these checks need it: it brings the plan the server wrote into the profile prefs store.
function makeProfileSync() {
  let world = null;
  const module = {
    __esModule: true,
    async syncProfile() {
      world.order.push("profile sync");
      const id = world.use("@/services/supabaseClient").getSupabaseUserId();
      if (id === null) return { ok: false, code: "UNAUTHORIZED", message: "" };
      const prefs = world.use("@/store/profilePrefsStore").useProfilePrefsStore;
      const snapshot = prefs.getState().byUser[id]?.snapshot;
      const tier = world.server.state.serverPlans[id];
      if (snapshot && tier !== undefined) prefs.getState().saveSnapshot(id, { ...snapshot, subscriptionTier: tier });
      return { ok: true, data: null };
    },
    scheduleProfileSync: () => undefined,
    cancelProfileSync: () => undefined,
    syncProfileOnForeground: () => undefined,
    watchReminderEdits: () => () => undefined,
  };
  return { module, attach: (w) => void (world = w) };
}

async function test(name, run, options = {}) {
  // ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either).
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (stopped) return;
  const startedAt = process.hrtime.bigint();
  installClock();
  installVirtualDate();
  clock.now = options.now ?? BASE;
  const sdk = makePurchases(options.mode ?? "browser");
  const profileSync = makeProfileSync();
  const w = makeLiveWorld({
    ...options,
    fakes: {
      "react-native-purchases": sdk.module,
      expo: { __esModule: true, isRunningInExpoGo: () => sdk.state.mode === "browser" },
      "@/services/profileSync": profileSync.module,
    },
  });
  // react-native's Platform, beside the world's AppState (read when a module uses it, so this is in time).
  w.appState.module.Platform = { OS: options.platform ?? "ios" };
  w.order = [];
  w.sdk = sdk;
  sdk.attach(w);
  profileSync.attach(w);
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
      w.use("@/services/subscriptionSync").stopPlanWatch();
    } catch {
      // The module was never loaded in this check.
    }
    w.close();
    uninstallVirtualDate();
    uninstallClock();
    globalThis.__DEV__ = true;
    if (process.env.TIMINGS) process.stderr.write(`${Number((process.hrtime.bigint() - startedAt) / 1000000n)} ms  ${name.slice(0, 90)}${String.fromCharCode(10)}`);
  }
}

// ------------------------------------------------------------------ helpers
const rc = (w) => w.use("@/services/revenuecat");
const purchases = (w) => w.use("@/services/purchases");
const planSync = (w) => w.use("@/services/subscriptionSync");
const repo = (w) => w.use("@/data/journalRepository");
const copyOf = (w) => w.use("@/constants/copy").copy;
const entitlement = (w) => w.use("@/store/entitlementStore").useEntitlementStore.getState();
const dev = (w) => w.use("@/store/devStore").useDevStore.getState();
const count = (w, name) => w.sdk.state.calls.filter((call) => call === name).length;
const syncCalls = (w) => w.server.state.requests.filter((request) => request.path === "/functions/v1/sync-subscription");
const functionCalls = (w, name) => w.server.state.requests.filter((request) => request.path === `/functions/v1/${name}`);
const snapshotTier = (w, id = w.userId) =>
  w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState().byUser[id]?.snapshot?.subscriptionTier ?? null;
const text = (id) => ({ clientEntryId: id, inputType: "text", text: "Lord, I am grateful for this quiet morning." });

// The real function's answer, recorded in order with everything else, and optionally held until `gate` resolves.
function recordSync(w, { gate = null, answer = null } = {}) {
  w.server.state.functions["sync-subscription"].push(async (call) => {
    w.order.push("sync-subscription");
    if (gate !== null) await gate;
    if (answer !== null) return answer;
    const tier = w.server.state.revenueCatPlans[call.sub] ?? "free";
    w.server.state.serverPlans[call.sub] = tier;
    return json(200, { tier, expiresAt: null });
  });
}

// ================================================================== the key
async function keyChecks() {
  await test("keys: a secret key is never used; Expo Go takes only the Test Store key; a build takes its platform's key, and only development falls back to the Test Store key", async (w) => {
    const { chooseRevenueCatKey } = w.use("@/constants/env");
    const base = { inExpoGo: false, isDev: true, platform: "ios", testKey: "", iosKey: "", androidKey: "" };
    const pick = (over) => chooseRevenueCatKey({ ...base, ...over });
    for (const field of ["testKey", "iosKey", "androidKey"]) {
      for (const inExpoGo of [true, false]) {
        assert.deepEqual(pick({ inExpoGo, testKey: "test_t", iosKey: "appl_i", [field]: "sk_secret" }), { kind: "none", reason: "secret_key" });
      }
    }
    assert.deepEqual(pick({ inExpoGo: true, testKey: "test_t", iosKey: "appl_i" }), { kind: "test_store", apiKey: "test_t" });
    assert.deepEqual(pick({ inExpoGo: true, iosKey: "appl_i" }), { kind: "none", reason: "missing" });
    assert.deepEqual(pick({ inExpoGo: true, testKey: "goog_t" }), { kind: "none", reason: "missing" });
    assert.deepEqual(pick({ inExpoGo: true, testKey: "  test_t  " }), { kind: "test_store", apiKey: "test_t" });
    assert.deepEqual(pick({ iosKey: "appl_i", testKey: "test_t" }), { kind: "app_store", apiKey: "appl_i" });
    assert.deepEqual(pick({ platform: "android", androidKey: "goog_a", testKey: "test_t" }), { kind: "play_store", apiKey: "goog_a" });
    assert.deepEqual(pick({ platform: "android", iosKey: "appl_i" }), { kind: "none", reason: "missing" });
    assert.deepEqual(pick({ iosKey: "goog_wrong", testKey: "test_t" }), { kind: "test_store", apiKey: "test_t" });
    assert.deepEqual(pick({ testKey: "test_t" }), { kind: "test_store", apiKey: "test_t" });
    assert.deepEqual(pick({ platform: "other", iosKey: "appl_i", testKey: "test_t" }), { kind: "test_store", apiKey: "test_t" });
    assert.deepEqual(pick({ isDev: false, testKey: "test_t" }), { kind: "none", reason: "test_key_in_release" });
    assert.deepEqual(pick({ isDev: false }), { kind: "none", reason: "missing" });
    assert.deepEqual(pick({ isDev: false, iosKey: "appl_i", testKey: "test_t" }), { kind: "app_store", apiKey: "appl_i" });
    assert.deepEqual(pick({ isDev: false, platform: "android", androidKey: "goog_a" }), { kind: "play_store", apiKey: "goog_a" });
  }, { signIn: false });
}

// ================================================================== configure, log in, log out
async function sessionChecks() {
  await test("session: nothing is configured before sign-in; then once with the Clerk id, WARN logs, and the entitlement read", async (w) => {
    const service = rc(w);
    w.use("@/services/purchases");
    assert.deepEqual(w.sdk.state.calls, [], "loading the modules configures nothing");
    await service.startRevenueCat("user_a");
    assert.deepEqual(w.sdk.state.calls.slice(0, 2), ["setLogLevel", "configure"]);
    assert.equal(w.sdk.state.logLevel, "WARN");
    assert.equal(w.sdk.state.apiKey, TEST_KEY);
    assert.equal(w.sdk.state.appUserId, "user_a");
    assert.equal(count(w, "getCustomerInfo"), 1);
    assert.equal(count(w, "addListener"), 0, "Expo Go sends no updates, so no listener is added");
    assert.deepEqual([entitlement(w).userId, entitlement(w).keyKind, entitlement(w).tier], ["user_a", "test_store", "free"]);
    assert.equal(service.revenueCatReady(), true);
    await service.startRevenueCat("user_a");
    assert.deepEqual([count(w, "configure"), count(w, "logIn")], [1, 0], "the same account again: nothing new");
  });

  await test("session: another account logs in (never a second configure); sign-out logs out once and forgets the plan", async (w) => {
    const service = rc(w);
    w.server.state.revenueCatPlans.user_a = "pro";
    await service.startRevenueCat("user_a");
    assert.equal(entitlement(w).tier, "pro");
    w.sdk.state.failNext.getCustomerInfo = { code: "10" };
    await service.startRevenueCat("user_b");
    assert.deepEqual([count(w, "configure"), count(w, "logIn"), w.sdk.state.appUserId], [1, 1, "user_b"]);
    assert.deepEqual([entitlement(w).userId, entitlement(w).tier], ["user_b", null], "the first account's plan never shows for the second, even while its read fails");
    await service.refreshEntitlement();
    assert.equal(entitlement(w).tier, "free");
    await service.endRevenueCatSession();
    assert.equal(count(w, "logOut"), 1);
    assert.deepEqual([entitlement(w).userId, entitlement(w).tier, entitlement(w).managementUrl], [null, null, null]);
    assert.equal(service.revenueCatReady(), false);
    await service.endRevenueCatSession();
    assert.equal(count(w, "logOut"), 1, "a second sign-out has nobody to log out");
    await service.startRevenueCat("user_a");
    assert.deepEqual([count(w, "logIn"), w.sdk.state.appUserId, entitlement(w).tier], [2, "user_a", "pro"]);
  });

  await test("session: a login that fails never leaves purchases going to the previous account; the next refresh logs in", async (w) => {
    const service = rc(w);
    await service.startRevenueCat("user_a");
    w.sdk.state.failNext.logIn = { code: "10", message: "offline" };
    await service.startRevenueCat("user_b");
    assert.equal(service.revenueCatReady(), false);
    assert.equal(await purchases(w).getCurrentOffering(), null, "the Paywall offers nothing");
    const bought = await purchases(w).purchasePackage("$rc_annual");
    assert.equal(bought.code, "NOT_ALLOWED");
    assert.equal(count(w, "purchasePackage"), 0);
    assert.equal(await service.refreshEntitlement(), "free");
    assert.deepEqual([service.revenueCatReady(), w.sdk.state.appUserId], [true, "user_b"]);
  });

  await test("session: a release build with only a Test Store key configures nothing and offers nothing", async (w) => {
    const service = rc(w);
    globalThis.__DEV__ = false;
    w.sdk.state.mode = "native";
    await service.startRevenueCat("user_a");
    assert.deepEqual(w.sdk.state.calls, [], "RevenueCat's purposeful crash is never reached");
    assert.deepEqual([entitlement(w).keyKind, service.currentRevenueCatKey().reason], ["none", "test_key_in_release"]);
  });

  await test("session: a native build listens for RevenueCat's updates once and follows them", async (w) => {
    const service = rc(w);
    await service.startRevenueCat("user_a");
    await service.startRevenueCat("user_b");
    assert.equal(count(w, "addListener"), 1);
    w.server.state.revenueCatPlans.user_b = "trial";
    w.sdk.emit();
    assert.equal(entitlement(w).tier, "trial");
  }, { mode: "native" });
}

// ================================================================== what RevenueCat says, mapped
async function mappingChecks() {
  await test("tier: an active pro in its trial period is trial, any other active pro is pro, none (or another entitlement) is free", async (w) => {
    const { tierFromCustomerInfo } = rc(w);
    const info = (active) => ({ entitlements: { active, all: active } });
    assert.equal(tierFromCustomerInfo(info({})), "free");
    assert.equal(tierFromCustomerInfo(info({ pro: { periodType: "NORMAL" } })), "pro");
    assert.equal(tierFromCustomerInfo(info({ pro: { periodType: "INTRO" } })), "pro");
    assert.equal(tierFromCustomerInfo(info({ pro: { periodType: "TRIAL" } })), "trial");
    assert.equal(tierFromCustomerInfo(info({ pro: { periodType: "trial" } })), "trial");
    assert.equal(tierFromCustomerInfo(info({ premium: { periodType: "NORMAL" } })), "free");
  }, { signIn: false });

  await test("offering: the yearly and the monthly package are mapped as RevenueCat sends them; any other package, and a product with no period, is left out", async (w) => {
    await rc(w).startRevenueCat("user_a");
    const offering = await purchases(w).getCurrentOffering();
    assert.equal(offering.id, "default");
    assert.deepEqual(offering.packages.map((pkg) => pkg.id), ["$rc_monthly", "$rc_annual"]);
    assert.deepEqual(offering.packages.find((pkg) => pkg.kind === "annual"), {
      id: "$rc_annual",
      kind: "annual",
      productId: "gracehush_pro_yearly",
      priceString: "$59.99",
      price: 59.99,
      currencyCode: "USD",
      periodLabel: "year",
      pricePerMonthString: null,
      introOffer: null,
    });
    assert.equal(offering.packages.find((pkg) => pkg.kind === "monthly").periodLabel, "month");
    w.sdk.state.offering.availablePackages.push(sdkPackage("$rc_custom", PACKAGE_TYPE.CUSTOM, product("gracehush_custom", 4.99, "P1M")));
    assert.deepEqual((await purchases(w).getCurrentOffering()).packages.map((pkg) => pkg.id), ["$rc_monthly", "$rc_annual"], "a custom package is left out");
    w.sdk.state.offering.availablePackages[1].product.pricePerMonthString = "$5.00";
    w.sdk.state.offering.availablePackages[0].product.subscriptionPeriod = null;
    const next = await purchases(w).getCurrentOffering();
    assert.deepEqual(next.packages.map((pkg) => pkg.id), ["$rc_annual"]);
    assert.equal(next.packages[0].pricePerMonthString, "$5.00", "the SDK's own per-month string is passed on");
    w.sdk.state.offering = null;
    assert.equal(await purchases(w).getCurrentOffering(), null, "no current offering: the Paywall is unavailable");
    w.sdk.state.offering = defaultOffering();
    w.sdk.state.failNext.getOfferings = { code: "10" };
    assert.equal(await purchases(w).getCurrentOffering(), null, "an error: unavailable, never a throw");
  });

  await test("offering: on iOS an introductory price of 0 is a free trial of its length; a paid one, or an Android free phase, is not", async (w) => {
    await rc(w).startRevenueCat("user_a");
    const yearly = w.sdk.state.offering.availablePackages[1].product;
    yearly.introPrice = { price: 0, priceString: "$0.00", cycles: 1, period: "P1W", periodUnit: "WEEK", periodNumberOfUnits: 1 };
    let annual = (await purchases(w).getCurrentOffering()).packages.find((pkg) => pkg.kind === "annual");
    assert.deepEqual(annual.introOffer, { kind: "free_trial", periodDays: 7 });
    yearly.introPrice = { price: 0, priceString: "$0.00", cycles: 1, period: "P3D", periodUnit: "DAY", periodNumberOfUnits: 3 };
    annual = (await purchases(w).getCurrentOffering()).packages.find((pkg) => pkg.kind === "annual");
    assert.deepEqual(annual.introOffer, { kind: "free_trial", periodDays: 3 });
    yearly.introPrice = { price: 0.99, priceString: "$0.99", cycles: 1, period: "P1M", periodUnit: "MONTH", periodNumberOfUnits: 1 };
    annual = (await purchases(w).getCurrentOffering()).packages.find((pkg) => pkg.kind === "annual");
    assert.equal(annual.introOffer, null);
    yearly.introPrice = null;
    yearly.defaultOption = { freePhase: { billingPeriod: { unit: "DAY", value: 7, iso8601: "P7D" } } };
    annual = (await purchases(w).getCurrentOffering()).packages.find((pkg) => pkg.kind === "annual");
    assert.equal(annual.introOffer, null, "iOS reads the introductory price only");
  }, { mode: "native", platform: "ios" });

  await test("offering: on Android the default option's free phase is a free trial of its length", async (w) => {
    await rc(w).startRevenueCat("user_a");
    const yearly = w.sdk.state.offering.availablePackages[1].product;
    yearly.defaultOption = { freePhase: { billingPeriod: { unit: "WEEK", value: 1, iso8601: "P1W" } } };
    let annual = (await purchases(w).getCurrentOffering()).packages.find((pkg) => pkg.kind === "annual");
    assert.deepEqual(annual.introOffer, { kind: "free_trial", periodDays: 7 });
    yearly.defaultOption = { freePhase: null };
    annual = (await purchases(w).getCurrentOffering()).packages.find((pkg) => pkg.kind === "annual");
    assert.equal(annual.introOffer, null);
  }, { mode: "native", platform: "android" });
}

// ================================================================== trials
async function eligibilityChecks() {
  await test("eligibility: Expo Go never confirms a trial, and does not even ask", async (w) => {
    await rc(w).startRevenueCat("user_a");
    w.sdk.state.offering.availablePackages[1].product.introPrice = {
      price: 0,
      priceString: "$0.00",
      cycles: 1,
      period: "P1W",
      periodUnit: "WEEK",
      periodNumberOfUnits: 1,
    };
    await purchases(w).getCurrentOffering();
    assert.equal(await purchases(w).isTrialEligible("$rc_annual"), false);
    assert.equal(count(w, "checkEligibility"), 0);
  });

  await test("eligibility: on iOS only ELIGIBLE confirms a trial; an error, or a package never read, does not", async (w) => {
    await rc(w).startRevenueCat("user_a");
    await purchases(w).getCurrentOffering();
    const status = INTRO_ELIGIBILITY_STATUS;
    for (const [answer, expected] of [
      [status.INTRO_ELIGIBILITY_STATUS_ELIGIBLE, true],
      [status.INTRO_ELIGIBILITY_STATUS_INELIGIBLE, false],
      [status.INTRO_ELIGIBILITY_STATUS_UNKNOWN, false],
      [status.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS, false],
    ]) {
      w.sdk.state.eligibility.gracehush_pro_yearly = answer;
      assert.equal(await purchases(w).isTrialEligible("$rc_annual"), expected, `status ${answer}`);
    }
    w.sdk.state.eligibility.gracehush_pro_yearly = status.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
    w.sdk.state.failNext.checkEligibility = { code: "10" };
    assert.equal(await purchases(w).isTrialEligible("$rc_annual"), false);
    assert.equal(await purchases(w).isTrialEligible("$rc_unknown"), false);
  }, { mode: "native", platform: "ios" });

  await test("eligibility: on Android the free phase Google Play sent is the confirmation", async (w) => {
    await rc(w).startRevenueCat("user_a");
    w.sdk.state.offering.availablePackages[1].product.defaultOption = {
      freePhase: { billingPeriod: { unit: "DAY", value: 7, iso8601: "P7D" } },
    };
    await purchases(w).getCurrentOffering();
    assert.equal(await purchases(w).isTrialEligible("$rc_annual"), true);
    assert.equal(await purchases(w).isTrialEligible("$rc_monthly"), false);
  }, { mode: "native", platform: "android" });
}

// ================================================================== purchases and restores
async function purchaseChecks() {
  await test("errors: every RevenueCat error is one of the Paywall's codes, and nothing is synced after one", async (w) => {
    await rc(w).startRevenueCat("user_a");
    await purchases(w).getCurrentOffering();
    const { notices } = copyOf(w).paywall;
    const cases = [
      ["cancel", "CANCELLED"],
      [{ code: "1", userCancelled: null }, "CANCELLED"],
      [{ code: "2", userCancelled: true }, "CANCELLED"],
      [{ code: 1 }, "CANCELLED"],
      [{ code: "20" }, "PENDING"],
      [{ code: "10" }, "NETWORK"],
      [{ code: "35" }, "NETWORK"],
      [{ code: "3" }, "NOT_ALLOWED"],
      [{ code: "6" }, "ALREADY_OWNED"],
      ["failed", "UNKNOWN"],
      [{ code: "2" }, "UNKNOWN"],
      [{ code: "23" }, "UNKNOWN"],
      [{ code: "999" }, "UNKNOWN"],
      [new Error("plain"), "UNKNOWN"],
      ["a string thrown", "UNKNOWN"],
    ];
    for (const [answer, code] of cases) {
      w.sdk.state.alert.push(typeof answer === "string" && answer !== "cancel" && answer !== "failed" ? { message: answer } : answer);
      const result = await purchases(w).purchasePackage("$rc_annual");
      assert.equal(result.ok, false);
      assert.equal(result.code, code, JSON.stringify(answer));
    }
    w.sdk.state.alert.push({ code: "20" });
    assert.equal((await purchases(w).purchasePackage("$rc_annual")).message, notices.pending);
    w.sdk.state.alert.push("cancel");
    assert.equal((await purchases(w).purchasePackage("$rc_annual")).message, "", "a cancelled purchase says nothing");
    assert.equal(syncCalls(w).length, 0);
    assert.equal(entitlement(w).tier, "free");
  });

  await test("purchase: the Test Store's valid purchase gives Pro; the app waits for sync-subscription and then the profile sync before it answers", async (w) => {
    await rc(w).startRevenueCat("user_a");
    await purchases(w).getCurrentOffering();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    recordSync(w, { gate });
    let answered = false;
    const pending = purchases(w).purchasePackage("$rc_annual").then((result) => {
      answered = true;
      return result;
    });
    await settle(20);
    assert.equal(answered, false, "the purchase waits for the server");
    assert.equal(entitlement(w).tier, "pro", "RevenueCat's answer shows at once");
    release();
    assert.deepEqual(await pending, { ok: true, tier: "pro" });
    assert.deepEqual(w.order.filter((step) => ["rc:purchasePackage", "sync-subscription", "profile sync"].includes(step)), [
      "rc:purchasePackage",
      "sync-subscription",
      "profile sync",
    ]);
    assert.deepEqual([w.server.state.serverPlans.user_a, snapshotTier(w)], ["pro", "pro"]);
    assert.equal(entitlement(w).lastSync.ok, true);
    assert.equal((await repo(w).getUsage()).tier, "pro");
    assert.deepEqual(syncCalls(w)[0].body, {}, "nothing travels in the body: the token says who is asking");
  });

  await test("purchase: a sync that fails does not fail the purchase; the plan reaches the server later", async (w) => {
    await rc(w).startRevenueCat("user_a");
    await purchases(w).getCurrentOffering();
    recordSync(w, { answer: fnError(503, "BILLING_UNAVAILABLE") });
    assert.deepEqual(await purchases(w).purchasePackage("$rc_monthly"), { ok: true, tier: "pro" });
    assert.deepEqual(entitlement(w).lastSync && [entitlement(w).lastSync.ok, entitlement(w).lastSync.code], [false, "BILLING_UNAVAILABLE"]);
    assert.ok(!w.order.includes("profile sync"), "no profile sync after a failed sync");
    assert.equal(snapshotTier(w), "free");
    assert.equal((await repo(w).getUsage()).tier, "pro", "the screens still show what RevenueCat said");
  });

  await test("purchase: a purchase that did not give Pro (a product not attached to pro), or a package never read, is UNKNOWN", async (w) => {
    await rc(w).startRevenueCat("user_a");
    await purchases(w).getCurrentOffering();
    w.sdk.state.alert.push("unattached");
    assert.equal((await purchases(w).purchasePackage("$rc_annual")).code, "UNKNOWN");
    assert.equal((await purchases(w).purchasePackage("$rc_lifetime")).code, "UNKNOWN");
    assert.equal(count(w, "purchasePackage"), 1, "the package the Paywall never showed is not bought");
    assert.equal(syncCalls(w).length, 0);
  });

  await test("restore: a purchase found is restored and synced; nothing found is not restored; an error is NETWORK or UNKNOWN", async (w) => {
    await rc(w).startRevenueCat("user_a");
    w.server.state.revenueCatPlans.user_a = "pro";
    assert.deepEqual(await purchases(w).restorePurchases(), { ok: true, restored: true, tier: "pro" });
    assert.deepEqual([syncCalls(w).length, snapshotTier(w), entitlement(w).tier], [1, "pro", "pro"]);
    w.server.state.revenueCatPlans.user_a = "free";
    clock.now += 60_000;
    assert.deepEqual(await purchases(w).restorePurchases(), { ok: true, restored: false, tier: "free" });
    const { notices } = copyOf(w).paywall;
    w.sdk.state.failNext.restorePurchases = { code: "10" };
    assert.deepEqual(await purchases(w).restorePurchases(), { ok: false, code: "NETWORK", message: notices.error });
    w.sdk.state.failNext.restorePurchases = { code: "2" };
    assert.deepEqual(await purchases(w).restorePurchases(), { ok: false, code: "UNKNOWN", message: notices.error });
    await rc(w).endRevenueCatSession();
    assert.equal((await purchases(w).restorePurchases()).ok, false, "with nobody logged in, nothing is restored");
  });

  await test("purchase: what the free limit held is sent by itself once the server's plan is paid, never on RevenueCat's word alone", async (w) => {
    await w.startEngine();
    const outbox = w.use("@/db/outbox");
    const engine = w.use("@/services/syncEngine");
    const stopWatching = w.use("@/services/upgradeWatcher").watchPlan("user_a");
    try {
      w.server.state.functions["process-entry"].push(() => json(402, limitBody("entry-held", "2026-10-30T00:00:00.000Z")));
      await outbox.enqueue(text("held"));
      await engine.syncAndWait("held", { waitMs: 60_000 });
      assert.equal((await outbox.get("held")).status, "limit_reached");
      // RevenueCat says Pro, the server does not know yet: nothing is sent.
      w.server.state.revenueCatPlans.user_a = "pro";
      await rc(w).startRevenueCat("user_a");
      assert.equal(entitlement(w).tier, "pro");
      assert.equal(repo(w).getKnownTier(), "free", "the engine follows the server's plan only");
      await engine.syncNow("manual");
      await settle(30);
      assert.equal((await outbox.get("held")).status, "limit_reached");
      assert.equal(functionCalls(w, "process-entry").length, 1);
      // The server reads RevenueCat (sync-subscription), the profile sync brings the plan, and the held reflection goes.
      assert.equal(await planSync(w).syncPlanNow(), true);
      await settle(40);
      assert.equal(await outbox.get("held"), null, "sent with no tap");
      assert.equal(functionCalls(w, "process-entry").length, 2);
    } finally {
      stopWatching();
    }
  });
}

// ================================================================== the plan watch
async function watchChecks() {
  await test("watch: at sign-in it waits for both plans, then syncs once when they differ (a Pro set by hand that RevenueCat never sold), once per foreground even when that sync fails", async (w) => {
    recordSync(w, { answer: fnError(503, "BILLING_UNAVAILABLE") });
    const stop = planSync(w).startPlanWatch("user_a");
    await settle(10);
    assert.equal(syncCalls(w).length, 0, "RevenueCat has not answered yet");
    await rc(w).startRevenueCat("user_a");
    await settle(30);
    assert.equal(syncCalls(w).length, 1);
    assert.equal(snapshotTier(w), "pro", "the first sync failed: the plans still differ");
    entitlement(w).setEntitlement("user_a", "free", null);
    await settle(20);
    assert.equal(syncCalls(w).length, 1, "once per foreground, even when it failed");
    clock.now += 60_000;
    w.appState.emit("active");
    await settle(40);
    assert.equal(syncCalls(w).length, 2, "the next foreground tries again");
    assert.deepEqual([w.server.state.serverPlans.user_a, snapshotTier(w)], ["free", "free"]);
    stop();
  }, { tier: "pro" });

  await test("watch: each foreground reads the entitlement again and syncs once when the plans differ; equal plans send nothing", async (w) => {
    planSync(w).startPlanWatch("user_a");
    await rc(w).startRevenueCat("user_a");
    await settle(20);
    assert.equal(syncCalls(w).length, 0, "both free: nothing to do");
    // A purchase on another phone: RevenueCat knows, no webhook has arrived yet.
    w.server.state.revenueCatPlans.user_a = "pro";
    const reads = count(w, "getCustomerInfo");
    w.appState.emit("active");
    await settle(40);
    assert.equal(count(w, "getCustomerInfo"), reads + 1, "the entitlement is read again");
    assert.equal(syncCalls(w).length, 1);
    assert.equal(snapshotTier(w), "pro");
    clock.now += 60_000;
    w.appState.emit("active");
    await settle(40);
    assert.equal(syncCalls(w).length, 1, "the plans agree now");
    w.appState.emit("background");
    await settle(10);
    assert.equal(count(w, "getCustomerInfo"), reads + 2, "only coming to the front reads it");
  });

  await test("watch: stopped (sign-out, another account) it asks nothing; on the mock data source it does nothing", async (w) => {
    await rc(w).startRevenueCat("user_a");
    w.server.state.revenueCatPlans.user_a = "pro";
    planSync(w).startPlanWatch("user_a");
    planSync(w).stopPlanWatch();
    w.appState.emit("active");
    await settle(30);
    assert.equal(syncCalls(w).length, 0);
    planSync(w).startPlanWatch("user_b");
    await rc(w).refreshEntitlement();
    await settle(20);
    assert.equal(syncCalls(w).length, 0, "user_a's entitlement never counts for user_b's watch");
    dev(w).setDataSource("mock");
    planSync(w).startPlanWatch("user_a");
    w.appState.emit("active");
    await settle(30);
    assert.equal(syncCalls(w).length, 0);
  });
}

// ================================================================== the mock data source
async function mockChecks() {
  await test("mock source: the step 16 mock answers as before, with its dev flags, and RevenueCat is never asked", async (w) => {
    dev(w).setDataSource("mock");
    await rc(w).startRevenueCat("user_a");
    const before = w.sdk.state.calls.length;
    const settled = async (promise) => {
      await advance(1_000);
      return promise;
    };
    const offering = await settled(purchases(w).getCurrentOffering());
    assert.deepEqual(offering.packages.map((pkg) => pkg.id), ["$rc_annual", "$rc_monthly"]);
    dev(w).setOfferingUnavailable(true);
    assert.equal(await settled(purchases(w).getCurrentOffering()), null);
    dev(w).setOfferingUnavailable(false);
    assert.equal(await settled(purchases(w).isTrialEligible("$rc_annual")), true);
    dev(w).setNextPurchaseOutcome("cancelled");
    assert.equal((await settled(purchases(w).purchasePackage("$rc_annual"))).code, "CANCELLED");
    dev(w).setNextPurchaseOutcome("pending");
    assert.equal((await settled(purchases(w).purchasePackage("$rc_annual"))).code, "PENDING");
    assert.deepEqual(await settled(purchases(w).purchasePackage("$rc_annual")), { ok: true, tier: "trial" });
    assert.equal(repo(w).getMockSubscriptionTier(), "trial");
    assert.equal(await settled(purchases(w).isTrialEligible("$rc_annual")), false, "the trial is used up");
    dev(w).setRestoreFindsPurchase(true);
    assert.deepEqual(await settled(purchases(w).restorePurchases()), { ok: true, restored: true, tier: "pro" });
    assert.equal(repo(w).getKnownTier(), "pro", "on the mock data source the mock plan is the plan");
    assert.equal(w.sdk.state.calls.length, before, "RevenueCat was never asked");
    assert.equal(syncCalls(w).length, 0, "and nothing reached the server");
  });
}

// ================================================================== the development log
async function logChecks() {
  await test("log: one [billing] line per sync, saying ok or a code, and no id, key, price or plan anywhere", async (w) => {
    await rc(w).startRevenueCat("user_a");
    await purchases(w).getCurrentOffering();
    w.sdk.state.managementURL = "https://apps.apple.com/account/subscriptions/manage";
    await purchases(w).purchasePackage("$rc_annual");
    recordSync(w, { answer: fnError(503, "BILLING_UNAVAILABLE") });
    await planSync(w).syncPlanNow();
    assert.deepEqual(
      w.logs.filter((line) => line.includes("[billing]")),
      ["[billing] sync ok", "[billing] sync BILLING_UNAVAILABLE"],
    );
    assert.equal(entitlement(w).managementUrl, "https://apps.apple.com/account/subscriptions/manage");
  });
}

(async () => {
  await keyChecks();
  await sessionChecks();
  await mappingChecks();
  await eligibilityChecks();
  await purchaseChecks();
  await watchChecks();
  await mockChecks();
  await logChecks();
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
