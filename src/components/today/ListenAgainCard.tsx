import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { formatDuration, formatDurationSpoken } from "@/utils/format";

const icons = {
  play: { android: "play_arrow", ios: "play.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

type ListenAgainCardProps = {
  title: string;
  reference: string | null;
  durationMs: number;
  // Loads the devotional, plays it and opens its reflection with the player showing (what a Journal card's play pill does).
  onPlay: () => void;
};

// One quiet row on the Today tab (2026-11-16, slimmed on 2026-11-17 from an 80 dp card to a 60 dp row with a hairline and no
// shadow, so the word card stays the picture and the capture bar the one action): the latest devotional, one tap away. The
// whole row is one button, so a screen reader hears it once. It says "Listen again" and not "Continue": the app does not keep
// where a devotional stopped.
export function ListenAgainCard({ title, reference, durationMs, onPlay }: ListenAgainCardProps) {
  const { listenAgain } = copy.today;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listenAgain.label(title, formatDurationSpoken(durationMs))}
      accessibilityHint={listenAgain.hint}
      onPress={onPlay}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <View className="card min-h-[60px] flex-row items-center gap-3 px-3 py-2.5">
        <View className="size-10 items-center justify-center rounded-full bg-plum">
          <Icon name={icons.play} size={18} color="white" />
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} className="font-fraunces text-[16px] leading-[22px] text-ink">
            {title}
          </Text>
          <Text numberOfLines={1} className="text-body-sm text-mauve">
            <Text className="font-dm-semibold text-rosewood">{listenAgain.eyebrow}</Text>
            {` · ${listenAgain.meta(reference, formatDuration(durationMs))}`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
