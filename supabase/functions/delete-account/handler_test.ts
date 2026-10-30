import type { DeleteAccountError, DeleteAccountResponse } from "../process-entry/contracts.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  CLERK_API_HOST,
  installWorld,
  ISSUER,
  post,
  rcCustomer,
  REVENUECAT_HOST,
  seedDeletedDevotional,
  seedDevotional,
  unscopedRequests,
  unscopedStorage,
  type World,
} from "../process-entry/testing/fakes.ts";
import { handle } from "./handler.ts";

// delete-account (step 31) against the fake Supabase, RevenueCat and Clerk: what it checks before it deletes anything, the order
// it deletes in, what a failure at each step leaves (and that a retry finishes), the final pass, and that nobody else's files,
// rows, customer or user are touched.

const USER = "user_test";
const OTHER = "user_other";
const CONFIRM = { confirm: "DELETE" };

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

const ask = (world: World, body: unknown = CONFIRM, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, body, { sub: USER, ...options });

// Everything an account has: a profile, a reflection with its affirmations, a record of a deleted devotional, a recording, a
// devotional, an export, a RevenueCat customer and a Clerk user.
function seedAccount(world: World, userId: string) {
  world.seedUser(userId);
  world.clerkUsers.add(userId);
  world.revenuecat.set(userId, rcCustomer({ expires: null }));
  const entry = seedDevotional(world, userId);
  for (const slot of ["morning", "afternoon", "evening"]) {
    world.affirmations.push({
      id: crypto.randomUUID(),
      user_id: userId,
      entry_id: entry.id,
      time_slot: slot,
      headline: "h",
      affirmation_text: "t",
      is_delivered: false,
      is_favorite: false,
      scheduled_for: null,
      created_at: world.now(),
    });
  }
  seedDeletedDevotional(world, userId, world.now());
  world.storage.set(`${userId}/raw/${crypto.randomUUID()}.m4a`, new Uint8Array(3));
  world.storage.set(`${userId}/devotionals/${entry.id}.wav`, new Uint8Array(4));
  world.exports.set(`${userId}/${crypto.randomUUID()}.zip`, { bytes: new Uint8Array(5), createdAt: world.now() });
}

// What is left of one account, as counts.
function leftOf(world: World, userId: string) {
  const own = (path: string) => path.startsWith(`${userId}/`);
  return {
    profiles: world.users.filter((row) => row.id === userId).length,
    entries: world.entries.filter((row) => row.user_id === userId).length,
    affirmations: world.affirmations.filter((row) => row.user_id === userId).length,
    records: world.deletedDevotionals.filter((row) => row.user_id === userId).length,
    media: [...world.storage.keys()].filter(own).length,
    exports: [...world.exports.keys()].filter(own).length,
    customer: world.revenuecat.has(userId),
    clerkUser: world.clerkUsers.has(userId),
  };
}

const WHOLE = {
  profiles: 1,
  entries: 1,
  affirmations: 3,
  records: 1,
  media: 2,
  exports: 1,
  customer: true,
  clerkUser: true,
};
const GONE = {
  profiles: 0,
  entries: 0,
  affirmations: 0,
  records: 0,
  media: 0,
  exports: 0,
  customer: false,
  clerkUser: false,
};

// Every request the function sends, by kind and in order, across Supabase, RevenueCat and Clerk.
function recordOrder(world: World): string[] {
  const order: string[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    let kind = `${method} ${url.host}${url.pathname}`;
    if (url.origin === ISSUER) kind = "auth";
    else if (url.host === CLERK_API_HOST) kind = `clerk:${method}`;
    else if (url.host === REVENUECAT_HOST) kind = `revenuecat:${method}`;
    else if (url.pathname.startsWith("/storage/v1/object/list/")) kind = "storage:list";
    else if (url.pathname.startsWith("/storage/v1/object/") && method === "DELETE") kind = "storage:remove";
    else if (url.pathname === "/rest/v1/users_profile" && method === "DELETE") kind = "db:profile";
    else if (url.pathname.startsWith("/rest/v1/")) kind = `db:${method}`;
    order.push(kind);
    return inner(input, init);
  };
  void world;
  return order;
}

async function failure(response: Response, status: number, code: DeleteAccountError["error"]["code"]) {
  assertEquals(response.status, status, await response.clone().text());
  assertEquals(((await response.json()) as DeleteAccountError).error.code, code);
}

const lastAccount = (world: World) => JSON.parse(String(world.logs.at(-1))).account;

Deno.test(
  "requests: OPTIONS is 204, a GET is 405 and no token is 401, and nothing is asked or deleted",
  flow(async (world) => {
    seedAccount(world, USER);
    assertEquals((await ask(world, CONFIRM, { method: "OPTIONS" })).status, 204);
    assertEquals((await ask(world, CONFIRM, { method: "GET" })).status, 405);
    await failure(await ask(world, CONFIRM, { token: null }), 401, "UNAUTHORIZED");
    assertEquals(leftOf(world, USER), WHOLE);
    assertEquals(world.clerkCalls.length + world.revenuecatCalls.length + world.requests.length, 0);
  }),
);

