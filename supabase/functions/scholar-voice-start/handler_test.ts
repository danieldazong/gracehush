import { blankLogLine } from "../_shared/log.ts";
import { monthWindow } from "../_shared/limits/weekly.ts";
import { verifyVoiceSession } from "../_shared/voice/session.ts";
import type {
  ScholarVoiceLimitError,
  ScholarVoiceStartError,
  ScholarVoiceStartResponse,
} from "../process-entry/contracts.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  installWorld,
  post,
  seedDevotional,
  unscopedRequests,
  VOICE_TEST,
  voiceOn,
  type World,
} from "../process-entry/testing/fakes.ts";
import { handle } from "./handler.ts";

// scholar-voice-start (step 39): who may start a live talk, for how long, in which voice, and what the phone is handed.

type Row = Record<string, unknown>;

const USER = "user_test";
const OTHER = "user_other";
const CONVERSATION = "c0a8012e-0000-4000-8000-000000000001";
const SECOND = "c0a8012e-0000-4000-8000-000000000002";

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    const scholar = Deno.env.get("SCHOLAR_ENABLED");
    Deno.env.set("SCHOLAR_ENABLED", "true");
    voiceOn(world);
    setPlan(world, "pro");
    try {
      await work(world);
      await world.settleBackground();
    } finally {
      if (scholar === undefined) Deno.env.delete("SCHOLAR_ENABLED");
      else Deno.env.set("SCHOLAR_ENABLED", scholar);
      world.restore();
    }
  };
}

const start = (over: Row = {}): Row => ({ conversationId: CONVERSATION, voice: "warm", ...over });
const send = (world: World, body: unknown, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, body, options);

async function ok(response: Response): Promise<ScholarVoiceStartResponse> {
  const text = await response.text();
  assertEquals(response.status, 200, text);
  return JSON.parse(text) as ScholarVoiceStartResponse;
}

async function refused(response: Response, status: number, code: string): Promise<ScholarVoiceStartError> {
  const text = await response.text();
  assertEquals(response.status, status, text);
  const body = JSON.parse(text) as ScholarVoiceStartError;
  assertEquals(body.error.code, code);
  return body;
}

const logs = (world: World) => world.logs.map((line) => JSON.parse(line) as Record<string, unknown>);
const lastLog = (world: World) => logs(world).at(-1) as Record<string, unknown>;
const tokenCalls = (world: World) =>
  world.elevenCalls.filter((call) => call.url.pathname === "/v1/convai/conversation/token");
const monthEnd = () => monthWindow(new Date(), "UTC").end.toISOString();

function setPlan(world: World, tier: string, expires: string | null = null): void {
  world.seedUser(USER);
  const user = world.users.find((row) => row.id === USER) as Row;
  user.subscription_tier = tier;
  user.subscription_expires_at = expires;
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
  world.seedUser(String(row.user_id));
  world.conversations.push(row);
  return row;
}

// A talk of this account that has ended, some time ago today.
function seedSession(world: World, over: Row = {}): Row {
  const at = new Date(Date.now() - 60_000).toISOString();
  const row: Row = {
    id: crypto.randomUUID(),
    user_id: USER,
    conversation_id: CONVERSATION,
    voice: "warm",
    started_at: at,
    last_turn_at: at,
    ended_at: at,
    cap_seconds: 600,
    seconds: 0,
    turns: 0,
    is_heavy: false,
    ...over,
  };
  world.seedUser(String(row.user_id));
  world.voiceSessions.push(row);
  return row;
}

// ---- The method, the token and the body --------------------------------------------------------------------------------------

Deno.test(
  "start: OPTIONS 204, GET 405, no token or a made-up one 401, and nothing is read, asked or written",
  flow(async (world) => {
    const preflight = await handle(
      new Request("https://project.supabase.test/functions/v1/scholar-voice-start", { method: "OPTIONS" }),
    );
    assertEquals(preflight.status, 204);
    await refused(await send(world, start(), { method: "GET" }), 405, "METHOD_NOT_ALLOWED");
    await refused(await send(world, start(), { token: null }), 401, "UNAUTHORIZED");
    await refused(await send(world, start(), { token: "aaa.bbb.ccc" }), 401, "UNAUTHORIZED");
    assertEquals(world.requests.length, 0);
    assertEquals(world.elevenCalls.length, 0);
    assertEquals(world.voiceSessions.length, 0);
  }),
);

