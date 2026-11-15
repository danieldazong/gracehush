import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { monthWindow } from "../limits/weekly.ts";
import {
  billableSeconds,
  checkTalkAllowance,
  countTalkTurns,
  elapsedSeconds,
  heavySecondsUsed,
  monthSecondsUsed,
  talkCapReached,
  talkLimits,
} from "./allowance.ts";
import { VOICE_LIMITS, VOICE_SESSION_MAX_SECONDS, VOICE_SESSION_TTL_MS } from "./constants.ts";

// A live talk's time (step 39, decisions 21 to 25): 30 minutes a calendar month, at most 10 minutes a talk, and a heavy
// conversation's talk never counted and never cut.

const WINDOW = monthWindow(new Date("2026-11-13T10:00:00.000Z"), "Africa/Lagos");
const RESETS = "2026-11-30T23:00:00.000Z";

const base = {
  tier: "pro" as const,
  heavy: false,
  monthSeconds: 0,
  heavySecondsToday: 0,
  startsToday: 0,
  window: WINDOW,
};

Deno.test("allowance: the numbers of decisions 21 to 25", () => {
  assertEquals(VOICE_LIMITS, {
    monthSeconds: 1_800,
    talkSeconds: 600,
    minTalkSeconds: 30,
    backstopSeconds: 1_800,
    maxTurns: 80,
    startsPerDay: 20,
    heavySecondsPerDay: 7_200,
  });
  // The table's own ceiling for `seconds` (scholar_voice_sessions_seconds_range) leaves room after ElevenLabs' 30 minutes.
  assertEquals(VOICE_SESSION_MAX_SECONDS, 1_900);
  assert(VOICE_SESSION_MAX_SECONDS > VOICE_LIMITS.backstopSeconds);
});

Deno.test("allowance: a talk's elapsed time is whole seconds, never negative and never above the table's ceiling", () => {
  const start = "2026-11-13T10:00:00.000Z";
  const at = (seconds: number) => Date.parse(start) + seconds * 1000;
  assertEquals(elapsedSeconds(start, at(0)), 0);
  assertEquals(elapsedSeconds(start, at(59.999)), 59);
  assertEquals(elapsedSeconds(start, at(600)), 600);
  assertEquals(elapsedSeconds(start, at(-5)), 0);
  assertEquals(elapsedSeconds(start, at(1_900)), 1_900);
  assertEquals(elapsedSeconds(start, at(86_400)), 1_900);
  assertEquals(elapsedSeconds("not a time", at(10)), 0);
  assertEquals(elapsedSeconds(start, Number.NaN), 0);
});

Deno.test("allowance: a talk costs its time up to its cap, and nothing in a heavy conversation", () => {
  assertEquals(billableSeconds({ seconds: 240, cap_seconds: 600, is_heavy: false }), 240);
  // A few seconds past the cap, while Scholar finished a sentence, cost the cap.
  assertEquals(billableSeconds({ seconds: 618, cap_seconds: 600, is_heavy: false }), 600);
  assertEquals(billableSeconds({ seconds: 95, cap_seconds: 90, is_heavy: false }), 90);
  // A talk that became heavy, and one that started heavy (no cap), cost nothing however long they ran.
  assertEquals(billableSeconds({ seconds: 1_500, cap_seconds: 600, is_heavy: true }), 0);
  assertEquals(billableSeconds({ seconds: 1_900, cap_seconds: null, is_heavy: true }), 0);
  assertEquals(billableSeconds({ seconds: 120, cap_seconds: null, is_heavy: false }), 120);
  assertEquals(billableSeconds({ seconds: -3, cap_seconds: 600, is_heavy: false }), 0);
});

