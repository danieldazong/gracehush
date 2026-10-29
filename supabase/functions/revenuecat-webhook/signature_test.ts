import { assertEquals } from "../process-entry/testing/assert.ts";
import { constantTimeEqual, parseSignatureHeader, signPayload, verifySignature } from "./signature.ts";

// RevenueCat's HMAC signature (step 30): X-RevenueCat-Webhook-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 over
// "<t>.<raw body>">, keyed by the signing secret. Checked on the raw body exactly as it arrived.

const SECRET = "whsec_test_signing_secret";
const BODY = JSON.stringify({ api_version: "1.0", event: { type: "INITIAL_PURCHASE", app_user_id: "user_test" } });
const T = 1_793_000_000;

Deno.test("signature: a header made with the secret over the raw body verifies", async () => {
  const header = `t=${T},v1=${await signPayload(BODY, SECRET, T)}`;
  assertEquals(await verifySignature(BODY, header, SECRET, T), true);
  assertEquals(await verifySignature(BODY, header, SECRET, T + 299), true);
  // Spaces after the comma are tolerated; the parts are what count.
  assertEquals(await verifySignature(BODY, `t=${T}, v1=${await signPayload(BODY, SECRET, T)}`, SECRET, T), true);
});

Deno.test("signature: the same request with another secret, or a body that was re-stringified, fails", async () => {
  const header = `t=${T},v1=${await signPayload(BODY, SECRET, T)}`;
  assertEquals(await verifySignature(BODY, header, "another_secret", T), false);
  const reformatted = JSON.stringify(JSON.parse(BODY), null, 2);
  assertEquals(await verifySignature(reformatted, header, SECRET, T), false);
  // The timestamp is part of what is signed: a header that keeps the hex and changes t fails.
  const hex = await signPayload(BODY, SECRET, T);
  assertEquals(await verifySignature(BODY, `t=${T + 1},v1=${hex}`, SECRET, T + 1), false);
});

Deno.test("signature: a timestamp more than 300 seconds old or ahead fails", async () => {
  const header = `t=${T},v1=${await signPayload(BODY, SECRET, T)}`;
  assertEquals(await verifySignature(BODY, header, SECRET, T + 300), true);
  assertEquals(await verifySignature(BODY, header, SECRET, T + 301), false);
  assertEquals(await verifySignature(BODY, header, SECRET, T - 300), true);
  assertEquals(await verifySignature(BODY, header, SECRET, T - 301), false);
});

Deno.test("signature: a missing or malformed header never verifies", async () => {
  const hex = await signPayload(BODY, SECRET, T);
  for (
    const header of [
      null,
      "",
      hex,
      `v1=${hex}`,
      `t=${T}`,
      `t=abc,v1=${hex}`,
      `t=${T}.5,v1=${hex}`,
      `t=${T},v1=${hex.slice(1)}`,
      `t=${T},v1=${hex}0`,
      `t=${T},v1=${hex.toUpperCase().replace(/[0-9]/g, "Z")}`,
      `t=${T};v1=${hex}`,
    ]
  ) {
    assertEquals(await verifySignature(BODY, header, SECRET, T), false, `accepted ${String(header)}`);
  }
  assertEquals(parseSignatureHeader(`t=${T},v1=${hex}`), { t: T, v1: hex });
  assertEquals(parseSignatureHeader(`v1=${hex},t=${T}`), { t: T, v1: hex });
  assertEquals(parseSignatureHeader("t=1,v1=xyz"), null);
});

Deno.test("signature: hex is compared in constant time and only equal strings match", () => {
  assertEquals(constantTimeEqual("abcdef", "abcdef"), true);
  assertEquals(constantTimeEqual("abcdef", "abcdeF"), false);
  assertEquals(constantTimeEqual("abcdef", "abcde"), false);
  assertEquals(constantTimeEqual("", ""), true);
});
