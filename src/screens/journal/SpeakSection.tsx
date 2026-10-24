import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Icon } from "@/components/Icon";
import { Waveform } from "@/components/Waveform";
import { MAX_RECORDING_MS, RECORDING_WARNING_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, layout, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { usePulse } from "@/hooks/usePulse";
import type { Recorder } from "@/hooks/useRecorder";
import { haptics } from "@/services/haptics";
import { formatDurationSpoken, formatTimer } from "@/utils/format";

const icons = {
  mic: { android: "mic", ios: "mic.fill" },
  stop: { android: "stop", ios: "stop.fill" },
  refresh: { android: "refresh", ios: "arrow.clockwise" },
  ear: { android: "hearing", ios: "ear" },
} satisfies Record<string, SymbolViewProps["name"]>;

type SpeakSectionProps = {
  recorder: Recorder;
  // Asks before a recording is thrown away. "Record again" and the orb after a recording both use it.
  onRecordAgain: () => void;
  onWriteInstead: () => void;
};

export function SpeakSection({ recorder, onRecordAgain, onWriteInstead }: SpeakSectionProps) {
  const { speak } = copy.newEntry;
  const { state, durationMs, levels, error } = recorder;
  const recording = state === "recording";
  const paused = state === "paused";
  const recorded = state === "recorded";
  const requesting = state === "requesting";

  // Floored once, so the timer, the caption and the spoken labels all agree.
  const shownMs = Math.floor(durationMs / 1000) * 1000;
  const elapsed = formatTimer(shownMs);
  const spoken = formatDurationSpoken(shownMs);
  const atLimit = recorded && durationMs >= MAX_RECORDING_MS;

  // A light tap when a recording starts (a resume counts) and a firmer one when it stops, whichever way it stops (the
  // orb, Finish, or the five-minute limit, from recording or from paused). Pausing makes none: it happens by itself.
  // Only a real change fires, so coming back to this view does not.
  const previousState = useRef(state);
  useEffect(() => {
    if (previousState.current !== "recording" && state === "recording") haptics.light();
    if (
      (previousState.current === "recording" || previousState.current === "paused") &&
      state === "recorded"
    ) {
      haptics.medium();
    }
    previousState.current = state;
  }, [state]);

  const haloPulse = usePulse(0.5, recording);
  const dotPulse = usePulse(0.4, recording);

  // Said under the caption. Each one is a live region, and iOS (which has none) hears it from useAnnounce.
  let message: { text: string; className: string } | null = null;
  if (error) {
    message = { text: speak.errors[error], className: "text-rosewood" };
  } else if (paused) {
    message = { text: speak.paused, className: "text-mauve" };
  } else if (recording && durationMs >= RECORDING_WARNING_MS) {
    message = { text: speak.warning, className: "text-rosewood" };
  } else if (atLimit) {
    message = { text: speak.limit, className: "text-mauve" };
  }
  // The start and the stop have no text on screen. Android hears them through a hidden live region.
  const transition = recording ? speak.started : recorded && !atLimit ? speak.stopped(spoken) : null;
  useAnnounce(message?.text ?? transition);

  function pressOrb() {
    if (requesting) return;
    if (recording) {
      recorder.stop();
    } else if (paused) {
      recorder.resume();
    } else if (recorded) {
      onRecordAgain();
    } else {
      recorder.start();
    }
  }

  const orbLabel = recording
    ? speak.stopLabel(spoken)
    : paused
      ? speak.resumeLabel(spoken)
      : recorded
        ? speak.recordAgain
        : speak.start;

  return (
    <View>
      <View className="mb-4 items-center">
        <Text className="eyebrow mb-1 text-center">{speak.eyebrow}</Text>
        <Text accessibilityRole="header" className="text-center text-headline text-plum-deep">
          {speak.title}
        </Text>
        <Text className="mt-2 max-w-[320px] self-center text-center text-body text-ink/80">
          {speak.helper}
        </Text>
      </View>

      {state === "denied" ? (
        <View className="card card--blush items-center gap-3">
          <Text className="text-label-lg text-ink">{speak.denied.title}</Text>
          <Text className="text-center text-body-sm text-mauve">{speak.denied.body}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={speak.denied.settings}
            onPress={() => Linking.openSettings().catch(() => undefined)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="btn-ghost">
              <Text className="btn-ghost__label">{speak.denied.settings}</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={speak.denied.writeInstead}
            className="min-h-11 items-center justify-center"
            onPress={onWriteInstead}
          >
            {/* plum, not rosewood: a text link on a blush surface is plum (AGENTS.md, colors) */}
            <Text className="btn-text__label text-plum">{speak.denied.writeInstead}</Text>
          </Pressable>
        </View>
      ) : (
        <View className="card card--hero items-center p-6" style={shadows.card}>
          <Waveform levels={levels} active={recording} />

          <View
            accessible
            accessibilityLabel={speak.timerLabel(spoken, formatDurationSpoken(MAX_RECORDING_MS))}
            className="chip mt-2 gap-2 px-3.5"
          >
            {/* Crisis red while recording, rose otherwise, so the chip never changes width. */}
            <Animated.View
              style={[
                styles.dot,
                { backgroundColor: recording ? colors.crisis : colors.rose, opacity: dotPulse },
              ]}
            />
            <Text className="text-timer text-ink">
              {elapsed} / {formatTimer(MAX_RECORDING_MS)}
            </Text>
          </View>

          {/* The halo is a sibling behind the orb and inside this box, so it never covers the timer or the caption. */}
          <View className="my-2 items-center justify-center" style={styles.orbBox}>
            {recording ? (
              <Animated.View pointerEvents="none" style={[styles.halo, { opacity: haloPulse }]}>
                <View className="flex-1 rounded-full bg-crisis/20" />
              </Animated.View>
            ) : (
              <View pointerEvents="none" className="absolute size-[116px] rounded-full bg-rose/30" />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={orbLabel}
              accessibilityState={{ busy: requesting }}
              onPress={pressOrb}
              style={({ pressed }) => pressed && styles.orbPressed}
            >
              <View
                className={
                  recording
                    ? "items-center justify-center rounded-full bg-crisis"
                    : "items-center justify-center rounded-full bg-plum"
                }
                style={[styles.orb, !recording && shadows.orb]}
              >
                {requesting ? (
                  <ActivityIndicator color="white" />
                ) : recording ? (
                  <Icon name={icons.stop} size={28} color="white" />
                ) : (
                  <Icon name={icons.mic} size={36} color="white" />
                )}
              </View>
            </Pressable>
          </View>

          <Text className="mt-1 font-dm-medium text-[11px] uppercase leading-[16px] tracking-[1px] text-mauve">
            {recorded
              ? speak.recorded(elapsed)
              : recording
                ? speak.captionRecording
                : paused
                  ? speak.captionPaused
                  : speak.captionIdle}
          </Text>
          {message ? (
            <Text
              accessibilityLiveRegion="polite"
              className={`mt-2 text-center text-body-sm ${message.className}`}
            >
              {message.text}
            </Text>
          ) : null}
          {Platform.OS === "android" ? (
            <Text accessibilityLiveRegion="polite" style={styles.hidden}>
              {transition ?? ""}
            </Text>
          ) : null}
          {recorded ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={speak.recordAgain}
              className="min-h-11 flex-row items-center justify-center gap-1.5"
              onPress={onRecordAgain}
            >
              <Icon name={icons.refresh} size={14} color={colors.rosewood} />
              <Text className="text-label-md text-rosewood">{speak.recordAgain}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View className="card card--blush mt-4 flex-row items-start gap-3">
        <View className="size-8 items-center justify-center rounded-full bg-rose/50">
          <Icon name={icons.ear} size={18} color={colors.plumDeep} />
        </View>
        <View className="flex-1">
          <Text className="text-label-md text-plum-deep">{speak.info.title}</Text>
          <Text className="mt-0.5 text-body-sm text-ink/80">{speak.info.body}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5 },
  orbBox: { width: layout.recordHalo, height: layout.recordHalo },
  halo: { position: "absolute", width: layout.recordHalo, height: layout.recordHalo },
  orb: { width: layout.recordOrb, height: layout.recordOrb },
  orbPressed: { transform: [{ scale: 0.96 }] },
  pressed: { transform: [{ scale: 0.98 }] },
  // Not opacity 0: Android hides a fully transparent view from screen readers.
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0.01 },
});
