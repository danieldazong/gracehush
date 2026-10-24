import { CLAIM_LEASE_MS } from "../../process-entry/constants.ts";
import { assert, assertEquals, expectAppError } from "../../process-entry/testing/assert.ts";
import { installWorld, seedDevotional, unscopedRequests, type World } from "../../process-entry/testing/fakes.ts";
import { createAdmin } from "../admin.ts";
import { FREE_DEVOTIONALS_PER_WEEK } from "./constants.ts";
import { checkDevotionalLimit, type LimitProfile, type LimitSubject } from "./weekly.ts";

// checkDevotionalLimit (step 22) against the fake database: what counts toward a free account's three devotionals a week,
// in what order two entries made together are counted, who is exempt, and where the week begins. The week arithmetic itself
// is in weekly_test.ts. The clock is pinned (the last argument), so none of these depends on the day the tests run.

// A Friday. In UTC this week began on Monday 2026-10-19 00:00 and ends on Monday 2026-10-26 00:00.
const NOW = new Date("2026-10-23T12:00:00.000Z");
const USER = "user_a";
const FREE: LimitProfile = { tier: "free", timezone: "UTC" };
const SECOND = 1000;
const DAY = 24 * 3600 * SECOND;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

// The entry being checked: claimed a minute ago and still being made. Its id is fixed, so that two entries made in the
// same millisecond can be put on either side of it.
const CURRENT_ID = "88888888-8888-4888-8888-888888888888";
const CURRENT_AT = at(-60 * SECOND);

type Admin = ReturnType<typeof createAdmin>;

function limitWorld(work: (world: World, admin: Admin, current: LimitSubject) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      const entry = world.seedEntry({
        id: CURRENT_ID,
        user_id: USER,
        client_entry_id: "11111111-1111-4111-8111-111111111111",
        input_type: "text",
        processing_status: "processing",
        created_at: CURRENT_AT,
        updated_at: at(-30 * SECOND),
      });
      await work(world, createAdmin(), { id: String(entry.id), created_at: String(entry.created_at) });
      assertEquals(unscopedRequests(world, USER), [], "every query carries the user id");
    } finally {
      world.restore();
    }
  };
}

// An entry that is still being made: it has no devotional yet and its claim is fresh unless a test says otherwise.
const making = (over: Record<string, unknown>) => ({
  user_id: USER,
  client_entry_id: crypto.randomUUID(),
  input_type: "text",
  processing_status: "processing",
  updated_at: at(-10 * SECOND),
  ...over,
});