Deno.test("allowance: the month counts every clear talk, and the day's heavy time counts only heavy ones", () => {
  const sessions = [
    { seconds: 600, cap_seconds: 600, is_heavy: false },
    { seconds: 612, cap_seconds: 600, is_heavy: false },
    { seconds: 1_400, cap_seconds: 600, is_heavy: true },
    { seconds: 300, cap_seconds: null, is_heavy: true },
    { seconds: 45, cap_seconds: 300, is_heavy: false },
    { seconds: 0, cap_seconds: 600, is_heavy: false },
  ];
  assertEquals(monthSecondsUsed(sessions), 600 + 600 + 45);
  assertEquals(heavySecondsUsed(sessions), 1_400 + 300);
  assertEquals(monthSecondsUsed([]), 0);
  assertEquals(heavySecondsUsed([]), 0);
});

Deno.test("allowance: a paid account with time left may talk, for the smaller of 10 minutes and what is left", () => {
  for (const tier of ["trial", "pro"] as const) {
    assertEquals(checkTalkAllowance({ ...base, tier }), {
      kind: "ok",
      capSeconds: 600,
      limits: { talkSeconds: 600, monthSecondsLeft: 1_800, resetsAt: RESETS },
    });
  }
  assertEquals(checkTalkAllowance({ ...base, monthSeconds: 1_200 }), {
    kind: "ok",
    capSeconds: 600,
    limits: { talkSeconds: 600, monthSecondsLeft: 600, resetsAt: RESETS },
  });
  assertEquals(checkTalkAllowance({ ...base, monthSeconds: 1_500 }), {
    kind: "ok",
    capSeconds: 300,
    limits: { talkSeconds: 300, monthSecondsLeft: 300, resetsAt: RESETS },
  });
  // Exactly 30 seconds left is still a talk.
  assertEquals(checkTalkAllowance({ ...base, monthSeconds: 1_770 }), {
    kind: "ok",
    capSeconds: 30,
    limits: { talkSeconds: 30, monthSecondsLeft: 30, resetsAt: RESETS },
  });
});

Deno.test("allowance: under 30 seconds left counts as used up, with when the month's time returns", () => {
  for (const monthSeconds of [1_771, 1_799, 1_800, 2_400]) {
    assertEquals(checkTalkAllowance({ ...base, monthSeconds }), {
      kind: "month",
      usage: {
        kind: "talk_month",
        used: monthSeconds,
        limit: 1_800,
        remaining: Math.max(0, 1_800 - monthSeconds),
        resetsAt: RESETS,
      },
    });
    assertEquals(talkLimits({ heavy: false, monthSeconds, window: WINDOW }), {
      talkSeconds: 0,
      monthSecondsLeft: 0,
      resetsAt: RESETS,
    });
  }
});

Deno.test("allowance: a free account gets the plan's answer, in a heavy conversation too, before any other limit", () => {
  const plan = { kind: "plan", usage: { kind: "talk_plan", used: 0, limit: 0, remaining: 0, resetsAt: null } };
  assertEquals(checkTalkAllowance({ ...base, tier: "free" }), plan);
  assertEquals(checkTalkAllowance({ ...base, tier: "free", heavy: true }), plan);
  assertEquals(checkTalkAllowance({ ...base, tier: "free", startsToday: 99, monthSeconds: 9_999 }), plan);
});

Deno.test("allowance: the twenty-first talk of a day is refused, heavy or not", () => {
  assertEquals(checkTalkAllowance({ ...base, startsToday: 19 }).kind, "ok");
  assertEquals(checkTalkAllowance({ ...base, startsToday: 20 }), { kind: "starts" });
  assertEquals(checkTalkAllowance({ ...base, startsToday: 20, heavy: true }), { kind: "starts" });
  // The day's starts come before the month: a used-up month on the twenty-first start is still "starts".
  assertEquals(checkTalkAllowance({ ...base, startsToday: 21, monthSeconds: 1_800 }), { kind: "starts" });
});

