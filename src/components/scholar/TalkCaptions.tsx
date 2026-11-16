import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, type LayoutChangeEvent, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { gradients } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import {
  CAPTION_CUT_MS,
  CAPTION_FADE_MS,
  getCaptions,
  type PersonCaption,
  type ScholarCaption,
  subscribeCaptions,
} from "@/services/talkCaptions";

// The live talk's captions (2026-11-16), under the orb: the person's sentence once ElevenLabs has heard it, in a smaller mauve
// line, and Scholar's words in time with its voice, the phrase about to be said dim and each word lighting as it is spoken, in a
// window of a few lines that slides up as the answer goes on. The words come from the talk service (services/talkCaptions.ts);
// this only draws them. They are for the eye alone: a screen reader hears the talk itself, and the talk's saved messages are the
// record, so the whole area is hidden from it.
//
// The text is centred in a centred column (the owner's choice, 2026-11-16), so the last line re-centres by half a word each time
// a word appears; the phrase ahead comes in dim, a little before it is said, so that shift happens before the eye reaches it.

// Scholar's lines: DM Sans Medium 20/30. Three of them show, two in a heavy talk (its help line shares the page).
const SCHOLAR_LINE = 30;
const SCHOLAR_LINES = 3;
const SCHOLAR_HEAVY_LINES = 2;
// The person's sentence: DM Sans 15/22, two lines at most.
const PERSON_LINE = 22;
const PERSON_LINES = 2;
// The text follows the system text size up to this, and the space kept for it with it.
const TEXT_SCALE_MAX = 1.3;
const COLUMN_MAX = 360;
// How the window follows a new line, and how the person's sentence comes in.
const CAPTION_SLIDE_MS = 250;
const PERSON_IN_MS = 150;

type Props = { heavy: boolean };

export function TalkCaptions({ heavy }: Props) {
  const captions = useSyncExternalStore(subscribeCaptions, getCaptions);
  const { width, fontScale } = useWindowDimensions();
  const scale = Math.min(fontScale, TEXT_SCALE_MAX);
  const column = Math.min(width - 48, COLUMN_MAX);
  const personHeight = Math.ceil(PERSON_LINES * PERSON_LINE * scale);
  const windowHeight = Math.ceil((heavy ? SCHOLAR_HEAVY_LINES : SCHOLAR_LINES) * SCHOLAR_LINE * scale);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.area, { width: column }]}
    >
      <View style={[styles.person, { height: personHeight }]}>
        {captions.person !== null ? <PersonLine key={captions.person.key} caption={captions.person} /> : null}
      </View>
      <View style={[styles.window, { height: windowHeight }]}>
        {captions.scholar !== null ? (
          <ScholarBlock key={captions.scholar.key} caption={captions.scholar} windowHeight={windowHeight} />
        ) : null}
      </View>
    </View>
  );
}

function PersonLine({ caption }: { caption: PersonCaption }) {
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    const to = caption.leaving ? 0 : 1;
    if (reduceMotion) {
      opacity.setValue(to);
      return;
    }
    const animation = Animated.timing(opacity, {
      toValue: to,
      duration: caption.leaving ? CAPTION_FADE_MS : PERSON_IN_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [caption.leaving, opacity, reduceMotion]);
  return (
    <Animated.View style={{ opacity }}>
      <Text numberOfLines={PERSON_LINES} maxFontSizeMultiplier={TEXT_SCALE_MAX} className="text-center text-body text-mauve">
        {caption.text}
      </Text>
    </Animated.View>
  );
}

function ScholarBlock({ caption, windowHeight }: { caption: ScholarCaption; windowHeight: number }) {
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  const [offset] = useState(() => new Animated.Value(0));
  // Whether lines have gone up out of the window: the linen fade at its top shows only then.
  const [scrolled, setScrolled] = useState(false);
  // The text's last height, read in the layout handler only.
  const height = useRef(0);

  useEffect(() => {
    if (caption.leaving === null) return;
    if (reduceMotion) {
      opacity.setValue(0);
      return;
    }
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: caption.leaving === "cut" ? CAPTION_CUT_MS : CAPTION_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [caption.leaving, opacity, reduceMotion]);

  // The text hangs from the window's top. When it grows past the window it is moved up so its last line is the window's last,
  // sliding on a new line; the line comes in from below the window's edge, so nothing on screen jumps first. When it shrinks
  // (its oldest words dropped) the move is at once, so the words on screen stay put.
  function onLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    const grew = next > height.current;
    height.current = next;
    const target = next > windowHeight ? windowHeight - next : 0;
    setScrolled(target < 0);
    if (reduceMotion || !grew) {
      offset.setValue(target);
      return;
    }
    Animated.timing(offset, {
      toValue: target,
      duration: CAPTION_SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      <Animated.View style={[styles.lines, { transform: [{ translateY: offset }] }]}>
        <Text onLayout={onLayout} maxFontSizeMultiplier={TEXT_SCALE_MAX} className="text-center font-dm-medium text-[20px] leading-[30px] text-ink">
          {caption.words.map((word, index) => (
            <Text key={word.key} className={word.lit ? "text-ink" : "text-ink/35"}>
              {index === 0 ? word.text : ` ${word.text}`}
            </Text>
          ))}
        </Text>
      </Animated.View>
      {scrolled ? (
        <LinearGradient
          pointerEvents="none"
          colors={gradients.captionTop.colors}
          locations={gradients.captionTop.locations}
          style={[styles.fade, { height: Math.round(windowHeight / 3) }]}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  area: { gap: 8 },
  // A one-line sentence sits just above Scholar's words.
  person: { justifyContent: "flex-end" },
  window: { overflow: "hidden" },
  lines: { position: "absolute", top: 0, left: 0, right: 0 },
  fade: { position: "absolute", top: 0, left: 0, right: 0 },
});
