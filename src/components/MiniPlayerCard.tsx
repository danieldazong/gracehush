import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import { usePlayback } from "@/hooks/usePlayback";
import type { AmbientDefault, Devotional, PlaybackTrack } from "@/types";
import { formatDuration, formatDurationSpoken } from "@/utils/format";

const { player } = copy.reflection;

const icons = {
  play: { android: "play_arrow", ios: "play.fill" },
  pause: { android: "pause", ios: "pause.fill" },
  expand: { android: "keyboard_arrow_up", ios: "chevron.up" },
  arrow: { android: "arrow_forward", ios: "arrow.right" },
  book: { android: "menu_book", ios: "book" },
} satisfies Record<string, SymbolViewProps["name"]>;

type AudioCardProps = {
  track: PlaybackTrack;
  ambientDefault: AmbientDefault;
  onOpen: () => void;
};

// The playback hook lives here, so only this card re-renders on a tick.
// A Pressable is accessible by default and groups its children into one element, which would hide the
// buttons inside it from VoiceOver. The card takes touches but is not an element: the labels are on the controls.
function AudioCard({ track, ambientDefault, onOpen }: AudioCardProps) {
  const playback = usePlayback();
  const { title, durationMs } = track;
  // The store holds one track at a time. Another entry's card shows 0:00 and paused, and loads its track
  // only when the user acts on it (never because the reflection was merely viewed).
  const isCurrent = playback.entryId === track.entryId;
  const positionMs = isCurrent ? playback.positionMs : 0;
  const isPlaying = isCurrent && playback.status === "playing";
  const percent = Math.min(100, (positionMs / durationMs) * 100);
  const minutes = Math.max(1, Math.round(durationMs / 60000));

  function load() {
    if (!isCurrent) playback.load(track, ambientDefault);
  }

  function toggle() {
    load();
    playback.toggle();
  }

  // Now Playing opens with the track already loaded, so it never flashes a skeleton.
  function open() {
    load();
    onOpen();
  }

  return (
    <Pressable
      accessible={false}
      onPress={open}
      style={({ pressed }) => pressed && styles.cardPressed}
    >
      <View className="rounded-card bg-plum p-4" style={shadows.card}>
        <View className="flex-row items-center gap-3.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? player.pause : player.play(title)}
            onPress={toggle}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="size-12 items-center justify-center rounded-full bg-rose">
              <Icon
                name={isPlaying ? icons.pause : icons.play}
                size={28}
                color={colors.plumDeep}
              />
            </View>
          </Pressable>
          <View className="flex-1 flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-section text-white" numberOfLines={2}>
                {title}
              </Text>
              <Text className="text-body-sm text-white/70">{player.subtitle(minutes)}</Text>
            </View>
            <Icon name={icons.expand} size={22} color={colors.rose} />
          </View>
        </View>
        <View className="mt-3.5">
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="h-1.5 overflow-hidden rounded-full bg-plum-deep/60"
          >
            <View className="h-full rounded-full bg-rose" style={{ width: `${percent}%` }} />
          </View>
          <View className="mt-2 flex-row flex-wrap items-center justify-between gap-x-3">
            <Text
              accessible
              accessibilityLabel={player.position(
                formatDurationSpoken(positionMs),
                formatDurationSpoken(durationMs),
              )}
              className="text-label-md text-white/70"
              style={styles.tabular}
            >
              {formatDuration(positionMs)} / {formatDuration(durationMs)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={player.open}
              // The label is 18 tall, so 13 above and below makes a 44 touch area.
              hitSlop={{ top: 13, bottom: 13 }}
              onPress={open}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View className="flex-row items-center gap-1">
                <Text className="text-label-md text-white/90">{player.openLink}</Text>
                <Icon name={icons.arrow} size={14} color="white" />
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// An entry whose voice could not be made (or has no measured length) still has its text.
function NoAudioCard({ title }: { title: string }) {
  return (
    <View className="flex-row items-center gap-3.5 rounded-card bg-plum p-4" style={shadows.card}>
      <View className="size-12 items-center justify-center rounded-full bg-rose">
        <Icon name={icons.book} size={24} color={colors.plumDeep} />
      </View>
      <View className="flex-1">
        <Text className="text-section text-white" numberOfLines={2}>
          {title}
        </Text>
        <Text className="text-body-sm text-white/70">{player.noAudio}</Text>
      </View>
    </View>
  );
}

type MiniPlayerCardProps = {
  devotional: Devotional;
  // getPlaybackTrack(entry). Null (no audio, or no measured length) gets the no-audio card: an unmeasured
  // length is never invented.
  track: PlaybackTrack | null;
  // What the player's ambient choice starts from, when the app has not played anything yet (the profile).
  ambientDefault: AmbientDefault;
  onOpen: () => void;
};

// Reads the shared player store (usePlayback), so this card and Now Playing always agree. Playback is
// mocked until step 26.
export function MiniPlayerCard({ devotional, track, ambientDefault, onOpen }: MiniPlayerCardProps) {
  if (track === null) {
    return <NoAudioCard title={devotional.title} />;
  }
  return <AudioCard track={track} ambientDefault={ambientDefault} onOpen={onOpen} />;
}

const styles = StyleSheet.create({
  cardPressed: { transform: [{ scale: 0.98 }] },
  pressed: { opacity: 0.7 },
  tabular: { fontVariant: ["tabular-nums"] },
});
