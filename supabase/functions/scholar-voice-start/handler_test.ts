import { assertEquals } from "../process-entry/testing/assert.ts";
import { handle } from "./handler.ts";

// The test run's start function (step 39): it never mints anything without a verified Clerk token.

Deno.test("only POST, and only with a Clerk token", async () => {
  Deno.env.set("CLERK_ISSUER", "https://clerk.example.test");
  const get = await handle(new Request("https://example.test/functions/v1/scholar-voice-start", { method: "GET" }));
  assertEquals(get.status, 405);
  const noToken = await handle(
    new Request("https://example.test/functions/v1/scholar-voice-start", { method: "POST" }),
  );
  assertEquals(noToken.status, 401);
  const preflight = await handle(
    new Request("https://example.test/functions/v1/scholar-voice-start", { method: "OPTIONS" }),
  );
  assertEquals(preflight.status, 204);
});
