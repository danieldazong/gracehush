import { useEffect, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";

import { colors } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";

// The steps a new person walks through: Welcome, Rhythm, Permissions, and then Sign In, counted as the last step so the
// progress never resets between the two screens (step 34b). The analytics choice was a fourth step, when a PostHog token
// was set, from step 34 until round 8 of 2026-11-01, when it moved to the Journal's first visit.
export const ONBOARDING_STEPS = 3;
export const TOTAL_STEPS = ONBOARDING_STEPS + 1;

// A step is an 8-dp dot; the current one is a 28-dp pill. When the step moves, the pill behind shrinks to a dot and the
// next dot grows (2026-11-01): the "it heard me" feedback on every tap. A width cannot use the native driver.
const DOT = 8;
const PILL = 28;
const SLIDE_MS = 250;

type StepProgressProps = {
  step: number; // 0-based: the step shown now
  total: number;
  label: string; // the counter ("1 of 4") or "Final step"; drawn uppercase
  accessibilityLabel: string; // "Step 1 of 4"
  // "onImage": drawn over the Welcome scene (2026-11-01), where a petal dot would vanish and the counter needs plum-deep.
  tone?: "default" | "onImage";
};

// The pills and the counter at the top of Onboarding and of the Sign In that ends it. Every step done stays filled (the
// goal-gradient effect, step 34b): plum dots behind, the long plum pill for the current step, petal dots ahead. The pills
// are decorative; the counter carries the spoken label.
export function StepProgress({ step, total, label, accessibilityLabel, tone = "default" }: StepProgressProps) {
  const reduceMotion = useReduceMotion();
  const [widths] = useState(() =>
    Array.from({ length: total }, (_, index) => new Animated.Value(index === step ? PILL : DOT)),
  );

  useEffect(() => {
    if (reduceMotion) {
      widths.forEach((width, index) => width.setValue(index === step ? PILL : DOT));
      return undefined;
    }
    const slide = Animated.parallel(
      widths.map((width, index) =>
        Animated.timing(width, {
          toValue: index === step ? PILL : DOT,
          duration: SLIDE_MS,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
      ),
    );
    slide.start();
    return () => slide.stop();
  }, [step, widths, reduceMotion]);

  const ahead = tone === "onImage" ? `${colors.plum}40` : colors.petal;

  return (
    <View className="flex-row items-center justify-between pb-4 pt-3">
      <View className="flex-row items-center gap-1.5">
        {widths.map((width, index) => (
          <Animated.View
            key={index}
            style={{
              width,
              height: DOT,
              borderRadius: DOT / 2,
              backgroundColor: index <= step ? colors.plum : ahead,
            }}
          />
        ))}
      </View>
      <Text
        accessibilityLabel={accessibilityLabel}
        className={
          tone === "onImage"
            ? "font-dm-semibold text-[12px] uppercase leading-[16px] tracking-[1.2px] text-plum-deep"
            : "font-dm-semibold text-[12px] uppercase leading-[16px] tracking-[1.2px] text-mauve"
        }
      >
        {label}
      </Text>
    </View>
  );
}
