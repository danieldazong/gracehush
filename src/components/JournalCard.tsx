import type { SymbolViewProps } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { EmotionBadge } from "@/components/EmotionBadge";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import type { JournalEntry } from "@/types";
import { formatDuration, formatDurationSpoken, formatEntryTimestamp } from "@/utils/format";

const icons = {
  play: { android: "play_arrow", ios: "play.fill" },
  hourglass: { android: "hourglass_top", ios: "hourglass" },
  refresh: { android: "refresh", ios: "arrow.clockwise" },
  support: { android: "favorite", ios: "heart" },
} satisfies Record<string, SymbolViewProps["name"]>;

// Every status has its own card. A crisis entry is a finished one in the data, but it is never
// shown as ready: no emotion, no scripture, no transcript.
type CardKind = "ready" | "textOnly" | "processing" | "uploading" | "pending" | "failed" | "crisis";

function getKind(entry: JournalEntry): CardKind {
  if (entry.isCrisis) return "crisis";
  switch (entry.status) {
    case "ready":
      return entry.devotional?.audioPath ? "ready" : "textOnly";
    case "processing":
    case "uploading":
    case "pending":
    case "failed":
      return entry.status;
  }
}

// One summary for a screen reader, built from the parts the card shows. The transcript is not part of it.
function getLabel(entry: JournalEntry, kind: CardKind, timestamp: string): string {
  const { a11y } = copy.journal.card;
  const parts = [a11y.from(timestamp)];
  switch (kind) {
    case "ready":
    case "textOnly": {
      if (entry.dominantEmotion) parts.push(a11y.emotion(entry.dominantEmotion.toLowerCase()));
      if (entry.scripture) parts.push(entry.scripture.reference);
      const durationMs = entry.devotional?.durationMs;
      if (kind === "textOnly") {
        parts.push(copy.journal.card.textOnly);
      } else {
        parts.push(
          durationMs ? a11y.devotional(formatDurationSpoken(durationMs)) : a11y.devotionalAudio,
        );
      }
      break;
    }
    case "processing":
      parts.push(a11y.preparing);
      break;
    case "uploading":
      parts.push(a11y.saving);
      break;
    case "pending":
      parts.push(copy.journal.card.waiting);
      break;
    case "failed":
      parts.push(a11y.failed);
      break;
    case "crisis":
      parts.push(a11y.support);
      break;
  }
  return `${parts.join(". ")}.`;
}

// The two lines of the card's body. An audio entry has no transcript until the server has processed
// it, and a crisis entry's transcript is never shown.
function Excerpt({ entry }: { entry: JournalEntry }) {
  if (entry.isCrisis) {
    return <Text className="text-body text-ink">{copy.journal.card.crisis}</Text>;
  }
  const transcript = entry.transcript?.trim();
  if (!transcript) {
    return (
      <Text className="text-body text-mauve" numberOfLines={2}>
        {copy.journal.card.voiceReflection}
      </Text>
    );
  }
  return (
    <Text className="text-body text-ink" numberOfLines={2}>
      {copy.journal.card.quote(transcript)}
    </Text>
  );
}

// durationMs is nullable (audio can exist without a measured length), so then it shows the icon alone.
// A plain View while the whole card opens Reflection.
// TODO(26): play in place (its own Pressable, with hitSlop so the touch area is 44)
function DurationPill({ durationMs }: { durationMs: number | null | undefined }) {
  return (
    <View className="min-h-[26px] flex-row items-center gap-1.5 rounded-full bg-plum-deep px-3 py-1">
      <Icon name={icons.play} size={14} color="white" />
      {durationMs ? (
        <Text
          className="font-dm-semibold text-[12px] leading-[18px] text-white"
          style={styles.tabular}
        >
          {formatDuration(durationMs)}
        </Text>
      ) : null}
    </View>
  );
}

function CardFooter({ entry, kind }: { entry: JournalEntry; kind: CardKind }) {
  const { card } = copy.journal;
  switch (kind) {
    case "ready":
    case "textOnly":
      return (
        <View className="flex-row items-center justify-end pt-0.5">
          {entry.scripture ? (
            <Text
              className="mr-3 flex-1 font-fraunces-italic text-[15px] leading-[20px] text-rosewood"
              numberOfLines={1}
            >
              {entry.scripture.reference}
            </Text>
          ) : null}
          {kind === "ready" ? (
            <DurationPill durationMs={entry.devotional?.durationMs} />
          ) : (
            <View className="chip">
              <Text className="chip__label">{card.textOnly}</Text>
            </View>
          )}
        </View>
      );
    case "processing":
    case "uploading":
      return (
        <View className="flex-row items-center gap-2 pt-0.5">
          <ActivityIndicator size="small" color={colors.plum} />
          <Text className="flex-1 text-body-sm text-mauve">
            {kind === "processing" ? card.preparing : card.saving}
          </Text>
        </View>
      );
    case "pending":
      return (
        <View className="flex-row pt-0.5">
          <View className="chip gap-1.5">
            <Icon name={icons.hourglass} size={12} color={colors.mauve} />
            <Text className="chip__label">{card.waiting}</Text>
          </View>
        </View>
      );
    case "failed":
      return (
        <View className="flex-row items-center gap-3 pt-0.5">
          <Text className="flex-1 text-body-sm text-rosewood">{card.failed}</Text>
          {/* TODO(24): retry sync */}
          <Pressable
            disabled
            accessibilityRole="button"
            accessibilityLabel={card.tryAgain}
            accessibilityState={{ disabled: true }}
            style={styles.disabled}
          >
            <View className="shrink-0 flex-row items-center gap-1 rounded-full border border-petal bg-card px-3 py-1">
              <Icon name={icons.refresh} size={14} color={colors.ink} />
              <Text className="text-label-md text-ink">{card.tryAgain}</Text>
            </View>
          </Pressable>
        </View>
      );
    case "crisis":
      return (
        <View className="flex-row pt-0.5">
          <View className="chip gap-1.5">
            <Icon name={icons.support} size={12} color={colors.mauve} />
            <Text className="chip__label">{card.support}</Text>
          </View>
        </View>
      );
  }
}

type JournalCardProps = {
  entry: JournalEntry;
  now: Date;
  onOpen: (entryId: string) => void;
};

export function JournalCard({ entry, now, onOpen }: JournalCardProps) {
  const kind = getKind(entry);
  const timestamp = formatEntryTimestamp(entry.createdAt, now);
  const label = getLabel(entry, kind, timestamp);
  const isFinished = kind === "ready" || kind === "textOnly";

  const card = (
    <View className="card gap-2.5" style={shadows.card}>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-body-sm text-mauve" numberOfLines={1}>
          {timestamp}
        </Text>
        {isFinished && entry.dominantEmotion ? (
          <EmotionBadge emotion={entry.dominantEmotion} />
        ) : null}
      </View>
      <Excerpt entry={entry} />
      <CardFooter entry={entry} kind={kind} />
    </View>
  );

  // Only a finished entry and a crisis entry open Reflection. The others are one labelled element and
  // not a button. The Pressable carries only the style function: classes go on the inner View.
  if (!isFinished && kind !== "crisis") {
    return (
      <View accessible accessibilityLabel={label}>
        {card}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onOpen(entry.id)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
  tabular: { fontVariant: ["tabular-nums"] },
});
