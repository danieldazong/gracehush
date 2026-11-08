import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AmbientSoundPicker } from "@/components/AmbientSoundPicker";
import { ChoiceChip } from "@/components/ChoiceChip";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ProgressScrubber } from "@/components/ProgressScrubber";
import { SceneStack } from "@/components/SceneStack";
import { Skeleton } from "@/components/Skeleton";
import { PLAYBACK_RATES, SKIP_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { playerScenes } from "@/constants/images";
import { colors, layout, radii, shadows } from "@/constants/theme";
import { updateProfile } from "@/data/journalRepository";
import { getPlaybackTrack, getPlayerSceneForHour } from "@/data/selectors";
import { usePlayback } from "@/hooks/usePlayback";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useReflection } from "@/hooks/useReflection";
import type { RootStackScreenProps } from "@/navigation/types";
import { track } from "@/services/analytics";
import type { PlaybackStatus } from "@/types";
import { formatDuration, formatDurationSpoken } from "@/utils/format";

import { MessageView } from "./ReflectionStateViews";

const { nowPlaying } = copy;
const { states } = nowPlaying;

const SKIP_SECONDS = SKIP_MS / 1000;
// The artwork sits a little smaller while the devotional is paused and grows to full size when it plays (Apple Music's
// cue), over 300 ms; still under Reduce Motion.
const PAUSED_ARTWORK_SCALE = 0.94;
const ARTWORK_SCALE_MS = 300;
// While the voice is heard the card drifts to the next scene on this beat, so a devotional of a minute and a half shows
// all four.
const ARTWORK_HOLD_MS = 20_000;

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
    </View>
  );
}

type ArtworkProps = {
  playing: boolean; // the person asked for sound: the card grows at once
  buffering: boolean; // and it has not started yet: the scenes wait for the voice
};

// The player's four painted scenes (2026-11-02). The card opens on the scene of the hour, the one the lock screen shows,
// and while the voice is heard it drifts through the day's four moments; paused, it holds the scene it is on, a little
// smaller. Under Reduce Motion it is the hour's scene, still. Decorative for a screen reader: the title under it says what
// plays. The shadow sits on the outer view with a background (an iOS shadow needs one) and the inner view clips the
// scenes, since overflow: "hidden" on the same view would clip the shadow.
function Artwork({ playing, buffering }: ArtworkProps) {
  const reduceMotion = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(playing || reduceMotion ? 1 : PAUSED_ARTWORK_SCALE));
  const [startScene] = useState(() => getPlayerSceneForHour(new Date().getHours()));

  useEffect(() => {
    if (reduceMotion) {
      scale.setValue(1);
      return;
    }
    const run = Animated.timing(scale, {
      toValue: playing ? 1 : PAUSED_ARTWORK_SCALE,
      duration: ARTWORK_SCALE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [playing, reduceMotion, scale]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[shadows.card, styles.artwork, { transform: [{ scale }] }]}
    >
      <View style={styles.artworkClip}>
        <SceneStack
          sources={playerScenes}
          start={startScene}
          holdMs={ARTWORK_HOLD_MS}
          moving={playing && !buffering}
        />
      </View>
    </Animated.View>
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
  // "Playing" while the sound has not started yet: the audio is being downloaded or opened. The button stays a pause button.
  const isBuffering = playback.isBuffering && status === "playing";

  return (
    <ScrollView
      scrollEnabled={!isTouching}
      contentContainerStyle={[styles.content, { paddingHorizontal: padding }]}
    >
      <CloseRow onClose={onClose} />
      <Artwork playing={status === "playing"} buffering={isBuffering} />

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
          accessibilityState={isBuffering ? { busy: true } : undefined}
          onPress={playback.toggle}
          style={({ pressed }) => pressed && styles.orbPressed}
        >
          <View
            className="size-16 items-center justify-center rounded-full bg-plum"
            style={shadows.orb}
          >
            {isBuffering ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Icon name={orb.icon} size={34} color="white" />
            )}
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

      {playback.error !== null ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="text-center text-body-sm text-rosewood"
        >
          {nowPlaying.errors[playback.error]}
        </Text>
      ) : null}

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
        {/* A two-by-two grid of equal chips (2026-11-01): nothing scrolls sideways, so none is hidden at large text or
            from a screen reader. */}
        <AmbientSoundPicker
          value={ambientSound}
          onSelect={(sound) => {
            if (sound !== ambientSound) track("ambient_changed", { sound, source: "now_playing" });
            playback.setAmbient(sound);
            // What is chosen here is also the sound the next devotional starts with (step 27). A save that fails
            // changes nothing on this screen: the next change saves again.
            void updateProfile({ ambientSound: sound });
          }}
        />
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
                // Saved once, when the finger lifts.
                void updateProfile({ ambientVolume: volume });
                setIsTouching(false);
              }}
            />
          </View>
          <Icon name={icons.louder} size={16} color={colors.mauve} />
        </View>
      </View>

      <Text className="text-center text-body-sm text-mauve">{nowPlaying.footer}</Text>
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
  } else if (state.status === "not-found") {
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
  artworkClip: { flex: 1, borderRadius: radii.hero, overflow: "hidden" },
  mirror: { transform: [{ scaleX: -1 }] },
  pressed: { opacity: 0.6 },
  orbPressed: { transform: [{ scale: 0.95 }] },
  tabular: { fontVariant: ["tabular-nums"] },
});
