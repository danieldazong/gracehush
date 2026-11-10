import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, emotionColors, layout, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { usePulse } from "@/hooks/usePulse";

const FADE_MS = 250;

const icons = {
  check: { android: "check", ios: "checkmark" },
  journal: { android: "menu_book", ios: "book" },
} satisfies Record<string, SymbolViewProps["name"]>;

const { processing } = copy.newEntry;

type StepState = "done" | "active" | "upcoming";

type StepCardProps = {
  state: StepState;
  title: string;
  description: string;
};

// One of the three steps. A screen reader gets a single label per card and never the pieces.
function StepCard({ state, title, description }: StepCardProps) {
  const dotPulse = usePulse(0.4, state === "active");
  const status = processing.status[state];

  const card =
    state === "done"
      ? "border-petal bg-card"
      : state === "active"
        ? "border-plum/30 bg-card"
        : "border-petal bg-linen-deep";
  const titleColor =
    state === "done" ? "text-ink" : state === "active" ? "text-plum" : "text-mauve";
  const descriptionColor = state === "active" ? "text-ink" : "text-mauve";

  return (
    <View
      accessible
      accessibilityLabel={processing.stepLabel(title, status, description)}
      className={`rounded-card border p-3.5 ${card}`}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="flex-row items-start gap-3"
      >
        {state === "done" ? (
          <View className="mt-0.5 size-7 items-center justify-center rounded-full bg-grateful-bg">
            <Icon name={icons.check} size={18} color={emotionColors.grateful.fg} />
          </View>
        ) : state === "active" ? (
          <View className="mt-0.5 size-7 items-center justify-center rounded-full bg-plum">
            <Animated.View style={{ opacity: dotPulse }}>
              <View className="size-2 rounded-full bg-white" />
            </Animated.View>
          </View>
        ) : (
          <View className="mt-0.5 size-7 items-center justify-center rounded-full bg-card">
            <View className="size-5 rounded-full border-[1.5px] border-petal" />
          </View>
        )}
        <View className="flex-1">
          <View className="flex-row flex-wrap items-center gap-x-2">
            <Text className={`text-label-lg ${titleColor}`}>{title}</Text>
            {state === "done" ? (
              <Text className="text-label-md text-grateful-fg">{status}</Text>
            ) : state === "active" ? (
              <Text className="text-label-md text-plum">{status}</Text>
            ) : null}
          </View>
          <Text className={`mt-0.5 text-body-sm ${descriptionColor}`}>{description}</Text>
        </View>
      </View>
    </View>
  );
}

// The overlay's one failure view (step 24): what went wrong, and the two things the person can do about it.
export type OverlayFailure = {
  title: string;
  body: string;
  primary: { label: string; onPress: () => void };
  secondary: { label: string; onPress: () => void };
};

// The two moments the phone knows for sure while the reflection is on its way (2026-11-10): it is saved in the outbox, and
// the request has left for the server. The third step, the server's own work, is in progress for as long as this screen
// shows, and goes on behind the Reflection screen the handoff opens once this one has left.
export type OverlaySteps = { saved: boolean; sent: boolean };

type ProcessingOverlayProps = {
  entryKind: "audio" | "text";
  steps: OverlaySteps;
  failure: OverlayFailure | null;
};

