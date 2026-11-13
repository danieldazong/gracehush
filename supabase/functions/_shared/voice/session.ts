// A live voice session (step 39). ElevenLabs, not the phone, calls Scholar's custom LLM endpoint, so that endpoint cannot
// read the person's Clerk token. When the phone starts a talk, scholar-voice-start (which does verify the Clerk token) signs
// who the talk belongs to, the phone passes the signed value to ElevenLabs as the custom LLM extra body, and ElevenLabs
// hands it to the endpoint with every turn. The phone can read the value but cannot forge or change it: only the server
// holds SCHOLAR_VOICE_SESSION_SECRET. Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 of the first part).

export type VoiceSession = {
  // The Clerk user id, from the verified token.
  userId: string;
  // When the session was signed and when it stops being accepted, in milliseconds.
  issuedAt: number;
  expiresAt: number;
};

// A talk lasts at most ElevenLabs' max_duration_seconds (600 by default); the token is minted just before it starts.
export const VOICE_SESSION_TTL_MS = 12 * 60_000;
const MAX_TOKEN_LENGTH = 1024;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signVoiceSession(secret: string, session: VoiceSession): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ u: session.userId, iat: session.issuedAt, exp: session.expiresAt })),
  );
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

// Null for anything that is not a session this server signed and that is still valid. crypto.subtle.verify compares the
// signature in constant time.
export async function verifyVoiceSession(
  secret: string,
  token: unknown,
  now = Date.now(),
): Promise<VoiceSession | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signatureText] = parts;
  const signature = fromBase64Url(signatureText);
  if (signature === null) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), signature, encoder.encode(payload));
  if (!valid) return null;
  const json = fromBase64Url(payload);
  if (json === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { u, iat, exp } = body as Record<string, unknown>;
  if (typeof u !== "string" || u.length === 0 || u.length > 128) return null;
  if (typeof iat !== "number" || typeof exp !== "number" || !Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (now >= exp || iat > now + 60_000) return null;
  return { userId: u, issuedAt: iat, expiresAt: exp };
}
