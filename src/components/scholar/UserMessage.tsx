import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FadeIn } from "@/components/FadeIn";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, radii } from "@/constants/theme";
import type { ScholarMessage } from "@/types";
import { messageText, type FailureKind } from "@/utils/scholarRows";

const icons = {
  voice: { android: "graphic_eq", ios: "waveform" },
  mic: { android: "mic", ios: "mic.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

type UserMessageProps = {
  message: ScholarMessage;
  // How a message that got no answer is drawn (utils/scholarRows.ts), or null.
  failure: FailureKind | null;
  onRetry: () => void;
  // A turn is in flight: one at a time, so "Try again" waits.
  retryDisabled: boolean;
  // The message was sent during this visit: it fades in (150 ms, rising 8). An older one is simply there, so scrolling a long
  // conversation never replays an arrival.
  animate: boolean;
};

// The person's message (step 38, restyled 2026-11-15): a plum bubble with white text, right-aligned and at most 80% wide, round on
// three corners and small on the bottom-right one. Plum against Scholar's answer on the bare page is what tells the two voices
// apart at a glance. A spoken message reads "Voice message" until its words arrive, and says it was transcribed in a caption
// under the bubble, not inside it. A message that got no answer carries its way to try again under the same id.
export function UserMessage({ message, failure, onRetry, retryDisabled, animate }: UserMessageProps) {
  const text = messageText(message);
  const spoken = message.inputType === "audio";
  const content = (
    <View className="items-end gap-1">
      <View
        accessible
        accessibilityLabel={`${copy.scholar.a11y.message}: ${text.length > 0 ? text : copy.scholar.speak.voiceMessage}`}
        className="max-w-[80%] bg-plum px-4 py-3"
        style={styles.bubble}
      >
        {text.length > 0 ? (
          <Text className="text-body text-white">{text}</Text>
        ) : (
          <View className="flex-row items-center gap-2">
            <Icon name={icons.voice} size={16} color={`${colors.card}D9`} />
            <Text className="text-body text-white/85">{copy.scholar.speak.voiceMessage}</Text>
          </View>
        )}
      </View>
      {spoken && text.length > 0 ? (
        <View className="flex-row items-center gap-1">
          <Icon name={icons.mic} size={12} color={colors.mauve} />
          <Text className="text-body-sm text-mauve">{copy.scholar.speak.transcribed}</Text>
        </View>
      ) : null}
      {failure === null || failure === "none" ? null : (
        <View className="flex-row flex-wrap items-center justify-end gap-x-2">
          {failure === "generic" ? <Text className="text-body-sm text-mauve">{copy.scholar.failed}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.tryAgain}
            accessibilityState={{ disabled: retryDisabled }}
            disabled={retryDisabled}
            onPress={onRetry}
            style={({ pressed }) => [retryDisabled && styles.disabled, pressed && styles.pressed]}
          >
            <View className="min-h-11 justify-center px-2">
              <Text className="text-label-lg text-plum">{copy.scholar.tryAgain}</Text>
            </View>
          </Pressable>
        </View>
      )}
    </View>
  );
  return animate ? (
    <FadeIn rise={8} duration={150}>
      {content}
    </FadeIn>
  ) : (
    content
  );
}

// Asymmetric corners are a style, as BottomSheet's top corners are (Style Exception Rules).
const styles = StyleSheet.create({
  bubble: {
    borderTopLeftRadius: radii.bubble,
    borderTopRightRadius: radii.bubble,
    borderBottomLeftRadius: radii.bubble,
    borderBottomRightRadius: radii.bubbleTail,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
