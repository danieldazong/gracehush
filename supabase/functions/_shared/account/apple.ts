import { importPKCS8, SignJWT } from "jose";

// Sign in with Apple at account deletion (step 35), the only code that talks to Apple. Deleting a Clerk user leaves Gracehush in the
// person's list of apps that use Sign in with Apple, and Clerk keeps no Apple token, so the app asks Apple for a fresh authorization
// code at deletion, and this exchanges it for a refresh token and revokes that (Apple's TN3194). It is best effort: Apple says the
// deletion must be fulfilled without it, so nothing here throws or retries, and the caller logs the one word it answers.
//
// A 200 from /auth/revoke proves nothing: probed on 2026-11-02 with a made-up token and a made-up secret, it still answered 200 with
// an empty body. The token exchange is the only evidence the server has, and iOS Settings is the real proof.

// The app's bundle ID, which Apple calls the client id for a code made by the native flow. It is public.
export const APPLE_CLIENT_ID = "com.gracehush.app";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const APPLE_TOKEN_URL = `${APPLE_AUDIENCE}/auth/token`;
const APPLE_REVOKE_URL = `${APPLE_AUDIENCE}/auth/revoke`;
const TIMEOUT_MS = 8_000;
// A client secret is made for one request. Apple allows up to six months; nothing here needs more than a few minutes.
const CLIENT_SECRET_SECONDS = 300;
const APPLE_ID_FORMAT = /^[A-Za-z0-9]{10}$/;

// What Apple's token endpoint may answer in a 400's `error`. Anything else stays out of the log: a provider's words can quote what
// they were sent.
const APPLE_ERROR_WORDS = new Set([
  "invalid_grant",
  "invalid_client",
  "invalid_request",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
]);

export type AppleConfig =
  | { kind: "off" }
  | { kind: "bad"; reason: `bad_config:${string}` }
  | { kind: "ready"; teamId: string; keyId: string; privateKey: CryptoKey };

type ReadyConfig = Extract<AppleConfig, { kind: "ready" }>;

export type AppleRevocation = "revoked" | `token:${string}` | `revoke:${string}`;

export type AppleOptions = { timeoutMs?: number; fetch?: typeof fetch };

// The secrets: the Team ID, the key's id and the key itself (Apple's .p8 file as one line of base64). None set is off: this project
// before its Apple setup. Anything else that is not usable is bad, and names the secret, never its value.
export async function readAppleConfig(env: (name: string) => string | undefined): Promise<AppleConfig> {
  const teamId = env("APPLE_TEAM_ID")?.trim() ?? "";
  const keyId = env("APPLE_SIWA_KEY_ID")?.trim() ?? "";
  const encodedKey = env("APPLE_SIWA_PRIVATE_KEY_B64")?.trim() ?? "";
  if (teamId === "" && keyId === "" && encodedKey === "") return { kind: "off" };
  if (!APPLE_ID_FORMAT.test(teamId)) return { kind: "bad", reason: "bad_config:APPLE_TEAM_ID" };
  if (!APPLE_ID_FORMAT.test(keyId)) return { kind: "bad", reason: "bad_config:APPLE_SIWA_KEY_ID" };
  try {
    const privateKey = await importPKCS8(atob(encodedKey).trim(), "ES256");
    return { kind: "ready", teamId, keyId, privateKey };
  } catch {
    return { kind: "bad", reason: "bad_config:APPLE_SIWA_PRIVATE_KEY_B64" };
  }
}

// Apple's client secret: a JWT signed with the Sign in with Apple key. Made per request and never stored.
export function appleClientSecret(config: ReadyConfig, nowSeconds: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + CLIENT_SECRET_SECONDS)
    .setAudience(APPLE_AUDIENCE)
    .setSubject(APPLE_CLIENT_ID)
    .sign(config.privateKey);
}

// One form-encoded POST: its status and body, or why there was no answer.
async function postForm(
  url: string,
  fields: Record<string, string>,
  options: AppleOptions,
): Promise<{ status: number; text: string } | "timeout" | "network"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(fields).toString(),
      signal: controller.signal,
    });
    return { status: response.status, text: await response.text() };
  } catch {
    return controller.signal.aborted ? "timeout" : "network";
  } finally {
    clearTimeout(timer);
  }
}

function readJsonField(text: string, field: string): string | null {
  try {
    const value = (JSON.parse(text) as Record<string, unknown> | null)?.[field];
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

// Ends Gracehush's access to the person's Sign in with Apple. Never throws: it answers one word for the log, and only "revoked" says
// the exchange and the revoke both went through.
export async function revokeAppleSignIn(
  config: ReadyConfig,
  code: string,
  options: AppleOptions = {},
): Promise<AppleRevocation> {
  let clientSecret: string;
  try {
    clientSecret = await appleClientSecret(config, Math.floor(Date.now() / 1000));
  } catch {
    return "token:client_secret";
  }
  const client = { client_id: APPLE_CLIENT_ID, client_secret: clientSecret };

  const exchange = await postForm(APPLE_TOKEN_URL, { ...client, code, grant_type: "authorization_code" }, options);
  if (typeof exchange === "string") return `token:${exchange}`;
  if (exchange.status !== 200) {
    const word = exchange.status === 400 ? readJsonField(exchange.text, "error") : null;
    return word !== null && APPLE_ERROR_WORDS.has(word) ? `token:${word}` : `token:http_${exchange.status}`;
  }
  const refreshToken = readJsonField(exchange.text, "refresh_token");
  if (refreshToken === null) return "token:no_refresh_token";

  const revoke = await postForm(
    APPLE_REVOKE_URL,
    { ...client, token: refreshToken, token_type_hint: "refresh_token" },
    options,
  );
  if (typeof revoke === "string") return `revoke:${revoke}`;
  return revoke.status === 200 ? "revoked" : `revoke:http_${revoke.status}`;
}
