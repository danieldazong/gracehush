import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { GlassSurface } from "@/components/GlassSurface";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, layout, shadows } from "@/constants/theme";

const micIcon = { android: "mic", ios: "mic.fill" } satisfies SymbolViewProps["name"];

type AskBarProps = {
  // Opens a new conversation with the keyboard up.
  onAsk: () => void;
  // Opens it in Speak mode: nothing records until the person taps the mic there.
  onSpeak: () => void;
  style?: StyleProp<ViewStyle>;
};

// The Scholar tab's ask bar (step 38): pinned dockOffset above the floating tab bar in place of the dock, as wide as the cards,
// on the tab bar's own glass, with the plum microphone at its end. Two buttons, never one grouped element.
export function AskBar({ onAsk, onSpeak, style }: AskBarProps) {
  return (
    <View style={[styles.bar, style]}>
      <GlassSurface material="bar" />
      <View pointerEvents="none" className="absolute inset-0 rounded-full border border-white/80" style={shadows.glass} />
      <View className="flex-1 flex-row items-center pl-2 pr-1.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.scholar.a11y.askBar}
          onPress={onAsk}
          style={({ pressed }) => [styles.ask, pressed && styles.pressed]}
        >
          <Text numberOfLines={1} className="text-body text-mauve">
            {copy.scholar.askBar}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.scholar.a11y.askBarSpeak}
          onPress={onSpeak}
          style={({ pressed }) => [styles.mic, pressed && styles.pressed]}
        >
          <Icon name={micIcon} size={22} color={colors.plum} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: layout.askBarHeight, borderRadius: layout.askBarHeight / 2 },
  ask: { flex: 1, height: layout.askBarHeight, justifyContent: "center", paddingHorizontal: 12 },
  mic: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },
});
