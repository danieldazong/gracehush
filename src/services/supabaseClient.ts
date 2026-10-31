import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseEnv } from "@/constants/env";
import type { Database } from "@/types/database";
import { readJwtPayload } from "@/utils/jwt";
import { NoSessionError } from "@/utils/supabaseErrors";

// The signed-in Clerk user, set by SupabaseAuthBridge. `getToken` is Clerk's own and is called without a JWT
// template, because the session token itself is what Supabase verifies (Third-Party Auth). `skipCache` asks Clerk's
// server for a new token even while the cached one is valid. Nothing is cached or shared here.
export type SupabaseSession = {
  userId: string;
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
};

let session: SupabaseSession | null = null;
let client: SupabaseClient<Database> | null = null;

export function setSupabaseSession(next: SupabaseSession | null): void {
  session = next;
}

export function getSupabaseUserId(): string | null {
  return session?.userId ?? null;
}

// The one client of the app, or null when nobody is signed in (or the keys are not set), so a caller has to
// handle "no session" before it can send anything. It is created on first use, because supabase-js asks for a
// token the moment it is created. Never call supabase.auth.* on it: with the accessToken option Clerk owns the
// session and supabase-js throws. TODO(19): Edge Functions verify this same Clerk session token against Clerk's
// JWKS; there is no template token.
export function getSupabase(): SupabaseClient<Database> | null {
  if (session === null || supabaseEnv.status !== "ok") return null;
  client ??= createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    accessToken: async () => {
      const token = session === null ? null : await session.getToken();
      if (!token) throw new NoSessionError();
      return token;
    },
    // postgrest-js retries a failed read 3 times, 1 s, 2 s and 4 s apart: offline, Profile would hold its
    // skeleton for about 7 seconds. The app is offline-first and its screens retry on focus, so fail at once.
    db: { retry: false },
  });
  return client;
}

// Realtime's token check (step 33): Clerk mints the next session token 17 s before the cached one expires, as a background
// fetch, and hands back the cached one until 5 s are left when that fetch fails or is late. When the cached token has `seconds`
// or fewer left, this asks Clerk's server for a new one, which Clerk caches, so the next getToken() returns it. It answers
// whether it renewed, and never returns or logs a token. Clerk shares one fetch between callers, so overlapping calls are safe.
export async function renewSessionTokenIfExpiring(seconds: number): Promise<boolean> {
  const current = session;
  if (current === null) return false;
  try {
    const token = await current.getToken();
    const exp = token ? readJwtPayload(token)?.exp : undefined;
    if (typeof exp !== "number" || exp - Date.now() / 1000 > seconds) return false;
    await current.getToken({ skipCache: true });
    return true;
  } catch {
    return false;
  }
}

export type SessionTokenCheck = "no-session" | "ok" | "no-role-claim" | "unreadable";

// For the dev panel's Supabase check: does the Clerk token carry role = authenticated, the claim the Clerk
// integration adds? Answers a label only. The token and its claims are never returned or logged.
export async function checkSessionToken(): Promise<SessionTokenCheck> {
  if (session === null) return "no-session";
  try {
    const token = await session.getToken();
    if (!token) return "no-session";
    const payload = readJwtPayload(token);
    if (payload === null) return "unreadable";
    return payload.role === "authenticated" ? "ok" : "no-role-claim";
  } catch {
    return "unreadable";
  }
}

export type SessionTokenFacts = {
  issuerHost: string | null;
  sid: boolean;
  azp: boolean;
  sts: string | null;
};

// For the dev panel: what the Clerk token carries, so the Edge Function's CLERK_ISSUER secret can be checked against a
// real token. It returns the issuer's host (the public address of the Clerk instance), whether the sid and azp claims
// exist and the session status, never a value that identifies anyone.
export async function describeSessionToken(): Promise<SessionTokenFacts | null> {
  if (session === null) return null;
  try {
    const token = await session.getToken();
    const payload = token ? readJwtPayload(token) : null;
    if (payload === null) return null;
    let issuerHost: string | null = null;
    if (typeof payload.iss === "string") {
      try {
        issuerHost = new URL(payload.iss).host;
      } catch {
        // An issuer that is not a URL is reported as none.
      }
    }
    return {
      issuerHost,
      sid: typeof payload.sid === "string",
      azp: typeof payload.azp === "string",
      sts: typeof payload.sts === "string" ? payload.sts : null,
    };
  } catch {
    return null;
  }
}
