import { Platform } from "react-native";

import { copy } from "@/constants/copy";
import { getMockSubscriptionTier, setMockSubscriptionTier } from "@/data/journalRepository";
import { buildMockOffering } from "@/data/mock/offerings";
import { getDataSource, takeMockPurchaseOutcome } from "@/data/mock/scenario";
import {
  buyPackage,
  checkEligibility,
  inExpoGo,
  INTRO_ELIGIBILITY_STATUS,
  loadCurrentOffering,
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  type PurchasesPackage,
  type PurchasesStoreProduct,
  recordCustomerInfo,
  restore,
  revenueCatReady,
} from "@/services/revenuecat";
import { syncPlanNow } from "@/services/subscriptionSync";
import { resumeAfterUpgrade } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import type {
  IntroOffer,
  Offering,
  PackageKind,
  PlanPackage,
  PurchaseErrorCode,
  PurchaseResult,
  RestoreResult,
  SubscriptionTier,
} from "@/types";

// The Paywall's and Profile's purchases (step 16), on RevenueCat since step 30 (services/revenuecat.ts). The mock data source
// keeps the step 16 mock exactly as it was, with its five dev flags; the real one is always RevenueCat. RevenueCat is the source
// of truth: after a purchase or a restore the app asks the server to re-read it (syncPlanNow) before it answers, so "Welcome"
// appears once the server knows. Nothing here is logged: no plan, price or identity.

const { notices } = copy.paywall;

// How long a mock call waits, so the screen shows its loading and busy states.
const READ_MS = __DEV__ ? 300 : 0;
const PURCHASE_MS = 800;

