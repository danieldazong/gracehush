import { isRunningInExpoGo } from "expo";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";

import { getDataSource } from "@/data/mock/scenario";

// Sign in with Apple at account deletion (step 35). Clerk keeps no Apple token, so ending Gracehush's access to the person's Sign in
// with Apple starts with a fresh one-time code from Apple's own sheet, which delete-account exchanges and revokes. The code goes
// to that one request and nowhere else: it is never stored or logged.
//
// "cancelled" means the person pressed Cancel on Apple's sheet, so nothing may be deleted: a cancelled system sheet in a destructive
// flow must mean nothing happened. "skipped" means the deletion goes on without a code, because Apple says it must still be
// fulfilled: there is no Apple sign-in, this is not a real iOS build (Expo Go's bundle ID is not ours, so its code could never be
// exchanged), or Apple could not answer.
export type AppleConfirmation = { kind: "code"; code: string } | { kind: "cancelled" } | { kind: "skipped" };

export async function confirmWithApple(appleUserId: string | null): Promise<AppleConfirmation> {
  if (appleUserId === null || Platform.OS !== "ios" || isRunningInExpoGo() || getDataSource() === "mock") {
    return { kind: "skipped" };
  }
  try {
    if (!(await AppleAuthentication.isAvailableAsync())) return { kind: "skipped" };
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    // Another Apple Account on this phone: its code could revoke someone else's sign-in, so it is never sent.
    if (credential.user !== appleUserId || !credential.authorizationCode) return { kind: "skipped" };
    return { kind: "code", code: credential.authorizationCode };
  } catch (error) {
    const cancelled = (error as { code?: unknown } | null)?.code === "ERR_REQUEST_CANCELED";
    return { kind: cancelled ? "cancelled" : "skipped" };
  }
}
