import { ENTRIES_PAGE_SIZE } from "@/constants/app";
import { supabaseEnv } from "@/constants/env";
import { useDevStore } from "@/store/devStore";

export type MockScenario = "default" | "empty" | "offline";

// Where the data comes from: the profile (step 17), and the entries, the affirmations and the processing of a reflection
// (step 25). A release build always uses Supabase. In development the dev panel chooses, and a development build whose
// .env.local has no Supabase address falls back to the mock, so the app still runs before the Supabase project exists. The
// mock is the step 06 data with its scenarios and the dev store's outcomes: it never reaches the server and never the cache.
export type DataSource = "supabase" | "mock";

export function getDataSource(): DataSource {
  if (!__DEV__) return "supabase";
  return supabaseEnv.status === "ok" ? useDevStore.getState().dataSource : "mock";
}

// How many entries one page of the Journal holds. The developer panel can make it small, so the second page can be reached
// with a few entries.
export function getEntriesPageSize(): number {
  return __DEV__ ? useDevStore.getState().pageSize : ENTRIES_PAGE_SIZE;
}

// What the next mock submit answers (step 10): a finished entry, a crisis entry, a failure, the free limit, or (step 24)
// a refusal that only the person can fix.
export type MockSubmitOutcome = "ready" | "crisis" | "failed" | "limit" | "too_short";

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

// One-shot too (step 24): true when the next mock call to the server "gets no answer", so the engine's retries can be
// seen. The flag clears in the same call.
export function takeMockNetworkFailure(): boolean {
  if (!__DEV__) return false;
  const dev = useDevStore.getState();
  if (!dev.nextNetworkFails) return false;
  dev.setNextNetworkFails(false);
  return true;
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
