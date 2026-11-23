import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";

import { WordCard } from "@/components/today/WordCard";
import { copy } from "@/constants/copy";
import { colors, radii, shadows } from "@/constants/theme";
import type { WordStackCard } from "@/data/selectors";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { formatResetDay } from "@/utils/format";

// The Today tab's deck of words (2026-11-20). Today's word lies on top, with one card for each earlier reflection behind it,
// newest first, and three cards show: the top one whole and two peeking out on the right, smaller and fading toward the page,
// each card casting a soft shadow on the one behind it, so the deck reads as cards lying on one another. A swipe turns
// one card at a time, through the whole history. It is the phone's own paging scroll view, so the top card follows the finger
// and a flick carries; every card's place, size and shade follow the scroll position on the native driver, and nothing renders
// while a finger moves. Only the cards around the top one hold a card (one before it, three after it); the others are empty
// pages that keep the scroll's width. Under Reduce Motion the cards behind do not grow or slide: they keep their places while
// the top card is moved, and take their new ones when it has turned.

// The deck's height never goes under this, and only grows (a card with a longer verse), so the screen under it never jumps
// while the cards turn.
const STACK_MIN_HEIGHT = 300;
// How far each card behind peeks out past the one in front of it, and how much smaller it is.
const PEEK = 7;
const PEEK_NARROW = 5;
const NARROW = 360;
const SCALES = [1, 0.95, 0.9, 0.85] as const;
// The linen wash over each card behind: the deeper, the more it fades toward the page (2026-11-20). A plum shade made the
// cards behind as dark as the top card's edge, so the stack read as one block. A light wash (30% and 55%) left streaks of
// the paintings in the 7-point strips, which read as more than three cards; at 60% and 80% each strip is one even tone, a
// mid card and a pale card behind the dark one (about 5 to 7:1 between the top card and the next, and about 1.4 to 1.5:1
// between the next two and the page). A card clears to its full painting as it comes to the front.
const VEILS = [0, 0.6, 0.8, 0.8] as const;
// Room inside the scroll view for the cards' shadow, which it would cut off: above the cards (the gap under the heading) and
// under them (the gap above the capture bar). Negative margins give it back, so nothing on the screen moves.
const ROOM_TOP = 12;
const ROOM_BOTTOM = 24;
// Cards held around the top one.
const BEFORE = 1;
const AFTER = 3;
// When the top card is this close to the last one, the next page of reflections is asked for.
const NEAR_END = 3;
// A jump back to today slides only from this close; from farther it is immediate.
const SLIDE_BACK_MAX = 3;

type Motion = {
  translateX: Animated.AnimatedInterpolation<number> | number;
  scale: Animated.AnimatedInterpolation<number> | number;
  opacity: Animated.AnimatedInterpolation<number> | number;
  veil: Animated.AnimatedInterpolation<number> | number;
};

// Where card `i` is, as a function of the scroll position. `shifts[k]` moves a card `k` places behind the top one back over
// the deck, so that it peeks out by `k` peeks once it is scaled down. Under Reduce Motion the cards behind the top one stay
// where they are while the scroll moves (they slide with it), and the top card leaves as the scroll goes.
function cardMotion(
  scrollX: Animated.Value,
  clamped: Animated.AnimatedInterpolation<number>,
  i: number,
  depth: number,
  width: number,
  shifts: readonly number[],
  reduced: boolean,
): Motion {
  if (reduced) {
    if (depth < 0) return { translateX: 0, scale: 1, opacity: 1, veil: 0 };
    const k = Math.min(depth, 3);
    const shift = shifts[k] ?? 0;
    return {
      translateX: clamped.interpolate({
        inputRange: [i * width - 4 * width, i * width],
        outputRange: [shift - 4 * width, shift],
        extrapolateRight: "clamp",
      }),
      scale: SCALES[k],
      opacity: k >= 3 ? 0 : 1,
      veil: VEILS[k],
    };
  }
  const at = (k: number) => (i - k) * width;
  return {
    translateX: scrollX.interpolate({
      inputRange: [at(3), at(2), at(1), at(0)],
      outputRange: [shifts[3] - 3 * width, shifts[2] - 2 * width, shifts[1] - width, 0],
      extrapolate: "clamp",
    }),
    scale: scrollX.interpolate({
      inputRange: [at(3), at(2), at(1), at(0)],
      outputRange: [SCALES[3], SCALES[2], SCALES[1], SCALES[0]],
      extrapolate: "clamp",
    }),
    opacity: scrollX.interpolate({ inputRange: [at(3), at(2)], outputRange: [0, 1], extrapolate: "clamp" }),
    veil: scrollX.interpolate({
      inputRange: [at(2), at(1), at(0)],
      outputRange: [VEILS[2], VEILS[1], VEILS[0]],
      extrapolate: "clamp",
    }),
  };
}

type PageProps = {
  card: WordStackCard;
  position: number;
  depth: number;
  scrollX: Animated.Value;
  clamped: Animated.AnimatedInterpolation<number>;
  width: number;
  side: number;
  shifts: readonly number[];
  reduced: boolean;
  scene: number;
  footer: string;
  sharing: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onShare: (() => void) | null;
  onNext: (() => void) | null;
  onPrevious: (() => void) | null;
};

