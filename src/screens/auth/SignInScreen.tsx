import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { PrivacyNoteCard } from "@/components/PrivacyNoteCard";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useAuthActions } from "@/hooks/useAuthActions";
import type { RootStackParamList } from "@/navigation/types";

import { EmailSheet } from "./EmailSheet";

const { back, stepLabel, title, subtitle, apple, google, email, or, privacy } = copy.auth;

const icons = {
  back: { android: "chevron_left", ios: "chevron.left" },
  mail: { android: "mail", ios: "envelope" },
} as const;

type AuthButtonProps = {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  dark?: boolean;
  gap?: "gap-3" | "gap-2.5";
  pending?: boolean;
  disabled?: boolean;
};

// Local to this screen: the three sign-in buttons share one shape and one set of states.
function AuthButton({
  label,
  icon,
  onPress,
  dark = false,
  gap = "gap-3",
  pending = false,
  disabled = false,
}: AuthButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: pending }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed, disabled && !pending && styles.disabled]}
    >
      <View className={dark ? `btn-ghost ${gap} border-black bg-black` : `btn-ghost ${gap}`}>
        {/* Decorative: the label already names the button. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {pending ? <ActivityIndicator color={dark ? "white" : colors.plum} /> : icon}
        </View>
        <Text className={dark ? "btn-ghost__label text-white" : "btn-ghost__label"}>{label}</Text>
      </View>
    </Pressable>
  );
}

type SignInScreenProps = NativeStackScreenProps<RootStackParamList, "SignIn">;

export function SignInScreen({ navigation }: SignInScreenProps) {
  const { continueWithApple, continueWithGoogle } = useAuthActions();
  const [pending, setPending] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  useAnnounce(error);

  async function signInWith(provider: "apple" | "google") {
    setError(null);
    setPending(provider);
    const result = await (provider === "apple" ? continueWithApple() : continueWithGoogle());
    // On success the navigator replaces this screen once the session is active, so keep the spinner.
    if (result.ok) {
      return;
    }
    setPending(null);
    if (result.code !== "CANCELLED") {
      setError(result.message);
    }
  }

  const busy = pending !== null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View className="screen__content">
          <View className="h-14 flex-row items-center justify-between">
            {navigation.canGoBack() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={back}
                onPress={() => navigation.goBack()}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <View className="size-11 items-center justify-center">
                  <Icon name={icons.back} size={24} color={colors.ink} />
                </View>
              </Pressable>
            ) : (
              <View className="size-11" />
            )}
            <Text className="text-label-md tracking-[0.3px] text-mauve">{stepLabel}</Text>
            <View className="size-11" />
          </View>

          <View className="items-center">
            <View
              className="icon-tile mt-2 size-16 border border-petal/60"
              style={shadows.card}
            >
              <Image
                source={images.logoMark}
                contentFit="contain"
                tintColor={colors.rosewood}
                style={styles.logoMark}
              />
            </View>
            <Text className="mt-5 text-center text-title tracking-[-0.7px] text-ink">{title}</Text>
            <Text className="mt-2 max-w-[290px] text-center text-body text-mauve">{subtitle}</Text>
          </View>

          <View className="mt-8 gap-3">
            {/* The native Apple flow is iOS-only; App Store Guideline 4.8 applies to iOS only. */}
            {Platform.OS === "ios" ? (
              <AuthButton
                dark
                label={apple}
                icon={<Image source={images.appleLogo} contentFit="contain" style={styles.logo} />}
                pending={pending === "apple"}
                disabled={busy}
                onPress={() => signInWith("apple")}
              />
            ) : null}
            <AuthButton
              label={google}
              icon={<Image source={images.googleG} contentFit="contain" style={styles.logo} />}
              pending={pending === "google"}
              disabled={busy}
              onPress={() => signInWith("google")}
            />
          </View>

          <View className="my-4 flex-row items-center gap-3">
            <View className="divider flex-1" />
            <Text className="text-body-sm text-mauve">{or}</Text>
            <View className="divider flex-1" />
          </View>

          <AuthButton
            gap="gap-2.5"
            label={email}
            icon={<Icon name={icons.mail} size={19} color={colors.rosewood} />}
            disabled={busy}
            onPress={() => setEmailOpen(true)}
          />
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="mt-3 text-center text-body-sm text-rosewood"
            >
              {error}
            </Text>
          ) : null}

          <View className="mt-6">
            <PrivacyNoteCard title={privacy.title} body={privacy.body} />
          </View>
        </View>
      </ScrollView>

      <EmailSheet visible={emailOpen} onClose={() => setEmailOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  content: { paddingBottom: 24 },
  logoMark: { width: 32, height: 32 },
  logo: { width: 16, height: 16 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
});
