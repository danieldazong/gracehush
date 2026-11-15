import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { installWorld, VOICE_TEST, voiceOn, type World } from "../../process-entry/testing/fakes.ts";
import { readElevenLabsConfig } from "./config.ts";
import { endSweepTiming, VOICE_SWEEP } from "./constants.ts";
import { deleteTalk, listTalks, mintConversationToken } from "./elevenlabs.ts";
import { sweepFinishedTalks, sweepReason, sweepWithRetries } from "./sweep.ts";
import { VOICE_KEYS } from "./voices.ts";

// Deleting finished talks at ElevenLabs (step 39, decision 35), against a fake workspace that also holds another project's agent.

const WARM = VOICE_TEST.agents.warm;
const DEEP = VOICE_TEST.agents.deep;
const OTHER_AGENT = "agent_of_another_project";

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    voiceOn(world);
    try {
      await work(world);
    } finally {
      world.restore();
    }
  };
}

let made = 0;
function talk(world: World, agent: string, status: string): string {
  made += 1;
  const id = `conv_test_${String(made).padStart(6, "0")}`;
  world.elevenTalks.push({
    conversation_id: id,
    agent_id: agent,
    status,
    start_time_unix_secs: 1_800_000_000 + made,
    call_duration_secs: 42,
    message_count: 4,
    call_successful: "success",
  });
  return id;
}

const ids = (world: World) => world.elevenTalks.map((row) => row.conversation_id);
const deletes = (world: World) => world.elevenCalls.filter((call) => call.method === "DELETE");
const lists = (world: World) =>
  world.elevenCalls.filter((call) => call.method === "GET" && call.url.pathname === "/v1/convai/conversations");

Deno.test(
  "sweep: every ended talk of our agents is deleted, and nothing else",
  flow(async (world) => {
    const done = talk(world, WARM, "done");
    const failed = talk(world, DEEP, "failed");
    const running = talk(world, WARM, "in-progress");
    const starting = talk(world, DEEP, "initiated");
    const closing = talk(world, WARM, "processing");
    const theirs = talk(world, OTHER_AGENT, "done");

    const result = await sweepFinishedTalks(readElevenLabsConfig());
    assertEquals(result, { ended: 2, deleted: 2, failed: 0, reason: null });
    assertEquals(ids(world), [running, starting, closing, theirs]);
    assertEquals(deletes(world).map((call) => call.url.pathname.split("/").pop()).sort(), [done, failed].sort());

    // Each of the eight agents is asked for its own talks; the workspace is never listed as a whole.
    assertEquals(lists(world).length, VOICE_KEYS.length);
    assertEquals(
      lists(world).map((call) => call.url.searchParams.get("agent_id")).sort(),
      Object.values(VOICE_TEST.agents).sort(),
    );
    // The key travels in its header only.
    for (const call of world.elevenCalls) {
      assertEquals(call.headers.get("xi-api-key"), VOICE_TEST.apiKey);
      assert(!call.url.href.includes(VOICE_TEST.apiKey), "never in an address");
    }
    assertEquals(sweepReason(result), "voice:sweep:2");

    // A second run finds nothing to do, and says nothing.
    const again = await sweepFinishedTalks(readElevenLabsConfig());
    assertEquals(again, { ended: 0, deleted: 0, failed: 0, reason: null });
    assertEquals(sweepReason(again), null);
  }),
);

Deno.test(
  "sweep: a row that names another agent is never deleted, whatever list it came in",
  flow(async (world) => {
    // ElevenLabs answers the first agent's list with a talk of another agent (a filter that did not hold).
    world.elevenQueue.push({
      kind: "json",
      status: 200,
      body: {
        conversations: [
          { conversation_id: "conv_foreign_000001", agent_id: OTHER_AGENT, status: "done" },
          { conversation_id: "conv_no_agent_00001", status: "done" },
          { agent_id: WARM, status: "done" },
          "not a row",
          null,
        ],
        has_more: false,
      },
    });
    const result = await sweepFinishedTalks(readElevenLabsConfig());
    assertEquals(result, { ended: 0, deleted: 0, failed: 0, reason: null });
    assertEquals(deletes(world).length, 0);
  }),
);

