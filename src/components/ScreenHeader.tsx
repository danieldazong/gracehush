import { useNavigation } from "@react-navigation/native";
import { Pressable, StyleSheet, View } from "react-native";

import { UserAvatar } from "@/components/UserAvatar";
import { Wordmark } from "@/components/Wordmark";
import { copy } from "@/constants/copy";
import type { MainTabScreenProps } from "@/navigation/types";

type ScreenHeaderProps = {
  title: string;
  // "link" opens the Profile tab. Profile itself passes "static".
  avatar?: "link" | "static";
};

// The top safe-area inset is not applied here: each tab screen wraps the header in a top-edge
// SafeAreaView, with the header above its ScrollView.
export function ScreenHeader({ title, avatar = "link" }: ScreenHeaderProps) {
  const navigation = useNavigation<MainTabScreenProps<"Journal">["navigation"]>();

  // The same picture as Profile's account header, so the person sees themselves on every tab.
  const avatarCircle = <UserAvatar size={32} />;

  return (
    <View className="border-b border-petal bg-linen">
      <View className="screen__content h-16 flex-row items-center justify-between">
        {/* The lockup the Welcome step and Sign In also draw (2026-11-01); here it is the screen's header. */}
        <Wordmark accessibilityRole="header" accessibilityLabel={copy.header.a11y(title)} />
        {avatar === "link" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.header.openProfile}
            hitSlop={6}
            onPress={() => navigation.navigate("Profile")}
            style={({ pressed }) => pressed && styles.pressed}
          >
            {avatarCircle}
          </Pressable>
        ) : (
          avatarCircle
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
