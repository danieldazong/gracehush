import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type MainTabParamList = {
  Journal: undefined;
  Prayers: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  SignIn: undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  NewEntry: { mode: "speak" | "write" };
  Reflection: { entryId: string };
  NowPlaying: { entryId: string };
  // Nothing reads `source` in V1 (no analytics: a crisis view sends no events). It stays because step 15's
  // Profile row passes "profile".
  CrisisResources: { source: "reflection" | "profile" };
  // `entryId` is the reflection the free limit stopped. When it is a crisis entry the Paywall replaces itself
  // with Reflection: crisis support is never paywalled.
  Paywall: { source: "profile" | "limit"; entryId?: string };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  RootStackScreenProps<keyof RootStackParamList>
>;
