import { useAuth } from "@clerk/expo";
import { useCallback } from "react";

import { syncNow } from "@/services/syncEngine";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";

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