// One card of the deck, in its page. Only the top card can be touched or reached by a screen reader.
function StackPage({ card, position, depth, scrollX, clamped, width, side, shifts, reduced, ...rest }: PageProps) {
  // Away from Reduce Motion a card's motion does not depend on which card is on top, so it is made once.
  const motionDepth = reduced ? depth : 0;
  const motion = useMemo(
    () => cardMotion(scrollX, clamped, position, motionDepth, width, shifts, reduced),
    [scrollX, clamped, position, motionDepth, width, shifts, reduced],
  );
  const top = depth === 0;
  return (
    <Animated.View
      pointerEvents={top ? "auto" : "none"}
      accessibilityElementsHidden={!top}
      importantForAccessibility={top ? "auto" : "no-hide-descendants"}
      style={[
        styles.card,
        styles.lift,
        {
          marginHorizontal: side,
          opacity: motion.opacity,
          transform: [{ translateX: motion.translateX }, { scale: motion.scale }],
        },
      ]}
    >
      <WordCard
        affirmation={card.affirmation}
        scene={rest.scene}
        footer={rest.footer}
        onOpen={rest.onOpen}
        onToggleFavorite={rest.onToggleFavorite}
        onShare={rest.onShare}
        sharing={rest.sharing}
        onNext={top ? rest.onNext : null}
        onPrevious={top ? rest.onPrevious : null}
        style={styles.fill}
      />
      <Animated.View pointerEvents="none" style={[styles.veil, { opacity: motion.veil }]} />
    </Animated.View>
  );
}

type Props = {
  cards: readonly WordStackCard[];
  // Each card's painted scene, by position (utils/sceneMatch.ts deckScenes): the one that interprets its reflection, and never
  // the scene of either card just before it.
  scenes: readonly number[];
  // The window's width (each page is one), and the list's side padding (each card's margin).
  pageWidth: number;
  side: number;
  footer: (card: WordStackCard) => string;
  // The affirmation whose picture is being made for sharing, if any.
  sharing: string | null;
  saveFailed: boolean;
  onOpen: (card: WordStackCard) => void;
  onToggleFavorite: (card: WordStackCard) => void;
  onShare: (card: WordStackCard, scene: number) => void;
  onNearEnd: () => void;
};

