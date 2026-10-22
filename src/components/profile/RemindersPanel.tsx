import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import type { TimeSlot } from "@/types";
import { formatTime12 } from "@/utils/format";

const { rhythm } = copy.onboarding;

const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

const icons = {
  morning: { android: "wb_sunny", ios: "sun.max" },
  afternoon: { android: "partly_cloudy_day", ios: "cloud.sun" },
  evening: { android: "bedtime", ios: "moon" },
  time: { android: "schedule", ios: "clock" },
} satisfies Record<string, SymbolViewProps["name"]>;

type RemindersPanelProps = {
  reminders: Record<TimeSlot, string>;
  timezone: string;
  onChangeTime: (slot: TimeSlot) => void;
};

// What the Daily Reminders row opens in place: the three times, each a button that opens the time picker, and the
// time zone they follow. They are editable whether Daily Affirmations is on or off: they also decide which
// affirmation the Journal shows for the time of day. It is indented to line up with the row's title.
export function RemindersPanel({ reminders, timezone, onChangeTime }: RemindersPanelProps) {
  return (
    <View className="pb-3 pl-[68px] pr-4">
      {SLOTS.map((slot) => {
        const { name } = rhythm.slots[slot];
        const time = formatTime12(reminders[slot]);

        return (
          <Pressable
            key={slot}
            accessibilityRole="button"
            accessibilityLabel={rhythm.changeTime(name, time)}
            onPress={() => onChangeTime(slot)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            {/* A row that cannot fit on one line wraps: the chip drops under the name and stays on the right. */}
            <View className="min-h-14 flex-row flex-wrap items-center gap-x-3 gap-y-1 py-1">
              <View className="flex-row items-center gap-3">
                <Icon name={icons[slot]} size={18} color={colors.plum} />
                <Text className="text-body text-ink">{name}</Text>
              </View>
              <View className="chip ml-auto gap-1.5 border border-petal bg-linen py-1.5">
                <Text className="text-label-md text-ink">{time}</Text>
                <Icon name={icons.time} size={14} color={colors.plum} />
              </View>
            </View>
          </Pressable>
        );
      })}
      <Text className="mt-1 text-body-sm text-mauve">
        {copy.profile.reminders.timezone(timezone.replace(/_/g, " "))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
