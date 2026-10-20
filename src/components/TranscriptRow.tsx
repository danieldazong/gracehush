import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { FadeIn } from "@/components/FadeIn";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";

const { words, quote } = copy.reflection;

const TURN_MS = 200;

const icons = {
  lock: { android: "lock", ios: "lock.fill" },
  chevron: { android: "keyboard_arrow_down", ios: "chevron.down" },
} satisfies Record<string, SymbolViewProps["name"]>;

type TranscriptRowProps = {
  // "Your spoken prayer" or "Your written prayer"; step 13 reuses the row with another title.
  title: string;
  transcript: string;
};

// A collapsible row that shows what the user said or wrote. Collapsed by default.
export function TranscriptRow({ title, transcript }: TranscriptRowProps) {
  const reduceMotion = useReduceMotion();
  const [expanded, setExpanded] = useState(false);
  const [turn] = useState(() => new Animated.Value(0));

  // The chevron turns over 200ms, or jumps with Reduce Motion. The effect touches only the animated value.
  useEffect(() => {
    const toValue = expanded ? 1 : 0;
    if (reduceMotion) {
      turn.setValue(toValue);
      return undefined;
    }
    const animation = Animated.timing(turn, { toValue, duration: TURN_MS, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [expanded, reduceMotion, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });

  return (
    <View className="card overflow-hidden p-0">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={words.label(title)}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="flex-row items-center gap-2.5 p-3.5">
          <Icon name={icons.lock} size={19} color={colors.mauve} />
          {/* The group wraps, so the chip drops under the title when the row is too narrow for both. */}
          <View className="flex-1 flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
            <Text className="text-label-lg text-ink">{title}</Text>
            <View className="chip px-2.5">
              <Text className="chip__label">{words.private}</Text>
            </View>
          </View>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Icon name={icons.chevron} size={18} color={colors.mauve} />
          </Animated.View>
        </View>
      </Pressable>
      {expanded ? (
        <View className="px-3.5 pb-3.5">
          <FadeIn>
            <View className="rounded-xl border border-petal bg-linen p-3">
              <Text className="text-scripture text-ink/80">{quote(transcript)}</Text>
            </View>
          </FadeIn>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
