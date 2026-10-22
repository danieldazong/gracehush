import type { SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ChoiceChip } from "@/components/ChoiceChip";
import { Icon } from "@/components/Icon";
import { ProgressScrubber } from "@/components/ProgressScrubber";
import { AMBIENT_SOUNDS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import type { AmbientSound } from "@/types";

const { nowPlaying } = copy;

const icons = {
  quieter: { android: "volume_down", ios: "speaker.fill" },
  louder: { android: "volume_up", ios: "speaker.wave.3.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

type AmbientPanelProps = {
  sound: AmbientSound;
  volume: number; // 0–1
  onChangeSound: (sound: AmbientSound) => void;
  // The finger lifted (or a screen reader moved the value): save this volume.
  onChangeVolume: (volume: number) => void;
  // A finger is on the volume track. The screen stops its ScrollView while it is, or Android's ScrollView takes
  // the drag once the finger drifts about 8dp vertically (found in step 12).
  onSeekingChange: (seeking: boolean) => void;
};

// What the Ambient Soundscape row opens in place: the same chips and volume as Now Playing, for the sound the
// next devotional starts with. The volume is dimmed and disabled while the sound is off, so the panel never
// changes height.
export function AmbientPanel({
  sound,
  volume,
  onChangeSound,
  onChangeVolume,
  onSeekingChange,
}: AmbientPanelProps) {
  // The volume under the finger while dragging. Only the end of the drag is saved.
  const [dragVolume, setDragVolume] = useState<number | null>(null);
  const shown = dragVolume ?? volume;
  const isOff = sound === "off";

  return (
    <View className="gap-3 pb-4 pl-[68px] pr-4">
      {/* The chips wrap instead of scrolling sideways, so none is hidden at large text or from a screen reader. */}
      <View className="flex-row flex-wrap gap-2">
        {AMBIENT_SOUNDS.map((value) => (
          <ChoiceChip
            key={value}
            label={copy.ambient.labels[value]}
            accessibilityLabel={nowPlaying.ambientChip(copy.ambient.labels[value])}
            selected={value === sound}
            onPress={() => onChangeSound(value)}
          />
        ))}
      </View>
      {/* Android fades each child on its own unless told to composite the group, which let the thumb show the fill's end through it.
          The row wraps: when the slider would get under 96dp (320dp wide at 1.3x text) the readout drops under it. */}
      <View
        needsOffscreenAlphaCompositing
        className={
          isOff
            ? "flex-row flex-wrap items-center gap-x-2.5 gap-y-1 opacity-40"
            : "flex-row flex-wrap items-center gap-x-2.5 gap-y-1"
        }
      >
        <Icon name={icons.quieter} size={16} color={colors.mauve} />
        <View className="min-w-[96px] flex-1">
          <ProgressScrubber
            value={shown}
            max={1}
            step={0.1}
            color={colors.rosewood}
            trackHeight={6}
            disabled={isOff}
            accessibilityLabel={nowPlaying.volume.label}
            formatValueText={(next) => nowPlaying.volume.text(Math.round(next * 100))}
            onSeekStart={() => onSeekingChange(true)}
            onSeekChange={setDragVolume}
            onSeekEnd={(next) => {
              setDragVolume(null);
              onSeekingChange(false);
              onChangeVolume(next);
            }}
          />
        </View>
        <Icon name={icons.louder} size={16} color={colors.mauve} />
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="shrink-0 text-label-md text-mauve"
          style={styles.tabular}
        >
          {nowPlaying.volume.short(Math.round(shown * 100))}
        </Text>
      </View>
      <Text className="text-body-sm text-mauve">{copy.profile.ambient.helper}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ["tabular-nums"] },
});
