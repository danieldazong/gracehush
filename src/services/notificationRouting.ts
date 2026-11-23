import { navigationRef } from "@/navigation/navigationRef";
import { readTapData, type AffirmationTapData } from "@/services/affirmationPlanner";
import { track } from "@/services/analytics";
import { addTapListener, showNotificationsQuietly, takeLastTap, type NotificationTap } from "@/services/notifications";
import { isTrialReminderTap } from "@/utils/trialReminder";

// A tapped affirmation notification opens its reflection on the Affirmations tab (step 28), and never starts the devotional or
// the ambient sound. A tap is held until the signed-in screens are up and the account is known: when the app was closed the
// tap arrives before the fonts, Clerk and the navigator have loaded. A tap from another account's notification opens nothing.
// A tapped trial reminder (2026-11-18) opens the Profile tab, where the plan and Manage subscription are; it names no account,
// so it needs only the signed-in screens.

let tapUser: string | null = null; // the signed-in account's hash (database.ts userHash), set by the scheduler
let pending: AffirmationTapData | null = null;
let pendingProfile = false; // a trial reminder was tapped
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
  if (isTrialReminderTap(tap.data)) {
    pendingProfile = true;
    openPendingTap();
    return;
  }
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
  if (!navigationRef.isReady()) return;
  const routeNames = navigationRef.getRootState()?.routeNames;
  if (pendingProfile && routeNames?.includes("MainTabs")) {
    pendingProfile = false;
    // pop: true goes back to the tabs that are already in the stack and does not push a second copy (the popTo vendor note).
    navigationRef.navigate("MainTabs", { screen: "Profile" }, { pop: true });
  }
  if (pending === null || tapUser === null || !routeNames?.includes("Reflection")) return;
  const tap = pending;
  pending = null;
  if (tap.userHash !== tapUser) return;
  // The slot only: never the entry, the account or the words (step 34). A crisis entry never has a notification.
  track("affirmation_notification_opened", { slot: tap.slot });
  navigationRef.navigate("Reflection", { entryId: tap.entryId, tab: "affirmations" });
}
