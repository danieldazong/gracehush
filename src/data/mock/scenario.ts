import { useDevStore } from "@/store/devStore";

export type MockScenario = "default" | "empty" | "offline";

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
