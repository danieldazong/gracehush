import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import { getDaysSince } from "@/data/selectors";
import type { Prayer } from "@/types";
import { getPrayerTitle } from "@/utils/format";

const icons = {
  days: { android: "hourglass_top", ios: "hourglass" },
  reference: { android: "menu_book", ios: "book" },
  markAnswered: { android: "check_circle", ios: "checkmark.circle" },
  answered: { android: "favorite", ios: "heart.fill" },
  more: { android: "more_horiz", ios: "ellipsis" },
} satisfies Record<string, SymbolViewProps["name"]>;

// A union, so an answered card cannot be given an Active handler. A prayer card is a plain View: the text
// block is one button that opens the reflection, and every other control is its own button beside it, because a
// Pressable groups its children for a screen reader and a control inside it could not be reached.
type PrayerCardProps =
  | {
      variant: "active";
      prayer: Prayer;
      now: Date;
      onOpen: (prayerId: string) => void;
      onMarkAnswered: (prayer: Prayer) => void;
      onOpenMenu: (prayer: Prayer) => void;
    }
  | {
      variant: "answered";
      prayer: Prayer;
      onOpen: (prayerId: string) => void;
      onOpenMenu: (prayer: Prayer) => void;
      onAddNote: (prayer: Prayer) => void;
    };

// The scripture reference both variants end with. DM Sans has no italic loaded, so it is Fraunces italic, like
// the Journal card's. Its width comes from the layout (flex-1), never from the text's own measure: an italic
// Text sized to its measured width wraps, and only its first word shows (found on Android). The group takes
// the free space of the row, and the button beside it drops under it when they do not both fit.
function Reference({ reference }: { reference: string }) {
  return (
    <View className="min-w-[120px] flex-1 flex-row items-center gap-1.5">
      <Icon name={icons.reference} size={16} color={colors.rosewood} />
      <Text className="flex-1 font-fraunces-italic text-[13px] leading-[19px] text-rosewood">
        {reference}
      </Text>
    </View>
  );
}

type ActiveCardProps = Extract<PrayerCardProps, { variant: "active" }>;

function ActiveCard({ prayer, now, onOpen, onMarkAnswered, onOpenMenu }: ActiveCardProps) {
  const title = getPrayerTitle(prayer);
  const days = copy.prayers.card.days(getDaysSince(prayer.createdAt, now));
  const summary = prayer.summary.trim();

  return (
    <View className="card gap-4 p-6" style={shadows.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.prayers.card.a11y([prayer.category, title, days, summary])}
        accessibilityHint={copy.prayers.card.openHint}
        onPress={() => onOpen(prayer.id)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="gap-4">
          {/* min-w-[150px] makes the days chip drop under the title when the title would get narrower than that, and pr-9 keeps both clear of the menu button in the corner (step 29b). */}
          <View className="flex-row flex-wrap items-start justify-between gap-x-2 gap-y-2 pr-9">
            <View className="min-w-[150px] flex-1 gap-1">
              {prayer.category ? <Text className="eyebrow">{prayer.category}</Text> : null}
              <Text className="text-section text-plum-deep">{title}</Text>
            </View>
            <View className="chip shrink-0 gap-1">
              <Icon name={icons.days} size={15} color={colors.mauve} />
              <Text className="chip__label">{days}</Text>
            </View>
          </View>
          {summary === "" ? null : <Text className="text-body text-ink/80">{summary}</Text>}
        </View>
      </Pressable>
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {prayer.scriptureReference ? <Reference reference={prayer.scriptureReference} /> : null}
        {/* The margin pushes the button to the right, also when the row wraps. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.prayers.card.markAnsweredLabel(title)}
          onPress={() => onMarkAnswered(prayer)}
          style={({ pressed }) => [styles.alignRight, pressed && styles.pressed]}
        >
          <View className="min-h-11 flex-row items-center gap-1.5 rounded-full border border-petal px-4">
            <Icon name={icons.markAnswered} size={16} color={colors.terracotta} />
            <Text className="text-label-md text-plum-deep">{copy.prayers.card.markAnswered}</Text>
          </View>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.prayers.card.more(title)}
        onPress={() => onOpenMenu(prayer)}
        style={({ pressed }) => [styles.overflow, pressed && styles.pressed]}
      >
        <View className="size-11 items-center justify-center">
          <Icon name={icons.more} size={20} color={colors.mauve} />
        </View>
      </Pressable>
    </View>
  );
}

type AnsweredCardProps = Extract<PrayerCardProps, { variant: "answered" }>;

// The answered date and "After N days" are the timeline row above this card (PrayersScreen).
function AnsweredCard({ prayer, onOpen, onOpenMenu, onAddNote }: AnsweredCardProps) {
  const title = getPrayerTitle(prayer);
  const note = prayer.answeredNote?.trim() ?? "";

  return (
    <View className="card gap-4 p-6" style={shadows.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.prayers.card.a11y([
          title,
          note === "" ? null : copy.prayers.card.note(note),
        ])}
        accessibilityHint={copy.prayers.card.openHint}
        onPress={() => onOpen(prayer.id)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View className="gap-2">
          {/* pr-11 keeps the title out from under the overflow button. */}
          <Text className="pr-11 text-section text-plum-deep">{title}</Text>
          {note === "" ? null : (
            <View className="rounded border border-petal bg-linen p-2">
              <Text className="font-fraunces-italic text-[15px] leading-[23px] text-ink/80">
                {copy.prayers.card.note(note)}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
      {note === "" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.prayers.card.addNoteLabel(title)}
          onPress={() => onAddNote(prayer)}
          style={({ pressed }) => [styles.alignStart, pressed && styles.pressed]}
        >
          <View className="min-h-11 justify-center">
            <Text className="btn-text__label text-plum">{copy.prayers.card.addNote}</Text>
          </View>
        </Pressable>
      ) : null}
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {prayer.scriptureReference ? <Reference reference={prayer.scriptureReference} /> : null}
        <View className="ml-auto flex-row items-center gap-1">
          <Icon name={icons.answered} size={15} color={colors.terracotta} />
          <Text className="text-label-md text-mauve">{copy.prayers.card.answered}</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.prayers.card.more(title)}
        onPress={() => onOpenMenu(prayer)}
        style={({ pressed }) => [styles.overflow, pressed && styles.pressed]}
      >
        <View className="size-11 items-center justify-center">
          <Icon name={icons.more} size={20} color={colors.mauve} />
        </View>
      </Pressable>
    </View>
  );
}

export function PrayerCard(props: PrayerCardProps) {
  return props.variant === "active" ? <ActiveCard {...props} /> : <AnsweredCard {...props} />;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  alignRight: { marginLeft: "auto" },
  alignStart: { alignSelf: "flex-start" },
  overflow: { position: "absolute", right: 8, top: 8 },
});
