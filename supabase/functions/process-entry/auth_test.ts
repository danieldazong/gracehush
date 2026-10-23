import { SignJWT } from "jose";

import { type AuthConfig, normalizeIssuer, verifyClerkRequest } from "../_shared/auth.ts";
import type { ErrorCode } from "../_shared/errors.ts";
import { assertEquals, expectAppError } from "./testing/assert.ts";
import { installWorld, ISSUER, privateTestKey } from "./testing/fakes.ts";

const config: AuthConfig = { issuer: ISSUER, authorizedParties: [] };
const withToken = (token: string | null, scheme = "Bearer") =>
  new Request("https://x.test/", { headers: token === null ? {} : { Authorization: `${scheme} ${token}` } });

Deno.test("verifyClerkRequest", async (t) => {
  const world = installWorld();
  // Signs a token with these claims and demands that verifying it fails with this code and reason.
  const refuses = async (
    claims: Record<string, unknown>,
    code: ErrorCode,
    reason: string,
    options: { expiresIn?: number; kid?: string } = {},
    against: AuthConfig = config,
  ) => {
    const token = await world.token(claims, options);
    await expectAppError(() => verifyClerkRequest(withToken(token), against), code, reason);
  };
  const accepts = async (claims: Record<string, unknown>, options: { expiresIn?: number } = {}, against = config) =>
    await verifyClerkRequest(withToken(await world.token(claims, options)), against);

  try {
    await t.step("a good token gives the user and the session", async () => {
      assertEquals(await accepts({ sub: "user_abc", sid: "sess_9" }), { userId: "user_abc", sessionId: "sess_9" });
    });

    await t.step("no header, another scheme, junk and an oversize token are refused", async () => {
      await expectAppError(() => verifyClerkRequest(withToken(null), config), "UNAUTHORIZED", "auth:missing");
      await expectAppError(
        () => verifyClerkRequest(withToken("abc", "Basic"), config),
        "UNAUTHORIZED",
        "auth:malformed",
      );
      await expectAppError(
        () => verifyClerkRequest(withToken("not a token"), config),
        "UNAUTHORIZED",
        "auth:malformed",
      );
      await expectAppError(
        () => verifyClerkRequest(withToken("a".repeat(5000)), config),
        "UNAUTHORIZED",
        "auth:malformed",
      );
      await expectAppError(() => verifyClerkRequest(withToken("not-a-jwt"), config), "UNAUTHORIZED", "auth:malformed");
    });

    await t.step("a tampered signature or a forged subject is refused", async () => {
      const [h, p, s] = (await world.token({ sub: "user_abc" })).split(".");
      const flipped = s.slice(0, -2) + (s.at(-2) === "A" ? "B" : "A") + s.at(-1);
      await expectAppError(
        () => verifyClerkRequest(withToken(`${h}.${p}.${flipped}`), config),
        "UNAUTHORIZED",
        "auth:signature",
      );
      const forged = btoa(
        JSON.stringify({
          iss: ISSUER,
          sub: "user_victim",
          sid: "s",
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
      )
        .replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
      await expectAppError(
        () => verifyClerkRequest(withToken(`${h}.${forged}.${s}`), config),
        "UNAUTHORIZED",
        "auth:signature",
      );
    });

    await t.step("time: expired is refused, a few seconds of clock drift is not", async () => {
      await refuses({}, "UNAUTHORIZED", "auth:expired", { expiresIn: -60 });
      await accepts({}, { expiresIn: -2 });
    });

    await t.step("a token with no expiry, no subject or no session id is refused", async () => {
      // jose accepts a token with no exp unless it is told to require one; verifyClerkRequest tells it to.
      const noExp = await new SignJWT({ sid: "s", role: "authenticated" }).setProtectedHeader({
        alg: "RS256",
        kid: "ins_test",
      })
        .setIssuer(ISSUER).setSubject("u").sign(privateTestKey);
      await expectAppError(() => verifyClerkRequest(withToken(noExp), config), "UNAUTHORIZED", "auth:claims");
      await refuses({ sid: "" }, "UNAUTHORIZED", "auth:claims");
      await refuses({ sid: undefined }, "UNAUTHORIZED", "auth:claims");
    });

    await t.step("the role claim must be authenticated", async () => {
      await refuses({ role: "admin" }, "UNAUTHORIZED", "auth:role");
      await refuses({ role: undefined }, "UNAUTHORIZED", "auth:role");
      // The other product's operator role sits in metadata.role and means nothing here.
      await refuses({ role: undefined, metadata: { role: "authenticated" } }, "UNAUTHORIZED", "auth:role");
    });

    await t.step("a pending session is refused", async () => {
      await refuses({ sts: "pending" }, "UNAUTHORIZED", "auth:pending");
      await accepts({ sts: "active" });
    });

    await t.step("azp: absent is fine, present is checked only when a list is configured", async () => {
      const guarded: AuthConfig = { issuer: ISSUER, authorizedParties: ["https://app.example"] };
      await accepts({}, {}, guarded);
      await accepts({ azp: "https://app.example" }, {}, guarded);
      await refuses({ azp: "https://evil.example" }, "UNAUTHORIZED", "auth:party", {}, guarded);
      await accepts({ azp: "https://anything" });
    });

    await t.step("an unknown key id, a wrong issuer and a wrong algorithm are refused", async () => {
      await refuses({}, "UNAUTHORIZED", "auth:key", { kid: "ins_other" });
      // A key set that cannot be reached is our problem, not the person's: 500, never 401.
      await refuses({}, "INTERNAL", "auth:jwks_unavailable", {}, {
        issuer: "https://other.test",
        authorizedParties: [],
      });
      const hs = await new SignJWT({ sid: "s", role: "authenticated", sub: "u" }).setProtectedHeader({ alg: "HS256" })
        .setIssuer(ISSUER)
        .setExpirationTime("1m").sign(new TextEncoder().encode("0123456789abcdef0123456789abcdef"));
      await expectAppError(() => verifyClerkRequest(withToken(hs), config), "UNAUTHORIZED", "auth:malformed");
    });

    await t.step("the issuer must be https, or loopback for tests", async () => {
      assertEquals(normalizeIssuer(" https://a.clerk.accounts.dev/ "), "https://a.clerk.accounts.dev");
      assertEquals(normalizeIssuer("http://127.0.0.1:8000"), "http://127.0.0.1:8000");
      for (const bad of ["http://evil.example", "ftp://x", "not a url", ""]) {
        await expectAppError(() => normalizeIssuer(bad), "INTERNAL", "bad_config:CLERK_ISSUER");
      }
    });

    await t.step("nothing about the token reaches the log", () => {
      assertEquals(world.logs.length, 0);
    });
  } finally {
    world.restore();
  }
});
