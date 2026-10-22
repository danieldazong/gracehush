import { useAuth } from "@clerk/expo";
import { useEffect, useLayoutEffect } from "react";
import { AppState } from "react-native";

import { startReminderSync, syncProfile, syncProfileOnForeground } from "@/services/profileSync";
import { setSupabaseSession } from "@/services/supabaseClient";

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

  // The work that follows a sign-in, and again when the app returns to the foreground. A failure blocks nothing:
  // the next foreground tries again. Later steps add their lines here (24 opens the user's database, 30 sets up
  // purchases, 33 starts realtime).
  useEffect(() => {
    if (signedInUserId === null) return;
    syncProfile();
    const stopReminderSync = startReminderSync();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") syncProfileOnForeground();
    });
    return () => {
      subscription.remove();
      stopReminderSync();
    };
  }, [signedInUserId]);

  return null;
}
