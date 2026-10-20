import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { emotionColors, layout } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";

const FADE_MS = 200;

const icons = {
  check: { android: "check", ios: "checkmark" },
} satisfies Record<string, SymbolViewProps["name"]>;

type ToastProps = {
  message: string;
  visible: boolean;
};

// A short confirmation that floats above the input dock. The screen owns the timer that keeps
// `visible` true. It disappears on its own, so it announces itself: a live region on Android and
// announceForAccessibility on iOS.
export function Toast({ message, visible }: ToastProps) {
  const [opacity] = useState(() => new Animated.Value(0));
  // Mounted from the moment `visible` turns true until the fade-out ends. An Android live region
  // announces content that appears, not an opacity change, so nothing is rendered the rest of the time.
  const [mounted, setMounted] = useState(visible);

  if (visible && !mounted) {
    setMounted(true);
  }

  useAnnounce(visible ? message : null);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
  }, [mounted, visible, opacity]);

  if (!mounted) {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.anchor}>
      <Animated.View
        accessible
        accessibilityLabel={message}
        accessibilityLiveRegion="polite"
        style={{ opacity }}
      >
        <View className="flex-row items-center gap-2 rounded-full border border-sage/30 bg-grateful-bg px-4 py-2.5">
          <Icon name={icons.check} size={14} color={emotionColors.grateful.fg} />
          <Text className="text-label-md text-grateful-fg">{message}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Clears the dock: its top edge is dockOffset + dockOrb above the bar, and this adds 12.
  anchor: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: layout.dockOffset + layout.dockOrb + 12,
    alignItems: "center",
  },
});
