import * as WebBrowser from "expo-web-browser";
import { Linking, Platform } from "react-native";

import { MANAGE_SUBSCRIPTION_URL, SUPPORT_EMAIL } from "@/constants/app";

export type LinkResult = { ok: true } | { ok: false };

// Same pattern as crisisLinks.ts: a result, never a throw, and nothing logged but one development warning. No
// Linking.canOpenURL: without declared query schemes it answers false for links that would open.
async function openUrl(url: string): Promise<LinkResult> {
  try {
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    if (__DEV__) console.warn("[links] a link could not be opened");
    return { ok: false };
  }
}

// The store's own subscriptions page. It opens through Linking so the App Store or the Play Store handles it,
// never the in-app browser. TODO(30): RevenueCat's managementURL when available.
export function openManageSubscription(): Promise<LinkResult> {
  return openUrl(
    Platform.OS === "ios" ? MANAGE_SUBSCRIPTION_URL.ios : MANAGE_SUBSCRIPTION_URL.android,
  );
}

// The Privacy Policy and the Terms of Use open in the in-app browser.
export async function openLegalPage(url: string): Promise<LinkResult> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return { ok: true };
  } catch {
    if (__DEV__) console.warn("[links] a web page could not be opened");
    return { ok: false };
  }
}

// No device details, no user id and no body: the person writes what they want to say.
export function openSupportEmail(): Promise<LinkResult> {
  return openUrl(`mailto:${SUPPORT_EMAIL}?subject=Gracehush%20feedback`);
}
