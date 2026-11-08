import type { SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { EMERGENCY_NUMBER, HELPLINE_NUMBER } from "@/constants/crisisResources";
import { colors } from "@/constants/theme";
import { openPhoneCall } from "@/services/externalLinks";

const { help } = copy.reflection;

const icons = {
  phone: { android: "call", ios: "phone.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

// The one quiet line a heavy moment's reflection carries, under its devotional (2026-11-08, when Support Resources was removed):
// that the person need not carry this alone, the two numbers, and one tap that calls 988. Calm on purpose: mauve and plum, never
// red, no animation, no haptic, and nothing logged (AGENTS.md Crisis Safety Rules). The phone app asks before it dials.
export function HelpLine() {
  const [failed, setFailed] = useState(false);

  async function call() {
    const result = await openPhoneCall(HELPLINE_NUMBER);
    setFailed(!result.ok);
  }

  return (
    <View className="items-center gap-1 px-2">
      <Text className="text-center text-body-sm text-mauve">{help.line(HELPLINE_NUMBER, EMERGENCY_NUMBER)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={help.callLabel(HELPLINE_NUMBER)}
        accessibilityHint={help.callHint}
        onPress={() => void call()}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="min-h-11 flex-row items-center justify-center gap-1.5 px-3">
          <Icon name={icons.phone} size={16} color={colors.plum} />
          <Text className="text-label-md text-plum">{help.call(HELPLINE_NUMBER)}</Text>
        </View>
      </Pressable>
      {failed ? (
        <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-ink">
          {help.failed(HELPLINE_NUMBER)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
