import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors } from "@/constants/theme";
import { haptics } from "@/services/haptics";
import type { AcquisitionSource } from "@/types";

// Onboarding's second step (2026-11-20): "How did you hear about GraceHush?". One tap on a tile, no typing; the footer's
// Continue waits for a tile and its Skip is always there. Eight places in two columns, in an order drawn once per launch so
// no place is favoured by being first, then "Something else" across the whole width, always last.

const { source } = copy.onboarding;

type Answer = Exclude<AcquisitionSource, "skipped">;
type Place = Exclude<Answer, "other">;

const PLACES: readonly Place[] = [
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
  "google",
  "app_store",
  "friend_family",
  "church",
];

// Drawn once per launch (Fisher–Yates), outside render: a random order in render would change on every draw.
function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const ORDER = shuffled(PLACES);
const ROWS: Place[][] = [];
for (let i = 0; i < ORDER.length; i += 2) {
  ROWS.push(ORDER.slice(i, i + 2));
}

// Each brand's own mark (expo-image draws the SVGs); the three that are not a brand get a glyph in the same white circle,
// with the petal ring Google's G has, so the nine read as one set.
const LOGOS: Partial<Record<Answer, number>> = {
  tiktok: images.sourceTikTok,
  instagram: images.sourceInstagram,
  facebook: images.sourceFacebook,
  youtube: images.sourceYouTube,
  google: images.sourceGoogle,
  app_store: images.sourceAppStore,
};

const GLYPHS: Partial<Record<Answer, SymbolViewProps["name"]>> = {
  friend_family: { android: "group", ios: "person.2" },
  other: { android: "more_horiz", ios: "ellipsis" },
};

const CHECK: SymbolViewProps["name"] = { android: "check_circle", ios: "checkmark.circle.fill" };

const ICON = 28;

function TileIcon({ answer }: { answer: Answer }) {
  const logo = LOGOS[answer];
  if (logo !== undefined) {
    return <Image source={logo} contentFit="contain" style={styles.logo} accessible={false} />;
  }
  const glyph = GLYPHS[answer];
  return (
    <View className="size-7 items-center justify-center rounded-full border border-petal bg-card">
      {glyph === undefined ? (
        <Image source={images.sourceChurch} contentFit="contain" style={styles.church} accessible={false} />
      ) : (
        <Icon name={glyph} size={16} color={colors.plum} />
      )}
    </View>
  );
}

type TileProps = {
  answer: Answer;
  selected: boolean;
  onPress: () => void;
};

function Tile({ answer, selected, onPress }: TileProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={source.options[answer]}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View
        className={
          selected
            ? "min-h-14 flex-1 flex-row items-center gap-2 rounded-card border-[1.5px] border-plum bg-blush px-3 py-2.5"
            : "min-h-14 flex-1 flex-row items-center gap-2 rounded-card border-[1.5px] border-petal bg-card px-3 py-2.5"
        }
      >
        <TileIcon answer={answer} />
        <Text className="flex-1 font-dm-medium text-[15px] leading-[20px] text-ink" numberOfLines={2}>
          {source.options[answer]}
        </Text>
        {/* The check's place is kept on every tile, so a label never moves when its tile is chosen. */}
        <View style={styles.checkSlot}>
          {selected ? <Icon name={CHECK} size={18} color={colors.plum} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

type SourceStepProps = {
  selected: AcquisitionSource | null;
  onSelect: (answer: Answer) => void;
};

export function SourceStep({ selected, onSelect }: SourceStepProps) {
  // One small tick for a changed choice, as the app's other pickers do; pressing the chosen tile again does nothing.
  function choose(answer: Answer) {
    if (answer === selected) return;
    haptics.selection();
    onSelect(answer);
  }

  return (
    <>
      <View className="gap-2">
        <Text className="eyebrow">{source.eyebrow}</Text>
        <Text className="text-headline-lg text-ink">{source.title}</Text>
        <Text className="text-body text-mauve">{source.subtitle}</Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={source.groupLabel} className="mt-6 gap-2.5">
        {ROWS.map((row) => (
          <View key={row.join("-")} className="flex-row gap-2.5">
            {row.map((answer) => (
              <Tile key={answer} answer={answer} selected={selected === answer} onPress={() => choose(answer)} />
            ))}
          </View>
        ))}
        <View className="flex-row">
          <Tile answer="other" selected={selected === "other"} onPress={() => choose("other")} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  logo: { width: ICON, height: ICON },
  church: { width: 18, height: 18 },
  checkSlot: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
});
