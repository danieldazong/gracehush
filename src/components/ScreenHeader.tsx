import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import type { MainTabScreenProps } from "@/navigation/types";

const icons = {
  person: { android: "person", ios: "person" },
} satisfies Record<string, SymbolViewProps["name"]>;

type ScreenHeaderProps = {
  title: string;
  // "link" opens the Profile tab. Profile itself passes "static".
  avatar?: "link" | "static";
};

// The top safe-area inset is not applied here: each tab screen wraps the header in a top-edge
// SafeAreaView, with the header above its ScrollView.
export function ScreenHeader({ title, avatar = "link" }: ScreenHeaderProps) {
  const navigation = useNavigation<MainTabScreenProps<"Journal">["navigation"]>();

  const avatarCircle = (
    <View className="size-8 items-center justify-center rounded-full bg-plum-deep">
      <Icon name={icons.person} size={18} color="white" />
    </View>
  );

  return (
    <View className="border-b border-petal bg-linen">
      <View className="screen__content h-16 flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <Image
            source={images.logoMark}
            contentFit="contain"
            style={styles.emblem}
          />
          <Text
            accessibilityRole="header"
            accessibilityLabel={copy.header.a11y(title)}
            maxFontSizeMultiplier={1.3}
            className="font-fraunces-semibold text-[22px] leading-[26px] tracking-[-0.55px] text-plum-deep"
          >
            {copy.header.wordmark.grace}
            <Text className="text-rosewood">{copy.header.wordmark.hush}</Text>
          </Text>
        </View>
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
  // The lockup: the mark's visible height (72% of the box, 29 dp) spans the whole 22-px wordmark with a little over
  // at the flame's tip, so the mark anchors the name instead of trailing it; the 6-dp gap plus the box's own padding
  // leaves about 12 dp between the two.
  emblem: { width: 40, height: 40 },
  pressed: { opacity: 0.7 },
});
