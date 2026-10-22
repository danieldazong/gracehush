import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState, type ReactElement } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChoiceChip } from "@/components/ChoiceChip";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ProgressScrubber } from "@/components/ProgressScrubber";
import { Skeleton } from "@/components/Skeleton";
import { AMBIENT_SOUNDS, PLAYBACK_RATES, SKIP_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, gradients, layout, radii, shadows } from "@/constants/theme";
import { getPlaybackTrack } from "@/data/selectors";
import { usePlayback } from "@/hooks/usePlayback";
import { useReflection } from "@/hooks/useReflection";
import type { RootStackScreenProps } from "@/navigation/types";
import type { PlaybackStatus } from "@/types";
import { formatDuration, formatDurationSpoken } from "@/utils/format";

import { MessageView } from "./ReflectionStateViews";

const { nowPlaying } = copy;
const { states } = nowPlaying;

const SKIP_SECONDS = SKIP_MS / 1000;

const icons = {
  close: { android: "keyboard_arrow_down", ios: "chevron.down" },
  play: { android: "play_arrow", ios: "play.fill" },
  pause: { android: "pause", ios: "pause.fill" },
  replay: { android: "replay", ios: "arrow.counterclockwise" },
  skipBack: { android: "replay", ios: "gobackward.15" },
  skipForward: { android: "replay", ios: "goforward.15" },
  ambient: { android: "graphic_eq", ios: "waveform" },
  quieter: { android: "volume_down", ios: "speaker.fill" },
  louder: { android: "volume_up", ios: "speaker.wave.3.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

// What the big button shows. From the end it plays again, from 0.
const orbByStatus: Record<PlaybackStatus, { icon: SymbolViewProps["name"]; label: string }> = {
  idle: { icon: icons.play, label: nowPlaying.play },
  paused: { icon: icons.play, label: nowPlaying.play },
  playing: { icon: icons.pause, label: nowPlaying.pause },
  ended: { icon: icons.replay, label: nowPlaying.replay },
};

type Playback = ReturnType<typeof usePlayback>;

const sidePadding = (width: number) =>
  width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;

function CloseRow({ onClose }: { onClose: () => void }) {
  return (
    <View className="min-h-11 flex-row items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={nowPlaying.closeLabel}
        onPress={onClose}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="min-h-11 flex-row items-center gap-1 pr-3">
          <Icon name={icons.close} size={22} color={colors.mauve} />
          <Text className="text-label-md text-mauve">{nowPlaying.close}</Text>
        </View>
      </Pressable>
      {/* Only iOS swipes a modal down, so only iOS gets a handle. It is centered on the row, not between the button and a spacer. */}
      {Platform.OS === "ios" ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          className="absolute inset-0 items-center justify-center"
        >
          <View className="h-1 w-10 rounded-full bg-petal" />
        </View>
      ) : null}
    </View>
  );
}

// Decorative: the gradient with the logo mark in a frosted tile, built in code. It has no text, because white
// on this gradient fails AA. The shadow sits on an outer view with a background (an iOS shadow needs one),
// and the gradient clips itself, since overflow: "hidden" on the same view would clip the shadow.
function Artwork() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[shadows.card, styles.artwork]}
    >
      <LinearGradient
        colors={gradients.brand.colors}
        locations={gradients.brand.locations}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.artworkFill}
      >
        <View className="size-24 items-center justify-center rounded-card border border-white/20 bg-white/15">
          <Image source={images.logoMark} contentFit="contain" style={styles.logo} />
        </View>
      </LinearGradient>
    </View>
  );
}

// iOS draws gobackward.15 and goforward.15 as they are. Android has no 15-second glyph (only replay_5,
// replay_10 and replay_30), so it draws the plain replay arrow with the number inside it, mirrored for forward.
// The number does not scale with the font, because the icon does not either.
function SkipGlyph({ forward }: { forward: boolean }) {
  const isAndroid = Platform.OS === "android";

  return (
    <View className="size-7 items-center justify-center">
      <View style={isAndroid && forward ? styles.mirror : undefined}>
        <Icon
          name={forward ? icons.skipForward : icons.skipBack}
          size={28}
          color={colors.plum}
        />
      </View>
      {isAndroid ? (
        <Text allowFontScaling={false} className="absolute font-dm-bold text-[10px] text-plum">
          {SKIP_SECONDS}
        </Text>
      ) : null}
    </View>
  );
}

type PlayerViewProps = {
  playback: Playback;
  padding: number;
  onClose: () => void;
};

