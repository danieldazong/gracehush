import { useScrollToTop } from "@react-navigation/native";
import { useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DevToolsPanel } from "@/components/dev/DevToolsPanel";
import { ScreenHeader } from "@/components/ScreenHeader";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import { useTabScreenBottomPadding } from "@/hooks/useTabScreenBottomPadding";

// TEMP: replaced in step 15
export function ProfileScreen() {
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const paddingBottom = useTabScreenBottomPadding();

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScreenHeader title={copy.tabs.profile} avatar="static" />
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom }}>
        <View className="screen__content gap-8 pt-12">
          <Text className="text-center text-body text-ink">Profile — built in step 15</Text>
          <DevToolsPanel />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
});
