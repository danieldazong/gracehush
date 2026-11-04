import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { BenefitList, type BenefitItem } from "@/components/BenefitList";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { openAndroidTimeDialog, ReminderTimePicker } from "@/components/ReminderTimePicker";
import { ONBOARDING_STEPS, StepProgress, TOTAL_STEPS } from "@/components/StepProgress";
import { WelcomeScenes } from "@/components/WelcomeScenes";
import { Wordmark } from "@/components/Wordmark";
import { copy } from "@/constants/copy";
import { images, onboardingScenes } from "@/constants/images";
import { colors, shadows } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/types";
import { getNotificationPermission, requestNotificationPermission } from "@/services/notifications";
import { getMicPermission, requestMicPermission } from "@/services/recorder";
import { isSamplePlaying, playSample, stopSample, subscribeSample } from "@/services/samplePlayer";
import { useOnboardingStore } from "@/store/onboardingStore";
import { formatTime12 } from "@/utils/format";

const { stepCounter, stepLabel, welcome, rhythm, permissions } = copy.onboarding;

// The counter and the pills also count the Sign In that follows (TOTAL_STEPS, step 34b). The analytics choice was a fourth
// step from step 34 until round 8 of 2026-11-01, when it moved to the Journal's first visit.
// Fade out, swap the step, fade in: about 200ms in total.
const FADE_MS = 100;
// The Welcome scene takes whatever the cover's text and footer leave (2026-11-01: about 400 dp on an 812-tall phone,
// 430 on 844), and never less than this; a short phone, or large text, scrolls the cover instead.
const SCENE_MIN = 340;
// The lockup overlaps the scene's linen fade: its 40 dp plus 8 of air above the scene's bottom edge.
const LOCKUP_OVERLAP = 48;
// The top fade follows the status bar, because the progress row sits just under it: at a fixed 120 the counter fell to 2.88:1 over
// the kitchen scene on five of nine iPhone sizes, and this keeps it at 5.01:1 or better, and the pills at 5.70:1, on all of them.
const SCENE_FADE_BELOW_INSET = 90;

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
  play: { android: "play_circle", ios: "play.circle" },
  stop: { android: "stop_circle", ios: "stop.circle" },
  headphones: { android: "headphones", ios: "headphones" },
  book: { android: "menu_book", ios: "book" },
} satisfies Record<string, SymbolViewProps["name"]>;

const slots = [
  { key: "morning", icon: icons.morning },
  { key: "afternoon", icon: icons.afternoon },
  { key: "evening", icon: icons.evening },
] as const;

type SlotKey = (typeof slots)[number]["key"];

type StepCard = { icon: SymbolViewProps["name"]; title: string; body: string };

// The three things one prayer gives, under the cover's lead (2026-11-01, round 2; benefit rows since round 3; since
// round 7 their icons take their turn once the rows have arrived: the headphones pulse, the book turns a page, the bell
// swings, one after another).
const deliverables: readonly BenefitItem[] = [
  { icon: icons.headphones, text: welcome.gets.devotional, motion: "pulse" },
  { icon: icons.book, text: welcome.gets.passage, motion: "flip" },
  { icon: icons.notifications, text: welcome.gets.affirmations, motion: "ring" },
];

// The Permissions step's cards. The notifications one names the three times chosen on the Rhythm step (step 34b).
function permissionCardsFor(times: { morning: string; afternoon: string; evening: string }): readonly StepCard[] {
  return [
    { icon: icons.microphone, ...permissions.microphone },
    {
      icon: icons.notifications,
      title: permissions.notifications.title,
      body: permissions.notifications.body(times.morning, times.afternoon, times.evening),
    },
  ];
}

