// Clerk's Backend API, for account deletion (step 31): one read of a user and one delete. The secret key is a server secret,
// CLERK_SECRET_KEY, and can delete any user of the instance, so it is only ever read here and never logged. One attempt of 8
// seconds each, never a retry: a deletion that fails stops, and the person's next try continues it. Nothing here throws.

export const CLERK_API = "https://api.clerk.com/v1";
const TIMEOUT_MS = 8_000;

export type ClerkResult = { ok: true; notFound: boolean } | { ok: false; reason: string };

export type ClerkOptions = { timeoutMs?: number; fetch?: typeof fetch };

// The instance's secret key: sk_test_ (Development) or sk_live_ (Production), with something after the prefix and no space in
// it. Anything else is bad_config, and the caller logs the secret's NAME.
export function readClerkSecret(
  env: (name: string) => string | undefined,
): { ok: true; secretKey: string } | { ok: false; reason: "bad_config:CLERK_SECRET_KEY" } {
  const value = env("CLERK_SECRET_KEY")?.trim() ?? "";
  const shaped = /^sk_(test|live)_\S+$/.test(value);
  return shaped ? { ok: true, secretKey: value } : { ok: false, reason: "bad_config:CLERK_SECRET_KEY" };
}

async function send(
  method: "GET" | "DELETE",
  secretKey: string,
  userId: string,
  options: ClerkOptions,
): Promise<ClerkResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? fetch)(`${CLERK_API}/users/${encodeURIComponent(userId)}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (response.ok) return { ok: true, notFound: false };
    if (response.status === 404) return { ok: true, notFound: true };
    return { ok: false, reason: response.status >= 500 ? "http_5xx" : `http_${response.status}` };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

// Whether the user exists on this instance. A 404 for a user whose token was just verified means the key belongs to another
// instance: the caller must treat that as a configuration error, never as "already deleted".
export function getClerkUser(secretKey: string, userId: string, options: ClerkOptions = {}): Promise<ClerkResult> {
  return send("GET", secretKey, userId, options);
}

// Deletes the user. A 404 is a user that is already gone, which counts as done.
export function deleteClerkUser(secretKey: string, userId: string, options: ClerkOptions = {}): Promise<ClerkResult> {
  return send("DELETE", secretKey, userId, options);
}