const SCENARIOS: { name: string; seed: (world: World) => void; used: number }[] = [
  { name: "nothing made this week", seed: () => {}, used: 0 },
  {
    name: "a devotional made this week counts",
    seed: (world) => void seedDevotional(world, USER, { created_at: at(-2 * DAY) }),
    used: 1,
  },
  {
    name: "the first instant of the week counts",
    seed: (world) => void seedDevotional(world, USER, { created_at: "2026-10-19T00:00:00.000Z" }),
    used: 1,
  },
  {
    name: "the last instant of last week does not",
    seed: (world) => void seedDevotional(world, USER, { created_at: "2026-10-18T23:59:59.999Z" }),
    used: 0,
  },
  {
    name: "a failed entry does not (an AI error, one the limit itself held back, a recording with no speech)",
    seed: (world) => {
      for (const error_code of ["AI_UNAVAILABLE", "LIMIT_REACHED", "NO_SPEECH"]) {
        seedDevotional(world, USER, {
          processing_status: "failed",
          error_code,
          devotional_script: null,
          created_at: at(-DAY),
        });
      }
    },
    used: 0,
  },
  {
    name: "a crisis entry does not",
    seed: (world) =>
      void world.seedEntry({
        user_id: USER,
        client_entry_id: crypto.randomUUID(),
        input_type: "text",
        processing_status: "ready",
        is_crisis: true,
        created_at: at(-DAY),
      }),
    used: 0,
  },
  {
    name: "another user's devotional does not",
    seed: (world) => void seedDevotional(world, "user_b", { created_at: at(-DAY) }),
    used: 0,
  },
  {
    name: "the entry being checked does not count itself, even if it holds a devotional",
    seed: (world) => {
      world.entries.find((entry) => entry.id === CURRENT_ID)!.devotional_script = "Words.";
    },
    used: 0,
  },
  {
    name: "an entry still being made that began BEFORE this one counts",
    seed: (world) => void world.seedEntry(making({ created_at: at(-120 * SECOND) })),
    used: 1,
  },
  {
    name: "an entry still being made that began AFTER this one does not",
    seed: (world) => void world.seedEntry(making({ created_at: at(-30 * SECOND) })),
    used: 0,
  },
  {
    name: "in the same millisecond the smaller id began first, and counts",
    seed: (world) =>
      void world.seedEntry(making({ id: "00000000-0000-4000-8000-000000000001", created_at: CURRENT_AT })),
    used: 1,
  },
  {
    name: "in the same millisecond the larger id began later, and does not",
    seed: (world) =>
      void world.seedEntry(making({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", created_at: CURRENT_AT })),
    used: 0,
  },
  {
    name: "an entry whose claim has lapsed (a request that died) does not",
    seed: (world) => void world.seedEntry(making({ created_at: at(-DAY), updated_at: at(-CLAIM_LEASE_MS - SECOND) })),
    used: 0,
  },
  {
    name: "an entry still being made that began before this week does not",
    seed: (world) => void world.seedEntry(making({ created_at: "2026-10-18T23:00:00.000Z" })),
    used: 0,
  },
  {
    name: "another user's entry being made does not",
    seed: (world) => void world.seedEntry(making({ user_id: "user_b", created_at: at(-120 * SECOND) })),
    used: 0,
  },
];

for (const scenario of SCENARIOS) {
  Deno.test(
    `checkDevotionalLimit counts: ${scenario.name}`,
    limitWorld(async (world, admin, current) => {
      scenario.seed(world);
      const decision = await checkDevotionalLimit(admin, USER, FREE, current, NOW);
      assert(decision.kind === "free");
      assertEquals([decision.used, decision.limit], [scenario.used, FREE_DEVOTIONALS_PER_WEEK]);
      assertEquals(decision.allowed, scenario.used < FREE_DEVOTIONALS_PER_WEEK);
    }),
  );
}

Deno.test(
  "checkDevotionalLimit: the third devotional is allowed, the fourth is not, and the real count is never clamped",
  limitWorld(async (world, admin, current) => {
    for (let made = 0; made <= 7; made += 1) {
      const decision = await checkDevotionalLimit(admin, USER, FREE, current, NOW);
      assert(decision.kind === "free");
      assertEquals([decision.used, decision.allowed], [made, made < FREE_DEVOTIONALS_PER_WEEK], `after ${made} made`);
      seedDevotional(world, USER, { created_at: at(-DAY) });
    }
  }),
);

Deno.test(
  "checkDevotionalLimit: a trial or Pro account is exempt, and no query is made at all",
  limitWorld(async (world, admin, current) => {
    for (let index = 0; index < 10; index += 1) seedDevotional(world, USER, { created_at: at(-DAY) });
    for (const tier of ["trial", "pro"] as const) {
      const decision = await checkDevotionalLimit(admin, USER, { tier, timezone: "UTC" }, current, NOW);
      assertEquals(decision, { kind: "exempt" });
    }
    assertEquals(world.requests.length, 0);
  }),
);

Deno.test(
  "checkDevotionalLimit: two queries in one round trip, and resetsAt is the start of next week",
  limitWorld(async (world, admin, current) => {
    const decision = await checkDevotionalLimit(admin, USER, FREE, current, NOW);
    assert(decision.kind === "free");
    assertEquals(decision.resetsAt, "2026-10-26T00:00:00.000Z");
    assertEquals(decision.zoneFallback, false);
    assertEquals(
      world.requests.map((request) => `${request.method} ${request.url.pathname}`),
      ["HEAD /rest/v1/journal_entries", "GET /rest/v1/journal_entries"],
    );
  }),
);

Deno.test(
  "checkDevotionalLimit: the profile's zone decides the week (Auckland has begun a new one while UTC has not)",
  limitWorld(async (world, admin, current) => {
    // Monday 00:30 in Auckland (UTC+13 in October), which is still Sunday 11:30 in UTC. Three devotionals were made on
    // Sunday evening at 23:00 Auckland time: last week there, this week in UTC.
    const now = new Date("2026-10-25T11:30:00.000Z");
    for (let index = 0; index < 3; index += 1) seedDevotional(world, USER, { created_at: "2026-10-25T10:00:00.000Z" });
    const auckland = await checkDevotionalLimit(
      admin,
      USER,
      { tier: "free", timezone: "Pacific/Auckland" },
      current,
      now,
    );
    assert(auckland.kind === "free");
    assertEquals([auckland.used, auckland.allowed, auckland.resetsAt], [0, true, "2026-11-01T11:00:00.000Z"]);
    const utc = await checkDevotionalLimit(admin, USER, FREE, current, now);
    assert(utc.kind === "free");
    assertEquals([utc.used, utc.allowed, utc.resetsAt], [3, false, "2026-10-26T00:00:00.000Z"]);
  }),
);

Deno.test(
  "checkDevotionalLimit: a zone Intl does not know is read as UTC and says so",
  limitWorld(async (_world, admin, current) => {
    const decision = await checkDevotionalLimit(admin, USER, { tier: "free", timezone: "Mars/Phobos" }, current, NOW);
    assert(decision.kind === "free");
    assertEquals([decision.zoneFallback, decision.resetsAt], [true, "2026-10-26T00:00:00.000Z"]);
  }),
);

Deno.test(
  "checkDevotionalLimit: a database that fails is a plain INTERNAL error that holds nothing of Postgres' message",
  limitWorld(async (_world, admin, current) => {
    const real = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") {
        const body = JSON.stringify({ code: "XX000", message: "a secret detail about the table" });
        return Promise.resolve(new Response(body, { status: 500, headers: { "Content-Type": "application/json" } }));
      }
      return real(input, init);
    };
    try {
      const error = await expectAppError(
        () => checkDevotionalLimit(admin, USER, FREE, current, NOW),
        "INTERNAL",
        "db:limit_in_flight:XX000",
      );
      assert(!error.reason.includes("secret"));
    } finally {
      globalThis.fetch = real;
    }
  }),
);
