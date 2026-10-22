import type { SymbolViewProps } from "expo-symbols";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CrisisContactList } from "@/components/crisis/CrisisContactList";
import { CrisisFallbackSheet } from "@/components/crisis/CrisisFallbackSheet";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import {
  CRISIS_GROUPS,
  CRISIS_RESOURCES,
  CRISIS_RESOURCES_LAST_VERIFIED,
} from "@/constants/crisisResources";
import { colors, layout } from "@/constants/theme";
import { useCrisisActions } from "@/hooks/useCrisisActions";
import type { RootStackScreenProps } from "@/navigation/types";
import { formatCalendarDate } from "@/utils/format";

const { resources } = copy.crisis;

const icons = {
  close: { android: "close", ios: "xmark" },
} satisfies Record<string, SymbolViewProps["name"]>;

// Every way to reach help, in two grouped lists: the three 988 ways (call, text, chat) sit together under the
// service's name. It fetches nothing, so it opens offline, and only a web row needs a connection. No
// animation, haptic or sound, and nothing here is logged.
export function CrisisResourcesScreen({ navigation }: RootStackScreenProps<"CrisisResources">) {
  const { width } = useWindowDimensions();
  const { fallback, fallbackVisible, run, closeFallback } = useCrisisActions();

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View className="border-b border-petal">
        <View className="screen__content min-h-14 flex-row items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={resources.close}
            onPress={() => navigation.goBack()}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="size-11 items-center justify-center">
              <Icon name={icons.close} size={22} color={colors.ink} />
            </View>
          </Pressable>
          <Text
            accessibilityRole="header"
            className="flex-1 text-center text-section text-plum-deep"
          >
            {resources.title}
          </Text>
          <View className="size-11" />
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal:
              width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding,
          },
        ]}
      >
        <Text className="text-body text-mauve">{resources.intro}</Text>
        {CRISIS_GROUPS.map((group) => (
          <View key={group.id} className="gap-2">
            <Text accessibilityRole="header" className="eyebrow px-1">
              {group.title}
            </Text>
            <CrisisContactList
              grouped
              resources={CRISIS_RESOURCES.filter((resource) => resource.group === group.id)}
              onPress={run}
            />
          </View>
        ))}
        <Text className="text-center text-body-sm text-mauve">
          {resources.footer(formatCalendarDate(CRISIS_RESOURCES_LAST_VERIFIED))}
        </Text>
      </ScrollView>
      <CrisisFallbackSheet fallback={fallback} visible={fallbackVisible} onClose={closeFallback} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  content: { gap: 20, paddingTop: 16, paddingBottom: 32 },
  pressed: { opacity: 0.7 },
});
