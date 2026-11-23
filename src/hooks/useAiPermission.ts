import { useAuth } from "@clerk/expo";
import { useCallback, useState } from "react";

import { syncNow } from "@/services/syncEngine";
import { DEFAULT_SCHOLAR_VOICE, type ScholarVoiceKey } from "@/constants/scholarVoices";
import { useEntitlementStore } from "@/store/entitlementStore";
import { AI_WORDING, useProfilePrefsStore } from "@/store/profilePrefsStore";

// The signed-in account's answer to the AI permission, for New Entry, Journal and Profile. Allowing it sends what was held at once;
// taking it back holds what has not been sent. A request already on its way finishes.
export function useAiPermission() {
  const { userId } = useAuth();
  const allowed = useProfilePrefsStore(
    (state) => userId != null && state.byUser[userId]?.aiPermissionAt != null,
  );
  const setAllowed = useCallback(
    (next: boolean) => {
      if (!userId) return;
      useProfilePrefsStore.getState().setAiPermission(userId, next ? new Date().toISOString() : null);
      if (next) void syncNow("permission");
    },
    [userId],
  );
  return { allowed, setAllowed };
}

// The ElevenLabs permission (step 39): this account's voice goes to ElevenLabs in a talk, and since 2026-11-19 an answer it chooses
// to hear with Listen is read there in the chosen voice. Kept on this phone only, like the AI permission; account deletion forgets
// it, and sign-out keeps it.
export function useVoicePermission() {
  const { userId } = useAuth();
  const allowed = useProfilePrefsStore((state) => userId != null && state.byUser[userId]?.voicePermissionAt != null);
  const setAllowed = useCallback(
    (next: boolean) => {
      if (!userId) return;
      useProfilePrefsStore.getState().setVoicePermission(userId, next ? new Date().toISOString() : null);
    },
    [userId],
  );
  return { allowed, setAllowed };
}

// The voice this account chose for Scholar (step 39): a live talk, and Listen while ElevenLabs is allowed. Or the default.
// Since 2026-11-20 an account RevenueCat calls free has Hannah (the default) alone: `voice` is the default whatever was chosen
// (the server reads in it too), `chosen` is what is kept for when the plan includes the others, and `locked` says the other
// voices open the plans. A trial and a Pro account keep all eight; until RevenueCat answers nothing is locked here.
export function useScholarVoice() {
  const { userId } = useAuth();
  const chosen = useProfilePrefsStore(
    (state): ScholarVoiceKey => (userId != null ? state.byUser[userId]?.scholarVoice : undefined) ?? DEFAULT_SCHOLAR_VOICE,
  );
  const locked = useEntitlementStore((state) => state.tier === "free");
  const voice = locked ? DEFAULT_SCHOLAR_VOICE : chosen;
  const setVoice = useCallback(
    (next: ScholarVoiceKey) => {
      if (userId) useProfilePrefsStore.getState().setScholarVoice(userId, next);
    },
    [userId],
  );
  return { voice, chosen, setVoice, locked };
}

// Whether the live talk shows its captions (2026-11-16): on unless this account turned them off on this phone.
export function useTalkCaptions() {
  const { userId } = useAuth();
  const on = useProfilePrefsStore((state) => (userId != null ? state.byUser[userId]?.talkCaptions !== false : true));
  const setOn = useCallback(
    (next: boolean) => {
      if (userId) useProfilePrefsStore.getState().setTalkCaptions(userId, next);
    },
    [userId],
  );
  return { on, setOn };
}

// The one-time note (step 38): an account that allowed under the first words, which named only the devotionals, is told once
// that Scholar uses the same AI. The answer is read when the screen opens, so the note stays for the visit, and `seen` records
// the current words, so it never shows again.
export function useAiWordingNote(): { show: boolean; seen: () => void } {
  const { userId } = useAuth();
  const [show] = useState(() => {
    if (!userId) return false;
    const entry = useProfilePrefsStore.getState().byUser[userId];
    return entry?.aiPermissionAt != null && (entry.aiWording ?? 1) < AI_WORDING;
  });
  const seen = useCallback(() => {
    if (userId) useProfilePrefsStore.getState().markAiWording(userId);
  }, [userId]);
  return { show, seen };
}
