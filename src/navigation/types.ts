import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { ReflectionTab } from "@/types";

export type MainTabParamList = {
  Journal: undefined;
  Scholar: undefined;
  Prayers: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  SignIn: undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  // `resend` is the client entry id of a refused written reflection: New Entry opens with its words (Journal's
  // "Edit and resend") and sends them again under the same id.
  NewEntry: { mode: "speak" | "write"; resend?: string };
  // `tab` opens the carousel on that tab: a tapped affirmation notification passes "affirmations" (step 28).
  Reflection: { entryId: string; tab?: ReflectionTab };
  NowPlaying: { entryId: string };
  // Scholar (step 38). An existing conversation by its id, or a new one: from a reflection (`entryId`, which first looks for
  // that reflection's conversation), from a starter (sent once the AI permission is given), or from the ask bar (`compose`:
  // the keyboard up, or Speak mode with nothing recorded until the mic is tapped).
  Conversation: {
    conversationId?: string;
    entryId?: string;
    starter?: "verse" | "anxious" | "pray";
    compose?: "type" | "speak";
  };
  // `entryId` is the reflection the free limit stopped. When it is a heavy moment the Paywall replaces itself
  // with Reflection: a heavy moment is never paywalled.
  // `source: "scholar"` (step 38) comes from a Scholar limit: `reason` says which, today's messages or hearing an answer.
  Paywall: { source: "profile" | "limit" | "scholar"; entryId?: string; reason?: "messages" | "listen" };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  RootStackScreenProps<keyof RootStackParamList>
>;
