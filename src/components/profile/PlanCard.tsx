import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import type { PlanUsage } from "@/types";
import { formatWeekday } from "@/utils/format";

const { plan } = copy.profile;

const icons = {
  sparkle: { android: "auto_awesome", ios: "sparkles" },
} satisfies Record<string, SymbolViewProps["name"]>;

type PlanCardProps = {
  usage: PlanUsage;
  // Whether the store would give this user a free trial: the Pro offer's button says so, or "Upgrade to Pro".
  trialEligible: boolean;
  onStartTrial: () => void;
  onManage: () => void;
};

// The free tier's usage line and bar. The sentence and the bar are one element for a screen reader, which hears
// the sentence and the fill.
function UsageMeter({ used, limit }: { used: number; limit: number }) {
  const text = plan.usage(used, limit);
  const fill = limit > 0 ? Math.min(used / limit, 1) : 0;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={text}
      accessibilityValue={{ min: 0, max: limit, now: used }}
      className="mt-1"
    >
      <Text className="text-body-sm text-mauve">{text}</Text>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-linen-deep">
        <View className="h-full rounded-full bg-plum" style={{ width: `${fill * 100}%` }} />
      </View>
    </View>
  );
}

// The Pro offer nested in the free plan's card, as the design draws it.
function ProOffer({
  trialEligible,
  onStartTrial,
}: {
  trialEligible: boolean;
  onStartTrial: () => void;
}) {
  const action = trialEligible ? plan.upsell.actionTrial : plan.upsell.actionUpgrade;

  return (
    <View className="mt-4 gap-3 rounded-input bg-plum p-4">
      <View className="flex-row items-start gap-2">
        <View className="mt-0.5">
          <Icon name={icons.sparkle} size={22} color={colors.blush} />
        </View>
        <View className="flex-1">
          {/* The chip drops under the title when the two do not fit (at 320dp with large text). */}
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="text-label-lg text-white">{plan.proTitle}</Text>
            <View className="rounded-full bg-white/20 px-2 py-0.5">
              {/* Not the eyebrow class: a second colour utility does not reliably override it. */}
              <Text className="font-dm-bold text-[11px] uppercase leading-[16px] tracking-[0.8px] text-white">
                {plan.upsell.chip}
              </Text>
            </View>
          </View>
          <Text className="mt-0.5 text-body-sm text-white/85">{plan.upsell.body}</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onStartTrial}
        style={({ pressed }) => [styles.alignStart, pressed && styles.pressed]}
      >
        <View className="min-h-11 items-center justify-center rounded-full bg-card px-5">
          <Text className="font-dm-bold text-[11px] uppercase leading-[16px] tracking-[0.8px] text-plum">
            {action}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

// The plan on Profile. A free user sees this week's usage and, nested in the card, the Pro offer; a trial or Pro
// user sees the plan and a way to manage it. Every number and date comes from `usage`, never typed here.
export function PlanCard({ usage, trialEligible, onStartTrial, onManage }: PlanCardProps) {
  const { tier, used, limit, resetsAt } = usage;
  const isFree = tier === "free";

  return (
    <View className="card" style={shadows.card}>
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Text className="text-label-lg text-plum-deep">
          {isFree ? plan.freeTitle : plan.proTitle}
        </Text>
        <Text className="eyebrow">{tier === "trial" ? plan.badgeTrial : plan.badgeActive}</Text>
      </View>

      {isFree ? (
        <>
          {limit === null ? null : <UsageMeter used={used} limit={limit} />}
          <Text className="mt-2 text-body-sm text-mauve">{plan.resets(formatWeekday(resetsAt))}</Text>
          <ProOffer trialEligible={trialEligible} onStartTrial={onStartTrial} />
        </>
      ) : (
        <>
          <Text className="mt-1 text-body-sm text-mauve">{plan.unlimited}</Text>
          <View className="mt-4">
            <PrimaryButton tone="ghost" label={plan.manage} onPress={onManage} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  alignStart: { alignSelf: "flex-start" },
  pressed: { opacity: 0.7 },
});
