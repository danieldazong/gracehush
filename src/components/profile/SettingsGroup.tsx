import { Children, isValidElement, type ReactNode } from "react";
import { Text, View } from "react-native";

import { shadows } from "@/constants/theme";

type SettingsGroupProps = {
  title: string;
  children: ReactNode;
};

// A small label above one white card, with a hairline between the rows. Children that render nothing (a row that
// is left out) are dropped first, so the card never starts or ends with a hairline. The shadow and the clipping are
// on different views: with both on one view, iOS clips the shadow.
export function SettingsGroup({ title, children }: SettingsGroupProps) {
  const rows = Children.toArray(children);

  return (
    <View>
      <Text accessibilityRole="header" className="eyebrow mb-1 px-2">
        {title}
      </Text>
      <View className="rounded-card border border-petal bg-card" style={shadows.card}>
        <View className="overflow-hidden rounded-card">
          {rows.map((row, index) => (
            <View key={isValidElement(row) ? (row.key ?? index) : index}>
              {index > 0 ? <View className="divider mx-4" /> : null}
              {row}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