Deno.test(
  "start: the body is small and exact: an unknown key, a voice id, or a malformed id is refused before anything is read",
  flow(async (world) => {
    const bad: unknown[] = [
      [],
      "talk",
      start({ userId: USER }),
      start({ voiceId: "EXAVITQu4vr4xnSDxMaL" }),
      start({ agentId: "agent_x" }),
      start({ conversationId: "C0A8012E-0000-4000-8000-000000000001" }),
      start({ conversationId: "not-an-id" }),
      { voice: "warm" },
      start({ entryId: "nope" }),
      start({ voice: 7 }),
      start({ voice: "" }),
      start({ voice: "EXAVITQu4vr4xnSDxMaL" }),
      start({ voice: "a".repeat(25) }),
      { conversationId: CONVERSATION },
      start({ region: "USA" }),
      start({ region: 1 }),
    ];
    for (const body of bad) await refused(await send(world, body), 400, "INVALID_REQUEST");
    await refused(
      await send(world, null, { raw: `{"conversationId":"${CONVERSATION}","voice":"warm"` }),
      400,
      "INVALID_REQUEST",
    );
    await refused(await send(world, start({ entryId: "x".repeat(3_000) })), 413, "PAYLOAD_TOO_LARGE");
    assertEquals(world.requests.length, 0);
    assertEquals(world.elevenCalls.length, 0);
  }),
);

// ---- The switches and the secrets ---------------------------------------------------------------------------------------------

