import { useEffect, useState } from "react";
import { Animated, View } from "react-native";

import { colors } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";

// The design's nine bars, rest heights and colors (its brown bar is `rosewood`).
const RESTING_HEIGHTS = [16, 28, 42, 52, 36, 46, 26, 34, 18];
const BAR_COLORS = [
  colors.rose,
  colors.plum,
  colors.plum,
  colors.plumDeep,
  colors.rosewood,
  colors.plum,
  colors.rose,
  colors.plum,
  colors.rose,
];
const MIN_ACTIVE_HEIGHT = 12;
const ACTIVE_RANGE = 40; // a level of 1 reaches 52
const LEVEL_MS = 100;
const REST_MS = 200;

type WaveformProps = {
  // One value from 0 to 1 per bar, the newest on the right. Ignored while `active` is false.
  levels: number[];
  active: boolean;
};

// Bars that follow the recording level, and rest at the design's heights otherwise. Decorative, so a
// screen reader skips it. With Reduce Motion on, the bars still show the level, without easing.
export function Waveform({ levels, active }: WaveformProps) {
  const reduceMotion = useReduceMotion();
  const [heights] = useState(() => RESTING_HEIGHTS.map((height) => new Animated.Value(height)));

  useEffect(() => {
    const animations = heights.map((height, index) => {
      const level = Math.min(1, Math.max(0, levels[index] ?? 0));
      const target = active ? MIN_ACTIVE_HEIGHT + level * ACTIVE_RANGE : RESTING_HEIGHTS[index];
      if (reduceMotion) {
        height.setValue(target);
        return null;
      }
      // The native driver cannot animate a height.
      const animation = Animated.timing(height, {
        toValue: target,
        duration: active ? LEVEL_MS : REST_MS,
        useNativeDriver: false,
      });
      animation.start();
      return animation;
    });
    return () => animations.forEach((animation) => animation?.stop());
  }, [levels, active, reduceMotion, heights]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="my-1 h-16 w-full flex-row items-center justify-center gap-1.5 px-4"
    >
      {heights.map((height, index) => (
        <Animated.View
          key={index}
          style={{ width: 6, height, borderRadius: 3, backgroundColor: BAR_COLORS[index] }}
        />
      ))}
    </View>
  );
}
