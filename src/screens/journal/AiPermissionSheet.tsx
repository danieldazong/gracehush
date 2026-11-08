import { Image } from "expo-image";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, radii, shadows } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";

const text = copy.aiPermission;

// The sheet arrives a moment after the screen under it, so the person sees where they were going before they are asked, and it
// leaves faster than it came.
const SLIDE_DELAY_MS = 200;
const SLIDE_IN_MS = 320;
const SLIDE_OUT_MS = 200;

function TextLink({ label, onPress, expanded }: { label: string; onPress: () => void; expanded?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <View className="min-h-11 items-center justify-center px-2">
        <Text className="text-label-md text-plum">{label}</Text>
      </View>
    </Pressable>
  );
}

type AiPermissionSheetProps = {
  onAllow: () => void;
  onNotNow: () => void;
  onOpenPrivacy: () => void;
};

// What New Entry puts over the screen until this account has answered (Apple's guideline 5.1.2(i), 2026-11-07): one short
// question that says what is sent and to whom, answers the training worry in plain words, and asks first. The details (what Google
// keeps, why it is asked, where to change it) are one tap away. It is drawn inside the screen and not as a system Modal, so Not now
// and the keyboard that follows Allow never meet iOS's rule of one Modal at a time. The answers and the link are pinned under the
// text, so they are on screen at every text size. Someone may reach it at a very hard moment, so it stays calm: one slide, no
// haptic, no event, no log line, and nothing red.
export function AiPermissionSheet({ onAllow, onNotNow, onOpenPrivacy }: AiPermissionSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  const [expanded, setExpanded] = useState(false);
  // Blocks a second press while the sheet is on its way out.
  const closing = useRef(false);

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return undefined;
    }
    const slide = Animated.timing(progress, {
      toValue: 1,
      duration: SLIDE_IN_MS,
      delay: SLIDE_DELAY_MS,
      useNativeDriver: true,
    });
    slide.start();
    return () => slide.stop();
  }, [progress, reduceMotion]);

  // Allow and Not now close the sheet first and then act, so the screen under it is not left looking at a sheet that vanished.
  const finish = useCallback(
    (next: () => void) => {
      if (closing.current) return;
      closing.current = true;
      if (reduceMotion) {
        next();
        return;
      }
      Animated.timing(progress, { toValue: 0, duration: SLIDE_OUT_MS, useNativeDriver: true }).start(() => next());
    },
    [progress, reduceMotion],
  );

  // Android's back key is Not now, as the X was on the page this replaced.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      finish(onNotNow);
      return true;
    });
    return () => subscription.remove();
  }, [finish, onNotNow]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [windowHeight, 0] });

  return (
    // accessibilityViewIsModal keeps VoiceOver on the sheet, and the two-finger scrub is Not now.
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal onAccessibilityEscape={() => finish(onNotNow)}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.common.close}
          className="absolute inset-0 bg-ink/40"
          onPress={() => finish(onNotNow)}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          shadows.sheet,
          { maxHeight: windowHeight - insets.top, paddingBottom: 24 + insets.bottom, transform: [{ translateY }] },
        ]}
      >
        <View style={styles.handle} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <View className="items-center gap-3">
            <View className="size-14 items-center justify-center rounded-full border border-petal bg-card">
              <Image source={images.logoMark} contentFit="contain" style={styles.mark} />
            </View>
            <Text accessibilityRole="header" className="text-center text-headline text-plum-deep">
              {text.title}
            </Text>
            <Text className="text-center text-body text-ink">{text.body}</Text>
            <Text className="text-center text-body text-ink">{text.trust}</Text>
            {expanded ? (
              <View className="card gap-3 self-stretch" style={shadows.card}>
                {text.details.map((row, index) => (
                  <Fragment key={row.label}>
                    {index === 0 ? null : <View className="divider" />}
                    <View className="gap-1">
                      <Text className="text-label-lg text-plum-deep">{row.label}</Text>
                      <Text className="text-body-sm text-ink">{row.body}</Text>
                    </View>
                  </Fragment>
                ))}
                <View className="items-center">
                  <TextLink label={text.privacy} onPress={onOpenPrivacy} />
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>

        <View className="gap-2 pt-4">
          <Text className="text-center text-body-sm text-mauve">{text.caption}</Text>
          <PrimaryButton label={text.allow} onPress={() => finish(onAllow)} />
          <PrimaryButton label={text.notNow} tone="ghost" onPress={() => finish(onNotNow)} />
          <View className="flex-row flex-wrap justify-center gap-x-4">
            <TextLink
              label={expanded ? text.showLess : text.learnMore}
              expanded={expanded}
              onPress={() => setExpanded((open) => !open)}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The look of BottomSheet (blush, the sheet radius, a petal edge and handle), anchored to the bottom of the screen.
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.blush,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderTopWidth: 1,
    borderTopColor: colors.petal,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  handle: {
    alignSelf: "center",
    width: 48,
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.petal,
    marginBottom: 20,
  },
  // The mark fills 72% of its square, so 44 shows a mark about 32 tall in the 56 circle.
  mark: { width: 44, height: 44 },
  pressed: { opacity: 0.6 },
});
