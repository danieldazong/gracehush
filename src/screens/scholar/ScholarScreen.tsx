import { useIsFocused, useNavigation, useScrollToTop } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/Skeleton";
import { SettingsGroup } from "@/components/profile/SettingsGroup";
import { SettingsRow } from "@/components/profile/SettingsRow";
import { AskBar } from "@/components/scholar/AskBar";
import { copy } from "@/constants/copy";
import { colors, layout } from "@/constants/theme";
import { useScholarHome } from "@/hooks/useScholarHome";
import { useTabBarClearance } from "@/hooks/useTabScreenBottomPadding";
import type { MainTabScreenProps, RootStackParamList } from "@/navigation/types";
import { selectIsOnline, useOfflineStore } from "@/store/offlineStore";
import { formatEntryDate } from "@/utils/format";

type Starter = NonNullable<RootStackParamList["Conversation"]["starter"]>;

const icons = {
  verse: { android: "menu_book", ios: "book" },
  anxious: { android: "eco", ios: "leaf" },
  pray: { android: "volunteer_activism", ios: "hands.sparkles" },
  conversation: { android: "forum", ios: "bubble.left.and.bubble.right" },
  chevron: { android: "chevron_right", ios: "chevron.right" },
} satisfies Record<string, SymbolViewProps["name"]>;

const STARTERS: Starter[] = ["verse", "anxious", "pray"];

function Chevron() {
  return <Icon name={icons.chevron} size={16} color={colors.mauve} />;
}

// The Scholar tab (step 38): the title, three starters, the recent conversations and the ask bar pinned above the tab bar. The
// starters and the ask bar work whatever the list does, and a conversation opens on the Conversation screen.
export function ScholarScreen() {
  const navigation = useNavigation<MainTabScreenProps<"Scholar">["navigation"]>();
  const { state, refresh } = useScholarHome();
  const online = useOfflineStore(selectIsOnline);
  const barClearance = useTabBarClearance();
  // The ask bar is as wide as the cards and the tab bar: 20 from each edge, 16 on a narrow screen.
  const { width } = useWindowDimensions();
  const side = width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;
  const scrollRef = useRef<ScrollViewInstance>(null);
  useScrollToTop(scrollRef);

  // One conversation opens at a time: a second tap before the screen is covered does nothing (as the input dock).
  const isFocused = useIsFocused();
  const opening = useRef(false);
  useEffect(() => {
    if (isFocused) opening.current = false;
  }, [isFocused]);

  function open(params: RootStackParamList["Conversation"]) {
    if (opening.current) return;
    opening.current = true;
    navigation.navigate("Conversation", params);
  }

  const refreshing = state.phase !== "loading" && state.refreshing;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScreenHeader title={copy.tabs.scholar} />
      <ScrollView
        ref={scrollRef}
        scrollIndicatorInsets={{ bottom: barClearance + layout.askBarClearance }}
        contentContainerStyle={{ paddingBottom: barClearance + layout.askBarClearance }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.plum} colors={[colors.plum]} />
        }
      >
        <View className="screen__content gap-6 pt-6">
          <View>
            <Text accessibilityRole="header" className="text-headline text-plum-deep">
              {copy.scholar.title}
            </Text>
            <Text className="mt-1 text-body text-mauve">{copy.scholar.caption}</Text>
            {online === false ? (
              <Text accessibilityLiveRegion="polite" className="mt-3 text-body-sm text-ink">
                {copy.scholar.notices.offline}
              </Text>
            ) : null}
          </View>

          <SettingsGroup title={copy.scholar.groups.starters}>
            {STARTERS.map((starter) => (
              <SettingsRow
                key={starter}
                icon={icons[starter]}
                title={copy.scholar.starters[starter]}
                trailing={<Chevron />}
                onPress={() => open({ starter })}
                accessibilityLabel={copy.scholar.starters[starter]}
              />
            ))}
          </SettingsGroup>

          {state.phase === "loading" ? (
            <View accessibilityLabel={copy.scholar.groups.recent} accessibilityState={{ busy: true }} className="gap-3">
              <Skeleton height={16} width={160} radius={8} />
              <Skeleton height={56} radius={16} />
              <Skeleton height={56} radius={16} />
              <Skeleton height={56} radius={16} />
            </View>
          ) : state.phase === "error" ? (
            <View className="items-center gap-2 py-2">
              <Text className="text-center text-body text-mauve">{copy.scholar.errors.load}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.scholar.errors.retry}
                onPress={refresh}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <View className="min-h-11 justify-center px-4">
                  <Text className="text-label-lg text-plum">{copy.scholar.errors.retry}</Text>
                </View>
              </Pressable>
            </View>
          ) : state.conversations.length > 0 ? (
            <SettingsGroup title={copy.scholar.groups.recent}>
              {state.conversations.map((conversation) => {
                const title = conversation.title ?? copy.scholar.untitled;
                const day = formatEntryDate(conversation.lastMessageAt);
                return (
                  <SettingsRow
                    key={conversation.id}
                    icon={icons.conversation}
                    title={title}
                    subtitle={day}
                    trailing={<Chevron />}
                    onPress={() => open({ conversationId: conversation.id })}
                    accessibilityLabel={copy.scholar.a11y.conversation(title, day)}
                  />
                );
              })}
            </SettingsGroup>
          ) : null}
        </View>
      </ScrollView>
      <AskBar
        onAsk={() => open({ compose: "type" })}
        onSpeak={() => open({ compose: "speak" })}
        style={[styles.askBar, { left: side, right: side, bottom: barClearance + layout.dockOffset }]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  askBar: { position: "absolute" },
  pressed: { opacity: 0.6 },
});
