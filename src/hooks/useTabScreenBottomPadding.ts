import { layout } from "@/constants/theme";

// The tab bar is rendered below the scenes, so a screen already ends where the bar begins. Only the
// floating dock overlaps the content, so the last control has to clear that. A hook, so that one place
// changes if a later step adds a persistent mini player above the bar.
export function useTabScreenBottomPadding(): number {
  return layout.dockClearance;
}
