import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { installWorld, type World } from "../../process-entry/testing/fakes.ts";
import { CLERK_API, deleteClerkUser, getClerkUser, readClerkSecret } from "./clerk.ts";

// Clerk's Backend API for account deletion (step 31): the secret key's shape, and what one read or one delete of a user answers
// in every case. One attempt each, never a retry, and nothing thrown.

const USER = "user_test";
const KEY = "sk_test_clerk_backend_key";

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

Deno.test("secret: an sk_test_ or sk_live_ key is used; anything else is bad_config, never the value", () => {
  const read = (value: string | undefined) =>
    readClerkSecret((name) => (name === "CLERK_SECRET_KEY" ? value : undefined));
  assertEquals(read("sk_test_abc"), { ok: true, secretKey: "sk_test_abc" });
  assertEquals(read("  sk_live_abc  "), { ok: true, secretKey: "sk_live_abc" });
  for (const bad of [undefined, "", "   ", "pk_test_abc", "sk_abc", "sk_test_", "sk_test_a b"]) {
    assertEquals(read(bad), { ok: false, reason: "bad_config:CLERK_SECRET_KEY" }, String(bad));
  }
});

Deno.test(
  "read: a user of this instance is found, one that is not is notFound, and the request carries the key and the id",
  flow(async (world) => {
    world.clerkUsers.add(USER);
    assertEquals(await getClerkUser(KEY, USER), { ok: true, notFound: false });
    assertEquals(await getClerkUser(KEY, "user_nobody"), { ok: true, notFound: true });
    const [first] = world.clerkCalls;
    assertEquals(first.method, "GET");
    assertEquals(`${first.url.origin}${first.url.pathname}`, `${CLERK_API}/users/${USER}`);
    assertEquals(first.headers.get("authorization"), `Bearer ${KEY}`);
    // An id is always one path segment.
    await getClerkUser(KEY, "user/../x");
    assertEquals(world.clerkCalls[2].url.pathname, "/v1/users/user%2F..%2Fx");
  }),
);

Deno.test(
  "read: another instance's key finds nobody (404), which the caller must not take for 'already deleted'",
  flow(async (world) => {
    world.clerkUsers.add(USER);
    assertEquals(await getClerkUser("sk_test_another_instance", USER), { ok: true, notFound: true });
  }),
);

Deno.test(
  "read: a refused key, a busy Clerk, a timeout and a dropped connection are failures with a word, after one attempt",
  flow(async (world) => {
    world.clerkUsers.add(USER);
    assertEquals(await getClerkUser("not-a-key", USER), { ok: false, reason: "http_401" });
    world.clerkQueue.push({ kind: "json", status: 503, body: { errors: [{ message: "SECRET-CLERK-WORDS" }] } });
    assertEquals(await getClerkUser(KEY, USER), { ok: false, reason: "http_5xx" });
    world.clerkQueue.push({ kind: "json", status: 429, body: {} });
    assertEquals(await getClerkUser(KEY, USER), { ok: false, reason: "http_429" });
    world.clerkQueue.push({ kind: "json", status: 422, body: {} });
    assertEquals(await getClerkUser(KEY, USER), { ok: false, reason: "http_422" });
    world.clerkQueue.push({ kind: "hang" });
    assertEquals(await getClerkUser(KEY, USER, { timeoutMs: 30 }), { ok: false, reason: "timeout" });
    world.clerkQueue.push({ kind: "network" });
    assertEquals(await getClerkUser(KEY, USER), { ok: false, reason: "network" });
    assertEquals(world.clerkCalls.length, 6, "one attempt each");
  }),
);

Deno.test(
  "delete: the user goes; a user that is already gone is notFound; a failure says why and changes nothing",
  flow(async (world) => {
    world.clerkUsers.add(USER);
    world.clerkUsers.add("user_other");
    world.clerkQueue.push({ kind: "json", status: 500, body: {} });
    assertEquals(await deleteClerkUser(KEY, USER), { ok: false, reason: "http_5xx" });
    assert(world.clerkUsers.has(USER));
    assertEquals(await deleteClerkUser(KEY, USER), { ok: true, notFound: false });
    assertEquals(world.clerkCalls.at(-1)?.method, "DELETE");
    assert(!world.clerkUsers.has(USER));
    assert(world.clerkUsers.has("user_other"), "nobody else");
    assertEquals(await deleteClerkUser(KEY, USER), { ok: true, notFound: true });
  }),
);
