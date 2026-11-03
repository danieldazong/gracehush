import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";

const text = copy.deleteReflection;
const trash = { android: "delete", ios: "trash" } satisfies SymbolViewProps["name"];

type DeleteReflectionLinkProps = {
  onPress: () => void;
  // True after a tap with no connection: the calm line says a delete needs one (nothing is queued for later).
  offline: boolean;
};

// The quiet "Delete reflection" link at the very end of a reflection (step 29b): mauve, never red, a 44-dp target, and it
// asks before deleting (the shared dialog). Reflection's ready view has it, and since 2026-11-01 the crisis view too: one
// component, so the two are the same link.
export function DeleteReflectionLink({ onPress, offline }: DeleteReflectionLinkProps) {
  return (
    <View className="items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.linkLabel}
        accessibilityHint={text.linkHint}
        onPress={onPress}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="min-h-11 flex-row items-center gap-1.5 px-4">
          <Icon name={trash} size={16} color={colors.mauve} />
          <Text className="btn-text__label text-mauve">{text.link}</Text>
        </View>
      </Pressable>
      {offline ? (
        <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-mauve">
          {text.offline}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
