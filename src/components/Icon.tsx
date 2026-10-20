import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Platform, useWindowDimensions } from "react-native";

type IconProps = {
  name: SymbolViewProps["name"];
  size: number;
  color: string;
};

export function Icon({ name, size, color }: IconProps) {
  const { fontScale } = useWindowDimensions();
  // On Android, expo-symbols scales the glyph with the system font size but not its box, which clips it.
  const glyphSize = Platform.OS === "android" ? size / fontScale : size;

  return (
    <SymbolView
      name={name}
      size={glyphSize}
      tintColor={color}
      style={{ width: size, height: size }}
    />
  );
}
