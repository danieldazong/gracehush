import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";

const bell = { android: "notifications", ios: "bell" } satisfies SymbolViewProps["name"];

type TrialReminderRowProps = {
  value: boolean;
  onChange: (value: boolean) => void;
  // True while a purchase or a restore runs.
  disabled?: boolean;
};

// "Remind me before my trial ends" (2026-11-18), under the plans. The whole row is the touch target, as the prayer request row's
// is (the native Switch alone is 31 tall on iOS), so the Switch is only a picture of the state, hidden from the touch system and
// from screen readers. The tick on a change belongs to the hook, once per change.
export function TrialReminderRow({ value, onChange, disabled = false }: TrialReminderRowProps) {
  const { reminder } = copy.paywall;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={reminder.title}
      accessibilityHint={reminder.detail}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View className="card flex-row items-center gap-3 p-3.5">
        <View className="size-9 items-center justify-center rounded-full bg-blush">
          <Icon name={bell} size={20} color={colors.plum} />
        </View>
        <View className="flex-1">
          <Text className="text-label-lg text-ink">{reminder.title}</Text>
          <Text className="mt-0.5 text-body-sm text-mauve">{reminder.detail}</Text>
        </View>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Switch
            value={value}
            trackColor={{ false: colors.petal, true: colors.plum }}
            thumbColor={colors.card}
            ios_backgroundColor={colors.petal}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
