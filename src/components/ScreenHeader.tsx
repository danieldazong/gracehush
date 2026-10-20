import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors } from "@/constants/theme";
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
        <View className="flex-row items-center gap-2">
          <Image
            source={images.logoMark}
            contentFit="contain"
            tintColor={colors.plum}
            style={styles.emblem}
          />
          <View>
            <Text className="eyebrow font-dm-semibold leading-[11px] tracking-[2.4px]">
              {copy.header.eyebrow}
            </Text>
            <Text
              accessibilityRole="header"
              className="font-fraunces-medium text-[21px] leading-[26px] text-plum-deep"
            >
              {title}
            </Text>
          </View>
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
  emblem: { width: 32, height: 32 },
  pressed: { opacity: 0.7 },
});