export function WordStack({ cards, scenes, pageWidth, side, footer, sharing, saveFailed, ...actions }: Props) {
  const reduced = useReduceMotion();
  const [scrollX] = useState(() => new Animated.Value(0));
  const clamped = useMemo(
    () => scrollX.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp" }),
    [scrollX],
  );
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true }),
    [scrollX],
  );
  const scrollRef = useRef<ScrollViewInstance>(null);
  // The card the scroll view is at, as its own events and the jumps the deck asks for leave it.
  const shownAt = useRef(0);
  // Whether a finger or a slide is moving the scroll view, and whether the deck's position must be given to the cards again
  // once it stops (see the resync below).
  const moving = useRef(false);
  const resyncLater = useRef(false);
  const [index, setIndex] = useState(0);
  const [height, setHeight] = useState(STACK_MIN_HEIGHT);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  useAnnounce(announcement);

  const last = cards.length - 1;
  // A card that left the deck (a reflection deleted) can take the top one with it: the last one is on top instead.
  const current = Math.min(index, Math.max(last, 0));

  // A card k places behind is moved back by k steps: what its smaller size takes off its right edge, and k peeks.
  const shifts = useMemo(() => {
    const step = (pageWidth - 2 * side) * ((1 - SCALES[1]) / 2) + (pageWidth < NARROW ? PEEK_NARROW : PEEK);
    return [0, step, 2 * step, 3 * step];
  }, [pageWidth, side]);

  const heading = (at: number) => {
    const entry = cards[at]?.entry ?? null;
    return at === 0 || entry === null ? copy.today.word.title : copy.today.word.from(formatResetDay(entry.createdAt));
  };

  // The top card has turned (a swipe, the link back or a screen reader's action). Close to the end of what is loaded, the next
  // page of reflections is asked for, so the deck goes on.
  const settle = (target: number) => {
    if (target === current || target < 0 || target > last) return;
    setIndex(target);
    const turned = cards[target];
    if (turned) setAnnouncement(`${heading(target)}. ${turned.affirmation.headline}`);
    if (target > 0 && target >= cards.length - NEAR_END) actions.onNearEnd();
  };

  const goTo = (target: number, animated: boolean) => {
    if (animated && target !== shownAt.current) moving.current = true;
    shownAt.current = target;
    scrollRef.current?.scrollTo({ x: target * pageWidth, animated });
    settle(target);
  };

  // A page has settled. A drag that ends exactly on a page has no momentum to wait for; any other drag has, and its momentum
  // decides the page (a flick can turn a card that was dragged less than half way).
  const pageOf = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = event.nativeEvent;
    return layoutMeasurement.width > 0 ? contentOffset.x / layoutMeasurement.width : null;
  };
  const onDragStart = () => {
    moving.current = true;
  };
  // The scroll view has stopped on a page: a resync the cards' change asked for while it moved is done now, at its place.
  const stopped = () => {
    moving.current = false;
    if (!resyncLater.current) return;
    resyncLater.current = false;
    scrollX.setValue(shownAt.current * pageWidth);
  };
  const onDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = pageOf(event);
    if (page === null || Math.abs(page - Math.round(page)) > 0.01) return;
    shownAt.current = Math.round(page);
    stopped();
    settle(Math.round(page));
  };
  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = pageOf(event);
    if (page === null) return;
    shownAt.current = Math.round(page);
    stopped();
    settle(Math.round(page));
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height - ROOM_TOP - ROOM_BOTTOM;
    if (measured > height + 0.5) setHeight(measured);
  };

  // The scroll view keeps its own place: when the card on top is another one than the one it is at (the deck got shorter than
  // the place it was at, or long enough again), it is brought there.
  useEffect(() => {
    if (shownAt.current === current) return;
    shownAt.current = current;
    scrollRef.current?.scrollTo({ x: current * pageWidth, animated: false });
  }, [current, pageWidth]);

  // The cards are given the deck's position again whenever they change. On iOS a card that is newly placed (a reflection made
  // or deleted, its words arriving, the next page loaded, the top card turned) is tied to the scroll position only at the next
  // scroll event, and its first frame can be drawn from a stale copy of that position, so the cards behind stayed hidden until a
  // finger moved the deck (2026-11-20). Setting the value draws every card at once, where it belongs. While a finger or a slide
  // moves the deck, its own scroll events do it, and the resync waits until it stops.
  const cardKey = cards.map((card) => card.affirmation.id).join(" ");
  useEffect(() => {
    if (moving.current) {
      resyncLater.current = true;
      return;
    }
    scrollX.setValue(shownAt.current * pageWidth);
  }, [cardKey, current, pageWidth, side, reduced, scrollX]);

  const title = heading(current);
  return (
    <View className="gap-3">
      {/* Over the scroll view's room, so the link back to today keeps its whole touch area. */}
      <View className="flex-row items-center gap-3" style={styles.heading}>
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          className="flex-1 text-section tracking-[-0.5px] text-ink"
        >
          {title}
        </Text>
        {current > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.today.word.todayLabel}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => goTo(0, current <= SLIDE_BACK_MAX && !reduced)}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text className="font-dm-semibold text-[15px] leading-[20px] text-plum">{copy.today.word.today}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ marginHorizontal: -side, marginTop: -ROOM_TOP, marginBottom: -ROOM_BOTTOM }}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={cards.length > 1}
          showsHorizontalScrollIndicator={false}
          removeClippedSubviews={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onScrollBeginDrag={onDragStart}
          onScrollEndDrag={onDragEnd}
          onMomentumScrollEnd={onScrollEnd}
          onLayout={onLayout}
          contentContainerStyle={{
            minHeight: height + ROOM_TOP + ROOM_BOTTOM,
            paddingTop: ROOM_TOP,
            paddingBottom: ROOM_BOTTOM,
          }}
        >
          {cards.map((item, position) => {
            const depth = position - current;
            return (
              <View
                key={item.affirmation.id}
                style={{ width: pageWidth, zIndex: cards.length - position }}
              >
                {depth >= -BEFORE && depth <= AFTER ? (
                  <StackPage
                    card={item}
                    position={position}
                    depth={depth}
                    scrollX={scrollX}
                    clamped={clamped}
                    width={pageWidth}
                    side={side}
                    shifts={shifts}
                    reduced={reduced}
                    scene={scenes[position] ?? scenes[0] ?? 0}
                    footer={footer(item)}
                    sharing={sharing === item.affirmation.id}
                    onOpen={() => actions.onOpen(item)}
                    onToggleFavorite={() => actions.onToggleFavorite(item)}
                    onShare={
                      item.affirmation.verse
                        ? () => actions.onShare(item, scenes[position] ?? scenes[0] ?? 0)
                        : null
                    }
                    onNext={position < last ? () => goTo(position + 1, !reduced) : null}
                    onPrevious={position > 0 ? () => goTo(position - 1, !reduced) : null}
                  />
                ) : null}
              </View>
            );
          })}
        </Animated.ScrollView>
      </View>
      {saveFailed ? (
        <Text accessibilityLiveRegion="polite" className="text-body-sm text-rosewood">
          {copy.journal.affirmation.saveError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexGrow: 1 },
  // The shadow is on the card's own layer (the card clips its picture, which would cut a shadow off), with its corners, so it
  // moves, scales and fades with its card, and the top card's shadow falls on the card behind it.
  lift: { borderRadius: radii.hero, ...shadows.deckCard },
  fill: { flexGrow: 1 },
  veil: { ...StyleSheet.absoluteFill, borderRadius: radii.hero, backgroundColor: colors.linen },
  heading: { zIndex: 1 },
  pressed: { opacity: 0.6 },
});
