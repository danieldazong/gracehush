import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";
import { colors, radii, spacing } from "@/constants/theme";
import type { TimeSlot } from "@/types";

const { done } = copy.onboarding.rhythm;

// The picker needs a Date; only its time of day is used.
function toDate(value: string): Date {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes);
}

function toTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// Android: the native time dialog. Never render the community picker as a component: on Android it re-opens
// the dialog whenever its value changes. `value` and what `onChange` receives are "HH:mm", 24-hour.
export function openAndroidTimeDialog(value: string, onChange: (hhmm: string) => void) {
  DateTimePickerAndroid.open({
    value: toDate(value),
    mode: "time",
    is24Hour: false,
    onValueChange: (_event, date) => onChange(toTimeString(date)),
  });
}

type ReminderTimePickerProps = {
  // The slot being edited, or null while the sheet is closed.
  slot: TimeSlot | null;
  // The "HH:mm" of that slot.
  value: string;
  onChange: (hhmm: string) => void;
  onClose: () => void;
};

// iOS only: a bottom sheet with Expo UI's spinner (the community iOS picker never reports changes under the new
// architecture) and a Done button, shown while `slot` is set. It is a screen-level Modal, so it is never opened
// from inside another Modal. On Android it renders nothing: use openAndroidTimeDialog.
export function ReminderTimePicker({ slot, value, onChange, onClose }: ReminderTimePickerProps) {
  if (Platform.OS === "android") {
    return null;
  }

  return (
    <Modal visible={slot !== null} transparent animationType="fade" onRequestClose={onClose}>
      {/* A Modal is presented outside the app's root view on iOS, so a SafeAreaView in it needs a provider of its own. */}
      <SafeAreaProvider>
        <View className="flex-1 justify-end bg-ink/40">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={done}
            className="flex-1"
            onPress={onClose}
          />
          <SafeAreaView edges={["bottom"]} style={styles.sheet}>
            {slot ? (
              <DateTimePicker
                value={toDate(value)}
                mode="time"
                display="spinner"
                themeVariant="light"
                onValueChange={(_event, date) => onChange(toTimeString(date))}
              />
            ) : null}
            <PrimaryButton label={done} onPress={onClose} />
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.blush,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: spacing.screen,
    paddingTop: 16,
    paddingBottom: 8,
  },
});
