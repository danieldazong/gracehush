import { assertEquals } from "../../process-entry/testing/assert.ts";

import { signVoiceSession, verifyVoiceSession, VOICE_SESSION_TTL_MS } from "./session.ts";

const SECRET = "test-voice-session-secret-0123456789";
const NOW = 1_800_000_000_000;

function session(overrides: Partial<{ userId: string; issuedAt: number; expiresAt: number }> = {}) {
  return { userId: "user_abc", issuedAt: NOW, expiresAt: NOW + VOICE_SESSION_TTL_MS, ...overrides };
}

Deno.test("a session the server signed verifies, and gives back who it belongs to", async () => {
  const token = await signVoiceSession(SECRET, session());
  assertEquals(await verifyVoiceSession(SECRET, token, NOW + 1_000), session());
});

Deno.test("another secret, an expired session and a session from the future are refused", async () => {
  const token = await signVoiceSession(SECRET, session());
  assertEquals(await verifyVoiceSession("another-secret-0123456789abcdef", token, NOW), null);
  assertEquals(await verifyVoiceSession(SECRET, token, NOW + VOICE_SESSION_TTL_MS), null);
  const early = await signVoiceSession(SECRET, session({ issuedAt: NOW + 120_000 }));
  assertEquals(await verifyVoiceSession(SECRET, early, NOW), null);
});

Deno.test("a changed payload or signature, and anything that is not a token, is refused", async () => {
  const token = await signVoiceSession(SECRET, session());
  const [payload, signature] = token.split(".");
  const forged = btoa(JSON.stringify({ u: "someone_else", iat: NOW, exp: NOW + VOICE_SESSION_TTL_MS }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(await verifyVoiceSession(SECRET, `${forged}.${signature}`, NOW), null);
  assertEquals(await verifyVoiceSession(SECRET, `${payload}.${signature.slice(0, -2)}AA`, NOW), null);
  for (const bad of [undefined, null, 42, "", "a", "a.b.c", `${payload}.`, `.${signature}`, "x".repeat(2000)]) {
    assertEquals(await verifyVoiceSession(SECRET, bad, NOW), null);
  }
});
