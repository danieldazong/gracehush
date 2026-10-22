import { Pressable, StyleSheet, Text, View } from "react-native";

import { haptics } from "@/services/haptics";

// A touch area of 44 for a 32-tall chip.
const CHIP_SLOP = { top: 6, bottom: 6 };

type ChoiceChipProps = {
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  // The three speed chips share one width, so choosing one never moves the others.
  wide?: boolean;
  onPress: () => void;
};

// A speed or an ambient choice: Now Playing's chips, and Profile's ambient chips. Choosing the selected one
// does nothing, and gives no haptic.
export function ChoiceChip({
  label,
  accessibilityLabel,
  selected,
  wide = false,
  onPress,
}: ChoiceChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      hitSlop={CHIP_SLOP}
      onPress={() => {
        if (selected) return;
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <View
        className={[
          "items-center justify-center rounded-full border py-1.5",
          wide ? "px-4" : "px-3.5",
          selected ? "border-plum bg-plum" : "border-petal bg-card",
        ].join(" ")}
      >
        <Text className={selected ? "text-label-md text-white" : "text-label-md text-mauve"}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
