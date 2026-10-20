import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, layout, shadows } from "@/constants/theme";
import type { RootStackScreenProps } from "@/navigation/types";

const icons = {
  pen: { android: "edit_note", ios: "square.and.pencil" },
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
  return (
    <View pointerEvents="box-none" className="flex-row items-end gap-2" style={styles.dock}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.dock.write}
        onPress={() => open("write")}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View
          className="items-center justify-center rounded-full border border-petal bg-card"
          style={[styles.pen, shadows.card]}
        >
          <Icon name={icons.pen} size={20} color={colors.plumDeep} />
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
          style={[styles.orb, shadows.orb]}
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
  pen: { width: layout.dockPen, height: layout.dockPen },
  orb: { width: layout.dockOrb, height: layout.dockOrb },
  pressed: { transform: [{ scale: 0.96 }] },
});
