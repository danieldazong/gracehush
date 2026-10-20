import { Pressable, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";
import type { JournalFilter } from "@/data/selectors";

const FILTERS: readonly JournalFilter[] = [
  "all",
  "anxious",
  "weary",
  "grateful",
  "grieving",
  "hopeful",
  "prayers",
];

type JournalFilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  filter: JournalFilter;
  onChange: (filter: JournalFilter) => void;
  // How many reflections the current filter shows.
  count: number;
};

// A chip applies at once, so the list behind the sheet updates while it is open.
export function JournalFilterSheet({
  visible,
  onClose,
  filter,
  onChange,
  count,
}: JournalFilterSheetProps) {
  const text = copy.journal.filter;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text accessibilityRole="header" className="text-headline text-ink">
        {text.title}
      </Text>
      <View className="mt-6 flex-row flex-wrap gap-2">
        {FILTERS.map((value) => {
          const selected = value === filter;
          // Every chip has the 1.5 border, transparent when not selected, so choosing one never
          // changes its size.
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={text.chips[value]}
              accessibilityState={{ selected }}
              // The chip is 29 tall, so 8 above and below makes a 45 touch area.
              hitSlop={{ top: 8, bottom: 8 }}
              onPress={() => onChange(value)}
            >
              <View
                className={
                  selected
                    ? "chip border-[1.5px] border-plum"
                    : "chip border-[1.5px] border-transparent"
                }
              >
                <Text className={selected ? "chip__label text-plum" : "chip__label"}>
                  {text.chips[value]}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View className="mt-6">
        <PrimaryButton label={text.show(count)} onPress={onClose} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.reset}
        className="mt-2 min-h-11 items-center justify-center"
        onPress={() => onChange("all")}
      >
        {/* plum, not rosewood: a text link on a blush surface is plum (AGENTS.md, colors) */}
        <Text className="btn-text__label text-plum">{text.reset}</Text>
      </Pressable>
    </BottomSheet>
  );
}
