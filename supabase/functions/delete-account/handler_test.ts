import type { DeleteAccountError, DeleteAccountResponse } from "../process-entry/contracts.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  APPLE_HOST,
  appleOn,
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

// delete-account (step 31) against the fake Supabase, RevenueCat, Clerk and Apple: what it checks before it deletes anything, the
// order it deletes in, what a failure at each step leaves (and that a retry finishes), the final pass, that nobody else's files,
// rows, customer or user are touched, and (step 35) that ending Apple's access never stops or fails a deletion.

const USER = "user_test";
const OTHER = "user_other";
const CONFIRM = { confirm: "DELETE" };
const APPLE_CODE = "c.apple-one-time-code";
const WITH_CODE = { confirm: "DELETE", appleAuthorizationCode: APPLE_CODE };

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
    else if (url.host === APPLE_HOST) kind = `apple:${url.pathname}`;
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
const lastApple = (world: World) => JSON.parse(String(world.logs.at(-1))).accountApple;

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
  'confirm: anything but { confirm: "DELETE" }, with or without a well-formed Apple code, is a 400, and nothing is asked or deleted',
  flow(async (world) => {
    seedAccount(world, USER);
    await appleOn(world);
    for (
      const body of [
        {},
        { confirm: "delete" },
        { confirm: "DELETE", userId: OTHER },
        ["DELETE"],
        "DELETE",
        null,
        1,
        { appleAuthorizationCode: APPLE_CODE },
        { confirm: "delete", appleAuthorizationCode: APPLE_CODE },
        { confirm: "DELETE", appleAuthorizationCode: APPLE_CODE, userId: OTHER },
        { confirm: "DELETE", appleAuthorizationCode: "" },
        { confirm: "DELETE", appleAuthorizationCode: null },
        { confirm: "DELETE", appleAuthorizationCode: 7 },
        { confirm: "DELETE", appleAuthorizationCode: [APPLE_CODE] },
        { confirm: "DELETE", appleAuthorizationCode: "x".repeat(4_097) },
      ]
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
    assertEquals(world.appleTokenCalls.length, 0);
  }),
);

