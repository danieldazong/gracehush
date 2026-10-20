import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json stays the base (plugins and permissions live there). This file only adds the Google values
// that come from the environment, so the client IDs are never committed.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // ConfigContext types `config` as Partial<ExpoConfig>, so ExpoConfig's required fields need a value.
  name: config.name ?? "gracehush",
  slug: config.slug ?? "gracehush",
  extra: {
    ...config.extra,
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID:
      process.env.EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME,
  },
});
