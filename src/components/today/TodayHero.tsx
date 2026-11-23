import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { VoiceOrb } from "@/components/scholar/VoiceOrb";
import { copy } from "@/constants/copy";
import { penIcon } from "@/constants/icons";

const icons = {
  mic: { android: "mic", ios: "mic.fill" },
  pen: penIcon,
  scripture: { android: "menu_book", ios: "book" },
  devotional: { android: "headphones", ios: "headphones" },
  affirmations: { android: "notifications", ios: "bell" },
} satisfies Record<string, SymbolViewProps["name"]>;

// The orb is the one big action of a new person's Today tab (2026-11-16): the live talk's voice orb at rest, 104 wide, listening
// (a slow breath, the shape of the shader orb moving a little), with a white microphone on it. It is drawn only while the tab is in
// front: the shader orb draws every frame, and nothing needs to move while the screen is covered. It rests under Reduce Motion
// (the orb's own rule). The glow around it overflows its box and is clipped by the card.
const ORB = 104;
const MIC = 34;

type TodayHeroProps = {
  // The tab is in front: nothing moves while it is not.
  active: boolean;
  onSpeak: () => void;
  onWrite: () => void;
};

// The first card of a new person's Today tab: what to do (the heading), what you get (three icons), and the one way to start
// (the orb), with writing as the quiet second way. It needs no data, so it is drawn at once. A person who already has
// reflections sees the compact capture bar instead.
export function TodayHero({ active, onSpeak, onWrite }: TodayHeroProps) {
  const { hero } = copy.today;
  const gets = [
    { icon: icons.scripture, label: hero.gets.scripture },
    { icon: icons.devotional, label: hero.gets.devotional },
    { icon: icons.affirmations, label: hero.gets.affirmations },
  ] as const;

  return (
    <View className="items-center overflow-hidden rounded-hero bg-plum-deep px-5 pb-3 pt-6">
      <Text
        accessibilityRole="header"
        className="text-center text-headline text-white"
        textBreakStrategy="balanced"
        lineBreakStrategyIOS="push-out"
      >
        {hero.title}
      </Text>
      <View className="mt-4 w-full flex-row gap-2">
        {gets.map((item) => (
          <View key={item.label} className="flex-1 items-center gap-1.5">
            <View className="size-10 items-center justify-center rounded-full bg-white/25">
              <Icon name={item.icon} size={20} color="white" />
            </View>
            <Text className="text-center text-label-md text-white/95">{item.label}</Text>
          </View>
        ))}
      </View>
      <View className="mt-7 items-center justify-center" style={styles.orbArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hero.speakLabel}
          accessibilityHint={hero.speakHint}
          onPress={onSpeak}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="items-center justify-center" style={styles.orbArea}>
            {active ? <VoiceOrb size={ORB} state="listening" agentTrack={null} micTrack={null} /> : null}
            <View pointerEvents="none" className="items-center justify-center" style={styles.glyph}>
              <Icon name={icons.mic} size={MIC} color="white" />
            </View>
          </View>
        </Pressable>
      </View>
      {/* The button already says it; this line is for the eye, so a screen reader skips it. */}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        className="mt-1 font-dm-medium text-[14px] leading-[20px] text-white/90"
      >
        {hero.speak}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hero.writeLabel}
        accessibilityHint={hero.writeHint}
        onPress={onWrite}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="min-h-11 flex-row items-center justify-center gap-1.5 px-4">
          <Icon name={icons.pen} size={16} color="white" />
          <Text className="font-dm-semibold text-[15px] leading-[22px] text-white">{hero.write}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  orbArea: { width: ORB, height: ORB },
  glyph: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
});
