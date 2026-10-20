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
import type { ProcessingStage } from "@/types";

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

type ProcessingOverlayProps = {
  entryKind: "audio" | "text";
  stage: ProcessingStage | null;
  error: boolean;
  onClose: () => void;
  onRetry: () => void;
  onSaveAndClose: () => void;
};

// Fills the screen over the editing view, which stays mounted underneath so nothing the user wrote or
// recorded is lost. The mock progress is real in shape: each stage is a step the server will report.
export function ProcessingOverlay({
  entryKind,
  stage,
  error,
  onClose,
  onRetry,
  onSaveAndClose,
}: ProcessingOverlayProps) {
  const { width } = useWindowDimensions();
  const [opacity] = useState(() => new Animated.Value(0));
  const haloScale = usePulse(1.08, !error);
  const audio = entryKind === "audio";

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
  }, [opacity]);

  const stepStates: StepState[] =
    stage === "preparing"
      ? ["done", "done", "active"]
      : stage === "reflecting"
        ? ["done", "active", "upcoming"]
        : ["active", "upcoming", "upcoming"];
  const receive = audio ? processing.steps.receiveAudio : processing.steps.receiveText;
  const steps = [receive, processing.steps.reflect, processing.steps.prepare];

  // A screen-reader-only live region speaks each stage (and the failure) without moving focus.
  const stageMessage =
    stage === "preparing"
      ? processing.announce.preparing
      : stage === "reflecting"
        ? processing.announce.reflecting
        : audio
          ? processing.announce.receivingAudio
          : processing.announce.receivingText;
  const announcement = error ? processing.error.title : stageMessage;
  useAnnounce(announcement);

  const padding = width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: padding }]}
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <>
            <Text
              accessibilityRole="header"
              className="text-center text-headline text-plum-deep"
              style={styles.title}
            >
              {processing.error.title}
            </Text>
            <Text className="mt-2 text-center text-body text-mauve" style={styles.subtitle}>
              {processing.error.body}
            </Text>
            <View className="mt-6 w-full">
              <PrimaryButton label={processing.error.retry} onPress={onRetry} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={processing.error.saveAndClose}
              className="mt-2 min-h-11 items-center justify-center px-4"
              onPress={onSaveAndClose}
            >
              <Text className="btn-text__label">{processing.error.saveAndClose}</Text>
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
                <Image
                  source={images.logoMark}
                  contentFit="contain"
                  tintColor="white"
                  style={styles.logo}
                />
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
              {steps.map((step, index) => (
                <StepCard
                  key={step.title}
                  state={stepStates[index]}
                  title={step.title}
                  description={step.description}
                />
              ))}
            </View>

            <View className="card card--blush mt-6 w-full flex-row items-center gap-2.5 p-3.5">
              <Icon name={icons.journal} size={20} color={colors.plum} />
              <Text className="flex-1 text-label-md text-ink">{processing.note}</Text>
            </View>

            <View className="mt-4 w-full">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={processing.close}
                onPress={onClose}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <View className="btn-ghost">
                  <Text className="btn-ghost__label">{processing.close}</Text>
                </View>
              </Pressable>
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
  pressed: { transform: [{ scale: 0.98 }] },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0.01 },
});
