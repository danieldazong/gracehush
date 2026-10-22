import { Pressable, StyleSheet, Text, View } from "react-native";

import { copy } from "@/constants/copy";
import { shadows } from "@/constants/theme";
import type { PlanPackage } from "@/types";

const { plan } = copy.paywall;

type PlanOptionProps = {
  pkg: PlanPackage;
  selected: boolean;
  // Set only when this user can really get the package's free trial (activeIntroOffer).
  trialDays: number | null;
  // Set only when the prices support a saving (annualSavingsPercent).
  savingsPercent: number | null;
  // The "per month" price of a yearly plan, when there is one (pricePerMonthLabel).
  perMonth: string | null;
  disabled: boolean;
  onSelect: () => void;
};

// One radio option of the plan list. The card keeps the same 2dp border in both states, so choosing one never
// moves the cards. The platform speaks "radio button" and "checked" itself, so the label leaves the state out.
export function PlanOption({
  pkg,
  selected,
  trialDays,
  savingsPercent,
  perMonth,
  disabled,
  onSelect,
}: PlanOptionProps) {
  const title = plan.title[pkg.kind];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={plan.a11y(title, pkg.priceString, pkg.periodLabel, trialDays)}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View
        className={[
          "min-h-16 flex-row items-center gap-3 rounded-card border-2 bg-card p-4",
          selected ? "border-plum" : "border-petal",
        ].join(" ")}
        style={shadows.card}
      >
        <View
          className={[
            "size-5 items-center justify-center rounded-full border-2",
            selected ? "border-plum" : "border-mauve",
          ].join(" ")}
        >
          {/* A view whose background appears on a state change is flattened away on Android. */}
          {selected ? <View collapsable={false} className="size-2.5 rounded-full bg-plum" /> : null}
        </View>
        <View className="flex-1 gap-0.5">
          {/* The chip sits beside the title at 390dp and wider (px-2 gives it the few dp it needs there), and drops
              under the title when the two do not fit. */}
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="text-section text-ink">{title}</Text>
            {savingsPercent !== null ? (
              <View className="chip chip--terracotta border border-terracotta/25 px-2">
                <Text className="chip__label chip__label--terracotta">{plan.save(savingsPercent)}</Text>
              </View>
            ) : null}
          </View>
          {pkg.kind === "annual" ? (
            perMonth !== null ? (
              <Text className="text-body-sm text-mauve">{plan.perMonth(perMonth)}</Text>
            ) : null
          ) : (
            <Text className="text-body-sm text-mauve">{plan.billedMonthly}</Text>
          )}
          {trialDays !== null ? (
            <Text className="text-label-md text-plum">{plan.trialFree(trialDays)}</Text>
          ) : null}
        </View>
        {/* The price over its period, as the design stacks them. One line ("$9.99 / month") took 101dp and made
            "Monthly Access" break onto two lines at 360dp. It wraps if it must, and never pushes the radio out. */}
        <View className="shrink items-end">
          <Text className="text-right text-label-lg text-ink">{pkg.priceString}</Text>
          <Text className="text-right text-body-sm text-mauve">{plan.perPeriod(pkg.periodLabel)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
