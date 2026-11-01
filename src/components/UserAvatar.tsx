import { useUser } from "@clerk/expo";
import { Image, type ImageTransition } from "expo-image";
import type { SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { colors } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { getInitials } from "@/utils/format";

const person = { android: "person", ios: "person" } satisfies SymbolViewProps["name"];

// The two places the picture appears: the tab header (32) and Profile's account header (64).
const SIZES = {
  32: { circle: "size-8", initials: "font-fraunces-medium text-[13px] leading-[16px]", icon: 18 },
  64: { circle: "size-16", initials: "text-headline", icon: 28 },
} as const;

// A photo fades in only when it comes from the network; from the phone's cache it shows at once.
const PHOTO_FADE: ImageTransition = { duration: 200, skipOnCacheHit: "all" };

// The signed-in person's picture, the same on every screen: the photo Clerk holds (one they uploaded, or the one their
// Google account gave), otherwise their initials, otherwise a person icon. Every copy reads the same Clerk user, so the
// header and Profile always agree, and a new photo reaches both together. The initials stay under the photo until it has
// loaded, so the circle is never empty and a photo that cannot load leaves the initials. The photo is kept in memory and on
// disk, so each screen that mounts one shows it in its first frame, offline too. Decorative: the screen names the person.
export function UserAvatar({ size }: { size: keyof typeof SIZES }) {
  const { user } = useUser();
  const reduceMotion = useReduceMotion();
  const [loadedPhoto, setLoadedPhoto] = useState<string | null>(null);
  const { circle, initials: initialsClass, icon } = SIZES[size];
  const photo = user?.hasImage ? user.imageUrl : null;
  const initials = getInitials({
    firstName: user?.firstName,
    lastName: user?.lastName,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
  });

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`${circle} items-center justify-center overflow-hidden rounded-full border border-petal bg-blush`}
    >
      {/* Taken away once the photo is on screen, so a photo with transparent parts never shows the letters through it. */}
      {photo !== null && loadedPhoto === photo ? null : initials ? (
        // A picture, not text: it keeps its size in its fixed circle whatever the system text size.
        <Text allowFontScaling={false} className={`${initialsClass} text-plum-deep`}>
          {initials}
        </Text>
      ) : (
        <Icon name={person} size={icon} color={colors.plum} />
      )}
      {photo ? (
        <Image
          source={{ uri: photo }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={reduceMotion ? null : PHOTO_FADE}
          onLoad={() => setLoadedPhoto(photo)}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}
