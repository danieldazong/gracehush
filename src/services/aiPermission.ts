import { getSupabaseUserId } from "@/services/supabaseClient";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";

// Whether the signed-in account has allowed its words and recordings to go to Google's AI (Apple's guideline 5.1.2(i)). The sync
// engine asks before it sends anything from the outbox, and nobody signed in means no.
export function hasAiPermission(): boolean {
  const userId = getSupabaseUserId();
  if (userId === null) return false;
  return useProfilePrefsStore.getState().byUser[userId]?.aiPermissionAt != null;
}
