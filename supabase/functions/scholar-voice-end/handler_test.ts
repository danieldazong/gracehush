import { blankLogLine } from "../_shared/log.ts";
import { monthWindow } from "../_shared/limits/weekly.ts";
import { endSweepTiming } from "../_shared/voice/constants.ts";
import type { ScholarVoiceEndError, ScholarVoiceEndResponse } from "../process-entry/contracts.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  installWorld,
  post,
  unscopedRequests,
  VOICE_TEST,
  voiceOn,
  type World,
} from "../process-entry/testing/fakes.ts";
import { handle } from "./handler.ts";

// scholar-voice-end (step 39): the phone says a talk is over. The talk's row gets its end and its length, and the person is told
// what is left of the month (an account that is not Pro, since 2026-11-20: what is left of its free conversation's talk time).

type Row = Record<string, unknown>;

const USER = "user_test";
const OTHER = "user_other";
const CONVERSATION = "c0a8012e-0000-4000-8000-000000000001";
const TALK = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    voiceOn(world);
    world.seedUser(USER);
    // A Pro account, whose talk time is the month's; the free conversation has a test of its own.
    (world.users.find((row) => row.id === USER) as Row).subscription_tier = "pro";
    try {
      await work(world);
      await world.settleBackground();
    } finally {
      world.restore();
    }
  };
}

const send = (world: World, body: unknown, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, body, options);

async function ok(response: Response): Promise<ScholarVoiceEndResponse> {
  const text = await response.text();
  assertEquals(response.status, 200, text);
  return JSON.parse(text) as ScholarVoiceEndResponse;
}

async function refused(response: Response, status: number, code: string): Promise<ScholarVoiceEndError> {
  const text = await response.text();
  assertEquals(response.status, status, text);
  const body = JSON.parse(text) as ScholarVoiceEndError;
  assertEquals(body.error.code, code);
  return body;
}

const logs = (world: World) => world.logs.map((line) => JSON.parse(line) as Record<string, unknown>);
const lastLog = (world: World) => logs(world).at(-1) as Record<string, unknown>;
const monthEnd = () => monthWindow(new Date(), "UTC").end.toISOString();
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const writes = (world: World) =>
  world.requests.filter((request) => request.method !== "GET" && request.method !== "HEAD");

// A talk of this account that is still running: it started `seconds` ago and had its last turn a little later.
function seedTalk(world: World, over: Row = {}): Row {
  const row: Row = {
    id: TALK,
    user_id: USER,
    conversation_id: CONVERSATION,
    voice: "warm",
    started_at: ago(95),
    last_turn_at: ago(20),
    ended_at: null,
    cap_seconds: 600,
    seconds: 75,
    turns: 3,
    is_heavy: false,
    ...over,
  };
  world.seedUser(String(row.user_id));
  world.voiceSessions.push(row);
  return row;
}

function seedConversation(world: World, over: Row = {}): Row {
  const row: Row = {
    id: CONVERSATION,
    user_id: USER,
    entry_id: null,
    title: null,
    is_heavy: false,
    last_message_at: world.now(),
    created_at: world.now(),
    ...over,
  };
  world.conversations.push(row);
  return row;
}

const between = (value: unknown, low: number, high: number) =>
  assert(typeof value === "number" && value >= low && value <= high, `${value} is not within ${low} to ${high}`);

Deno.test(
  "end: OPTIONS 204, GET 405, no token 401, and a body that is not exactly one talk id is refused before anything is read",
  flow(async (world) => {
    seedTalk(world);
    const preflight = await handle(
      new Request("https://project.supabase.test/functions/v1/scholar-voice-end", { method: "OPTIONS" }),
    );
    assertEquals(preflight.status, 204);
    await refused(await send(world, { talkId: TALK }, { method: "GET" }), 405, "METHOD_NOT_ALLOWED");
    await refused(await send(world, { talkId: TALK }, { token: null }), 401, "UNAUTHORIZED");
    const bad: unknown[] = [
      [],
      "end",
      {},
      { talkId: 7 },
      { talkId: "not-an-id" },
      { talkId: TALK.toUpperCase() },
      { talkId: TALK, userId: OTHER },
      { talkId: TALK, seconds: 5 },
      { talkId: TALK, pad: "x".repeat(3_000) },
    ];
    for (const body of bad) await refused(await send(world, body), 400, "INVALID_REQUEST");
    await refused(await send(world, null, { raw: `{"talkId":"${TALK}"` }), 400, "INVALID_REQUEST");
    assertEquals(world.requests.length, 0);
    assertEquals(world.voiceSessions[0].ended_at, null);
  }),
);

