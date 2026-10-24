import { jwtVerify } from "jose";

import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import {
  authTiming,
  clearTokenCache,
  forgetAccessToken,
  getAccessToken,
  GoogleAuthError,
  parseServiceAccount,
  type ServiceAccount,
} from "./googleAuth.ts";
import { googleError, installGoogle, makeServiceAccount, tokenOk } from "./testing.ts";

const { account, encoded, publicKey } = await makeServiceAccount();

async function withGoogle(work: (world: ReturnType<typeof installGoogle>) => Promise<void>) {
  const world = installGoogle();
  const saved = { ...authTiming };
  clearTokenCache();
  try {
    await work(world);
  } finally {
    Object.assign(authTiming, saved);
    clearTokenCache();
    world.restore();
  }
}

async function failure(work: () => Promise<unknown>): Promise<GoogleAuthError> {
  try {
    await work();
  } catch (error) {
    assert(error instanceof GoogleAuthError, `expected GoogleAuthError, got ${String(error)}`);
    return error;
  }
  throw new Error("expected a GoogleAuthError, but nothing was thrown");
}

Deno.test("parseServiceAccount reads a key file written as base64, and nothing else", () => {
  assertEquals(parseServiceAccount(encoded), account);
  assertEquals(parseServiceAccount(`  ${encoded}\n`), account, "a pasted line break or space does not matter");
  const encode = (value: unknown) => btoa(JSON.stringify(value));
  const good = { type: "service_account", client_email: account.clientEmail, private_key: account.privateKey };
  assertEquals(parseServiceAccount(encode(good)), account);
  for (
    const bad of [
      "",
      "not base64 at all !!!",
      encode("a string"),
      encode([1, 2]),
      encode({ ...good, type: "authorized_user" }),
      encode({ ...good, client_email: "no-at-sign" }),
      encode({ ...good, client_email: 42 }),
      encode({ ...good, private_key: "not a pem" }),
      encode({ type: "service_account", client_email: account.clientEmail }),
      btoa("{ broken json"),
    ]
  ) assertEquals(parseServiceAccount(bad), null, bad.slice(0, 30));
});

