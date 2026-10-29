import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { CommonActions } from "@react-navigation/native";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { FloatingInputDock } from "@/components/FloatingInputDock";
import { GlassSurface } from "@/components/GlassSurface";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, layout, shadows } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import type { MainTabParamList } from "@/navigation/types";
import { haptics } from "@/services/haptics";

// The two colored layers of a tab cross-fade when it is selected or deselected, and the selected one grows a little
// inside the lens.
const FADE_MS = 150;
const ACTIVE_SCALE = 1.06;
// The lens travels on a spring that settles in about 450 ms with a soft overshoot (a damping ratio of 0.61, so
// about 9% past the target, one wobble). On the way it stretches sideways and flattens, like a drop that keeps its
// mass, and the more the farther it goes: 1.08 wide and 0.95 tall for one tab over, 1.14 and 0.92 for two.
const LENS_SPRING = { stiffness: 220, damping: 18, mass: 1 } as const;
const LENS_STRETCH = 1.08;
const LENS_STRETCH_PER_TAB = 0.06;
const LENS_SQUASH = 0.95;
const LENS_SQUASH_PER_TAB = 0.03;
const LENS_STRETCH_MS = 160;

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

// Where the lens sits over a tab: the capsule's padding and the lens's own inset, then one tab width for every tab
// before it.
function lensOffset(index: number, itemWidth: number): number {
  return layout.tabPillPadding + layout.tabLensInset + index * itemWidth;
}

type TabItemProps = TabConfig & {
  width: number;
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
  width,
  accessibilityLabel,
  focused,
  onPress,
  onLongPress,
}: TabItemProps) {
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(focused ? 1 : 0));
  const [scale] = useState(() => new Animated.Value(focused ? ACTIVE_SCALE : 1));

  useEffect(() => {
    const toProgress = focused ? 1 : 0;
    const toScale = focused ? ACTIVE_SCALE : 1;
    if (reduceMotion) {
      progress.setValue(toProgress);
      scale.setValue(toScale);
      return undefined;
    }
    const animation = Animated.parallel([
      Animated.timing(progress, { toValue: toProgress, duration: FADE_MS, useNativeDriver: true }),
      Animated.timing(scale, { toValue: toScale, duration: FADE_MS, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [focused, reduceMotion, progress, scale]);

  const inactiveOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.item, { width }, pressed && styles.pressed]}
    >
      <Animated.View
        style={[styles.itemContent, { transform: [{ scale }] }]}
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
      </Animated.View>
    </Pressable>
  );
}

// A floating capsule as wide as the cards, centered above the bottom inset, with a lens that slides over the active
// tab (step 08b). The bar is absolutely positioned, so it takes none of the scenes' space and the content runs
// under it: every tab screen keeps its end clear through useTabScreenBottomPadding().
export function GracehushTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const reduceMotion = useReduceMotion();
  const { width: windowWidth } = useWindowDimensions();
  // The capsule spans the content width, like the cards (20 from each edge, 16 on a narrow screen), and the tabs
  // share what is left inside its padding.
  const sidePadding =
    windowWidth < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;
  const capsuleWidth = windowWidth - sidePadding * 2;
  const itemWidth = (capsuleWidth - layout.tabPillPadding * 2) / state.routes.length;

  const [lensX] = useState(() => new Animated.Value(lensOffset(state.index, itemWidth)));
  const [lensStretch] = useState(() => new Animated.Value(1));
  const [lensSquash] = useState(() => new Animated.Value(1));
  // The tab the lens last moved to. Read and written only inside the effect below, so a run that changes no tab
  // (the mount, a width change, or Reduce Motion switching) puts the lens where it belongs with no motion.
  const lensIndex = useRef(state.index);

  useEffect(() => {
    const toValue = lensOffset(state.index, itemWidth);
    const from = lensIndex.current;
    if (from === state.index) {
      lensX.setValue(toValue);
      return undefined;
    }
    lensIndex.current = state.index;
    if (reduceMotion) {
      lensX.setValue(toValue);
      lensStretch.setValue(1);
      lensSquash.setValue(1);
      return undefined;
    }
    const tabsAway = Math.abs(state.index - from);
    const stretch = LENS_STRETCH + LENS_STRETCH_PER_TAB * (tabsAway - 1);
    const squash = LENS_SQUASH - LENS_SQUASH_PER_TAB * (tabsAway - 1);
    const easing = Easing.out(Easing.quad);
    const animation = Animated.parallel([
      Animated.spring(lensX, { toValue, ...LENS_SPRING, useNativeDriver: true }),
      Animated.sequence([
        Animated.parallel([
          Animated.timing(lensStretch, {
            toValue: stretch,
            duration: LENS_STRETCH_MS,
            easing,
            useNativeDriver: true,
          }),
          Animated.timing(lensSquash, {
            toValue: squash,
            duration: LENS_STRETCH_MS,
            easing,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.spring(lensStretch, { toValue: 1, ...LENS_SPRING, useNativeDriver: true }),
          Animated.spring(lensSquash, { toValue: 1, ...LENS_SPRING, useNativeDriver: true }),
        ]),
      ]),
    ]);
    animation.start();
    // A tab chosen mid-flight stops this one where it is, and the next spring starts from there.
    return () => animation.stop();
  }, [state.index, itemWidth, reduceMotion, lensX, lensStretch, lensSquash]);

  // One absolute layer over the scenes, with the capsule centered in it and the dock beside the capsule. The layer
  // has no padding or border, so the dock's percentage offset resolves against the capsule's height (see the vendor
  // note on percentage offsets). box-none: the strip beside the capsule stays the screen's.
  return (
    <View pointerEvents="box-none" style={[styles.overlay, { bottom: insets.bottom + layout.tabBarBottom }]}>
      <View style={[styles.capsule, { width: capsuleWidth }]}>
        {/* The material, its rim, then the lens, then the tabs. The first three are decoration and take no touch;
            a touch on the capsule's padding ends at the capsule and never reaches the screen under it. */}
        <GlassSurface material="bar" />
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute inset-0 rounded-full border border-white/80"
          style={shadows.glass}
        />
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.lens,
            {
              width: itemWidth - layout.tabLensInset * 2,
              transform: [{ translateX: lensX }, { scaleX: lensStretch }, { scaleY: lensSquash }],
            },
          ]}
        >
          <GlassSurface material="lens" />
          <View className="absolute inset-0 rounded-full border border-white/90" style={shadows.lens} />
        </Animated.View>
        {/* Each item is a whole tab wide and the capsule's whole height, so all of it is its touch area. */}
        <View accessibilityRole="tablist" className="flex-row" style={styles.row}>
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
                width={itemWidth}
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
  overlay: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  capsule: { height: layout.tabBarHeight },
  row: { height: layout.tabBarHeight, paddingHorizontal: layout.tabPillPadding },
  // Inside the capsule, inset from its top and bottom edges (and from its tab's sides, through the width above).
  lens: {
    position: "absolute",
    top: layout.tabLensInset,
    left: 0,
    height: layout.tabBarHeight - layout.tabLensInset * 2,
  },
  item: { height: layout.tabBarHeight },
  itemContent: { flex: 1, alignItems: "center", justifyContent: "center" },
  layer: { alignItems: "center", justifyContent: "center", gap: 4 },
  // The tab under the finger dims and squashes a little, like the dock's buttons.
  pressed: { opacity: 0.6, transform: [{ scale: 0.96 }] },
});
