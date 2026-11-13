import { Pressable, StyleSheet, Text, View } from "react-native";

type SuggestionChipsProps = {
  chips: readonly string[];
  onPick: (text: string) => void;
  // A turn is in flight: one at a time.
  disabled: boolean;
};

// Suggestions under the newest answer, or the starters of a new conversation (step 38). Each one sends its own words. Never in a
// heavy conversation (the screen does not draw them there).
export function SuggestionChips({ chips, onPick, disabled }: SuggestionChipsProps) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {chips.map((chip) => (
        <Pressable
          key={chip}
          accessibilityRole="button"
          accessibilityLabel={chip}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={4}
          onPress={() => onPick(chip)}
          style={({ pressed }) => [disabled && styles.disabled, pressed && styles.pressed]}
        >
          <View className="chip min-h-9 px-4">
            <Text className="text-label-md text-plum">{chip}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