// Neither of the first two is ever shown: a cancelled purchase says nothing, and an already-owned one runs a
// restore instead.
const MESSAGES: Record<PurchaseErrorCode, string> = {
  CANCELLED: "",
  ALREADY_OWNED: "",
  PENDING: notices.pending,
  NOT_ALLOWED: notices.notAllowed,
  NETWORK: notices.error,
  UNKNOWN: notices.error,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failed(code: PurchaseErrorCode): PurchaseResult {
  return { ok: false, code, message: MESSAGES[code] };
}

// ---- RevenueCat ------------------------------------------------------------------------------------------------------------
// The SDK's packages of the last offering read, by identifier: a purchase hands RevenueCat its own package object.
const sdkPackages = new Map<string, PurchasesPackage>();

const DAYS_PER_UNIT: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

function periodDays(unit: string, count: number): number | null {
  const days = DAYS_PER_UNIT[unit.toUpperCase()];
  return days === undefined || !Number.isFinite(count) || count <= 0 ? null : days * count;
}

// A free trial the product has: on iOS an introductory price of 0, on Android the default option's free phase (Google Play
// sends it only to someone who can still have it). Whether this person may have it is asked apart (isTrialEligible).
function introOfferOf(product: PurchasesStoreProduct): IntroOffer | null {
  let days: number | null = null;
  if (Platform.OS === "ios" && product.introPrice !== null && product.introPrice.price === 0) {
    days = periodDays(product.introPrice.periodUnit, product.introPrice.periodNumberOfUnits);
  } else if (Platform.OS === "android" && product.defaultOption?.freePhase) {
    const { unit, value } = product.defaultOption.freePhase.billingPeriod;
    days = periodDays(unit, value);
  }
  return days === null ? null : { kind: "free_trial", periodDays: days };
}

function periodLabelOf(period: string | null): PlanPackage["periodLabel"] | null {
  if (period === "P1Y" || period === "P12M") return "year";
  if (period === "P1M") return "month";
  return null;
}

// The Paywall shows the yearly and the monthly package. Any other package, and any product with no subscription period, is
// left out.
function toPlanPackage(pkg: PurchasesPackage): PlanPackage | null {
  const kind: PackageKind | null =
    pkg.packageType === PACKAGE_TYPE.ANNUAL ? "annual" : pkg.packageType === PACKAGE_TYPE.MONTHLY ? "monthly" : null;
  const periodLabel = periodLabelOf(pkg.product.subscriptionPeriod);
  if (kind === null || periodLabel === null) return null;
  return {
    id: pkg.identifier,
    kind,
    productId: pkg.product.identifier,
    priceString: pkg.product.priceString,
    price: pkg.product.price,
    currencyCode: pkg.product.currencyCode,
    periodLabel,
    pricePerMonthString: pkg.product.pricePerMonthString ?? null,
    introOffer: introOfferOf(pkg.product),
  };
}

// RevenueCat's error, as one of the Paywall's codes. A cancelled purchase is never an error the person needs to read.
function purchaseErrorCode(error: unknown): PurchaseErrorCode {
  const { code, userCancelled } = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    userCancelled?: unknown;
  };
  const named = typeof code === "number" ? String(code) : code;
  if (userCancelled === true || named === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return "CANCELLED";
  switch (named) {
    case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
      return "PENDING";
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
    case PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR:
      return "NETWORK";
    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
      return "NOT_ALLOWED";
    case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
      return "ALREADY_OWNED";
    default:
      // The Test Store's "Test failed purchase" (PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR), a store problem, and anything new.
      return "UNKNOWN";
  }
}

async function realOffering(): Promise<Offering | null> {
  try {
    const current = await loadCurrentOffering();
    if (current === null) return null;
    sdkPackages.clear();
    const packages: PlanPackage[] = [];
    for (const pkg of current.availablePackages) {
      const plan = toPlanPackage(pkg);
      if (plan === null) continue;
      sdkPackages.set(plan.id, pkg);
      packages.push(plan);
    }
    return { id: current.identifier, packages };
  } catch {
    return null;
  }
}

// A trial is advertised only when confirmed. Expo Go's Browser Mode always answers "unknown", so it is never confirmed there.
async function realTrialEligible(packageId: string): Promise<boolean> {
  const pkg = sdkPackages.get(packageId);
  if (inExpoGo() || !revenueCatReady() || pkg === undefined) return false;
  try {
    if (Platform.OS === "ios") {
      const answer = await checkEligibility([pkg.product.identifier]);
      return answer[pkg.product.identifier]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
    }
    return Platform.OS === "android" && Boolean(pkg.product.defaultOption?.freePhase);
  } catch {
    return false;
  }
}

async function realPurchase(packageId: string): Promise<PurchaseResult> {
  if (!revenueCatReady()) return failed("NOT_ALLOWED");
  const pkg = sdkPackages.get(packageId);
  if (pkg === undefined) return failed("UNKNOWN");
  let tier: SubscriptionTier;
  try {
    tier = recordCustomerInfo((await buyPackage(pkg)).customerInfo);
  } catch (error) {
    return failed(purchaseErrorCode(error));
  }
  // A purchase that did not give Pro: the product is not attached to the pro entitlement.
  if (tier === "free") return failed("UNKNOWN");
  // The server reads RevenueCat and the plan reaches this phone before the Paywall says welcome. A failure does not fail the
  // purchase: the webhook and the next foreground catch up.
  await syncPlanNow().catch(() => false);
  return { ok: true, tier };
}

async function realRestore(): Promise<RestoreResult> {
  if (!revenueCatReady()) return { ok: false, code: "UNKNOWN", message: MESSAGES.UNKNOWN };
  let tier: SubscriptionTier;
  try {
    tier = recordCustomerInfo(await restore());
  } catch (error) {
    const code = purchaseErrorCode(error) === "NETWORK" ? "NETWORK" : "UNKNOWN";
    return { ok: false, code, message: MESSAGES[code] };
  }
  await syncPlanNow().catch(() => false);
  return { ok: true, restored: tier !== "free", tier };
}

// ---- the mock data source (step 16) -----------------------------------------------------------------------------------------
// It fails closed: outside development there is no offering, no trial, and a purchase answers NOT_ALLOWED. A release build
// never reaches it, because its data source is always the real one.

async function mockOffering(): Promise<Offering | null> {
  if (!__DEV__) return null;
  await delay(READ_MS);
  return useDevStore.getState().offeringUnavailable ? null : buildMockOffering();
}

async function mockTrialEligible(packageId: string): Promise<boolean> {
  if (!__DEV__) return false;
  await delay(READ_MS);
  const pkg = buildMockOffering().packages.find((candidate) => candidate.id === packageId);
  return pkg !== undefined && pkg.introOffer !== null && useDevStore.getState().trialEligible;
}

// A success changes the mock plan (and tells Profile to reload), so the rest of the session follows. Buying a
// trial uses up the trial for the session. Every other outcome leaves the plan as it was.
async function mockPurchase(packageId: string): Promise<PurchaseResult> {
  if (!__DEV__) return failed("NOT_ALLOWED");
  const outcome = takeMockPurchaseOutcome();
  await delay(PURCHASE_MS);
  const pkg = buildMockOffering().packages.find((candidate) => candidate.id === packageId);
  if (pkg === undefined) return failed("UNKNOWN");
  switch (outcome) {
    case "cancelled":
      return failed("CANCELLED");
    case "pending":
      return failed("PENDING");
    case "failed":
      return failed("NETWORK");
    case "not-allowed":
      return failed("NOT_ALLOWED");
    case "already-owned":
      return failed("ALREADY_OWNED");
    case "success": {
      const dev = useDevStore.getState();
      const tier = pkg.introOffer !== null && dev.trialEligible ? "trial" : "pro";
      setMockSubscriptionTier(tier);
      if (tier === "trial") dev.setTrialEligible(false);
      dev.bumpMockProfileVersion();
      // What the free limit held back goes now (step 24). On RevenueCat, upgradeWatcher does this when the plan arrives.
      void resumeAfterUpgrade();
      return { ok: true, tier };
    }
  }
}

async function mockRestore(): Promise<RestoreResult> {
  if (!__DEV__) return { ok: true, restored: false, tier: "free" };
  await delay(PURCHASE_MS);
  const dev = useDevStore.getState();
  if (dev.restoreFindsPurchase) {
    setMockSubscriptionTier("pro");
    dev.bumpMockProfileVersion();
    void resumeAfterUpgrade();
    return { ok: true, restored: true, tier: "pro" };
  }
  return { ok: true, restored: false, tier: getMockSubscriptionTier() };
}

// ---- the four calls the screens make ----------------------------------------------------------------------------------------
const isMockSource = () => getDataSource() === "mock";

export function getCurrentOffering(): Promise<Offering | null> {
  return isMockSource() ? mockOffering() : realOffering();
}

// True only for a package that has a free trial, and only while the store would still offer this user one.
export function isTrialEligible(packageId: string): Promise<boolean> {
  return isMockSource() ? mockTrialEligible(packageId) : realTrialEligible(packageId);
}

export function purchasePackage(packageId: string): Promise<PurchaseResult> {
  return isMockSource() ? mockPurchase(packageId) : realPurchase(packageId);
}

export function restorePurchases(): Promise<RestoreResult> {
  return isMockSource() ? mockRestore() : realRestore();
}
