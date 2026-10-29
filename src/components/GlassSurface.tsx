import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, StyleSheet, View } from "react-native";

import { colors, radii } from "@/constants/theme";

// The floating tab bar's material (step 08b follow-up). One component draws what the platform can: Apple's Liquid
// Glass on iOS 26 (the system refracts what scrolls under it, tinted), a frosted blur under the tint on older iOS,
// and the tint alone on Android (a blur there needs the content wrapped in a BlurTargetView, which the tab bar
// cannot reach). It fills its parent, takes no touch and is hidden from screen readers; the rim and the highlights
// are the caller's, drawn over it.
export type GlassMaterial = "bar" | "lens";

// How much of the tint colour the glass carries, and how strong the blur under it is. The fills on the platforms
// without glass are classes below: the bar at 35% over the blur on older iOS and at 85% on Android, where nothing
// blurs behind it, and the lens at 6% on both. (The bar was 70% and 90% until the second step 08b follow-up:
// halving the tint is what makes it read as a pane and not a panel; the shadow around it does the lifting.)
const BAR_TINT_ALPHA = 0.35;
const BAR_BLUR_INTENSITY = 40;
const LENS_TINT_ALPHA = 0.06;

function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()}`;
}

// iOS 26 and later with the Liquid Glass API present (some iOS 26 betas lack it: expo-glass-effect's own note).
// Asked once; a build without the native module answers false and gets the blur.
function detectLiquidGlass(): boolean {
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}
const LIQUID_GLASS = detectLiquidGlass();

type GlassSurfaceProps = {
  material: GlassMaterial;
};

export function GlassSurface({ material }: GlassSurfaceProps) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Material material={material} />
    </View>
  );
}

function Material({ material }: GlassSurfaceProps) {
  if (LIQUID_GLASS) {
    return material === "bar" ? (
      <GlassView
        style={styles.glass}
        glassEffectStyle="regular"
        tintColor={withAlpha(colors.glass, BAR_TINT_ALPHA)}
        colorScheme="light"
      />
    ) : (
      // Clear glass over the bar's regular glass: the lens stays see-through and refracts the bar under it.
      <GlassView
        style={styles.glass}
        glassEffectStyle="clear"
        tintColor={withAlpha(colors.plumDeep, LENS_TINT_ALPHA)}
        colorScheme="light"
      />
    );
  }
  if (material === "lens") {
    // Over the bar's blur the lens needs no blur of its own: the tint is the lens.
    return <View className="absolute inset-0 rounded-full bg-plum-deep/6" />;
  }
  if (Platform.OS === "ios") {
    // expo-blur applies a borderRadius only with overflow hidden on the BlurView itself.
    return (
      <BlurView tint="light" intensity={BAR_BLUR_INTENSITY} style={styles.blur}>
        <View className="absolute inset-0 rounded-full bg-glass/35" />
      </BlurView>
    );
  }
  return <View className="absolute inset-0 rounded-full bg-glass/85" />;
}

const fill = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  glass: { ...fill, borderRadius: radii.full },
  blur: { ...fill, borderRadius: radii.full, overflow: "hidden" },
});
