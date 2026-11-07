import { Text, View } from "react-native";

import { copy } from "@/constants/copy";
import type { Scripture } from "@/types";
import { flowVerse, quoteVerse } from "@/utils/format";

const { scripture: scriptureCopy } = copy.reflection;

type ScriptureCardProps = {
  scripture: Scripture;
};

// The verse renders only for verified scripture. An unverified passage shows its reference and a calm
// note: its text is null in the data, and never shown. The verse is set as one flowing paragraph
// (flowVerse): the Bible's own lines of poetry would wrap at the wrong places in a card this narrow,
// and the breaks are balanced so that no word is left alone on a line.
export function ScriptureCard({ scripture }: ScriptureCardProps) {
  const { reference, text, verified } = scripture;
  const flowed = verified && text ? flowVerse(text) : null;

  return (
    <View
      accessible
      accessibilityLabel={scriptureCopy.a11y(reference, flowed ?? scriptureCopy.confirming)}
      className="card card--blush"
    >
      {/* No flex-1 on the reference, so the pill drops under it when they do not fit side by side. */}
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Text className="text-scripture-ref">{reference}</Text>
        <View className="shrink-0 rounded-full border border-petal bg-card/70 px-2 py-0.5">
          <Text className="eyebrow">{scriptureCopy.translation}</Text>
        </View>
      </View>
      {flowed ? (
        <Text
          className="mt-2.5 text-scripture text-ink/90"
          textBreakStrategy="balanced"
          lineBreakStrategyIOS="push-out"
        >
          {quoteVerse(flowed)}
        </Text>
      ) : (
        <Text className="mt-2.5 text-body-sm text-mauve">{scriptureCopy.confirming}</Text>
      )}
    </View>
  );
}
