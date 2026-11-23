import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";

import { copy } from "@/constants/copy";
import { gradients, shadows } from "@/constants/theme";
import type { SubscriptionTier } from "@/types";

// The two sizes of the picture it sits on (UserAvatar): the tab header's 32 and Profile's 64. The pill hangs a third of its
// height below the circle; its text is the 1-point border's inside height, so the word sits in the middle of the body.
const SIZES = {
  32: { pill: "h-[11px] px-[3.5px]", text: "text-[6.5px] leading-[9px] tracking-[0.15px]", hang: "-bottom-[3px]" },
  64: { pill: "h-[16px] px-[5.5px]", text: "text-[9px] leading-[14px] tracking-[0.2px]", hang: "-bottom-[5px]" },
} as const;

// Pro and a trial share the plum look, Free the pale one.
const LOOKS = {
  paid: {
    body: gradients.planTagPro,
    shine: gradients.planTagShinePro,
    rim: "border-rose",
    text: "text-white",
    lift: shadows.planTagPro,
  },
  free: {
    body: gradients.planTagFree,
    shine: gradients.planTagShineFree,
    rim: "border-rose/75",
    text: "text-plum",
    lift: shadows.planTagFree,
  },
} as const;

// The plan tag on the profile picture (2026-11-19, the co-founder's request): a small raised pill centred on the circle's bottom
// edge that says Free, Trial or Pro. Built in the app's own colours: a body lit from above, a white shine on its upper half, a rose
// rim and a soft drop shadow. The shadow is on an outer view and the clip on an inner one, so the clip never cuts the shadow.
// Decorative: the header's button says the plan (copy.header.openProfileWithPlan), and Profile's plan card says it in full.
export function PlanTag({ size, tier }: { size: keyof typeof SIZES; tier: SubscriptionTier }) {
  const { pill, text, hang } = SIZES[size];
  const look = tier === "free" ? LOOKS.free : LOOKS.paid;
  return (
    <View pointerEvents="none" className={`absolute ${hang} rounded-full`} style={look.lift}>
      <View className={`${pill} justify-center overflow-hidden rounded-full border ${look.rim}`}>
        <LinearGradient colors={look.body.colors} locations={look.body.locations} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={look.shine.colors} locations={look.shine.locations} style={StyleSheet.absoluteFill} />
        {/* Part of the picture: it keeps its size in the fixed circle whatever the system text size. */}
        <Text allowFontScaling={false} numberOfLines={1} className={`font-dm-bold ${text} ${look.text}`}>
          {copy.planTag.label[tier]}
        </Text>
      </View>
    </View>
  );
}
