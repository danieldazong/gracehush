import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import type { RootStackScreenProps } from "@/navigation/types";

const icons = {
  close: { android: "close", ios: "xmark" },
} satisfies Record<string, SymbolViewProps["name"]>;

// TEMP: replaced in step 16
export function PaywallScreen({ navigation, route }: RootStackScreenProps<"Paywall">) {
  return (
    <SafeAreaView style={styles.screen}>
      <View className="screen__content h-14 flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.common.close}
          onPress={() => navigation.goBack()}
        >
          <View className="size-11 items-center justify-center">
            <Icon name={icons.close} size={24} color={colors.ink} />
          </View>
        </Pressable>
      </View>
      <View className="flex-1 items-center justify-center">
        <Text className="text-body text-ink">Paywall ({route.params.source}) — built in step 16</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
});
