import { Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";

type VoicePermissionStepProps = {
  onAllow: () => void;
  onNotNow: () => void;
  onOpenPrivacy: () => void;
};

// The ElevenLabs permission (step 39; since 2026-11-19 it also covers Listen in the chosen voice): one step of a sheet, before the
// first live talk (TalkSheet) and before Scholar's voice is chosen in a conversation (its voice sheet). Nothing is sent before
// Allow (Apple's guideline 5.1.2(i)); "Not now" closes the sheet and sends nothing.
export function VoicePermissionStep({ onAllow, onNotNow, onOpenPrivacy }: VoicePermissionStepProps) {
  const permission = copy.voicePermission;
  return (
    <View className="gap-4">
      <Text accessibilityRole="header" className="text-headline text-plum-deep">
        {permission.title}
      </Text>
      <Text className="text-body text-ink">{permission.body}</Text>
      <Text className="text-body text-mauve">{permission.trust}</Text>
      <Text className="text-center text-body-sm text-mauve">{permission.caption}</Text>
      <View className="gap-2">
        <PrimaryButton label={permission.allow} onPress={onAllow} />
        <PrimaryButton label={permission.notNow} tone="ghost" onPress={onNotNow} />
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
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