Deno.test("signing in sends a form with a valid RS256 assertion for the right account, scope and audience", async () => {
  await withGoogle(async (world) => {
    world.tokenReplies.push(tokenOk("ya29.first"));
    const token = await getAccessToken(account, 1_800_000_000_000);
    assertEquals(token, "ya29.first");
    const [call] = world.tokenCalls;
    assertEquals([call.method, call.url.href], ["POST", "https://oauth2.googleapis.com/token"]);
    assert((call.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded"));
    const form = new URLSearchParams(call.text);
    assertEquals(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = form.get("assertion") ?? "";
    const { payload, protectedHeader } = await jwtVerify(assertion, publicKey, {
      issuer: account.clientEmail,
      audience: "https://oauth2.googleapis.com/token",
      currentDate: new Date(1_800_000_000_000),
    });
    assertEquals(protectedHeader.alg, "RS256");
    assertEquals(payload.scope, "https://www.googleapis.com/auth/cloud-platform");
    assertEquals(payload.iat, 1_800_000_000);
    assertEquals((payload.exp ?? 0) - (payload.iat ?? 0), 3600);
    assert(!call.text.includes("PRIVATE KEY"), "the key itself is never sent");
  });
});

Deno.test("a token is kept until five minutes before it expires, then renewed", async () => {
  await withGoogle(async (world) => {
    const now = 1_800_000_000_000;
    world.tokenReplies.push(tokenOk("ya29.one", 3600), tokenOk("ya29.two", 3600));
    assertEquals(await getAccessToken(account, now), "ya29.one");
    assertEquals(await getAccessToken(account, now + 54 * 60_000), "ya29.one", "55 minutes in: still good");
    assertEquals(world.tokenCalls.length, 1);
    assertEquals(await getAccessToken(account, now + 55 * 60_000 + 1), "ya29.two", "under five minutes left: renewed");
    assertEquals(world.tokenCalls.length, 2);
  });
});

Deno.test("forgetAccessToken makes the next call sign in again, and two callers at once share one sign-in", async () => {
  await withGoogle(async (world) => {
    const first = await getAccessToken(account);
    forgetAccessToken(account);
    const [again, together] = await Promise.all([getAccessToken(account), getAccessToken(account)]);
    assert(again !== first, "a new token after forgetting");
    assertEquals(again, together);
    assertEquals(world.tokenCalls.length, 2, "one sign-in for the first token and one shared by the two callers");
  });
});

Deno.test("each account has its own token", async () => {
  await withGoogle(async (world) => {
    const other: ServiceAccount = { ...account, clientEmail: "other@test-project.iam.gserviceaccount.com" };
    const a = await getAccessToken(account);
    const b = await getAccessToken(other);
    assert(a !== b);
    assertEquals(world.tokenCalls.length, 2);
    const assertion = new URLSearchParams(world.tokenCalls[1].text).get("assertion") ?? "";
    const { payload } = await jwtVerify(assertion, publicKey, { audience: "https://oauth2.googleapis.com/token" });
    assertEquals(payload.iss, other.clientEmail);
  });
});

Deno.test("a refused sign-in is invalid, keeps only Google's error word, and is not cached", async () => {
  await withGoogle(async (world) => {
    world.tokenReplies.push(
      googleError(400, { error: "invalid_grant", error_description: "Invalid JWT Signature. secret words" }),
      googleError(401, { error: "Some Sentence With Spaces", error_description: "x" }),
      googleError(403, "not json"),
    );
    const grant = await failure(() => getAccessToken(account));
    assertEquals([grant.kind, grant.reason], ["invalid", "tts_auth:invalid_grant"]);
    assert(!grant.message.includes("secret words") && !grant.reason.includes("secret words"));
    const sentence = await failure(() => getAccessToken(account));
    assertEquals([sentence.kind, sentence.reason], ["invalid", "tts_auth:http_401"]);
    const plain = await failure(() => getAccessToken(account));
    assertEquals([plain.kind, plain.reason], ["invalid", "tts_auth:http_403"]);
    // None of those was kept: the next call asks again.
    assertEquals(await getAccessToken(account), "ya29.test-4");
    assertEquals(world.tokenCalls.length, 4);
  });
});

Deno.test("a busy or unreachable Google is transient", async () => {
  await withGoogle(async (world) => {
    world.tokenReplies.push(googleError(503, { error: "backend_error" }), googleError(429), { kind: "network" });
    for (const reason of ["tts_auth:backend_error", "tts_auth:http_429", "tts_auth:network"]) {
      const error = await failure(() => getAccessToken(account));
      assertEquals([error.kind, error.reason], ["transient", reason]);
    }
  });
});

Deno.test("a sign-in that never answers ends by its own timeout", async () => {
  await withGoogle(async (world) => {
    authTiming.requestTimeoutMs = 30;
    world.tokenReplies.push({ kind: "hang" });
    const started = Date.now();
    const error = await failure(() => getAccessToken(account));
    assertEquals([error.kind, error.reason], ["transient", "tts_auth:timeout"]);
    assert(Date.now() - started < 3_000);
  });
});

Deno.test("an answer without a token is transient, and a key that is not a key never reaches the network", async () => {
  await withGoogle(async (world) => {
    world.tokenReplies.push({ kind: "json", status: 200, body: { token_type: "Bearer" } });
    const shape = await failure(() => getAccessToken(account));
    assertEquals([shape.kind, shape.reason], ["transient", "tts_auth:shape"]);

    const before = world.tokenCalls.length;
    // A PEM header with no key behind it, built from parts so that no PEM marker sits in the repository's text.
    const damagedKey = `${"-".repeat(5)}BEGIN PRIVATE KEY${"-".repeat(5)}\nnope`;
    const broken = await failure(() => getAccessToken({ clientEmail: "x@y.z", privateKey: damagedKey }));
    assertEquals([broken.kind, broken.reason], ["invalid", "tts_auth:bad_key"]);
    assertEquals(world.tokenCalls.length, before, "nothing was sent for a key that cannot sign");
    assert(!broken.message.includes("BEGIN PRIVATE KEY"));
  });
});
