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
  // A text link under the message (Journal's saved notes: Support resources, step 25 follow-up).
  link?: { label: string; onPress: () => void };
};

// A calm line that stays until the person dismisses it or pulls to refresh, never on a timer (step 24). A polite live
// region, so a screen reader says it when it appears. The same blush card as the offline banner, which also puts its
// icon at the top when the text takes more than one line.
export function NoticeBanner({ message, onDismiss, link }: NoticeBannerProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      className={
        link ? "card card--blush flex-row items-start gap-3" : "card card--blush flex-row items-center gap-3"
      }
    >
      <View
        className={
          link
            ? "mt-0.5 size-8 items-center justify-center rounded-full bg-petal"
            : "size-8 items-center justify-center rounded-full bg-petal"
        }
      >
        <Icon name={icons.saved} size={19} color={colors.plumDeep} />
      </View>
      <View className="flex-1 items-start">
        <Text className="text-body-sm text-ink/80">{message}</Text>
        {link ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={link.label}
            onPress={link.onPress}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 justify-center">
              {/* plum, not rosewood: a text link on a blush surface is plum (AGENTS.md, colors) */}
              <Text className="btn-text__label text-plum">{link.label}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
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
