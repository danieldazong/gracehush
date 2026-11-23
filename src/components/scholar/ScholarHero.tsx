import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { scholarScenes } from "@/constants/images";
import { colors, gradients } from "@/constants/theme";

const waveIcon = { android: "graphic_eq", ios: "waveform" } satisfies SymbolViewProps["name"];

// One of the two painted scenes (a woman and a man studying Scripture by lamplight), drawn at import and not in render, which
// must stay pure; the Paywall and the Sign In cover pick theirs the same way.
const scene = scholarScenes[Math.random() < 0.5 ? 0 : 1];

// Under this window width the card is narrow and tall (the text wraps more), so the picture is cropped further, and the centred
// crop would cut the man's face at the edge: the window moves to the right, where both faces stay whole (measured on a render
// at 288 wide; every wider phone keeps the centred crop).
const NARROW_WINDOW = 340;

type ScholarHeroProps = {
  // Starts a live talk, in the talk's own order (the Paywall for a free account, then the permissions). Null in a build that
  // cannot hold a talk (Expo Go): the card then has no button, because the ask bar under it is the way in.
  onTalk: (() => void) | null;
  // A free account sees "Pro" on the button: talking is a Pro gate, and the button says so before the Paywall does.
  showPro: boolean;
};

// The Scholar tab's hero card (2026-11-16, reworded the same day): a flat plum-deep card with the name as a small label, the
// pitch in the person's own terms, what Scholar is and does, and one white button to the live talk. It does not repeat the ask
// bar: the bar is the way to ask, and the hero's job is to say what is here and to show the thing worth paying for. The painted
// scene fills the card's right 60% and melts into the plum on its left, so the text sits on plain plum and the person looks out
// from the right. The scene is decorative; the title and the button carry the meaning. Flat, with no shadow: the plum carries
// the weight.
export function ScholarHero({ onTalk, showPro }: ScholarHeroProps) {
  const { width } = useWindowDimensions();
  const narrow = width < NARROW_WINDOW;
  return (
    <View className="min-h-[200px] overflow-hidden rounded-hero bg-plum-deep">
      <View
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.art}
      >
        <Image
          source={scene}
          contentFit="cover"
          contentPosition={narrow ? { left: "65%" } : undefined}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={gradients.scholarHeroFade.colors}
          locations={gradients.scholarHeroFade.locations}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View className="p-5">
        <View className="max-w-[64%]">
          <Text className="font-dm-bold text-[11px] uppercase leading-[16px] tracking-[0.8px] text-white/70">
            {copy.scholar.hero.eyebrow}
          </Text>
          <Text accessibilityRole="header" className="mt-1 text-headline text-white">
            {copy.scholar.hero.title}
          </Text>
          <Text className="mt-1.5 text-body-sm text-white/80">{copy.scholar.hero.caption}</Text>
        </View>
        {onTalk !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPro ? copy.scholar.hero.ctaFreeLabel : copy.scholar.hero.cta}
            accessibilityHint={showPro ? copy.scholar.hero.ctaFreeHint : copy.scholar.talk.hint}
            onPress={onTalk}
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          >
            <View className="min-h-11 flex-row items-center gap-2 rounded-full bg-white pl-2 pr-2.5">
              <View className="size-7 items-center justify-center rounded-full bg-plum">
                <Icon name={waveIcon} size={14} color={colors.card} />
              </View>
              <Text className="shrink text-label-lg text-plum-deep">{copy.scholar.hero.cta}</Text>
              {showPro ? (
                <View className="rounded-full bg-plum px-2 py-0.5">
                  <Text className="font-dm-bold text-[11px] uppercase leading-[16px] tracking-[0.5px] text-white">
                    {copy.scholar.hero.pro}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { position: "absolute", top: 0, bottom: 0, right: 0, width: "60%" },
  cta: { alignSelf: "flex-start", marginTop: 16 },
  pressed: { opacity: 0.85 },
});
