import { View } from "react-native";

import { ChoiceChip } from "@/components/ChoiceChip";
import { AMBIENT_SOUNDS } from "@/constants/app";
import { copy } from "@/constants/copy";
import type { AmbientSound } from "@/types";

const { nowPlaying } = copy;
// Two chips to a row: four sounds make a two-by-two grid.
const PER_ROW = 2;

type AmbientSoundPickerProps = {
  value: AmbientSound;
  onSelect: (sound: AmbientSound) => void;
};

// The ambient sound choice (Off, Soft Rain, Gentle Piano, Morning Birds) as a grid of equal chips, two to a row, on
// Now Playing and on Profile (2026-11-01, the user's call: the chips used to wrap at their own widths, which left the
// last one alone on a second line). Nothing scrolls sideways, so no chip is hidden at large text or from a screen
// reader, and the reading order is the rows'. Choosing the selected one does nothing (the chip's own rule).
export function AmbientSoundPicker({ value, onSelect }: AmbientSoundPickerProps) {
  const rows: AmbientSound[][] = [];
  for (let i = 0; i < AMBIENT_SOUNDS.length; i += PER_ROW) rows.push(AMBIENT_SOUNDS.slice(i, i + PER_ROW));

  return (
    <View className="gap-2">
      {rows.map((row) => (
        <View key={row.join("+")} className="flex-row gap-2">
          {row.map((sound) => (
            <ChoiceChip
              key={sound}
              fill
              label={copy.ambient.labels[sound]}
              accessibilityLabel={nowPlaying.ambientChip(copy.ambient.labels[sound])}
              selected={sound === value}
              onPress={() => onSelect(sound)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
