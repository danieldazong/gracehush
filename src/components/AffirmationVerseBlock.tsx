import { Text, View } from "react-native";

import { copy } from "@/constants/copy";
import type { AffirmationVerse } from "@/types";
import { flowVerse, quoteVerse } from "@/utils/format";

// Step 37: the Bible verse under an affirmation's headline, as the lock screen shows it: the verse's own words in curly
// quotes as one flowing line (its line breaks fall in the wrong places on a phone), then its reference. A soft blush panel
// like the closing prayer's, so scripture reads as scripture. The two Texts are read in order by a screen reader; a parent
// that is one accessible element (Reflection's affirmation rows) says the verse in its own label.
export function AffirmationVerseBlock({ verse }: { verse: AffirmationVerse }) {
  return (
    <View className="self-stretch rounded-xl border border-petal bg-blush/60 px-3 py-2.5">
      {/* Fraunces italic takes its width from the layout (the vendor note on italic text that measures itself). */}
      <Text className="self-stretch font-fraunces-italic text-[15px] leading-[22px] text-ink/90">
        {quoteVerse(flowVerse(verse.text))}
      </Text>
      <Text className="mt-1 font-dm-semibold text-[13px] leading-[18px] text-rosewood">
        {copy.affirmationVerse.reference(verse.reference)}
      </Text>
    </View>
  );
}
