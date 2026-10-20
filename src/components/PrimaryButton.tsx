import type { SymbolViewProps } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  iconLeft?: SymbolViewProps["name"];
  iconRight?: SymbolViewProps["name"];
  disabled?: boolean;
  loading?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  iconLeft,
  iconRight,
  disabled = false,
  loading = false,
}: PrimaryButtonProps) {
  const isInactive = disabled || loading;

  // The Pressable carries only the style function: NativeWind cannot merge a className with one.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View className="btn-primary gap-2">
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <>
            {iconLeft ? <Icon name={iconLeft} size={18} color="white" /> : null}
            <Text className="btn-primary__label">{label}</Text>
            {iconRight ? <Icon name={iconRight} size={18} color="white" /> : null}
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
