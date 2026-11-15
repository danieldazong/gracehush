import type { SymbolViewProps } from "expo-symbols";
import { Fragment, useEffect, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import {
  SCHOLAR_VOICE_KEYS,
  type ScholarVoiceKey,
} from "@/constants/scholarVoices";
import { scholarVoicePreviews } from "@/constants/sounds";
import { colors, shadows } from "@/constants/theme";
import { haptics } from "@/services/haptics";
import {
  getPlayingSample,
  playSample,
  stopSample,
  subscribeSample,
} from "@/services/samplePlayer";

const icons = {
  play: { android: "play_arrow", ios: "play.fill" },
  stop: { android: "stop", ios: "stop.fill" },
} satisfies Record<string, SymbolViewProps["name"]>;

const voiceCopy = copy.scholarVoice;
const previews = new Set<number>(Object.values(scholarVoicePreviews));

type VoiceRowsProps = {
  selected: ScholarVoiceKey;
  onSelect: (voice: ScholarVoiceKey) => void;
  // False inside a card that already frames them (Profile): the rows only, under a hairline.
  framed?: boolean;
};

// Scholar's eight voices as one card of rows (step 39), in the Talk sheet and on Profile: each row is the voice's name and its one
// line, chosen with a tap, and a Preview button beside it that plays the voice saying the opening line. One preview at a time;
// leaving the rows stops it. A changed voice ticks once; choosing the selected one does nothing.
export function VoiceRows({
  selected,
  onSelect,
  framed = true,
}: VoiceRowsProps) {
  const playing = useSyncExternalStore(subscribeSample, getPlayingSample);

  // A preview belongs to these rows: it stops when they go.
  useEffect(
    () => () => {
      const sound = getPlayingSample();
      if (sound !== null && previews.has(sound)) stopSample();
    },
    [],
  );

  const rows = SCHOLAR_VOICE_KEYS.map((key, index) => {
    const voice = voiceCopy.voices[key];
    const checked = key === selected;
    const previewing = playing === scholarVoicePreviews[key];
    return (
      <Fragment key={key}>
        {index > 0 ? <View className="ml-4 h-px bg-petal" /> : null}
        <View className="min-h-14 flex-row items-center">
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel={voiceCopy.a11y.voice(
              voice.name,
              voice.description,
            )}
            accessibilityState={{ checked }}
            onPress={() => {
              if (checked) return;
              haptics.selection();
              onSelect(key);
            }}
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
          >
            <View className="flex-1 flex-row items-center gap-3 py-2.5 pl-4">
              <View
                className={
                  checked
                    ? "size-5 items-center justify-center rounded-full border-2 border-plum"
                    : "size-5 rounded-full border-2 border-mauve"
                }
              >
                {checked ? (
                  <View className="size-2.5 rounded-full bg-plum" />
                ) : null}
              </View>
              <View className="shrink gap-0.5">
                <Text className="text-label-lg text-ink">{voice.name}</Text>
                <Text className="text-body-sm text-mauve">
                  {voice.description}
                </Text>
              </View>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              previewing
                ? voiceCopy.a11y.stop
                : voiceCopy.a11y.preview(voice.name)
            }
            onPress={() => {
              if (previewing) stopSample();
              else void playSample(scholarVoicePreviews[key]);
            }}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 flex-row items-center gap-1 px-4">
              <Icon
                name={previewing ? icons.stop : icons.play}
                size={16}
                color={colors.plum}
              />
              <Text className="text-label-md text-plum">
                {previewing ? voiceCopy.stop : voiceCopy.preview}
              </Text>
            </View>
          </Pressable>
        </View>
      </Fragment>
    );
  });

  if (!framed) {
    return (
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={voiceCopy.a11y.voices}
      >
        <View className="ml-4 h-px bg-petal" />
        {rows}
      </View>
    );
  }
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={voiceCopy.a11y.voices}
    >
      <View
        className="rounded-card border border-petal bg-card"
        style={shadows.card}
      >
        <View className="overflow-hidden rounded-card">{rows}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  choice: { flex: 1 },
  pressed: { opacity: 0.6 },
});
