import { create } from "zustand";

import type { RevenueCatKeyKind } from "@/constants/env";
import type { SubscriptionTier } from "@/types";

// What RevenueCat last said about the signed-in account (step 30). Not persisted: it is read again at every sign-in and every
// foreground, and cleared at sign-out, so it never reaches another account. Written only by services/revenuecat.ts and
// services/subscriptionSync.ts. It holds a plan, a link and times, never a price, a receipt or an id beyond whose it is.
export type LastPlanSync = { at: number; ok: boolean; code: string | null };

interface EntitlementState {
  // Whose entitlement this is: a tier read for one account never counts for another.
  userId: string | null;
  // Which RevenueCat key this build is using; null before the service has started.
  keyKind: RevenueCatKeyKind | "none" | null;
  // What RevenueCat last reported for userId; null before it has answered.
  tier: SubscriptionTier | null;
  // RevenueCat's link to the store's subscription page, when it has one.
  managementUrl: string | null;
  checkedAt: number | null;
  // The app's last sync-subscription call.
  lastSync: LastPlanSync | null;
  start: (userId: string, keyKind: RevenueCatKeyKind | "none") => void;
  setEntitlement: (userId: string, tier: SubscriptionTier, managementUrl: string | null) => void;
  setLastSync: (sync: LastPlanSync) => void;
  clear: () => void;
}

const EMPTY = { userId: null, keyKind: null, tier: null, managementUrl: null, checkedAt: null, lastSync: null };

export const useEntitlementStore = create<EntitlementState>()((set, get) => ({
  ...EMPTY,
  // A new account starts from nothing known, so the previous account's plan is never shown for it.
  start: (userId, keyKind) =>
    set(get().userId === userId ? { keyKind } : { ...EMPTY, userId, keyKind }),
  // An answer about an account that is no longer the signed-in one is dropped.
  setEntitlement: (userId, tier, managementUrl) => {
    if (get().userId !== userId) return;
    set({ tier, managementUrl, checkedAt: Date.now() });
  },
  setLastSync: (lastSync) => set({ lastSync }),
  clear: () => set(EMPTY),
}));
