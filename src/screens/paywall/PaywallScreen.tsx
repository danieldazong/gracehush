import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState, type ReactElement } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { PaywallFooter, PaywallLinks } from "@/components/paywall/PaywallFooter";
import { PlanOption } from "@/components/paywall/PlanOption";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Skeleton } from "@/components/Skeleton";
import { FREE_DEVOTIONALS_PER_WEEK } from "@/constants/app";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { usePaywall, type PaywallNotice, type PaywallState } from "@/hooks/usePaywall";
import type { RootStackScreenProps } from "@/navigation/types";
import { MessageView } from "@/screens/journal/ReflectionStateViews";
import { openLegalPage, openManageSubscription } from "@/services/externalLinks";
import { formatWeekday } from "@/utils/format";
import { activeIntroOffer, annualSavingsPercent, pricePerMonthLabel } from "@/utils/pricing";

const { paywall } = copy;

// The button and the renewal terms under it are pinned under the scrolling page only where that leaves room for the
// page: a tall window at normal or moderately large text. Otherwise they are the end of the page, above the links.
// Either way they are one block. "Maybe later" and the two policy pages are always the last rows of the scrolling
// page, so the pinned block stays short and both plans fit above it.
const PIN_MIN_HEIGHT = 700;
const PIN_MAX_FONT_SCALE = 1.3;

const PLATFORM = Platform.OS === "ios" ? "ios" : "android";

const icons = {
  close: { android: "close", ios: "xmark" },
  check: { android: "check", ios: "checkmark" },
} satisfies Record<string, SymbolViewProps["name"]>;

type ReadyState = Extract<PaywallState, { status: "ready" }>;
// A link that could not be opened: the terms and the privacy policy, or the store's subscriptions page.
type LinkNotice = "page" | "subscription";

// A calm line under the buttons. It stays until the next action, never on a timer.
function NoticeLine({ message, mauve = false }: { message: string; mauve?: boolean }) {
  useAnnounce(message);

  return (
    <Text
      accessibilityLiveRegion="polite"
      className={
        mauve
          ? "text-center text-body-sm text-mauve"
          : "text-center text-body-sm text-rosewood"
      }
    >
      {message}
    </Text>
  );
}

function PurchaseNotice({ notice }: { notice: PaywallNotice }) {
  return (
    <NoticeLine
      message={paywall.notices[notice]}
      mauve={notice === "pending" || notice === "restoreNone"}
    />
  );
}

// The shape of the page: the mark, the title, the benefits, two plans and the button.
function PaywallLoading() {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View
        accessible
        accessibilityLabel={paywall.loading}
        accessibilityState={{ busy: true }}
        className="screen__content pt-2"
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="items-center gap-4"
        >
          <Skeleton width={80} height={80} radius={40} />
          <View className="w-full items-center gap-2">
            <Skeleton width="85%" height={30} radius={8} />
            <Skeleton width="60%" height={30} radius={8} />
          </View>
          <Skeleton height={88} />
          <Skeleton height={88} />
          <Skeleton height={88} />
          <Skeleton height={56} radius={28} />
        </View>
      </View>
    </ScrollView>
  );
}

