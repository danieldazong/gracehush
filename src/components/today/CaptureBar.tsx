import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { VoiceOrb } from "@/components/scholar/VoiceOrb";
import { copy } from "@/constants/copy";
import { penIcon } from "@/constants/icons";
import { colors, shadows } from "@/constants/theme";

const icons = {
  mic: { android: "mic", ios: "mic.fill" },
  pen: penIcon,
} satisfies Record<string, SymbolViewProps["name"]>;

// The compact way in for a person who already has reflections (2026-11-16): the same living orb as the new person's hero at
// 56 wide, the question New Entry asks, and a pen for writing, in one 80-tall bar, so the action is always one tap away
// without taking the first screen. The orb and the pen's circle are one size (56, the size of the floating dock's pair,
// 2026-11-17) with one glyph size (26): the orb is the main action by its colour and its motion, not by being bigger.
// The orb is drawn only while the tab is in front. Its soft glow overflows the bar on purpose (the card does not clip).
const ORB = 56;
const GLYPH = 26;

type CaptureBarProps = {
  active: boolean;
  onSpeak: () => void;
  onWrite: () => void;
};

export function CaptureBar({ active, onSpeak, onWrite }: CaptureBarProps) {
  const { hero } = copy.today;
  return (
    <View className="card min-h-[80px] flex-row items-center gap-3 px-3 py-3" style={shadows.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hero.speakLabel}
        accessibilityHint={hero.speakHint}
        onPress={onSpeak}
        // A Pressable cannot take a className with a style function (Styling Rules), so its share of the row is a style.
        style={({ pressed }) => [styles.grow, pressed && styles.pressed]}
      >
        <View className="flex-row items-center gap-3">
          <View className="items-center justify-center" style={styles.orbArea}>
            {active ? <VoiceOrb size={ORB} state="listening" agentTrack={null} micTrack={null} /> : null}
            <View pointerEvents="none" className="items-center justify-center" style={styles.glyph}>
              <Icon name={icons.mic} size={GLYPH} color="white" />
            </View>
          </View>
          <Text className="flex-1 font-fraunces-medium text-[18px] leading-[24px] text-plum-deep">
            {hero.title}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hero.writeLabel}
        accessibilityHint={hero.writeHint}
        onPress={onWrite}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View
          className="items-center justify-center rounded-full border border-petal bg-linen"
          style={styles.orbArea}
        >
          <Icon name={icons.pen} size={GLYPH} color={colors.plum} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  orbArea: { width: ORB, height: ORB },
  glyph: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
