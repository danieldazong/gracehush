import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { AMBIENT_SOUNDS } from "@/constants/app";
import type { ProfilePatch, SubscriptionTier } from "@/types";

import { safeStorage } from "./safeStorage";

// The offline copy of the signed-in user's profile, kept per Clerk user so a second account on the same phone never
// sees the first one's (step 17; step 18 moved the three settings to users_profile columns):
// - `snapshot` is what the server last said: when the account was created, the plan and the three settings.
// - `unsent` holds the settings the user changed on this device that the server has not confirmed yet. They show on
//   top of the snapshot and win over the server until a sync sends them, the same rule the reminder times follow.
// No journal text is kept here.
export type Settings = Required<ProfilePatch>;

export type ServerSnapshot = Settings & {
  createdAt: string; // ISO
  subscriptionTier: SubscriptionTier;
  syncedAt: string; // ISO, when the server last said so
};

export type ProfileEntry = { unsent: ProfilePatch; snapshot: ServerSnapshot | null };

interface ProfilePrefsState {
  byUser: Record<string, ProfileEntry>;
  saveUnsent: (userId: string, patch: ProfilePatch) => void; // the user changed a setting
  clearUnsent: (userId: string, sent: ProfilePatch) => void; // the server has these: drop each one not edited since
  saveSnapshot: (userId: string, snapshot: ServerSnapshot) => void;
  forgetUser: (userId: string) => void; // account deletion
}

const TIERS: readonly SubscriptionTier[] = ["free", "trial", "pro"];
// The column defaults of supabase/migrations/20261022120100_gracehush_v1_schema.sql, for a snapshot saved before
// step 18 (it has no settings).
const DEFAULT_SETTINGS: Settings = { affirmationsEnabled: true, ambientSound: "off", ambientVolume: 0.5 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function readVolume(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function readUnsent(value: unknown): ProfilePatch {
  const saved = isRecord(value) ? value : {};
  const unsent: ProfilePatch = {};
  if (typeof saved.affirmationsEnabled === "boolean") unsent.affirmationsEnabled = saved.affirmationsEnabled;
  const sound = AMBIENT_SOUNDS.find((item) => item === saved.ambientSound);
  if (sound !== undefined) unsent.ambientSound = sound;
  const volume = readVolume(saved.ambientVolume);
  if (volume !== undefined) unsent.ambientVolume = volume;
  return unsent;
}

function readSnapshot(value: unknown): ServerSnapshot | null {
  if (!isRecord(value)) return null;
  const tier = TIERS.find((item) => item === value.subscriptionTier);
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.syncedAt) || tier === undefined) return null;
  return {
    createdAt: value.createdAt,
    subscriptionTier: tier,
    syncedAt: value.syncedAt,
    affirmationsEnabled:
      typeof value.affirmationsEnabled === "boolean"
        ? value.affirmationsEnabled
        : DEFAULT_SETTINGS.affirmationsEnabled,
    ambientSound: AMBIENT_SOUNDS.find((item) => item === value.ambientSound) ?? DEFAULT_SETTINGS.ambientSound,
    ambientVolume: readVolume(value.ambientVolume) ?? DEFAULT_SETTINGS.ambientVolume,
  };
}

const emptyEntry = (): ProfileEntry => ({ unsent: {}, snapshot: null });

export const useProfilePrefsStore = create<ProfilePrefsState>()(
  persist(
    (set) => ({
      byUser: {},
      saveUnsent: (userId, patch) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          const unsent: ProfilePatch = { ...entry.unsent };
          if (patch.affirmationsEnabled !== undefined) unsent.affirmationsEnabled = patch.affirmationsEnabled;
          if (patch.ambientSound !== undefined) unsent.ambientSound = patch.ambientSound;
          if (patch.ambientVolume !== undefined) unsent.ambientVolume = patch.ambientVolume;
          return { byUser: { ...state.byUser, [userId]: { ...entry, unsent } } };
        }),
      clearUnsent: (userId, sent) =>
        set((state) => {
          const entry = state.byUser[userId];
          if (entry === undefined) return state;
          // A setting edited again while the request was away no longer equals what was sent, so it stays unsent.
          const unsent: ProfilePatch = { ...entry.unsent };
          if (sent.affirmationsEnabled !== undefined && unsent.affirmationsEnabled === sent.affirmationsEnabled) {
            delete unsent.affirmationsEnabled;
          }
          if (sent.ambientSound !== undefined && unsent.ambientSound === sent.ambientSound) {
            delete unsent.ambientSound;
          }
          if (sent.ambientVolume !== undefined && unsent.ambientVolume === sent.ambientVolume) {
            delete unsent.ambientVolume;
          }
          if (Object.keys(unsent).length === Object.keys(entry.unsent).length) return state;
          return { byUser: { ...state.byUser, [userId]: { ...entry, unsent } } };
        }),
      saveSnapshot: (userId, snapshot) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          return { byUser: { ...state.byUser, [userId]: { ...entry, snapshot } } };
        }),
      forgetUser: (userId) =>
        set((state) => ({
          byUser: Object.fromEntries(Object.entries(state.byUser).filter(([id]) => id !== userId)),
        })),
    }),
    {
      name: "gracehush.profilePrefs",
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ byUser: state.byUser }),
      // Version 1 (step 17) kept the three settings in `prefs`: nothing sent them anywhere, so every one of them is an
      // edit the server has not seen. They become `unsent`, and the first sync sends the ones that differ.
      migrate: (persisted: unknown, version: number) => {
        if (version >= 2 || !isRecord(persisted) || !isRecord(persisted.byUser)) return persisted;
        const byUser = Object.fromEntries(
          Object.entries(persisted.byUser).flatMap(([userId, entry]) =>
            isRecord(entry) ? [[userId, { unsent: entry.prefs, snapshot: entry.snapshot }]] : [],
          ),
        );
        return { byUser };
      },
      // zustand's default merge is shallow, and the saved JSON may be damaged: check every field, and drop what fails.
      merge: (persisted: unknown, current: ProfilePrefsState): ProfilePrefsState => {
        const saved = isRecord(persisted) && isRecord(persisted.byUser) ? persisted.byUser : {};
        const byUser = Object.fromEntries(
          Object.entries(saved).flatMap(([userId, entry]) => {
            if (!isRecord(entry)) return [];
            return [[userId, { unsent: readUnsent(entry.unsent), snapshot: readSnapshot(entry.snapshot) }]];
          }),
        );
        return { ...current, byUser };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error && __DEV__) {
          console.warn("[profilePrefs] could not load the saved state", error);
        }
      },
    },
  ),
);
