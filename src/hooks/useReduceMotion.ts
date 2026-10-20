import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

// One app-wide answer to the system's Reduce Motion setting. It is asked for once when this file loads
// and follows the setting live. Asking in every component, after it mounted, answered 40 to 500 ms late
// (step 11), so a component that animates on mount started its animation and stopped it a moment later.
let reduceMotion = false;
const listeners = new Set<() => void>();

function setReduceMotion(enabled: boolean) {
  if (enabled === reduceMotion) return;
  reduceMotion = enabled;
  listeners.forEach((listener) => listener());
}

AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return reduceMotion;
}

function getServerSnapshot() {
  return false;
}

// True while Reduce Motion is on.
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
