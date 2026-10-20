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
  Paywall: { source: "profile" | "limit" };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  RootStackScreenProps<keyof RootStackParamList>
>;
