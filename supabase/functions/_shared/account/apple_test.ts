import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from "jose";

import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import {
  APPLE_TEST_KEY_ID,
  APPLE_TEST_TEAM_ID,
  appleOn,
  installWorld,
  type World,
} from "../../process-entry/testing/fakes.ts";
import { APPLE_CLIENT_ID, appleClientSecret, type AppleConfig, readAppleConfig, revokeAppleSignIn } from "./apple.ts";

// Sign in with Apple at account deletion (step 35): which secrets count as ready, the client secret Apple asks for, the code
// exchanged and then revoked, in that order, and a word for every way it can go wrong. One attempt each, and nothing thrown.

const CODE = "c.one-time-code";

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      await work(world);
    } finally {
      world.restore();
    }
  };
}

const envOf = (values: Record<string, string | undefined>) => (name: string) => values[name];

async function pkcs8Base64(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return btoa(await exportPKCS8(privateKey));
}

async function readyConfig(world: World): Promise<Extract<AppleConfig, { kind: "ready" }>> {
  await appleOn(world);
  const config = await readAppleConfig((name) => Deno.env.get(name));
  assertEquals(config.kind, "ready");
  return config as Extract<AppleConfig, { kind: "ready" }>;
}

Deno.test("config: none of the three set is off, whitespace counts as unset", async () => {
  assertEquals(await readAppleConfig(envOf({})), { kind: "off" });
  assertEquals(
    await readAppleConfig(envOf({ APPLE_TEAM_ID: " ", APPLE_SIWA_KEY_ID: "", APPLE_SIWA_PRIVATE_KEY_B64: "  " })),
    { kind: "off" },
  );
});

Deno.test("config: a value that is missing or malformed is bad, naming the secret and never its value", async () => {
  const key = await pkcs8Base64();
  const good = { APPLE_TEAM_ID: "ABCDE12345", APPLE_SIWA_KEY_ID: "FGHIJ67890", APPLE_SIWA_PRIVATE_KEY_B64: key };
  const cases: [Record<string, string | undefined>, string][] = [
    [{ ...good, APPLE_TEAM_ID: undefined }, "bad_config:APPLE_TEAM_ID"],
    [{ ...good, APPLE_TEAM_ID: "SECRETSHORT1" }, "bad_config:APPLE_TEAM_ID"],
    [{ ...good, APPLE_TEAM_ID: "SHORT" }, "bad_config:APPLE_TEAM_ID"],
    [{ ...good, APPLE_SIWA_KEY_ID: undefined }, "bad_config:APPLE_SIWA_KEY_ID"],
    [{ ...good, APPLE_SIWA_KEY_ID: "ELEVENCHARS" }, "bad_config:APPLE_SIWA_KEY_ID"],
    [{ ...good, APPLE_SIWA_PRIVATE_KEY_B64: undefined }, "bad_config:APPLE_SIWA_PRIVATE_KEY_B64"],
    // Not base64, base64 of something else, and a key file of another kind.
    [{ ...good, APPLE_SIWA_PRIVATE_KEY_B64: "!!not base64!!" }, "bad_config:APPLE_SIWA_PRIVATE_KEY_B64"],
    [{ ...good, APPLE_SIWA_PRIVATE_KEY_B64: btoa("SECRET-VALUE") }, "bad_config:APPLE_SIWA_PRIVATE_KEY_B64"],
    [
      { ...good, APPLE_SIWA_PRIVATE_KEY_B64: btoa("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n") },
      "bad_config:APPLE_SIWA_PRIVATE_KEY_B64",
    ],
  ];
  for (const [values, reason] of cases) {
    const config = await readAppleConfig(envOf(values));
    assertEquals(config, { kind: "bad", reason }, reason);
    assert(!JSON.stringify(config).includes("SECRET"), "the value stays out of the answer");
  }
});

Deno.test("config: all three good is ready, surrounding whitespace ignored", async () => {
  const config = await readAppleConfig(
    envOf({
      APPLE_TEAM_ID: " ABCDE12345 ",
      APPLE_SIWA_KEY_ID: "FGHIJ67890\n",
      APPLE_SIWA_PRIVATE_KEY_B64: ` ${await pkcs8Base64()} `,
    }),
  );
  assertEquals(config.kind, "ready");
  if (config.kind !== "ready") return;
  assertEquals([config.teamId, config.keyId], ["ABCDE12345", "FGHIJ67890"]);
});

