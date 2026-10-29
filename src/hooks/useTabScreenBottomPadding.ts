import { useSafeAreaInsets } from "react-native-safe-area-context";

import { layout } from "@/constants/theme";

// Since step 08b the tab bar is a capsule that floats over the scenes and takes no space of its own, so a tab
// screen's content runs under it. This is the distance from a scene's bottom edge to the capsule's top edge: the
// bottom inset, the gap under the capsule and the capsule itself. (The lens over the active tab overhangs the
// capsule by a few dp; the dock's gap above the capsule clears that.)
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + layout.tabBarBottom + layout.tabBarHeight;
}

// What a tab screen's scrolling content leaves at its end: the floating bar, the dock above it, and the space the
// last control keeps from the dock. A hook, so that one place changes if a later step adds a persistent mini
// player above the bar.
export function useTabScreenBottomPadding(): number {
  return useTabBarClearance() + layout.dockClearance;
}
