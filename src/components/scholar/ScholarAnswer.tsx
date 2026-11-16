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
import { colors, radii } from "@/constants/theme";
import type { ScholarBlock, ScholarMessage } from "@/types";

const icons = {
  listen: { android: "volume_up", ios: "speaker.wave.2" },
  stop: { android: "stop", ios: "stop.fill" },
  share: { android: "share", ios: "square.and.arrow.up" },
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
  // The system share sheet with the answer's words and passages. Null where it is not offered: under an answer that carries a
  // help line, and anywhere in a heavy conversation.
  onShare: (() => void) | null;
  // Under an answer about harm at home (the readers): someone may watch the phone.
  onDelete: (() => void) | null;
};

function Block({ block }: { block: ScholarBlock }) {
  if (block.type === "passage") return <ScriptureCard scripture={block.scripture} tone="white" />;
  if (block.type === "prayer") {
    return (
      <View className="rounded-xl border border-petal bg-card p-3">
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

// Scholar's answer (step 38, restyled 2026-11-15): the brand mark and the name "Scholar" in sentence case, then the answer in a
// bubble of its own, a rose tint (25%) with a rose border, mirrored from the person's plum one (small corner bottom-left): its
// blocks in the order they were saved (the lead passage and the prayer on white cards, the text, the supporting passage, the
// prayer ending "Amen."), a hairline, and a row of bare icons: Listen and Share. The help line follows an answer to a flagged
// message and every written answer; Listen reads it aloud. The bubble arrives as one piece (a fade and a rise).
export function ScholarAnswer({ message, animate, listen, onListen, onStopListening, onShare, onDelete }: ScholarAnswerProps) {
  const parts: ReactElement[] = message.blocks.map((block, index) => <Block key={index} block={block} />);
  if (message.helpLine !== null) parts.push(<HelpLine key="help" kind={message.helpLine} />);

  const playing = listen.phase === "playing";
  const preparing = listen.phase === "preparing";

  const bubble = (
    <View className="max-w-[92%] gap-3 self-start border border-rose/50 bg-rose/25 px-4 pb-1 pt-3" style={styles.bubble}>
      {parts}
      <View className="h-px bg-plum/10" />
      {/* The icons sit in 44 boxes; the row is pulled left by the 12 that is blank inside the first box, so the first icon lines up with the text. */}
      <View className="-ml-3 flex-row flex-wrap items-center gap-x-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? copy.scholar.a11y.stop : copy.scholar.a11y.listen}
          accessibilityState={{ busy: preparing }}
          onPress={playing || preparing ? onStopListening : onListen}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-11 items-center justify-center">
            {preparing ? (
              <ActivityIndicator size="small" color={colors.plum} />
            ) : playing ? (
              <View className="size-9 items-center justify-center rounded-full bg-plum">
                <Icon name={icons.stop} size={16} color={colors.card} />
              </View>
            ) : (
              <Icon name={icons.listen} size={20} color={colors.mauve} />
            )}
          </View>
        </Pressable>
        {onShare !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.a11y.share}
            onPress={onShare}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="size-11 items-center justify-center">
              <Icon name={icons.share} size={20} color={colors.mauve} />
            </View>
          </Pressable>
        ) : null}
        {onDelete !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.scholar.delete.link}
            onPress={onDelete}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="ml-3 min-h-11 flex-row items-center gap-1.5">
              <Icon name={icons.delete} size={16} color={colors.mauve} />
              <Text className="text-label-md text-mauve">{copy.scholar.delete.link}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {listen.phase === "failed" ? (
        <Text accessibilityLiveRegion="polite" className="pb-2 text-body-sm text-mauve">
          {listen.line}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <View className="size-8 items-center justify-center rounded-full border border-petal bg-blush">
          <Image source={images.logoMark} contentFit="contain" style={styles.mark} />
        </View>
        <Text className="text-label-md text-plum-deep">{copy.scholar.name}</Text>
      </View>
      {animate ? (
        <FadeIn rise={10} duration={240}>
          {bubble}
        </FadeIn>
      ) : (
        bubble
      )}
    </View>
  );
}

// expo-image takes a style, not a className (Style Exception Rules).
const styles = StyleSheet.create({
  // The small corner is bottom-left, the mirror of the person's bubble: per-corner radii have no class.
  bubble: {
    borderTopLeftRadius: radii.bubble,
    borderTopRightRadius: radii.bubble,
    borderBottomRightRadius: radii.bubble,
    borderBottomLeftRadius: radii.bubbleTail,
  },
  mark: { width: 18, height: 18 },
  pressed: { opacity: 0.6 },
});
