import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { FadeIn } from "@/components/FadeIn";
import { Icon } from "@/components/Icon";
import { colors } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";

// How an icon takes its turn once the rows have arrived (2026-11-01, round 7, the user's request): two soft beats like
// sound through the headphones, a page turned inside the open book (the book itself stays open and still), a bell's
// swing that dies down.
export type IconMotion = "pulse" | "flip" | "ring";

export type BenefitItem = {
  readonly icon: SymbolViewProps["name"];
  readonly text: string;
  readonly motion?: IconMotion;
};

type BenefitListProps = {
  items: readonly BenefitItem[];
  // Whether the icons may move: the cover passes whether the screen is in front. Default true.
  active?: boolean;
};

const ICON = 18;
// The rows arrive one after another, like the Reflection screen's sections but shorter: the eye follows them down the
// list once, and under Reduce Motion they are simply there (FadeIn).
const FIRST_DELAY_MS = 120;
const STAGGER_MS = 90;
const RISE = 8;
const DURATION_MS = 260;
// Then the icons take their turn: each plays its motion twice, a short pause, the next one, and after the last a rest of
// three seconds before the first begins again, for as long as the screen is in front (the user's pace, set on the
// iPhone on 2026-11-01: the first cut was too fast, played once, and rested too long). Nothing moves under Reduce Motion,
// and a row with no motion (the final step's) keeps a still icon.
const SEQUENCE_DELAY_MS = 900;
const TURNS_PER_ICON = 2;
const MOTION_GAP_MS = 400;
const REST_MS = 3000;
// One play of each motion: a beat, one page turned inside the open book, a swing. The page turn is 600 ms on a sine
// ease, the pace of a page turned gently by hand (the user's correction of 2026-11-01: the first cuts turned the whole
// glyph, a full turn in 1.2 s and then a half turn in 1.5 s, which read as the book flipping, not a page).
const MOTION_MS: Record<IconMotion, number> = { pulse: 800, flip: 600, ring: 1100 };
// The pulse and the swing are shaped by their stops (linear progress); the page turn eases in and out on a sine.
const MOTION_EASING: Record<IconMotion, (value: number) => number> = {
  pulse: Easing.linear,
  flip: Easing.inOut(Easing.sin),
  ring: Easing.linear,
};
const MOTIONS: readonly IconMotion[] = ["pulse", "flip", "ring"];

function isIconMotion(value: string): value is IconMotion {
  return (MOTIONS as readonly string[]).includes(value);
}

// The transform of a moving icon, from its 0-to-1 progress. Small on purpose: nothing bounces. The book is not here: its
// glyph never moves, a page over it does (pageTransforms).
function motionTransforms(motion: Exclude<IconMotion, "flip">, value: Animated.Value) {
  switch (motion) {
    case "pulse":
      // One soft beat; the turn plays it twice.
      return [{ scale: value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.14, 1] }) }];
    case "ring":
      // Pivot at the bell's top: move the centre up, swing, move it back.
      return [
        { translateY: -ICON / 2 },
        {
          rotateZ: value.interpolate({
            inputRange: [0, 0.15, 0.35, 0.55, 0.75, 0.9, 1],
            outputRange: ["0deg", "14deg", "-11deg", "8deg", "-5deg", "2deg", "0deg"],
          }),
        },
        { translateY: ICON / 2 },
      ];
  }
}

// The page that turns inside the open book (2026-11-01): a small blush card with a plum edge laid over the right half of
// the 18-point glyph, in the glyph's own pixels (the Icon's box is always 18 by 18; on Android only the glyph inside it
// scales). It fades in as it starts to lift, pivots at the spine (its centre is PAGE_PIVOT right of the spine: move it
// onto the spine, turn, move it back), lands on the left half, and goes, so the next play begins from the right again
// with nothing popping into view. The book's own glyph never moves.
const PAGE = { left: 10.5, top: 5.5, width: 5, height: 7 };
const PAGE_PIVOT = PAGE.left + PAGE.width / 2 - ICON / 2;

