import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_REMINDERS } from "@/constants/app";
import type { TimeSlot } from "@/types";

import { safeStorage } from "./safeStorage";

// Whether the person chose to share anonymous usage data (step 34). It belongs to the device, like the reminder times, so
// sign-out keeps it. "unset" counts as no.
export type AnalyticsConsent = "unset" | "granted" | "declined";

interface OnboardingState {
  hasCompletedOnboarding: boolean;
  completedAt: string | null; // ISO
  reminders: Record<TimeSlot, string>; // "HH:mm", 24-hour
  permissionsPromptedAt: string | null; // ISO, set once the permission prompts were shown
  remindersSyncedAt: string | null; // ISO, set when the times last matched users_profile (step 17)
  remindersDirty: boolean; // an edit the server has not seen yet (step 17)
  analyticsConsent: AnalyticsConsent; // step 34
  setReminder: (slot: TimeSlot, hhmm: string) => void;
  markRemindersSynced: () => void; // the server has these times
  applyServerReminders: (times: Record<TimeSlot, string>) => void; // the server's times replace this device's
  discardUnsyncedReminders: () => void; // sign out: an unsent edit belongs to the account that made it
  completeOnboarding: () => void; // idempotent
  markPermissionsPrompted: () => void;
  setAnalyticsConsent: (consent: "granted" | "declined") => void;
  resetOnboarding: () => void; // dev only
}

// What is saved: data only, never functions.
type OnboardingPersisted = Pick<
  OnboardingState,
  | "hasCompletedOnboarding"
  | "completedAt"
  | "reminders"
  | "permissionsPromptedAt"
  | "remindersSyncedAt"
  | "remindersDirty"
  | "analyticsConsent"
>;

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isHHmm(value: unknown): value is string {
  return typeof value === "string" && HHMM_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// A string that Date.parse accepts, else null.
function toTimestamp(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function pickReminder(saved: Record<string, unknown>, slot: TimeSlot, fallback: string): string {
  const value = saved[slot];
  return isHHmm(value) ? value : fallback;
}

function getInitialData(): OnboardingPersisted {
  return {
    hasCompletedOnboarding: false,
    completedAt: null,
    reminders: { ...DEFAULT_REMINDERS },
    permissionsPromptedAt: null,
    remindersSyncedAt: null,
    remindersDirty: false,
    analyticsConsent: "unset",
  };
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      ...getInitialData(),
      setReminder: (slot, hhmm) => {
        if (!isHHmm(hhmm)) {
          if (__DEV__) {
            console.warn(`[onboarding] ignored an invalid ${slot} reminder: ${hhmm}`);
          }
          return;
        }
        // The iOS wheel can report the same value repeatedly.
        if (get().reminders[slot] === hhmm) {
          return;
        }
        set((state) => ({
          reminders: { ...state.reminders, [slot]: hhmm },
          remindersSyncedAt: null,
          remindersDirty: true,
        }));
      },
      markRemindersSynced: () =>
        set({ remindersDirty: false, remindersSyncedAt: new Date().toISOString() }),
      applyServerReminders: (times) =>
        set((state) => ({
          reminders: {
            morning: isHHmm(times.morning) ? times.morning : state.reminders.morning,
            afternoon: isHHmm(times.afternoon) ? times.afternoon : state.reminders.afternoon,
            evening: isHHmm(times.evening) ? times.evening : state.reminders.evening,
          },
          remindersDirty: false,
          remindersSyncedAt: new Date().toISOString(),
        })),
      discardUnsyncedReminders: () => set({ remindersDirty: false }),
      completeOnboarding: () => {
        if (get().hasCompletedOnboarding) {
          return;
        }
        set({ hasCompletedOnboarding: true, completedAt: new Date().toISOString() });
      },
      markPermissionsPrompted: () => {
        if (get().permissionsPromptedAt !== null) {
          return;
        }
        set({ permissionsPromptedAt: new Date().toISOString() });
      },
      setAnalyticsConsent: (consent) => set({ analyticsConsent: consent }),
      resetOnboarding: () => set(getInitialData()),
    }),
    {
      name: "gracehush.onboarding",
      version: 3,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state): OnboardingPersisted => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        completedAt: state.completedAt,
        reminders: state.reminders,
        permissionsPromptedAt: state.permissionsPromptedAt,
        remindersSyncedAt: state.remindersSyncedAt,
        remindersDirty: state.remindersDirty,
        analyticsConsent: state.analyticsConsent,
      }),
      // `merge` validates every field. Version 2 (step 17) added remindersDirty. Before it nothing synced the times, so
      // a time that differs from the default was changed on this device and the server has not seen it. Version 3 (step 34)
      // added analyticsConsent: a save from before it has never been asked, so it is unset.
      migrate: (persisted: unknown, version: number) => {
        const saved: Record<string, unknown> = isRecord(persisted) ? persisted : {};
        if (version >= 3) return saved as OnboardingPersisted;
        if (version === 2) return { ...saved, analyticsConsent: "unset" } as OnboardingPersisted;
        const savedReminders: Record<string, unknown> = isRecord(saved.reminders) ? saved.reminders : {};
        const changed = (Object.keys(DEFAULT_REMINDERS) as TimeSlot[]).some(
          (slot) => isHHmm(savedReminders[slot]) && savedReminders[slot] !== DEFAULT_REMINDERS[slot],
        );
        return {
          ...saved,
          remindersDirty: changed && saved.remindersSyncedAt == null,
          analyticsConsent: "unset",
        } as OnboardingPersisted;
      },
      // zustand's default merge is shallow: one bad reminder slot would replace the whole object.
      merge: (persisted: unknown, current: OnboardingState): OnboardingState => {
        const saved: Record<string, unknown> = isRecord(persisted) ? persisted : {};
        const savedReminders: Record<string, unknown> = isRecord(saved.reminders)
          ? saved.reminders
          : {};
        return {
          ...current,
          hasCompletedOnboarding: saved.hasCompletedOnboarding === true,
          completedAt: toTimestamp(saved.completedAt),
          reminders: {
            morning: pickReminder(savedReminders, "morning", current.reminders.morning),
            afternoon: pickReminder(savedReminders, "afternoon", current.reminders.afternoon),
            evening: pickReminder(savedReminders, "evening", current.reminders.evening),
          },
          permissionsPromptedAt: toTimestamp(saved.permissionsPromptedAt),
          remindersSyncedAt: toTimestamp(saved.remindersSyncedAt),
          remindersDirty: saved.remindersDirty === true,
          analyticsConsent:
            saved.analyticsConsent === "granted" || saved.analyticsConsent === "declined" ? saved.analyticsConsent : "unset",
        };
      },
      // With safeStorage this should never fire: it is the last line of defence.
      onRehydrateStorage: () => (_state, error) => {
        if (error && __DEV__) {
          console.warn("[onboarding] could not load the saved state", error);
        }
      },
    },
  ),
);
