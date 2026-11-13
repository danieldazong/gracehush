import { randomUUID } from "expo-crypto";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
} from "react-native";

import { Icon } from "@/components/Icon";
import { Waveform } from "@/components/Waveform";
import { SCHOLAR_MAX_MESSAGE_LENGTH, SCHOLAR_MAX_SPOKEN_MS, SCHOLAR_SPOKEN_WARNING_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import { chatRecordingId } from "@/data/scholarRepository";
import { useAnnounce } from "@/hooks/useAnnounce";
import type { SpokenSend, SpokenTake } from "@/hooks/useConversation";
import { useRecorder } from "@/hooks/useRecorder";
import { haptics } from "@/services/haptics";
import { formatDurationSpoken, formatTimer } from "@/utils/format";

const icons = {
  mic: { android: "mic", ios: "mic.fill" },
  send: { android: "arrow_upward", ios: "arrow.up" },
  keyboard: { android: "keyboard", ios: "keyboard" },
  close: { android: "close", ios: "xmark" },
} satisfies Record<string, SymbolViewProps["name"]>;

type ConversationComposerProps = {
  initialMode: "type" | "speak";
  // A turn is in flight: send and the mic wait (one at a time), and the field stays editable.
  busy: boolean;
  inputRef: RefObject<TextInputInstance | null>;
  // False when nothing was sent: the words stay in the field.
  onSend: (text: string) => boolean;
  onSendSpoken: (take: SpokenTake) => SpokenSend;
};

// Scholar's composer (step 38), pinned under the conversation: Type (a field and one button: a ghost mic while the field is
// empty, a plum send once there are words) and Speak (a take of at most two minutes, sent as a recording that the server
// transcribes and screens). Never disabled by a limit: a message is always sent, because the server screens it first and answers
// a heavy one whatever the count. The AI line under it is always on screen.
export function ConversationComposer({ initialMode, busy, inputRef, onSend, onSendSpoken }: ConversationComposerProps) {
  const [mode, setMode] = useState(initialMode);
  const [text, setText] = useState("");
  // Each take is a message: its id names the file (recordings/chat-{id}.m4a) and the request. A sent take gets a new one.
  const [takeId, setTakeId] = useState(() => randomUUID());
  const hasText = text.trim().length > 0;

  function sendText() {
    if (busy || !hasText) return;
    if (onSend(text)) setText("");
  }

  return (
    <View className="gap-1.5 border-t border-petal bg-linen px-4 pb-2 pt-2.5">
      {mode === "type" ? (
        <View className="flex-row items-end gap-2">
          <TextInput
            ref={inputRef}
            accessibilityLabel={copy.scholar.a11y.message}
            className="flex-1 rounded-input border border-petal bg-card px-4 text-body text-ink"
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="center"
            autoCapitalize="sentences"
            autoCorrect
            maxLength={SCHOLAR_MAX_MESSAGE_LENGTH}
            placeholder={copy.scholar.input}
            placeholderTextColor={colors.mauve}
            keyboardAppearance="light"
            underlineColorAndroid="transparent"
          />
          {hasText ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.scholar.a11y.send}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={sendText}
              style={({ pressed }) => [busy && styles.disabled, pressed && styles.pressed]}
            >
              <View className="size-11 items-center justify-center rounded-full bg-plum">
                <Icon name={icons.send} size={20} color={colors.card} />
              </View>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.scholar.a11y.speak}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => setMode("speak")}
              style={({ pressed }) => [busy && styles.disabled, pressed && styles.pressed]}
            >
              <View className="size-11 items-center justify-center rounded-full border border-petal bg-card">
                <Icon name={icons.mic} size={20} color={colors.plum} />
              </View>
            </Pressable>
          )}
        </View>
      ) : (
        <SpeakRow
          key={takeId}
          takeId={takeId}
          busy={busy}
          onType={() => setMode("type")}
          onSent={() => setTakeId(randomUUID())}
          onSendSpoken={onSendSpoken}
        />
      )}
      <Text className="text-center font-dm text-[11px] leading-[16px] text-mauve">{copy.scholar.aiLine}</Text>
    </View>
  );
}

type SpeakRowProps = {
  takeId: string;
  busy: boolean;
  onType: () => void;
  onSent: () => void;
  onSendSpoken: (take: SpokenTake) => SpokenSend;
};

