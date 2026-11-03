import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { copy } from "@/constants/copy";
import { images } from "@/constants/images";

type WordmarkProps = {
  // The spoken form of the lockup. The tab header passes "GraceHush, Journal" with the header role; the two cover
  // screens (Welcome, Sign In) pass nothing, so the wordmark reads as its own text.
  accessibilityLabel?: string;
  accessibilityRole?: "header";
};

// The brand lockup: the mark beside the two-tone "GraceHush" wordmark (Fraunces SemiBold 22, Grace in plum-deep and
// Hush in rosewood). The tab header, the Welcome step and Sign In all draw it, so the brand the person meets on the
// first screen is the one they see every day (2026-11-01). The mark's visible height (72% of the 40 box, 29 dp) spans
// the whole wordmark with a little over at the flame's tip, so the mark anchors the name instead of trailing it; the
// 6-dp gap plus the box's own padding leaves about 12 dp between the two.
export function Wordmark({ accessibilityLabel, accessibilityRole }: WordmarkProps) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Image source={images.logoMark} contentFit="contain" style={styles.emblem} />
      <Text
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        maxFontSizeMultiplier={1.3}
        className="font-fraunces-semibold text-[22px] leading-[26px] tracking-[-0.55px] text-plum-deep"
      >
        {copy.header.wordmark.grace}
        <Text className="text-rosewood">{copy.header.wordmark.hush}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emblem: { width: 40, height: 40 },
});