Deno.test(
  "end: the talk gets its end and its length, and the answer is what is left of the month",
  flow(async (world) => {
    const talk = seedTalk(world);
    const before = Date.now();
    const body = await ok(await send(world, { talkId: TALK }));
    // From the start to the end call, which is later than the last turn.
    between(talk.seconds, 95, 98);
    const ended = Date.parse(String(talk.ended_at));
    assert(ended >= before && ended <= Date.now(), "ended now");
    assertEquals(talk.turns, 3);
    assertEquals(body, {
      limits: { talkSeconds: 600, monthSecondsLeft: 3_600 - Number(talk.seconds), resetsAt: monthEnd() },
    });

    // The log line: the shared fields, one word, and nothing that identifies the talk.
    const line = lastLog(world);
    assertEquals(Object.keys(line), Object.keys(blankLogLine({ requestId: "r", status: 200 })));
    assertEquals(line.reason, "voice:end");
    assertEquals(line.status, 200);
    assertEquals(line.limitUsed, talk.seconds);
    const logged = world.logs.join("\n");
    for (const secret of [TALK, CONVERSATION, USER, VOICE_TEST.apiKey]) {
      assert(!logged.includes(secret), "never logged");
    }
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "end: an account that is not Pro is told what is left of its free conversation's 3 minutes, with no month",
  flow(async (world) => {
    for (const tier of ["free", "trial"]) {
      (world.users.find((row) => row.id === USER) as Row).subscription_tier = tier;
      world.voiceSessions.length = 0;
      // An earlier talk in the same conversation already used 40 seconds; one in another conversation does not count.
      world.voiceSessions.push({
        id: crypto.randomUUID(),
        user_id: USER,
        conversation_id: CONVERSATION,
        voice: "warm",
        started_at: ago(900),
        last_turn_at: ago(860),
        ended_at: ago(860),
        cap_seconds: 180,
        seconds: 40,
        turns: 2,
        is_heavy: false,
      });
      world.voiceSessions.push({
        id: crypto.randomUUID(),
        user_id: USER,
        conversation_id: "c0a8012e-0000-4000-8000-000000000009",
        voice: "warm",
        started_at: ago(1_200),
        last_turn_at: ago(1_100),
        ended_at: ago(1_100),
        cap_seconds: 600,
        seconds: 600,
        turns: 9,
        is_heavy: false,
      });
      const talk = seedTalk(world, { cap_seconds: 140 });
      const body = await ok(await send(world, { talkId: TALK }));
      between(talk.seconds, 95, 98);
      assertEquals(body, {
        limits: { talkSeconds: 140 - Number(talk.seconds), monthSecondsLeft: null, resetsAt: monthEnd() },
      });
      assertEquals(lastLog(world).limitUsed, 40 + Number(talk.seconds));
    }
  }),
);

Deno.test(
  "end: calling it twice changes nothing, and a talk a newer start already closed keeps the end it was given",
  flow(async (world) => {
    const talk = seedTalk(world);
    const first = await ok(await send(world, { talkId: TALK }));
    const [endedAt, seconds] = [talk.ended_at, talk.seconds];
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const again = await ok(await send(world, { talkId: TALK }));
    assertEquals([talk.ended_at, talk.seconds], [endedAt, seconds]);
    assertEquals(again, first);

    // Closed at its last activity by the next start (60 seconds), long before this call: still 60.
    const closed = seedTalk(world, { id: crypto.randomUUID(), started_at: ago(900), ended_at: ago(840), seconds: 60 });
    const closedAt = closed.ended_at;
    const body = await ok(await send(world, { talkId: closed.id }));
    assertEquals([closed.ended_at, closed.seconds], [closedAt, 60]);
    assertEquals(body.limits.monthSecondsLeft, 3_600 - Number(seconds) - 60);
  }),
);

Deno.test(
  "end: another person's talk and a talk that does not exist are the same 404, and nothing of theirs changes",
  flow(async (world) => {
    const theirs = seedTalk(world, { user_id: OTHER });
    const missing = "0f9e8d7c-6b5a-4f4e-9d3c-2b1a0f9e8d7c";
    const first = await refused(await send(world, { talkId: TALK }), 404, "NOT_FOUND");
    const second = await refused(await send(world, { talkId: missing }), 404, "NOT_FOUND");
    assertEquals(first.error.message, second.error.message);
    assertEquals([theirs.ended_at, theirs.seconds], [null, 75]);
    assertEquals(writes(world).length, 0);
    assertEquals(lastLog(world).reason, "talk_not_found");
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "end: a talk costs its time and never more than its own cap; one that was never ended for hours stays within the table's range",
  flow(async (world) => {
    // 640 seconds on a cap of 600: Scholar finished a sentence past the cap.
    const long = seedTalk(world, { started_at: ago(640), last_turn_at: ago(30), seconds: 610 });
    const body = await ok(await send(world, { talkId: TALK }));
    between(long.seconds, 640, 643);
    assertEquals(body.limits, { talkSeconds: 600, monthSecondsLeft: 3_000, resetsAt: monthEnd() });

    // A talk whose row already says more than the clock does keeps the larger number.
    const ahead = seedTalk(world, { id: crypto.randomUUID(), started_at: ago(100), seconds: 200, cap_seconds: 300 });
    await ok(await send(world, { talkId: ahead.id }));
    assertEquals(ahead.seconds, 200);

    // The end call for a talk that started three hours ago: 1,900 at most, and it costs its cap.
    const stale = seedTalk(world, {
      id: crypto.randomUUID(),
      started_at: ago(3 * 3_600),
      seconds: 40,
      cap_seconds: 120,
    });
    const after = await ok(await send(world, { talkId: stale.id }));
    assertEquals(stale.seconds, 1_900);
    assertEquals(after.limits.monthSecondsLeft, 3_600 - 600 - 200 - 120);
  }),
);

Deno.test(
  "end: a talk in a heavy conversation is never counted, also when the conversation became heavy during the talk",
  flow(async (world) => {
    // Started heavy: no cap, and nothing about minutes in the answer.
    const heavy = seedTalk(world, { cap_seconds: null, is_heavy: true, started_at: ago(700), seconds: 650 });
    assertEquals((await ok(await send(world, { talkId: TALK }))).limits, {
      talkSeconds: null,
      monthSecondsLeft: null,
      resetsAt: monthEnd(),
    });
    between(heavy.seconds, 700, 703);

    // Became heavy in its last turn: the row does not say so yet, the conversation does.
    const second = "c0a8012e-0000-4000-8000-000000000002";
    seedConversation(world, { id: second, is_heavy: true });
    const became = seedTalk(world, { id: crypto.randomUUID(), conversation_id: second, started_at: ago(300) });
    const body = await ok(await send(world, { talkId: became.id }));
    assertEquals(became.is_heavy, true);
    assertEquals(body.limits.talkSeconds, null);
    assertEquals(body.limits.monthSecondsLeft, null);

    // A later talk in a clear conversation: neither heavy talk took anything from the month.
    const third = "c0a8012e-0000-4000-8000-000000000003";
    seedConversation(world, { id: third });
    const clear = seedTalk(world, {
      id: crypto.randomUUID(),
      conversation_id: third,
      started_at: ago(50),
      seconds: 30,
    });
    const last = await ok(await send(world, { talkId: clear.id }));
    assertEquals(last.limits.monthSecondsLeft, 3_600 - Number(clear.seconds));
    // Another person's heavy conversation with the same id would never be read: every query names the user.
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "end: ending a talk leaves the account's other talks alone, and works while voice is switched off",
  flow(async (world) => {
    const running = seedTalk(world, {
      id: crypto.randomUUID(),
      started_at: ago(30),
      last_turn_at: ago(5),
      seconds: 25,
    });
    const talk = seedTalk(world);
    Deno.env.set("SCHOLAR_VOICE_ENABLED", "false");
    const body = await ok(await send(world, { talkId: TALK }));
    assert(talk.ended_at !== null);
    assertEquals([running.ended_at, running.seconds], [null, 25]);
    // The talk still running is counted as far as its last turn.
    assertEquals(body.limits.monthSecondsLeft, 3_600 - Number(talk.seconds) - 25);
  }),
);

Deno.test(
  "end: after the response the finished talks of our agents are deleted at ElevenLabs, again while one is still being closed; without the voice secrets the talk still ends",
  flow(async (world) => {
    const saved = [...endSweepTiming.retryAtMs];
    endSweepTiming.retryAtMs = [10, 20, 30];
    try {
      seedTalk(world);
      world.elevenTalks.push(
        { conversation_id: "conv_done_0000001", agent_id: VOICE_TEST.agents.warm, status: "done" },
        { conversation_id: "conv_live_0000001", agent_id: VOICE_TEST.agents.deep, status: "in-progress" },
      );
      const lists = () => world.elevenCalls.filter((call) => call.method === "GET").length;
      await ok(await send(world, { talkId: TALK }));
      await world.settleBackground();
      assertEquals(world.elevenTalks.map((row) => row.conversation_id), ["conv_live_0000001"]);
      // A talk still being worked on: the sweep ran four times in all, and wrote one line.
      assertEquals(lists(), 4 * new Set(Object.values(VOICE_TEST.agents)).size);
      const [first, second] = logs(world).slice(-2);
      assertEquals([first.reason, second.reason], ["voice:end", "voice:sweep:1"]);
      assertEquals(second.requestId, first.requestId);
    } finally {
      endSweepTiming.retryAtMs = saved;
    }

    // The workspace's key is gone or malformed: the talk ends all the same, nothing is asked of ElevenLabs, and the line says so.
    const other = seedTalk(world, { id: crypto.randomUUID() });
    Deno.env.set("ELEVENLABS_API_KEY", "not-a-key");
    const calls = world.elevenCalls.length;
    await ok(await send(world, { talkId: other.id }));
    await world.settleBackground();
    assert(other.ended_at !== null);
    assertEquals(world.elevenCalls.length, calls);
    assertEquals(lastLog(world).reason, "voice:end:no_sweep");
  }),
);
