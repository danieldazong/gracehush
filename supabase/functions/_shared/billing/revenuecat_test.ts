import { createAdmin } from "../admin.ts";
import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { installWorld, rcCustomer, type World } from "../../process-entry/testing/fakes.ts";
import {
  deleteSubscriber,
  fetchSubscriber,
  planFromSubscriber,
  readBillingConfig,
  readSubscriber,
  REVENUECAT_API,
  type Subscriber,
  syncSubscription,
} from "./revenuecat.ts";

// The billing module (step 30): what the plan is for every shape of the pro entitlement, how one read of RevenueCat behaves
// (what is retried and what is not), and what the sync writes on the person's own row and nothing else.

const NOW = new Date("2026-10-29T12:00:00.000Z");
const HOUR = 3600_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const USER = "user_test";

function subscriber(
  pro: { expires: string | null; grace?: string | null; periodType?: string; product?: string } | null,
  others: Subscriber["entitlements"] = {},
): Subscriber {
  const product = pro?.product ?? "gracehush_pro_yearly";
  return {
    entitlements: {
      ...others,
      ...(pro === null ? {} : {
        pro: { expires_date: pro.expires, grace_period_expires_date: pro.grace ?? null, product_identifier: product },
      }),
    },
    subscriptions: pro === null ? {} : { [product]: { period_type: pro.periodType ?? "normal", is_sandbox: true } },
  };
}

Deno.test("plan: no pro entitlement is free, with no end date", () => {
  assertEquals(planFromSubscriber(subscriber(null), NOW), { tier: "free", expiresAt: null });
});

Deno.test("plan: a lifetime pro (no end date) is pro with no end date", () => {
  assertEquals(planFromSubscriber(subscriber({ expires: null }), NOW), { tier: "pro", expiresAt: null });
});

Deno.test("plan: an active pro is pro until its end date", () => {
  assertEquals(planFromSubscriber(subscriber({ expires: at(HOUR) }), NOW), { tier: "pro", expiresAt: at(HOUR) });
});

Deno.test("plan: an active pro in its trial period is trial; an intro or normal period is pro", () => {
  assertEquals(planFromSubscriber(subscriber({ expires: at(HOUR), periodType: "trial" }), NOW).tier, "trial");
  assertEquals(planFromSubscriber(subscriber({ expires: at(HOUR), periodType: "intro" }), NOW).tier, "pro");
  assertEquals(planFromSubscriber(subscriber({ expires: at(HOUR), periodType: "normal" }), NOW).tier, "pro");
});

Deno.test("plan: a lapsed pro inside its grace period is still pro, until the grace period ends", () => {
  const plan = planFromSubscriber(subscriber({ expires: at(-HOUR), grace: at(2 * HOUR) }), NOW);
  assertEquals(plan, { tier: "pro", expiresAt: at(2 * HOUR) });
});

Deno.test("plan: an expired pro is free, and keeps its last end date", () => {
  assertEquals(planFromSubscriber(subscriber({ expires: at(-HOUR) }), NOW), { tier: "free", expiresAt: at(-HOUR) });
  assertEquals(
    planFromSubscriber(subscriber({ expires: at(-2 * HOUR), grace: at(-HOUR) }), NOW),
    { tier: "free", expiresAt: at(-HOUR) },
  );
  // The very moment of the end date is already past it.
  assertEquals(planFromSubscriber(subscriber({ expires: at(0) }), NOW).tier, "free");
});

Deno.test("plan: an unparsable end date counts as absent, never as a lifetime grant", () => {
  assertEquals(planFromSubscriber(subscriber({ expires: "soon" }), NOW), { tier: "free", expiresAt: null });
  // An unparsable grace date does not extend anything either.
  assertEquals(planFromSubscriber(subscriber({ expires: at(-HOUR), grace: "later" }), NOW).tier, "free");
  // A valid grace date still counts when the end date is unreadable.
  assertEquals(planFromSubscriber(subscriber({ expires: "soon", grace: at(HOUR) }), NOW).tier, "pro");
});

