import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

import { SceneStack } from "@/components/SceneStack";
import { colors, gradients } from "@/constants/theme";

// With more than one scene they cross-fade every HOLD_MS, so a person who hesitates on the first screen sees a second
// person in a second moment. The breathing and the cross-fade itself are SceneStack's.
const HOLD_MS = 7_000;

// The soft edge under the scene, where the lockup and the headline begin: the Welcome's height, and the Sign In's shorter scene
// passes its own.
const BOTTOM_FADE = 140;

type WelcomeScenesProps = {
  sources: readonly number[]; // the bundled scenes in the order they rotate, the first shown first
  // The scene takes whatever height the cover's text and footer leave (`flex: 1` in a content container that fills the
  // viewport), and never less than this; on a short phone, or at large text, the cover scrolls instead.
  minHeight: number;
  active: boolean; // false while the screen is not in front: the motion stops
  // The linen fade over the top edge, where the status bar and the progress row sit. It has no default: each screen works it out
  // from the status bar's height, because a fixed one leaves the row unreadable over a dark scene on some iPhones.
  fadeTop: number;
  fadeBottom?: number; // and under the bottom edge, BOTTOM_FADE by default
};

// The full-bleed scene at the top of the Welcome step and of the Sign In that ends onboarding (2026-11-01): the painted
// "moment" a new person recognises themselves in, edge to edge and under the status bar, dissolving into linen above
// and below. Decorative: the headline under it carries the meaning. Reduce Motion shows the first scene, still.
export function WelcomeScenes({
  sources,
  minHeight,
  active,
  fadeTop,
  fadeBottom = BOTTOM_FADE,
}: WelcomeScenesProps) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { minHeight }]}
    >
      <SceneStack sources={sources} holdMs={HOLD_MS} moving={active} contentPosition="top" />
      <LinearGradient
        pointerEvents="none"
        colors={gradients.sceneTop.colors}
        locations={gradients.sceneTop.locations}
        style={[styles.top, { height: fadeTop }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={gradients.sceneBottom.colors}
        locations={gradients.sceneBottom.locations}
        style={[styles.bottom, { height: fadeBottom }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, width: "100%", overflow: "hidden", backgroundColor: colors.linen },
  top: { position: "absolute", top: 0, left: 0, right: 0 },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0 },
});
