import type { SymbolViewProps } from "expo-symbols";
import { useState, type ReactElement } from "react";
import { Text, View } from "react-native";

import { FadeIn } from "@/components/FadeIn";
import { Icon } from "@/components/Icon";
import { SegmentedControl } from "@/components/SegmentedControl";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";
import type { Affirmation, Devotional, TimeSlot } from "@/types";
import { formatTime12 } from "@/utils/format";

const { tabs, affirmations: affirmationsCopy, closingPrayer: closingPrayerCopy } = copy.reflection;

const slotIcons = {
  morning: { android: "wb_twilight", ios: "sunrise.fill" },
  afternoon: { android: "wb_sunny", ios: "sun.max.fill" },
  evening: { android: "bedtime", ios: "moon.fill" },
} satisfies Record<TimeSlot, SymbolViewProps["name"]>;

// Exactly these values: step 28 opens the carousel on one of them.
type Tab = "devotional" | "affirmations" | "prayer";

// The script's paragraphs are separated by a blank line.
function DevotionalPane({ script }: { script: string }) {
  const paragraphs = script
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <View className="gap-3">
      {paragraphs.map((paragraph, index) => (
        // The paragraphs have no ids and never reorder while the pane is shown. The devotional is the
        // product, so it is read at body-lg (17/26), the size of the verse above it.
        <Text key={index} className="text-body-lg text-ink">
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

type AffirmationsPaneProps = {
  affirmations: Affirmation[];
  reminders: Record<TimeSlot, string>;
  currentSlot: TimeSlot;
};

// One row per affirmation. The current slot is marked with a plum bar, and every row is one element for
// a screen reader that says so.
function AffirmationsPane({ affirmations, reminders, currentSlot }: AffirmationsPaneProps) {
  if (affirmations.length === 0) {
    return <Text className="text-body-sm text-mauve">{affirmationsCopy.empty}</Text>;
  }

  return (
    <View className="gap-2.5">
      {affirmations.map((affirmation) => {
        const slotName = copy.onboarding.rhythm.slots[affirmation.slot].name;
        const time = formatTime12(reminders[affirmation.slot]);
        const isCurrent = affirmation.slot === currentSlot;

        return (
          <View
            key={affirmation.id}
            accessible
            accessibilityLabel={affirmationsCopy.rowLabel(
              slotName,
              time,
              isCurrent,
              affirmation.headline,
              affirmation.text,
            )}
            className="flex-row items-start gap-3 overflow-hidden rounded-xl border border-petal bg-linen/80 p-3"
          >
            {isCurrent ? <View className="absolute inset-y-0 left-0 w-[3px] bg-plum" /> : null}
            <View className="size-8 items-center justify-center rounded-full border border-petal bg-blush">
              <Icon name={slotIcons[affirmation.slot]} size={17} color={colors.rosewood} />
            </View>
            <View className="flex-1">
              <Text className="eyebrow">{affirmationsCopy.eyebrow(slotName, time)}</Text>
              <Text className="mt-0.5 text-section text-ink">{affirmation.headline}</Text>
              <Text className="mt-1 text-body text-ink/80">{affirmation.text}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

type ReflectionCarouselProps = {
  devotional: Devotional;
  affirmations: Affirmation[];
  reminders: Record<TimeSlot, string>;
  currentSlot: TimeSlot;
};

// Devotional, Affirmations and Closing Prayer in one card. Only the selected pane is rendered, and it
// fades in when the tab changes. An entry without a closing prayer has two tabs.
export function ReflectionCarousel({
  devotional,
  affirmations,
  reminders,
  currentSlot,
}: ReflectionCarouselProps) {
  const [tab, setTab] = useState<Tab>("devotional");
  const closingPrayer = devotional.closingPrayer?.trim() ?? "";

  const items: { value: Tab; label: string }[] = [
    { value: "devotional", label: tabs.devotional },
    { value: "affirmations", label: tabs.affirmations },
  ];
  if (closingPrayer) {
    items.push({ value: "prayer", label: tabs.prayer });
  }
  // The closing prayer can be gone after a reload, so a tab that no longer exists falls back to the first.
  const selected = items.some((item) => item.value === tab) ? tab : "devotional";

  let pane: ReactElement;
  if (selected === "affirmations") {
    pane = (
      <AffirmationsPane
        affirmations={affirmations}
        reminders={reminders}
        currentSlot={currentSlot}
      />
    );
  } else if (selected === "prayer") {
    pane = (
      <View className="rounded-xl border border-petal bg-blush/60 p-3">
        <Text className="text-scripture text-ink/90">{closingPrayerCopy(closingPrayer)}</Text>
      </View>
    );
  } else {
    pane = <DevotionalPane script={devotional.script} />;
  }

  return (
    <View className="card gap-3.5">
      <SegmentedControl
        items={items}
        value={selected}
        onChange={setTab}
        accessibilityLabel={tabs.label}
      />
      <FadeIn key={selected}>{pane}</FadeIn>
    </View>
  );
}
