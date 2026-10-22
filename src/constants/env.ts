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
