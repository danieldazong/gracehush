import { Image } from "expo-image";
import { useState, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AffirmationVerseBlock } from "@/components/AffirmationVerseBlock";
import { FadeIn } from "@/components/FadeIn";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { MAX_AFFIRMATIONS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import type { Affirmation, Devotional, ReflectionTab } from "@/types";
import { flowVerse, quoteVerse } from "@/utils/format";

const { tabs, affirmations: affirmationsCopy, closingPrayer: closingPrayerCopy } = copy.reflection;

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

// What the Affirmations pane offers under its last card (2026-11-09): one more affirmation at a time, up to MAX_AFFIRMATIONS.
// `onAdd` is null while the reflection cannot take one (a cached copy with no server answer yet); `remaining` is how many may
// still be added; at zero the button gives way to one line. `online` false shows the offline line instead of calling; `failed`
// shows the calm error line until the next tap.
export type AddAffirmationFooter = {
  onAdd: (() => void) | null;
  remaining: number;
  adding: boolean;
  online: boolean;
  failed: boolean;
};

// One card per affirmation: the headline, its verse and its text under the brand mark. The slot and its time left the
// cards on 2026-11-09 (the owner's request): which three reach the lock screen is the notifications' concern, not the
// card's. Every card is one element for a screen reader, which hears its place in the list first.
function AffirmationsPane({ affirmations, add }: { affirmations: Affirmation[]; add: AddAffirmationFooter | undefined }) {
  if (affirmations.length === 0) {
    return <Text className="text-body-sm text-mauve">{affirmationsCopy.empty}</Text>;
  }

  return (
    <View className="gap-2.5">
      {affirmations.map((affirmation, index) => (
        <View
          key={affirmation.id}
          accessible
          accessibilityLabel={affirmationsCopy.rowLabel(
            index + 1,
            affirmations.length,
            affirmation.headline,
            affirmation.text,
            affirmation.verse
              ? copy.affirmationVerse.spoken(quoteVerse(flowVerse(affirmation.verse.text)), affirmation.verse.reference)
              : null,
          )}
          className="flex-row items-start gap-3 rounded-xl border border-petal bg-linen/80 p-3"
        >
          <View className="size-8 items-center justify-center rounded-full border border-petal bg-blush">
            {/* The mark at 18, as the Rhythm step's sample notification draws it: a GraceHush affirmation. */}
            <Image source={images.logoMark} contentFit="contain" style={styles.mark} />
          </View>
          <View className="flex-1">
            <Text className="text-section text-ink">{affirmation.headline}</Text>
            {affirmation.verse ? (
              <View className="mt-2">
                <AffirmationVerseBlock verse={affirmation.verse} />
              </View>
            ) : null}
            <Text className="mt-2 text-body text-ink/80">{affirmation.text}</Text>
          </View>
        </View>
      ))}
      {add ? <AddAffirmationRow add={add} /> : null}
    </View>
  );
}

// The ghost button under the last card, with how many more may be added beside its label, or the one line once the reflection has
// them all. The error and offline lines are polite live regions, so a screen reader hears them without leaving the button.
function AddAffirmationRow({ add }: { add: AddAffirmationFooter }) {
  if (add.remaining <= 0) {
    return <Text className="pt-1 text-center text-body-sm text-mauve">{affirmationsCopy.allAdded(MAX_AFFIRMATIONS)}</Text>;
  }
  return (
    <View className="gap-2 pt-1">
      <PrimaryButton
        label={add.adding ? affirmationsCopy.adding : affirmationsCopy.add}
        tone="ghost"
        iconLeft={{ ios: "plus", android: "add" }}
        loading={add.adding}
        disabled={add.onAdd === null}
        onPress={() => add.onAdd?.()}
        accessibilityHint={affirmationsCopy.addLabel(add.remaining)}
      />
      {!add.adding && add.online && !add.failed ? (
        <Text className="text-center text-body-sm text-mauve">{affirmationsCopy.remaining(add.remaining)}</Text>
      ) : null}
      {!add.online ? (
        <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-mauve">
          {affirmationsCopy.addOffline}
        </Text>
      ) : null}
      {add.online && add.failed ? (
        <Text accessibilityLiveRegion="polite" className="text-center text-body-sm text-rosewood">
          {affirmationsCopy.addError}
        </Text>
      ) : null}
    </View>
  );
}

type ReflectionCarouselProps = {
  devotional: Devotional;
  affirmations: Affirmation[];
  initialTab?: ReflectionTab;
  // The Affirmations pane's footer (2026-11-09); without it the pane ends with its last card.
  add?: AddAffirmationFooter;
};

// Devotional, Affirmations and Prayer (the closing prayer) in one card. Only the selected pane is rendered, and it
// fades in when the tab changes. An entry without a closing prayer has two tabs. It opens on `initialTab`
// (a tapped affirmation notification, step 28), else on the devotional.
export function ReflectionCarousel({ devotional, affirmations, initialTab, add }: ReflectionCarouselProps) {
  const [tab, setTab] = useState<ReflectionTab>(initialTab ?? "devotional");
  const closingPrayer = devotional.closingPrayer?.trim() ?? "";

  const items: { value: ReflectionTab; label: string }[] = [
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
    pane = <AffirmationsPane affirmations={affirmations} add={add} />;
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

// expo-image takes a style, not a className (Style Exception Rules).
const styles = StyleSheet.create({
  mark: { width: 18, height: 18 },
});
