import "./global.css";

import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { Fraunces_400Regular } from "@expo-google-fonts/fraunces/400Regular";
import { Fraunces_400Regular_Italic } from "@expo-google-fonts/fraunces/400Regular_Italic";
import { Fraunces_500Medium } from "@expo-google-fonts/fraunces/500Medium";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces/600SemiBold";
import { NavigationContainer } from "@react-navigation/native";
import { isRunningInExpoGo } from "expo";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SupabaseAuthBridge } from "@/components/SupabaseAuthBridge";
import { analyticsEnv, supabaseEnv } from "@/constants/env";
import { fonts } from "@/constants/theme";
import { useStoreHydrated } from "@/hooks/useStoreHydrated";
import { RootNavigator } from "@/navigation/RootNavigator";
import { navigationRef } from "@/navigation/navigationRef";
import { startAnalytics, trackCurrentScreen } from "@/services/analytics";
import { openPendingTap, startNotificationRouting } from "@/services/notificationRouting";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";

SplashScreen.preventAutoHideAsync();
// The launch screen fades into the first screen rather than cutting to it. Expo Go has no launch screen of ours, and warns.
if (!isRunningInExpoGo()) SplashScreen.setOptions({ fade: true, duration: 400 });

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

// The navigator, ready or changed: a tapped notification waiting for the signed-in screens opens (step 28), and the screen is
// counted when the person shares usage data (step 34).
function onNavigationChange() {
  openPendingTap();
  trackCurrentScreen();
}

function AppShell() {
  const { isLoaded } = useAuth();
  const hydrated = useStoreHydrated(useOnboardingStore);
  const prefsHydrated = useStoreHydrated(useProfilePrefsStore);
  const [loaded, error] = useFonts({
    [fonts.fraunces]: Fraunces_400Regular,
    [fonts.frauncesMedium]: Fraunces_500Medium,
    [fonts.frauncesSemibold]: Fraunces_600SemiBold,
    [fonts.frauncesItalic]: Fraunces_400Regular_Italic,
    [fonts.dm]: DMSans_400Regular,
    [fonts.dmMedium]: DMSans_500Medium,
    [fonts.dmSemibold]: DMSans_600SemiBold,
    [fonts.dmBold]: DMSans_700Bold,
  });

  // The gate below opens on a font error too, so a font that will not load never holds the app,
  // but every text then draws in the system font: say so in development.
  useEffect(() => {
    if (__DEV__ && error) console.warn(`[fonts] ${error.message}`);
  }, [error]);

  // From the very start, so the tap on a notification that opened the app is not lost: the reflection opens once the
  // signed-in screens are up (step 28).
  useEffect(() => startNotificationRouting(), []);

  // Analytics follow the saved answer once the onboarding store has loaded it (step 34). Nothing reaches PostHog before the
  // person says yes.
  useEffect(() => startAnalytics(), []);

  // The fonts, Clerk and the two saved stores load in parallel. Waiting for all of them means the
  // navigator first renders with everything known: a signed-in user never sees Onboarding flash by, a
  // finished onboarding never shows Welcome, and the profile sync never writes to a store that is
  // still loading (step 17).
  const ready = Boolean((loaded || error) && isLoaded && hydrated && prefsHydrated);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Nothing is rendered while waiting: the splash screen is still visible.
  if ((!loaded && !error) || !hydrated || !prefsHydrated) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <SupabaseAuthBridge />
      <NavigationContainer ref={navigationRef} onReady={onNavigationChange} onStateChange={onNavigationChange}>
        <RootNavigator />
      </NavigationContainer>
      {/* Light over the plum launch screen, dark over the app's linen from the moment the launch screen starts to fade. */}
      <StatusBar style={ready ? "dark" : "light"} animated />
    </SafeAreaProvider>
  );
}

export default function App() {
  if (!publishableKey) {
    throw new Error(
      "Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Add it to .env.local (see .env.example) and restart Expo with `npx expo start -c`.",
    );
  }

  // A wrong Supabase value always stops the app (a secret key in an EXPO_PUBLIC_ variable would ship inside it).
  // A missing one stops a release build only: in development the profile falls back to the mock, so the app runs
  // before the Supabase project exists (getProfileSource).
  if (supabaseEnv.status === "invalid" || (supabaseEnv.status === "missing" && !__DEV__)) {
    throw new Error(supabaseEnv.message);
  }
  // A personal PostHog key, a token that is not a project token or a wrong host stops the app in development; a release
  // build keeps analytics off instead (step 34).
  if (__DEV__ && analyticsEnv.status === "invalid") {
    throw new Error(analyticsEnv.message);
  }
  if (__DEV__ && supabaseEnv.status === "missing") {
    console.info(`[supabase] ${supabaseEnv.message} Until then the profile uses the mock.`);
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <AppShell />
    </ClerkProvider>
  );
}
