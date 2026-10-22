import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { AMBIENT_SOUNDS } from "@/constants/app";
import type { AmbientSound, ProfilePatch, SubscriptionTier } from "@/types";

import { safeStorage } from "./safeStorage";

// What the server has no column for yet (the three settings step 15 added) and the two profile fields the app
// shows offline (when the account was created, and the plan). Kept per Clerk user, so a second account on the same
// phone never sees the first one's. TODO(18): the settings become users_profile columns; delete this store then
// (step 24's cache keeps the offline copy of createdAt and the plan).
export type SavedPrefs = {
  affirmationsEnabled?: boolean;
  ambientSound?: AmbientSound;
  ambientVolume?: number; // 0 to 1
};

export type ServerSnapshot = {
  createdAt: string; // ISO
  subscriptionTier: SubscriptionTier;
  syncedAt: string; // ISO, when the server last said so
};

export type ProfileEntry = { prefs: SavedPrefs; snapshot: ServerSnapshot | null };

interface ProfilePrefsState {
  byUser: Record<string, ProfileEntry>;
  savePrefs: (userId: string, patch: ProfilePatch) => void;
  saveSnapshot: (userId: string, snapshot: ServerSnapshot) => void;
  forgetUser: (userId: string) => void; // account deletion
}

const TIERS: readonly SubscriptionTier[] = ["free", "trial", "pro"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function readPrefs(value: unknown): SavedPrefs {
  const saved = isRecord(value) ? value : {};
  const prefs: SavedPrefs = {};
  if (typeof saved.affirmationsEnabled === "boolean") prefs.affirmationsEnabled = saved.affirmationsEnabled;
  const sound = AMBIENT_SOUNDS.find((item) => item === saved.ambientSound);
  if (sound !== undefined) prefs.ambientSound = sound;
  const volume = saved.ambientVolume;
  if (typeof volume === "number" && Number.isFinite(volume)) {
    prefs.ambientVolume = Math.min(1, Math.max(0, volume));
  }
  return prefs;
}

function readSnapshot(value: unknown): ServerSnapshot | null {
  if (!isRecord(value)) return null;
  const tier = TIERS.find((item) => item === value.subscriptionTier);
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.syncedAt) || tier === undefined) return null;
  return { createdAt: value.createdAt, subscriptionTier: tier, syncedAt: value.syncedAt };
}

const emptyEntry = (): ProfileEntry => ({ prefs: {}, snapshot: null });

export const useProfilePrefsStore = create<ProfilePrefsState>()(
  persist(
    (set) => ({
      byUser: {},
      savePrefs: (userId, patch) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          const prefs: SavedPrefs = { ...entry.prefs };
          if (patch.affirmationsEnabled !== undefined) prefs.affirmationsEnabled = patch.affirmationsEnabled;
          if (patch.ambientSound !== undefined) prefs.ambientSound = patch.ambientSound;
          if (patch.ambientVolume !== undefined) prefs.ambientVolume = patch.ambientVolume;
          return { byUser: { ...state.byUser, [userId]: { ...entry, prefs } } };
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
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ byUser: state.byUser }),
      // zustand's default merge is shallow, and the saved JSON may be damaged: check every field, and drop what fails.
      merge: (persisted: unknown, current: ProfilePrefsState): ProfilePrefsState => {
        const saved = isRecord(persisted) && isRecord(persisted.byUser) ? persisted.byUser : {};
        const byUser = Object.fromEntries(
          Object.entries(saved).flatMap(([userId, entry]) => {
            if (!isRecord(entry)) return [];
            return [[userId, { prefs: readPrefs(entry.prefs), snapshot: readSnapshot(entry.snapshot) }]];
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
