import type { SymbolViewProps } from "expo-symbols";
import { Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import type { WeekDot } from "@/data/selectors";

const icons = {
  sun: { android: "wb_sunny", ios: "sun.max.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

type WeekStripProps = {
  // The last seven days, oldest first, today last (getWeekDots).
  dots: readonly WeekDot[];
  // The server's run of days in a row, for the spoken sentence only: it is no longer drawn.
  streakDays: number;
};

// The week under the greeting (2026-11-16): seven small circles, one for each of the last seven days. A day with a finished
// reflection is a plum circle with a small sun; today has a rose ring; any other day is an empty ring. It replaces the
// "N days of reflection" tag. A day without a reflection is never counted against the person: there is no red, no word for it and
// nothing to press. A screen reader hears one sentence and skips the circles. The screen draws the strip only once one of the
// seven days is filled (2026-11-17): a week with nothing in it would be seven blank rings, and would read as a failure.
export function WeekStrip({ dots, streakDays }: WeekStripProps) {
  const reflected = dots.filter((dot) => dot.reflected).map((dot) => dot.name);
  return (
    <View accessible accessibilityLabel={copy.today.week.label(reflected, streakDays)} className="flex-row justify-between">
      {dots.map((dot) => (
        <View
          key={dot.key}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="items-center gap-1"
        >
          {/* An empty day is a clear ring (plum at 40%, as strong as the rose of today); today's empty ring is rose over a faint rose fill. */}
          <View
            className={`size-[28px] items-center justify-center rounded-full border-[1.5px] ${
              dot.reflected
                ? dot.today
                  ? "border-rose bg-plum"
                  : "border-plum bg-plum"
                : dot.today
                  ? "border-rose bg-rose/20"
                  : "border-plum/40"
            }`}
          >
            {dot.reflected ? <Icon name={icons.sun} size={14} color="white" /> : null}
          </View>
          <Text
            className={
              dot.today
                ? "font-dm-semibold text-[11px] leading-[16px] text-plum-deep"
                : "font-dm-medium text-[11px] leading-[16px] text-mauve"
            }
          >
            {dot.letter}
          </Text>
        </View>
      ))}
    </View>
  );
}