Deno.test(
  'confirm: anything but exactly { confirm: "DELETE" } is a 400, and nothing is asked or deleted',
  flow(async (world) => {
    seedAccount(world, USER);
    for (
      const body of [{}, { confirm: "delete" }, { confirm: "DELETE", userId: OTHER }, ["DELETE"], "DELETE", null, 1]
    ) {
      await failure(await ask(world, body), 400, "INVALID_REQUEST");
    }
    await failure(await ask(world, null, { raw: "{not json" }), 400, "INVALID_REQUEST");
    await failure(
      await ask(world, null, { raw: JSON.stringify({ confirm: "DELETE", pad: "x".repeat(70_000) }) }),
      400,
      "INVALID_REQUEST",
    );
    assertEquals(leftOf(world, USER), WHOLE);
    assertEquals(world.clerkCalls.length + world.revenuecatCalls.length + world.lists.length, 0);
  }),
);

Deno.test(
  "secrets: a missing or malformed Clerk key, or no RevenueCat key, stops before anything is asked or deleted",
  flow(async (world) => {
    seedAccount(world, USER);
    const clerkKey = String(Deno.env.get("CLERK_SECRET_KEY"));
    const billingKey = String(Deno.env.get("REVENUECAT_SECRET_API_KEY"));
    const cases: [string, string | null, string][] = [
      ["CLERK_SECRET_KEY", null, "delete:failed:config:CLERK_SECRET_KEY"],
      ["CLERK_SECRET_KEY", "pk_test_not_a_secret", "delete:failed:config:CLERK_SECRET_KEY"],
      ["REVENUECAT_SECRET_API_KEY", null, "delete:failed:config:REVENUECAT_SECRET_API_KEY"],
    ];
    for (const [name, value, account] of cases) {
      Deno.env.set("CLERK_SECRET_KEY", clerkKey);
      Deno.env.set("REVENUECAT_SECRET_API_KEY", billingKey);
      if (value === null) Deno.env.delete(name);
      else Deno.env.set(name, value);
      await failure(await ask(world), 500, "INTERNAL");
      assertEquals(lastAccount(world), account);
    }
    assertEquals(leftOf(world, USER), WHOLE);
    assertEquals(world.clerkCalls.length + world.revenuecatCalls.length + world.lists.length, 0);
  }),
);

Deno.test(
  "another instance's key: Clerk does not know the caller, so nothing is deleted and the log names the key",
  flow(async (world) => {
    seedAccount(world, USER);
    Deno.env.set("CLERK_SECRET_KEY", "sk_test_another_instance");
    await failure(await ask(world), 500, "INTERNAL");
    assertEquals(lastAccount(world), "delete:failed:config:CLERK_SECRET_KEY");
    assertEquals(leftOf(world, USER), WHOLE);
    assertEquals(world.clerkCalls.map((call) => call.method), ["GET"]);
    assertEquals(world.lists.length + world.revenuecatCalls.length, 0);
  }),
);

Deno.test(
  "check: Clerk that cannot be reached at the start is DELETE_INCOMPLETE for the step clerk, with nothing deleted",
  flow(async (world) => {
    seedAccount(world, USER);
    world.clerkQueue.push({ kind: "json", status: 503, body: {} });
    await failure(await ask(world), 500, "DELETE_INCOMPLETE");
    assertEquals(lastAccount(world), "delete:failed:clerk:http_5xx");
    assertEquals(leftOf(world, USER), WHOLE);
  }),
);

Deno.test(
  "delete: the whole account goes, files, then rows, then RevenueCat, then Clerk, then a final pass; nobody else's",
  flow(async (world) => {
    seedAccount(world, USER);
    seedAccount(world, OTHER);
    const order = recordOrder(world);
    const response = await ask(world);
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals((await response.json()) as DeleteAccountResponse, { deleted: true });
    assertEquals(leftOf(world, USER), GONE);
    assertEquals(leftOf(world, OTHER), WHOLE);
    assertEquals(lastAccount(world), "delete:done");

    const first = (kind: string) => order.indexOf(kind);
    assert(first("clerk:GET") < first("storage:list"), "Clerk is asked before anything is deleted");
    assert(first("storage:remove") < first("db:profile"), "the files before the rows");
    assert(first("db:profile") < first("revenuecat:DELETE"), "the rows before RevenueCat");
    assert(first("revenuecat:DELETE") < first("clerk:DELETE"), "RevenueCat before Clerk");
    assert(order.lastIndexOf("storage:list") > first("clerk:DELETE"), "a final pass after Clerk");
    assert(order.lastIndexOf("db:profile") > first("clerk:DELETE"), "the final pass also looks at the rows");
    assertEquals(unscopedRequests(world, USER), []);
    assertEquals(unscopedStorage(world, USER), []);
    for (const call of [...world.clerkCalls, ...world.revenuecatCalls]) {
      assert(call.url.pathname.endsWith(`/${USER}`), call.url.pathname);
    }
  }),
);

