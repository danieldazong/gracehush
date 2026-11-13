import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { dayWindow } from "../limits/weekly.ts";
import { DEFAULT_FREE_DAILY_BUDGET, SCHOLAR_LIMITS } from "./constants.ts";
import { allowanceStatus, checkAllowance, checkListen, currentUsage, freeBudgetLeft, readFreeBudget } from "./usage.ts";

const day = dayWindow(new Date("2026-11-11T15:00:00Z"), "Africa/Lagos");
const resetsAt = "2026-11-11T23:00:00.000Z";

Deno.test("checkAllowance: a heavy conversation is exempt, whatever the plan and the count", () => {
  assertEquals(checkAllowance({ heavy: true, tier: "free", messagesToday: 99, window: day }), { kind: "exempt" });
  assertEquals(allowanceStatus({ kind: "exempt" }, day), "exempt");
});

Deno.test("checkAllowance: a free account has five messages a day; the answer counts this message", () => {
  const first = checkAllowance({ heavy: false, tier: "free", messagesToday: 0, window: day });
  assertEquals(first, {
    kind: "ok",
    usage: { kind: "free_day", used: 1, limit: SCHOLAR_LIMITS.freeMessagesPerDay, remaining: 4, resetsAt },
  });
  assertEquals(allowanceStatus(first, day), "free_ok");
  const last = checkAllowance({ heavy: false, tier: "free", messagesToday: 4, window: day });
  assert(last.kind === "ok" && last.usage.remaining === 0);
  const over = checkAllowance({ heavy: false, tier: "free", messagesToday: 5, window: day });
  assertEquals(over, { kind: "blocked", usage: { kind: "free_day", used: 5, limit: 5, remaining: 0, resetsAt } });
  assertEquals(allowanceStatus(over, day), "free_blocked");
});

Deno.test("checkAllowance: trial and Pro have forty a day", () => {
  for (const tier of ["trial", "pro"] as const) {
    const ok = checkAllowance({ heavy: false, tier, messagesToday: 39, window: day });
    assert(ok.kind === "ok" && ok.usage.kind === "pro_day" && ok.usage.limit === SCHOLAR_LIMITS.proMessagesPerDay);
    assertEquals(allowanceStatus(ok, day), "pro_ok");
    const over = checkAllowance({ heavy: false, tier, messagesToday: 40, window: day });
    assertEquals(over.kind, "blocked");
    assertEquals(allowanceStatus(over, day), "pro_blocked");
  }
});

Deno.test("a zone Intl does not know is read as UTC, and the log says so", () => {
  const fallback = dayWindow(new Date("2026-11-11T15:00:00Z"), "Not/AZone");
  const ok = checkAllowance({ heavy: false, tier: "free", messagesToday: 0, window: fallback });
  assertEquals(allowanceStatus(ok, fallback), "free_ok:bad_timezone");
  assert(ok.kind === "ok" && ok.usage.resetsAt === "2026-11-12T00:00:00.000Z");
});

Deno.test("checkListen: listening is Pro; a free account is told by the plan, a heavy conversation is open to all", () => {
  assertEquals(checkListen({ heavy: true, tier: "free", listensToday: 0, part: 0, window: day }), { kind: "exempt" });
  assertEquals(checkListen({ heavy: false, tier: "free", listensToday: 0, part: 3, window: day }), {
    kind: "blocked",
    usage: { kind: "listen_plan", used: 0, limit: 0, remaining: 0, resetsAt: null },
  });
});

Deno.test("checkListen: Pro hears five answers a day, checked and counted on part 0 only", () => {
  const first = checkListen({ heavy: false, tier: "pro", listensToday: 0, part: 0, window: day });
  assertEquals(first, {
    kind: "ok",
    usage: { kind: "listen_day", used: 1, limit: SCHOLAR_LIMITS.proListensPerDay, remaining: 4, resetsAt },
  });
  const sixth = checkListen({ heavy: false, tier: "trial", listensToday: 5, part: 0, window: day });
  assertEquals(sixth.kind, "blocked");
  // The rest of an answer already started is never cut off at the limit.
  const rest = checkListen({ heavy: false, tier: "pro", listensToday: 5, part: 2, window: day });
  assertEquals(rest.kind, "ok");
  assert(rest.kind === "ok" && rest.usage.used === 5 && rest.usage.remaining === 0);
});

Deno.test("the free daily budget: SCHOLAR_FREE_DAILY_BUDGET when it is a whole number above 0, else 3,000", () => {
  assertEquals(readFreeBudget(() => undefined), DEFAULT_FREE_DAILY_BUDGET);
  assertEquals(readFreeBudget(() => "250"), 250);
  for (const bad of ["", "abc", "-5", "0", "2.5", "1e9x"]) {
    assertEquals(readFreeBudget(() => bad), DEFAULT_FREE_DAILY_BUDGET, bad);
  }
  assertEquals(freeBudgetLeft(2_999, 3_000), true);
  assertEquals(freeBudgetLeft(3_000, 3_000), false);
  assertEquals(freeBudgetLeft(0, 1), true);
});

Deno.test("currentUsage: the day as it stands, counting nothing new (a replayed answer)", () => {
  assertEquals(currentUsage({ tier: "free", messagesToday: 3, window: day }), {
    kind: "free_day",
    used: 3,
    limit: 5,
    remaining: 2,
    resetsAt,
  });
  assertEquals(currentUsage({ tier: "pro", messagesToday: 41, window: day }).remaining, 0);
});
