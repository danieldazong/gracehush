import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { playerScenes } from "@/constants/images";
import { colors, gradients, radii } from "@/constants/theme";
import type { Affirmation } from "@/types";
import { flowVerse, quoteVerse } from "@/utils/format";
import { WORD_CARD, wordFadeLocations } from "@/utils/wordCardLayout";

// Android's symbols are outline only, so its saved heart is a different glyph (a heart with a check).
const icons = {
  heart: { android: "favorite", ios: "heart" },
  heartSaved: { android: "heart_check", ios: "heart.fill" },
  share: { android: "share", ios: "square.and.arrow.up" },
} satisfies Record<string, SymbolViewProps["name"]>;

// The card's measures (its least height, the room the scene keeps at the top, the padding and the text sizes) are WORD_CARD
// in utils/wordCardLayout.ts, which the picture of the card reads too (Share sends that picture: services/wordCardImage.ts).
// The text classes below say the same sizes, because a class name cannot be built from a number: a check compares the two.

type WordCardProps = {
  affirmation: Affirmation;
  // An index into `images.playerScenes`: the scene that interprets the card's reflection (utils/sceneMatch.ts), or the
  // scene of the hour when the screen does not hold the reflection.
  scene: number;
  // "8:00 AM • Tied to today’s prayer": shown where the verse's reference would be, for an affirmation with no verse.
  footer: string;
  // The card was pressed: the reflection opens on its Affirmations tab.
  onOpen: () => void;
  onToggleFavorite: () => void;
  // Null when the affirmation has no verse: only a verse is shared.
  onShare: (() => void) | null;
  // The picture of the card is being made for the share menu: the Share button waits and shows a spinner.
  sharing: boolean;
  // On the top card of the deck (WordStack): a screen reader turns to the next or the previous card with two actions. Null
  // when there is no card that way.
  onNext?: (() => void) | null;
  onPrevious?: (() => void) | null;
  style?: StyleProp<ViewStyle>;
};

// Your word for today (2026-11-16): the affirmation of the current slot as a card on a painted scene (the hour's until
// 2026-11-20, then the one of twenty that interprets its reflection), in the way a
// verse of the day is shown in the apps that do it best: the scene clear at the top, the headline and the verse in white on a
// plum-deep fade, the reference and two quiet actions at the foot. The text sits on the fade, never on the picture alone
// (the fade was worked out against the first four scenes, and the sixteen of 2026-11-20 measure like them: theme.ts). The card is one button to the reflection; the heart and Share
// are buttons of their own beside it, never inside it. Since 2026-11-20 Share sends the card itself, as a picture, and the card
// is one of a deck (WordStack), which also shows the line about a heart that could not be saved.
export function WordCard({
  affirmation,
  scene,
  footer,
  onOpen,
  onToggleFavorite,
  onShare,
  sharing,
  onNext,
  onPrevious,
  style,
}: WordCardProps) {
  const { word } = copy.today;
  const verse = affirmation.verse;
  const favorite = affirmation.isFavorite;
  const detail = verse ? quoteVerse(flowVerse(verse.text)) : affirmation.text;
  const source = playerScenes[scene] ?? playerScenes[0];
  // The card's height as laid out, for the fade's stops (pinned to points: wordFadeLocations). Until the first layout it is
  // the least height, where the stops are the theme's own.
  const [height, setHeight] = useState<number>(WORD_CARD.minHeight);
  const turns = [
    ...(onNext ? [{ name: "next", label: word.next }] : []),
    ...(onPrevious ? [{ name: "previous", label: word.previous }] : []),
  ];

  return (
    <View
      className="overflow-hidden"
      style={[styles.card, style]}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    >
      <Image source={source} contentFit="cover" contentPosition="top" style={StyleSheet.absoluteFill} />
      <LinearGradient
        pointerEvents="none"
        colors={gradients.wordFade.colors}
        locations={wordFadeLocations(height, gradients.wordFade.locations)}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={word.openLabel(affirmation.headline, detail)}
        accessibilityHint={word.openHint}
        accessibilityActions={turns.length > 0 ? turns : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "next") onNext?.();
          else if (event.nativeEvent.actionName === "previous") onPrevious?.();
        }}
        onPress={onOpen}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <Text className="font-fraunces-medium text-[24px] leading-[30px] text-white">{affirmation.headline}</Text>
        {/* Fraunces italic takes its width from the layout (the vendor note on italic text that measures itself). */}
        <Text
          className={
            verse
              ? "mt-2 self-stretch font-fraunces-italic text-[15px] leading-[22px] text-white/90"
              : "mt-2 self-stretch font-dm text-[15px] leading-[22px] text-white/90"
          }
        >
          {detail}
        </Text>
      </Pressable>
      <View className="flex-row items-center pb-2 pl-5 pr-2">
        <Text className="flex-1 font-dm-semibold text-[13px] leading-[18px] text-white/85">
          {verse ? copy.affirmationVerse.reference(verse.reference) : footer}
        </Text>
        {onShare ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={word.share}
            accessibilityHint={word.shareHint}
            accessibilityState={{ busy: sharing, disabled: sharing }}
            disabled={sharing}
            onPress={onShare}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            {sharing ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Icon name={icons.share} size={20} color="white" />
            )}
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={favorite ? copy.journal.affirmation.unsave : copy.journal.affirmation.save}
          onPress={onToggleFavorite}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Icon
            name={favorite ? icons.heartSaved : icons.heart}
            size={22}
            color={favorite ? colors.rose : "white"}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: WORD_CARD.minHeight,
    borderRadius: radii.hero,
    backgroundColor: colors.plumDeep,
    justifyContent: "flex-end",
  },
  body: { paddingTop: WORD_CARD.sceneRoom, paddingHorizontal: WORD_CARD.sidePadding },
  action: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
});
