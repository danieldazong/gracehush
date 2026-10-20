import * as Haptics from "expo-haptics";

// Small taps that make a touch feel physical. They are a nicety: a device without a haptic engine
// ignores them, and a failure never reaches the user. The crisis view never calls any of these.
function play(effect: () => Promise<void>) {
  try {
    effect().catch(() => undefined);
  } catch {
    // No haptic engine, or the module is missing: there is nothing to feel and nothing to report.
  }
}

export const haptics = {
  // A tab or a toggle changed.
  selection: () => play(() => Haptics.selectionAsync()),
  // A recording started.
  light: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  // A recording stopped.
  medium: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  // A reflection is ready.
  success: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
