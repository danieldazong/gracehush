import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
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
};

// Before the first live talk (step 39): one sheet with two steps, so no sheet has to open another. Step 1 asks to let ElevenLabs
// hear and speak (Apple's guideline 5.1.2(i)); nothing is sent and no microphone opens before Allow. Step 2 chooses Scholar's
// voice, with a preview of each. The scrim, the back key and "Not now" close it and send nothing.
export function TalkSheet({ step, voice, onAllow, onChooseVoice, onStart, onClose, onDismiss, onOpenPrivacy }: TalkSheetProps) {
  const permission = copy.voicePermission;
  const voices = copy.scholarVoice;
  return (
    <BottomSheet visible={step !== null} onClose={onClose} onDismiss={onDismiss}>
      {step === "voice" ? (
        <View className="gap-4">
          <Text accessibilityRole="header" className="text-headline text-plum-deep">
            {voices.title}
          </Text>
          <VoiceRows selected={voice} onSelect={onChooseVoice} />
          <PrimaryButton label={voices.start} onPress={onStart} />
          <Text className="text-center text-body-sm text-mauve">{voices.changeLater}</Text>
        </View>
      ) : (
        <View className="gap-4">
          <Text accessibilityRole="header" className="text-headline text-plum-deep">
            {permission.title}
          </Text>
          <Text className="text-body text-ink">{permission.body}</Text>
          <Text className="text-body text-mauve">{permission.trust}</Text>
          <Text className="text-center text-body-sm text-mauve">{permission.caption}</Text>
          <View className="gap-2">
            <PrimaryButton label={permission.allow} onPress={onAllow} />
            <PrimaryButton label={permission.notNow} tone="ghost" onPress={onClose} />
          </View>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={permission.privacy}
            onPress={onOpenPrivacy}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View className="min-h-11 items-center justify-center">
              <Text className="text-label-md text-plum">{permission.privacy}</Text>
            </View>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
