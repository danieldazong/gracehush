import { assertEquals } from "../../process-entry/testing/assert.ts";

import { VOICE_LIMITS, VOICE_SESSION_TTL_MS } from "./constants.ts";
import { signVoiceSession, verifyVoiceSession, type VoiceSession } from "./session.ts";

// A live talk's signed session (step 39): who a talk belongs to and what it is about, readable by the phone and by ElevenLabs,
// changeable by neither.

const SECRET = "test-voice-session-secret-0123456789";
const NOW = 1_800_000_000_000;
const TALK = "7b1e6a52-3c1d-4f6a-9b2e-0d5c8a7f4e31";
const CONVERSATION = "c0a8012e-0000-4000-8000-000000000001";
const REFLECTION = "5f0e7c1a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

function session(overrides: Partial<VoiceSession> = {}): VoiceSession {
  return {
    userId: "user_abc",
    talkId: TALK,
    conversationId: CONVERSATION,
    reflectionId: null,
    region: "us",
    voice: "warm",
    issuedAt: NOW,
    expiresAt: NOW + VOICE_SESSION_TTL_MS,
    ...overrides,
  };
}

const base64Url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

Deno.test("session: one the server signed verifies, and gives back the person, the talk and what it is about", async () => {
  const token = await signVoiceSession(SECRET, session());
  assertEquals(await verifyVoiceSession(SECRET, token, NOW + 1_000), session());
  const full = session({ reflectionId: REFLECTION, region: "other", voice: "storyteller" });
  assertEquals(await verifyVoiceSession(SECRET, await signVoiceSession(SECRET, full), NOW + 1_000), full);
  // It fits where ElevenLabs carries it, with the longest user id.
  const long = await signVoiceSession(SECRET, session({ userId: "u".repeat(128), reflectionId: REFLECTION }));
  assertEquals(long.length < 1024, true);
  assertEquals((await verifyVoiceSession(SECRET, long, NOW))?.userId.length, 128);
});

Deno.test("session: it is accepted for 32 minutes, a little longer than ElevenLabs lets a talk run", async () => {
  assertEquals(VOICE_SESSION_TTL_MS, 32 * 60_000);
  assertEquals(VOICE_SESSION_TTL_MS > VOICE_LIMITS.backstopSeconds * 1000, true);
  const token = await signVoiceSession(SECRET, session());
  assertEquals((await verifyVoiceSession(SECRET, token, NOW + VOICE_SESSION_TTL_MS - 1))?.talkId, TALK);
  assertEquals(await verifyVoiceSession(SECRET, token, NOW + VOICE_SESSION_TTL_MS), null);
});

Deno.test("session: another secret, an expired session and a session from the future are refused", async () => {
  const token = await signVoiceSession(SECRET, session());
  assertEquals(await verifyVoiceSession("another-secret-0123456789abcdef", token, NOW), null);
  assertEquals(await verifyVoiceSession(SECRET, token, NOW + VOICE_SESSION_TTL_MS), null);
  const early = await signVoiceSession(SECRET, session({ issuedAt: NOW + 120_000 }));
  assertEquals(await verifyVoiceSession(SECRET, early, NOW), null);
});

Deno.test("session: a changed payload or signature, and anything that is not a token, is refused", async () => {
  const token = await signVoiceSession(SECRET, session());
  const [payload, signature] = token.split(".");
  const forged = base64Url({
    u: "someone_else",
    t: TALK,
    c: CONVERSATION,
    e: null,
    r: "us",
    v: "warm",
    iat: NOW,
    exp: NOW + VOICE_SESSION_TTL_MS,
  });
  assertEquals(await verifyVoiceSession(SECRET, `${forged}.${signature}`, NOW), null);
  assertEquals(await verifyVoiceSession(SECRET, `${payload}.${signature.slice(0, -2)}AA`, NOW), null);
  for (const bad of [undefined, null, 42, "", "a", "a.b.c", `${payload}.`, `.${signature}`, "x".repeat(2000)]) {
    assertEquals(await verifyVoiceSession(SECRET, bad, NOW), null);
  }
});

Deno.test("session: a correctly signed payload with a part that is not what a talk carries is still refused", async () => {
  // Only the server can sign, so these cannot come from outside: they guard against a fault of our own.
  const sign = async (payload: Record<string, unknown>) => {
    const text = base64Url(payload);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
    let binary = "";
    for (const byte of signed) binary += String.fromCharCode(byte);
    return `${text}.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  };
  const good = {
    u: "user_abc",
    t: TALK,
    c: CONVERSATION,
    e: null,
    r: "us",
    v: "warm",
    iat: NOW,
    exp: NOW + VOICE_SESSION_TTL_MS,
  };
  assertEquals((await verifyVoiceSession(SECRET, await sign(good), NOW))?.userId, "user_abc");
  const broken: Record<string, unknown>[] = [
    { ...good, u: "" },
    { ...good, u: "u".repeat(129) },
    { ...good, t: "not-a-talk" },
    { ...good, t: undefined },
    { ...good, c: "C0A8012E-0000-4000-8000-000000000001" },
    { ...good, e: "" },
    { ...good, e: 7 },
    { ...good, r: "gb" },
    { ...good, v: "sarah" },
    { ...good, v: undefined },
    { ...good, iat: "now" },
    { ...good, exp: null },
  ];
  for (const payload of broken) assertEquals(await verifyVoiceSession(SECRET, await sign(payload), NOW), null);
});
