// RevenueCat's webhook signature (step 30), from its docs (read 2026-10-29): the header X-RevenueCat-Webhook-Signature holds
// t=<unix seconds>,v1=<hex HMAC-SHA256>, computed with the integration's signing secret over "<t>.<raw body>", the body
// exactly as it arrived (before any JSON parsing). RevenueCat signs every delivery attempt afresh, so t is when that request
// was signed. Pure apart from Web Crypto: nothing here reads the environment or logs.

export const SIGNATURE_TOLERANCE_SECONDS = 300;

const HEX_64 = /^[0-9a-f]{64}$/;
const DIGITS = /^[0-9]{1,12}$/;

export function parseSignatureHeader(value: string | null): { t: number; v1: string } | null {
  if (value === null) return null;
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of value.split(",")) {
    const [name, ...rest] = part.trim().split("=");
    const field = rest.join("=");
    if (name === "t" && DIGITS.test(field)) t = Number(field);
    else if (name === "v1" && HEX_64.test(field)) v1 = field;
    else return null;
  }
  return t === null || v1 === null ? null : { t, v1 };
}

// Compares two strings in time that depends only on their length, so a wrong signature tells nothing about the right one.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export async function signPayload(rawBody: string, secret: string, t: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${rawBody}`));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// True only for a header that parses, a timestamp within the tolerance of now (either side), and a v1 that equals the HMAC of
// this exact raw body.
export async function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  const parsed = parseSignatureHeader(header);
  if (parsed === null || Math.abs(nowSeconds - parsed.t) > toleranceSeconds) return false;
  return constantTimeEqual(await signPayload(rawBody, secret, parsed.t), parsed.v1);
}
