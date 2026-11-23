import type { SymbolViewProps } from "expo-symbols";
import { Fragment, useEffect, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { VoiceAvatar } from "@/components/scholar/VoiceAvatar";
import { copy } from "@/constants/copy";
import {
  DEFAULT_SCHOLAR_VOICE,
  SCHOLAR_VOICE_ORDER,
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
  check: { android: "check", ios: "checkmark" },
} satisfies Record<string, SymbolViewProps["name"]>;

const voiceCopy = copy.scholarVoice;
const previews = new Set<number>(Object.values(scholarVoicePreviews));

type VoiceRowsProps = {
  selected: ScholarVoiceKey;
  onSelect: (voice: ScholarVoiceKey) => void;
  // False inside a card that already frames them (Profile): the rows only, under a hairline.
  framed?: boolean;
  // An account that is not subscribed (2026-11-20): every voice but the default carries a Pro chip, and a tap on it calls
  // `onLocked` (the plans) in place of choosing it. Its Preview stays free.
  locked?: boolean;
  onLocked?: (voice: ScholarVoiceKey) => void;
};

// Scholar's eight voices as one card of rows (step 39), in the Talk sheet, the chat's voice sheet and on Profile: each row is the
// voice's portrait, its name and its one line, chosen with a tap, and a Preview button beside it that plays the voice saying the
// opening line. The chosen voice's portrait has a plum ring and a check (2026-11-19, in place of a radio dot beside the portrait).
// One preview at a time; leaving the rows stops it. A changed voice ticks once; choosing the selected one does nothing. For an
// account that is not subscribed the other voices are Pro (2026-11-20): a chip on each, and a tap opens the plans with no tick.
export function VoiceRows({
  selected,
  onSelect,
  framed = true,
  locked = false,
  onLocked,
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

  // The boldest man's voice first, then a woman's, then a man's, to the end (SCHOLAR_VOICE_ORDER).
  const rows = SCHOLAR_VOICE_ORDER.map((key, index) => {
    const voice = voiceCopy.voices[key];
    const checked = key === selected;
    const pro = locked && key !== DEFAULT_SCHOLAR_VOICE;
    const previewing = playing === scholarVoicePreviews[key];
    return (
      <Fragment key={key}>
        {index > 0 ? <View className="ml-4 h-px bg-petal" /> : null}
        <View className="min-h-14 flex-row items-center">
          <Pressable
            accessibilityRole={pro ? "button" : "radio"}
            accessibilityLabel={
              pro
                ? voiceCopy.a11y.locked(voice.name, voice.description)
                : voiceCopy.a11y.voice(voice.name, voice.description)
            }
            accessibilityHint={pro ? voiceCopy.a11y.lockedHint : undefined}
            accessibilityState={pro ? undefined : { checked }}
            onPress={() => {
              if (pro) {
                onLocked?.(key);
                return;
              }
              if (checked) return;
              haptics.selection();
              onSelect(key);
            }}
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
          >
            <View className="flex-1 flex-row items-center gap-3 py-2.5 pl-4">
              {/* The check makes the choice a shape as well as a colour. */}
              <View>
                <VoiceAvatar voice={key} size={40} selected={checked} />
                {checked ? (
                  <View
                    className="items-center justify-center rounded-full bg-plum"
                    style={styles.check}
                  >
                    <Icon name={icons.check} size={10} color={colors.card} />
                  </View>
                ) : null}
              </View>
              <View className="shrink gap-0.5">
                {pro ? (
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-label-lg text-ink">{voice.name}</Text>
                    <View className="rounded-full bg-plum px-2 py-0.5">
                      <Text className="font-dm-bold text-[11px] uppercase leading-[16px] tracking-[0.5px] text-white">
                        {voiceCopy.pro}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text className="text-label-lg text-ink">{voice.name}</Text>
                )}
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
  // On the portrait's lower right, with a white rim that parts it from the picture.
  check: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: colors.card,
  },
});