Deno.test("plan: another entitlement is not pro, and a product id that names an inherited property is not a trial", () => {
  const other = { expires_date: at(HOUR), grace_period_expires_date: null, product_identifier: "x" };
  assertEquals(planFromSubscriber(subscriber(null, { premium: other }), NOW).tier, "free");
  const plan = planFromSubscriber(subscriber({ expires: at(HOUR), product: "constructor" }), NOW);
  assertEquals(plan.tier, "pro");
  const noSubscription: Subscriber = {
    entitlements: {
      pro: { expires_date: at(HOUR), grace_period_expires_date: null, product_identifier: "constructor" },
    },
    subscriptions: {},
  };
  assertEquals(planFromSubscriber(noSubscription, NOW).tier, "pro");
});

Deno.test("subscriber: the answer's shape is checked; optional fields get their defaults", () => {
  const body = {
    request_date: "x",
    subscriber: {
      entitlements: { pro: { expires_date: null, product_identifier: "p" } },
      subscriptions: { p: {} },
      management_url: null,
    },
  };
  assertEquals(readSubscriber(body), {
    entitlements: { pro: { expires_date: null, grace_period_expires_date: null, product_identifier: "p" } },
    subscriptions: { p: { period_type: "normal", is_sandbox: false } },
  });
  // The empty customer the real API answers for an id it has not seen (probed 2026-10-29: 201 with both maps empty).
  assertEquals(readSubscriber({ subscriber: { entitlements: {}, subscriptions: {} } }), {
    entitlements: {},
    subscriptions: {},
  });
  for (
    const bad of [
      null,
      [],
      {},
      { subscriber: null },
      { subscriber: { entitlements: [], subscriptions: {} } },
      { subscriber: { entitlements: {} } },
      { subscriber: { entitlements: { pro: {} }, subscriptions: {} } },
      { subscriber: { entitlements: { pro: { expires_date: 5 } }, subscriptions: {} } },
      {
        subscriber: { entitlements: { pro: { expires_date: null, grace_period_expires_date: 1 } }, subscriptions: {} },
      },
      { subscriber: { entitlements: {}, subscriptions: { p: { period_type: 3 } } } },
      { subscriber: { entitlements: {}, subscriptions: { p: { is_sandbox: "yes" } } } },
    ]
  ) {
    assertEquals(readSubscriber(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

Deno.test("config: only a secret key (sk_) is a billing key", () => {
  const env = (value: string | undefined) => (name: string) => name === "REVENUECAT_SECRET_API_KEY" ? value : undefined;
  assertEquals(readBillingConfig(env("sk_abc")), { ok: true, apiKey: "sk_abc" });
  assertEquals(readBillingConfig(env("  sk_abc  ")), { ok: true, apiKey: "sk_abc" });
  for (const value of [undefined, "", "test_abc", "appl_abc", "goog_abc", "abc"]) {
    assertEquals(readBillingConfig(env(value)), { ok: false, reason: "bad_config:REVENUECAT_SECRET_API_KEY" });
  }
});

// ---- one read ---------------------------------------------------------------------------------------------------------
type Reply = Response | "network" | "hang";

function scripted(replies: Reply[]) {
  const calls: { url: string; headers: Headers }[] = [];
  const send: typeof fetch = (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    const reply = replies.shift() ?? new Response("{}", { status: 500 });
    if (reply === "network") return Promise.reject(new TypeError("network down"));
    if (reply === "hang") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return Promise.resolve(reply);
  };
  return { send, calls };
}

const customer = (pro: Parameters<typeof rcCustomer>[0], status = 200) =>
  new Response(JSON.stringify({ request_date_ms: 1, subscriber: rcCustomer(pro) }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const status = (code: number) => new Response(JSON.stringify({ code: 7225, message: "x" }), { status: code });
const fast = { retryDelayMs: 1, timeoutMs: 50 };

Deno.test("fetch: one GET with the secret key, the id encoded, and the customer read from the answer", async () => {
  const { send, calls } = scripted([customer({ expires: null })]);
  const result = await fetchSubscriber("sk_key", "user/one two", { ...fast, fetch: send });
  assert(result.ok);
  assertEquals(result.subscriber.entitlements.pro.expires_date, null);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, `${REVENUECAT_API}/subscribers/user%2Fone%20two`);
  assertEquals(calls[0].headers.get("authorization"), "Bearer sk_key");
  assertEquals(calls[0].headers.get("accept"), "application/json");
});

Deno.test("fetch: a 201 (a customer RevenueCat had never seen) is an answer too", async () => {
  const { send } = scripted([customer(null, 201)]);
  const result = await fetchSubscriber("sk_key", USER, { ...fast, fetch: send });
  assert(result.ok);
  assertEquals(result.subscriber, { entitlements: {}, subscriptions: {} });
});

Deno.test("fetch: a 401 or a 404 is not retried", async () => {
  for (const code of [401, 404, 400]) {
    const { send, calls } = scripted([status(code), customer(null)]);
    assertEquals(await fetchSubscriber("sk_key", USER, { ...fast, fetch: send }), {
      ok: false,
      reason: `http_${code}`,
    });
    assertEquals(calls.length, 1, `HTTP ${code} was retried`);
  }
});

Deno.test("fetch: a 429 or a 5xx is retried once, and the second answer counts", async () => {
  for (const code of [429, 500, 503]) {
    const { send, calls } = scripted([status(code), customer({ expires: null })]);
    const result = await fetchSubscriber("sk_key", USER, { ...fast, fetch: send });
    assert(result.ok, `HTTP ${code} then 200 failed`);
    assertEquals(calls.length, 2);
  }
  const busy = scripted([status(429), status(429)]);
  assertEquals(await fetchSubscriber("sk_key", USER, { ...fast, fetch: busy.send }), { ok: false, reason: "http_429" });
  const down = scripted([status(500), status(502)]);
  assertEquals(await fetchSubscriber("sk_key", USER, { ...fast, fetch: down.send }), { ok: false, reason: "http_5xx" });
  assertEquals(down.calls.length, 2, "two attempts by default, never more");
});

Deno.test("fetch: a call that never answers is cut at its timeout and retried; so is a dropped connection", async () => {
  const hung = scripted(["hang", "hang"]);
  assertEquals(await fetchSubscriber("sk_key", USER, { ...fast, fetch: hung.send }), { ok: false, reason: "timeout" });
  assertEquals(hung.calls.length, 2);
  const dropped = scripted(["network", "network"]);
  assertEquals(await fetchSubscriber("sk_key", USER, { ...fast, fetch: dropped.send }), {
    ok: false,
    reason: "network",
  });
  const recovered = scripted(["network", customer(null)]);
  assert((await fetchSubscriber("sk_key", USER, { ...fast, fetch: recovered.send })).ok);
});

Deno.test("fetch: an answer that is not the shape is bad_body and is not retried; one attempt means one", async () => {
  for (const body of ["not json", JSON.stringify({ subscriber: { entitlements: [] } }), JSON.stringify({})]) {
    const { send, calls } = scripted([new Response(body, { status: 200 }), customer(null)]);
    assertEquals(await fetchSubscriber("sk_key", USER, { ...fast, fetch: send }), { ok: false, reason: "bad_body" });
    assertEquals(calls.length, 1);
  }
  const once = scripted([status(500), customer(null)]);
  assertEquals(await fetchSubscriber("sk_key", USER, { ...fast, attempts: 1, fetch: once.send }), {
    ok: false,
    reason: "http_5xx",
  });
  assertEquals(once.calls.length, 1);
});

// ---- the sync ---------------------------------------------------------------------------------------------------------
function withWorld(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      await work(world);
    } finally {
      world.restore();
    }
  };
}

const profileWrites = (world: World) =>
  world.requests.filter((request) => request.url.pathname === "/rest/v1/users_profile" && request.method !== "GET");

Deno.test(
  "sync: writes the plan, its end date and the time of the sync on this user's row only",
  withWorld(async (world) => {
    world.seedUser(USER);
    world.seedUser("user_other");
    world.revenuecat.set(USER, rcCustomer({ expires: at(HOUR), periodType: "trial" }));
    const result = await syncSubscription(createAdmin(), "sk_key", USER, NOW, fast);
    assertEquals(result, { ok: true, plan: { tier: "trial", expiresAt: at(HOUR) }, updated: true });
    const writes = profileWrites(world);
    assertEquals(writes.length, 1);
    assertEquals(writes[0].method, "PATCH");
    assertEquals(writes[0].url.searchParams.get("id"), `eq.${USER}`);
    assertEquals(Object.keys(writes[0].json as Record<string, unknown>).sort(), [
      "subscription_expires_at",
      "subscription_synced_at",
      "subscription_tier",
    ]);
    const row = world.users.find((user) => user.id === USER);
    assertEquals(
      [row?.subscription_tier, row?.subscription_expires_at, row?.subscription_synced_at],
      ["trial", at(HOUR), NOW.toISOString()],
    );
    const other = world.users.find((user) => user.id === "user_other");
    assertEquals([other?.subscription_tier, other?.subscription_synced_at], ["free", null]);
    assertEquals(world.revenuecatCalls.length, 1);
    assertEquals(world.revenuecatCalls[0].url.pathname, `/v1/subscribers/${USER}`);
  }),
);

Deno.test(
  "sync: a person with no row is left alone: nothing is created",
  withWorld(async (world) => {
    world.revenuecat.set(USER, rcCustomer({ expires: null }));
    const result = await syncSubscription(createAdmin(), "sk_key", USER, NOW, fast);
    assertEquals(result, { ok: true, plan: { tier: "pro", expiresAt: null }, updated: false });
    assertEquals(world.users.length, 0);
    assert(!world.requests.some((request) => request.method === "POST"), "the sync created a row");
  }),
);

Deno.test(
  "sync: a RevenueCat failure writes nothing; a database failure is db:update; neither throws",
  withWorld(async (world) => {
    world.seedUser(USER);
    world.revenuecatQueue.push({ kind: "json", status: 500, body: {} }, { kind: "json", status: 500, body: {} });
    assertEquals(await syncSubscription(createAdmin(), "sk_key", USER, NOW, fast), { ok: false, reason: "http_5xx" });
    assertEquals(profileWrites(world).length, 0);
    assertEquals(world.users[0].subscription_tier, "free");

    // A write the database refuses (an update of a column the table does not have makes the fake answer an error).
    world.revenuecat.set(USER, rcCustomer({ expires: null }));
    world.fail.profileUpdate = 1;
    assertEquals(await syncSubscription(createAdmin(), "sk_key", USER, NOW, fast), { ok: false, reason: "db:update" });

    // Something unexpected (a fetch that throws a non-error) is still an answer.
    const send = (() => {
      throw "not an error";
    }) as unknown as typeof fetch;
    const result = await syncSubscription(createAdmin(), "sk_key", USER, NOW, { ...fast, fetch: send, attempts: 1 });
    assertEquals(result.ok, false);
  }),
);

// ---- deleting the customer (step 31) -----------------------------------------------------------------------------------
Deno.test("delete: one DELETE with the secret key and the id encoded; 200 deletes, 404 was already gone", async () => {
  const gone = new Response(JSON.stringify({ app_user_id: USER, deleted: true }), { status: 200 });
  const { send, calls } = scripted([gone, status(404)]);
  assertEquals(await deleteSubscriber("sk_key", "user/one two", { timeoutMs: 50, fetch: send }), {
    ok: true,
    notFound: false,
  });
  assertEquals(calls[0].url, `${REVENUECAT_API}/subscribers/user%2Fone%20two`);
  assertEquals(calls[0].headers.get("authorization"), "Bearer sk_key");
  assertEquals(await deleteSubscriber("sk_key", USER, { timeoutMs: 50, fetch: send }), { ok: true, notFound: true });
});

Deno.test("delete: every failure is a word after one attempt, never a retry and never a throw", async () => {
  const cases: [Reply, string][] = [
    [status(401), "http_401"],
    [status(400), "http_400"],
    [status(429), "http_429"],
    [status(503), "http_5xx"],
    ["hang", "timeout"],
    ["network", "network"],
  ];
  for (const [reply, reason] of cases) {
    const { send, calls } = scripted([reply, new Response("{}", { status: 200 })]);
    assertEquals(await deleteSubscriber("sk_key", USER, { timeoutMs: 30, fetch: send }), { ok: false, reason });
    assertEquals(calls.length, 1, `${reason} was retried`);
  }
});

Deno.test(
  "delete: against the fake RevenueCat, the customer goes and nobody else's",
  withWorld(async (world) => {
    world.revenuecat.set(USER, rcCustomer({ expires: null }));
    world.revenuecat.set("user_other", rcCustomer(null));
    assertEquals(await deleteSubscriber("sk_key", USER), { ok: true, notFound: false });
    assertEquals([...world.revenuecat.keys()], ["user_other"]);
    assertEquals(world.revenuecatCalls.map((call) => call.method), ["DELETE"]);
  }),
);
