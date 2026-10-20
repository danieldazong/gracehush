import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";

// Android announces through accessibilityLiveRegion on the text itself. iOS has no live regions.
export function useAnnounce(message: string | null) {
  useEffect(() => {
    if (message && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);
}
