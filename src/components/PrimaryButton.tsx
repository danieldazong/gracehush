import type { SymbolViewProps } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/constants/theme";

import { Icon } from "./Icon";

// Literal class names, because NativeWind finds classes by scanning the source. "critical" is the crisis-red
// call to action (the crisis view's only one) and "ghost" a quiet bordered button.
const tones = {
  default: { button: "btn-primary gap-2", label: "btn-primary__label", icon: "white" },
  critical: { button: "btn-critical gap-2", label: "btn-critical__label", icon: "white" },
  ghost: { button: "btn-ghost gap-2", label: "btn-ghost__label", icon: colors.ink },
} as const;

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  iconLeft?: SymbolViewProps["name"];
  iconRight?: SymbolViewProps["name"];
  disabled?: boolean;
  loading?: boolean;
  tone?: keyof typeof tones;
  // "large" is 56 tall instead of 48: the crisis view's one call to action.
  size?: "default" | "large";
  accessibilityHint?: string;
};

export function PrimaryButton({
  label,
  onPress,
  iconLeft,
  iconRight,
  disabled = false,
  loading = false,
  tone = "default",
  size = "default",
  accessibilityHint,
}: PrimaryButtonProps) {
  const isInactive = disabled || loading;
  const styleOfTone = tones[tone];

  // The Pressable carries only the style function: NativeWind cannot merge a className with one.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View className={size === "large" ? `${styleOfTone.button} min-h-14` : styleOfTone.button}>
        {loading ? (
          <ActivityIndicator color={styleOfTone.icon} />
        ) : (
          <>
            {iconLeft ? <Icon name={iconLeft} size={18} color={styleOfTone.icon} /> : null}
            {/* shrink and center: a long label wraps inside the pill instead of overflowing it. The break
                strategies keep a price such as "$59.99/year" from leaving its last word on a line of its own:
                Android balances the lines, iOS pushes a lone last word down. Neither changes a one-line label. */}
            <Text
              className={`${styleOfTone.label} shrink text-center`}
              textBreakStrategy="balanced"
              lineBreakStrategyIOS="push-out"
            >
              {label}
            </Text>
            {iconRight ? <Icon name={iconRight} size={18} color={styleOfTone.icon} /> : null}
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
});
