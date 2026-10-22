import type { SymbolViewProps } from "expo-symbols";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { PRIVACY_POLICY_URL, TERMS_URL } from "@/constants/app";
import { copy } from "@/constants/copy";
import type { PlanPackage } from "@/types";
import { renewalDisclosure, trialCtaLabel } from "@/utils/pricing";

const { paywall } = copy;

const icons = {
  arrow: { android: "arrow_forward", ios: "arrow.right" },
} satisfies Record<string, SymbolViewProps["name"]>;

type PaywallFooterProps = {
  pkg: PlanPackage;
  // Whether the store would give this user the package's free trial.
  eligible: boolean;
  purchasing: boolean;
  restoring: boolean;
  platform: "ios" | "android";
  // The line above the button, when there is one.
  notice: ReactNode;
  onPurchase: () => void;
};

// The block that makes the purchase: the button and, directly under it, the renewal terms for the store. It is
// pinned under the page where there is room and is the end of the page otherwise (PaywallScreen decides).
export function PaywallFooter({
  pkg,
  eligible,
  purchasing,
  restoring,
  platform,
  notice,
  onPurchase,
}: PaywallFooterProps) {
  return (
    <View className="screen__content pt-3">
      {notice ? <View className="pb-3">{notice}</View> : null}
      <PrimaryButton
        size="large"
        iconRight={icons.arrow}
        label={trialCtaLabel(pkg, eligible)}
        loading={purchasing}
        disabled={restoring}
        onPress={onPurchase}
      />
      <Text className="mt-3 text-center text-body-sm text-mauve">
        {renewalDisclosure(pkg, eligible, platform)}
      </Text>
    </View>
  );
}

type PaywallLinksProps = {
  showLater: boolean;
  onLater: () => void;
  onOpenPage: (url: string) => void;
};

// The rows that never need to share the screen with the button: "Maybe later" for the free limit and the two
// policy pages. Apple and Google both want the terms and the privacy policy reachable from the purchase screen,
// which the last rows of its page are. They always sit at the end of the scrolling page, so the pinned block
// above stays short enough to leave both plans on screen. The 16dp above them keeps the row clear of the pinned
// block's edge: with less, a 845dp window showed the top of its labels as a half-cut line over the divider.
export function PaywallLinks({ showLater, onLater, onOpenPage }: PaywallLinksProps) {
  return (
    <View className="screen__content gap-1 pt-4">
      {showLater ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={paywall.later}
          className="min-h-11 items-center justify-center"
          onPress={onLater}
        >
          <Text className="btn-text__label">{paywall.later}</Text>
        </Pressable>
      ) : null}
      <View className="flex-row items-center justify-center">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={paywall.legal.terms}
          className="min-h-11 justify-center px-2"
          onPress={() => onOpenPage(TERMS_URL)}
        >
          <Text className="text-label-md text-rosewood">{paywall.legal.terms}</Text>
        </Pressable>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          className="text-label-md text-mauve"
        >
          {paywall.legal.separator}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={paywall.legal.privacy}
          className="min-h-11 justify-center px-2"
          onPress={() => onOpenPage(PRIVACY_POLICY_URL)}
        >
          <Text className="text-label-md text-rosewood">{paywall.legal.privacy}</Text>
        </Pressable>
      </View>
    </View>
  );
}
