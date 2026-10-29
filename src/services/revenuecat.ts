import { isRunningInExpoGo } from "expo";
import { Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type IntroEligibility,
  LOG_LEVEL,
  type MakePurchaseResult,
  type PurchasesOffering,
  type PurchasesPackage,
} from "react-native-purchases";

import { PRO_ENTITLEMENT_ID } from "@/constants/app";
import {
  chooseRevenueCatKey,
  REVENUECAT_ANDROID_KEY,
  REVENUECAT_IOS_KEY,
  REVENUECAT_TEST_STORE_KEY,
  type RevenueCatKeyChoice,
} from "@/constants/env";
import { useEntitlementStore } from "@/store/entitlementStore";
import type { SubscriptionTier } from "@/types";

// The only file that imports react-native-purchases (step 30). RevenueCat knows each person by their Clerk user id: it is
// configured only after sign-in, with that id, so there is never an anonymous customer of ours, and it logs out at sign-out.
//
// In Expo Go the SDK runs in its Browser Mode (RevenueCat's web SDK) and takes only the Test Store key; there it never sends
// customer-info updates, so the app reads the entitlement again after a purchase, after a restore and when it comes to the front
// (services/subscriptionSync.ts). Nothing here logs a customer, a receipt, a key, an id or a price, and the SDK's own log level is
// WARN in every build, because its DEBUG and INFO lines print the app user id.
export { INTRO_ELIGIBILITY_STATUS, PACKAGE_TYPE, PURCHASES_ERROR_CODE } from "react-native-purchases";
export type { PurchasesOffering, PurchasesPackage, PurchasesStoreProduct } from "react-native-purchases";

let configured = false;
// The signed-in account, and who RevenueCat is logged in as. Purchases run only while the two are the same account: a login
// that failed must never leave a purchase going to the previous account's customer.
let wanted: string | null = null;
let loggedInAs: string | null = null;
let listening = false;
// Every start and every end adds one, so an answer that arrives after the account changed is dropped.
let session = 0;

export function inExpoGo(): boolean {
  return isRunningInExpoGo();
}

export function currentRevenueCatKey(): RevenueCatKeyChoice {
  return chooseRevenueCatKey({
    inExpoGo: inExpoGo(),
    isDev: __DEV__,
    platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other",
    testKey: REVENUECAT_TEST_STORE_KEY,
    iosKey: REVENUECAT_IOS_KEY,
    androidKey: REVENUECAT_ANDROID_KEY,
  });
}

// True while purchases can run: RevenueCat is configured and logged in as the signed-in account.
export function revenueCatReady(): boolean {
  return configured && loggedInAs !== null && loggedInAs === wanted;
}

// Configures RevenueCat once with the signed-in account's Clerk id, or logs in as it. A failure (a key RevenueCat refuses, no
// connection) leaves purchases unavailable, and the next refresh (each foreground) tries again.
async function ensureLoggedIn(): Promise<boolean> {
  const target = wanted;
  if (target === null) return false;
  if (revenueCatReady()) return true;
  const choice = currentRevenueCatKey();
  if (choice.kind === "none") return false;
  try {
    if (!configured) {
      await Purchases.setLogLevel(LOG_LEVEL.WARN);
      Purchases.configure({ apiKey: choice.apiKey, appUserID: target });
      configured = true;
    } else {
      loggedInAs = null;
      await Purchases.logIn(target);
    }
    loggedInAs = target;
    return revenueCatReady();
  } catch {
    return false;
  }
}

// Pure: the plan an SDK CustomerInfo says. An active `pro` in its trial period is trial; any other active `pro` is pro.
export function tierFromCustomerInfo(info: Pick<CustomerInfo, "entitlements">): SubscriptionTier {
  const pro = info.entitlements.active[PRO_ENTITLEMENT_ID] as CustomerInfo["entitlements"]["active"][string] | undefined;
  if (pro === undefined) return "free";
  return String(pro.periodType).toUpperCase() === "TRIAL" ? "trial" : "pro";
}

// Writes what a CustomerInfo says into the store, for the account RevenueCat is logged in as, and gives the tier.
export function recordCustomerInfo(info: CustomerInfo): SubscriptionTier {
  const tier = tierFromCustomerInfo(info);
  if (loggedInAs !== null) useEntitlementStore.getState().setEntitlement(loggedInAs, tier, info.managementURL ?? null);
  return tier;
}

// A native build's update listener. Expo Go never calls it.
function onCustomerInfo(info: CustomerInfo): void {
  recordCustomerInfo(info);
}

// After sign-in, and again for another account. With no usable key (none set, a secret key, a Test Store key in a release
// build) purchases are simply unavailable.
export async function startRevenueCat(userId: string): Promise<void> {
  session += 1;
  const mine = session;
  wanted = userId;
  const choice = currentRevenueCatKey();
  useEntitlementStore.getState().start(userId, choice.kind === "none" ? "none" : choice.kind);
  if (choice.kind === "none") return;
  if (!(await ensureLoggedIn()) || mine !== session) return;
  if (!inExpoGo() && !listening) {
    Purchases.addCustomerInfoUpdateListener(onCustomerInfo);
    listening = true;
  }
  await refreshEntitlement();
}

// Reads the customer again. A failure leaves the store as it was.
export async function refreshEntitlement(): Promise<SubscriptionTier | null> {
  const mine = session;
  if (!(await ensureLoggedIn()) || mine !== session) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    if (mine !== session) return null;
    return recordCustomerInfo(info);
  } catch {
    return null;
  }
}

// The calls services/purchases.ts makes. Each gives the SDK's own objects back, or throws the SDK's error unchanged.
export async function loadCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!revenueCatReady()) return null;
  return (await Purchases.getOfferings()).current;
}

export function checkEligibility(productIds: string[]): Promise<Record<string, IntroEligibility>> {
  return Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
}

export function buyPackage(pkg: PurchasesPackage): Promise<MakePurchaseResult> {
  return Purchases.purchasePackage(pkg);
}

export function restore(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

// At sign-out: log out of RevenueCat (errors ignored), so the next account starts clean, then forget the entitlement.
export async function endRevenueCatSession(): Promise<void> {
  session += 1;
  wanted = null;
  if (configured && loggedInAs !== null) {
    loggedInAs = null;
    try {
      if (!(await Purchases.isAnonymous())) await Purchases.logOut();
    } catch {
      // Logged out already, or no connection: the next sign-in logs in as its own account anyway.
    }
  }
  useEntitlementStore.getState().clear();
}
