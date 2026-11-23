import { useCallback } from "react";

import { refreshEntitlement } from "@/services/revenuecat";
import { useEntitlementStore } from "@/store/entitlementStore";
import type { TrialStatus } from "@/types";

// The end of a free trial as the server writes a time, or null (none, or a date that cannot be read).
function trialEnd(trial: TrialStatus | null): string | null {
  if (trial === null) return null;
  const end = new Date(trial.endsAt);
  return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

// What RevenueCat last reported for the signed-in account (step 30), for gating in the UI only: the server enforces every limit
// itself. `known` is false until RevenueCat has answered; `refresh` reads the customer again. `trialEndsAt` is when a free trial's
// plan begins (2026-11-18: Scholar opens then, because the trial does not include it).
export function useEntitlement() {
  const tier = useEntitlementStore((state) => state.tier);
  const managementUrl = useEntitlementStore((state) => state.managementUrl);
  const trialEndsAt = useEntitlementStore((state) => trialEnd(state.trial));
  const refresh = useCallback(() => refreshEntitlement(), []);
  return { tier, isPaid: tier === "trial" || tier === "pro", known: tier !== null, managementUrl, trialEndsAt, refresh };
}
