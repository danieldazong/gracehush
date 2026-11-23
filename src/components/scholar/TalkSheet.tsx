import { Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { VoicePermissionStep } from "@/components/scholar/VoicePermissionStep";
import { VoiceRows } from "@/components/scholar/VoiceRows";
import { copy } from "@/constants/copy";
import type { ScholarVoiceKey } from "@/constants/scholarVoices";

export type TalkSheetStep = "permission" | "voice";

type TalkSheetProps = {
  // Null hides the sheet.
  step: TalkSheetStep | null;
  voice: ScholarVoiceKey;
  onAllow: () => void;
  onChooseVoice: (voice: ScholarVoiceKey) => void;
  onStart: () => void;
  onClose: () => void;
  onDismiss?: () => void;
  onOpenPrivacy: () => void;
  // An account that is not subscribed (2026-11-20): the other voices are Pro, and a tap on one calls `onLocked`.
  locked?: boolean;
  onLocked?: (voice: ScholarVoiceKey) => void;
};

// Before the first live talk (step 39): one sheet with two steps, so no sheet has to open another. Step 1 asks to let ElevenLabs
// hear and speak (Apple's guideline 5.1.2(i)); nothing is sent and no microphone opens before Allow. Step 2 chooses Scholar's
// voice, with a preview of each. The scrim, the back key and "Not now" close it and send nothing.
export function TalkSheet({
  step,
  voice,
  onAllow,
  onChooseVoice,
  onStart,
  onClose,
  onDismiss,
  onOpenPrivacy,
  locked = false,
  onLocked,
}: TalkSheetProps) {
  const voices = copy.scholarVoice;
  return (
    <BottomSheet visible={step !== null} onClose={onClose} onDismiss={onDismiss}>
      {step === "voice" ? (
        <View className="gap-4">
          <Text accessibilityRole="header" className="text-headline text-plum-deep">
            {voices.title}
          </Text>
          <VoiceRows selected={voice} onSelect={onChooseVoice} locked={locked} onLocked={onLocked} />
          <PrimaryButton label={voices.start} onPress={onStart} />
          <Text className="text-center text-body-sm text-mauve">{voices.changeLater}</Text>
        </View>
      ) : (
        <VoicePermissionStep onAllow={onAllow} onNotNow={onClose} onOpenPrivacy={onOpenPrivacy} />
      )}
    </BottomSheet>
  );
}