// The loaded player, drawn from the store alone: a slow or failed reflection load never hides it.
function PlayerView({ playback, padding, onClose }: PlayerViewProps) {
  const { title, subtitle, durationMs, positionMs, status, rate, ambientSound, ambientVolume } =
    playback;
  // The position under the finger while dragging. A tick of the store cannot move the thumb meanwhile.
  const [dragMs, setDragMs] = useState<number | null>(null);
  // True while a finger is on a scrubber. The page does not scroll then, so a drag cannot turn into a scroll
  // (Android's ScrollView takes the touch from its child once the finger drifts past the touch slop).
  const [isTouching, setIsTouching] = useState(false);

  const shownMs = dragMs ?? positionMs;
  const volumePercent = Math.round(ambientVolume * 100);
  const isAmbientOff = ambientSound === "off";

  const orb = orbByStatus[status];

  return (
    <ScrollView
      scrollEnabled={!isTouching}
      contentContainerStyle={[styles.content, { paddingHorizontal: padding }]}
    >
      <CloseRow onClose={onClose} />
      <Artwork />

      <View className="items-center pt-2">
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          className="text-center text-headline text-plum-deep"
        >
          {title}
        </Text>
        <Text className="mt-1 text-center text-label-md text-rosewood">{subtitle}</Text>
      </View>

      <View>
        <ProgressScrubber
          value={shownMs}
          max={durationMs}
          step={SKIP_MS}
          color={colors.plum}
          trackHeight={8}
          accessibilityLabel={nowPlaying.scrubber}
          formatValueText={(ms) =>
            copy.reflection.player.position(
              formatDurationSpoken(ms),
              formatDurationSpoken(durationMs),
            )
          }
          onSeekStart={() => setIsTouching(true)}
          onSeekChange={setDragMs}
          onSeekEnd={(ms) => {
            playback.seekTo(ms);
            setDragMs(null);
            setIsTouching(false);
          }}
        />
        {/* The labels overlap the bottom of the 44-tall scrubber, which still takes the touch; the scrubber speaks both times. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="-mt-3 flex-row justify-between"
        >
          <Text className="text-label-md text-mauve" style={styles.tabular}>
            {formatDuration(shownMs)}
          </Text>
          <Text className="text-label-md text-mauve" style={styles.tabular}>
            {formatDuration(durationMs)}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-center gap-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nowPlaying.back(SKIP_SECONDS)}
          onPress={() => playback.skipBy(-SKIP_MS)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-12 items-center justify-center">
            <SkipGlyph forward={false} />
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={orb.label}
          onPress={playback.toggle}
          style={({ pressed }) => pressed && styles.orbPressed}
        >
          <View
            className="size-16 items-center justify-center rounded-full bg-plum"
            style={shadows.orb}
          >
            <Icon name={orb.icon} size={34} color="white" />
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nowPlaying.forward(SKIP_SECONDS)}
          onPress={() => playback.skipBy(SKIP_MS)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-12 items-center justify-center">
            <SkipGlyph forward />
          </View>
        </Pressable>
      </View>

      <View className="flex-row items-center justify-center gap-2">
        {PLAYBACK_RATES.map((value) => (
          <ChoiceChip
            key={value}
            wide
            label={nowPlaying.rate.text(value)}
            accessibilityLabel={nowPlaying.rate.label(value)}
            selected={value === rate}
            onPress={() => playback.setRate(value)}
          />
        ))}
      </View>

      <View className="card gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 flex-row items-center gap-1.5">
            <Icon name={icons.ambient} size={18} color={colors.rosewood} />
            <Text className="flex-1 text-label-lg text-ink">{nowPlaying.ambientTitle}</Text>
          </View>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="shrink-0 text-label-md text-mauve"
            style={styles.tabular}
          >
            {nowPlaying.volume.short(volumePercent)}
          </Text>
        </View>
        {/* The chips wrap instead of scrolling sideways, so none is hidden at large text or from a screen reader. */}
        <View className="flex-row flex-wrap gap-2">
          {AMBIENT_SOUNDS.map((sound) => (
            <ChoiceChip
              key={sound}
              label={copy.ambient.labels[sound]}
              accessibilityLabel={nowPlaying.ambientChip(copy.ambient.labels[sound])}
              selected={sound === ambientSound}
              onPress={() => playback.setAmbient(sound)}
            />
          ))}
        </View>
        {/* Dimmed and disabled while the sound is off, so the card never changes height. Android fades each child on its own unless told to composite the group, which let the thumb show the fill's end through it. */}
        <View
          needsOffscreenAlphaCompositing
          className={
            isAmbientOff
              ? "flex-row items-center gap-2.5 opacity-40"
              : "flex-row items-center gap-2.5"
          }
        >
          <Icon name={icons.quieter} size={16} color={colors.mauve} />
          <View className="flex-1">
            <ProgressScrubber
              value={ambientVolume}
              max={1}
              step={0.1}
              color={colors.rosewood}
              trackHeight={6}
              disabled={isAmbientOff}
              accessibilityLabel={nowPlaying.volume.label}
              formatValueText={(volume) => nowPlaying.volume.text(Math.round(volume * 100))}
              onSeekStart={() => setIsTouching(true)}
              onSeekChange={playback.setAmbientVolume}
              onSeekEnd={(volume) => {
                playback.setAmbientVolume(volume);
                setIsTouching(false);
              }}
            />
          </View>
          <Icon name={icons.louder} size={16} color={colors.mauve} />
        </View>
      </View>

      {/* TODO(26): show it to everyone once background playback works */}
      {__DEV__ ? (
        <Text className="text-center text-body-sm text-mauve">{nowPlaying.devFooter}</Text>
      ) : null}
    </ScrollView>
  );
}

