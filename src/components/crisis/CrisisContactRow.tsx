import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { colors } from "@/constants/theme";
import type { CrisisIcon, CrisisResource } from "@/types";

const resourceIcons = {
  call: { android: "phone_in_talk", ios: "phone.fill" },
  text: { android: "chat_bubble_outline", ios: "message.fill" },
  emergency: { android: "emergency", ios: "staroflife.fill" },
  web: { android: "public", ios: "globe" },
} satisfies Record<CrisisIcon, SymbolViewProps["name"]>;

const icons = {
  chevron: { android: "chevron_right", ios: "chevron.right" },
  external: { android: "open_in_new", ios: "arrow.up.right.square" },
} satisfies Record<string, SymbolViewProps["name"]>;

function getIconColor(resource: CrisisResource) {
  if (resource.urgent) return colors.crisis;
  return resource.icon === "web" ? colors.rosewood : colors.plum;
}

type CrisisContactRowProps = {
  resource: CrisisResource;
  onPress: () => void;
  // Under a group heading that already names the service: say only what the row does.
  grouped?: boolean;
};

// One way to reach help, a row of a CrisisContactList (the list draws the card and the dividers). The whole row
// is the touch target and one accessibility element, so its tile and arrow are pictures. The title and detail
// are never truncated: no word is hidden at large text sizes.
export function CrisisContactRow({ resource, onPress, grouped = false }: CrisisContactRowProps) {
  const { title, detail } = grouped && resource.grouped ? resource.grouped : resource;
  const tile = resource.urgent ? "bg-crisis/12" : "bg-linen-deep";
  const detailStyle = resource.icon === "emergency" ? "text-label-md text-crisis" : "text-label-md text-mauve";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={resource.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <View className="flex-row items-center gap-3 px-4 py-3.5">
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className={`size-10 items-center justify-center rounded-xl ${tile}`}
        >
          <Icon name={resourceIcons[resource.icon]} size={20} color={getIconColor(resource)} />
        </View>
        <View className="flex-1">
          <Text className="text-label-lg text-ink">{title}</Text>
          <Text className={detailStyle}>{detail}</Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon
            name={resource.kind === "web" ? icons.external : icons.chevron}
            size={20}
            color={colors.mauve}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
