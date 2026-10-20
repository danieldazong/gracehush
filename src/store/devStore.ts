import { create } from "zustand";

import type { MockScenario, MockSubmitOutcome } from "@/data/mock/scenario";

// Development-only controls. Not persisted, flat, and never read in a release build: getMockScenario()
// answers "default" there, and nothing outside the DevToolsPanel sets a flag. Later steps add their own
// `next…` flags here.
interface DevState {
  scenario: MockScenario;
  setScenario: (scenario: MockScenario) => void;
  // The next Journal Home load fails once, so the error state can be reached.
  nextHomeLoadFails: boolean;
  setNextHomeLoadFails: (value: boolean) => void;
  // What the next New Entry submit answers. A submit puts it back to "ready" (takeMockSubmitOutcome).
  nextSubmitOutcome: MockSubmitOutcome;
  setNextSubmitOutcome: (outcome: MockSubmitOutcome) => void;
  // The next Reflection load fails once, so its error state can be reached.
  nextReflectionLoadFails: boolean;
  setNextReflectionLoadFails: (value: boolean) => void;
}

export const useDevStore = create<DevState>()((set) => ({
  scenario: "default",
  setScenario: (scenario) => set({ scenario }),
  nextHomeLoadFails: false,
  setNextHomeLoadFails: (nextHomeLoadFails) => set({ nextHomeLoadFails }),
  nextSubmitOutcome: "ready",
  setNextSubmitOutcome: (nextSubmitOutcome) => set({ nextSubmitOutcome }),
  nextReflectionLoadFails: false,
  setNextReflectionLoadFails: (nextReflectionLoadFails) => set({ nextReflectionLoadFails }),
}));
