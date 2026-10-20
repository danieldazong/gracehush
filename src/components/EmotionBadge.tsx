import { Text, View } from "react-native";

import { getEmotionColors } from "@/constants/theme";

type EmotionBadgeProps = {
  emotion: string;
};

// The emotion is the raw lowercase string from the AI. An unknown one still shows its own label, in
// the weary colors.
export function EmotionBadge({ emotion }: EmotionBadgeProps) {
  const { bg, fg } = getEmotionColors(emotion);
  const label = emotion.charAt(0).toUpperCase() + emotion.slice(1);

  return (
    <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: bg }}>
      <Text
        className="font-dm-semibold text-[11px] leading-[16px] tracking-[0.3px]"
        style={{ color: fg }}
      >
        {label}
      </Text>
    </View>
  );
}
