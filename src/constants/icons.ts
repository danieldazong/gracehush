import type { SymbolViewProps } from "expo-symbols";
import { Platform } from "react-native";

// The "write a reflection" pen, one icon for every place that offers writing (the floating dock, the Today tab's capture
// bar and its hero's "or write it"). It is the filled document-and-pencil glyph in the mic's style. iOS has it from 18.4
// (SF Symbols 6.3); the app supports iOS 16.4, and iOS draws nothing for a symbol it lacks, so an older iPhone keeps the
// outline compose glyph. Android's Material Symbols are outline only, so its pen and mic already match.
function hasFilledPenGlyph(): boolean {
  if (Platform.OS !== "ios") {
    return false;
  }
  const [major = 0, minor = 0] = String(Platform.Version).split(".").map(Number);
  return major > 18 || (major === 18 && minor >= 4);
}

export const penIcon = {
  android: "edit_note",
  ios: hasFilledPenGlyph() ? "long.text.page.and.pencil.fill" : "square.and.pencil",
} satisfies SymbolViewProps["name"];
