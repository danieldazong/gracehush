import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { CrisisContactList } from "@/components/crisis/CrisisContactList";
import { CrisisFallbackSheet } from "@/components/crisis/CrisisFallbackSheet";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TranscriptRow } from "@/components/TranscriptRow";
import { copy } from "@/constants/copy";
import { CRISIS_RESOURCES, PRIMARY_CRISIS_RESOURCE } from "@/constants/crisisResources";
import { colors, layout } from "@/constants/theme";
import { useCrisisActions } from "@/hooks/useCrisisActions";

const { crisis } = copy;

// The four rows the design shows. Support Resources shows all of them.
const REFLECTION_RESOURCES = CRISIS_RESOURCES.filter((resource) => resource.onReflection);

// How long the headline waits to take screen-reader focus: the push transition is still running when the panel
// mounts, and iOS moves the focus itself when it ends.
const FOCUS_DELAY_MS = 500;

const icons = {
  heart: { android: "favorite", ios: "heart.fill" },
  phone: { android: "call", ios: "phone.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

type CrisisSupportPanelProps = {
  transcript: string | null;
  onOpenResources: () => void;
  onReturn: () => void;
};

// What Reflection shows for a crisis entry instead of the devotional. It takes the transcript and nothing
// else, so it cannot draw a player, a verse, tabs, an emotion badge, a prayer toggle or a share button even if
// the entry holds them. No animation, haptic or sound, and nothing here is logged.
export function CrisisSupportPanel({ transcript, onOpenResources, onReturn }: CrisisSupportPanelProps) {
  const { width } = useWindowDimensions();
  const { fallback, fallbackVisible, run, closeFallback } = useCrisisActions();
  const titleRef = useRef<Text>(null);
  const words = transcript?.trim() ?? "";

  useEffect(() => {
    const timer = setTimeout(() => {
      if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal:
              width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding,
          },
        ]}
      >
        <View className="card card--blush p-5">
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="mb-3 size-11 items-center justify-center rounded-full bg-card"
          >
            <Icon name={icons.heart} size={22} color={colors.crisis} />
          </View>
          <Text
            ref={titleRef}
            accessibilityRole="header"
            className="font-fraunces text-[22px] leading-[30px] text-ink"
          >
            {crisis.title}
          </Text>
          <Text className="mt-2 text-body text-mauve">{crisis.body}</Text>
        </View>
        <PrimaryButton
          tone="critical"
          size="large"
          iconLeft={icons.phone}
          label={crisis.talkNow}
          accessibilityHint={crisis.talkNowHint}
          onPress={() => run(PRIMARY_CRISIS_RESOURCE)}
        />
        <View className="gap-2">
          <Text className="eyebrow px-1">{crisis.listLabel}</Text>
          <CrisisContactList resources={REFLECTION_RESOURCES} onPress={run} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={crisis.moreWays}
            onPress={onOpenResources}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 items-center justify-center">
              <Text className="text-label-lg text-plum">{crisis.moreWays}</Text>
            </View>
          </Pressable>
        </View>
        <View className="card card--blush gap-1.5">
          <Text className="eyebrow">{crisis.note.eyebrow}</Text>
          <Text className="text-body text-ink">{crisis.note.body}</Text>
        </View>
        {words ? <TranscriptRow title={crisis.words} transcript={words} /> : null}
        <PrimaryButton
          tone="ghost"
          label={copy.reflection.footer.returnToJournal}
          onPress={onReturn}
        />
      </ScrollView>
      <CrisisFallbackSheet fallback={fallback} visible={fallbackVisible} onClose={closeFallback} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 16, paddingBottom: 32 },
  pressed: { opacity: 0.7 },
});
