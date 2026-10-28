import { createNavigationContainerRef } from "@react-navigation/native";

import type { RootStackParamList } from "./types";

// The app's one NavigationContainer, for code outside a screen: a tapped affirmation notification opens its reflection
// (step 28, services/notificationRouting.ts).
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
