import { Pressable, StyleSheet, Text, View } from "react-native";

import { HelpLine } from "@/components/HelpLine";
import type { HelpKind } from "@/types";

type ConversationNoticeProps = {
  text: string;
  // One quiet action beside the words ("See plans").
  action?: { label: string; onPress: () => void };
  // In a heavy conversation the help line stays under a notice (the rate limit).
  help?: HelpKind | null;
  // A second line under the words that changes while the notice is up (the credits' countdown, 2026-11-18). It is not a live
  // region, so a screen reader hears the notice once and not every minute; `label` is its spoken form.
  detail?: { text: string; label: string } | null;
};

// One calm line above the composer (step 38): a limit, the rate limit, resting, offline, a recording that could not be heard. A
// polite live region, never red, and never a way to block the composer: a message is always sent, because the server screens it
// first and answers a heavy one whatever the count.
export function ConversationNotice({ text, action, help, detail }: ConversationNoticeProps) {
  return (
    <View className="gap-1 rounded-input border border-petal bg-blush px-4 py-2">
      <View className="flex-row flex-wrap items-center gap-x-3">
        <Text accessibilityLiveRegion="polite" className="min-w-[160px] flex-1 text-body-sm text-ink">
          {text}
        </Text>
        {action !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 justify-center">
              <Text className="text-label-lg text-plum">{action.label}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {detail != null ? (
        <Text accessibilityLabel={detail.label} className="text-body-sm text-mauve">
          {detail.text}
        </Text>
      ) : null}
      {help != null ? <HelpLine kind={help} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
