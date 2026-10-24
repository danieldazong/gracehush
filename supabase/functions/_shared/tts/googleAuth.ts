import { Buffer } from "node:buffer";

import { importPKCS8, SignJWT } from "jose";

// Signs in to Google as a service account, to call Cloud Text-to-Speech (step 22).
//
// An API key does not work here. Probed on 2026-10-23 with the project's Gemini key: texttospeech.googleapis.com answered
// 401 "API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that
// assert a principal", for the key in the x-goog-api-key header and in ?key= alike, and Google's current Text-to-Speech
// pages document only service accounts, application default credentials and OAuth tokens. So the function holds a
// service account's key file and trades it for a short-lived access token (Google's "service account to OAuth 2.0 token"
// flow for servers: a JWT signed with the account's private key, posted to the token endpoint).
//
// The key file is one secret, GOOGLE_TTS_CREDENTIALS_B64: the JSON file's bytes, base64 on one line, so that no quote,
// line break or backslash in it can be lost on the way into a secret. Nothing here is ever logged: not the key, not the
// signed assertion, not the token, and not Google's error description (only its short error word, such as invalid_grant).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";

export type ServiceAccount = { clientEmail: string; privateKey: string };

// "invalid": the credentials were refused or are unusable, so asking again will not help (a wrong or deleted key).
// "transient": Google or the network is busy or slow, so asking again may help.
export class GoogleAuthError extends Error {
  readonly kind: "invalid" | "transient";
  readonly reason: string;
  constructor(kind: "invalid" | "transient", reason: string) {
    super(reason);
    this.name = "GoogleAuthError";
    this.kind = kind;
    this.reason = reason;
  }
}

export const authTiming = { requestTimeoutMs: 10_000, refreshBeforeExpiryMs: 5 * 60_000 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Reads the secret: base64 of the service account's JSON key file. Null for anything that is not one.
export function parseServiceAccount(encoded: string): ServiceAccount | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(Buffer.from(encoded.trim(), "base64")));
  } catch {
    return null;
  }
  if (!isRecord(json) || json.type !== "service_account") return null;
  const { client_email: clientEmail, private_key: privateKey } = json;
  if (typeof clientEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) return null;
  if (typeof privateKey !== "string" || !privateKey.includes("BEGIN PRIVATE KEY")) return null;
  return { clientEmail, privateKey };
}

const cache = new Map<string, { token: string; expiresAtMs: number }>();
const running = new Map<string, Promise<string>>();

// For tests, and for a worker that wants to start clean.
export function clearTokenCache(): void {
  cache.clear();
  running.clear();
}

// After Google answers 401 to a token that was cached, the next getAccessToken signs in again.
export function forgetAccessToken(account: ServiceAccount): void {
  cache.delete(account.clientEmail);
}

async function signIn(account: ServiceAccount, nowMs: number): Promise<string> {
  let assertion: string;
  try {
    const key = await importPKCS8(account.privateKey, "RS256");
    const issuedAt = Math.floor(nowMs / 1000);
    assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.clientEmail)
      .setAudience(TOKEN_URL)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(key);
  } catch {
    throw new GoogleAuthError("invalid", "tts_auth:bad_key");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), authTiming.requestTimeoutMs);
  try {
    let response: Response;
    let raw: string;
    try {
      response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }),
        signal: controller.signal,
      });
      raw = await response.text();
    } catch {
      throw new GoogleAuthError("transient", controller.signal.aborted ? "tts_auth:timeout" : "tts_auth:network");
    }
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // A body that is not JSON is judged by its status below.
    }
    if (!response.ok) {
      const word = isRecord(json) && typeof json.error === "string" && /^[a-z_]{3,40}$/.test(json.error)
        ? json.error
        : `http_${response.status}`;
      const busy = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new GoogleAuthError(busy ? "transient" : "invalid", `tts_auth:${word}`);
    }
    if (!isRecord(json) || typeof json.access_token !== "string" || json.access_token === "") {
      throw new GoogleAuthError("transient", "tts_auth:shape");
    }
    const seconds = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600;
    cache.set(account.clientEmail, { token: json.access_token, expiresAtMs: nowMs + seconds * 1000 });
    return json.access_token;
  } finally {
    clearTimeout(timer);
  }
}

// A token for the account, from the cache while it has more than five minutes left. Two requests that need one at the
// same moment share a single sign-in.
export function getAccessToken(account: ServiceAccount, nowMs: number = Date.now()): Promise<string> {
  const cached = cache.get(account.clientEmail);
  if (cached !== undefined && cached.expiresAtMs - authTiming.refreshBeforeExpiryMs > nowMs) {
    return Promise.resolve(cached.token);
  }
  const already = running.get(account.clientEmail);
  if (already !== undefined) return already;
  const started = signIn(account, nowMs).finally(() => running.delete(account.clientEmail));
  running.set(account.clientEmail, started);
  return started;
}
