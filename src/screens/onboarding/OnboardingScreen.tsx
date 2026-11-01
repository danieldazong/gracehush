import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { SymbolViewProps } from "expo-symbols";
import { useCallback, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { openAndroidTimeDialog, ReminderTimePicker } from "@/components/ReminderTimePicker";
import { copy } from "@/constants/copy";
import { analyticsEnv } from "@/constants/env";
import { images } from "@/constants/images";
import { colors, gradients, radii, shadows } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/types";
import { track } from "@/services/analytics";
import { getNotificationPermission, requestNotificationPermission } from "@/services/notifications";
import { getMicPermission, requestMicPermission } from "@/services/recorder";
import { useOnboardingStore } from "@/store/onboardingStore";
import { formatTime12 } from "@/utils/format";

const { stepCounter, stepLabel, welcome, rhythm, permissions, analytics: consent } = copy.onboarding;

// The consent step (step 34) exists only when a PostHog token is set: without one there is nothing to agree to.
const STEP_COUNT = analyticsEnv.status === "ok" ? 4 : 3;
const CONSENT_STEP = 3;
// Fade out, swap the step, fade in: about 200ms in total.
const FADE_MS = 100;

const icons = {
  morning: { android: "wb_sunny", ios: "sun.max" },
  afternoon: { android: "partly_cloudy_day", ios: "cloud.sun" },
  evening: { android: "bedtime", ios: "moon" },
  time: { android: "schedule", ios: "clock" },
  arrow: { android: "arrow_forward", ios: "arrow.right" },
  check: { android: "check", ios: "checkmark" },
  microphone: { android: "mic", ios: "mic" },
  notifications: { android: "notifications", ios: "bell" },
  privacy: { android: "lock", ios: "lock" },
  analytics: { android: "bar_chart", ios: "chart.bar" },
} satisfies Record<string, SymbolViewProps["name"]>;

const slots = [
  { key: "morning", icon: icons.morning },
  { key: "afternoon", icon: icons.afternoon },
  { key: "evening", icon: icons.evening },
] as const;

type SlotKey = (typeof slots)[number]["key"];

type StepCard = { icon: SymbolViewProps["name"]; title: string; body: string };

const permissionCards: readonly StepCard[] = [
  { icon: icons.microphone, ...permissions.microphone },
  { icon: icons.notifications, ...permissions.notifications },
];

const consentCards: readonly StepCard[] = [
  { icon: icons.analytics, title: consent.sharedTitle, body: consent.sharedBody },
  { icon: icons.privacy, title: consent.neverTitle, body: consent.neverBody },
];

// The Permissions and consent steps' cards: an icon in a blush circle, a title and a line under it.
function StepCards({ cards }: { cards: readonly StepCard[] }) {
  return (
    <View className="mt-6 gap-3.5">
      {cards.map(({ icon, title, body }) => (
        <View key={title} className="card flex-row items-start gap-4 p-5" style={shadows.card}>
          <View className="size-12 items-center justify-center rounded-full bg-blush">
            <Icon name={icon} size={24} color={colors.plum} />
          </View>
          <View className="flex-1">
            <Text className="text-label-lg text-ink">{title}</Text>
            <Text className="mt-1 text-body text-mauve">{body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// The blush line with a lock under those cards.
function PrivacyLine({ text }: { text: string }) {
  return (
    <View className="mt-5 flex-row items-center justify-center gap-2 rounded-input bg-blush px-3 py-2">
      <Icon name={icons.privacy} size={14} color={colors.plum} />
      <Text className="shrink text-center text-body-sm text-ink">{text}</Text>
    </View>
  );
}

type OnboardingScreenProps = NativeStackScreenProps<RootStackParamList, "Onboarding">;

export function OnboardingScreen({ navigation }: OnboardingScreenProps) {
  const [step, setStep] = useState(0);
  const reminders = useOnboardingStore((state) => state.reminders);
  const setReminder = useOnboardingStore((state) => state.setReminder);
  const markPermissionsPrompted = useOnboardingStore((state) => state.markPermissionsPrompted);
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);
  const setAnalyticsConsent = useOnboardingStore((state) => state.setAnalyticsConsent);
  // The ref ignores a second tap before the re-render that disables the buttons.
  const [isRequesting, setIsRequesting] = useState(false);
  const isRequestingRef = useRef(false);
  // iOS only: the slot shown in the picker sheet. Android uses its native dialog. iOS uses Expo UI's
  // picker because the community iOS picker never reports changes under the new architecture.
  const [editingSlot, setEditingSlot] = useState<SlotKey | null>(null);
  const [opacity] = useState(() => new Animated.Value(1));

  const goToStep = useCallback(
    (next: number) => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(
        () => {
          setStep(next);
          Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
        },
      );
    },
    [opacity],
  );

  // Back returns to the previous step. On step 0, and while another screen is focused, the default applies.
  useFocusEffect(
    useCallback(() => {
      if (step === 0) {
        return undefined;
      }
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        goToStep(step - 1);
        return true;
      });
      return () => subscription.remove();
    }, [step, goToStep]),
  );

  function openPicker(slot: SlotKey) {
    if (Platform.OS === "android") {
      openAndroidTimeDialog(reminders[slot], (hhmm) => setReminder(slot, hhmm));
      return;
    }
    setEditingSlot(slot);
  }

  function closePicker() {
    setEditingSlot(null);
  }

  // Each permission is requested only while it can still be asked. A denial never blocks the user and
  // shows no error here.
  async function allowAndContinue() {
    if (isRequestingRef.current) {
      return;
    }
    isRequestingRef.current = true;
    setIsRequesting(true);
    try {
      if ((await getMicPermission()) === "undetermined") {
        await requestMicPermission();
      }
      if ((await getNotificationPermission()) === "undetermined") {
        await requestNotificationPermission();
      }
      markPermissionsPrompted();
    } finally {
      isRequestingRef.current = false;
      setIsRequesting(false);
    }
    afterPermissions();
  }

  function maybeLater() {
    if (isRequestingRef.current) {
      return;
    }
    afterPermissions();
  }

  // Permissions is the last step unless the consent step follows it. The navigator removes this screen as soon as
  // onboarding is complete, so nothing touches state after completeOnboarding().
  function afterPermissions() {
    if (STEP_COUNT > CONSENT_STEP) goToStep(CONSENT_STEP);
    else completeOnboarding();
  }

  // The consent step's two equal choices. Either one finishes onboarding; only a yes sends the first event.
  function chooseAnalytics(choice: "granted" | "declined") {
    setAnalyticsConsent(choice);
    if (choice === "granted") {
      track("onboarding_completed", {
        permissions_prompted: useOnboardingStore.getState().permissionsPromptedAt !== null,
      });
    }
    completeOnboarding();
  }

  const footers = [
    {
      label: welcome.primary,
      icon: icons.arrow,
      onPress: () => goToStep(1),
      link: {
        label: welcome.signIn,
        onPress: () => navigation.navigate("SignIn"),
        className: "btn-text__label btn-text__label--rosewood",
      },
    },
    {
      label: rhythm.primary,
      icon: icons.arrow,
      onPress: () => goToStep(2),
      link: {
        label: rhythm.back,
        onPress: () => goToStep(0),
        className: "btn-text__label text-mauve",
      },
    },
    {
      label: permissions.primary,
      icon: icons.check,
      onPress: allowAndContinue,
      link: {
        label: permissions.later,
        onPress: maybeLater,
        className: "btn-text__label text-mauve",
      },
    },
  ];
  // The consent step has its own footer (two buttons that look the same); the other steps take theirs from the list.
  const footer = footers[Math.min(step, CONSENT_STEP - 1)];

  return (
    <SafeAreaView style={styles.screen}>
      <View className="screen__content flex-row items-center justify-between pb-4 pt-3">
        <View className="flex-row items-center gap-1.5">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <View
              key={index}
              className={index === step ? "h-2 w-7 rounded-full bg-plum" : "size-2 rounded-full bg-petal"}
            />
          ))}
        </View>
        <Text
          accessibilityLabel={stepLabel(step + 1, STEP_COUNT)}
          className="font-dm-semibold text-[12px] uppercase leading-[16px] tracking-[1.2px] text-mauve"
        >
          {stepCounter(step + 1, STEP_COUNT)}
        </Text>
      </View>
      <View className="divider" />

      <View className="screen__content flex-1">
        <Animated.View style={[styles.fill, { opacity }]}>
          <ScrollView
            key={step}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {step === 0 && (
              <>
                <LinearGradient
                  colors={gradients.brand.colors}
                  locations={gradients.brand.locations}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.hero}
                >
                  <View className="size-20 items-center justify-center rounded-card border border-white/20 bg-white/15 p-4">
                    <Image source={images.logoMarkLight} contentFit="contain" style={styles.logo} />
                  </View>
                  <Text className="mt-4 font-fraunces text-[30px] leading-[36px] text-white">
                    {welcome.wordmark}
                  </Text>
                  <Text className="mt-1 font-dm-semibold text-[11px] uppercase leading-[16px] tracking-[2.4px] text-white/80">
                    {welcome.tagline}
                  </Text>
                </LinearGradient>
                <Text className="mt-6 text-headline-lg text-ink">{welcome.title}</Text>
                <Text className="mt-3 text-body-lg text-mauve">{welcome.subtitle}</Text>
              </>
            )}

            {step === 1 && (
              <>
                <View className="gap-2">
                  <Text className="eyebrow">{rhythm.eyebrow}</Text>
                  <Text className="text-headline-lg text-ink">{rhythm.title}</Text>
                  <Text className="text-body text-mauve">{rhythm.subtitle}</Text>
                </View>
                <View className="mt-6 gap-3">
                  {slots.map(({ key, icon }) => {
                    const time = formatTime12(reminders[key]);
                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityLabel={rhythm.changeTime(rhythm.slots[key].name, time)}
                        className="card min-h-14 flex-row items-center justify-between gap-3"
                        style={shadows.card}
                        onPress={() => openPicker(key)}
                      >
                        <View className="flex-1 flex-row items-center gap-3.5">
                          <View className="size-11 items-center justify-center rounded-full bg-blush">
                            <Icon name={icon} size={22} color={colors.plum} />
                          </View>
                          <View className="flex-1">
                            <Text className="text-label-lg text-ink">{rhythm.slots[key].name}</Text>
                            <Text className="text-body-sm text-mauve">
                              {rhythm.slots[key].descriptor}
                            </Text>
                          </View>
                        </View>
                        <View className="chip gap-1.5 border border-petal bg-linen py-1.5">
                          <Text className="text-label-md text-ink">{time}</Text>
                          <Icon name={icons.time} size={14} color={colors.plum} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="mt-5 text-center text-body-sm text-mauve">{rhythm.helper}</Text>
              </>
            )}

            {step === 2 && (
              <>
                <View className="gap-2">
                  <Text className="eyebrow">{permissions.eyebrow}</Text>
                  <Text className="text-headline-lg text-ink">{permissions.title}</Text>
                  <Text className="text-body text-mauve">{permissions.subtitle}</Text>
                </View>
                <StepCards cards={permissionCards} />
                <PrivacyLine text={permissions.privacy} />
              </>
            )}

            {step === CONSENT_STEP && (
              <>
                <View className="gap-2">
                  <Text className="eyebrow">{consent.eyebrow}</Text>
                  <Text className="text-headline-lg text-ink">{consent.title}</Text>
                  <Text className="text-body text-mauve">{consent.subtitle}</Text>
                </View>
                <StepCards cards={consentCards} />
                <PrivacyLine text={consent.note} />
              </>
            )}
          </ScrollView>

          {step === CONSENT_STEP ? (
            <View className="gap-3 pb-2 pt-6">
              <PrimaryButton label={consent.share} tone="ghost" onPress={() => chooseAnalytics("granted")} />
              <PrimaryButton label={consent.notNow} tone="ghost" onPress={() => chooseAnalytics("declined")} />
            </View>
          ) : (
            <View className={step === 0 ? "pb-2 pt-8" : "pb-2 pt-6"}>
              <PrimaryButton
                label={footer.label}
                iconRight={footer.icon}
                onPress={footer.onPress}
                loading={isRequesting}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={footer.link.label}
                className="mt-3 min-h-11 items-center justify-center"
                disabled={isRequesting}
                onPress={footer.link.onPress}
              >
                <Text className={footer.link.className}>{footer.link.label}</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      </View>

      <ReminderTimePicker
        slot={editingSlot}
        value={reminders[editingSlot ?? "morning"]}
        onChange={(hhmm) => {
          if (editingSlot) setReminder(editingSlot, hhmm);
        }}
        onClose={closePicker}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  fill: { flex: 1 },
  scrollContent: { paddingTop: 16 },
  hero: { alignItems: "center", borderRadius: radii.hero, padding: 32 },
  logo: { width: 48, height: 48 },
});