Deno.test(
  "start: with voice or Scholar switched off no talk starts, and no voice secret is read",
  flow(async (world) => {
    Deno.env.set("SCHOLAR_VOICE_ENABLED", "false");
    for (const name of ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENTS", "SCHOLAR_VOICE_SESSION_SECRET"]) {
      Deno.env.delete(name);
    }
    await refused(await send(world, start()), 503, "SCHOLAR_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "voice:off");
    Deno.env.delete("SCHOLAR_VOICE_ENABLED");
    await refused(await send(world, start()), 503, "SCHOLAR_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "voice:off");

    voiceOn(world);
    Deno.env.set("SCHOLAR_ENABLED", "false");
    await refused(await send(world, start()), 503, "SCHOLAR_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "scholar:off");
    assertEquals(world.requests.length, 0);
    assertEquals(world.elevenCalls.length, 0);
    assertEquals(world.voiceSessions.length, 0);
  }),
);

Deno.test(
  "start: a missing or malformed voice secret is a 500 that names it, and nothing is asked of ElevenLabs",
  flow(async (world) => {
    const cases: [string, string | null][] = [
      ["ELEVENLABS_API_KEY", null],
      ["ELEVENLABS_API_KEY", "not-a-key"],
      ["ELEVENLABS_AGENTS", null],
      ["ELEVENLABS_AGENTS", "{}"],
      ["ELEVENLABS_AGENTS", JSON.stringify({ ...VOICE_TEST.agents, wise: VOICE_TEST.agents.warm })],
      ["SCHOLAR_VOICE_SESSION_SECRET", null],
      ["SCHOLAR_VOICE_SESSION_SECRET", "short"],
    ];
    for (const [name, value] of cases) {
      voiceOn(world);
      if (value === null) Deno.env.delete(name);
      else Deno.env.set(name, value);
      await refused(await send(world, start()), 500, "INTERNAL");
      assertEquals(lastLog(world).reason, `bad_config:${name}`);
    }
    assertEquals(world.elevenCalls.length, 0);
    assertEquals(world.voiceSessions.length, 0);
  }),
);

// ---- A talk that starts ---------------------------------------------------------------------------------------------------------

Deno.test(
  "start: a Pro account gets a token for its voice's agent, a signed session, the talk's row and its limits",
  flow(async (world) => {
    const body = await ok(await send(world, start({ voice: "deep", region: "ng" })));
    assertEquals(body.conversationId, CONVERSATION);
    assertEquals(body.voice, "deep");
    assertEquals(body.heavy, false);
    assertEquals(body.limits, { talkSeconds: 600, monthSecondsLeft: 3_600, resetsAt: monthEnd() });
    assert(body.conversationToken.startsWith("el-test-token-"));

    // The token was asked for that voice's agent, with the workspace's key, once.
    assertEquals(tokenCalls(world).length, 1);
    assertEquals(tokenCalls(world)[0].url.searchParams.get("agent_id"), VOICE_TEST.agents.deep);

    // The session is the server's own word for who the talk belongs to and what it is about.
    const session = await verifyVoiceSession(VOICE_TEST.sessionSecret, body.session);
    assert(session !== null, "signed with the server's secret");
    assertEquals(session.userId, USER);
    assertEquals(session.talkId, body.talkId);
    assertEquals(session.conversationId, CONVERSATION);
    assertEquals(session.reflectionId, null);
    assertEquals(session.region, "other");
    assertEquals(session.voice, "deep");
    assertEquals(session.expiresAt - session.issuedAt, 32 * 60_000);

    // The row: this talk, this person, its cap, not heavy, not ended.
    assertEquals(world.voiceSessions.length, 1);
    const row = world.voiceSessions[0];
    assertEquals(row.id, body.talkId);
    assertEquals(row.user_id, USER);
    assertEquals(row.conversation_id, CONVERSATION);
    assertEquals(row.voice, "deep");
    assertEquals(row.cap_seconds, 600);
    assertEquals(row.is_heavy, false);
    assertEquals(row.ended_at, null);
    assertEquals(row.seconds, 0);
    assertEquals(row.turns, 0);
    // Nothing of the conversation is made yet: the first turn makes it.
    assertEquals(world.conversations.length, 0);

    // The log line: the shared 43 fields, what happened in a word, and nothing that identifies the talk.
    const line = lastLog(world);
    assertEquals(Object.keys(line), Object.keys(blankLogLine({ requestId: "r", status: 200 })));
    assertEquals(line.reason, "voice:start");
    assertEquals(line.status, 200);
    assertEquals(line.limit, "pro_ok");
    assertEquals(line.limitUsed, 0);
    const logged = world.logs.join("\n");
    for (
      const secret of [body.conversationToken, body.session, body.talkId, CONVERSATION, USER, "deep", VOICE_TEST.apiKey]
    ) {
      assert(!logged.includes(secret), "never in a log line");
    }
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "start: the server decides the voice: one of the eight, or the default for a key it does not know",
  flow(async (world) => {
    assertEquals((await ok(await send(world, start({ voice: "storyteller" })))).voice, "storyteller");
    assertEquals(tokenCalls(world).at(-1)?.url.searchParams.get("agent_id"), VOICE_TEST.agents.storyteller);
    // A newer app's voice, or one that was retired: the default, never an error and never an id from the phone.
    const unknown = await ok(await send(world, start({ voice: "gentle", conversationId: SECOND })));
    assertEquals(unknown.voice, "warm");
    assertEquals(tokenCalls(world).at(-1)?.url.searchParams.get("agent_id"), VOICE_TEST.agents.warm);
    assertEquals(world.voiceSessions.at(-1)?.voice, "warm");
    assertEquals((await verifyVoiceSession(VOICE_TEST.sessionSecret, unknown.session))?.voice, "warm");
  }),
);

// ---- The plan, the day and the month ---------------------------------------------------------------------------------------------

Deno.test(
  "start: the free plan talks 3 minutes in its free conversation, in Hannah's voice, and the talk claims it",
  flow(async (world) => {
    setPlan(world, "free");
    // Nothing claimed: a talk is the free conversation's first use. The voice the phone asks for gives way to the default.
    const first = await ok(await send(world, start({ voice: "storyteller" })));
    assertEquals(first.limits, { talkSeconds: 180, monthSecondsLeft: null, resetsAt: monthEnd() });
    assertEquals(first.voice, "warm");
    assertEquals(tokenCalls(world).at(-1)?.url.searchParams.get("agent_id"), VOICE_TEST.agents.warm);
    assertEquals(world.voiceSessions.at(-1)?.cap_seconds, 180);
    assertEquals(lastLog(world).limit, "free_ok");
    assertEquals(world.scholarFree.map((row) => [row.conversation_id, row.messages]), [[CONVERSATION, 0]]);

    // A second talk in the same conversation has what is left of the 3 minutes.
    const held = world.voiceSessions.at(-1) as Row;
    Object.assign(held, { ended_at: held.started_at, seconds: 100 });
    const second = await ok(await send(world, start()));
    assertEquals(second.limits.talkSeconds, 80);
    assertEquals(lastLog(world).limitUsed, 100);

    // Used up (under 30 seconds left): the plan's answer, nothing asked of ElevenLabs.
    const again = world.voiceSessions.at(-1) as Row;
    Object.assign(again, { ended_at: again.started_at, seconds: 60 });
    const calls = tokenCalls(world).length;
    const spent = await refused(await send(world, start()), 402, "LIMIT_REACHED") as unknown as ScholarVoiceLimitError;
    assertEquals(spent.usage, { kind: "talk_plan", used: 0, limit: 0, remaining: 0, resetsAt: null });
    assertEquals(lastLog(world).reason, "voice:plan");
    assertEquals(lastLog(world).limit, "free_blocked");

    // Another conversation is the plan's answer: the free conversation is this one, for good. It is refused before anything
    // is written: the account's talk still running is left alone, and no claim is asked for.
    Object.assign(again, { ended_at: null });
    const claims = () => world.rpcCalls.filter((call) => call.name === "claim_scholar_free_conversation").length;
    const claimed = claims();
    await refused(await send(world, start({ conversationId: SECOND })), 402, "LIMIT_REACHED");
    assertEquals(
      world.voiceSessions.find((row) => row.id === again.id)?.ended_at,
      null,
      "a refused start closes no talk",
    );
    assertEquals(claims(), claimed, "a refused start asks for no claim");
    assertEquals(tokenCalls(world).length, calls);
    assertEquals(world.scholarFree.length, 1);
    assertEquals(world.scholarFree[0].conversation_id, CONVERSATION);
  }),
);

Deno.test(
  "start: a heavy conversation never gives an account that is not Pro a talk, and never claims its free conversation",
  flow(async (world) => {
    setPlan(world, "free");
    seedConversation(world, { is_heavy: true });
    const heavy = await refused(await send(world, start()), 402, "LIMIT_REACHED") as unknown as ScholarVoiceLimitError;
    assertEquals(heavy.usage.kind, "talk_plan");
    assertEquals(world.scholarFree.length, 0);
    assertEquals(world.voiceSessions.length, 0);
    assertEquals(world.elevenCalls.length, 0);
    // The free conversation is still to come, in another conversation.
    assertEquals((await ok(await send(world, start({ conversationId: SECOND })))).limits.talkSeconds, 180);
    assertEquals(world.scholarFree[0].conversation_id, SECOND);
  }),
);

Deno.test(
  "start: a trial talks in its free conversation in the voice it chose, and elsewhere is told the day its plan begins",
  flow(async (world) => {
    const ends = new Date(Date.now() + 2 * 86_400_000).toISOString();
    setPlan(world, "trial", ends);
    const talk = await ok(await send(world, start({ voice: "storyteller" })));
    assertEquals(talk.voice, "storyteller");
    assertEquals(talk.limits.talkSeconds, 180);
    assertEquals(lastLog(world).limit, "trial_ok");
    const trial = await refused(
      await send(world, start({ conversationId: SECOND })),
      402,
      "LIMIT_REACHED",
    ) as unknown as ScholarVoiceLimitError;
    assertEquals(trial.usage, { kind: "talk_plan", used: 0, limit: 0, remaining: 0, resetsAt: ends });
    assertEquals(lastLog(world).limit, "trial_blocked");
  }),
);

Deno.test(
  "start: a claim another conversation won in the meantime refuses the talk, and Pro never claims",
  flow(async (world) => {
    setPlan(world, "free");
    // A message elsewhere claimed the free conversation between the read and the claim: the claim answers the other one. The fake
    // records an RPC before it reads the table, so the other conversation's row lands just in time.
    const push = world.rpcCalls.push.bind(world.rpcCalls);
    world.rpcCalls.push = (...calls) => {
      if (calls.some((call) => call.name === "claim_scholar_free_conversation") && world.scholarFree.length === 0) {
        world.scholarFree.push({
          user_id: USER,
          conversation_id: SECOND,
          messages: 1,
          created_at: world.now(),
          updated_at: world.now(),
        });
      }
      return push(...calls);
    };
    await refused(await send(world, start()), 402, "LIMIT_REACHED");
    assertEquals(world.voiceSessions.length, 0);
    assertEquals(tokenCalls(world).length, 0);

    assertEquals(lastLog(world).limit, "free_blocked");

    setPlan(world, "pro");
    world.scholarFree.length = 0;
    const claims = () => world.rpcCalls.filter((call) => call.name === "claim_scholar_free_conversation").length;
    const before = claims();
    assertEquals((await ok(await send(world, start()))).limits.talkSeconds, 600);
    assertEquals([claims(), world.scholarFree.length], [before, 0]);
  }),
);

Deno.test(
  "start: a paid plan whose end date has passed is read again from RevenueCat before anything else",
  flow(async (world) => {
    setPlan(world, "pro", "2026-01-01T00:00:00.000Z");
    // The free conversation is held elsewhere, so the free plan RevenueCat answers has no talk here.
    world.scholarFree.push({
      user_id: USER,
      conversation_id: SECOND,
      messages: 2,
      created_at: world.now(),
      updated_at: world.now(),
    });
    await refused(await send(world, start()), 402, "LIMIT_REACHED");
    assertEquals(world.revenuecatCalls.length, 1);
    assertEquals(lastLog(world).billing, "synced");
    assertEquals(lastLog(world).reason, "voice:plan");
    assertEquals(world.elevenCalls.length, 0);
  }),
);

Deno.test(
  "start: an account Scholar was closed for (the person said they are under 18) cannot start a talk",
  flow(async (world) => {
    (world.users.find((row) => row.id === USER) as Row).scholar_closed_at = "2026-11-12T10:00:00.000Z";
    await refused(await send(world, start()), 403, "SCHOLAR_ADULTS_ONLY");
    assertEquals(world.elevenCalls.length, 0);
    assertEquals(world.voiceSessions.length, 0);
  }),
);

Deno.test(
  "start: twenty talks a day, and the twenty-first is refused whatever the conversation",
  flow(async (world) => {
    for (let index = 0; index < 19; index += 1) seedSession(world);
    await ok(await send(world, start()));
    assertEquals(world.voiceSessions.length, 20);
    await refused(await send(world, start({ conversationId: SECOND })), 429, "RATE_LIMITED");
    assertEquals(lastLog(world).reason, "voice:starts");
    seedConversation(world, { id: SECOND, is_heavy: true });
    await refused(await send(world, start({ conversationId: SECOND })), 429, "RATE_LIMITED");
    assertEquals(world.voiceSessions.length, 20);
    assertEquals(tokenCalls(world).length, 1);
    // Yesterday's talks do not count.
    for (const row of world.voiceSessions) row.started_at = new Date(Date.now() - 26 * 3_600_000).toISOString();
    world.voiceSessions.splice(5);
    await ok(await send(world, start()));
  }),
);

Deno.test(
  "start: sixty minutes a calendar month: the talk's cap is the smaller of ten minutes and what is left",
  flow(async (world) => {
    const earlier = new Date(Date.now() - 2 * 60_000).toISOString();
    // 55 minutes used, of which one talk ran 20 seconds past its cap (it costs its cap).
    seedSession(world, { started_at: earlier, seconds: 620, cap_seconds: 600 });
    for (let index = 0; index < 4; index += 1) {
      seedSession(world, { started_at: earlier, seconds: 600, cap_seconds: 600 });
    }
    seedSession(world, { started_at: earlier, seconds: 300, cap_seconds: 600 });
    // Never counted: a talk in a heavy conversation, and last month's.
    seedSession(world, { started_at: earlier, seconds: 1_500, cap_seconds: null, is_heavy: true });
    const lastMonth = new Date(monthWindow(new Date(), "UTC").start.getTime() - 1_000).toISOString();
    seedSession(world, { started_at: lastMonth, last_turn_at: lastMonth, ended_at: lastMonth, seconds: 600 });

    const body = await ok(await send(world, start()));
    assertEquals(body.limits, { talkSeconds: 300, monthSecondsLeft: 300, resetsAt: monthEnd() });
    assertEquals(world.voiceSessions.at(-1)?.cap_seconds, 300);
    assertEquals(lastLog(world).limitUsed, 3_300);

    // Under half a minute left counts as used up: no token is asked for and no row is written.
    world.voiceSessions.pop();
    seedSession(world, { started_at: earlier, seconds: 275, cap_seconds: 300 });
    const before = world.voiceSessions.length;
    const used = await refused(await send(world, start()), 402, "LIMIT_REACHED") as unknown as ScholarVoiceLimitError;
    assertEquals(used.usage, { kind: "talk_month", used: 3_575, limit: 3_600, remaining: 25, resetsAt: monthEnd() });
    assertEquals(lastLog(world).reason, "voice:month");
    assertEquals(lastLog(world).limit, "pro_blocked");
    assertEquals(world.voiceSessions.length, before);
    assertEquals(tokenCalls(world).length, 1);
  }),
);

// ---- A heavy conversation ---------------------------------------------------------------------------------------------------------

Deno.test(
  "start: a heavy conversation's talk is never counted or capped, up to two hours of heavy talk a day",
  flow(async (world) => {
    seedConversation(world, { is_heavy: true });
    const earlier = new Date(Date.now() - 2 * 60_000).toISOString();
    // The month is used up: it does not stand in a heavy conversation's way.
    for (let index = 0; index < 3; index += 1) seedSession(world, { started_at: earlier, seconds: 600 });
    const body = await ok(await send(world, start()));
    assertEquals(body.heavy, true);
    assertEquals(body.limits, { talkSeconds: null, monthSecondsLeft: null, resetsAt: monthEnd() });
    const row = world.voiceSessions.at(-1) as Row;
    assertEquals(row.cap_seconds, null);
    assertEquals(row.is_heavy, true);
    assertEquals(lastLog(world).limit, "exempt");

    // The day's backstop: 120 minutes of heavy talk, then the resting line. Typing and Listen are not this function's.
    row.seconds = 1_900;
    row.ended_at = earlier;
    for (let index = 0; index < 3; index += 1) {
      seedSession(world, { started_at: earlier, seconds: 1_900, cap_seconds: null, is_heavy: true });
    }
    await refused(await send(world, start()), 503, "SCHOLAR_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "voice:heavy_day");
    assertEquals(tokenCalls(world).length, 1);
  }),
);

Deno.test(
  "start: the conversation is found by step 38's rules: a reflection's own conversation wins, and a heavy reflection starts heavy",
  flow(async (world) => {
    const entry = seedDevotional(world, USER);
    // A new conversation about a reflection: the phone's id, and the session carries the reflection.
    const fresh = await ok(await send(world, start({ entryId: entry.id })));
    assertEquals(fresh.conversationId, CONVERSATION);
    assertEquals(fresh.heavy, false);
    assertEquals((await verifyVoiceSession(VOICE_TEST.sessionSecret, fresh.session))?.reflectionId, entry.id);

    // The reflection already has a conversation: that one is the talk's, whatever id the phone made.
    seedConversation(world, { id: SECOND, entry_id: entry.id });
    const existing = await ok(await send(world, start({ entryId: entry.id })));
    assertEquals(existing.conversationId, SECOND);
    assertEquals(world.voiceSessions.at(-1)?.conversation_id, SECOND);
    assertEquals((await verifyVoiceSession(VOICE_TEST.sessionSecret, existing.session))?.conversationId, SECOND);

    // A conversation that is not about this reflection.
    seedConversation(world);
    await refused(await send(world, start({ entryId: entry.id })), 400, "INVALID_REQUEST");
    assertEquals(lastLog(world).reason, "entry_mismatch");

    // A reflection that was a heavy moment: its conversation starts heavy, so the talk is never counted.
    const heavyEntry = seedDevotional(world, USER, { is_crisis: true, help_line: "crisis" });
    const third = "c0a8012e-0000-4000-8000-000000000003";
    const heavy = await ok(await send(world, start({ conversationId: third, entryId: heavyEntry.id })));
    assertEquals(heavy.heavy, true);
    assertEquals(heavy.limits.talkSeconds, null);
    assertEquals(world.voiceSessions.at(-1)?.is_heavy, true);

    // Another person's reflection, a missing one and one that is not finished are the same 404.
    const theirs = seedDevotional(world, OTHER);
    const pending = seedDevotional(world, USER, { processing_status: "processing", devotional_script: null });
    const fourth = "c0a8012e-0000-4000-8000-000000000004";
    for (const entryId of [theirs.id, pending.id, "5f0e7c1a-2b3d-4c5e-8f90-a1b2c3d4e5f6"]) {
      await refused(await send(world, start({ conversationId: fourth, entryId })), 404, "NOT_FOUND");
    }
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

// ---- Talks that never ended, ElevenLabs, and the sweep ---------------------------------------------------------------------------

Deno.test(
  "start: the account's talks that never said they ended are closed at their last activity",
  flow(async (world) => {
    const began = new Date(Date.now() - 20 * 60_000).toISOString();
    const lastTurn = new Date(Date.now() - 17 * 60_000).toISOString();
    const abandoned = seedSession(world, { started_at: began, last_turn_at: lastTurn, ended_at: null, seconds: 170 });
    const silent = seedSession(world, { started_at: began, last_turn_at: null, ended_at: null, seconds: 0 });
    const ended = seedSession(world, { started_at: began, last_turn_at: lastTurn, ended_at: lastTurn, seconds: 95 });

    const body = await ok(await send(world, start()));
    assertEquals(abandoned.ended_at, lastTurn);
    assertEquals(abandoned.seconds, 180);
    assertEquals(silent.ended_at, began);
    assertEquals(silent.seconds, 0);
    assertEquals([ended.ended_at, ended.seconds], [lastTurn, 95]);
    // The abandoned talk is counted as it was closed: up to its last turn.
    assertEquals(body.limits.monthSecondsLeft, 3_600 - 180 - 95);
    // The new talk is the only one still open.
    assertEquals(world.voiceSessions.filter((row) => row.ended_at === null).map((row) => row.id), [body.talkId]);
  }),
);

Deno.test(
  "start: when ElevenLabs gives no token nothing is written or counted; at capacity it is resting",
  flow(async (world) => {
    world.elevenQueue.push({ kind: "json", status: 500, body: { detail: { status: "internal" } } });
    await refused(await send(world, start()), 503, "AI_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "voice:token_http_500");
    world.elevenQueue.push({ kind: "network" });
    await refused(await send(world, start()), 503, "AI_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "voice:token_network");
    world.elevenQueue.push({ kind: "json", status: 429, body: { detail: { status: "system_busy" } } });
    await refused(await send(world, start()), 503, "SCHOLAR_UNAVAILABLE");
    assertEquals(lastLog(world).reason, "voice:capacity");
    assertEquals(world.voiceSessions.length, 0);
    await world.settleBackground();
    // A refused start does not sweep either: only the three token requests reached ElevenLabs.
    assertEquals(world.elevenCalls.length, 3);
    assertEquals((await ok(await send(world, start()))).limits.monthSecondsLeft, 3_600);
  }),
);

Deno.test(
  "start: after the response the finished talks of our agents are deleted at ElevenLabs",
  flow(async (world) => {
    world.elevenTalks.push(
      { conversation_id: "conv_done_0000001", agent_id: VOICE_TEST.agents.warm, status: "done" },
      { conversation_id: "conv_live_0000001", agent_id: VOICE_TEST.agents.warm, status: "in-progress" },
      { conversation_id: "conv_other_000001", agent_id: "agent_of_another_project", status: "done" },
    );
    const response = await send(world, start());
    await ok(response);
    await world.settleBackground();
    assertEquals(world.elevenTalks.map((row) => row.conversation_id), ["conv_live_0000001", "conv_other_000001"]);
    // A second line, the same request, one word.
    const [first, second] = logs(world).slice(-2);
    assertEquals(first.reason, "voice:start");
    assertEquals(second.reason, "voice:sweep:1");
    assertEquals(second.requestId, first.requestId);
    assertEquals(Object.keys(second), Object.keys(first));

    // Nothing to delete: no second line.
    const before = world.logs.length;
    await ok(await send(world, start({ conversationId: SECOND })));
    await world.settleBackground();
    assertEquals(world.logs.length, before + 1);
  }),
);