Deno.test(
  "sweep: at most thirty deletions a run, and the next run takes the rest",
  flow(async (world) => {
    assertEquals(VOICE_SWEEP.maxDeletes, 30);
    for (let index = 0; index < 33; index += 1) talk(world, index % 2 === 0 ? WARM : DEEP, "done");
    const first = await sweepFinishedTalks(readElevenLabsConfig());
    assertEquals(first, { ended: 33, deleted: 30, failed: 0, reason: null });
    assertEquals(world.elevenTalks.length, 3);
    const second = await sweepFinishedTalks(readElevenLabsConfig());
    assertEquals(second, { ended: 3, deleted: 3, failed: 0, reason: null });
    assertEquals(world.elevenTalks.length, 0);
  }),
);

Deno.test(
  "sweep: a deletion or a list that fails is one word, changes nothing else, and is tried again at the next run",
  flow(async (world) => {
    const stuck = talk(world, WARM, "done");
    const fine = talk(world, DEEP, "done");
    world.elevenDeleteFails.add(stuck);
    const result = await sweepFinishedTalks(readElevenLabsConfig());
    assertEquals(result, { ended: 2, deleted: 1, failed: 1, reason: "delete_http_500" });
    assertEquals(ids(world), [stuck]);
    assert(!world.elevenTalks.some((row) => row.conversation_id === fine));
    assertEquals(sweepReason(result), "voice:sweep:1:failed:delete_http_500");

    world.elevenDeleteFails.clear();
    assertEquals(await sweepFinishedTalks(readElevenLabsConfig()), { ended: 1, deleted: 1, failed: 0, reason: null });

    // One agent's list fails: the others' talks are still deleted.
    const later = talk(world, DEEP, "done");
    world.elevenQueue.push({ kind: "json", status: 503, body: { detail: { status: "system_busy" } } });
    const partial = await sweepFinishedTalks(readElevenLabsConfig());
    assertEquals(partial.reason, "list_http_503");
    assertEquals(partial.failed, 0);
    // The list that failed was the first agent's (warm); the talk of "deep" went.
    assert(!world.elevenTalks.some((row) => row.conversation_id === later));
    assertEquals(sweepReason(partial), "voice:sweep:1:failed:list_http_503");
    assertEquals(
      sweepReason({ ended: 0, deleted: 0, failed: 0, reason: "list_timeout" }),
      "voice:sweep:0:failed:list_timeout",
    );
  }),
);

Deno.test(
  "sweep after an end: a talk ElevenLabs is still closing is deleted by a later run; the runs stop once nothing is closing",
  flow(async (world) => {
    assertEquals(endSweepTiming.retryAtMs, [10_000, 20_000, 30_000]);
    const AT = endSweepTiming.retryAtMs;
    const config = readElevenLabsConfig();
    // The walk-through's case: the talk that just ended is still being closed at the first run, and done at the second.
    const closing = talk(world, WARM, "processing");
    const waits: number[] = [];
    const result = await sweepWithRetries(config, AT, (ms) => {
      waits.push(ms);
      for (const row of world.elevenTalks) if (row.conversation_id === closing) row.status = "done";
      return Promise.resolve();
    });
    assertEquals(result, { ended: 1, deleted: 1, failed: 0, reason: null, runs: 2 });
    assert(!world.elevenTalks.some((row) => row.conversation_id === closing), "the closed talk was left");
    assertEquals(waits.length, 1);
    assert(waits[0] > 9_000 && waits[0] <= 10_000, String(waits[0]));
    assertEquals(sweepReason(result), "voice:sweep:1");

    // Nothing being closed: one run, no wait.
    talk(world, DEEP, "done");
    const once: number[] = [];
    const single = await sweepWithRetries(config, AT, (ms) => {
      once.push(ms);
      return Promise.resolve();
    });
    assertEquals([single.runs, single.deleted, once.length], [1, 1, 0]);

    // A talk still running after the last moment (another person's, or a long close): four runs at most, and it is left for the
    // next start or end. Another project's agent never counts.
    const running = talk(world, DEEP, "in-progress");
    talk(world, OTHER_AGENT, "processing");
    const before = lists(world).length;
    const capped = await sweepWithRetries(config, AT, async () => {});
    assertEquals(capped.runs, 4);
    assertEquals(lists(world).length - before, 4 * new Set(Object.values(VOICE_TEST.agents)).size);
    assert(world.elevenTalks.some((row) => row.conversation_id === running), "a running talk was deleted");

    // With no moments given (a start), one run whatever is running.
    assertEquals((await sweepWithRetries(config, [], async () => {})).runs, 1);
  }),
);

