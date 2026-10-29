import { readJwtPayload } from "@/utils/jwt";

// EXPO_PUBLIC_* values are put into the bundle when it is built, so each one is read by its full name:
// process.env[name] would be undefined in the app.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export type SupabaseEnvCheck = { status: "ok" } | { status: "missing" | "invalid"; message: string };

const FIX = "Fix it in .env.local (see .env.example) and restart Expo with `npx expo start -c`.";

// Pure, so it can be tried with any value. A secret key in an EXPO_PUBLIC_ variable would ship inside the app and
// bypass every row level security policy, so it is refused here as well as in code review.
export function checkSupabaseEnv(url: string, key: string): SupabaseEnvCheck {
  if (url === "") {
    return { status: "missing", message: `EXPO_PUBLIC_SUPABASE_URL is missing. ${FIX}` };
  }
  if (key === "") {
    return { status: "missing", message: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. ${FIX}` };
  }
  // The base project address, with nothing after the host (no /rest/v1).
  if (!/^https:\/\/[^/\s]+\/?$/.test(url)) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_SUPABASE_URL must be the base project address, like https://abcd1234.supabase.co, with nothing after it (no /rest/v1). ${FIX}`,
    };
  }
  const isSecret =
    key.startsWith("sb_secret_") || readJwtPayload(key)?.role === "service_role";
  if (isSecret) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key. Never put one in the app: use the publishable key (sb_publishable_...) from Settings > API Keys. ${FIX}`,
    };
  }
  // The publishable key, or the older anon key (a JWT whose role is anon).
  const isPublishable = key.startsWith("sb_publishable_") || readJwtPayload(key)?.role === "anon";
  if (!isPublishable) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY does not look like a Supabase publishable key (sb_publishable_...). ${FIX}`,
    };
  }
  return { status: "ok" };
}

export const supabaseEnv = checkSupabaseEnv(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// RevenueCat's public SDK keys (step 30). They are made to ship in an app, and still live only in .env.local. The Test Store key
// (test_) runs in Expo Go and in development builds; a store build carries the platform keys (appl_ for the App Store, goog_
// for Google Play).
export const REVENUECAT_TEST_STORE_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY ?? "";
export const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";

export type RevenueCatKeyKind = "test_store" | "app_store" | "play_store";
export type RevenueCatKeyChoice =
  | { kind: RevenueCatKeyKind; apiKey: string }
  | { kind: "none"; reason: "missing" | "secret_key" | "test_key_in_release" };

// Pure: which key this build may use. A secret key (sk_) in the app is never used, whatever else is set. Expo Go runs RevenueCat
// in its Browser Mode, which takes only the Test Store key. A native build takes its platform's key, and in development only
// falls back to the Test Store key: RevenueCat crashes a release build that uses one (on purpose), so a release build with
// nothing else has no purchases instead.
export function chooseRevenueCatKey(input: {
  inExpoGo: boolean;
  isDev: boolean;
  platform: "ios" | "android" | "other";
  testKey: string;
  iosKey: string;
  androidKey: string;
}): RevenueCatKeyChoice {
  const testKey = input.testKey.trim();
  const iosKey = input.iosKey.trim();
  const androidKey = input.androidKey.trim();
  if ([testKey, iosKey, androidKey].some((key) => key.startsWith("sk_"))) return { kind: "none", reason: "secret_key" };
  const hasTestKey = testKey.startsWith("test_");
  if (input.inExpoGo) return hasTestKey ? { kind: "test_store", apiKey: testKey } : { kind: "none", reason: "missing" };
  if (input.platform === "ios" && iosKey.startsWith("appl_")) return { kind: "app_store", apiKey: iosKey };
  if (input.platform === "android" && androidKey.startsWith("goog_")) return { kind: "play_store", apiKey: androidKey };
  if (input.isDev && hasTestKey) return { kind: "test_store", apiKey: testKey };
  return { kind: "none", reason: hasTestKey ? "test_key_in_release" : "missing" };
}