// The shape of the player: artwork, title and reference, and the play button.
function NowPlayingLoading({ artworkHeight }: { artworkHeight: number }) {
  return (
    <View
      accessible
      accessibilityLabel={states.loading}
      accessibilityState={{ busy: true }}
      className="screen__content"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="items-center gap-3"
      >
        <Skeleton height={artworkHeight} radius={radii.hero} />
        <View className="w-full items-center gap-2 pt-2">
          <Skeleton width="60%" height={28} radius={8} />
          <Skeleton width="35%" height={14} radius={8} />
        </View>
        <Skeleton width={64} height={64} radius={32} />
      </View>
    </View>
  );
}

export function NowPlayingScreen({ navigation, route }: RootStackScreenProps<"NowPlaying">) {
  const { entryId } = route.params;
  const { width } = useWindowDimensions();
  const playback = usePlayback();
  const state = useReflection(entryId);
  const { load } = playback;

  const track = state.status === "ready" ? getPlaybackTrack(state.entry) : null;
  const profile = state.status === "ready" ? state.profile : null;

  // The player loads when the user opens it, never because a reflection was merely viewed. Opening it from
  // the mini player has loaded it already (so no skeleton shows); opening it by route loads it here. Loading
  // the track that is already loaded does nothing, so this never resets a position.
  useEffect(() => {
    if (track !== null && profile !== null) load(track, profile);
  }, [track, profile, load]);

  const padding = sidePadding(width);
  const close = () => navigation.goBack();

  // Once the store holds this entry the screen draws from the store alone.
  if (playback.entryId === entryId) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
        <PlayerView playback={playback} padding={padding} onClose={close} />
      </SafeAreaView>
    );
  }

  let body: ReactElement;
  if (state.status === "loading") {
    body = <NowPlayingLoading artworkHeight={((width - 2 * padding) * 3) / 4} />;
  } else if (state.status === "error") {
    body = (
      <MessageView title={states.error.message}>
        <PrimaryButton label={states.error.retry} onPress={state.retry} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={states.close}
          className="min-h-11 items-center justify-center"
          onPress={close}
        >
          <Text className="btn-text__label">{states.close}</Text>
        </Pressable>
      </MessageView>
    );
  } else if (state.status === "not-found" || state.entry.isCrisis) {
    // A crisis entry gets this too: nothing here may hint that a player exists for it.
    body = (
      <MessageView title={states.notFound}>
        <PrimaryButton label={states.close} onPress={close} />
      </MessageView>
    );
  } else if (track === null) {
    body = (
      <MessageView title={states.unavailable}>
        <PrimaryButton label={states.close} onPress={close} />
      </MessageView>
    );
  } else {
    // Ready, and the effect above is loading it: the next render is the player.
    body = <NowPlayingLoading artworkHeight={((width - 2 * padding) * 3) / 4} />;
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View style={{ paddingHorizontal: padding }}>
        <CloseRow onClose={close} />
      </View>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  content: { gap: 12, paddingTop: 0, paddingBottom: 32 },
  artwork: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radii.hero,
    backgroundColor: colors.plum,
  },
  artworkFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: radii.hero,
  },
  logo: { width: 56, height: 56 },
  mirror: { transform: [{ scaleX: -1 }] },
  pressed: { opacity: 0.6 },
  orbPressed: { transform: [{ scale: 0.95 }] },
  tabular: { fontVariant: ["tabular-nums"] },
});
