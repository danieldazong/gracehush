import { AppState } from "react-native";

import { syncSubscription } from "@/api/journalApi";
import { getDataSource } from "@/data/mock/scenario";
import { syncProfile } from "@/services/profileSync";
import { refreshEntitlement } from "@/services/revenuecat";
import { reconcileTrialReminder } from "@/services/trialReminder";
import { useEntitlementStore, type EntitlementState } from "@/store/entitlementStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";

// Keeps the server's plan in step with RevenueCat's (step 30). The server never takes the app's word for a purchase: the app
// only asks it to look (sync-subscription), and the server re-reads RevenueCat and writes users_profile.subscription_tier. The
// profile sync then brings that plan to this phone, and upgradeWatcher sends what the free limit held back.

// Asks the server to re-read RevenueCat, then brings the plan it wrote to this phone. Best effort: a failure changes nothing,
// and the webhook and the next foreground catch up. In development one line says how it went: never an id, a tier or a time.
export async function syncPlanNow(): Promise<boolean> {
  const result = await syncSubscription();
  useEntitlementStore.getState().setLastSync({ at: Date.now(), ok: result.ok, code: result.ok ? null : result.code });
  if (__DEV__) console.info(`[billing] sync ${result.ok ? "ok" : result.code}`);
  if (!result.ok) return false;
  await syncProfile();
  return true;
}

// Started by the auth bridge with the profile sync, for the signed-in account. Each time the app comes to the front it reads the
// entitlement again (Expo Go sends no updates of its own), and when RevenueCat's plan and the server's differ it asks the server
// to look, once per foreground. At sign-in the same check runs once both plans are known: the first entitlement and the first
// profile sync. On the mock data source nothing reaches the server, so it does nothing. One watch at a time: starting one
// stops the one before, and sign-out stops it (stopPlanWatch) before the account goes.
let stopCurrent: (() => void) | null = null;

export function stopPlanWatch(): void {
  stopCurrent?.();
  stopCurrent = null;
}

export function startPlanWatch(userId: string): () => void {
  stopPlanWatch();
  let stopped = false;
  // True once this foreground's check has run, so a sync and the profile sync it brings never start another.
  let checked = false;
  // While the entitlement is being read again, the check waits for its answer rather than compare an older one.
  let refreshing = false;

  const serverTier = () => useProfilePrefsStore.getState().byUser[userId]?.snapshot?.subscriptionTier ?? null;
  const revenueCatTier = () => {
    const state = useEntitlementStore.getState();
    return state.userId === userId ? state.tier : null;
  };

  const check = () => {
    if (stopped || checked || refreshing || getDataSource() !== "supabase") return;
    const fromRevenueCat = revenueCatTier();
    const fromServer = serverTier();
    if (fromRevenueCat === null || fromServer === null) return;
    checked = true;
    if (fromRevenueCat !== fromServer) void syncPlanNow();
  };

  // The trial-end reminder follows RevenueCat's answer for this account (2026-11-18): a trial that is gone, or that was cancelled
  // in the store and will not renew, has nothing to remind about, so a reminder that is waiting is removed. Only on the real data
  // source (the mock plan has no store behind it), only for this account's own answer, and once for each answer, not for every
  // other change of the store. It never makes a reminder and never asks for a permission.
  const reconcile = (state: EntitlementState, previous: EntitlementState | null) => {
    if (stopped || getDataSource() !== "supabase") return;
    if (state.userId !== userId || state.checkedAt === null) return;
    if (previous !== null && state.checkedAt === previous.checkedAt) return;
    void reconcileTrialReminder(state.trial);
  };

  const stopEntitlement = useEntitlementStore.subscribe(check);
  const stopTrial = useEntitlementStore.subscribe(reconcile);
  const stopPrefs = useProfilePrefsStore.subscribe(check);
  const subscription = AppState.addEventListener("change", (status) => {
    if (status !== "active" || stopped) return;
    checked = false;
    refreshing = true;
    void refreshEntitlement().finally(() => {
      refreshing = false;
      check();
    });
  });
  check();
  reconcile(useEntitlementStore.getState(), null);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    subscription.remove();
    stopEntitlement();
    stopTrial();
    stopPrefs();
    if (stopCurrent === stop) stopCurrent = null;
  };
  stopCurrent = stop;
  return stop;
}
