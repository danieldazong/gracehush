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

// The store's subscriptions page. It opens through Linking so the App Store or the Play Store handles it, never the in-app
// browser. RevenueCat's managementURL for this customer wins when it is an https: address (step 30); otherwise the store's own
// page.
export function openManageSubscription(url?: string | null): Promise<LinkResult> {
  if (typeof url === "string" && url.startsWith("https://")) return openUrl(url);
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

// The export's ZIP (step 31): a one-hour link, opened in the system browser, which saves the file (Safari to Files, Chrome to
// Downloads). Anything that is not an https: link is refused.
export function openExportDownload(url: string): Promise<LinkResult> {
  if (!url.startsWith("https://")) return Promise.resolve({ ok: false });
  return openUrl(url);
}

// No device details, no user id and no body: the person writes what they want to say.
export function openSupportEmail(): Promise<LinkResult> {
  return openUrl(`mailto:${SUPPORT_EMAIL}?subject=Gracehush%20feedback`);
}
