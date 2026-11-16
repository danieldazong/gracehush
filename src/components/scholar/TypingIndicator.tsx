import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { FadeIn } from "@/components/FadeIn";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";

// Three dots in a pill beside Scholar's mark, where the answer will land (2026-11-15; it was a spinner and "Scholar is writing…").
// Each dot rises 3 dp and goes from 0.35 to full opacity and back over 600 ms, 150 ms after the one before it, then all three
// rest for 300 ms and the wave comes round again. Under Reduce Motion the dots sit still at 0.6. The whole indicator is one
// element that says Scholar is writing; the screen announces it too (useAnnounce, and a live region on Android).
const DOT_COUNT = 3;
const DOT_STAGGER_MS = 150;
const PULSE_MS = 600;
const REST_MS = 300;
const CYCLE_MS = (DOT_COUNT - 1) * DOT_STAGGER_MS + PULSE_MS + REST_MS;
const DOT_LIFT = 3;
const DOT_REST_OPACITY = 0.35;
const STILL_OPACITY = 0.6;

// One dot's turn in the cycle: wait for its place in the wave, go up and come down, then wait out the rest of the cycle, so that
// every dot's sequence is exactly CYCLE_MS long and the loop restarts them together.
function wave(value: Animated.Value, index: number) {
  const timing = (toValue: number) =>
    Animated.timing(value, { toValue, duration: PULSE_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true });
  return Animated.sequence([
    Animated.delay(index * DOT_STAGGER_MS),
    timing(1),
    timing(0),
    Animated.delay(CYCLE_MS - PULSE_MS - index * DOT_STAGGER_MS),
  ]);
}

export function TypingIndicator() {
  const reduceMotion = useReduceMotion();
  const [dots] = useState(() => Array.from({ length: DOT_COUNT }, () => new Animated.Value(0)));

  useEffect(() => {
    dots.forEach((dot) => dot.setValue(0));
    if (reduceMotion) return undefined;
    const loop = Animated.loop(Animated.parallel(dots.map(wave)));
    loop.start();
    return () => loop.stop();
  }, [dots, reduceMotion]);

  return (
    <FadeIn rise={6} duration={200}>
      <View
        accessible
        accessibilityLabel={copy.scholar.a11y.writing}
        accessibilityState={{ busy: true }}
        className="flex-row items-center gap-2"
      >
        <View className="size-8 items-center justify-center rounded-full border border-petal bg-blush">
          <Image source={images.logoMark} contentFit="contain" style={styles.mark} />
        </View>
        <View className="h-9 w-14 flex-row items-center justify-center gap-1.5 rounded-full border border-rose/50 bg-rose/25">
          {dots.map((dot, index) => (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                reduceMotion
                  ? { opacity: STILL_OPACITY }
                  : {
                    opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [DOT_REST_OPACITY, 1] }),
                    transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -DOT_LIFT] }) }],
                  },
              ]}
            />
          ))}
        </View>
      </View>
    </FadeIn>
  );
}

// expo-image and Animated.View take a style, not a className (Style Exception Rules).
const styles = StyleSheet.create({
  mark: { width: 18, height: 18 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.plum },
});
