import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import type { Affirmation } from "@/types";

// Android's symbols are outline only, so its saved heart is a different glyph (a heart with a check).
const icons = {
  heart: { android: "favorite", ios: "heart" },
  heartSaved: { android: "heart_check", ios: "heart.fill" },
  clock: { android: "schedule", ios: "clock" },
} satisfies Record<string, SymbolViewProps["name"]>;

type AffirmationCardProps = {
  affirmation: Affirmation;
  // "8:00 AM • Tied to yesterday's prayer", built by the screen.
  footer: string;
  // The heart was pressed. Journal Home's hook saves it (step 25): it shows the new state at once and puts the old one back
  // when the save fails, so the heart here is whatever `affirmation.isFavorite` says.
  onToggleFavorite: () => void;
  // The last save failed and was put back: a calm line says so until the next press.
  saveFailed: boolean;
};

export function AffirmationCard({ affirmation, footer, onToggleFavorite, saveFailed }: AffirmationCardProps) {
  const favorite = affirmation.isFavorite;
  const slotName = copy.onboarding.rhythm.slots[affirmation.slot].name;

  return (
    <View className="card gap-2.5 p-5" style={shadows.card}>
      <View className="flex-row items-center justify-between gap-2">
        <Text className="eyebrow flex-1">{copy.journal.affirmation.eyebrow(slotName)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            favorite ? copy.journal.affirmation.unsave : copy.journal.affirmation.save
          }
          // The icon is 18, so 13 on every side makes a 44 touch area.
          hitSlop={13}
          onPress={onToggleFavorite}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Icon
            name={favorite ? icons.heartSaved : icons.heart}
            size={18}
            color={favorite ? colors.plumDeep : colors.mauve}
          />
        </Pressable>
      </View>
      <Text className="text-section tracking-[-0.5px] text-ink">{affirmation.headline}</Text>
      <Text className="text-body text-ink/80">{affirmation.text}</Text>
      <View className="flex-row items-center gap-1.5 pt-1">
        <Icon name={icons.clock} size={14} color={colors.mauve} />
        <Text className="flex-1 text-body-sm text-mauve">{footer}</Text>
      </View>
      {saveFailed ? (
        <Text accessibilityLiveRegion="polite" className="text-body-sm text-rosewood">
          {copy.journal.affirmation.saveError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
