import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { haptics } from "@/services/haptics";

type SegmentedControlProps<T extends string> = {
  items: readonly {
    value: T;
    label: string;
    // A small badge after the label (the Prayers tabs show how many prayers each one holds).
    count?: number;
    // What a screen reader says instead of the label, for example "Active, 5 prayers".
    accessibilityLabel?: string;
  }[];
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
  const { width, fontScale } = useWindowDimensions();
  // The window width and font scale at which a label did not fit on one line. The control is stacked (one
  // item under another) only at that size, so a different size is measured again from a row. A label that
  // breaks inside a word counts as not fitting. A compact control never stacks.
  const sizeKey = `${width}x${fontScale}`;
  const [overflowedAt, setOverflowedAt] = useState<string | null>(null);
  const stacked = !compact && overflowedAt === sizeKey;

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className={
        compact ? "segmented self-center" : stacked ? "segmented flex-col rounded-hero" : "segmented"
      }
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
        // The badge is a pill on the selected item and plain text on the others.
        const badgeClass = [
          "shrink-0 rounded-full px-2 py-0.5",
          selected && (plum ? "bg-white/20" : "bg-linen-deep"),
        ]
          .filter(Boolean)
          .join(" ");
        const badgeLabelClass = [
          "font-dm-semibold text-[11px] leading-[16px]",
          selected ? (plum ? "text-white" : "text-ink") : "text-mauve",
        ].join(" ");

        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            // The compact item is 26 tall, so 9 above and below makes a 44 touch area.
            hitSlop={compact ? { top: 9, bottom: 9 } : undefined}
            onPress={() => {
              if (!selected) haptics.selection();
              onChange(item.value);
            }}
            // A stacked item takes the full width of the column. A numeric flex basis of 0 would collapse it
            // in a column of automatic height, so it gets no flex at all.
            style={({ pressed }) => [!compact && !stacked && styles.fill, pressed && styles.pressed]}
          >
            {/* collapsable={false}: an unselected item draws nothing, so Android flattens the view away, and the pill it gets when selected would lose its radius. The badge needs it for the same reason. */}
            <View collapsable={false} className={itemClass}>
              <View className="flex-row items-center justify-center gap-1">
                <Text
                  className={`shrink ${labelClass}`}
                  onTextLayout={(event) => {
                    if (!stacked && !compact && event.nativeEvent.lines.length > 1) {
                      setOverflowedAt(sizeKey);
                    }
                  }}
                >
                  {item.label}
                </Text>
                {item.count === undefined ? null : (
                  <View collapsable={false} className={badgeClass}>
                    <Text className={badgeLabelClass}>{item.count}</Text>
                  </View>
                )}
              </View>
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
