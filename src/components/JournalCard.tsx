import type { SymbolViewProps } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { EmotionBadge } from "@/components/EmotionBadge";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import type { HomeEntry, JournalEntry } from "@/types";
import {
  formatDuration,
  formatDurationSpoken,
  formatEntryTimestamp,
  formatWeekday,
} from "@/utils/format";

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

// The status line of a reflection that is saved on this phone and not prepared yet (entry.pending). The card shows it
// and a screen reader speaks it, so it is one string.
function getPendingLine(entry: HomeEntry, online: boolean | null): string | null {
  const { pending } = entry;
  if (!pending) return null;
  const weekday = pending.resetsAt === null ? null : formatWeekday(pending.resetsAt);
  return copy.journal.card.pendingLine(pending.status, online, weekday);
}

// One summary for a screen reader, built from the parts the card shows. The transcript is not part of it.
function getLabel(entry: HomeEntry, kind: CardKind, timestamp: string, pendingLine: string | null): string {
  const { a11y } = copy.journal.card;
  const parts = [a11y.from(timestamp)];
  if (pendingLine !== null) {
    parts.push(pendingLine);
    return `${parts.join(". ")}.`;
  }
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
// it, and a crisis entry's transcript is never shown. A reflection that is only on this phone never
// shows its words (the screen can be seen by someone else), so a written one says only that it is one.
function Excerpt({ entry }: { entry: HomeEntry }) {
  if (entry.isCrisis) {
    return <Text className="text-body text-ink">{copy.journal.card.crisis}</Text>;
  }
  const transcript = entry.transcript?.trim();
  if (!transcript) {
    return (
      <Text className="text-body text-mauve" numberOfLines={2}>
        {entry.inputType === "text"
          ? copy.journal.card.writtenReflection
          : copy.journal.card.voiceReflection}
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

// A small outlined button on a card: "Review", "See plans".
function PillButton({
  label,
  accessibilityLabel,
  icon,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  icon?: SymbolViewProps["name"];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // The pill is about 28 tall, so 8 above and below makes a 44 touch area.
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressedSoft}
    >
      <View className="shrink-0 flex-row items-center gap-1 rounded-full border border-petal bg-card px-3 py-1">
        {icon ? <Icon name={icon} size={14} color={colors.ink} /> : null}
        <Text className="text-label-md text-ink">{label}</Text>
      </View>
    </Pressable>
  );
}

type PendingFooterProps = {
  entry: HomeEntry;
  line: string;
  online: boolean | null;
  onReview?: (entry: HomeEntry) => void;
  onUnlock?: (entry: HomeEntry) => void;
};

// The footer of a reflection that is saved on this phone and not prepared yet.
function PendingFooter({ entry, line, online, onReview, onUnlock }: PendingFooterProps) {
  const { card } = copy.journal;
  const status = entry.pending?.status;
  if (status === "needs_action") {
    return (
      <View className="flex-row items-center gap-3 pt-0.5">
        <Text className="flex-1 text-body-sm text-rosewood">{line}</Text>
        {onReview ? (
          <PillButton
            label={card.review}
            accessibilityLabel={card.reviewLabel}
            onPress={() => onReview(entry)}
          />
        ) : null}
      </View>
    );
  }
  if (status === "limit_reached") {
    return (
      <View className="flex-row items-center gap-3 pt-0.5">
        <Text className="flex-1 text-body-sm text-mauve">{line}</Text>
        {onUnlock ? (
          <PillButton
            label={card.seePlans}
            accessibilityLabel={card.seePlansLabel}
            onPress={() => onUnlock(entry)}
          />
        ) : null}
      </View>
    );
  }
  // Being sent now, or about to be: a spinner. Waiting for the phone to connect or for a sign-in: the hourglass.
  if (status === "sending" || (status === "queued" && online !== false)) {
    return (
      <View className="flex-row items-center gap-2 pt-0.5">
        <ActivityIndicator size="small" color={colors.plum} />
        <Text className="flex-1 text-body-sm text-mauve">{line}</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-2 pt-0.5">
      <Icon name={icons.hourglass} size={14} color={colors.mauve} />
      <Text className="flex-1 text-body-sm text-mauve">{line}</Text>
    </View>
  );
}

function CardFooter({
  entry,
  kind,
  pendingLine,
  online,
  onReview,
  onUnlock,
}: {
  entry: HomeEntry;
  kind: CardKind;
  pendingLine: string | null;
  online: boolean | null;
  onReview?: (entry: HomeEntry) => void;
  onUnlock?: (entry: HomeEntry) => void;
}) {
  const { card } = copy.journal;
  if (pendingLine !== null) {
    return (
      <PendingFooter
        entry={entry}
        line={pendingLine}
        online={online}
        onReview={onReview}
        onUnlock={onUnlock}
      />
    );
  }
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
      // An entry the server marked failed, which has no copy of its words on this phone to send again. Only the mock data
      // lists one: the real Journal does not list failed entries (step 25), and a refused or retrying reflection that is
      // still on this phone has `pending`, with the Review button in PendingFooter.
      return (
        <View className="flex-row items-center gap-3 pt-0.5">
          <Text className="flex-1 text-body-sm text-rosewood">{card.failed}</Text>
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
  entry: HomeEntry;
  now: Date;
  // false when the phone has no connection, null before NetInfo has answered.
  online: boolean | null;
  onOpen: (entryId: string) => void;
  // A refused reflection on this phone: "Review" opens what can be done with it.
  onReview?: (entry: HomeEntry) => void;
  // A reflection the free limit is holding back: "See plans" opens the Paywall.
  onUnlock?: (entry: HomeEntry) => void;
};

export function JournalCard({ entry, now, online, onOpen, onReview, onUnlock }: JournalCardProps) {
  const kind = getKind(entry);
  const timestamp = formatEntryTimestamp(entry.createdAt, now);
  const pendingLine = getPendingLine(entry, online);
  const label = getLabel(entry, kind, timestamp, pendingLine);
  const isFinished = kind === "ready" || kind === "textOnly";
  // A card with a button of its own is not one grouped element: a button inside it must be reachable on its own.
  const hasButton =
    entry.pending?.status === "needs_action" || entry.pending?.status === "limit_reached";

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
      <CardFooter
        entry={entry}
        kind={kind}
        pendingLine={pendingLine}
        online={online}
        onReview={onReview}
        onUnlock={onUnlock}
      />
    </View>
  );

  // Only a finished entry and a crisis entry open Reflection. The others are one labelled element and
  // not a button. The Pressable carries only the style function: classes go on the inner View.
  if (!isFinished && kind !== "crisis") {
    return (
      <View accessible={!hasButton} accessibilityLabel={hasButton ? undefined : label}>
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
  pressedSoft: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  tabular: { fontVariant: ["tabular-nums"] },
});
