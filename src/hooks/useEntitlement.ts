import { useCallback } from "react";

import { refreshEntitlement } from "@/services/revenuecat";
import { useEntitlementStore } from "@/store/entitlementStore";

// What RevenueCat last reported for the signed-in account (step 30), for gating in the UI only: the server enforces every limit
// itself. `known` is false until RevenueCat has answered; `refresh` reads the customer again.
export function useEntitlement() {
  const tier = useEntitlementStore((state) => state.tier);
  const managementUrl = useEntitlementStore((state) => state.managementUrl);
  const refresh = useCallback(() => refreshEntitlement(), []);
  return { tier, isPaid: tier === "trial" || tier === "pro", known: tier !== null, managementUrl, refresh };
}
