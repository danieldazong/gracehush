import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { AMBIENT_SOUNDS } from "@/constants/app";
import { isScholarVoiceKey, type ScholarVoiceKey } from "@/constants/scholarVoices";
import type { ProfilePatch, SubscriptionTier } from "@/types";

import { safeStorage } from "./safeStorage";

// The offline copy of the signed-in user's profile, kept per Clerk user so a second account on the same phone never
// sees the first one's (step 17; step 18 moved the three settings to users_profile columns):
// - `snapshot` is what the server last said: when the account was created, the plan and the three settings.
// - `unsent` holds the settings the user changed on this device that the server has not confirmed yet. They show on
//   top of the snapshot and win over the server until a sync sends them, the same rule the reminder times follow.
// - `aiPermissionAt` is when this account allowed its words and recordings to go to Google's AI (Apple's guideline 5.1.2(i)), or
//   null for not yet, or taken back. It lives only on this phone: a new phone, or a reinstall, asks again. It survives a sign-out
//   like the rest of the entry, and account deletion forgets it.
// - `aiWording` is which words of that permission the account allowed (step 38): AI_WORDING names Scholar beside the
//   devotionals. Missing means the first words (2026-11-07), and an account that allowed under them sees a one-time note in its
//   first Scholar conversation, which records the new words.
// - `voicePermissionAt` (step 39) is when this account allowed ElevenLabs (its voice in a live talk, and since 2026-11-19 the
//   answers it chooses to hear with Listen, read in the chosen voice), or missing for not yet. It lives only on this phone, like
//   the AI permission, and a talk needs both.
// - `scholarVoice` (step 39) is the voice this account chose for Scholar (a live talk, and Listen while ElevenLabs is allowed),
//   or missing for the default. On this phone only.
// - `talkCaptions` (2026-11-16) is false when this account turned the live talk's captions off, and missing while they are on
//   (the default). On this phone only.
// No journal text is kept here.
export type Settings = Required<ProfilePatch>;

export type ServerSnapshot = Settings & {
  createdAt: string; // ISO
  subscriptionTier: SubscriptionTier;
  syncedAt: string; // ISO, when the server last said so
};

export type ProfileEntry = {
  unsent: ProfilePatch;
  snapshot: ServerSnapshot | null;
  aiPermissionAt: string | null;
  aiWording?: number;
  voicePermissionAt?: string;
  scholarVoice?: ScholarVoiceKey;
  talkCaptions?: false;
};

// The permission's current words (step 38). The first words, which named only the devotionals, were 1.
export const AI_WORDING = 2;

interface ProfilePrefsState {
  byUser: Record<string, ProfileEntry>;
  saveUnsent: (userId: string, patch: ProfilePatch) => void; // the user changed a setting
  clearUnsent: (userId: string, sent: ProfilePatch) => void; // the server has these: drop each one not edited since
  saveSnapshot: (userId: string, snapshot: ServerSnapshot) => void;
  setAiPermission: (userId: string, at: string | null) => void;
  markAiWording: (userId: string) => void; // the one-time note was shown
  setVoicePermission: (userId: string, at: string | null) => void;
  setScholarVoice: (userId: string, voice: ScholarVoiceKey) => void;
  setTalkCaptions: (userId: string, on: boolean) => void;
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

const emptyEntry = (): ProfileEntry => ({ unsent: {}, snapshot: null, aiPermissionAt: null });

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
      setAiPermission: (userId, at) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          // Allowing now is allowing the current words.
          const wording = at === null ? {} : { aiWording: AI_WORDING };
          return { byUser: { ...state.byUser, [userId]: { ...entry, aiPermissionAt: at, ...wording } } };
        }),
      markAiWording: (userId) =>
        set((state) => {
          const entry = state.byUser[userId];
          if (entry === undefined || entry.aiWording === AI_WORDING) return state;
          return { byUser: { ...state.byUser, [userId]: { ...entry, aiWording: AI_WORDING } } };
        }),
      setVoicePermission: (userId, at) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          const next: ProfileEntry = { ...entry };
          if (at === null) delete next.voicePermissionAt;
          else next.voicePermissionAt = at;
          return { byUser: { ...state.byUser, [userId]: next } };
        }),
      setScholarVoice: (userId, voice) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          if (entry.scholarVoice === voice) return state;
          return { byUser: { ...state.byUser, [userId]: { ...entry, scholarVoice: voice } } };
        }),
      setTalkCaptions: (userId, on) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          if ((entry.talkCaptions !== false) === on) return state;
          const next: ProfileEntry = { ...entry };
          if (on) delete next.talkCaptions;
          else next.talkCaptions = false;
          return { byUser: { ...state.byUser, [userId]: next } };
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
            return [
              [
                userId,
                {
                  unsent: readUnsent(entry.unsent),
                  snapshot: readSnapshot(entry.snapshot),
                  // A damaged value is no permission, and so is a save from before this field existed.
                  aiPermissionAt: isTimestamp(entry.aiPermissionAt) ? entry.aiPermissionAt : null,
                  // Kept only when it is a whole number: a missing or damaged value reads as the first words.
                  ...(Number.isInteger(entry.aiWording) ? { aiWording: entry.aiWording as number } : {}),
                  // Missing, or damaged, reads as no voice permission and the default voice (step 39).
                  ...(isTimestamp(entry.voicePermissionAt) ? { voicePermissionAt: entry.voicePermissionAt } : {}),
                  ...(isScholarVoiceKey(entry.scholarVoice) ? { scholarVoice: entry.scholarVoice } : {}),
                  // Only an explicit false turns the captions off; anything else reads as on (2026-11-16).
                  ...(entry.talkCaptions === false ? { talkCaptions: false as const } : {}),
                },
              ],
            ];
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
