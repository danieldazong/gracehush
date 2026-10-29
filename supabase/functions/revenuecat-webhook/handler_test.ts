import { shortHash } from "../_shared/log.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { installWorld, rcCustomer, type World } from "../process-entry/testing/fakes.ts";
import { handle } from "./handler.ts";
import { signPayload } from "./signature.ts";

// revenuecat-webhook (step 30) against the fake Supabase and the fake RevenueCat: who may call it (the Authorization value and
// the HMAC signature, both required), what each event makes it do (re-read the customer and write the plan), what it never
// does (sync an anonymous or unknown id, or answer 200 when a sync failed), and what reaches the log.

const USER = "user_test";
const OTHER = "user_other";
// The values installWorld puts in the environment.
const AUTH = "test-webhook-auth";
const SECRET = "test-signing-secret";
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

type Options = {
  auth?: string | null;
  signature?: string | null;
  t?: number;
  secret?: string;
  raw?: string;
  method?: string;
};

async function send(body: unknown, options: Options = {}): Promise<Response> {
  const raw = options.raw ?? JSON.stringify(body);
  const t = options.t ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = options.auth === undefined ? AUTH : options.auth;
  if (auth !== null) headers.Authorization = auth;
  const signature = options.signature === undefined
    ? `t=${t},v1=${await signPayload(raw, options.secret ?? SECRET, t)}`
    : options.signature;
  if (signature !== null) headers["X-RevenueCat-Webhook-Signature"] = signature;
  const method = options.method ?? "POST";
  return await handle(
    new Request("https://project.supabase.test/functions/v1/revenuecat-webhook", {
      method,
      headers,
      body: method === "GET" ? undefined : raw,
    }),
  );
}

const event = (fields: Record<string, unknown>) => ({
  api_version: "1.0",
  event: {
    id: "evt_1",
    type: "INITIAL_PURCHASE",
    app_user_id: USER,
    original_app_user_id: USER,
    aliases: [USER],
    product_id: "gracehush_pro_yearly",
    price: 59.99,
    currency: "USD",
    store: "TEST_STORE",
    environment: "SANDBOX",
    transaction_id: "txn_secret_123",
    ...fields,
  },
});
const lastLog = (world: World) => JSON.parse(world.logs.at(-1) ?? "{}");
const tierOf = (world: World, id: string) => world.users.find((user) => user.id === id)?.subscription_tier;

Deno.test(
  "a) INITIAL_PURCHASE re-reads the customer once and writes the plan: 200, billing synced",
  flow(async (world) => {
    world.seedUser(USER);
    world.revenuecat.set(USER, rcCustomer({ expires: later(HOUR) }));
    const response = await send(event({}));
    assertEquals(response.status, 200);
    assertEquals(world.revenuecatCalls.length, 1);
    assertEquals(world.revenuecatCalls[0].url.pathname, `/v1/subscribers/${USER}`);
    assertEquals(tierOf(world, USER), "pro");
    const line = lastLog(world);
    assertEquals([line.status, line.billing, line.billingEvent], [200, "synced", "INITIAL_PURCHASE"]);
    assertEquals(line.user, await shortHash(USER));
  }),
);

Deno.test(
  "b) no Authorization, or a wrong one, is 401 before anything is read or synced",
  flow(async (world) => {
    world.seedUser(USER);
    for (const auth of [null, "", "wrong-value", `Bearer wrong-value`, `${AUTH}x`]) {
      const response = await send(event({}), { auth });
      assertEquals(response.status, 401, `Authorization ${String(auth)}`);
      assertEquals(lastLog(world).billing, "bad_auth");
    }
    assertEquals(world.revenuecatCalls.length, 0);
    // RevenueCat sends the value as it was typed in the dashboard; one typed with "Bearer " in front is accepted too.
    world.revenuecat.set(USER, rcCustomer(null));
    assertEquals((await send(event({}), { auth: `Bearer ${AUTH}` })).status, 200);
  }),
);

Deno.test(
  "c) a missing, wrong or stale signature is 401 and nothing is synced",
  flow(async (world) => {
    world.seedUser(USER);
    const now = Math.floor(Date.now() / 1000);
    for (
      const options of [
        { signature: null },
        { signature: "garbage" },
        { secret: "another-secret" },
        { t: now - 301 },
        { t: now + 301 },
      ] satisfies Options[]
    ) {
      const response = await send(event({}), options);
      assertEquals(response.status, 401, JSON.stringify(options));
      assertEquals(lastLog(world).billing, "bad_signature");
    }
    assertEquals(world.revenuecatCalls.length, 0);
  }),
);

Deno.test(
  "d) only POST; a body that is not JSON, or has no event, is 400; a body over 256 KB is 413",
  flow(async (world) => {
    world.seedUser(USER);
    assertEquals((await send(null, { method: "GET", signature: null })).status, 405);
    assertEquals((await send(null, { raw: "not json" })).status, 400);
    assertEquals((await send(null, { raw: JSON.stringify({ api_version: "1.0" }) })).status, 400);
    assertEquals((await send(null, { raw: JSON.stringify({ event: "INITIAL_PURCHASE" }) })).status, 400);
    const huge = JSON.stringify({ api_version: "1.0", event: { type: "TEST", padding: "x".repeat(300 * 1024) } });
    assertEquals((await send(null, { raw: huge })).status, 413);
    assertEquals(world.revenuecatCalls.length, 0);
  }),
);