Deno.test(
  "steps: each step that fails is DELETE_INCOMPLETE naming it; what was done stays done, and a retry finishes",
  async () => {
    const cases: {
      step: string;
      breakIt: (world: World) => void;
      left: Partial<typeof WHOLE>;
    }[] = [
      { step: "storage:storage_list_failed", breakIt: (world) => (world.fail.storageList = 1), left: WHOLE },
      {
        step: "database:db:delete_profile",
        breakIt: (world) => (world.fail.profileDelete = 1),
        left: { ...WHOLE, media: 0, exports: 0 },
      },
      {
        step: "revenuecat:http_5xx",
        breakIt: (world) => world.revenuecatQueue.push({ kind: "json", status: 503, body: {} }),
        left: { ...GONE, customer: true, clerkUser: true },
      },
      {
        step: "clerk:http_5xx",
        breakIt: (world) =>
          world.clerkQueue.push({ kind: "json", status: 200, body: {} }, { kind: "json", status: 502, body: {} }),
        left: { ...GONE, clerkUser: true },
      },
    ];
    for (const { step, breakIt, left } of cases) {
      const world = installWorld();
      try {
        seedAccount(world, USER);
        breakIt(world);
        await failure(await ask(world), 500, "DELETE_INCOMPLETE");
        assertEquals(lastAccount(world), `delete:failed:${step}`, step);
        assertEquals(leftOf(world, USER), { ...WHOLE, ...left }, step);
        const retry = await ask(world);
        assertEquals(retry.status, 200, `${step}: ${await retry.clone().text()}`);
        assertEquals(leftOf(world, USER), GONE, step);
      } finally {
        world.restore();
      }
    }
  },
);

Deno.test(
  "not found is done: a RevenueCat customer that never existed, and a Clerk user that went between the check and the delete",
  flow(async (world) => {
    seedAccount(world, USER);
    world.revenuecat.delete(USER);
    world.clerkQueue.push({ kind: "json", status: 200, body: {} }, {
      kind: "json",
      status: 404,
      body: { errors: [{ code: "resource_not_found" }] },
    });
    const response = await ask(world);
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(lastAccount(world), "delete:done");
  }),
);

Deno.test(
  "final pass: what was written during the run is removed, and a final pass that fails is logged, never a failure",
  async () => {
    // A request that was still running wrote a profile and a recording again while RevenueCat was being asked.
    {
      const world = installWorld();
      try {
        seedAccount(world, USER);
        const inner = globalThis.fetch;
        globalThis.fetch = (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.host === REVENUECAT_HOST) {
            world.seedUser(USER);
            world.storage.set(`${USER}/raw/late.m4a`, new Uint8Array(1));
          }
          return inner(input, init);
        };
        assertEquals((await ask(world)).status, 200);
        assertEquals(leftOf(world, USER), GONE);
        assertEquals(lastAccount(world), "delete:done:late_data");
      } finally {
        world.restore();
      }
    }
    // The final pass itself fails: the account is gone by then, so the answer is still 200.
    {
      const world = installWorld();
      try {
        seedAccount(world, USER);
        const inner = globalThis.fetch;
        globalThis.fetch = (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          const method = init?.method ?? (input instanceof Request ? input.method : "GET");
          if (url.host === CLERK_API_HOST && method === "DELETE") world.fail.storageList = 1;
          return inner(input, init);
        };
        assertEquals((await ask(world)).status, 200);
        assertEquals(lastAccount(world), "delete:done:final_pass_failed");
        assertEquals(leftOf(world, USER), GONE);
      } finally {
        world.restore();
      }
    }
  },
);

Deno.test(
  "cascade missed: rows left after the profile went are deleted table by table, and the log says so",
  flow(async (world) => {
    seedAccount(world, USER);
    seedAccount(world, OTHER);
    world.cascade = false;
    assertEquals((await ask(world)).status, 200);
    assertEquals(leftOf(world, USER), GONE);
    assertEquals(leftOf(world, OTHER), WHOLE);
    assertEquals(lastAccount(world), "delete:done:cascade_missed");
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "log: one line of 38 fields, the step as one word and the files as a count; no id, key, path or token",
  flow(async (world) => {
    seedAccount(world, USER);
    const token = await world.token({ sub: USER });
    assertEquals((await ask(world, CONFIRM, { token })).status, 200);
    assertEquals(world.logs.length, 1);
    const line = JSON.parse(world.logs[0]);
    assertEquals(Object.keys(line).length, 38);
    assertEquals([line.status, line.account, line.accountFiles], [200, "delete:done", 3]);
    assert(/^[0-9a-f]{8}$/.test(line.user));
    for (const word of [USER, token, "sk_test", "sk_key", "raw/", ".zip", ".wav", "devotionals"]) {
      assert(!world.logs[0].includes(word), `the log holds ${word}`);
    }
  }),
);
