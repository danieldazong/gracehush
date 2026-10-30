import type { SyncSubscriptionError, SyncSubscriptionResponse } from "../process-entry/contracts.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { installWorld, post, rcCustomer, unscopedRequests, type World } from "../process-entry/testing/fakes.ts";
import { handle, SYNC_THROTTLE_MS } from "./handler.ts";

// sync-subscription (step 30): the app asks the server to re-read its own RevenueCat customer after a purchase or a restore.
// Who it syncs (only the caller from the verified token, never an id in the body), when it does not call RevenueCat at all
// (the throttle), and what each failure answers.

const USER = "user_test";
const HOUR = 3600_000;
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

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

const ask = (world: World, options: Parameters<typeof post>[3] = {}) => post(world, handle, {}, options);
const answer = async (response: Response) => (await response.json()) as SyncSubscriptionResponse;
const failure = async (response: Response) => (await response.json()) as SyncSubscriptionError;
const lastLog = (world: World) => JSON.parse(world.logs.at(-1) ?? "{}");
const rowOf = (world: World, id = USER) => world.users.find((user) => user.id === id);

Deno.test(
  "a) the caller's plan is read from RevenueCat and written: 200 with the tier and the end date",
  flow(async (world) => {
    world.seedUser(USER);
    world.revenuecat.set(USER, rcCustomer({ expires: later(HOUR) }));
    const response = await ask(world);
    assertEquals(response.status, 200);
    const body = await answer(response);
    assertEquals(body.tier, "pro");
    assert(body.expiresAt !== null && Date.parse(body.expiresAt) > Date.now());
    assertEquals(rowOf(world)?.subscription_tier, "pro");
    assertEquals(world.revenuecatCalls.length, 1);
    assertEquals([lastLog(world).billing, lastLog(world).status], ["synced", 200]);
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "b) the user comes from the token only: an id in the body is never read",
  flow(async (world) => {
    world.seedUser(USER);
    world.seedUser("user_other");
    world.revenuecat.set(USER, rcCustomer(null));
    world.revenuecat.set("user_other", rcCustomer({ expires: null }));
    const response = await post(world, handle, { userId: "user_other", appUserId: "user_other" });
    assertEquals(response.status, 200);
    assertEquals((await answer(response)).tier, "free");
    assertEquals(world.revenuecatCalls.map((call) => call.url.pathname), [`/v1/subscribers/${USER}`]);
    assertEquals(rowOf(world, "user_other")?.subscription_tier, "free");
  }),
);

Deno.test(
  "c) no token or a bad one is 401; another method is 405; OPTIONS is 204",
  flow(async (world) => {
    world.seedUser(USER);
    assertEquals((await ask(world, { token: null })).status, 401);
    assertEquals((await ask(world, { token: "aaa.bbb.ccc" })).status, 401);
    assertEquals((await ask(world, { method: "GET" })).status, 405);
    assertEquals((await ask(world, { method: "OPTIONS", token: null })).status, 204);
    assertEquals(world.revenuecatCalls.length, 0);
  }),
);

Deno.test(
  "d) synced under 10 seconds ago: the stored plan, with no RevenueCat call",
  flow(async (world) => {
    world.seedUser(USER);
    const row = rowOf(world)!;
    row.subscription_tier = "trial";
    row.subscription_expires_at = later(HOUR);
    row.subscription_synced_at = new Date(Date.now() - SYNC_THROTTLE_MS + 2_000).toISOString();
    const response = await ask(world);
    assertEquals(response.status, 200);
    assertEquals(await answer(response), { tier: "trial", expiresAt: row.subscription_expires_at as string });
    assertEquals(world.revenuecatCalls.length, 0);
    assertEquals(lastLog(world).billing, "throttled");
    // Older than that, it reads RevenueCat again.
    row.subscription_synced_at = new Date(Date.now() - SYNC_THROTTLE_MS - 1).toISOString();
    world.revenuecat.set(USER, rcCustomer(null));
    assertEquals((await answer(await ask(world))).tier, "free");
    assertEquals(world.revenuecatCalls.length, 1);
  }),
);

Deno.test(
  "e) RevenueCat unreachable is 503 BILLING_UNAVAILABLE, and the plan is left as it was",
  flow(async (world) => {
    world.seedUser(USER);
    rowOf(world)!.subscription_tier = "pro";
    world.revenuecatQueue.push({ kind: "network" }, { kind: "network" });
    const response = await ask(world);
    assertEquals(response.status, 503);
    assertEquals((await failure(response)).error.code, "BILLING_UNAVAILABLE");
    assertEquals(lastLog(world).billing, "failed:network");
    assertEquals(rowOf(world)?.subscription_tier, "pro");
  }),
);

Deno.test(
  "f) a caller with no profile row is 404, and RevenueCat is not asked",
  flow(async (world) => {
    const response = await ask(world);
    assertEquals(response.status, 404);
    assertEquals((await failure(response)).error.code, "NOT_FOUND");
    assertEquals(world.revenuecatCalls.length, 0);
    assertEquals(world.users.length, 0);
  }),
);

Deno.test(
  "g) no billing key on the server is 500, logged by the secret's name",
  flow(async (world) => {
    world.seedUser(USER);
    Deno.env.delete("REVENUECAT_SECRET_API_KEY");
    const response = await ask(world);
    assertEquals(response.status, 500);
    assertEquals((await failure(response)).error.code, "INTERNAL");
    assertEquals(lastLog(world).billing, "bad_config:REVENUECAT_SECRET_API_KEY");
    assertEquals(world.revenuecatCalls.length, 0);
  }),
);

Deno.test(
  "h) the log line is the allow-list: no id, no token, no key, no date",
  flow(async (world) => {
    world.seedUser(USER);
    world.revenuecat.set(USER, rcCustomer({ expires: later(HOUR) }));
    await ask(world);
    const text = world.logs.at(-1) ?? "";
    for (const word of [USER, "sk_test", "Bearer", "subscription_expires_at"]) {
      assert(!text.includes(word), `the log holds "${word}"`);
    }
    assertEquals(Object.keys(JSON.parse(text)).length, 38);
  }),
);
