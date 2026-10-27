import { useAuth } from "@clerk/expo";
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { useEffect, type ReactElement } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";
import { SignInScreen } from "@/screens/auth/SignInScreen";
import { CrisisResourcesScreen } from "@/screens/journal/CrisisResourcesScreen";
import { NewEntryScreen } from "@/screens/journal/NewEntryScreen";
import { NowPlayingScreen } from "@/screens/journal/NowPlayingScreen";
import { ReflectionScreen } from "@/screens/journal/ReflectionScreen";
import { OnboardingScreen } from "@/screens/onboarding/OnboardingScreen";
import { PaywallScreen } from "@/screens/paywall/PaywallScreen";
import { useOnboardingStore } from "@/store/onboardingStore";

import { MainTabs } from "./MainTabs";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const screenOptions: NativeStackNavigationOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.linen },
};

// Now Playing is a full-screen page on iOS, not a sheet: a sheet's swipe-down gesture takes a sideways drag of the
// scrubber from the finger as soon as it drifts downward (seen on the iPhone in the step 26 walk-through), and nothing in
// the app can stop that gesture. Close closes it. Android has no such gesture, so it stays a modal there.
const nowPlayingOptions: NativeStackNavigationOptions = {
  presentation: Platform.OS === "ios" ? "fullScreenModal" : "modal",
  animation: "slide_from_bottom",
};

// A screen shown as a modal is presented outside the app's root view on iOS, so a SafeAreaView in it cannot find the root
// SafeAreaProvider: it reads its own insets once, often before the modal is in place, and the Close row then sat under the
// status bar (seen on the iPhone, 2026-10-27). A provider of its own follows the modal's real insets.
const modalLayout = ({ children }: { children: ReactElement }) => <SafeAreaProvider>{children}</SafeAreaProvider>;

export function RootNavigator() {
  const { isLoaded, isSignedIn } = useAuth();
  const hasCompletedOnboarding = useOnboardingStore((state) => state.hasCompletedOnboarding);
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);

  // A signed-in user has already been through the first screens (on another device, or before this
  // flag existed). Marking it done keeps Welcome from showing after they sign out.
  useEffect(() => {
    if (isLoaded && isSignedIn && !hasCompletedOnboarding) {
      completeOnboarding();
    }
  }, [isLoaded, isSignedIn, hasCompletedOnboarding, completeOnboarding]);

  // The splash screen is still visible until Clerk has loaded.
  if (!isLoaded) {
    return null;
  }

  // React Navigation's auth flow: the first screen of the active branch is the initial one, and the
  // navigator switches branches by itself when the session becomes active or ends. Completing
  // onboarding removes Onboarding from the branch, so nothing navigates to SignIn afterwards.
  // Resetting it adds Onboarding back, but a screen that was only added never becomes the focused
  // one, so SignIn carries a key that changes with the flag: the change drops SignIn's route and the
  // navigator falls back to the first screen, Onboarding.
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {isSignedIn ? (
        // MainTabs comes first, so it is the initial route. The five screens above it hide the tab
        // bar and the dock by covering them.
        <>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen
            name="NewEntry"
            component={NewEntryScreen}
            options={{ presentation: "fullScreenModal" }}
            layout={modalLayout}
          />
          <Stack.Screen name="Reflection" component={ReflectionScreen} />
          <Stack.Screen
            name="NowPlaying"
            component={NowPlayingScreen}
            options={nowPlayingOptions}
            layout={modalLayout}
          />
          <Stack.Screen
            name="CrisisResources"
            component={CrisisResourcesScreen}
            options={{ presentation: "modal", animation: "slide_from_bottom" }}
            layout={modalLayout}
          />
          <Stack.Screen
            name="Paywall"
            component={PaywallScreen}
            options={{ presentation: "modal", animation: "slide_from_bottom" }}
            layout={modalLayout}
          />
        </>
      ) : (
        <>
          {!hasCompletedOnboarding && <Stack.Screen name="Onboarding" component={OnboardingScreen} />}
          <Stack.Screen
            name="SignIn"
            component={SignInScreen}
            navigationKey={hasCompletedOnboarding ? "onboarded" : "onboarding"}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
