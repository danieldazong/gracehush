import { isRunningInExpoGo } from "expo";
import type { NotificationPermissionsStatus, NotificationResponse } from "expo-notifications";
import { Platform } from "react-native";

import { AFFIRMATION_CHANNEL_ID } from "@/constants/app";
import { copy } from "@/constants/copy";
import type { PermissionResult } from "@/types";

import { toPermissionResult } from "./permissions";

// Expo Go on Android does not register ExpoTopicSubscriptionModule, so importing expo-notifications
// there throws at startup (Expo Go 57.0.9, expo-notifications 57.0.23). Only that case is skipped, and
// every function below then answers "undetermined" without a prompt. A development build and iOS
// always load the module, so a real failure there is never hidden. Step 05b checks the Android prompt
// and channel on a development build. This file is the only one that imports expo-notifications.
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

// ---- local notifications (step 28) ---------------------------------------------------------------------------------------
// What the affirmation scheduler and the tap routing need, and nothing more. Where the module is skipped each one does nothing
// or answers empty. The scheduling calls throw, so the scheduler can tell a failure from an empty answer.

export function notificationsAvailable(): boolean {
  return Notifications !== null;
}

// The identifiers of every notification waiting to be shown. In Expo Go this lists the other projects' too (Expo Go scopes each
// identifier, and hands it back without its scope), so callers only touch identifiers of their own.
export async function listScheduledIds(): Promise<string[]> {
  if (!Notifications) return [];
  const requests = await Notifications.getAllScheduledNotificationsAsync();
  return requests.map((request) => request.identifier);
}

export async function cancelScheduled(identifier: string): Promise<void> {
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

// One notification at an instant. On iOS a date trigger is a time interval counted from now, so the instant must still be ahead.
// On Android it goes to the affirmation channel, and arrives a few minutes late when the phone saves battery (no exact alarm).
export async function scheduleAt(request: {
  identifier: string;
  fireAt: Date;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<void> {
  if (!Notifications) return;
  await Notifications.scheduleNotificationAsync({
    identifier: request.identifier,
    content: { title: request.title, body: request.body, data: request.data, sound: "default" },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: request.fireAt,
      channelId: AFFIRMATION_CHANNEL_ID,
    },
  });
}

// The notifications in the notification center (shown, not yet opened or cleared).
export async function listPresentedIds(): Promise<string[]> {
  if (!Notifications) return [];
  const shown = await Notifications.getPresentedNotificationsAsync();
  return shown.map((notification) => notification.request.identifier);
}

export async function dismissPresented(identifier: string): Promise<void> {
  if (!Notifications) return;
  await Notifications.dismissNotificationAsync(identifier);
}

// While the app is open a notification still shows as a banner and in the list, but quietly: no sound and no badge.
export function showNotificationsQuietly(): void {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// A tap on a notification: its data and a key that names this delivery of it, because the listener and the last response
// can both report the same tap. Any other action (none exists) is ignored.
export type NotificationTap = { key: string; data: unknown };

function toTap(response: NotificationResponse): NotificationTap | null {
  if (!Notifications || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const { request, date } = response.notification;
  return { key: `${request.identifier}@${date}`, data: request.content.data };
}

export function addTapListener(listener: (tap: NotificationTap) => void): () => void {
  if (!Notifications) return () => undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const tap = toTap(response);
    if (tap !== null) listener(tap);
  });
  return () => subscription.remove();
}

// The tap that opened the app, if one did and nothing has taken it yet. It is cleared as it is taken, so it is acted on once.
export function takeLastTap(): NotificationTap | null {
  if (!Notifications) return null;
  try {
    const response = Notifications.getLastNotificationResponse();
    if (response === null) return null;
    Notifications.clearLastNotificationResponse();
    return toTap(response);
  } catch (error) {
    warn("could not read the last notification tap", error);
    return null;
  }
}
