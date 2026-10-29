import { StyleSheet } from "react-native";

import type { EmotionKey } from "@/types";

export const colors = {
  plum: "#5B3A5E",
  plumDeep: "#3E2741",
  rose: "#D4A5A5",
  rosewood: "#96555D", // darkened from the design's #9E5A62 for AA contrast on blush
  terracotta: "#C4704F",
  sage: "#8FA58A",
  linen: "#FBF7F2",
  linenDeep: "#F1EDE8",
  blush: "#F5ECE8",
  card: "#FFFFFF",
  ink: "#2E2A33",
  mauve: "#6E636D", // darkened from the design's #8A7F88 for AA contrast
  petal: "#EADFDB",
  crisis: "#B4443A",
  // The floating tab bar's glass tint (step 08b follow-up): the Hopeful badge's background, under the name of its
  // role, so the tab bar code does not read as an emotion.
  glass: "#F7E9DF",
} as const;

export type EmotionColors = { bg: string; fg: string };

export const emotionColors: Record<EmotionKey, EmotionColors> = {
  anxious: { bg: "#F3E6EE", fg: "#5B3A5E" },
  weary: { bg: "#F0EAE6", fg: "#6B5D57" },
  grateful: { bg: "#E8EFE6", fg: "#4F6B4A" },
  grieving: { bg: "#ECE6F0", fg: "#4A3B5C" },
  hopeful: { bg: "#F7E9DF", fg: "#9A4F31" },
};

function isEmotionKey(value: string): value is EmotionKey {
  return Object.prototype.hasOwnProperty.call(emotionColors, value);
}

export function getEmotionColors(emotion: string): EmotionColors {
  const key = emotion.toLowerCase();
  return isEmotionKey(key) ? emotionColors[key] : emotionColors.weary;
}

export const fonts = {
  fraunces: "Fraunces_400Regular",
  frauncesMedium: "Fraunces_500Medium",
  frauncesSemibold: "Fraunces_600SemiBold",
  frauncesItalic: "Fraunces_400Regular_Italic",
  dm: "DMSans_400Regular",
  dmMedium: "DMSans_500Medium",
  dmSemibold: "DMSans_600SemiBold",
  dmBold: "DMSans_700Bold",
} as const;

export const radii = {
  sm: 4,
  DEFAULT: 8,
  input: 12,
  card: 16,
  hero: 24,
  sheet: 24,
  full: 9999,
} as const;

export const spacing = {
  screen: 20,
  screenNarrow: 16,
  spaceXl: 40,
} as const;

export const layout = {
  screenPadding: spacing.screen,
  screenPaddingNarrow: spacing.screenNarrow,
  narrowBreakpoint: 360,
  minTouch: 44,
  buttonHeight: 48,
  recordOrb: 84,
  recordHalo: 124,
  // The floating tab bar (step 08b): a capsule as wide as the cards, tabBarHeight tall, that sits tabBarBottom above
  // the bottom inset. The tabs share its width inside tabPillPadding at each end, and the lens over the active tab
  // sits tabLensInset inside the capsule's edges, so it never leaves the capsule.
  tabBarHeight: 64,
  tabBarBottom: 12,
  tabPillPadding: 6,
  tabLensInset: 4,
  // The input dock, dockOffset above the capsule: a column of two dockOrb buttons, the pen above the mic, 8 apart, so
  // dockHeight tall (the fifth step 08b follow-up; until the fourth the pen was 44 and beside the mic). A tab screen's
  // content ends dockClearance above the capsule: the offset, the column and 36 of air.
  dockOffset: 20,
  dockOrb: 56,
  dockHeight: 120,
  dockClearance: 176,
} as const;

export const gradients = {
  brand: { colors: [colors.plum, colors.rose], locations: [0, 1] },
} as const;

// iOS shadowRadius is half the CSS blur. iOS has no spread and Android has no offset, so both approximate the CSS shadow.
export const shadows = StyleSheet.create({
  card: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 9,
    elevation: 1,
  },
  sheet: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.07,
    shadowRadius: 15,
    elevation: 8,
  },
  orb: {
    shadowColor: colors.plum,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  // The two below are React Native's own boxShadow (0.76 and later, New Architecture), which draws the same shadow
  // on both platforms and can draw an inset one. `glass` lifts the floating tab bar on every side: a soft halo
  // (ink at 16%, about 7% at the bar's top edge and 9% at its bottom edge once the blur spreads it) and a tight
  // contact edge (ink at 8%). A fainter halo (12%, 4 down, blur 28) left about 5% at the top edge, which linen hid.
  // `lens` is the inset highlight (top) and shade (bottom) that make the lens over the active tab read as a thick
  // curved drop.
  glass: {
    boxShadow: [
      { offsetX: 0, offsetY: 2, blurRadius: 20, color: `${colors.ink}29` },
      { offsetX: 0, offsetY: 1, blurRadius: 3, color: `${colors.ink}14` },
    ],
  },
  lens: {
    boxShadow: [
      { offsetX: 0, offsetY: 2, blurRadius: 4, color: `${colors.card}F2`, inset: true },
      { offsetX: 0, offsetY: -3, blurRadius: 6, color: `${colors.ink}14`, inset: true },
    ],
  },
});
