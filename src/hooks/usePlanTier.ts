import { useAuth } from "@clerk/expo";
import { useCallback, useSyncExternalStore } from "react";

import { shownTierFor } from "@/data/journalRepository";
import { useDevStore } from "@/store/devStore";
import { useEntitlementStore } from "@/store/entitlementStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { SubscriptionTier } from "@/types";

// The plan is read from three stores: RevenueCat's answer (the entitlement store), the server's plan from the last profile sync
// (the profile prefs store) and, on the mock data source, the developer panel's plan (the dev store, whose version moves when the
// mock plan changes and which holds the data source itself). Any change in one of them reads the plan again.
function subscribe(onChange: () => void): () => void {
  const offs = [
    useEntitlementStore.subscribe(onChange),
    useProfilePrefsStore.subscribe(onChange),
    useDevStore.subscribe(onChange),
  ];
  return () => {
    for (const off of offs) off();
  };
}

// The signed-in account's plan as Profile's plan card shows it (shownTierFor), or null until it is known (2026-11-19). The
// picture's tag (UserAvatar) and the header's spoken label read it, so they change the moment a purchase or a sync changes it.
export function usePlanTier(): SubscriptionTier | null {
  const { userId } = useAuth();
  const id = userId ?? null;
  const read = useCallback(() => shownTierFor(id), [id]);
  return useSyncExternalStore(subscribe, read);
}
