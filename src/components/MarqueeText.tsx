import { useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { useReduceMotion } from "@/hooks/useReduceMotion";

// One line of text that never wraps (2026-11-01, the user's request for the Prayer card's title). A text that fits its
// column is a plain still line. A text wider than its column scrolls slowly to the left in a continuous loop: it rests
// for a moment, moves until a second copy, a gap behind it, stands where it stood, and jumps back to the start, which
// draws the same frame, so the loop has no seam. Under Reduce Motion nothing moves and the text wraps as a plain Text
// would, so every word stays readable; while the screen is not in front (`active` false) it stands still at its start.
// The whole text belongs in the accessibility label of whatever holds it: the copies here are not read on their own.
type MarqueeTextProps = {
  children: string;
  // The Text's classes: the font, the size and the colour. The layout is this component's.
  className?: string;
  // Whether it may move: the screen passes whether it is in front. Default true.
  active?: boolean;
};

// The pace: slow enough to read as it passes (about three characters a second in the card's 20-point Fraunces), a rest
// at the start of every cycle so the first words can be read standing still, and a gap between the end of the text and
// its next copy so the eye sees where the title ends and begins again.
export const MARQUEE_SPEED_DPS = 30;
export const MARQUEE_REST_MS = 1500;
export const MARQUEE_GAP = 48;
// A text this much wider than its window still counts as fitting (sub-pixel rounding between two layout reports).
const FIT_TOLERANCE = 0.5;

export function MarqueeText({ children, className, active = true }: MarqueeTextProps) {
  const reduceMotion = useReduceMotion();
  const [translateX] = useState(() => new Animated.Value(0));
  const [windowWidth, setWindowWidth] = useState<number | null>(null);
  const [textWidth, setTextWidth] = useState<number | null>(null);

  const overflows = windowWidth !== null && textWidth !== null && textWidth > windowWidth + FIT_TOLERANCE;

  useEffect(() => {
    if (!overflows || !active || reduceMotion || textWidth === null) {
      translateX.setValue(0);
      return;
    }
    // One cycle moves the text by its own width plus the gap, so the second copy ends exactly where the first began.
    const distance = textWidth + MARQUEE_GAP;
    const run = Animated.loop(
      Animated.sequence([
        Animated.delay(MARQUEE_REST_MS),
        Animated.timing(translateX, {
          toValue: -distance,
          duration: (distance / MARQUEE_SPEED_DPS) * 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    run.start();
    return () => {
      run.stop();
      translateX.setValue(0);
    };
  }, [overflows, active, reduceMotion, textWidth, translateX]);

  if (reduceMotion) {
    return <Text className={className}>{children}</Text>;
  }

  const onWindowLayout = (event: LayoutChangeEvent) => setWindowWidth(event.nativeEvent.layout.width);
  const onTextLayout = (event: LayoutChangeEvent) => setTextWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.window} onLayout={onWindowLayout}>
      <Animated.View style={[styles.row, { transform: [{ translateX }] }]}>
        <Text className={className} numberOfLines={1} onLayout={onTextLayout}>
          {children}
        </Text>
        {overflows ? (
          <Text
            className={className}
            numberOfLines={1}
            style={styles.copy}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {children}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

// The window and the row are the animation's geometry (Style Exception Rules). `overflow: "scroll"` does two things in
// React Native 0.88: Yoga measures a row child of a scroll node with no width, so the row sizes to the text instead of
// wrapping it at the column's edge (the same rule gives a horizontal ScrollView its content width), and both platforms
// clip anything but "visible", so the window cuts the row at the column's edge. A plain View, so no native scroll view
// sits in every card and no touch is taken from the card's own button.
const styles = StyleSheet.create({
  window: { flexDirection: "row", overflow: "scroll" },
  row: { flexDirection: "row" },
  copy: { marginLeft: MARQUEE_GAP },
});