Deno.test(
  "client secret: ES256 with the key id, the Team ID as iss, the bundle ID as sub, Apple as aud, alive for five minutes",
  flow(async (world) => {
    const config = await readyConfig(world);
    const now = Math.floor(Date.now() / 1000);
    const secret = await appleClientSecret(config, now);
    assertEquals(decodeProtectedHeader(secret), { alg: "ES256", kid: APPLE_TEST_KEY_ID });
    const claims = decodeJwt(secret);
    assertEquals(claims, {
      iss: APPLE_TEST_TEAM_ID,
      iat: now,
      exp: now + 300,
      aud: "https://appleid.apple.com",
      sub: APPLE_CLIENT_ID,
    });
    // It verifies against the public half of the key it was signed with, and no other.
    await jwtVerify(secret, world.appleKey as CryptoKey, { algorithms: ["ES256"] });
    const stranger = await generateKeyPair("ES256");
    let refused = false;
    await jwtVerify(secret, stranger.publicKey, { algorithms: ["ES256"] }).catch(() => (refused = true));
    assert(refused, "another key does not verify it");
    assertEquals(APPLE_CLIENT_ID, "com.gracehush.app");
  }),
);

Deno.test(
  "revoke: the code is exchanged, then the refresh token is revoked, in that order and with Apple's form fields",
  flow(async (world) => {
    const config = await readyConfig(world);
    world.appleCodes.add(CODE);
    assertEquals(await revokeAppleSignIn(config, CODE), "revoked");
    assertEquals(world.appleCodes.size, 0, "the code was used");
    assertEquals(world.appleRevoked, [`rt.${CODE}`]);

    const [token] = world.appleTokenCalls;
    assertEquals(token.method, "POST");
    assertEquals(token.url.pathname, "/auth/token");
    assertEquals(token.headers.get("content-type"), "application/x-www-form-urlencoded");
    const tokenForm = new URLSearchParams(token.text);
    assertEquals([...tokenForm.keys()].sort(), ["client_id", "client_secret", "code", "grant_type"]);
    assertEquals(tokenForm.get("client_id"), APPLE_CLIENT_ID);
    assertEquals(tokenForm.get("code"), CODE);
    assertEquals(tokenForm.get("grant_type"), "authorization_code");

    const [revoke] = world.appleRevokeCalls;
    assertEquals(revoke.method, "POST");
    assertEquals(revoke.url.pathname, "/auth/revoke");
    assertEquals(revoke.headers.get("content-type"), "application/x-www-form-urlencoded");
    const revokeForm = new URLSearchParams(revoke.text);
    assertEquals([...revokeForm.keys()].sort(), ["client_id", "client_secret", "token", "token_type_hint"]);
    assertEquals(revokeForm.get("client_id"), APPLE_CLIENT_ID);
    assertEquals(revokeForm.get("token"), `rt.${CODE}`);
    assertEquals(revokeForm.get("token_type_hint"), "refresh_token");
  }),
);

Deno.test(
  "revoke: a code Apple refuses never reaches /auth/revoke, whose 200 would prove nothing",
  flow(async (world) => {
    const config = await readyConfig(world);
    // Unknown, then used once and sent again.
    assertEquals(await revokeAppleSignIn(config, "unknown"), "token:invalid_grant");
    world.appleCodes.add(CODE);
    assertEquals(await revokeAppleSignIn(config, CODE), "revoked");
    assertEquals(await revokeAppleSignIn(config, CODE), "token:invalid_grant");
    assertEquals(world.appleRevokeCalls.length, 1, "only the code that was exchanged went on");
  }),
);

Deno.test(
  "revoke: a client secret signed with the wrong key, Team ID or key id is invalid_client at the exchange",
  flow(async (world) => {
    const config = await readyConfig(world);
    world.appleCodes.add(CODE);
    const { privateKey } = await generateKeyPair("ES256");
    const cases: Extract<AppleConfig, { kind: "ready" }>[] = [
      { ...config, privateKey },
      { ...config, teamId: "OTHERTEAM1" },
      { ...config, keyId: "OTHERKEY01" },
    ];
    for (const wrong of cases) {
      assertEquals(await revokeAppleSignIn(wrong, CODE), "token:invalid_client");
    }
    assert(world.appleCodes.has(CODE), "the code is still unused");
    assertEquals(world.appleRevokeCalls.length, 0);
  }),
);

