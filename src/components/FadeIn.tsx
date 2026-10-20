import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing } from "react-native";

import { useReduceMotion } from "@/hooks/useReduceMotion";

const FADE_MS = 150;

type FadeInProps = {
  children: ReactNode;
  // Wait this long (ms) before starting. The Reflection screen staggers its sections with it.
  delay?: number;
  // Start this many dp lower and rise into place while fading in. 0 is a plain fade.
  rise?: number;
  // How long the fade takes (ms).
  duration?: number;
};

// Fades its children in when it mounts, so a screen replays it by giving FadeIn a new `key`. With Reduce
// Motion on the children simply appear. The effect touches only the animated value, never React state.
export function FadeIn({ children, delay = 0, rise = 0, duration = FADE_MS }: FadeInProps) {
  const reduceMotion = useReduceMotion();
  // Under Reduce Motion it starts at 1, so the content is there on the first frame.
  const [progress] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, progress, delay, duration]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] });

  return (
    <Animated.View
      style={{ opacity: progress, transform: rise > 0 ? [{ translateY }] : undefined }}
    >
      {children}
    </Animated.View>
  );
}