Deno.test(
  "confirm: a code of exactly 4,096 characters is accepted",
  flow(async (world) => {
    seedAccount(world, USER);
    const response = await ask(world, { confirm: "DELETE", appleAuthorizationCode: "x".repeat(4_096) });
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(lastApple(world), "off");
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
  "log: one line of 42 fields, the step as one word and the files as a count; no id, key, path or token",
  flow(async (world) => {
    seedAccount(world, USER);
    const token = await world.token({ sub: USER });
    assertEquals((await ask(world, CONFIRM, { token })).status, 200);
    assertEquals(world.logs.length, 1);
    const line = JSON.parse(world.logs[0]);
    assertEquals(Object.keys(line).length, 42);
    assertEquals([line.status, line.account, line.accountFiles, line.accountApple], [200, "delete:done", 3, "no_code"]);
    assert(/^[0-9a-f]{8}$/.test(line.user));
    for (const word of [USER, token, "sk_test", "sk_key", "raw/", ".zip", ".wav", "devotionals"]) {
      assert(!world.logs[0].includes(word), `the log holds ${word}`);
    }
  }),
);

// ---- Sign in with Apple (step 35) ----------------------------------------------------------------------------------

Deno.test(
  "apple: with a code the access ends after RevenueCat and before Clerk, by the exchange and then the revoke",
  flow(async (world) => {
    seedAccount(world, USER);
    await appleOn(world);
    world.appleCodes.add(APPLE_CODE);
    const order = recordOrder(world);
    const response = await ask(world, WITH_CODE);
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals((await response.json()) as DeleteAccountResponse, { deleted: true });
    assertEquals(leftOf(world, USER), GONE);
    assertEquals(lastApple(world), "revoked");
    assertEquals(lastAccount(world), "delete:done");
    assertEquals(world.appleRevoked, [`rt.${APPLE_CODE}`]);

    const first = (kind: string) => order.indexOf(kind);
    assert(first("revenuecat:DELETE") < first("apple:/auth/token"), "RevenueCat before Apple");
    assert(first("apple:/auth/token") < first("apple:/auth/revoke"), "the exchange before the revoke");
    assert(first("apple:/auth/revoke") < first("clerk:DELETE"), "Apple before Clerk");
    assertEquals(
      order.filter((kind) => kind.startsWith("apple:")).length,
      2,
      "the final pass does not ask Apple again",
    );
  }),
);

Deno.test(
  "apple: no code, secrets off and secrets bad each delete everything, with their word, and ask Apple nothing",
  async () => {
    const cases: { body: unknown; set: (world: World) => Promise<unknown> | void; word: string }[] = [
      { body: CONFIRM, set: () => undefined, word: "no_code" },
      // A code with no secrets set: this project before section I, and a bad value named in the log.
      { body: WITH_CODE, set: () => undefined, word: "off" },
      {
        body: WITH_CODE,
        set: async (world) => {
          await appleOn(world);
          Deno.env.set("APPLE_TEAM_ID", "SHORT");
        },
        word: "bad_config:APPLE_TEAM_ID",
      },
      {
        body: WITH_CODE,
        set: async (world) => {
          await appleOn(world);
          Deno.env.set("APPLE_SIWA_KEY_ID", "SHORT");
        },
        word: "bad_config:APPLE_SIWA_KEY_ID",
      },
      {
        body: WITH_CODE,
        set: async (world) => {
          await appleOn(world);
          Deno.env.set("APPLE_SIWA_PRIVATE_KEY_B64", btoa("not a key"));
        },
        word: "bad_config:APPLE_SIWA_PRIVATE_KEY_B64",
      },
      // No code, with good secrets: an account that did not sign in with Apple. Nothing is asked of Apple.
      { body: CONFIRM, set: (world) => appleOn(world), word: "no_code" },
    ];
    for (const { body, set, word } of cases) {
      const world = installWorld();
      try {
        seedAccount(world, USER);
        await set(world);
        const response = await ask(world, body);
        assertEquals(response.status, 200, `${word}: ${await response.clone().text()}`);
        assertEquals(leftOf(world, USER), GONE, word);
        assertEquals(lastApple(world), word);
        assertEquals(lastAccount(world), "delete:done", word);
        assertEquals(world.appleTokenCalls.length + world.appleRevokeCalls.length, 0, word);
      } finally {
        world.restore();
      }
    }
  },
);

Deno.test(
  "apple: a failed exchange or revoke still ends 200 { deleted: true } with the whole account gone, and the word in the log",
  async () => {
    const cases: { breakIt: (world: World) => void; word: string; revokes: number }[] = [
      // A code Apple does not know: nothing was added to the world's codes.
      { breakIt: () => undefined, word: "token:invalid_grant", revokes: 0 },
      {
        breakIt: (world) => world.appleTokenQueue.push({ kind: "json", status: 500, body: {} }),
        word: "token:http_500",
        revokes: 0,
      },
      { breakIt: (world) => world.appleTokenQueue.push({ kind: "network" }), word: "token:network", revokes: 0 },
      {
        breakIt: (world) => {
          world.appleCodes.add(APPLE_CODE);
          world.appleRevokeQueue.push({ kind: "json", status: 503, body: {} });
        },
        word: "revoke:http_503",
        revokes: 1,
      },
      {
        breakIt: (world) => {
          world.appleCodes.add(APPLE_CODE);
          world.appleRevokeQueue.push({ kind: "network" });
        },
        word: "revoke:network",
        revokes: 1,
      },
    ];
    for (const { breakIt, word, revokes } of cases) {
      const world = installWorld();
      try {
        seedAccount(world, USER);
        await appleOn(world);
        breakIt(world);
        const response = await ask(world, WITH_CODE);
        assertEquals(response.status, 200, `${word}: ${await response.clone().text()}`);
        assertEquals((await response.json()) as DeleteAccountResponse, { deleted: true });
        assertEquals(leftOf(world, USER), GONE, word);
        assertEquals(lastApple(world), word);
        assertEquals(lastAccount(world), "delete:done", word);
        assertEquals(world.appleTokenCalls.length, 1, `${word}: one exchange, no retry`);
        assertEquals(world.appleRevokeCalls.length, revokes, word);
      } finally {
        world.restore();
      }
    }
  },
);

Deno.test(
  "apple: the secrets are not part of the check at the start: bad ones never stop a deletion, even with a code",
  flow(async (world) => {
    seedAccount(world, USER);
    await appleOn(world);
    Deno.env.set("APPLE_SIWA_PRIVATE_KEY_B64", "SECRET not base64");
    assertEquals((await ask(world, WITH_CODE)).status, 200);
    assertEquals(leftOf(world, USER), GONE);
    assert(!world.logs[0].includes("SECRET"), "the value is not in the log");
  }),
);

Deno.test(
  "apple: a deletion that stops before Apple asks nothing of Apple, and the retry brings its own code or none",
  flow(async (world) => {
    seedAccount(world, USER);
    await appleOn(world);
    world.appleCodes.add(APPLE_CODE);
    world.revenuecatQueue.push({ kind: "json", status: 503, body: {} });
    await failure(await ask(world, WITH_CODE), 500, "DELETE_INCOMPLETE");
    assertEquals(lastAccount(world), "delete:failed:revenuecat:http_5xx");
    assertEquals(lastApple(world), null);
    assertEquals(world.appleTokenCalls.length, 0);
    const retry = await ask(world, CONFIRM);
    assertEquals(retry.status, 200, await retry.clone().text());
    assertEquals(lastApple(world), "no_code");
    assertEquals(leftOf(world, USER), GONE);
  }),
);

Deno.test(
  "apple: Clerk failing after Apple answered is DELETE_INCOMPLETE as before; the retry's used code is only a word",
  flow(async (world) => {
    seedAccount(world, USER);
    await appleOn(world);
    world.appleCodes.add(APPLE_CODE);
    world.clerkQueue.push({ kind: "json", status: 200, body: {} }, { kind: "json", status: 502, body: {} });
    await failure(await ask(world, WITH_CODE), 500, "DELETE_INCOMPLETE");
    assertEquals(lastAccount(world), "delete:failed:clerk:http_5xx");
    assertEquals(lastApple(world), "revoked");
    const retry = await ask(world, WITH_CODE);
    assertEquals(retry.status, 200, await retry.clone().text());
    assertEquals(lastApple(world), "token:invalid_grant");
    assertEquals(leftOf(world, USER), GONE);
  }),
);

Deno.test(
  "apple: no log line of any case holds the code, a token or the secret; the answer holds none either",
  async () => {
    const cases: ((world: World) => void)[] = [
      (world) => world.appleCodes.add(APPLE_CODE),
      () => undefined,
      (world) => world.appleTokenQueue.push({ kind: "json", status: 400, body: { error: `bad ${APPLE_CODE}` } }),
      (world) => {
        world.appleCodes.add(APPLE_CODE);
        world.appleRevokeQueue.push({ kind: "json", status: 400, body: { error: "rt.leak" } });
      },
    ];
    for (const prepare of cases) {
      const world = installWorld();
      try {
        seedAccount(world, USER);
        const secret = await appleOn(world);
        prepare(world);
        const response = await ask(world, WITH_CODE);
        const answer = await response.text();
        assertEquals(response.status, 200, answer);
        assertEquals(world.logs.length, 1);
        const line = world.logs[0];
        assertEquals(Object.keys(JSON.parse(line)).length, 42);
        for (const word of [APPLE_CODE, `rt.${APPLE_CODE}`, "rt.leak", secret, "client_secret", "refresh"]) {
          assert(!line.includes(word), `the log holds ${word.slice(0, 12)}`);
          assert(!answer.includes(word), `the answer holds ${word.slice(0, 12)}`);
        }
      } finally {
        world.restore();
      }
    }
  },
);
