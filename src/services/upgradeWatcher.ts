import { resumeAfterUpgrade } from "@/services/syncEngine";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { SubscriptionTier } from "@/types";

// Sends what the free limit held back as soon as this phone learns that the plan is paid (step 25). The plan reaches the phone
// in the profile sync (users_profile.subscription_tier, which only the server writes), so this covers a purchase made on this
// phone or on another one, and a change the server made itself. The sync engine alone would notice only at its next start,
// foreground or retry, which can be a day away. The purchase mock of step 16 calls resumeAfterUpgrade() on its own.
//
// The auth bridge starts it for the signed-in user and stops it at sign-out. It acts when the plan goes from free (or unknown)
// to trial or Pro, never when it stays paid or goes back to free.
function isPaid(tier: SubscriptionTier | null): boolean {
  return tier === "trial" || tier === "pro";
}

export function watchPlan(userId: string): () => void {
  const tierOf = () => useProfilePrefsStore.getState().byUser[userId]?.snapshot?.subscriptionTier ?? null;
  let last = tierOf();
  return useProfilePrefsStore.subscribe(() => {
    const next = tierOf();
    const turnedPaid = !isPaid(last) && isPaid(next);
    last = next;
    if (turnedPaid) void resumeAfterUpgrade();
  });
}
