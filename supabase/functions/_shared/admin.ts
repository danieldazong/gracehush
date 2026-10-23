import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "./errors.ts";
import { requireEnv } from "./env.ts";

// The service-role key bypasses row level security, so this client is created inside one request, used with the user
// id that verifyClerkRequest returned, and dropped. Every query on a user's table must filter by that id.
//
// The hosted runtime provides the project's keys: SUPABASE_SECRET_KEYS (a JSON object, the key named "default") for a
// project on the new API keys, and the older SUPABASE_SERVICE_ROLE_KEY. Read in the step 19 review from
// supabase.com/docs/guides/functions/secrets and /getting-started/migrating-to-new-api-keys.
export function readServiceKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed: unknown = JSON.parse(keys);
      const value = typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)["default"]
        : undefined;
      if (typeof value === "string" && value) return value;
    } catch {
      // Fall through to the older variable.
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new AppError("INTERNAL", "missing_config:SUPABASE_SECRET_KEYS");
}

export function createAdmin(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), readServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // A failed read is answered at once: the app retries the same clientEntryId, and the claim makes that safe.
    db: { retry: false },
  });
}
