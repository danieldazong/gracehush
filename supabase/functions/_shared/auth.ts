import { createRemoteJWKSet, errors, jwtVerify } from "jose";

import { optionalEnv, requireEnv } from "./env.ts";
import { AppError } from "./errors.ts";

// Verifies Clerk's normal session token (the same one the app sends to Supabase; there is no JWT template) against the
// public keys of the Clerk instance. The user id used anywhere in a function comes only from this result.
//
// Why not the platform's verify_jwt? That check only accepts tokens signed by Supabase, so the function is deployed with
// verify_jwt = false (supabase/config.toml) and this runs on every request instead.

export type AuthConfig = {
  // The Clerk Frontend API URL, no trailing slash: it is the token's `iss` and serves /.well-known/jwks.json.
  issuer: string;
  // Optional allow-list for the token's `azp`. A native app's token may have none; then the check is skipped.
  authorizedParties: string[];
};

export type VerifiedUser = { userId: string; sessionId: string };

const MAX_TOKEN_LENGTH = 4096;
const CLOCK_TOLERANCE_SECONDS = 5;

type KeySet = ReturnType<typeof createRemoteJWKSet>;
const keySets = new Map<string, KeySet>();

// One key set per issuer for the life of the worker: jose caches the keys and refetches on an unknown key id.
function keySetFor(issuer: string): KeySet {
  let keySet = keySets.get(issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 3_600_000,
    });
    keySets.set(issuer, keySet);
  }
  return keySet;
}

// The auth settings every function reads the same way: CLERK_ISSUER, and the optional CLERK_AUTHORIZED_PARTIES.
export function readAuthConfig(): AuthConfig {
  const parties = (optionalEnv("CLERK_AUTHORIZED_PARTIES") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return { issuer: normalizeIssuer(requireEnv("CLERK_ISSUER")), authorizedParties: parties };
}

// An https issuer, or a loopback one for the offline tests.
export function normalizeIssuer(value: string): string {
  const issuer = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new AppError("INTERNAL", "bad_config:CLERK_ISSUER");
  }
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !loopback) throw new AppError("INTERNAL", "bad_config:CLERK_ISSUER");
  return issuer;
}

function unauthorized(reason: string): AppError {
  return new AppError("UNAUTHORIZED", `auth:${reason}`);
}

function readBearerToken(req: Request): string {
  const header = req.headers.get("authorization");
  if (!header) throw unauthorized("missing");
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  if (!match || match[1].length > MAX_TOKEN_LENGTH) throw unauthorized("malformed");
  return match[1];
}

// A category for the log line, never the token or a claim. A key set that cannot be reached is our problem, not the
// user's: answering 401 would make the app drop a good session, so it is a 500.
function categoryOf(error: unknown): AppError {
  if (error instanceof errors.JWTExpired) return unauthorized("expired");
  if (error instanceof errors.JWSSignatureVerificationFailed) return unauthorized("signature");
  if (error instanceof errors.JWTClaimValidationFailed) return unauthorized("claims");
  if (error instanceof errors.JWKSNoMatchingKey) return unauthorized("key");
  if (
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTInvalid
  ) {
    return unauthorized("malformed");
  }
  return new AppError("INTERNAL", "auth:jwks_unavailable");
}

export async function verifyClerkRequest(req: Request, config: AuthConfig): Promise<VerifiedUser> {
  const token = readBearerToken(req);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, keySetFor(config.issuer), {
      algorithms: ["RS256"],
      issuer: config.issuer,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      // jwtVerify checks exp and nbf only when they are present. A token with no expiry must not pass.
      requiredClaims: ["exp", "sub"],
    }));
  } catch (error) {
    throw categoryOf(error);
  }

  const { sub, sid, role, sts, azp } = payload;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > 128) throw unauthorized("claims");
  if (typeof sid !== "string" || sid.length === 0) throw unauthorized("claims");
  // The top-level role the Clerk Supabase integration adds. (The operator role of the other product lives in
  // metadata.role and means nothing here.)
  if (role !== "authenticated") throw unauthorized("role");
  if (sts === "pending") throw unauthorized("pending");
  if (azp !== undefined && config.authorizedParties.length > 0) {
    if (typeof azp !== "string" || !config.authorizedParties.includes(azp)) throw unauthorized("party");
  }
  return { userId: sub, sessionId: sid };
}
