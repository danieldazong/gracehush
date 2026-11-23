import { useFocusEffect, useIsFocused, useNavigation, useScrollToTop } from "@react-navigation/native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { SymbolViewProps } from "expo-symbols";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { ScholarHero } from "@/components/scholar/ScholarHero";
import { STARTER_CARD_WIDTH, StarterCard } from "@/components/scholar/StarterCard";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, gradients, layout } from "@/constants/theme";
import { useScholarHome } from "@/hooks/useScholarHome";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useTabBarClearance } from "@/hooks/useTabScreenBottomPadding";
import type { MainTabScreenProps, RootStackParamList } from "@/navigation/types";
import { voiceSupported } from "@/services/voiceSupport";
import { selectIsOnline, useOfflineStore } from "@/store/offlineStore";
import { formatEntryTimestamp } from "@/utils/format";

type Starter = NonNullable<RootStackParamList["Conversation"]["starter"]>;

const icons = {
  conversation: { android: "forum", ios: "bubble.left.and.bubble.right" },
  chevron: { android: "chevron_right", ios: "chevron.right" },
  offline: { android: "cloud_off", ios: "icloud.slash" },
} satisfies Record<string, SymbolViewProps["name"]>;

// The starters' own drawn icons (images.ts), not stock symbols: an open book, a worried person and a sunrise.
const starterIcons: Record<Starter, number> = {
  verse: images.iconOpenBook,
  anxious: images.iconAnxious,
  pray: images.iconSunrise,
};

const STARTERS: Starter[] = ["verse", "anxious", "pray"];
const STARTER_GAP = 12;

function Chevron() {
  return <Icon name={icons.chevron} size={16} color={colors.mauve} />;
}

// A section heading in the Journal's own style (Fraunces Medium 20), so the two tabs read as one app.
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" className="text-section tracking-[-0.5px] text-ink">
      {children}
    </Text>
  );
}

// The Scholar tab (step 38; the hero, the swipeable starters and the clean list 2026-11-16): a plum hero card, the three
// starters as cards, the recent conversations and the ask bar pinned above the tab bar. The starters, the hero's button and
// the ask bar work whatever the list does, and a conversation opens on the Conversation screen. The ask bar is the one way to
// type a question; the hero's button is the live talk (a free account goes to the Paywall, as the Talk button does).
export function ScholarScreen() {
  const navigation = useNavigation<MainTabScreenProps<"Scholar">["navigation"]>();
  const online = useOfflineStore(selectIsOnline);
  const { tier, known } = useEntitlement();
  const notPro = known && tier !== "pro";
  const { state, refresh, free: freeConversation } = useScholarHome(notPro);
  // Scholar is part of Pro (2026-11-18), with one free conversation for every account (2026-11-20): while it is not claimed yet,
  // the hero's button opens it with no "Pro" mark; once it is, a free account and a trial see "Pro" on the button. Only a plan
  // RevenueCat has reported counts, and only a free conversation that has been read as claimed; until both have answered, the
  // button goes to the talk's own order, which the server enforces either way.
  const unclaimed = notPro && freeConversation === null;
  const free = known && tier === "free" && freeConversation != null;
  const showPro = notPro && !unclaimed;
  const barClearance = useTabBarClearance();
  // The ask bar is as wide as the cards and the tab bar: 20 from each edge, 16 on a narrow screen.
  const { width } = useWindowDimensions();
  const side = width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;
  const scrollRef = useRef<ScrollViewInstance>(null);
  useScrollToTop(scrollRef);

  // "Today, 5:36 PM" needs today: kept in state and read again whenever the tab comes to the front.
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
    }, []),
  );

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

  function openHistory() {
    if (opening.current) return;
    opening.current = true;
    navigation.navigate("ScholarHistory");
  }

  // The hero's button: a free account that has had its free conversation sees the plans at once (no empty conversation to leave
  // behind), and anyone else opens a new conversation that starts the talk's own order (the voice permission, the microphone, the
  // Talk screen; a trial is told there the day its plan begins once its free conversation is had).
  function talk() {
    if (!free) {
      open({ compose: "talk" });
      return;
    }
    if (opening.current) return;
    opening.current = true;
    navigation.navigate("Paywall", { source: "scholar", reason: "talk" });
  }

  const refreshing = state.phase !== "loading" && state.refreshing;
  // The list dissolves into the linen from here down, so the ask bar and the tab bar never sit over a row of words.
  const fadeHeight = barClearance + layout.dockOffset + layout.askBarHeight + 28;

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
        <View className="screen__content gap-3 pt-5">
          <ScholarHero onTalk={voiceSupported() ? talk : null} showPro={showPro} />
          {/* The badge sits in a box as tall as one line of the text (19), so it is centred on the first line, also when the
              line wraps at large text. */}
          <View className="flex-row items-start gap-2 px-1">
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              className="h-[19px] justify-center"
            >
              <Image source={images.iconCheckBadge} contentFit="contain" style={styles.proofBadge} />
            </View>
            <Text className="flex-1 text-body-sm text-mauve">{copy.scholar.hero.proof}</Text>
          </View>
          {online === false ? (
            <View
              accessibilityLiveRegion="polite"
              className="flex-row items-center gap-2 rounded-card border border-petal bg-blush px-3 py-2.5"
            >
              <Icon name={icons.offline} size={18} color={colors.rosewood} />
              <Text className="flex-1 text-body-sm text-ink">{copy.scholar.notices.offline}</Text>
            </View>
          ) : null}
        </View>

        <View className="mt-8 gap-3">
          <View className="screen__content">
            <SectionTitle>{copy.scholar.groups.starters}</SectionTitle>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={STARTER_CARD_WIDTH + STARTER_GAP}
            snapToAlignment="start"
            contentContainerStyle={{ paddingHorizontal: side, gap: STARTER_GAP }}
          >
            {STARTERS.map((starter) => (
              <StarterCard
                key={starter}
                icon={starterIcons[starter]}
                title={copy.scholar.starters[starter]}
                onPress={() => open({ starter })}
              />
            ))}
          </ScrollView>
        </View>

        <View className="screen__content mt-8 gap-3">
          {state.phase === "loading" ? (
            <View accessibilityLabel={copy.scholar.groups.recent} accessibilityState={{ busy: true }} className="gap-3">
              <Skeleton height={20} width={200} radius={8} />
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
            <>
              {/* The latest few; "See all" opens the Conversations screen, and only when there are more than these. */}
              <View className="flex-row items-center justify-between">
                <View className="shrink">
                  <SectionTitle>{copy.scholar.groups.recent}</SectionTitle>
                </View>
                {state.hasMore ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copy.scholar.history.a11y.seeAll}
                    onPress={openHistory}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <View className="min-h-11 justify-center pl-4">
                      <Text className="text-label-lg text-plum">{copy.scholar.history.seeAll}</Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
              <SettingsGroup>
                {state.conversations.map((conversation) => {
                  const title = conversation.title ?? copy.scholar.untitled;
                  const day = formatEntryTimestamp(conversation.lastMessageAt, now);
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
            </>
          ) : null}
          <Text className="px-4 pt-1 text-center text-body-sm text-mauve">{copy.scholar.aiLine}</Text>
        </View>
      </ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={gradients.askFade.colors}
        locations={gradients.askFade.locations}
        style={[styles.fade, { height: fadeHeight }]}
      />
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
  fade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  proofBadge: { width: 16, height: 16 },
  pressed: { opacity: 0.6 },
});
