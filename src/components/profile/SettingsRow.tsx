import type { SymbolViewProps } from "expo-symbols";
import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type AccessibilityState,
} from "react-native";

import { Icon } from "@/components/Icon";
import { colors } from "@/constants/theme";

// Literal class names, because NativeWind finds classes by scanning the source.
const titleClass = {
  default: "text-label-lg text-ink",
  destructive: "text-label-lg text-crisis",
  muted: "text-label-lg text-mauve",
} as const;

type SettingsRowProps = {
  icon: SymbolViewProps["name"];
  // "default" is a linen tile with a plum icon, "destructive" a crisis-red tile, and "bare" has no tile (the About rows).
  iconTone?: "default" | "destructive" | "bare";
  title: string;
  subtitle?: string;
  titleTone?: keyof typeof titleClass;
  // A picture only: a chevron, a warning glyph, the switch. It is hidden from touch and from screen readers, because
  // the row carries the label and the state.
  trailing?: ReactNode;
  // Without it the row is plain information, not a button.
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
};

function RowIcon({
  icon,
  tone,
  muted,
}: {
  icon: SymbolViewProps["name"];
  tone: "default" | "destructive" | "bare";
  muted: boolean;
}) {
  if (tone === "bare") {
    return <Icon name={icon} size={20} color={muted ? colors.mauve : colors.rosewood} />;
  }
  const destructive = tone === "destructive";

  return (
    <View
      className={
        destructive
          ? "size-9 items-center justify-center rounded-full bg-crisis/12"
          : "size-9 items-center justify-center rounded-full bg-linen-deep"
      }
    >
      <Icon name={icon} size={20} color={destructive ? colors.crisis : colors.plum} />
    </View>
  );
}

// One row of a SettingsGroup: at least 56 tall, the whole width is the touch target, and the title and the subtitle
// wrap instead of truncating (a truncated reminders summary would hide the evening time).
export function SettingsRow({
  icon,
  iconTone = "default",
  title,
  subtitle,
  titleTone = "default",
  trailing,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
}: SettingsRowProps) {
  const content = (
    <View className="min-h-14 flex-row items-center gap-4 px-4 py-3">
      <RowIcon icon={icon} tone={iconTone} muted={titleTone === "muted"} />
      <View className="flex-1">
        <Text className={titleClass[titleTone]}>{title}</Text>
        {subtitle ? <Text className="text-body-sm text-mauve">{subtitle}</Text> : null}
      </View>
      {trailing ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {trailing}
        </View>
      ) : null}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  // The Pressable carries only the style function: NativeWind cannot merge a className with one.
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.linen },
});
