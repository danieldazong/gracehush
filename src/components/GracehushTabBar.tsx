import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { CommonActions } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { FloatingInputDock } from "@/components/FloatingInputDock";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, layout } from "@/constants/theme";
import type { MainTabParamList } from "@/navigation/types";
import { haptics } from "@/services/haptics";

// The two colored layers cross-fade when a tab is selected or deselected.
const FADE_MS = 150;

type TabConfig = {
  label: string;
  icon: SymbolViewProps["name"];
  // iOS shows the filled symbol for the selected tab. Android's SymbolView has no fill option, so the
  // same glyph is shown there and only the color changes.
  activeIcon: SymbolViewProps["name"];
};

const tabs: Record<keyof MainTabParamList, TabConfig> = {
  Journal: {
    label: copy.tabs.journal,
    icon: { android: "menu_book", ios: "book" },
    activeIcon: { android: "menu_book", ios: "book.fill" },
  },
  Prayers: {
    label: copy.tabs.prayers,
    icon: { android: "volunteer_activism", ios: "hands.sparkles" },
    activeIcon: { android: "volunteer_activism", ios: "hands.sparkles.fill" },
  },
  Profile: {
    label: copy.tabs.profile,
    icon: { android: "person", ios: "person" },
    activeIcon: { android: "person", ios: "person.fill" },
  },
};

type TabItemProps = TabConfig & {
  accessibilityLabel: string;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
};

// Two layers share one box, so nothing shifts: the inactive one (mauve, Medium) and the active one
// (plum, SemiBold). The Pressable is the only accessibility element; the layers are decorative.
function TabItem({
  label,
  icon,
  activeIcon,
  accessibilityLabel,
  focused,
  onPress,
  onLongPress,
}: TabItemProps) {
  const [progress] = useState(() => new Animated.Value(focused ? 1 : 0));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [focused, progress]);

  const inactiveOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <View
        className="min-w-14 flex-1 items-center justify-center"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.View style={[styles.layer, { opacity: inactiveOpacity }]}>
          <Icon name={icon} size={22} color={colors.mauve} />
          <Text
            className="font-dm-medium text-[11px] leading-[11px] text-mauve"
            maxFontSizeMultiplier={1.3}
          >
            {label}
          </Text>
        </Animated.View>
        <Animated.View style={[styles.layer, StyleSheet.absoluteFill, { opacity: progress }]}>
          <Icon name={activeIcon} size={22} color={colors.plum} />
          <Text
            className="font-dm-semibold text-[11px] leading-[11px] text-plum"
            maxFontSizeMultiplier={1.3}
          >
            {label}
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

export function GracehushTabBar({ state, navigation, insets }: BottomTabBarProps) {
  // The dock sits above the bar through a percentage offset, and Yoga resolves that against the
  // parent's content box. So the outer view has no padding or border (its content box is the whole
  // bar), and the visible bar, with the border and the bottom inset, is the inner view. Nothing here
  // sets overflow: "hidden", because the dock extends above the bar.
  return (
    <View>
      <View className="border-t border-petal bg-linen" style={{ paddingBottom: insets.bottom }}>
        {/* Each item stretches to the row's height, so the whole 64 is its touch area. */}
        <View
          accessibilityRole="tablist"
          className="flex-row justify-around px-4"
          style={styles.row}
        >
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            // MainTabs registers exactly the routes of MainTabParamList.
            const tab = tabs[route.name as keyof MainTabParamList];

            // The same contract as React Navigation's own bar, so useScrollToTop keeps working.
            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                haptics.selection();
                navigation.dispatch({
                  ...CommonActions.navigate(route.name, route.params),
                  target: state.key,
                });
              }
            };
            const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });

            return (
              <TabItem
                key={route.key}
                {...tab}
                accessibilityLabel={
                  Platform.OS === "ios"
                    ? copy.tabs.a11yLabel(tab.label, index + 1, state.routes.length)
                    : tab.label
                }
                focused={focused}
                onPress={onPress}
                onLongPress={onLongPress}
              />
            );
          })}
        </View>
      </View>
      <FloatingInputDock />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: layout.tabBarHeight },
  layer: { alignItems: "center", justifyContent: "center", gap: 4 },
  pressed: { opacity: 0.6 },
});
