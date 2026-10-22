import * as WebBrowser from "expo-web-browser";
import { Linking, Platform } from "react-native";

export type CrisisLinkResult = { ok: true } | { ok: false; fallback: string };

// No Linking.canOpenURL: without declared query schemes it answers false for links that would open.
async function open(url: string, fallback: string): Promise<CrisisLinkResult> {
  try {
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    if (__DEV__) console.warn("[crisis] a link could not be opened");
    return { ok: false, fallback };
  }
}

export function openCall(number: string): Promise<CrisisLinkResult> {
  return open(`tel:${number}`, number);
}

export function openText(number: string, body?: string): Promise<CrisisLinkResult> {
  const separator = Platform.OS === "ios" ? "&" : "?";
  const url =
    body === undefined ? `sms:${number}` : `sms:${number}${separator}body=${encodeURIComponent(body)}`;
  return open(url, number);
}

export async function openWeb(url: string): Promise<CrisisLinkResult> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return { ok: true };
  } catch {
    if (__DEV__) console.warn("[crisis] a web link could not be opened");
    return { ok: false, fallback: url };
  }
}