function pageTransforms(value: Animated.Value) {
  return [
    { perspective: 300 },
    { translateX: -PAGE_PIVOT },
    { rotateY: value.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-180deg"] }) },
    { translateX: PAGE_PIVOT },
  ];
}

function pageOpacity(value: Animated.Value) {
  return value.interpolate({ inputRange: [0, 0.06, 0.94, 1], outputRange: [0, 1, 1, 0] });
}

// What a person gets, as rows the eye can scan (2026-11-01, round 3): an icon in a blush circle beside one short line in
// DM Sans Medium, left-aligned in a block centred as a whole under the centred title (round 6). The Welcome step's three
// deliverables and the final step's three reasons to sign in draw it, so the two ends of onboarding share one shape.
// The block is bounded by its column on purpose (`max-w-full`, round 5): centred with no bound it had an auto width, so
// a line longer than the column never wrapped and the rows ran off both edges of the phone; the maximum clamps the
// block to the column, and a clamped width is definite, so a long line wraps. The caller's wrapper must stretch, or the
// percentage has nothing definite to resolve against.
export function BenefitList({ items, active = true }: BenefitListProps) {
  const reduceMotion = useReduceMotion();
  // One progress value per row, 0 at rest; only a row with a motion ever moves it.
  const [motionValues] = useState(() => items.map(() => new Animated.Value(0)));
  // The effect follows the motions, not the array, so a caller that builds its items on every render does not restart
  // the sequence on every render.
  const motionKey = items.map(({ motion }) => motion ?? "").join(",");

  useEffect(() => {
    const turns = motionKey
      .split(",")
      .map((motion, index) => ({ motion, index }))
      .filter(({ motion, index }) => isIconMotion(motion) && index < motionValues.length);
    if (!active || reduceMotion || turns.length === 0) {
      motionValues.forEach((value) => value.setValue(0));
      return undefined;
    }
    const steps: Animated.CompositeAnimation[] = [];
    turns.forEach(({ motion, index }, turn) => {
      if (turn > 0) steps.push(Animated.delay(MOTION_GAP_MS));
      if (!isIconMotion(motion)) return;
      const value = motionValues[index];
      for (let play = 0; play < TURNS_PER_ICON; play += 1) {
        // Between two plays the value jumps back to 0, which draws the same as 1 for each motion (a scale of 1, a page
        // that has gone, an angle of 0), so nothing flickers.
        if (play > 0) steps.push(Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }));
        steps.push(
          Animated.timing(value, {
            toValue: 1,
            duration: MOTION_MS[motion],
            easing: MOTION_EASING[motion],
            useNativeDriver: true,
          }),
        );
      }
    });
    steps.push(Animated.delay(REST_MS));
    // The wait for the rows comes once; the cycle then loops from JavaScript (a native loop cannot hold a sequence, and
    // this one has delays in it), each play still on the native driver, every value back to 0 before the cycle repeats.
    const run = Animated.sequence([Animated.delay(SEQUENCE_DELAY_MS), Animated.loop(Animated.sequence(steps))]);
    run.start();
    return () => {
      run.stop();
      motionValues.forEach((value) => value.setValue(0));
    };
  }, [active, reduceMotion, motionKey, motionValues]);

  return (
    <View className="max-w-full gap-2.5 self-center">
      {items.map(({ icon, text, motion }, index) => {
        const value = motionValues[index];
        return (
          <FadeIn key={text} delay={FIRST_DELAY_MS + index * STAGGER_MS} rise={RISE} duration={DURATION_MS}>
            <View className="flex-row items-center gap-3">
              {/* Decorative: the line beside it says what the row is. */}
              <View className="size-9 items-center justify-center rounded-full border border-petal bg-blush">
                {!motion || !value ? (
                  <Icon name={icon} size={ICON} color={colors.plum} />
                ) : motion === "flip" ? (
                  <View>
                    <Icon name={icon} size={ICON} color={colors.plum} />
                    <Animated.View
                      pointerEvents="none"
                      style={[styles.page, { opacity: pageOpacity(value), transform: pageTransforms(value) }]}
                    />
                  </View>
                ) : (
                  <Animated.View style={{ transform: motionTransforms(motion, value) }}>
                    <Icon name={icon} size={ICON} color={colors.plum} />
                  </Animated.View>
                )}
              </View>
              <Text className="shrink font-dm-medium text-[15px] leading-[22px] text-ink">{text}</Text>
            </View>
          </FadeIn>
        );
      })}
    </View>
  );
}

// The page's geometry and look: an absolute overlay inside the icon's box with an animated transform, which no class
// can express (Style Exception Rules).
const styles = StyleSheet.create({
  page: {
    position: "absolute",
    left: PAGE.left,
    top: PAGE.top,
    width: PAGE.width,
    height: PAGE.height,
    borderRadius: 1,
    borderWidth: 1,
    borderColor: colors.plum,
    backgroundColor: colors.blush,
  },
});
