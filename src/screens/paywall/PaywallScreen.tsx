import { useIsFocused } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { BenefitList, type BenefitItem } from "@/components/BenefitList";
import { Icon } from "@/components/Icon";
import { PaywallFooter, PaywallLinks } from "@/components/paywall/PaywallFooter";
import { PlanOption } from "@/components/paywall/PlanOption";
import { TrialReminderRow } from "@/components/paywall/TrialReminderRow";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Skeleton } from "@/components/Skeleton";
import { WelcomeScenes } from "@/components/WelcomeScenes";
import { copy } from "@/constants/copy";
import { paywallScenes } from "@/constants/images";
import { colors } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { usePaywall, type PaywallNotice, type PaywallState } from "@/hooks/usePaywall";
import type { RootStackScreenProps } from "@/navigation/types";
import { MessageView } from "@/screens/journal/ReflectionStateViews";
import { track } from "@/services/analytics";
import { openLegalPage, openManageSubscription } from "@/services/externalLinks";
import type { TrialReminderResult } from "@/services/trialReminder";
import { formatResetDay } from "@/utils/format";
import { activeIntroOffer, annualSavingsPercent, pricePerMonthLabel } from "@/utils/pricing";

const { paywall } = copy;

// The button and the renewal terms under it are pinned under the scrolling page only where that leaves room for the
// page: a tall window at normal or moderately large text. Otherwise they are the end of the page, above the links.
// Either way they are one block. "Maybe later" and the two policy pages are always the last rows of the scrolling
// page, so the pinned block stays short.
const PIN_MIN_HEIGHT = 700;
const PIN_MAX_FONT_SCALE = 1.3;

// The cover (2026-11-15, the owner's request for a paywall that feels premium): the page takes the shape of the Welcome
// and the Sign In cover, so the person asked to pay meets the page they met on day one. Everything between the scene and
// the plans is what a person needs to decide, and nothing else (the owner's second request the same day, when the
// second plan sat under the fold): the title on the scene's fade, four compact rows, the two plans. The scene takes what
// they leave (`flex: 1`), never less than SCENE_MIN: 240, the Sign In cover's, so that on a 6.1-inch iPhone at the
// default text size both plans sit above the pinned button (worked out from the font files: 390 and 393 wide fit by
// about 10 points, the XR at the owner's text size by about 100; a 375-wide phone scrolls by about 20, and the free
// limit's banner adds a scroll on every phone). At the floor the man's chin is just inside the bottom fade (his eyes and
// smile in the clear band), and on a taller phone the picture grows. The top fade follows the top inset as the covers'
// do; in the iOS sheet that inset is 0, so the fade is 72 alone, and the X and "Restore purchases" sit over it. The
// title overlaps the bottom fade by 48, where the lockup sat on the Welcome: a headline on the picture's fade, as the
// reference paywall draws it.
const SCENE_MIN = 240;
const SCENE_FADE_BELOW_INSET = 72;
const SCENE_FADE_BOTTOM = 100;
const TITLE_OVERLAP = 48;

// One of the two scenes per launch (a woman on a sofa at golden hour, a man at a balcony railing at sunrise, each
// listening with headphones), drawn at import and not in render, which must stay pure; the Sign In cover shuffles its
// four the same way. One scene, so the stack only breathes and never cross-fades: nothing competes with the decision.
const sceneSources = [paywallScenes[Math.random() < 0.5 ? 0 : 1]] as const;

const PLATFORM = Platform.OS === "ios" ? "ios" : "android";

const icons = {
  close: { android: "close", ios: "xmark" },
  devotionals: { android: "headphones", ios: "headphones" },
  scholar: { android: "forum", ios: "bubble.left.and.bubble.right" },
  listen: { android: "volume_up", ios: "speaker.wave.2" },
  talk: { android: "graphic_eq", ios: "waveform" },
} satisfies Record<string, SymbolViewProps["name"]>;

// The four rows under the title: every feature that AGENTS.md defines as a Pro gate (Subscription Rules), in the order a
// person meets them in the app. The Welcome's rows in their compact size, so the two ends of the funnel share one shape;
// no icon moves here.
const benefits: readonly BenefitItem[] = [
  { icon: icons.devotionals, text: paywall.features.devotionals },
  { icon: icons.scholar, text: paywall.features.scholarMessages },
  { icon: icons.listen, text: paywall.features.scholarListen },
  { icon: icons.talk, text: paywall.features.scholarTalk },
];

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