// One take, from the first tap to its send. The recorder is New Entry's as it is; the take stops at two minutes here (the
// recorder's own limit is New Entry's five), with a warning at 1:45. A take under a second is thrown away.
function SpeakRow({ takeId, busy, onType, onSent, onSendSpoken }: SpeakRowProps) {
  const recorder = useRecorder(chatRecordingId(takeId));
  const { state, durationMs, levels, error, stop, start, discard, recording: kept } = recorder;
  const recording = state === "recording";
  const paused = state === "paused";
  const recorded = state === "recorded";
  const requesting = state === "requesting";
  const [sending, setSending] = useState(false);

  // The recorder's two taps, as in New Entry: light when a take starts, firmer when it stops.
  const previousState = useRef(state);
  useEffect(() => {
    if (previousState.current !== "recording" && state === "recording") haptics.light();
    if ((previousState.current === "recording" || previousState.current === "paused") && state === "recorded") {
      haptics.medium();
    }
    previousState.current = state;
  }, [state]);

  // At two minutes the take stops and waits as "Ready to send".
  useEffect(() => {
    if (state === "recording" && durationMs >= SCHOLAR_MAX_SPOKEN_MS) void stop();
  }, [state, durationMs, stop]);

  const shownMs = Math.floor(Math.min(durationMs, SCHOLAR_MAX_SPOKEN_MS) / 1000) * 1000;
  const elapsed = formatTimer(shownMs);
  const status = paused
    ? copy.scholar.speak.paused
    : recorded
      ? copy.scholar.speak.ready
      : recording && durationMs >= SCHOLAR_SPOKEN_WARNING_MS
        ? copy.scholar.speak.warning
        : recording
          ? copy.scholar.speak.listening
          : null;
  useAnnounce(error ? copy.scholar.speak.startFailed : status);

  async function send() {
    if (busy || sending) return;
    setSending(true);
    try {
      const take = recorded ? kept : await stop();
      if (take === null) return;
      const outcome = onSendSpoken({ messageId: takeId, uri: take.uri, durationMs: take.durationMs });
      if (outcome === "too_short") await discard();
      else if (outcome === "sent") onSent();
    } finally {
      setSending(false);
    }
  }

  if (state === "denied") {
    return (
      <View className="gap-2">
        <Text accessibilityLiveRegion="polite" className="text-body-sm text-ink">
          {copy.scholar.speak.micOff}
        </Text>
        <View className="flex-row flex-wrap items-center gap-x-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.speak.openSettings}
            onPress={() => Linking.openSettings().catch(() => undefined)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 justify-center">
              <Text className="text-label-lg text-plum">{copy.scholar.speak.openSettings}</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.a11y.type}
            onPress={onType}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 flex-row items-center gap-1.5">
              <Icon name={icons.keyboard} size={18} color={colors.plum} />
              <Text className="text-label-lg text-plum">{copy.scholar.a11y.type}</Text>
            </View>
          </Pressable>
        </View>
      </View>
    );
  }

  if (recording || paused || recorded) {
    return (
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.a11y.discardRecording}
            disabled={sending}
            onPress={() => void discard()}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="size-11 items-center justify-center rounded-full border border-petal bg-card">
              <Icon name={icons.close} size={18} color={colors.ink} />
            </View>
          </Pressable>
          <View
            accessible
            accessibilityLabel={copy.scholar.a11y.recording(formatDurationSpoken(shownMs))}
            className="flex-1 flex-row items-center gap-2"
          >
            {recording ? <View className="size-2 rounded-full bg-crisis" /> : null}
            <Text className="text-label-md text-ink" style={styles.timer}>
              {elapsed}
            </Text>
            <Waveform levels={levels} active={recording} size="compact" />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.a11y.sendRecording(Math.round(shownMs / 1000))}
            accessibilityState={{ disabled: busy, busy: sending }}
            disabled={busy || sending}
            onPress={() => void send()}
            style={({ pressed }) => [busy && styles.disabled, pressed && styles.pressed]}
          >
            <View className="size-12 items-center justify-center rounded-full bg-plum">
              {sending ? (
                <ActivityIndicator size="small" color={colors.card} />
              ) : (
                <Icon name={icons.send} size={22} color={colors.card} />
              )}
            </View>
          </Pressable>
        </View>
        {status !== null ? (
          <Text
            accessibilityLiveRegion="polite"
            className={
              recording && durationMs >= SCHOLAR_SPOKEN_WARNING_MS
                ? "text-center text-body-sm text-rosewood"
                : "text-center text-body-sm text-mauve"
            }
          >
            {status}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.scholar.a11y.type}
          onPress={onType}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-11 items-center justify-center rounded-full border border-petal bg-card">
            <Icon name={icons.keyboard} size={20} color={colors.plum} />
          </View>
        </Pressable>
        <Text className="flex-1 text-center text-body text-mauve">{copy.scholar.speak.tap}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.scholar.a11y.speak}
          accessibilityState={{ disabled: busy || requesting }}
          disabled={busy || requesting}
          onPress={() => void start()}
          style={({ pressed }) => [(busy || requesting) && styles.disabled, pressed && styles.pressed]}
        >
          <View className="size-12 items-center justify-center rounded-full bg-plum">
            <Icon name={icons.mic} size={22} color={colors.card} />
          </View>
        </Pressable>
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-rosewood">
          {copy.scholar.speak.startFailed}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 44, maxHeight: 120, paddingTop: 11, paddingBottom: 11 },
  timer: { fontVariant: ["tabular-nums"] },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
