import type { SymbolViewProps } from "expo-symbols";

import { copy } from "@/constants/copy";

export type PrayerMenuAction = "editNote" | "moveBack" | "remove" | "delete";

export type PrayerMenuItem = {
  action: PrayerMenuAction;
  label: string;
  icon: SymbolViewProps["name"];
  // The one item that deletes for good: the iPhone sheet draws it red and the Android sheet gives it the crisis colour
  // (AGENTS.md: crisis red is for destructive actions only).
  destructive: boolean;
};

const { menu } = copy.prayers;

const items: Record<PrayerMenuAction, PrayerMenuItem> = {
  editNote: {
    action: "editNote",
    label: menu.editNote,
    icon: { android: "edit", ios: "pencil" },
    destructive: false,
  },
  moveBack: {
    action: "moveBack",
    label: menu.moveBack,
    icon: { android: "undo", ios: "arrow.uturn.backward" },
    destructive: false,
  },
  remove: {
    action: "remove",
    label: menu.removeFromPrayers,
    icon: { android: "remove_circle", ios: "minus.circle" },
    destructive: false,
  },
  delete: {
    action: "delete",
    label: menu.deleteReflection,
    icon: { android: "delete", ios: "trash" },
    destructive: true,
  },
};

// What the ⋯ menu of a prayer offers, in order (step 29b). The delete is always last. One list feeds the iPhone action sheet and
// the Android sheet, so the two cannot differ. An answered prayer also edits its gratitude note and moves back to Active.
export function getPrayerMenu(tab: "active" | "answered"): PrayerMenuItem[] {
  return tab === "answered"
    ? [items.editNote, items.moveBack, items.remove, items.delete]
    : [items.remove, items.delete];
}