Deno.test(
  "e) the dashboard's TEST event is answered 200 with no RevenueCat call",
  flow(async (world) => {
    world.seedUser(USER);
    const response = await send(event({ type: "TEST" }));
    assertEquals(response.status, 200);
    assertEquals(world.revenuecatCalls.length, 0);
    const line = lastLog(world);
    assertEquals([line.billing, line.billingEvent], ["skipped", "TEST"]);
  }),
);

Deno.test(
  "f) a TRANSFER syncs every id it names, once each, both lists",
  flow(async (world) => {
    world.seedUser(USER);
    world.seedUser(OTHER);
    world.seedUser("user_third");
    world.revenuecat.set(USER, rcCustomer(null));
    world.revenuecat.set(OTHER, rcCustomer({ expires: null }));
    world.revenuecat.set("user_third", rcCustomer({ expires: later(HOUR) }));
    const response = await send(
      event({
        type: "TRANSFER",
        app_user_id: OTHER,
        transferred_from: [USER],
        transferred_to: [OTHER, "user_third", USER],
      }),
    );
    assertEquals(response.status, 200);
    assertEquals(
      world.revenuecatCalls.map((call) => decodeURIComponent(call.url.pathname.split("/").pop() ?? "")).sort(),
      [OTHER, USER, "user_third"].sort(),
    );
    assertEquals([tierOf(world, USER), tierOf(world, OTHER), tierOf(world, "user_third")], ["free", "pro", "pro"]);
    assertEquals(lastLog(world).user, await shortHash(USER));
  }),
);

Deno.test(
  "g) an anonymous id and an id with no profile are skipped: never sent to RevenueCat",
  flow(async (world) => {
    // Even if a profile had an anonymous id (Clerk ids never look like one), it is dropped before any lookup.
    world.seedUser("$RCAnonymousID:abc123");
    const anonymous = await send(event({ app_user_id: "$RCAnonymousID:abc123" }));
    assertEquals(anonymous.status, 200);
    assertEquals(lastLog(world).billing, "skipped");
    world.users.length = 0;
    const unknown = await send(event({ app_user_id: "user_nobody" }));
    assertEquals(unknown.status, 200);
    assertEquals(lastLog(world).billing, "unknown_user");
    assertEquals(world.revenuecatCalls.length, 0);
    assertEquals(world.users.length, 0, "a row was created for an unknown id");
  }),
);

Deno.test(
  "h) an event type this code does not know is still synced, and logged as other",
  flow(async (world) => {
    world.seedUser(USER);
    world.revenuecat.set(USER, rcCustomer({ expires: later(HOUR) }));
    assertEquals((await send(event({ type: "SOMETHING_NEW" }))).status, 200);
    assertEquals(world.revenuecatCalls.length, 1);
    assertEquals(lastLog(world).billingEvent, "other");
  }),
);

Deno.test(
  "i) a RevenueCat failure answers 500, so RevenueCat sends the event again; the plan is left as it was",
  flow(async (world) => {
    world.seedUser(USER);
    world.users[0].subscription_tier = "pro";
    world.revenuecatQueue.push({ kind: "json", status: 503, body: {} }, { kind: "json", status: 503, body: {} });
    const response = await send(event({ type: "EXPIRATION" }));
    assertEquals(response.status, 500);
    assertEquals(lastLog(world).billing, "failed:http_5xx");
    assertEquals(tierOf(world, USER), "pro");
    // The same event again, with RevenueCat back: harmless to repeat, and now it lands.
    world.revenuecat.set(USER, rcCustomer(null));
    assertEquals((await send(event({ type: "EXPIRATION" }))).status, 200);
    assertEquals(tierOf(world, USER), "free");
  }),
);

Deno.test(
  "j) a missing secret is 500 with the secret's NAME in the log, and nothing is read",
  flow(async (world) => {
    world.seedUser(USER);
    for (const name of ["REVENUECAT_WEBHOOK_AUTH", "REVENUECAT_WEBHOOK_SIGNING_SECRET", "REVENUECAT_SECRET_API_KEY"]) {
      const saved = Deno.env.get(name);
      Deno.env.delete(name);
      try {
        const response = await send(event({}));
        assertEquals(response.status, 500);
        assertEquals(lastLog(world).billing, `bad_config:${name}`);
      } finally {
        if (saved !== undefined) Deno.env.set(name, saved);
      }
    }
    assertEquals(world.revenuecatCalls.length, 0);
  }),
);

Deno.test(
  "k) the log line holds no body, id, price, product, transaction or secret",
  flow(async (world) => {
    world.seedUser(USER);
    world.revenuecat.set(USER, rcCustomer({ expires: later(HOUR) }));
    await send(event({}));
    await send(event({}), { auth: "wrong-value" });
    for (const text of world.logs) {
      for (const word of [USER, "59.99", "gracehush_pro_yearly", "txn_secret_123", AUTH, SECRET, "evt_1", "SANDBOX"]) {
        assert(!text.includes(word), `the log holds "${word}"`);
      }
    }
    const line = lastLog(world);
    assertEquals(Object.keys(line).length, 33);
  }),
);
