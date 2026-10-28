import { useAuth } from "@clerk/expo";
import { useEffect, useLayoutEffect } from "react";
import { AppState } from "react-native";

import { startAffirmationSchedule, stopAffirmationSchedule } from "@/services/affirmationScheduler";
import { startConnectivity, stopConnectivity } from "@/services/connectivity";
import { endOfflineSession, startOfflineSession } from "@/services/offlineSession";
import { syncProfile, syncProfileOnForeground, watchReminderEdits } from "@/services/profileSync";
import { setSupabaseSession } from "@/services/supabaseClient";
import { watchPlan } from "@/services/upgradeWatcher";

// Connects the signed-in Clerk user to Supabase and renders nothing. It sits above the navigator, inside
// ClerkProvider and after the splash gate, so the stores it uses have loaded.
export function SupabaseAuthBridge() {
  const { isSignedIn, userId, getToken } = useAuth();
  const signedInUserId = isSignedIn && userId ? userId : null;

  // A layout effect, so the session is set before any screen's own effect asks the repository for the profile.
  useLayoutEffect(() => {
    setSupabaseSession(
      signedInUserId === null ? null : { userId: signedInUserId, getToken: () => getToken() },
    );
    return () => setSupabaseSession(null);
  }, [signedInUserId, getToken]);

  // NetInfo's answers go to the offline store for as long as the app runs (step 24).
  useEffect(() => {
    startConnectivity();
    return stopConnectivity;
  }, []);

  // The signed-in user's own database and the sync engine that reads it (step 24). Opened before any screen reads it:
  // the Journal waits for it. A different user closes the previous one first.
  useEffect(() => {
    if (signedInUserId === null) return;
    void startOfflineSession(signedInUserId);
    return () => {
      void endOfflineSession();
    };
  }, [signedInUserId]);

  // The work that follows a sign-in, and again when the app returns to the foreground. A failure blocks nothing:
  // the next foreground tries again. Later steps add their lines here (30 sets up purchases, 33 starts realtime).
  useEffect(() => {
    if (signedInUserId === null) return;
    syncProfile();
    const stopWatchingReminders = watchReminderEdits();
    // A plan that turns paid sends what the free limit held back (step 25).
    const stopWatchingPlan = watchPlan(signedInUserId);
    // The daily affirmation notifications follow this account until the session ends (step 28).
    startAffirmationSchedule(signedInUserId);
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") syncProfileOnForeground();
    });
    return () => {
      subscription.remove();
      stopWatchingReminders();
      stopWatchingPlan();
      stopAffirmationSchedule();
    };
  }, [signedInUserId]);

  return null;
}
