import { navigationRef } from "@/navigation/navigationRef";
import { readTapData, type AffirmationTapData } from "@/services/affirmationPlanner";
import { addTapListener, showNotificationsQuietly, takeLastTap, type NotificationTap } from "@/services/notifications";

// A tapped affirmation notification opens its reflection on the Affirmations tab (step 28), and never starts the devotional or
// the ambient sound. A tap is held until the signed-in screens are up and the account is known: when the app was closed the
// tap arrives before the fonts, Clerk and the navigator have loaded. A tap from another account's notification opens nothing.

let tapUser: string | null = null; // the signed-in account's hash (database.ts userHash), set by the scheduler
let pending: AffirmationTapData | null = null;
const handled: string[] = []; // the listener and the last response can both report one tap: it is acted on once

// Once, when the app starts (App.tsx). The tap that opened the app is read here; later taps come through the listener.
export function startNotificationRouting(): () => void {
  showNotificationsQuietly();
  const stop = addTapListener(receive);
  const opening = takeLastTap();
  if (opening !== null) receive(opening);
  return stop;
}

function receive(tap: NotificationTap): void {
  if (handled.includes(tap.key)) return;
  handled.push(tap.key);
  if (handled.length > 20) handled.shift();
  const data = readTapData(tap.data);
  if (data === null) return;
  pending = data;
  openPendingTap();
}

// The scheduler sets the account when a user signs in and clears it when the session ends.
export function setTapUser(hash: string | null): void {
  tapUser = hash;
  openPendingTap();
}

// Also called by the NavigationContainer when it is ready and when its state changes (the signed-in screens mounting).
export function openPendingTap(): void {
  if (pending === null || tapUser === null || !navigationRef.isReady()) return;
  if (!navigationRef.getRootState()?.routeNames.includes("Reflection")) return;
  const tap = pending;
  pending = null;
  if (tap.userHash !== tapUser) return;
  // TODO(34): affirmation_notification_opened { slot }
  navigationRef.navigate("Reflection", { entryId: tap.entryId, tab: "affirmations" });
}
