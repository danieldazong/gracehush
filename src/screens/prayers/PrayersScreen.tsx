import { useScrollToTop } from "@react-navigation/native";
import { useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ScreenHeader";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import { useTabScreenBottomPadding } from "@/hooks/useTabScreenBottomPadding";

// TEMP: replaced in step 14
export function PrayersScreen() {
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const paddingBottom = useTabScreenBottomPadding();

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScreenHeader title={copy.tabs.prayers} />
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, { paddingBottom }]}>
        <View className="screen__content items-center">
          <Text className="text-center text-body text-ink">Prayers — built in step 14</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  content: { flexGrow: 1, justifyContent: "center" },
});
