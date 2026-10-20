import { Pressable, StyleSheet, Text, View } from "react-native";

import { haptics } from "@/services/haptics";

type SegmentedControlProps<T extends string> = {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  // "light": the selected item is a white pill on the linen track. "plum": a plum pill with a white label.
  variant?: "light" | "plum";
  // A small control that hugs its items and centers itself (New Entry). The default fills its row.
  compact?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
};

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  variant = "light",
  compact = false,
  disabled = false,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const plum = variant === "plum";

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className={compact ? "segmented self-center" : "segmented"}
      style={disabled && styles.disabled}
    >
      {items.map((item) => {
        const selected = item.value === value;
        // The utilities come after the component classes, so they override min-h-11 and flex-1.
        const itemClass = [
          "segmented__item",
          selected && (plum ? "segmented__item--active-plum" : "segmented__item--active"),
          compact && "min-h-0 flex-none px-5 py-1",
        ]
          .filter(Boolean)
          .join(" ");
        const labelClass = [
          "segmented__label",
          selected && (plum ? "segmented__label--active-plum" : "segmented__label--active"),
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            // The compact item is 26 tall, so 9 above and below makes a 44 touch area.
            hitSlop={compact ? { top: 9, bottom: 9 } : undefined}
            onPress={() => {
              if (!selected) haptics.selection();
              onChange(item.value);
            }}
            style={({ pressed }) => [!compact && styles.fill, pressed && styles.pressed]}
          >
            {/* collapsable={false}: an unselected item draws nothing, so Android flattens the view away, and the pill it gets when selected would lose its radius. */}
            <View collapsable={false} className={itemClass}>
              <Text className={labelClass}>{item.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
