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
  // The person’s bubble in a Scholar conversation: round on three corners, a small one at the sender’s bottom corner.
  bubble: 20,
  bubbleTail: 6,
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
  // Scholar's ask bar (step 38), dockOffset above the capsule in place of the dock: askBarHeight tall, and the Scholar tab's
  // content ends askBarClearance above the capsule (the offset, the bar and 36 of air).
  askBarHeight: 56,
  askBarClearance: 112,
} as const;

export const gradients = {
  brand: { colors: [colors.plum, colors.rose], locations: [0, 1] },
  // The Welcome scene's soft edges (2026-11-01): linen over the scene's top, where the status bar and the progress row
  // sit (95% at the edge, 65% halfway, so plum pills read on a dark roof as well as a pale sky), and linen under it,
  // where the lockup and the headline begin, so the picture has no hard edge on either side.
  sceneTop: {
    colors: [`${colors.linen}F2`, `${colors.linen}A6`, `${colors.linen}00`],
    locations: [0, 0.5, 1],
  },
  sceneBottom: {
    colors: [`${colors.linen}00`, `${colors.linen}B3`, colors.linen],
    locations: [0, 0.5, 1],
  },
  // The live talk's captions (2026-11-16): Scholar's older lines fade into the linen as they go up out of the window.
  captionTop: {
    colors: [colors.linen, `${colors.linen}00`],
    locations: [0, 1],
  },
  // The Scholar tab (2026-11-16): the plum-deep the hero's painted scene melts into on its left (solid at the scene's edge, 60%
  // a third of the way in, gone by two thirds, so the faces and the lamp stay clear), and the linen the list dissolves into
  // behind the ask bar and the tab bar, so two glass pills never sit over a row of words.
  scholarHeroFade: {
    colors: [colors.plumDeep, `${colors.plumDeep}99`, `${colors.plumDeep}00`],
    locations: [0, 0.35, 0.65],
  },
  askFade: {
    colors: [`${colors.linen}00`, `${colors.linen}E6`],
    locations: [0, 1],
  },
  // The Today tab's word card (2026-11-16): the hour's painted scene shows clear in the top quarter and melts into plum-deep
  // behind the headline and the verse (72% at 40% of the height, 92% at 54%, 96% at the foot). Worked out against all four player
  // scenes with the real fonts: the headline stays at 4.4:1 or better on the brightest pixel under it, the verse (90% white) at 8.3:1.
  // The sixteen scenes of 2026-11-20, measured the same way: the usual card (one headline line) at 9.7:1 or better on the
  // brightest pixel, the verse at 8.9:1 and the reference at 8.8:1; a two-line headline over a four-line verse reaches the
  // light part of the fade, 2.8:1 on the brightest pixel and 4.3:1 on the 95th percentile, as the first four do (2.9:1).
  wordFade: {
    colors: [`${colors.plumDeep}00`, `${colors.plumDeep}00`, `${colors.plumDeep}B8`, `${colors.plumDeep}EB`, `${colors.plumDeep}F5`],
    locations: [0, 0.26, 0.4, 0.54, 1],
  },
  // The plan tag on the profile picture (2026-11-19, PlanTag): a body lit from above (plum to plum-deep for Pro and a trial,
  // blush to petal for Free) and a white shine over its top 60%, which with the rim and the drop shadow make the pill read as a
  // raised, glossy chip.
  planTagPro: { colors: [colors.plum, colors.plumDeep], locations: [0, 1] },
  planTagFree: { colors: [colors.blush, colors.petal], locations: [0, 1] },
  planTagShinePro: { colors: [`${colors.card}47`, `${colors.card}00`], locations: [0, 0.6] },
  planTagShineFree: { colors: [`${colors.card}BF`, `${colors.card}00`], locations: [0, 0.6] },
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
  // The plan tag's lift (2026-11-19): a tight contact shadow and a softer one under it, stronger under the dark Pro pill than
  // under the pale Free one, so both stand off the picture by the same amount.
  planTagPro: {
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: `${colors.ink}59` },
      { offsetX: 0, offsetY: 2, blurRadius: 5, color: `${colors.ink}26` },
    ],
  },
  planTagFree: {
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: `${colors.ink}38` },
      { offsetX: 0, offsetY: 2, blurRadius: 5, color: `${colors.ink}1A` },
    ],
  },
  // Each card of the Today tab's deck (2026-11-20): a soft shadow (ink at 14%, 6 down, blur 16) and a tight contact edge (ink at
  // 22%, 1 down, blur 4), so the top card lies on the one behind it. It reaches about 10 above a card and 22 under it, inside the
  // room the deck's scroll view keeps (12 and 24).
  deckCard: {
    boxShadow: [
      { offsetX: 0, offsetY: 6, blurRadius: 16, color: `${colors.ink}24` },
      { offsetX: 0, offsetY: 1, blurRadius: 4, color: `${colors.ink}38` },
    ],
  },
});
