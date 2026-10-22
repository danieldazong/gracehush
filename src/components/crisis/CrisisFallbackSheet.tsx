import { Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";
import type { CrisisFallback } from "@/hooks/useCrisisActions";

const { fallback: strings } = copy.crisis;

function getInstruction({ kind, body }: CrisisFallback) {
  if (kind === "call") return strings.call;
  if (kind === "web") return strings.web;
  return body === undefined ? strings.text : strings.textWithBody(body);
}

type CrisisFallbackSheetProps = {
  // Null until a link has failed once: nothing is rendered then. The value stays after the sheet closes.
  fallback: CrisisFallback | null;
  visible: boolean;
  onClose: () => void;
};

// What the user sees when the phone cannot open a call, text or web link (no phone app, no messaging app).
// The number or address is large and selectable, so a long press copies it.
export function CrisisFallbackSheet({ fallback, visible, onClose }: CrisisFallbackSheetProps) {
  if (fallback === null) return null;

  const value =
    fallback.kind === "web" ? "mt-3 text-section text-ink" : "mt-3 text-title text-ink";

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text accessibilityRole="header" className="text-section text-plum-deep">
        {strings.title}
      </Text>
      <Text selectable className={value}>
        {fallback.value}
      </Text>
      <Text className="mt-2 text-body text-mauve">{getInstruction(fallback)}</Text>
      <View className="mt-5">
        <PrimaryButton tone="ghost" label={strings.close} onPress={onClose} />
      </View>
    </BottomSheet>
  );
}
