import { useAuth } from "@clerk/expo";
import { useCallback, useState } from "react";

import { syncNow } from "@/services/syncEngine";
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