// The Permissions step's cards: an icon in a blush circle, a title and a line under it.
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
  // The ref ignores a second tap before the re-render that disables the buttons.
  const [isRequesting, setIsRequesting] = useState(false);
  const isRequestingRef = useRef(false);
  // iOS only: the slot shown in the picker sheet. Android uses its native dialog. iOS uses Expo UI's
  // picker because the community iOS picker never reports changes under the new architecture.
  const [editingSlot, setEditingSlot] = useState<SlotKey | null>(null);
  const [opacity] = useState(() => new Animated.Value(1));
  const insets = useSafeAreaInsets();
  // The scene's motion runs only while this screen is in front (Sign In can cover it).
  const focused = useIsFocused();
  // The Welcome's sample: its state lives in the service, so the link follows a play that ends by itself.
  const samplePlaying = useSyncExternalStore(subscribeSample, isSamplePlaying);

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

  // Permissions is the last step (the analytics choice is asked on the Journal's first visit since round 8 of 2026-11-01).
  // The navigator removes this screen as soon as onboarding is complete, so nothing touches state after
  // completeOnboarding().
  function afterPermissions() {
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
  const footer = footers[Math.min(step, ONBOARDING_STEPS - 1)];
  const times = {
    morning: formatTime12(reminders.morning),
    afternoon: formatTime12(reminders.afternoon),
    evening: formatTime12(reminders.evening),
  };
  const sampleTitle = copy.notifications.affirmationTitle(rhythm.slots.afternoon.name);
  // The Welcome step is the cover (2026-11-01): its scene runs edge to edge and under the status bar, the progress row
  // sits over the scene's top fade, and its text is centred like Sign In's. The form steps keep the header in flow,
  // with the divider, and their text left-aligned.
  const cover = step === 0;
  // The sample belongs to the cover: leaving it, or the screen, stops the sound.
  useEffect(() => {
    if (cover && focused) return () => stopSample();
    stopSample();
    return undefined;
  }, [cover, focused]);
  const progress = (
    <StepProgress
      step={step}
      total={TOTAL_STEPS}
      label={stepCounter(step + 1, TOTAL_STEPS)}
      accessibilityLabel={stepLabel(step + 1, TOTAL_STEPS)}
      tone={cover ? "onImage" : "default"}
    />
  );

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      {cover ? null : (
        <>
          <View className="screen__content" style={{ paddingTop: insets.top }}>
            {progress}
          </View>
          <View className="divider" />
        </>
      )}

      <View className={cover ? "flex-1" : "screen__content flex-1"}>
        <Animated.View style={[styles.fill, { opacity }]}>
          <ScrollView
            key={step}
            contentContainerStyle={cover ? styles.coverContent : styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {step === 0 && (
              <>
                {/* The scene fills whatever the text below leaves: the content container fills the viewport and the
                    scene has flex 1 (2026-11-01, round 2). */}
                <WelcomeScenes
                  sources={onboardingScenes}
                  minHeight={SCENE_MIN}
                  active={focused}
                  fadeTop={insets.top + SCENE_FADE_BELOW_INSET}
                />
                {/* The lockup sits on the scene's fade, so the cover reads as one piece; the headline is the one big
                    text on the screen. */}
                <View className="screen__content items-center pb-4" style={styles.coverText}>
                  <Wordmark />
                  <Text className="mt-4 text-center text-headline-lg text-ink">{welcome.title}</Text>
                  <Text className="mt-3 text-center text-body text-mauve">{welcome.subtitle}</Text>
                  {/* The three things one prayer gives, as benefit rows that arrive one after another (2026-11-01,
                      round 3): a tile and a medium line each, the eye led down the list to the button. The wrapper
                      stretches (round 5): under items-center its width was auto, and a long line overflowed the phone. */}
                  <View className="mt-3 self-stretch">
                    <BenefitList items={deliverables} active={focused} />
                  </View>
                  {/* The sample (round 8): what it sounds like, before anyone signs in. 28 tall with a 44 touch area, so
                      the cover still fits an 812-tall phone without scrolling. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={samplePlaying ? welcome.sample.stop : welcome.sample.play}
                    accessibilityHint={welcome.sample.hint}
                    hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                    className="mt-1.5 h-7 flex-row items-center justify-center gap-1.5 self-center"
                    onPress={() => {
                      if (samplePlaying) stopSample();
                      else playSample();
                    }}
                  >
                    <Icon name={samplePlaying ? icons.stop : icons.play} size={18} color={colors.plum} />
                    <Text className="font-dm-medium text-[13px] leading-[18px] text-plum">
                      {samplePlaying ? welcome.sample.stop : welcome.sample.play}
                    </Text>
                  </Pressable>
                </View>
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
                {/* What arrives at the afternoon time, as a sample (2026-11-01, round 2): the slot's title as the
                    notification writes it, marked as a sample, over a headline the model really wrote. One element for a
                    screen reader, which hears it is a sample first. */}
                <View
                  accessible
                  accessibilityLabel={rhythm.sample.a11y(sampleTitle, times.afternoon, rhythm.sample.headline)}
                  className="card mt-5 gap-1.5 p-3"
                  style={shadows.card}
                >
                  <View className="flex-row items-center gap-2">
                    <Image source={images.logoMark} contentFit="contain" style={styles.sampleMark} />
                    <Text className="shrink font-dm-semibold text-[13px] leading-[18px] text-ink">
                      {sampleTitle}
                      <Text className="font-dm text-mauve"> · {rhythm.sample.tag}</Text>
                    </Text>
                    <Text className="ml-auto shrink-0 text-body-sm text-mauve">{times.afternoon}</Text>
                  </View>
                  <Text className="text-body text-ink">{rhythm.sample.headline}</Text>
                </View>
                <Text className="mt-4 text-center text-body-sm text-mauve">{rhythm.helper}</Text>
              </>
            )}

            {step === 2 && (
              <>
                <View className="gap-2">
                  <Text className="eyebrow">{permissions.eyebrow}</Text>
                  <Text className="text-headline-lg text-ink">{permissions.title}</Text>
                  <Text className="text-body text-mauve">{permissions.subtitle}</Text>
                </View>
                <StepCards cards={permissionCardsFor(times)} />
                <PrivacyLine text={permissions.privacy} />
              </>
            )}
          </ScrollView>

          {/* The cover's content has no side padding of its own (the scene is full width), so its footer takes it here. */}
          <View className={cover ? "screen__content" : undefined}>
            <View className={step === 0 ? "pb-2 pt-4" : "pb-2 pt-6"}>
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
          </View>
        </Animated.View>
      </View>

      {/* On the cover the progress row sits over the scene's top fade, under the status bar: the scene runs to the
          screen's top edge and the header takes no space of its own. */}
      {cover ? (
        <View pointerEvents="none" className="screen__content" style={[styles.coverHeader, { paddingTop: insets.top }]}>
          {progress}
        </View>
      ) : null}

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
  // The cover's content fills the viewport, so the scene (flex 1) takes what the text leaves.
  coverContent: { flexGrow: 1 },
  coverText: { marginTop: -LOCKUP_OVERLAP },
  coverHeader: { position: "absolute", top: 0, left: 0, right: 0 },
  sampleMark: { width: 18, height: 18 },
});
