import { useEffect, useState } from "react";
import { Animated } from "react-native";

import { useReduceMotion } from "@/hooks/useReduceMotion";

const HALF_CYCLE_MS = 1000;

// A slow 2s pulse from 1 to `to` and back, for an opacity or a scale. It rests at 1 while `active` is
// false and while Reduce Motion is on, so the caller never needs a second code path for either.
export function usePulse(to: number, active: boolean): Animated.Value {
  const reduceMotion = useReduceMotion();
  const [value] = useState(() => new Animated.Value(1));

  useEffect(() => {
    value.setValue(1);
    if (!active || reduceMotion) {
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: to, duration: HALF_CYCLE_MS, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: HALF_CYCLE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, to, value]);

  return value;
}
