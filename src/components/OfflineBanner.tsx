import type { SymbolViewProps } from "expo-symbols";
import { Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";

const icons = {
  cloudOff: { android: "cloud_off", ios: "icloud.slash" },
} satisfies Record<string, SymbolViewProps["name"]>;

type OfflineBannerProps = {
  // Reflections saved on this device that have not been synced yet.
  unsyncedCount: number;
};

// A polite live region: a screen reader announces it when the device goes offline.
export function OfflineBanner({ unsyncedCount }: OfflineBannerProps) {
  return (
    <View accessibilityLiveRegion="polite" className="card card--blush flex-row items-start gap-3">
      <View className="mt-0.5 size-8 items-center justify-center rounded-full bg-petal">
        <Icon name={icons.cloudOff} size={19} color={colors.plumDeep} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-dm-semibold text-[13px] leading-[18px] text-plum-deep">
          {copy.journal.offline.title}
        </Text>
        <Text className="text-body-sm text-ink/80">{copy.journal.offline.body(unsyncedCount)}</Text>
      </View>
    </View>
  );
}
