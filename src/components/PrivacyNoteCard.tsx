import { Text, View } from "react-native";

import { colors } from "@/constants/theme";

import { Icon } from "./Icon";

type PrivacyNoteCardProps = {
  title?: string;
  body: string;
};

export function PrivacyNoteCard({ title, body }: PrivacyNoteCardProps) {
  return (
    <View className="card card--blush flex-row items-start gap-3.5">
      <View className="mt-0.5 size-7 items-center justify-center rounded-full border border-petal bg-card">
        <Icon name={{ android: "lock", ios: "lock" }} size={15} color={colors.rosewood} />
      </View>
      <View className="flex-1">
        {title ? <Text className="text-label-lg text-ink">{title}</Text> : null}
        <Text className={title ? "mt-0.5 text-body-sm text-mauve" : "text-body-sm text-mauve"}>
          {body}
        </Text>
      </View>
    </View>
  );
}
