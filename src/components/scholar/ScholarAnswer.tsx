import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import type { ReactElement } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { FadeIn } from "@/components/FadeIn";
import { HelpLine } from "@/components/HelpLine";
import { Icon } from "@/components/Icon";
import { ScriptureCard } from "@/components/ScriptureCard";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors } from "@/constants/theme";
import type { ScholarBlock, ScholarMessage } from "@/types";

const icons = {
  listen: { android: "volume_up", ios: "speaker.wave.2" },
  stop: { android: "stop", ios: "stop.fill" },
  delete: { android: "delete", ios: "trash" },
} satisfies Record<string, SymbolViewProps["name"]>;

// Where Listen stands for this answer: nothing, its first part on its way, playing, or a line under the button.
export type ListenView = { phase: "idle" } | { phase: "preparing" } | { phase: "playing" } | { phase: "failed"; line: string };

type ScholarAnswerProps = {
  message: ScholarMessage;
  // The answer arrived during this visit: its blocks fade in one after another.
  animate: boolean;
  listen: ListenView;
  onListen: () => void;
  onStopListening: () => void;
  // Under an answer about harm at home (the readers): someone may watch the phone.
  onDelete: (() => void) | null;
};

const BLOCK_DELAY_MS = 60;

function Block({ block }: { block: ScholarBlock }) {
  if (block.type === "passage") return <ScriptureCard scripture={block.scripture} />;
  if (block.type === "prayer") {
    return (
      <View className="rounded-xl border border-petal bg-blush/60 p-3">
        <Text className="text-scripture text-ink/90">{copy.reflection.closingPrayer(block.text)}</Text>
      </View>
    );
  }
  const paragraphs = block.text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (
    <View className="gap-3">
      {paragraphs.map((paragraph, index) => (
        <Text key={index} className="text-body-lg text-ink">
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

// Scholar's answer (step 38): no bubble, the brand mark and the eyebrow "Scholar", then its blocks in the order they were saved
// (the lead passage, the text, the supporting passage, the prayer ending "Amen."). The help line follows an answer to a flagged
// message and every written answer; Listen reads it aloud.
export function ScholarAnswer({ message, animate, listen, onListen, onStopListening, onDelete }: ScholarAnswerProps) {
  const parts: ReactElement[] = message.blocks.map((block, index) => <Block key={index} block={block} />);
  if (message.helpLine !== null) parts.push(<HelpLine key="help" kind={message.helpLine} />);

  const playing = listen.phase === "playing";
  const preparing = listen.phase === "preparing";

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <View className="size-8 items-center justify-center rounded-full border border-petal bg-blush">
          <Image source={images.logoMark} contentFit="contain" style={styles.mark} />
        </View>
        <Text className="eyebrow">{copy.scholar.eyebrow}</Text>
      </View>
      {parts.map((part, index) =>
        animate ? (
          <FadeIn key={part.key ?? index} delay={index * BLOCK_DELAY_MS} rise={10} duration={240}>
            {part}
          </FadeIn>
        ) : (
          part
        )
      )}
      <View className="flex-row flex-wrap items-center gap-x-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? copy.scholar.a11y.stop : copy.scholar.a11y.listen}
          accessibilityState={{ busy: preparing }}
          onPress={playing || preparing ? onStopListening : onListen}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="min-h-11 flex-row items-center gap-1.5 pr-2">
            {preparing ? (
              <ActivityIndicator size="small" color={colors.plum} />
            ) : (
              <Icon name={playing ? icons.stop : icons.listen} size={18} color={colors.plum} />
            )}
            <Text className="text-label-lg text-plum">
              {preparing ? copy.scholar.listen.preparing : playing ? copy.scholar.listen.stop : copy.scholar.listen.listen}
            </Text>
          </View>
        </Pressable>
        {onDelete !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.delete.link}
            onPress={onDelete}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 flex-row items-center gap-1.5">
              <Icon name={icons.delete} size={16} color={colors.mauve} />
              <Text className="text-label-md text-mauve">{copy.scholar.delete.link}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {listen.phase === "failed" ? (
        <Text accessibilityLiveRegion="polite" className="text-body-sm text-mauve">
          {listen.line}
        </Text>
      ) : null}
    </View>
  );
}

// expo-image takes a style, not a className (Style Exception Rules).
const styles = StyleSheet.create({
  mark: { width: 18, height: 18 },
  pressed: { opacity: 0.6 },
});
