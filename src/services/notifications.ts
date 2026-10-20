import { isRunningInExpoGo } from "expo";
import type { NotificationPermissionsStatus } from "expo-notifications";
import { Platform } from "react-native";

import { AFFIRMATION_CHANNEL_ID } from "@/constants/app";
import { copy } from "@/constants/copy";
import type { PermissionResult } from "@/types";

import { toPermissionResult } from "./permissions";

// Expo Go on Android does not register ExpoTopicSubscriptionModule, so importing expo-notifications
// there throws at startup (Expo Go 57.0.9, expo-notifications 57.0.23). Only that case is skipped, and
// every function below then answers "undetermined" without a prompt. A development build and iOS
// always load the module, so a real failure there is never hidden. Step 05b checks the Android prompt
// and channel on a development build.
const Notifications: typeof import("expo-notifications") | null =
  Platform.OS === "android" && isRunningInExpoGo()
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports -- a top-level import would crash Expo Go on Android
      require("expo-notifications");

function warn(message: string, error: unknown) {
  if (__DEV__) {
    console.warn(`[notifications] ${message}`, error);
  }
}

// iOS provisional (quiet) delivery counts as granted: step 28 relies on it.
function toNotificationResult(response: NotificationPermissionsStatus): PermissionResult {
  if (Notifications && response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return "granted";
  }
  return toPermissionResult(response);
}

// Android only. On Android 13+ the channel must exist before the permission request, otherwise the
// system prompt never appears.
export async function ensureAffirmationChannel(): Promise<void> {
  if (!Notifications || Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(AFFIRMATION_CHANNEL_ID, {
      name: copy.notifications.channelName,
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
  } catch (error) {
    warn("could not create the affirmation channel", error);
  }
}

export async function getNotificationPermission(): Promise<PermissionResult> {
  if (!Notifications) return "undetermined";
  try {
    return toNotificationResult(await Notifications.getPermissionsAsync());
  } catch (error) {
    warn("could not read the notification permission", error);
    return "undetermined";
  }
}

export async function requestNotificationPermission(): Promise<PermissionResult> {
  if (!Notifications) return "undetermined";
  try {
    await ensureAffirmationChannel();
    return toNotificationResult(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      }),
    );
  } catch (error) {
    warn("could not request the notification permission", error);
    return "undetermined";
  }
}
