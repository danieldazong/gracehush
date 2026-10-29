import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/GlassSurface";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, layout, shadows } from "@/constants/theme";
import type { RootStackScreenProps } from "@/navigation/types";

// The pen's filled glyph, in the mic's style. iOS has it from 18.4 (SF Symbols 6.3); the app supports iOS 16.4, and
// iOS draws nothing for a symbol it lacks, so an older iPhone keeps the outline compose glyph. Android's Material
// Symbols are outline only, so its pen and mic already match.
function hasFilledPenGlyph(): boolean {
  if (Platform.OS !== "ios") {
    return false;
  }
  const [major = 0, minor = 0] = String(Platform.Version).split(".").map(Number);
  return major > 18 || (major === 18 && minor >= 4);
}

const penGlyph = hasFilledPenGlyph() ? "long.text.page.and.pencil.fill" : "square.and.pencil";

const icons = {
  pen: { android: "edit_note", ios: penGlyph },
  mic: { android: "mic", ios: "mic.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

// Rendered once, inside the tab bar, so it stays mounted while the tabs change. Its position is
// relative to the bar, so it follows the bar's real height and the bottom inset.
export function FloatingInputDock() {
  // Inside the tab bar, the navigation object is the one of the MainTabs route.
  const navigation = useNavigation<RootStackScreenProps<"MainTabs">["navigation"]>();
  const isFocused = useIsFocused();
  // Blocks a second tap before NewEntry has taken focus. It resets when the tabs are focused again.
  const opening = useRef(false);

  useEffect(() => {
    if (isFocused) {
      opening.current = false;
    }
  }, [isFocused]);

  function open(mode: "speak" | "write") {
    if (opening.current) {
      return;
    }
    opening.current = true;
    navigation.navigate("NewEntry", { mode });
  }

  // box-none: the empty space around the two buttons stays tappable for the screen underneath.
  // The two buttons are one size with one icon style: the mic is the solid plum one, the main action, and the pen
  // wears the tab bar's glass, rim and halo. They stand in a column at the right edge, the pen above the mic, so the
  // space above the tab bar stays clear and the mic stays nearest the thumb, between the glass pen and the glass bar.
  return (
    <View pointerEvents="box-none" className="flex-col items-center gap-2" style={styles.dock}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.dock.write}
        onPress={() => open("write")}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="items-center justify-center" style={styles.button}>
          <GlassSurface material="bar" />
          <View className="absolute inset-0 rounded-full border border-white/80" style={shadows.glass} />
          <Icon name={icons.pen} size={26} color={colors.plum} />
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.dock.speak}
        onPress={() => open("speak")}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View
          className="items-center justify-center rounded-full bg-plum"
          style={[styles.button, shadows.orb]}
        >
          <Icon name={icons.mic} size={26} color="white" />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    right: layout.screenPadding,
    bottom: "100%",
    marginBottom: layout.dockOffset,
  },
  button: { width: layout.dockOrb, height: layout.dockOrb },
  pressed: { transform: [{ scale: 0.96 }] },
});
