import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { voiceAvatars } from "@/constants/images";
import type { ScholarVoiceKey } from "@/constants/scholarVoices";

// Where a voice's portrait is drawn: the Talk screen's voice line (20), the chat's voice button (32) and the voice rows (40).
const SIZES = {
  20: "size-5",
  32: "size-8",
  40: "size-10",
} as const;

// A voice's painted portrait (2026-11-19, the owner's request): a small circle beside the voice's name, with a petal ring, or a
// plum one for the voice that is chosen. Decorative: the row, the button or the line beside it says the name.
export function VoiceAvatar({
  voice,
  size,
  selected = false,
}: {
  voice: ScholarVoiceKey;
  size: keyof typeof SIZES;
  selected?: boolean;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`${SIZES[size]} overflow-hidden rounded-full bg-blush ${selected ? "border-2 border-plum" : "border border-petal"}`}
    >
      <Image source={voiceAvatars[voice]} contentFit="cover" style={StyleSheet.absoluteFill} />
    </View>
  );
}
