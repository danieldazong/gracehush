import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { SCHOLAR_CREDITS, SCHOLAR_FREE } from "./constants.ts";
import {
  allowanceStatus,
  checkListen,
  checkMessage,
  creditsAfterSpend,
  type CreditsRow,
  creditsUsage,
  freeConversationOpen,
  type FreeRow,
  freeUsage,
  listenCost,
  planOpensAt,
  planUsage,
} from "./usage.ts";

const NOW = Date.parse("2026-11-18T15:00:00.000Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const PRO = { tier: "pro" as const, expiresAt: iso(NOW + 300 * 24 * HOUR) };
const FREE = { tier: "free" as const, expiresAt: null };
const TRIAL = { tier: "trial" as const, expiresAt: iso(NOW + 2 * 24 * HOUR) };
const running = (used: number): CreditsRow => ({ used, allowance: 400, renewsAt: iso(NOW + 6 * HOUR) });
// The conversation a request is about, and another one (2026-11-20: the free conversation).
const CONV = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
// The free conversation held by another conversation: every message here gets the plan's answer.
const ELSEWHERE: FreeRow = { conversationId: OTHER, messages: 2 };
const mine = (messages: number): FreeRow => ({ conversationId: CONV, messages });

Deno.test("checkMessage: a heavy conversation is exempt, whatever the plan and the credits", () => {
  for (const plan of [FREE, TRIAL, PRO]) {
    assertEquals(
      checkMessage({ heavy: true, plan, credits: running(9_999), free: null, conversationId: CONV, now: NOW }),
      { kind: "exempt" },
    );
  }
  assertEquals(allowanceStatus({ kind: "exempt" }, "free"), "exempt");
});

Deno.test("checkMessage: the free plan is told by its plan, with no number and no date", () => {
  const free = checkMessage({
    heavy: false,
    plan: FREE,
    credits: null,
    free: ELSEWHERE,
    conversationId: CONV,
    now: NOW,
  });
  assertEquals(free, {
    kind: "blocked",
    usage: { kind: "scholar_plan", used: 0, limit: 0, remaining: 0, resetsAt: null },
  });
  assertEquals(allowanceStatus(free, "free"), "free_blocked");
});

Deno.test("checkMessage: a trial is told by its plan, with the day its plan begins and Scholar opens", () => {
  const trial = checkMessage({
    heavy: false,
    plan: TRIAL,
    credits: running(0),
    free: ELSEWHERE,
    conversationId: CONV,
    now: NOW,
  });
  assertEquals(trial, {
    kind: "blocked",
    usage: { kind: "scholar_plan", used: 0, limit: 0, remaining: 0, resetsAt: TRIAL.expiresAt },
  });
  assertEquals(allowanceStatus(trial, "trial"), "trial_blocked");
  // A trial whose end has passed, or cannot be read, names no day.
  for (const expiresAt of [iso(NOW - 1), iso(NOW), null, "not a date"]) {
    assertEquals(planOpensAt({ tier: "trial", expiresAt }, NOW), null, String(expiresAt));
  }
  // Only a trial opens: a free account with an end date names none.
  assertEquals(planOpensAt({ tier: "free", expiresAt: TRIAL.expiresAt }, NOW), null);
});

Deno.test("checkMessage: an account that is not Pro is answered in its free conversation, SCHOLAR_FREE.messages in all", () => {
  for (const plan of [FREE, TRIAL]) {
    // Nothing claimed yet: the first message of any conversation is free, with all eight to come.
    const first = checkMessage({ heavy: false, plan, credits: null, free: null, conversationId: CONV, now: NOW });
    assertEquals(first, { kind: "ok", usage: { kind: "free", used: 0, limit: 8, remaining: 8, resetsAt: null } });
    assertEquals(allowanceStatus(first, plan.tier), plan.tier === "trial" ? "trial_ok" : "free_ok");
    // In the conversation that claimed it: the seventh answered, one left, then none.
    const eighth = checkMessage({ heavy: false, plan, credits: null, free: mine(7), conversationId: CONV, now: NOW });
    assert(eighth.kind === "ok" && eighth.usage.kind === "free" && eighth.usage.remaining === 1);
    const ninth = checkMessage({ heavy: false, plan, credits: null, free: mine(8), conversationId: CONV, now: NOW });
    assertEquals(ninth, {
      kind: "blocked",
      usage: {
        kind: "scholar_plan",
        used: 0,
        limit: 0,
        remaining: 0,
        resetsAt: plan.tier === "trial" ? TRIAL.expiresAt : null,
      },
    });
    assertEquals(allowanceStatus(ninth, plan.tier), plan.tier === "trial" ? "trial_blocked" : "free_blocked");
    // A count past the eight (a race) is never negative.
    assertEquals(freeUsage(11).remaining, 0);
    // A heavy conversation is never counted, whatever the free conversation holds.
    assertEquals(checkMessage({ heavy: true, plan, credits: null, free: mine(8), conversationId: CONV, now: NOW }), {
      kind: "exempt",
    });
  }
  // Pro never touches the free conversation.
  const pro = checkMessage({ heavy: false, plan: PRO, credits: null, free: mine(8), conversationId: CONV, now: NOW });
  assert(pro.kind === "ok" && pro.usage.kind === "credits");
});

Deno.test("freeConversationOpen: nothing claimed, or this conversation; never another", () => {
  assertEquals(freeConversationOpen(null, CONV), true);
  assertEquals(freeConversationOpen(mine(3), CONV), true);
  assertEquals(freeConversationOpen(ELSEWHERE, CONV), false);
});

Deno.test("SCHOLAR_FREE: the co-founder's numbers (2026-11-20): one conversation, 8 messages, 3 minutes of talk", () => {
  assertEquals(SCHOLAR_FREE, { messages: 8, talkSeconds: 180 });
});

Deno.test("checkMessage: Pro with no credits row has the whole allowance, and no renewal until the first spend", () => {
  const first = checkMessage({ heavy: false, plan: PRO, credits: null, free: null, conversationId: CONV, now: NOW });
  assertEquals(first, {
    kind: "ok",
    usage: {
      kind: "credits",
      used: 0,
      limit: SCHOLAR_CREDITS.allowance,
      remaining: SCHOLAR_CREDITS.allowance,
      resetsAt: null,
    },
  });
  assertEquals(allowanceStatus(first, "pro"), "pro_ok");
});

Deno.test("checkMessage: Pro may send while one credit is left, and is told when the window renews", () => {
  const some = checkMessage({
    heavy: false,
    plan: PRO,
    credits: running(250),
    free: null,
    conversationId: CONV,
    now: NOW,
  });
  assertEquals(some, {
    kind: "ok",
    usage: { kind: "credits", used: 250, limit: 400, remaining: 150, resetsAt: iso(NOW + 6 * HOUR) },
  });
  const last = checkMessage({
    heavy: false,
    plan: PRO,
    credits: running(399),
    free: null,
    conversationId: CONV,
    now: NOW,
  });
  assert(last.kind === "ok" && last.usage.remaining === 1);
  const out = checkMessage({
    heavy: false,
    plan: PRO,
    credits: running(400),
    free: null,
    conversationId: CONV,
    now: NOW,
  });
  assertEquals(out, {
    kind: "blocked",
    usage: { kind: "credits", used: 400, limit: 400, remaining: 0, resetsAt: iso(NOW + 6 * HOUR) },
  });
  assertEquals(allowanceStatus(out, "pro"), "pro_blocked");
  // The last message may take the count past the allowance; nothing is ever negative.
  const over = checkMessage({
    heavy: false,
    plan: PRO,
    credits: running(403),
    free: null,
    conversationId: CONV,
    now: NOW,
  });
  assert(over.kind === "blocked" && over.usage.remaining === 0 && over.usage.used === 403);
});

Deno.test("checkMessage: a window that has ended is a whole allowance again", () => {
  const ended: CreditsRow = { used: 400, allowance: 400, renewsAt: iso(NOW) };
  const ok = checkMessage({ heavy: false, plan: PRO, credits: ended, free: null, conversationId: CONV, now: NOW });
  assertEquals(ok, {
    kind: "ok",
    usage: { kind: "credits", used: 0, limit: 400, remaining: 400, resetsAt: null },
  });
  // A row whose renewal cannot be read counts as ended, never as used up.
  assertEquals(creditsUsage({ used: 400, allowance: 400, renewsAt: "soon" }, NOW).remaining, 400);
});

Deno.test("creditsAfterSpend: what the answer carries once the cost is spent", () => {
  // No row: the window starts now.
  assertEquals(creditsAfterSpend(null, 4, NOW), {
    kind: "credits",
    used: 4,
    limit: 400,
    remaining: 396,
    resetsAt: iso(NOW + SCHOLAR_CREDITS.windowSeconds * 1000),
  });
  // A running window adds the cost and keeps its end.
  assertEquals(creditsAfterSpend(running(100), 4, NOW), {
    kind: "credits",
    used: 104,
    limit: 400,
    remaining: 296,
    resetsAt: iso(NOW + 6 * HOUR),
  });
  // An ended window starts again with this cost.
  const ended: CreditsRow = { used: 380, allowance: 400, renewsAt: iso(NOW - HOUR) };
  const restarted = creditsAfterSpend(ended, 4, NOW);
  assertEquals([restarted.used, restarted.remaining], [4, 396]);
  assertEquals(restarted.resetsAt, iso(NOW + SCHOLAR_CREDITS.windowSeconds * 1000));
  // Past the allowance the answer says none is left, never a negative number.
  assertEquals(creditsAfterSpend(running(398), 4, NOW).remaining, 0);
});

Deno.test("checkListen: a heavy conversation is open to everyone and never counted", () => {
  for (const plan of [FREE, TRIAL, PRO]) {
    assertEquals(
      checkListen({ heavy: true, plan, credits: running(9_999), free: null, conversationId: CONV, part: 0, now: NOW }),
      { kind: "exempt" },
    );
  }
});

Deno.test("checkListen: the free plan and the trial are told by their plan on every part", () => {
  for (const part of [0, 3]) {
    assertEquals(
      checkListen({ heavy: false, plan: FREE, credits: null, free: ELSEWHERE, conversationId: CONV, part, now: NOW }),
      {
        kind: "blocked",
        usage: { kind: "listen_plan", used: 0, limit: 0, remaining: 0, resetsAt: null },
      },
    );
    const trial = checkListen({
      heavy: false,
      plan: TRIAL,
      credits: null,
      free: ELSEWHERE,
      conversationId: CONV,
      part,
      now: NOW,
    });
    assertEquals(trial, {
      kind: "blocked",
      usage: { kind: "listen_plan", used: 0, limit: 0, remaining: 0, resetsAt: TRIAL.expiresAt },
    });
    assertEquals(allowanceStatus(trial, "trial"), "trial_blocked");
  }
});

Deno.test("checkListen: the free conversation's answers are read aloud for free, and only in that conversation", () => {
  for (const plan of [FREE, TRIAL]) {
    for (const part of [0, 2]) {
      // Even with every free message used: an answer the person was given may be heard.
      const ok = checkListen({
        heavy: false,
        plan,
        credits: null,
        free: mine(8),
        conversationId: CONV,
        part,
        now: NOW,
      });
      assert(ok.kind === "ok" && ok.usage.kind === "free" && ok.usage.used === 8);
      assertEquals(allowanceStatus(ok, plan.tier), plan.tier === "trial" ? "trial_ok" : "free_ok");
    }
    // Nothing claimed: no answer exists yet, so nothing is free to hear.
    const unclaimed = checkListen({
      heavy: false,
      plan,
      credits: null,
      free: null,
      conversationId: CONV,
      part: 0,
      now: NOW,
    });
    assertEquals(unclaimed.kind, "blocked");
  }
});

Deno.test("checkListen: Pro's credits are checked on part 0 only, so an answer started is never cut off", () => {
  const first = checkListen({
    heavy: false,
    plan: PRO,
    credits: running(100),
    free: null,
    conversationId: CONV,
    part: 0,
    now: NOW,
  });
  assert(first.kind === "ok" && first.usage.kind === "credits" && first.usage.remaining === 300);
  const out = checkListen({
    heavy: false,
    plan: PRO,
    credits: running(400),
    free: null,
    conversationId: CONV,
    part: 0,
    now: NOW,
  });
  assertEquals(out.kind, "blocked");
  assertEquals(allowanceStatus(out, "pro"), "pro_blocked");
  const rest = checkListen({
    heavy: false,
    plan: PRO,
    credits: running(400),
    free: null,
    conversationId: CONV,
    part: 2,
    now: NOW,
  });
  assert(rest.kind === "ok" && rest.usage.remaining === 0);
});

Deno.test("listenCost: listenPer100Chars for every 100 characters of the whole script, rounded up, never nothing", () => {
  const per = SCHOLAR_CREDITS.listenPer100Chars;
  assertEquals(listenCost(0), per);
  assertEquals(listenCost(-50), per);
  assertEquals(listenCost(1), per);
  assertEquals(listenCost(100), per);
  assertEquals(listenCost(101), 2 * per);
  assertEquals(listenCost(1_800), 18 * per);
  assertEquals(listenCost(1_801), 19 * per);
});

Deno.test("SCHOLAR_CREDITS: the owner's numbers (2026-11-18): 400 a day from the first spend, a message 4, Listen 3 per 100", () => {
  assertEquals(SCHOLAR_CREDITS, { allowance: 400, windowSeconds: 86_400, message: 4, listenPer100Chars: 3 });
  assertEquals(listenCost(1_306), 42, "1,306 characters cost 42 credits, the price of about ten messages");
});

Deno.test("planUsage: a talk is refused by its plan in the same shape", () => {
  assertEquals(planUsage("talk_plan", TRIAL, NOW), {
    kind: "talk_plan",
    used: 0,
    limit: 0,
    remaining: 0,
    resetsAt: TRIAL.expiresAt,
  });
  assertEquals(planUsage("talk_plan", FREE, NOW).resetsAt, null);
});
