// TEMP(30): replace internals with react-native-purchases, keep signatures and return shapes.
// TODO(30): real offerings, eligibility, purchase, restore, entitlement "pro", Purchases.logIn(clerkUserId)
import { copy } from "@/constants/copy";
import { getMockSubscriptionTier, setMockSubscriptionTier } from "@/data/journalRepository";
import { buildMockOffering } from "@/data/mock/offerings";
import { takeMockPurchaseOutcome } from "@/data/mock/scenario";
import { resumeAfterUpgrade } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import type { Offering, PurchaseErrorCode, PurchaseResult, RestoreResult } from "@/types";

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

// The mock fails closed: outside development there is no offering, no trial, and a purchase answers NOT_ALLOWED,
// so no build can hand out Pro for free. Do not ship a build that takes payments before step 30 replaces this.
// Nothing here is logged: no plan, price or identity.

export async function getCurrentOffering(): Promise<Offering | null> {
  if (!__DEV__) return null;
  await delay(READ_MS);
  return useDevStore.getState().offeringUnavailable ? null : buildMockOffering();
}

// True only for a package that has a free trial, and only while the store would still offer this user one.
export async function isTrialEligible(packageId: string): Promise<boolean> {
  if (!__DEV__) return false;
  await delay(READ_MS);
  const pkg = buildMockOffering().packages.find((candidate) => candidate.id === packageId);
  return pkg !== undefined && pkg.introOffer !== null && useDevStore.getState().trialEligible;
}

// A success changes the mock plan (and tells Profile to reload), so the rest of the session follows. Buying a
// trial uses up the trial for the session. Every other outcome leaves the plan as it was.
export async function purchasePackage(packageId: string): Promise<PurchaseResult> {
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
      // What the free limit held back goes now (step 24). Step 30's entitlement listener calls this too.
      void resumeAfterUpgrade();
      return { ok: true, tier };
    }
  }
}

export async function restorePurchases(): Promise<RestoreResult> {
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
