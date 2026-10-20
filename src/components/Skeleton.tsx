import { useEffect, useState } from "react";
import { Animated, type DimensionValue } from "react-native";

import { colors, radii } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";

const PULSE_MS = 600;

type SkeletonProps = {
  height: number;
  width?: DimensionValue;
  radius?: number;
};

// A loading placeholder that pulses between full and half opacity. Static while Reduce Motion is on.
// The parent decides what a screen reader hears: a Skeleton has no label of its own.
export function Skeleton({ height, width = "100%", radius = radii.card }: SkeletonProps) {
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return undefined;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [reduceMotion, opacity]);

  return (
    <Animated.View
      style={{ height, width, borderRadius: radius, backgroundColor: colors.petal, opacity }}
    />
  );
}
