import { Image, type ImageContentPosition } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

import { useReduceMotion } from "@/hooks/useReduceMotion";

// The motion every painted scene in the app shares (the Welcome, the Sign In cover, the Now Playing card): it breathes, a
// slow zoom in and out that reads as a place and not a template, and with more than one scene it cross-fades to the next
// on the caller's beat.
const BREATH_MS = 12_000;
const BREATH_SCALE = 1.05;
const CROSSFADE_MS = 900;
const REST_MS = 300;

type SceneStackProps = {
  sources: readonly number[]; // the bundled scenes in the order they rotate
  start?: number; // the scene shown first
  holdMs: number; // how long a scene stays before the next one fades in
  moving: boolean; // false: it holds the scene it is on
  contentPosition?: ImageContentPosition;
};

// Fills its parent, which clips it. Stopping is gentle, because a person can be looking (a paused devotional): a cross-fade
// under way finishes and the zoom eases back to rest, so the next start begins from there with no jump. Under Reduce
// Motion it is the first scene, still. Every scene stays mounted, so the next one is decoded before it is shown.
export function SceneStack({ sources, start = 0, holdMs, moving, contentPosition }: SceneStackProps) {
  const reduceMotion = useReduceMotion();
  const [zoom] = useState(() => new Animated.Value(1));
  const [opacities] = useState(() => sources.map((_, index) => new Animated.Value(index === start ? 1 : 0)));
  // The scene shown now; written only inside the timer below.
  const current = useRef(start);

  useEffect(() => {
    if (reduceMotion) {
      zoom.setValue(1);
      return undefined;
    }
    if (!moving) {
      const rest = Animated.timing(zoom, {
        toValue: 1,
        duration: REST_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      rest.start();
      return () => rest.stop();
    }
    const breath = Animated.loop(
      Animated.sequence([
        Animated.timing(zoom, {
          toValue: BREATH_SCALE,
          duration: BREATH_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(zoom, {
          toValue: 1,
          duration: BREATH_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      // The default puts the zoom back to 1 at each start, which a resume right after a pause would show as a jump.
      { iterations: -1, resetBeforeIteration: false },
    );
    breath.start();
    const timer =
      opacities.length > 1
        ? setInterval(() => {
            const from = current.current;
            const to = (from + 1) % opacities.length;
            current.current = to;
            // A later layer is drawn above an earlier one: a later scene fades in over the one shown, and an earlier scene
            // is put underneath at once while the one shown fades out. Either way the eye sees one cross-fade.
            if (to > from) {
              Animated.timing(opacities[to], {
                toValue: 1,
                duration: CROSSFADE_MS,
                useNativeDriver: true,
              }).start(({ finished }) => {
                if (finished) opacities[from].setValue(0);
              });
            } else {
              opacities[to].setValue(1);
              Animated.timing(opacities[from], {
                toValue: 0,
                duration: CROSSFADE_MS,
                useNativeDriver: true,
              }).start();
            }
          }, holdMs)
        : null;
    return () => {
      breath.stop();
      if (timer !== null) clearInterval(timer);
    };
  }, [moving, reduceMotion, holdMs, zoom, opacities]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }] }]}>
      {sources.map((source, index) => (
        <Animated.View key={index} style={[StyleSheet.absoluteFill, { opacity: opacities[index] }]}>
          <Image source={source} contentFit="cover" contentPosition={contentPosition} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ))}
    </Animated.View>
  );
}
