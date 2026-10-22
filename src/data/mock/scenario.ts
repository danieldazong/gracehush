import { supabaseEnv } from "@/constants/env";
import { useDevStore } from "@/store/devStore";

export type MockScenario = "default" | "empty" | "offline";

// Where the profile comes from (step 17). A release build always uses Supabase. In development the dev panel
// chooses, and a development build whose .env.local has no Supabase address falls back to the mock, so the app
// still runs before the Supabase project exists.
export type ProfileSource = "supabase" | "mock";

export function getProfileSource(): ProfileSource {
  if (!__DEV__) return "supabase";
  return supabaseEnv.status === "ok" ? useDevStore.getState().profileSource : "mock";
}

// What the next mock submit answers (step 10): a finished entry, a crisis entry, a failure or the free limit.
export type MockSubmitOutcome = "ready" | "crisis" | "failed" | "limit";

// Production builds always use "default" until real data replaces the mocks.
export function getMockScenario(): MockScenario {
  return __DEV__ ? useDevStore.getState().scenario : "default";
}

// One-shot, like nextHomeLoadFails: it goes back to "ready" as soon as a submit takes it, so a
// "Try again" after "failed" succeeds and a forgotten "crisis" never sticks.
export function takeMockSubmitOutcome(): MockSubmitOutcome {
  if (!__DEV__) return "ready";
  const dev = useDevStore.getState();
  const outcome = dev.nextSubmitOutcome;
  dev.setNextSubmitOutcome("ready");
  return outcome;
}

// What the next mock purchase answers (step 16).
export type MockPurchaseOutcome =
  | "success"
  | "cancelled"
  | "pending"
  | "failed"
  | "not-allowed"
  | "already-owned";

// One-shot, like the submit outcome: a purchase takes it and it goes back to "success", so a forgotten
// "cancelled" never sticks.
export function takeMockPurchaseOutcome(): MockPurchaseOutcome {
  if (!__DEV__) return "success";
  const dev = useDevStore.getState();
  const outcome = dev.nextPurchaseOutcome;
  dev.setNextPurchaseOutcome("success");
  return outcome;
}

// One-shot as well (step 14): true when the next prayer change has to fail, and the flag clears in the same
// call, so the change after it works.
export function takeMockPrayerMutationFailure(): boolean {
  if (!__DEV__) return false;
  const dev = useDevStore.getState();
  if (!dev.nextPrayerMutationFails) return false;
  dev.setNextPrayerMutationFails(false);
  return true;
}