// Fills the screen over the editing view, which stays mounted underneath so nothing the user wrote or recorded is lost.
// Since 2026-11-10 it is a three-second handoff that keeps its three step cards: "Saving" ticks to "Saved" once the reflection
// is in the outbox, "Sending" ticks to "Sent" once the request has left, and "Preparing your devotional" is in progress when
// the screen leaves by itself (NEW_ENTRY_WAIT_MS) for the reflection's own screen, which fills in when the server has finished
// (the owner's request: the progress is shown once, here, and never again as a card on Journal). A step says
// Done only when its thing is done, so there is no Close button and nothing to press: the screen leaves on its own. The
// failure view (the phone could not save it, or the server refused it) is the one view with buttons.
export function ProcessingOverlay({ entryKind, steps, failure }: ProcessingOverlayProps) {
  const { width } = useWindowDimensions();
  const [opacity] = useState(() => new Animated.Value(0));
  const haloScale = usePulse(1.08, failure === null);
  const audio = entryKind === "audio";

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
  }, [opacity]);

  const states: StepState[] = [
    steps.saved ? "done" : "active",
    !steps.saved ? "upcoming" : steps.sent ? "done" : "active",
    steps.sent ? "active" : "upcoming",
  ];
  const { save, send, prepare } = processing.steps;
  const cards = [
    { key: "save", title: steps.saved ? save.done : save.active, description: save.description },
    { key: "send", title: steps.sent ? send.done : send.active, description: send.description },
    { key: "prepare", title: prepare.title, description: prepare.description },
  ];

  // A screen-reader-only live region speaks each step (and the failure) without moving focus.
  const stepMessage = steps.sent
    ? processing.announce.sent
    : steps.saved
      ? processing.announce.saved
      : processing.announce.saving;
  const announcement = failure ? failure.title : stepMessage;
  useAnnounce(announcement);

  const padding = width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: padding }]}
        showsVerticalScrollIndicator={false}
      >
        {failure ? (
          <>
            <Text
              accessibilityRole="header"
              className="text-center text-headline text-plum-deep"
              style={styles.title}
            >
              {failure.title}
            </Text>
            <Text className="mt-2 text-center text-body text-mauve" style={styles.subtitle}>
              {failure.body}
            </Text>
            <View className="mt-6 w-full">
              <PrimaryButton label={failure.primary.label} onPress={failure.primary.onPress} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={failure.secondary.label}
              className="mt-2 min-h-11 items-center justify-center px-4"
              onPress={failure.secondary.onPress}
            >
              <Text className="btn-text__label">{failure.secondary.label}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View className="items-center justify-center" style={styles.pulse}>
              <Animated.View style={[styles.halo, { transform: [{ scale: haloScale }] }]}>
                <View className="flex-1 rounded-full bg-plum/15" />
              </Animated.View>
              <View
                className="items-center justify-center rounded-full bg-plum"
                style={[styles.mark, shadows.orb]}
              >
                <Image source={images.logoMarkLight} contentFit="contain" style={styles.logo} />
              </View>
            </View>
            <Text
              accessibilityRole="header"
              className="mt-6 text-center text-headline text-plum-deep"
              style={styles.title}
            >
              {audio ? processing.titleAudio : processing.titleText}
            </Text>
            <Text className="mt-2 text-center text-body text-ink/80" style={styles.subtitle}>
              {processing.subtitle}
            </Text>

            <View className="mt-6 w-full gap-3">
              {cards.map((card, index) => (
                <StepCard
                  key={card.key}
                  state={states[index]}
                  title={card.title}
                  description={card.description}
                />
              ))}
            </View>

            <View className="card card--blush mt-6 w-full flex-row items-center gap-2.5 p-3.5">
              <Icon name={icons.journal} size={20} color={colors.plum} />
              <Text className="flex-1 text-label-md text-ink">{processing.note}</Text>
            </View>
          </>
        )}
      </ScrollView>
      {/* Android only: iOS has no live regions and hears useAnnounce. Not opacity 0, because Android
          hides a fully transparent view from screen readers. */}
      {Platform.OS === "android" ? (
        <Text accessibilityLiveRegion="polite" style={styles.hidden}>
          {announcement}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: colors.linen },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 24,
  },
  pulse: { width: 128, height: 128 },
  halo: { position: "absolute", width: 128, height: 128 },
  mark: { width: 80, height: 80 },
  logo: { width: 36, height: 36 },
  title: { maxWidth: 320 },
  subtitle: { maxWidth: 384 },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0.01 },
});