// What the done view says about the reminder the person asked for (2026-11-18), in a calm line that stays. "skipped" says
// nothing: this build cannot show notifications, or the trial is too short for a reminder, and the switch was not offered then.
function reminderMessage(reminder: TrialReminderResult): string | null {
  switch (reminder.status) {
    case "scheduled":
      return paywall.reminder.scheduled(reminder.day);
    case "denied":
      return paywall.reminder.denied;
    case "failed":
      return paywall.reminder.failed;
    case "skipped":
      return null;
  }
}

// The shape of the page: the scene's place, the title, the four rows, two plans and the button. The scene itself comes
// with the plans, so the heavy-moment redirect (the crisis status draws this too) shows nothing of the paywall
// meanwhile.
function PaywallLoading() {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View accessible accessibilityLabel={paywall.loading} accessibilityState={{ busy: true }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Skeleton height={SCENE_MIN} radius={0} />
          <View className="screen__content items-center gap-3" style={styles.coverBody}>
            <Skeleton width="70%" height={34} radius={8} />
            <View className="w-full gap-2">
              <Skeleton height={30} radius={15} />
              <Skeleton height={30} radius={15} />
              <Skeleton height={30} radius={15} />
              <Skeleton height={30} radius={15} />
            </View>
            <Skeleton height={85} />
            <Skeleton height={85} />
            <Skeleton height={56} radius={28} />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

// The page: the scene and the title on its fade, a banner when the free limit or Scholar sent the user here, what Pro
// includes, and the plans. Every price, percentage and trial length comes from the offering through utils/pricing.
function PaywallReady({
  state,
  source,
  reason,
  hasEntry,
  pinned,
  linkNotice,
  topInset,
  active,
  onClose,
  onPurchase,
  onOpenPage,
}: {
  state: ReadyState;
  source: "profile" | "limit" | "scholar";
  reason: "messages" | "listen" | "talk" | "conversation" | "voice" | undefined;
  hasEntry: boolean;
  pinned: boolean;
  linkNotice: LinkNotice | null;
  topInset: number;
  active: boolean;
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
  // What sent the person here, under the title and above the rows.
  const banner =
    source === "limit" && usage.limit !== null ? (
      <View className="card card--blush mt-3 gap-1">
        <Text className="text-label-lg text-ink">{paywall.limit.used(usage.limit)}</Text>
        <Text className="text-body-sm text-mauve">
          {paywall.limit.resets(formatResetDay(usage.resetsAt))}
        </Text>
        {hasEntry ? <Text className="text-body-sm text-mauve">{paywall.limit.saved}</Text> : null}
      </View>
    ) : source === "scholar" ? (
      <View className="card card--blush mt-3">
        <Text className="text-label-lg text-ink">{paywall.scholar[reason ?? "messages"]}</Text>
      </View>
    ) : null;

  return (
    <>
      <ScrollView style={styles.flex} contentContainerStyle={styles.coverContent}>
        <WelcomeScenes
          sources={sceneSources}
          minHeight={SCENE_MIN}
          active={active}
          fadeTop={topInset + SCENE_FADE_BELOW_INSET}
          fadeBottom={SCENE_FADE_BOTTOM}
        />
        <View className="screen__content" style={styles.coverBody}>
          {/* One line on every iPhone at the default text size; at a large size it breaks with no word alone. */}
          <Text
            accessibilityRole="header"
            className="text-center text-title text-plum-deep"
            lineBreakStrategyIOS="push-out"
            textBreakStrategy="balanced"
          >
            {paywall.hero.title}
          </Text>
          {banner}
          {/* The wrapper stretches so the list's bound has a definite width (BenefitList). */}
          <View className="mt-3 self-stretch">
            <BenefitList items={benefits} active={active} size="compact" />
          </View>

          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={paywall.plan.groupLabel}
            className="mt-3 gap-3"
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
          {/* What the free trial covers (2026-11-18: the devotionals, not Scholar), said before anything is bought and only
              while the selected plan has a trial the store confirmed. In the scrolling page, so the plans keep their place. */}
          {activeIntroOffer(state.selected, state.eligibility[state.selected.id] ?? false) !== null ? (
            <Text className="mt-3 text-center text-body-sm text-mauve">{paywall.trialScope}</Text>
          ) : null}
          {/* Under the plans, in the scrolling page and never in the pinned block, so both plans stay above the button. Offered
              only when a trial is on offer, this build can show notifications and they are not turned off (usePaywall). */}
          {state.reminder.available ? (
            <View className="mt-3">
              <TrialReminderRow
                value={state.reminder.on}
                onChange={state.reminder.set}
                disabled={busy}
              />
            </View>
          ) : null}
        </View>
        {pinned ? null : footer}
        <PaywallLinks showLater={source !== "profile"} onLater={onClose} onOpenPage={onOpenPage} />
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
  const { source, entryId, reason } = route.params;
  const state = usePaywall(entryId);
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The scene's motion and the rows' arrival run only while this screen is in front.
  const focused = useIsFocused();
  const [linkNotice, setLinkNotice] = useState<LinkNotice | null>(null);
  // What happened to the reminder, after a trial purchase with the switch on: announced once, with the title.
  const reminderLine =
    state.status === "done" && state.reminder !== null ? reminderMessage(state.reminder) : null;
  useAnnounce(
    state.status === "done"
      ? reminderLine === null
        ? paywall.done.title
        : `${paywall.done.title}. ${reminderLine}`
      : null,
  );
  // Sent once per screen, when the plans (or "Plans aren’t available") first show: never for the crisis redirect, which
  // draws nothing of the paywall, nor for a member (step 34).
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || (state.status !== "ready" && state.status !== "unavailable")) return;
    viewed.current = true;
    track("paywall_viewed", { source });
  }, [state.status, source]);

  // The one way out: the X, "Maybe later", Continue and Close. The Paywall opened from the limit replaced New Entry,
  // so it lands on Journal. popTo, never navigate("MainTabs"): that would push a second copy of the tabs. From Scholar it
  // goes back to the conversation, where "Try again" sends the held message after a purchase.
  function close() {
    if (source === "limit") navigation.popTo("MainTabs", { screen: "Journal" });
    else navigation.goBack();
  }

  // Crisis support is never paywalled: the entry that sent the user here is a crisis entry, so Reflection takes
  // this screen's place. Nothing of the paywall has been drawn meanwhile. The server does the same: it screens an entry
  // before it checks the free limit, so a crisis is never counted and never gets a 402 (step 22).
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
  // The cover states: the header floats over the scene (or its place while the plans load) and applies the top inset
  // itself; the message states keep it in flow under the safe area, as before.
  const cover = state.status === "loading" || state.status === "crisis" || state.status === "ready";

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
      // A reflection the free limit held back goes by itself: services/purchases.ts calls resumeAfterUpgrade() (step 24)
      // The purchase or the restore was sent to analytics by usePaywall (step 34).
      body = (
        <MessageView
          title={paywall.done.title}
          body={state.tier === "trial" ? paywall.done.bodyTrial : paywall.done.body}
        >
          {reminderLine !== null ? (
            <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-mauve">
              {reminderLine}
            </Text>
          ) : null}
          <PrimaryButton label={paywall.done.action} onPress={close} />
        </MessageView>
      );
      break;
    case "ready":
      body = (
        <PaywallReady
          state={state}
          source={source}
          reason={reason}
          hasEntry={entryId !== undefined}
          pinned={pinned}
          linkNotice={linkNotice}
          topInset={insets.top}
          active={focused}
          onClose={close}
          onPurchase={purchase}
          onOpenPage={openPage}
        />
      );
      break;
  }

  // Drawn from the first frame in every state, and never disabled: nobody is trapped on a paywall. Over the scene the
  // Restore label takes the covers' on-image tone: mauve measured 4.40:1 over the woman's curtain under the fade, plum-deep
  // 10.3:1 (the X in ink reads 12:1 there).
  const header = (
    <View
      pointerEvents="box-none"
      className="screen__content flex-row items-center justify-between pb-1 pt-2"
    >
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
            <Text className={cover ? "text-label-md text-plum-deep" : "text-label-md text-mauve"}>
              {paywall.restore}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    // On the cover the scene runs under the top edge (the header applies the top inset itself); the message states keep
    // the safe area on every side.
    <SafeAreaView edges={cover ? ["bottom"] : ["top", "bottom"]} style={styles.screen}>
      {cover ? null : header}
      {body}
      {cover ? (
        <View pointerEvents="box-none" style={[styles.coverHeader, { paddingTop: insets.top }]}>
          {header}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 12 },
  // The cover's content fills the viewport, so the scene (flex 1) takes what the page leaves, never less than SCENE_MIN.
  coverContent: { flexGrow: 1, paddingBottom: 12 },
  coverBody: { marginTop: -TITLE_OVERLAP },
  coverHeader: { position: "absolute", top: 0, left: 0, right: 0 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
