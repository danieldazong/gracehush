import type { SymbolViewProps } from "expo-symbols";
import { Fragment } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";

const text = copy.aiPermission;

const closeIcon = { android: "close", ios: "xmark" } satisfies SymbolViewProps["name"];

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <View className="min-h-11 items-center justify-center px-2">
        <Text className="text-label-lg text-plum">{label}</Text>
      </View>
    </Pressable>
  );
}

type AiPermissionViewProps = {
  onAllow: () => void;
  onNotNow: () => void;
  onOpenSupport: () => void;
  onOpenPrivacy: () => void;
};

// What New Entry shows until this account has answered (Apple's guideline 5.1.2(i)): who receives a prayer, what they receive, why,
// and what they may do with it, before anything can be said or written. The answers and the way to reach someone are pinned under
// the page, so they are on screen at every text size. Someone may reach it at a very hard moment, so it stays calm: no motion, no
// tap, no event and no log line.
export function AiPermissionView({ onAllow, onNotNow, onOpenSupport, onOpenPrivacy }: AiPermissionViewProps) {
  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View className="screen__content min-h-14 flex-row items-center gap-2 py-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.common.close}
          onPress={onNotNow}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View className="size-11 items-center justify-center">
            <Icon name={closeIcon} size={20} color={colors.ink} />
          </View>
        </Pressable>
        <Text className="eyebrow shrink">{text.eyebrow}</Text>
      </View>

      <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
        <View className="screen__content gap-4">
          <View className="gap-2">
            <Text accessibilityRole="header" className="text-headline text-plum-deep">
              {text.title}
            </Text>
            <Text className="text-body text-ink">{text.lead}</Text>
          </View>
          <View className="card gap-3" style={shadows.card}>
            {text.rows.map((row, index) => (
              <Fragment key={row.label}>
                {index === 0 ? null : <View className="divider" />}
                <View className="gap-1">
                  <Text className="text-label-lg text-plum-deep">{row.label}</Text>
                  <Text className="text-body text-ink">{row.body}</Text>
                </View>
              </Fragment>
            ))}
          </View>
          <Text className="text-body-sm text-mauve">{text.footnote}</Text>
        </View>
      </ScrollView>

      <View className="screen__content gap-2 pt-3">
        <PrimaryButton label={text.allow} onPress={onAllow} />
        <PrimaryButton label={text.notNow} tone="ghost" onPress={onNotNow} />
        <View className="flex-row flex-wrap justify-center gap-x-4">
          <TextLink label={text.privacy} onPress={onOpenPrivacy} />
          <TextLink label={text.support} onPress={onOpenSupport} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  page: { flex: 1 },
  pageContent: { paddingBottom: 12 },
  pressed: { opacity: 0.6 },
});