Deno.test(
  "elevenlabs: a talk that is already gone counts as deleted, and a failure never carries ElevenLabs' own words",
  flow(async (world) => {
    assertEquals(await deleteTalk(VOICE_TEST.apiKey, "conv_never_existed", 1_000), { ok: true });
    world.elevenQueue.push({ kind: "network" });
    assertEquals(await deleteTalk(VOICE_TEST.apiKey, "conv_x_00000001", 1_000), {
      ok: false,
      reason: "delete_network",
    });
    world.elevenQueue.push({ kind: "hang" });
    assertEquals(await deleteTalk(VOICE_TEST.apiKey, "conv_x_00000001", 60), { ok: false, reason: "delete_timeout" });
    world.elevenQueue.push({
      kind: "json",
      status: 422,
      body: { detail: [{ msg: "words that may quote a request" }] },
    });
    assertEquals(await deleteTalk(VOICE_TEST.apiKey, "conv_x_00000001", 1_000), {
      ok: false,
      reason: "delete_http_422",
    });

    world.elevenQueue.push({ kind: "hang" });
    assertEquals(await listTalks(VOICE_TEST.apiKey, WARM, 60), { ok: false, reason: "list_timeout" });
    world.elevenQueue.push({ kind: "json", status: 200, body: { conversations: "none" } });
    assertEquals(await listTalks(VOICE_TEST.apiKey, WARM, 1_000), { ok: false, reason: "list_bad_body" });
    // A wrong key is ElevenLabs' 401.
    assertEquals(await listTalks("sk_anotherworkspacekey0000000", WARM, 1_000), { ok: false, reason: "list_http_401" });
  }),
);

Deno.test(
  "elevenlabs: a one-time token for one agent; at capacity is resting, any other failure is try again",
  flow(async (world) => {
    const token = await mintConversationToken(VOICE_TEST.apiKey, WARM);
    assert(token.startsWith("el-test-token-"));
    const call = world.elevenCalls[0];
    assertEquals(call.url.pathname, "/v1/convai/conversation/token");
    assertEquals(call.url.searchParams.get("agent_id"), WARM);
    assert((await mintConversationToken(VOICE_TEST.apiKey, WARM)) !== token, "a fresh token every time");

    const failure = async (work: Promise<unknown>) => {
      try {
        await work;
      } catch (error) {
        const { code, reason } = error as { code: string; reason: string };
        return `${code} ${reason}`;
      }
      return "no error";
    };
    world.elevenQueue.push({ kind: "json", status: 429, body: { detail: { status: "too_many_concurrent_requests" } } });
    assertEquals(await failure(mintConversationToken(VOICE_TEST.apiKey, WARM)), "SCHOLAR_UNAVAILABLE voice:capacity");
    world.elevenQueue.push({ kind: "json", status: 500, body: {} });
    assertEquals(await failure(mintConversationToken(VOICE_TEST.apiKey, WARM)), "AI_UNAVAILABLE voice:token_http_500");
    world.elevenQueue.push({ kind: "network" });
    assertEquals(await failure(mintConversationToken(VOICE_TEST.apiKey, WARM)), "AI_UNAVAILABLE voice:token_network");
    world.elevenQueue.push({ kind: "json", status: 200, body: { token: "short" } });
    assertEquals(await failure(mintConversationToken(VOICE_TEST.apiKey, WARM)), "AI_UNAVAILABLE voice:token_bad_body");
    // An agent the workspace does not have (a stale ELEVENLABS_AGENTS).
    assertEquals(
      await failure(mintConversationToken(VOICE_TEST.apiKey, "agent_that_is_gone")),
      "AI_UNAVAILABLE voice:token_http_404",
    );
  }),
);