Deno.test("allowance: a heavy conversation's talk is never counted or capped, up to 120 minutes of heavy talk a day", () => {
  const open = {
    kind: "ok",
    capSeconds: null,
    limits: { talkSeconds: null, monthSecondsLeft: null, resetsAt: RESETS },
  };
  assertEquals(checkTalkAllowance({ ...base, heavy: true }), open);
  // A used-up month does not stand in a heavy conversation's way.
  assertEquals(checkTalkAllowance({ ...base, heavy: true, monthSeconds: 1_800 }), open);
  assertEquals(checkTalkAllowance({ ...base, heavy: true, heavySecondsToday: 7_199 }), open);
  assertEquals(checkTalkAllowance({ ...base, heavy: true, heavySecondsToday: 7_200 }), { kind: "resting" });
  assertEquals(checkTalkAllowance({ ...base, heavy: true, heavySecondsToday: 9_000 }), { kind: "resting" });
  // The day's heavy time never stops a talk in a clear conversation.
  assertEquals(checkTalkAllowance({ ...base, heavySecondsToday: 9_000 }).kind, "ok");
  assertEquals(talkLimits({ heavy: true, monthSeconds: 1_800, window: WINDOW }), {
    talkSeconds: null,
    monthSecondsLeft: null,
    resetsAt: RESETS,
  });
});

Deno.test("allowance: a clear talk has reached its end past its own cap or after 80 turns", () => {
  const started = "2026-11-13T10:00:00.000Z";
  const at = (seconds: number) => Date.parse(started) + seconds * 1000;
  const session = { started_at: started, cap_seconds: 600, turns: 4 };
  assertEquals(talkCapReached(session, at(599.9)), false);
  assertEquals(talkCapReached(session, at(600)), true);
  assertEquals(talkCapReached({ ...session, cap_seconds: 30 }, at(29)), false);
  assertEquals(talkCapReached({ ...session, cap_seconds: 30 }, at(31)), true);
  assertEquals(talkCapReached({ ...session, turns: 79 }, at(10)), false);
  assertEquals(talkCapReached({ ...session, turns: 80 }, at(10)), true);
  // A talk with no cap (it started in a heavy conversation) is ended by its turns only.
  assertEquals(talkCapReached({ ...session, cap_seconds: null }, at(1_700)), false);
  assertEquals(talkCapReached({ ...session, cap_seconds: null, turns: 80 }, at(5)), true);
  assertEquals(talkCapReached({ ...session, started_at: "not a time" }, at(900)), false);
});

Deno.test("allowance: a spoken message is a talk's turn only when it was made while one of the person's talks ran", () => {
  const started = "2026-11-13T10:00:00.000Z";
  const at = (seconds: number) => new Date(Date.parse(started) + seconds * 1000).toISOString();
  const now = Date.parse(at(3_600));
  const talk = { started_at: started, ended_at: at(300) };
  // Inside the talk, both of its ends included, with five seconds either side for the two clocks.
  assertEquals(countTalkTurns([at(0), at(150), at(300)], [talk], now), 3);
  assertEquals(countTalkTurns([at(-5), at(305)], [talk], now), 2);
  assertEquals(countTalkTurns([at(-6), at(306)], [talk], now), 0);
  // No talk explains nothing, and neither does the time between two talks.
  assertEquals(countTalkTurns([at(150)], [], now), 0);
  const later = { started_at: at(900), ended_at: at(1_200) };
  assertEquals(countTalkTurns([at(150), at(600), at(1_000)], [talk, later], now), 2);
  // A moment that two talks both cover is one turn.
  assertEquals(countTalkTurns([at(150)], [talk, talk], now), 1);
  // A talk that never said it ended runs up to now, and never past the life of its signed session.
  const open = { started_at: started, ended_at: null };
  assertEquals(countTalkTurns([at(60), at(120)], [open], Date.parse(at(90))), 1);
  const life = VOICE_SESSION_TTL_MS / 1000;
  assertEquals(countTalkTurns([at(life + 5), at(life + 6)], [open], now), 1);
  // An end that cannot be read is no end; a start that cannot be read covers nothing; a time that cannot be read is no turn.
  assertEquals(countTalkTurns([at(1_000)], [{ started_at: started, ended_at: "not a time" }], now), 1);
  assertEquals(countTalkTurns([at(150)], [{ started_at: "not a time", ended_at: at(300) }], now), 0);
  assertEquals(countTalkTurns(["not a time", at(150)], [talk], now), 1);
});
