import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

// Wide enough for two cards and the start of a third on a 390-wide phone, so the row reads as one to swipe.
export const STARTER_CARD_WIDTH = 156;

type StarterCardProps = {
  // One of the Scholar icons in images.ts: a plum line over a soft rose fill, drawn for the app.
  icon: number;
  title: string;
  onPress: () => void;
};

// One question to try on the Scholar tab: the topic's icon, bare on the white card (no tile, no arrow: the card is plainly
// the thing to tap), and the question under it as it will be sent. Cards in a row stretch to the tallest, so a wrapped
// title at large text keeps them level.
export function StarterCard({ icon, title, onPress }: StarterCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View className="min-h-[148px] flex-1 justify-between gap-4 rounded-card border border-petal bg-card p-4">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Image source={icon} contentFit="contain" style={styles.icon} />
        </View>
        <Text className="text-label-lg text-ink">{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: STARTER_CARD_WIDTH },
  icon: { width: 36, height: 36 },
  pressed: { opacity: 0.7 },
});
