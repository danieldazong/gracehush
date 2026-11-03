import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";

const { consent } = copy.journal;
const icons = { chart: { android: "bar_chart", ios: "chart.bar" } } as const;
// The two actions are 36 dp tall and reach the 44-dp target through hitSlop, like the Welcome's sample link.
const ACTION_HIT_SLOP = { top: 4, bottom: 4 } as const;

type AnalyticsConsentCardProps = {
  onShare: () => void;
  onNotNow: () => void;
};

// The analytics question, asked once on the Journal's first visit after sign-in (2026-11-01, round 8; from step 34 until
// then it was onboarding's fourth step, before the person had received anything). Compact since the same evening (the
// user's call: the first card, with a 48 icon circle, a four-line body and a 48 button, took most of the screen above the
// empty state): three rows, an 18 icon beside the one-line ask, a two-line body, and the actions right-aligned with a small
// filled primary, the shape an in-feed consent prompt takes in the large consumer apps. Unanswered means no, as before,
// and Profile's switch can change the answer later.
export function AnalyticsConsentCard({ onShare, onNotNow }: AnalyticsConsentCardProps) {
  return (
    <View className="card gap-3" style={shadows.card}>
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Icon name={icons.chart} size={18} color={colors.plum} />
          <Text className="shrink text-label-lg text-ink">{consent.title}</Text>
        </View>
        <Text className="text-body-sm text-mauve">{consent.body}</Text>
      </View>
      <View className="flex-row items-center justify-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={consent.notNow}
          hitSlop={ACTION_HIT_SLOP}
          onPress={onNotNow}
          style={({ pressed }) => pressed && styles.pressedText}
        >
          <View className="min-h-9 justify-center px-3">
            <Text className="text-label-lg text-mauve">{consent.notNow}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={consent.share}
          hitSlop={ACTION_HIT_SLOP}
          onPress={onShare}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="min-h-9 items-center justify-center rounded-full bg-plum px-4">
            <Text className="text-label-lg text-white">{consent.share}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  pressedText: { opacity: 0.6 },
});
