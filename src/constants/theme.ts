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
  tabBarHeight: 64,
  dockOffset: 20,
  dockPen: 44,
  dockOrb: 56,
  dockClearance: 112,
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
});
