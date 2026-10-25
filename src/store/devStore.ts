import { create } from "zustand";

import type {
  MockPurchaseOutcome,
  MockScenario,
  MockSubmitOutcome,
  ProfileSource,
} from "@/data/mock/scenario";
import type { PermissionResult } from "@/types";

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
  // The next call the sync engine makes to the (mock) server gets no answer, once, so its retries can be seen
  // (takeMockNetworkFailure). Step 24.
  nextNetworkFails: boolean;
  setNextNetworkFails: (value: boolean) => void;
  // The next Reflection load fails once, so its error state can be reached.
  nextReflectionLoadFails: boolean;
  setNextReflectionLoadFails: (value: boolean) => void;
  // The next crisis phone, text or web link "cannot be opened" once, so the fallback sheet can be reached
  // on a device that has a phone app (useCrisisActions clears it as it fails the link).
  nextCrisisLinkFails: boolean;
  setNextCrisisLinkFails: (value: boolean) => void;
  // The next prayer change (mark answered, move back to Active, edit a note) fails once, so the failure
  // paths of the Prayers screen and its sheet can be reached. Step 15 reuses it for the next profile save,
  // data export and account deletion as well: one flag, not a third.
  nextPrayerMutationFails: boolean;
  setNextPrayerMutationFails: (value: boolean) => void;
  // Bumped after the mock plan changes. The mock tier lives in the mock database, outside any store, so the
  // screens that show it (Profile, the dev panel) reload when this changes.
  mockProfileVersion: number;
  bumpMockProfileVersion: () => void;
  // What Profile treats as the notification permission, so every card state can be reached: Expo Go on
  // Android cannot import expo-notifications, so there the real answer is always "undetermined".
  notificationStatusOverride: PermissionResult | null;
  setNotificationStatusOverride: (status: PermissionResult | null) => void;
  // What the next mock purchase answers (step 16). A purchase puts it back to "success" (takeMockPurchaseOutcome).
  nextPurchaseOutcome: MockPurchaseOutcome;
  setNextPurchaseOutcome: (outcome: MockPurchaseOutcome) => void;
  // Whether the store would offer this user a free trial. Buying a trial turns it off for the session.
  trialEligible: boolean;
  setTrialEligible: (value: boolean) => void;
  // Whether "Restore purchases" finds a purchase.
  restoreFindsPurchase: boolean;
  setRestoreFindsPurchase: (value: boolean) => void;
  // The store has no offering to show, so the paywall's "plans aren't available" state can be reached.
  offeringUnavailable: boolean;
  setOfferingUnavailable: (value: boolean) => void;
  // Where the profile comes from (step 17): the real Supabase row, or the step 06 mock with its plans and scenarios.
  // Read through getProfileSource(), which also falls back to the mock when .env.local has no Supabase address.
  profileSource: ProfileSource;
  setProfileSource: (source: ProfileSource) => void;
}

export const useDevStore = create<DevState>()((set) => ({
  scenario: "default",
  setScenario: (scenario) => set({ scenario }),
  nextHomeLoadFails: false,
  setNextHomeLoadFails: (nextHomeLoadFails) => set({ nextHomeLoadFails }),
  nextSubmitOutcome: "ready",
  setNextSubmitOutcome: (nextSubmitOutcome) => set({ nextSubmitOutcome }),
  nextNetworkFails: false,
  setNextNetworkFails: (nextNetworkFails) => set({ nextNetworkFails }),
  nextReflectionLoadFails: false,
  setNextReflectionLoadFails: (nextReflectionLoadFails) => set({ nextReflectionLoadFails }),
  nextCrisisLinkFails: false,
  setNextCrisisLinkFails: (nextCrisisLinkFails) => set({ nextCrisisLinkFails }),
  nextPrayerMutationFails: false,
  setNextPrayerMutationFails: (nextPrayerMutationFails) => set({ nextPrayerMutationFails }),
  mockProfileVersion: 0,
  bumpMockProfileVersion: () =>
    set((state) => ({ mockProfileVersion: state.mockProfileVersion + 1 })),
  notificationStatusOverride: null,
  setNotificationStatusOverride: (notificationStatusOverride) => set({ notificationStatusOverride }),
  nextPurchaseOutcome: "success",
  setNextPurchaseOutcome: (nextPurchaseOutcome) => set({ nextPurchaseOutcome }),
  trialEligible: true,
  setTrialEligible: (trialEligible) => set({ trialEligible }),
  restoreFindsPurchase: false,
  setRestoreFindsPurchase: (restoreFindsPurchase) => set({ restoreFindsPurchase }),
  offeringUnavailable: false,
  setOfferingUnavailable: (offeringUnavailable) => set({ offeringUnavailable }),
  profileSource: "supabase",
  setProfileSource: (profileSource) => set({ profileSource }),
}));