// The page: a limit banner when the free limit sent the user here, the mark and title, what Pro includes, and the
// plans. Every price, percentage and trial length comes from the offering through utils/pricing.
function PaywallReady({
  state,
  source,
  hasEntry,
  pinned,
  linkNotice,
  onClose,
  onPurchase,
  onOpenPage,
}: {
  state: ReadyState;
  source: "profile" | "limit";
  hasEntry: boolean;
  pinned: boolean;
  linkNotice: LinkNotice | null;
  onClose: () => void;
  onPurchase: () => void;
  onOpenPage: (url: string) => void;
}) {
  const { usage } = state;
  // The yearly plan first.
  const packages = [...state.offering.packages].sort(
    (a, b) => Number(b.kind === "annual") - Number(a.kind === "annual"),
  );
  const monthly = packages.find((pkg) => pkg.kind === "monthly");
  const busy = state.purchasing || state.restoring;
  // A link that failed to open is the latest action, so its line comes first.
  const notice =
    linkNotice === "page" ? (
      <NoticeLine message={paywall.legal.openError} />
    ) : state.notice ? (
      <PurchaseNotice notice={state.notice} />
    ) : null;
  const footer = (
    <PaywallFooter
      pkg={state.selected}
      eligible={state.eligibility[state.selected.id] ?? false}
      purchasing={state.purchasing}
      restoring={state.restoring}
      platform={PLATFORM}
      notice={notice}
      onPurchase={onPurchase}
    />
  );

  return (
    <>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
        <View className="screen__content pt-2">
          {source === "limit" && usage.limit !== null ? (
            <View className="card card--blush mb-4 gap-1">
              <Text className="text-label-lg text-ink">{paywall.limit.used(usage.limit)}</Text>
              <Text className="text-body-sm text-mauve">
                {paywall.limit.resets(formatWeekday(usage.resetsAt))}
              </Text>
              {hasEntry ? <Text className="text-body-sm text-mauve">{paywall.limit.saved}</Text> : null}
            </View>
          ) : null}

          <View className="mb-6 items-center">
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              className="size-20 items-center justify-center rounded-full border border-petal bg-card"
              style={shadows.card}
            >
              <Image
                source={images.logoMark}
                contentFit="contain"
                tintColor={colors.plum}
                style={styles.logo}
              />
            </View>
            <Text accessibilityRole="header" className="mt-4 text-center text-title text-plum-deep">
              {paywall.hero.title}
            </Text>
            <Text className="mt-2 max-w-xs text-center text-body text-mauve">
              {paywall.hero.subtitle}
            </Text>
          </View>

          <View className="card mb-6 gap-3" style={shadows.card}>
            {paywall.features.map((feature) => (
              <View key={feature.title} className="flex-row items-start gap-3">
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  className="mt-0.5 size-6 items-center justify-center rounded-full bg-sage/15"
                >
                  <Icon name={icons.check} size={16} color={colors.sage} />
                </View>
                <View className="flex-1">
                  <Text className="text-body text-ink">{feature.title}</Text>
                  {feature.helper ? (
                    <Text className="text-body-sm text-mauve">
                      {feature.helper(FREE_DEVOTIONALS_PER_WEEK)}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>

          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={paywall.plan.groupLabel}
            className="gap-3"
          >
            {packages.map((pkg) => (
              <PlanOption
                key={pkg.id}
                pkg={pkg}
                selected={pkg.id === state.selected.id}
                trialDays={
                  activeIntroOffer(pkg, state.eligibility[pkg.id] ?? false)?.periodDays ?? null
                }
                savingsPercent={
                  pkg.kind === "annual" && monthly !== undefined
                    ? annualSavingsPercent(pkg, monthly)
                    : null
                }
                perMonth={pricePerMonthLabel(pkg)}
                disabled={busy}
                onSelect={() => state.select(pkg.id)}
              />
            ))}
          </View>
        </View>
        {pinned ? null : footer}
        <PaywallLinks showLater={source === "limit"} onLater={onClose} onOpenPage={onOpenPage} />
      </ScrollView>
      {pinned ? (
        <View className="pb-2">
          <View className="divider" />
          {footer}
        </View>
      ) : null}
    </>
  );
}

export function PaywallScreen({ navigation, route }: RootStackScreenProps<"Paywall">) {
  const { source, entryId } = route.params;
  const state = usePaywall(entryId);
  const { height, fontScale } = useWindowDimensions();
  const [linkNotice, setLinkNotice] = useState<LinkNotice | null>(null);
  useAnnounce(state.status === "done" ? paywall.done.title : null);
  // TODO(34): paywall_viewed { source }

  // The one way out: the X, "Maybe later", Continue and Close. The Paywall opened from the limit replaced New Entry,
  // so it lands on Journal. popTo, never navigate("MainTabs"): that would push a second copy of the tabs.
  function close() {
    if (source === "limit") navigation.popTo("MainTabs", { screen: "Journal" });
    else navigation.goBack();
  }

  // Crisis support is never paywalled: the entry that sent the user here is a crisis entry, so Reflection takes
  // this screen's place. Nothing of the paywall has been drawn meanwhile.
  // TODO(22): the server checks crisis before the free-tier limit
  useEffect(() => {
    if (state.status === "crisis" && entryId !== undefined) {
      navigation.replace("Reflection", { entryId });
    }
  }, [state.status, entryId, navigation]);

  async function openPage(url: string) {
    const result = await openLegalPage(url);
    setLinkNotice(result.ok ? null : "page");
  }

  async function manageSubscription() {
    const result = await openManageSubscription();
    setLinkNotice(result.ok ? null : "subscription");
  }

  // Restore sits in the header in every state that has plans (or is still finding out).
  const restorable = state.status === "ready" || state.status === "unavailable" ? state : null;
  const restoring = restorable?.restoring ?? false;
  const purchasing = state.status === "ready" ? state.purchasing : false;
  const showRestore = state.status === "loading" || restorable !== null;
  const restoreDisabled = restorable === null || restoring || purchasing;
  const pinned = height >= PIN_MIN_HEIGHT && fontScale <= PIN_MAX_FONT_SCALE;

  function restore() {
    setLinkNotice(null);
    restorable?.restore();
  }

  function purchase() {
    setLinkNotice(null);
    if (state.status === "ready") state.purchase();
  }

  let body: ReactElement;
  switch (state.status) {
    case "loading":
    case "crisis":
      body = <PaywallLoading />;
      break;
    case "unavailable":
      body = (
        <MessageView title={paywall.unavailable.title} body={paywall.unavailable.body}>
          <PrimaryButton
            label={paywall.unavailable.retry}
            disabled={state.restoring}
            onPress={state.retry}
          />
          <PrimaryButton tone="ghost" label={paywall.unavailable.close} onPress={close} />
          {state.notice ? <PurchaseNotice notice={state.notice} /> : null}
        </MessageView>
      );
      break;
    case "member":
      body = (
        <MessageView
          title={paywall.member.title}
          body={state.tier === "trial" ? paywall.member.bodyTrial : paywall.member.bodyPro}
        >
          <PrimaryButton tone="ghost" label={paywall.member.manage} onPress={manageSubscription} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={paywall.member.close}
            className="min-h-11 items-center justify-center"
            onPress={close}
          >
            <Text className="btn-text__label">{paywall.member.close}</Text>
          </Pressable>
          {linkNotice === "subscription" ? <NoticeLine message={paywall.member.manageError} /> : null}
        </MessageView>
      );
      break;
    case "done":
      // TODO(25): with source "limit" and an entryId, resume that entry's devotional generation (step 25)
      // TODO(34): purchase_completed { plan, trial } or restore_completed { found: true }
      body = (
        <MessageView
          title={paywall.done.title}
          body={state.tier === "trial" ? paywall.done.bodyTrial : paywall.done.body}
        >
          <PrimaryButton label={paywall.done.action} onPress={close} />
        </MessageView>
      );
      break;
    case "ready":
      body = (
        <PaywallReady
          state={state}
          source={source}
          hasEntry={entryId !== undefined}
          pinned={pinned}
          linkNotice={linkNotice}
          onClose={close}
          onPurchase={purchase}
          onOpenPage={openPage}
        />
      );
      break;
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      {/* Drawn from the first frame in every state, and never disabled: nobody is trapped on a paywall. */}
      <View className="screen__content flex-row items-center justify-between pb-1 pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.common.close}
          onPress={close}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-11 items-center justify-center">
            <Icon name={icons.close} size={24} color={colors.ink} />
          </View>
        </Pressable>
        {showRestore ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={paywall.restore}
            accessibilityState={{ disabled: restoreDisabled }}
            disabled={restoreDisabled}
            onPress={restore}
            style={({ pressed }) => [pressed && styles.pressed, restoreDisabled && styles.disabled]}
          >
            <View className="-mr-3 min-h-11 justify-center px-3">
              <Text className="text-label-md text-mauve">{paywall.restore}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  logo: { width: 40, height: 40 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