Deno.test(
  "revoke: every failure of the exchange has its word, and a 400 that is not one of Apple's words gives only the status",
  flow(async (world) => {
    const config = await readyConfig(world);
    const words = [
      "invalid_grant",
      "invalid_client",
      "invalid_request",
      "unauthorized_client",
      "unsupported_grant_type",
      "invalid_scope",
    ];
    for (const error of words) {
      world.appleTokenQueue.push({ kind: "json", status: 400, body: { error, error_description: "SECRET" } });
      assertEquals(await revokeAppleSignIn(config, CODE), `token:${error}`);
    }
    const cases: [Parameters<typeof world.appleTokenQueue.push>[0], string][] = [
      [{ kind: "json", status: 400, body: { error: "the code abc123 was SECRET" } }, "token:http_400"],
      [{ kind: "json", status: 400, body: { error: 7 } }, "token:http_400"],
      [{ kind: "json", status: 400, body: ["invalid_grant"] }, "token:http_400"],
      [{ kind: "json", status: 401, body: { error: "invalid_client" } }, "token:http_401"],
      [{ kind: "json", status: 500, body: {} }, "token:http_500"],
      [{ kind: "json", status: 200, body: { access_token: "at" } }, "token:no_refresh_token"],
      [{ kind: "json", status: 200, body: { refresh_token: "" } }, "token:no_refresh_token"],
      [{ kind: "json", status: 200, body: { refresh_token: 7 } }, "token:no_refresh_token"],
      [{ kind: "json", status: 200, body: "not an object" }, "token:no_refresh_token"],
      [{ kind: "json", status: 201, body: { refresh_token: "rt" } }, "token:http_201"],
      [{ kind: "network" }, "token:network"],
    ];
    for (const [reply, word] of cases) {
      world.appleTokenQueue.push(reply);
      assertEquals(await revokeAppleSignIn(config, CODE), word);
    }
    world.appleTokenQueue.push({ kind: "hang" });
    assertEquals(await revokeAppleSignIn(config, CODE, { timeoutMs: 30 }), "token:timeout");
    assertEquals(world.appleRevokeCalls.length, 0, "no failure of the exchange reaches /auth/revoke");
  }),
);

Deno.test(
  "revoke: an answer from the exchange that is not JSON is its status, and never throws",
  async () => {
    const config = { kind: "ready", teamId: "ABCDE12345", keyId: "FGHIJ67890" } as const;
    const { privateKey } = await generateKeyPair("ES256");
    const html = () => Promise.resolve(new Response("<html>", { status: 400 }));
    assertEquals(
      await revokeAppleSignIn({ ...config, privateKey }, CODE, { fetch: html }),
      "token:http_400",
    );
    const text = () => Promise.resolve(new Response("<html>", { status: 200 }));
    assertEquals(
      await revokeAppleSignIn({ ...config, privateKey }, CODE, { fetch: text }),
      "token:no_refresh_token",
    );
  },
);

Deno.test(
  "revoke: every failure of the revoke has its word, after one attempt",
  flow(async (world) => {
    const config = await readyConfig(world);
    const cases: [Parameters<typeof world.appleRevokeQueue.push>[0], string][] = [
      [{ kind: "json", status: 400, body: { error: "invalid_request" } }, "revoke:http_400"],
      [{ kind: "json", status: 503, body: {} }, "revoke:http_503"],
      [{ kind: "network" }, "revoke:network"],
    ];
    for (const [reply, word] of cases) {
      world.appleCodes.add(CODE);
      world.appleRevokeQueue.push(reply);
      assertEquals(await revokeAppleSignIn(config, CODE), word);
    }
    world.appleCodes.add(CODE);
    world.appleRevokeQueue.push({ kind: "hang" });
    assertEquals(await revokeAppleSignIn(config, CODE, { timeoutMs: 30 }), "revoke:timeout");
    assertEquals(world.appleTokenCalls.length, 4, "one exchange each");
    assertEquals(world.appleRevokeCalls.length, 4, "one revoke each");
  }),
);

Deno.test("revoke: it never throws, whatever fetch does or the key refuses", async () => {
  const { privateKey } = await generateKeyPair("ES256");
  const config = { kind: "ready", teamId: "ABCDE12345", keyId: "FGHIJ67890", privateKey } as const;
  const throwing = () => {
    throw new Error("SECRET");
  };
  assertEquals(await revokeAppleSignIn(config, CODE, { fetch: throwing }), "token:network");
  // A key that cannot sign (an RSA public key here) still answers a word.
  const { publicKey } = await generateKeyPair("RS256");
  assertEquals(await revokeAppleSignIn({ ...config, privateKey: publicKey }, CODE), "token:client_secret");
});
