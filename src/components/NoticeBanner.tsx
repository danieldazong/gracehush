import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";

const icons = {
  saved: { android: "check_circle", ios: "checkmark.circle" },
  close: { android: "close", ios: "xmark" },
} satisfies Record<string, SymbolViewProps["name"]>;

type NoticeBannerProps = {
  message: string;
  onDismiss: () => void;
};

// A calm line that stays until the person dismisses it or pulls to refresh, never on a timer (step 24). A polite live
// region, so a screen reader says it when it appears. The same blush card as the offline banner.
export function NoticeBanner({ message, onDismiss }: NoticeBannerProps) {
  return (
    <View accessibilityLiveRegion="polite" className="card card--blush flex-row items-center gap-3">
      <View className="size-8 items-center justify-center rounded-full bg-petal">
        <Icon name={icons.saved} size={19} color={colors.plumDeep} />
      </View>
      <Text className="flex-1 text-body-sm text-ink/80">{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.common.dismiss}
        onPress={onDismiss}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {/* 44 square, pulled into the card's padding so a one-line note stays compact. */}
        <View className="-my-2 -mr-2 size-11 items-center justify-center">
          <Icon name={icons.close} size={18} color={colors.mauve} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
