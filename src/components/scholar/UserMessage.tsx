import { Pressable, StyleSheet, Text, View } from "react-native";

import { copy } from "@/constants/copy";
import type { ScholarMessage } from "@/types";
import { messageText, type FailureKind } from "@/utils/scholarRows";

type UserMessageProps = {
  message: ScholarMessage;
  // How a message that got no answer is drawn (utils/scholarRows.ts), or null.
  failure: FailureKind | null;
  onRetry: () => void;
  // A turn is in flight: one at a time, so "Try again" waits.
  retryDisabled: boolean;
};

// The person's message (step 38): right-aligned, at most 85% wide, on linen-deep. A spoken one says it was transcribed, and reads
// "Voice message" until its words arrive. A message that got no answer carries its way to try again under the same id.
export function UserMessage({ message, failure, onRetry, retryDisabled }: UserMessageProps) {
  const text = messageText(message);
  const spoken = message.inputType === "audio";
  return (
    <View className="items-end gap-1">
      <View
        accessible
        accessibilityLabel={`${copy.scholar.a11y.message}: ${text.length > 0 ? text : copy.scholar.speak.voiceMessage}`}
        className="max-w-[85%] rounded-card border border-petal bg-linen-deep px-4 py-3"
      >
        {text.length > 0 ? (
          <Text className="text-body text-ink">{text}</Text>
        ) : (
          <Text className="text-body text-mauve">{copy.scholar.speak.voiceMessage}</Text>
        )}
        {spoken && text.length > 0 ? (
          <Text className="mt-1 text-body-sm text-mauve">{copy.scholar.speak.transcribed}</Text>
        ) : null}
      </View>
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
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
