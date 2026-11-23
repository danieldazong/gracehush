// Scholar's checks on the phone's side (step 38, Part two, and step 39's live talk). They run the app's real gateway, queries, repository, conversation
// hook, row builder and Listen player, with the real supabase-js client against the fake Supabase of step 25
// (../journal-data/world.cjs), whose scholar-turn and scholar-speak answer as the real functions do without a model, and read
// the screens' source for what a plain Node run cannot draw. Every check ends by asserting that nothing the database refuses was
// sent and that the development log holds no word, id or token.
//
//   node --no-warnings supabase/tests/scholar/run.cjs        (needs Node 22.5 or newer for node:sqlite)
//   ONLY=<part of a check's name> node --no-warnings supabase/tests/scholar/run.cjs
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/scholar/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const W = require("../journal-data/world.cjs");
const recordingWorld = require("../recording/world.cjs");

const {
  makeLiveWorld,
  serverRow,
  settle,
  advance,
  clock,
  BASE,
  json,
  stamp,
  installClock,
  uninstallClock,
  installVirtualDate,
  uninstallVirtualDate,
} = W;

const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
const CHECK_LIMIT_MS = 20000;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

let passed = 0;
const failures = [];

// Nothing may leave this machine. A request that reaches the real fetch (code still running after its check closed its world)
// is recorded with where it came from, and fails the run.
const strayFetches = [];
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  strayFetches.push(new Error(`a request outside its check: ${new URL(url).pathname}`).stack.split("\n").slice(0, 12).join("\n"));
  throw new TypeError("Network request failed");
};

const QUESTION = "What does Philippians four mean for a worried week";
const FORBIDDEN_IN_LOGS = [QUESTION, "tokA", "tokB", "user_a", "user_b", "chat-", "/raw/", "HEAVY"];
const CONV = "00000000-0000-4000-8000-0000000000c1";
// Another conversation, which claimed an account's free conversation (2026-11-20) in a check that needs it used up elsewhere.
const OTHER_CONV = "00000000-0000-4000-8000-0000000000c9";
const mid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

// ------------------------------------------------------------------ the player's native parts
// expo-audio's player, as much of it as services/scholarPlayer.ts uses: one per part, played, reported on, released.
function makeAudio() {
  const audio = { players: [], modes: [], devotionalPauses: 0 };
  audio.module = {
    __esModule: true,
    createAudioPlayer: (source, options) => {
      const listeners = new Set();
      const player = {
        uri: source.uri,
        options,
        played: 0,
        released: false,
        addListener: (event, fn) => {
          listeners.add(fn);
          return { remove: () => listeners.delete(fn) };
        },
        play() {
          player.played += 1;
        },
        pause() {},
        release() {
          player.released = true;
        },
        emit: (status) => [...listeners].forEach((fn) => fn(status)),
      };
      audio.players.push(player);
      return player;
    },
  };
  return audio;
}

function makeScholarFs() {
  const files = recordingWorld.makeFs();
  files.File.prototype.write = async function write(content, options) {
    files.files.set(this.uri, { bytes: Buffer.from(content, options?.encoding === "base64" ? "base64" : "utf8"), mtime: clock.now });
  };
  files.Paths.cache = new files.Directory("file:///cache/");
  return files;
}

// ------------------------------------------------------------------ the runner
async function test(name, run, options = {}) {
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (process.env.TRACE !== undefined) process.stderr.write(`start: ${name}\n`);
  installClock();
  installVirtualDate();
  clock.now = BASE;
  const audio = makeAudio();
  const files = makeScholarFs();
  const fakes = {
    "@clerk/expo": { useAuth: () => ({ userId: "user_a" }) },
    ...(options.player
      ? {
        "expo-audio": audio.module,
        "expo-file-system": { File: files.File, Directory: files.Directory, Paths: files.Paths },
        "@/services/audioSession": { setSessionMode: async (mode) => void audio.modes.push(mode) },
        "@/store/playerStore": { usePlayerStore: { getState: () => ({ pause: () => void (audio.devotionalPauses += 1) }) } },
      }
      : {}),
    ...(options.fakes ?? {}),
  };
  const w = makeLiveWorld({
    aiPermission: options.permission ? "real" : "fake",
    scholarPlayer: options.player ? "real" : "fake",
    fakes,
  });
  w.audio = audio;
  w.files = files;
  let limit;
  try {
    await w.signIn();
    // Scholar is for Pro alone (2026-11-18): the server holds the test account as Pro unless a check says otherwise.
    w.server.state.serverPlans.user_a = "pro";
    await Promise.race([
      run(w),
      new Promise((_, reject) => {
        limit = realSetTimeout(() => reject(new Error("the check never finished")), CHECK_LIMIT_MS);
      }),
    ]);
    assert.deepEqual(w.server.state.violations, [], "the app sent something the database or AGENTS.md refuses");
    for (const line of w.logs) {
      for (const word of FORBIDDEN_IN_LOGS) {
        assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
      }
    }
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 7).join("\n    ")}`);
  } finally {
    realClearTimeout(limit);
    w.close();
    uninstallVirtualDate();
    uninstallClock();
  }
}

function sourceCheck(name, run) {
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  try {
    run();
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 5).join("\n    ")}`);
  }
}

// ------------------------------------------------------------------ helpers
const repo = (w) => w.use("@/data/scholarRepository");
const calls = (w, name) => w.server.state.functionCalls.filter((call) => call.name === name);
const text = (words, n = 1, extra = {}) => ({ conversationId: CONV, messageId: mid(n), input: { type: "text", text: words }, ...extra });
const offline = (w) => w.use("@/store/offlineStore").useOfflineStore.getState().setNet(false, false);

async function until(handle, predicate, label, rounds = 120) {
  for (let i = 0; i < rounds; i += 1) {
    if (predicate(handle.result.current)) return handle.result.current;
    await settle(2);
  }
  const state = handle.result.current;
  assert.fail(`${label}: never reached (phase ${state?.phase}, ${state?.messages?.length} messages, sending ${state?.sending})`);
}

function renderConversation(w, params = {}) {
  const { useConversation } = w.use("@/hooks/useConversation");
  return w.renderHook(useConversation, params);
}

// Holds the next scholar-turn call until release(), then answers it as the fake would.
function holdTurn(w) {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  w.server.state.functions["scholar-turn"].push((call) => held.then(() => w.server.state.scholarRoutes.turn(call.body, call.sub)));
  return () => release();
}

// A conversation and its messages, written on the server as scholar-turn writes them.
function seedConversation(w, { id = CONV, sub = "user_a", heavy = false, entryId = null, messages = [], title } = {}) {
  const at = stamp(clock.now);
  w.server.state.scholarConversations.push({
    id,
    user_id: sub,
    entry_id: entryId,
    title: title === undefined ? (heavy ? null : "A question about peace") : title,
    is_heavy: heavy,
    last_message_at: at,
    created_at: at,
  });
  for (const message of messages) {
    w.server.state.scholarMessages.push({
      conversation_id: id,
      user_id: sub,
      reply_to: null,
      input_type: message.role === "user" ? "text" : null,
      status: "ready",
      error_code: null,
      is_heavy: heavy,
      claimed_at: null,
      created_at: stamp(clock.now),
      ...message,
    });
  }
}

// The free conversation (2026-11-20), already claimed by another conversation: an account that is not Pro is then told by its
// plan in every other one, as scholar-turn does.
function freeUsedElsewhere(w, { sub = "user_a", messages = 2 } = {}) {
  const at = stamp(clock.now);
  w.server.state.scholarFreeUse.push({ user_id: sub, conversation_id: OTHER_CONV, messages, created_at: at, updated_at: at });
}

const userRow = (n, words, extra = {}) => ({ id: mid(n), role: "user", content: { blocks: [{ type: "text", text: words }] }, ...extra });
const answerRow = (n, to, extra = {}) => ({
  id: mid(n),
  role: "scholar",
  reply_to: mid(to),
  content: { blocks: [{ type: "text", text: "An answer." }] },
  ...extra,
});

// ================================================================== the gateway and the repository
async function dataChecks() {
  await test("gateway: a turn carries exactly the contract and the phone's region, in the database's region, and answers it", async (w) => {
    const result = await repo(w).sendTurn(text(QUESTION));
    assert.equal(result.ok, true);
    const [call] = calls(w, "scholar-turn");
    assert.deepEqual(Object.keys(call.body).sort(), ["conversationId", "input", "messageId", "region"]);
    const expected = w.use("@/utils/region").deviceRegionCode();
    assert.match(String(expected), /^[A-Z]{2}$/, "this machine's locale has a region");
    assert.equal(call.body.region, expected, "the phone's region rides along");
    assert.equal(call.headers["x-region"], "us-east-1", "the call runs in the database's region");
    assert.equal(call.sub, "user_a", "the caller is the session's, never a body field");
    const { conversation, message, answer, usage } = result.data;
    assert.equal(conversation.id, CONV);
    assert.equal(message.id, mid(1));
    assert.equal(answer.replyTo, mid(1));
    assert.equal(answer.blocks[0].type, "passage");
    assert.equal(answer.blocks[0].scripture.verified, true);
    assert.equal(answer.blocks[0].scripture.translation, "BSB");
    // A Pro account's credits: the message cost 4 of the 400, and the window renews 24 hours after this first spend.
    assert.deepEqual(
      { kind: usage.kind, used: usage.used, limit: usage.limit, remaining: usage.remaining },
      { kind: "credits", used: 4, limit: 400, remaining: 396 },
    );
    assert.ok(Math.abs(Date.parse(usage.resetsAt) - (BASE + 86_400_000)) < 1_000, "the window renews in 24 hours");
    // The function answers with PostgREST's microseconds; the app keeps three digits and a Z, as every server time.
    for (const time of [conversation.createdAt, conversation.lastMessageAt, message.createdAt, answer.createdAt]) {
      assert.match(time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `a time the phone can read: ${time}`);
    }
  });

  await test("gateway: an answer that is not the contract is UNKNOWN, and a 402 carries the plan or the credits", async (w) => {
    w.server.state.functions["scholar-turn"].push(() => json(200, { conversation: { id: CONV }, answer: "nonsense" }));
    const odd = await repo(w).sendTurn(text(QUESTION));
    assert.equal(odd.ok, false);
    assert.equal(odd.code, "UNKNOWN");
    const numbers = (result) => ({
      kind: result.usage.kind,
      used: result.usage.used,
      limit: result.usage.limit,
      remaining: result.usage.remaining,
      resetsAt: result.usage.resetsAt,
    });
    // The free plan, its free conversation used in another one: Scholar is part of Pro, with no numbers and no day it opens.
    w.server.state.serverPlans.user_a = "free";
    freeUsedElsewhere(w);
    const free = await repo(w).sendTurn(text(QUESTION, 2));
    assert.equal(free.ok, false);
    assert.equal(free.code, "LIMIT_REACHED");
    assert.deepEqual(numbers(free), { kind: "scholar_plan", used: 0, limit: 0, remaining: 0, resetsAt: null });
    // A free trial: the same refusal, with the day its plan begins.
    const ends = new Date(BASE + 3 * 86_400_000).toISOString();
    w.server.state.serverPlans.user_a = "trial";
    w.server.state.serverPlanEnds.user_a = ends;
    const trial = await repo(w).sendTurn(text(QUESTION, 3));
    assert.equal(trial.code, "LIMIT_REACHED");
    assert.equal(trial.usage.kind, "scholar_plan");
    assert.equal(Date.parse(trial.usage.resetsAt), Date.parse(ends), "Scholar opens when the plan begins");
    // Pro with every credit of the window spent: the credits, and when they renew.
    w.server.state.serverPlans.user_a = "pro";
    w.server.state.scholarCreditRows.push({
      user_id: "user_a",
      used: 400,
      allowance: 400,
      renews_at: stamp(BASE + 3_600_000),
      updated_at: stamp(BASE),
    });
    const out = await repo(w).sendTurn(text(QUESTION, 4));
    assert.equal(out.code, "LIMIT_REACHED");
    const left = numbers(out);
    assert.deepEqual(
      { kind: left.kind, used: left.used, limit: left.limit, remaining: left.remaining },
      { kind: "credits", used: 400, limit: 400, remaining: 0 },
    );
    assert.ok(Math.abs(Date.parse(left.resetsAt) - (BASE + 3_600_000)) < 1_000, "they renew in an hour");
  });

  await test("gateway: a typed turn gives up after 45 seconds and a spoken one after 60, as NETWORK", async (w) => {
    w.server.state.gate = new Promise(() => undefined);
    const typed = repo(w).sendTurn(text(QUESTION));
    await advance(44_000);
    let settled = false;
    void typed.then(() => (settled = true));
    await settle();
    assert.equal(settled, false, "still waiting at 44 seconds");
    await advance(2_000);
    assert.equal((await typed).code, "NETWORK");
    const spoken = repo(w).sendTurn(
      { conversationId: CONV, messageId: mid(2), input: { type: "audio", durationMs: 5000 } },
      { uri: "file:///recordings/chat-x.m4a" },
    );
    let spokenSettled = false;
    void spoken.then(() => (spokenSettled = true));
    await advance(50_000);
    assert.equal(spokenSettled, false, "a spoken message waits longer: the server transcribes it first");
    await advance(11_000);
    assert.equal((await spoken).code, "NETWORK");
  });

  await test("repository: offline, nothing is sent and the turn says OFFLINE", async (w) => {
    offline(w);
    const result = await repo(w).sendTurn(text(QUESTION));
    assert.deepEqual(result, { ok: false, code: "OFFLINE", usage: null });
    assert.equal(repo(w).canReachScholar(), false);
    assert.equal(calls(w, "scholar-turn").length, 0);
    const listen = await repo(w).speak(mid(9), 0);
    assert.equal(listen.code, "OFFLINE");
    assert.equal(calls(w, "scholar-speak").length, 0);
  });

  await test("repository: a spoken message is uploaded once as chat-{id}, its take deleted, and sent again uploads nothing", async (w) => {
    const take = { uri: `file:///recordings/chat-${mid(3)}.m4a` };
    w.recordings.files.set(`chat-${mid(3)}`, clock.now);
    const request = { conversationId: CONV, messageId: mid(3), input: { type: "audio", durationMs: 6000 } };
    w.upload.script.push({ ok: false, code: "NETWORK" });
    const failed = await repo(w).sendTurn(request, take);
    assert.equal(failed.code, "UPLOAD_FAILED", "a failed upload is its own code, and nothing is sent");
    assert.equal(calls(w, "scholar-turn").length, 0);
    assert.ok(w.recordings.files.has(`chat-${mid(3)}`), "and the take stays on the phone for Try again");
    const first = await repo(w).sendTurn(request, take);
    assert.equal(first.ok, true);
    assert.deepEqual(w.upload.calls.map((call) => call.id), [`chat-${mid(3)}`, `chat-${mid(3)}`]);
    assert.equal(w.recordings.files.has(`chat-${mid(3)}`), false, "the take is deleted once the bucket has it");
    assert.equal(first.data.message.inputType, "audio");
    assert.ok(first.data.message.blocks[0].text.length > 0, "the answer carries the words that were heard");
    const again = await repo(w).sendTurn(request, take);
    assert.equal(again.ok, true, "the server replays the answer it has");
    assert.equal(w.upload.calls.length, 2, "no third upload");
    assert.equal(again.data.answer.id, first.data.answer.id);
  });

  await test("repository: conversations newest first and messages oldest first, with the user filter and explicit columns", async (w) => {
    clock.now = BASE - 60_000;
    seedConversation(w, { id: mid(80), messages: [userRow(81, "older question"), answerRow(82, 81)] });
    clock.now = BASE;
    seedConversation(w, { id: CONV, messages: [userRow(1, "first"), answerRow(2, 1)] });
    seedConversation(w, { id: mid(90), sub: "user_b", messages: [userRow(91, "someone else's")] });
    const list = await repo(w).listConversations({ limit: 30 });
    assert.equal(list.ok, true);
    assert.deepEqual(list.data.conversations.map((item) => item.id), [CONV, mid(80)], "only this account's, the newest first");
    assert.equal(list.data.nextCursor, null, "two conversations fit one page");
    const one = await repo(w).getConversation(CONV);
    assert.deepEqual(one.data.messages.map((message) => message.id), [mid(1), mid(2)]);
    const foreign = await repo(w).getConversation(mid(90));
    assert.equal(foreign.data.conversation, null, "another account's conversation is not there");
    const queries = w.server.state.requests.filter((r) => r.path.startsWith("/rest/v1/scholar_"));
    assert.ok(queries.length >= 4);
    for (const query of queries) {
      const select = new URLSearchParams(query.search).get("select") ?? "";
      assert.ok(!select.includes("claimed_at"), "claimed_at is never read");
    }
  });

  await test("repository: a welcome is read from a saved answer and from the function's answer; an answer with no field is none", async (w) => {
    seedConversation(w, {
      id: CONV,
      messages: [
        userRow(1, "Hello"),
        answerRow(2, 1, { content: { blocks: [{ type: "text", text: "Welcome." }], welcome: true } }),
        userRow(3, "And then?"),
        answerRow(4, 3),
      ],
    });
    // A heavy answer is never a welcome, whatever its content says.
    seedConversation(w, {
      id: mid(50),
      heavy: true,
      messages: [
        userRow(51, "x"),
        answerRow(52, 51, { content: { blocks: [{ type: "text", text: "Here." }], welcome: true, help: "crisis" } }),
      ],
    });
    const saved = await repo(w).getConversation(CONV);
    assert.deepEqual(saved.data.messages.map((message) => message.welcome), [false, true, false, false]);
    const heavy = await repo(w).getConversation(mid(50));
    assert.deepEqual(heavy.data.messages.map((message) => message.welcome), [false, false]);
    const hello = await repo(w).sendTurn(text("HELLO there", 60, { conversationId: mid(61) }));
    assert.equal(hello.ok, true);
    assert.equal(hello.data.answer.welcome, true);
    assert.equal(hello.data.message.welcome, false);
    assert.equal(hello.data.conversation.title, null, "a welcome leaves the conversation untitled");
    // The fake sends no field on an ordinary answer, as a function from before scholar-v3: it reads as none, not undefined.
    const plain = await repo(w).sendTurn(text(QUESTION, 62, { conversationId: mid(61) }));
    assert.equal(plain.ok, true);
    assert.equal(plain.data.answer.welcome, false);
    assert.equal(plain.data.conversation.title, "A question about peace", "the next answer titles it");
  });

  await test("repository: deleting a conversation deletes its messages; offline it sends nothing", async (w) => {
    seedConversation(w, { messages: [userRow(1, "first"), answerRow(2, 1)] });
    offline(w);
    const refused = await repo(w).deleteConversation(CONV);
    assert.equal(refused.ok, false);
    assert.equal(w.server.state.scholarConversations.length, 1, "offline, nothing was sent");
    w.use("@/store/offlineStore").useOfflineStore.getState().setNet(true, true);
    const done = await repo(w).deleteConversation(CONV);
    assert.equal(done.ok, true);
    assert.equal(w.server.state.scholarConversations.length, 0);
    assert.equal(w.server.state.scholarMessages.length, 0, "its messages went with it");
  });

  await test("repository: the mock data answers every outcome without a request", async (w) => {
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    // A Pro account on the mock plan: the credits below are Pro's (the free conversation has a check of its own).
    w.use("@/data/journalRepository").setMockSubscriptionTier("pro");
    const mock = w.use("@/data/mock/scholar");
    mock.resetMockScholar();
    const dev = w.use("@/store/devStore").useDevStore;
    // The mock waits a moment, as the server would, on the virtual clock.
    const viaMock = async (promise) => {
      await advance(1_300);
      return promise;
    };
    assert.equal(await repo(w).readScholarCredits(), null, "no credits before the first spend");
    const ready = await viaMock(repo(w).sendTurn(text(QUESTION)));
    assert.equal(ready.ok, true);
    assert.deepEqual([ready.data.usage.kind, ready.data.usage.remaining], ["credits", 396], "a message spends the mock's credits");
    assert.equal((await repo(w).readScholarCredits()).remaining, 396, "and the credits read back the same");
    dev.getState().setNextScholarOutcome("heavy");
    const heavy = await viaMock(repo(w).sendTurn(text("a hard night", 2)));
    assert.equal(heavy.data.answer.helpLine, "crisis");
    assert.equal(heavy.data.usage, null, "a heavy conversation has no count");
    dev.getState().setNextScholarOutcome("resting");
    const resting = await viaMock(repo(w).sendTurn(text(QUESTION, 3, { conversationId: mid(70) })));
    assert.equal(resting.code, "SCHOLAR_UNAVAILABLE");
    assert.equal(dev.getState().nextScholarOutcome, "ready", "the outcome is used once");
    dev.getState().setNextScholarOutcome("plan");
    const plan = await viaMock(repo(w).sendTurn(text(QUESTION, 4, { conversationId: mid(71) })));
    assert.equal(plan.code, "LIMIT_REACHED");
    assert.deepEqual([plan.usage.kind, plan.usage.resetsAt], ["scholar_plan", null], "the free plan");
    dev.getState().setNextScholarOutcome("trial");
    const trial = await viaMock(repo(w).sendTurn(text(QUESTION, 5, { conversationId: mid(72) })));
    assert.equal(trial.usage.kind, "scholar_plan");
    assert.ok(Date.parse(trial.usage.resetsAt) > clock.now, "a trial is told the day its plan begins");
    dev.getState().setNextScholarOutcome("limit");
    const limit = await viaMock(repo(w).sendTurn(text(QUESTION, 6, { conversationId: mid(73) })));
    assert.deepEqual([limit.code, limit.usage.kind, limit.usage.remaining], ["LIMIT_REACHED", "credits", 0], "no credit left");
    assert.equal(calls(w, "scholar-turn").length, 0, "the mock never reaches the server");
    assert.equal(w.server.state.requests.filter((r) => r.path === "/rest/v1/scholar_credits").length, 0, "nor its credits");
    mock.resetMockScholar();
  });

  await test("repository: the credits are read for this account, as the server holds them, and none once the window has ended", async (w) => {
    assert.equal(await repo(w).readScholarCredits(), null, "no row, no credits");
    w.server.state.scholarCreditRows.push(
      { user_id: "user_b", used: 9, allowance: 400, renews_at: "2026-10-25T20:00:00.123456+00:00", updated_at: stamp(BASE) },
      { user_id: "user_a", used: 120, allowance: 400, renews_at: "2026-10-25T18:00:00.123456+00:00", updated_at: stamp(BASE) },
    );
    assert.deepEqual(await repo(w).readScholarCredits(), {
      kind: "credits",
      used: 120,
      limit: 400,
      remaining: 280,
      resetsAt: "2026-10-25T18:00:00.123Z",
    });
    const reads = w.server.state.requests.filter((r) => r.path === "/rest/v1/scholar_credits");
    const params = new URLSearchParams(reads[reads.length - 1].search);
    assert.equal(params.get("select"), "used,allowance,renews_at", "the explicit columns, never user_id");
    assert.equal(params.get("user_id"), "eq.user_a", "only this account's row");
    clock.now = Date.parse("2026-10-25T18:00:01Z");
    assert.equal(await repo(w).readScholarCredits(), null, "a window that has ended is a whole allowance: nothing to show");
  });
}

// ================================================================== the Conversations screen (2026-11-16)
// `count` conversations on the server, number 0 the newest and each `step` ms older than the one before it.
function seedMany(w, count, { title = (i) => `Conversation ${i}`, step = 60_000, heavyAt = [] } = {}) {
  for (let i = 0; i < count; i += 1) {
    clock.now = BASE - i * step;
    seedConversation(w, { id: mid(1000 + i), title: title(i), heavy: heavyAt.includes(i) });
  }
  clock.now = BASE;
}

// The screen's hook with a search the check can type into, as the screen's own field does.
function renderHistory(w, initial = "") {
  const react = w.use("react");
  const { useScholarHistory } = w.use("@/hooks/useScholarHistory");
  return w.renderHook(() => {
    const [query, setQuery] = react.useState(initial);
    return { query, setQuery, ...useScholarHistory(query) };
  });
}

async function untilHistory(handle, predicate, label, rounds = 120) {
  for (let i = 0; i < rounds; i += 1) {
    const current = handle.result.current;
    if (predicate(current.state, current)) return current;
    await settle(2);
  }
  const { state } = handle.result.current;
  assert.fail(`${label}: never reached (phase ${state.phase}, ${state.conversations?.length} loaded)`);
}

// The list requests the app made for the conversations (not the single-conversation reads), as their query strings.
const listRequests = (w) =>
  w.server.state.requests
    .filter((r) => r.path === "/rest/v1/scholar_conversations" && new URLSearchParams(r.search).get("order") !== null)
    .map((r) => new URLSearchParams(r.search));

async function historyChecks() {
  await test("history: 65 conversations load 30 at a time as the list is scrolled, once at a time, none repeated and none missed", async (w) => {
    seedMany(w, 65);
    const handle = renderHistory(w);
    let current = await untilHistory(handle, (s) => s.phase === "ready", "the first page");
    assert.equal(current.state.conversations.length, 30);
    assert.notEqual(current.state.nextCursor, null, "more follow");
    assert.equal(listRequests(w).length, 1);
    assert.equal(listRequests(w)[0].get("limit"), "31", "one more than a page, to know whether another follows");
    assert.equal(listRequests(w)[0].get("user_id"), "eq.user_a", "only this account's");
    // Two calls at once (the list can ask twice while a page is on its way) are one request.
    current.loadMore();
    current.loadMore();
    current = await untilHistory(handle, (s) => s.phase === "ready" && s.conversations.length === 60 && !s.loadingMore, "the second page");
    assert.equal(listRequests(w).length, 2, "two quick calls made one request");
    const lastOfFirstPage = w.server.state.scholarConversations.find((row) => row.id === mid(1029)).last_message_at;
    assert.equal(
      listRequests(w)[1].get("last_message_at"),
      `lt.${lastOfFirstPage}`,
      "the next page starts after the last row as the server wrote its time, microseconds and all",
    );
    current.loadMore();
    current = await untilHistory(handle, (s) => s.phase === "ready" && s.conversations.length === 65 && !s.loadingMore, "the last page");
    assert.equal(current.state.nextCursor, null, "nothing follows the last page");
    assert.deepEqual(
      current.state.conversations.map((conversation) => conversation.id),
      Array.from({ length: 65 }, (_, i) => mid(1000 + i)),
      "newest first, none repeated and none missed across three pages",
    );
    current.loadMore();
    await settle(6);
    assert.equal(listRequests(w).length, 3, "at the end, scrolling asks for nothing");
  });

  await test("history: a page that fails keeps the list and says so, and asking again loads it", async (w) => {
    seedMany(w, 40);
    const handle = renderHistory(w);
    let current = await untilHistory(handle, (s) => s.phase === "ready", "the first page");
    w.server.state.offline = true;
    current.loadMore();
    current = await untilHistory(handle, (s) => s.phase === "ready" && s.moreFailed, "the failed page");
    assert.equal(current.state.conversations.length, 30, "the list stays");
    assert.equal(current.state.loadingMore, false);
    w.server.state.offline = false;
    current.loadMore();
    current = await untilHistory(handle, (s) => s.phase === "ready" && s.conversations.length === 40 && !s.moreFailed, "the retried page");
    assert.equal(current.state.nextCursor, null);
  });

  await test("history: a first load that fails is the error state, and Try again loads the list", async (w) => {
    seedMany(w, 3);
    w.server.state.offline = true;
    const handle = renderHistory(w);
    let current = await untilHistory(handle, (s) => s.phase === "error", "the error state");
    w.server.state.offline = false;
    current.retry();
    current = await untilHistory(handle, (s) => s.phase === "ready", "the list after Try again");
    assert.equal(current.state.conversations.length, 3);
  });

  await test("history: a search waits for the typing to pause, matches titles case-insensitively with % and _ taken literally, and never matches a conversation with no title", async (w) => {
    const titles = [
      "Peace in the storm",
      "A peaceful morning",
      "Hope for tomorrow",
      "100% sure",
      "1000 sure",
      "a_b",
      "axb",
      null,
    ];
    seedMany(w, titles.length, { title: (i) => titles[i], heavyAt: [7] });
    const handle = renderHistory(w);
    let current = await untilHistory(handle, (s) => s.phase === "ready" && s.conversations.length === 8, "everything");
    assert.equal(current.state.conversations.length, 8, "a conversation with no title is listed when nothing is searched");
    assert.equal(listRequests(w)[0].get("title"), null, "no search, no title filter");
    const before = listRequests(w).length;

    handle.result.current.setQuery("pea");
    await advance(300);
    assert.equal(handle.result.current.applied, "", "not applied while the person is still typing");
    handle.result.current.setQuery("peac");
    await advance(300);
    assert.equal(listRequests(w).length, before, "typing again starts the wait over: still no request");
    await advance(100);
    current = await untilHistory(handle, (s, c) => c.applied === "peac" && s.phase === "ready" && s.conversations.length === 2, "the search for peac");
    assert.equal(listRequests(w).length, before + 1, "one request for the whole word");
    assert.equal(listRequests(w).at(-1).get("title"), "ilike.%peac%");
    assert.deepEqual(current.state.conversations.map((c) => c.id), [mid(1000), mid(1001)]);

    const search = async (words, expectIds, label) => {
      handle.result.current.setQuery(words);
      await advance(400);
      const found = await untilHistory(
        handle,
        (s, c) => c.applied === words.trim() && s.phase === "ready" && s.conversations.length === expectIds.length,
        label,
      );
      assert.deepEqual(found.state.conversations.map((c) => c.id), expectIds, label);
      return found;
    };
    await search("PEACE", [mid(1000), mid(1001)], "upper case finds the same two");
    assert.equal(listRequests(w).at(-1).get("title"), "ilike.%PEACE%");
    await search("100%", [mid(1003)], "a percent sign is a percent sign, so 1000 sure is not found");
    assert.equal(listRequests(w).at(-1).get("title"), "ilike.%100\\%%");
    await search("a_b", [mid(1005)], "an underscore is an underscore, so axb is not found");
    const noMatch = await search("zzz", [], "nothing matches");
    assert.equal(noMatch.applied, "zzz", "the screen says what it searched for");
    const withE = await search("e", [mid(1000), mid(1001), mid(1002), mid(1003), mid(1004)], "a letter");
    assert.ok(!withE.state.conversations.some((c) => c.id === mid(1007)), "a conversation with no title is never a match");
    const all = await search("   ", Array.from({ length: 8 }, (_, i) => mid(1000 + i)), "spaces are no search at all");
    assert.equal(all.applied, "");
    assert.equal(listRequests(w).at(-1).get("title"), null, "and no title filter is sent");
  });

  await test("history: deleting takes the conversation off the list and the server; offline it says so and sends nothing", async (w) => {
    seedMany(w, 3);
    const handle = renderHistory(w);
    const current = await untilHistory(handle, (s) => s.phase === "ready", "the list");
    assert.equal(await current.deleteOne(mid(1001)), "ok");
    assert.deepEqual(
      handle.result.current.state.conversations.map((c) => c.id),
      [mid(1000), mid(1002)],
      "the row is gone from the screen",
    );
    assert.deepEqual(w.server.state.scholarConversations.map((c) => c.id), [mid(1000), mid(1002)], "and from the server");
    const deletes = () => w.server.state.requests.filter((r) => r.method === "DELETE").length;
    assert.equal(deletes(), 1);
    offline(w);
    assert.equal(await handle.result.current.deleteOne(mid(1000)), "offline");
    assert.equal(handle.result.current.state.conversations.length, 2, "the row stays");
    assert.equal(deletes(), 1, "nothing was sent");
  });

  await test("history: the first page of a refresh is merged into the pages already loaded, and the helpers group, search and page as the screen needs", async (w) => {
    const h = w.use("@/utils/scholarHistory");
    const at = (hour) => `2026-11-10T${String(hour).padStart(2, "0")}:00:00.000Z`;
    const row = (id, hour) => ({ id, title: id, lastMessageAt: at(hour) });
    const previous = { conversations: [row("P1", 6), row("P2", 5), row("P3", 4), row("P4", 3), row("P5", 2), row("P6", 1)], nextCursor: "after-P6" };
    // A new conversation on top, P2 deleted meanwhile (it is inside what the page covers, so it drops out), and the older
    // pages already scrolled to are kept below with their own cursor.
    const merged = h.mergeFirstPage(previous, { conversations: [row("N0", 7), row("P1", 6), row("P3", 4)], nextCursor: "after-P3" });
    assert.deepEqual(merged.conversations.map((c) => c.id), ["N0", "P1", "P3", "P4", "P5", "P6"]);
    assert.equal(merged.nextCursor, "after-P6");
    // A page that is the whole list replaces everything: the older rows no longer exist.
    const whole = h.mergeFirstPage(previous, { conversations: [row("P1", 6)], nextCursor: null });
    assert.deepEqual(whole.conversations.map((c) => c.id), ["P1"]);
    assert.equal(whole.nextCursor, null);
    // Nothing older was loaded: the page is the list, with its own cursor.
    const same = h.mergeFirstPage({ conversations: [row("P1", 6), row("P2", 5)], nextCursor: "x" }, { conversations: [row("N0", 7), row("P1", 6), row("P2", 5)], nextCursor: "after-P2" });
    assert.deepEqual(same.conversations.map((c) => c.id), ["N0", "P1", "P2"]);
    assert.equal(same.nextCursor, "after-P2");
    const appended = h.appendPage(
      { conversations: [row("A", 9), row("B", 8)], nextCursor: "c1" },
      { conversations: [row("B", 8), row("C", 7)], nextCursor: "c2" },
    );
    assert.deepEqual(appended.conversations.map((c) => c.id), ["A", "B", "C"], "a row that arrives twice is listed once");
    assert.equal(appended.nextCursor, "c2");

    assert.equal(h.likePattern(""), null);
    assert.equal(h.likePattern("   "), null);
    assert.equal(h.likePattern("peace"), "%peace%");
    assert.equal(h.likePattern("  100%_\\ "), "%100\\%\\_\\\\%", "the pattern's own characters are made literal");
    assert.equal(h.likePattern("a".repeat(70)), `%${"a".repeat(60)}%`, "a title is at most 60 characters");
    assert.equal(h.likePattern(`${"a".repeat(59)} ${"b".repeat(5)}`), `%${"a".repeat(59)}%`, "the cut never leaves a trailing space");

    const now = new Date("2026-11-16T15:00:00.000Z");
    const conversation = (id, iso, title = id) => ({ id, title, lastMessageAt: iso });
    const items = h.groupConversations(
      [
        conversation("future", "2026-11-17T01:00:00.000Z"),
        conversation("today", "2026-11-16T09:15:00.000Z"),
        conversation("yesterday", "2026-11-15T20:05:00.000Z"),
        conversation("fri", "2026-11-13T15:50:00.000Z"),
        conversation("fri2", "2026-11-12T10:00:00.000Z"),
        conversation("sevenDays", "2026-11-09T07:00:00.000Z"),
        conversation("eightDays", "2026-11-08T07:00:00.000Z"),
        conversation("october", "2026-10-21T07:15:00.000Z", null),
        conversation("lastYear", "2025-12-31T23:30:00.000Z"),
      ],
      now,
      (iso) => `day:${iso}`,
    );
    assert.deepEqual(
      items.filter((item) => item.kind === "header").map((item) => item.title),
      ["Today", "Yesterday", "Previous 7 days", "November 2026", "October 2026", "December 2025"],
      "a clock skewed into the future is still today; seven days ago is still the week, eight is a month",
    );
    assert.equal(new Set(items.map((item) => item.key)).size, items.length, "every key is its own");
    const rows = Object.fromEntries(items.filter((item) => item.kind === "row").map((item) => [item.key, item]));
    assert.equal(rows.today.time, "9:15 AM", "under Today the heading says the day, so a row shows the clock");
    assert.equal(rows.yesterday.time, "8:05 PM");
    assert.equal(rows.fri.time, "Fri, 3:50 PM", "under the week, the weekday and the clock");
    assert.equal(rows.sevenDays.time, "Mon, 7:00 AM");
    assert.equal(rows.eightDays.time, "Nov 8, 7:00 AM", "under a month, the date and the clock");
    assert.equal(rows.lastYear.time, "Dec 31, 11:30 PM");
    assert.equal(rows.today.label, "today, day:2026-11-16T09:15:00.000Z", "a screen reader hears the title and the full day");
    assert.equal(rows.october.label, "A conversation with Scholar, day:2026-10-21T07:15:00.000Z", "no title is the plain name");
    assert.deepEqual(h.groupConversations([], now, (iso) => iso), []);
    // Each heading is followed by its rows, newest first, never two headings in a row.
    for (let i = 1; i < items.length; i += 1) assert.ok(!(items[i - 1].kind === "header" && items[i].kind === "header"));
  });

  await test("history: the copy keeps typographic quotes and says no more than the app does", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const strings = [];
    const walk = (value) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") strings.push(value("peace"), value("A title", "Today, 5:36 PM"));
      else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(copy.scholar.history);
    assert.ok(strings.length > 15);
    for (const s of strings) {
      assert.ok(!s.includes("'"), `a straight apostrophe: ${s}`);
      assert.ok(!s.includes('"'), `a straight quote: ${s}`);
      assert.ok(!/Gracehush/.test(s), `the old spelling: ${s}`);
      assert.ok(!/confidential|private|guarantee|encrypted|delete.*automatic/i.test(s), `a claim the app cannot make: ${s}`);
    }
    assert.equal(copy.scholar.history.noResults("peace"), "No conversations match “peace”.");
    assert.equal(copy.scholar.history.title, "Conversations");
    assert.equal(copy.scholar.history.seeAll, "See all");
  });

  await test("tab: the Scholar tab asks for the three latest and knows whether more exist", async (w) => {
    seedMany(w, 5);
    const { useScholarHome } = w.use("@/hooks/useScholarHome");
    const handle = w.renderHook(useScholarHome);
    const current = await until(handle, (c) => c.state.phase === "ready", "the tab's list");
    assert.deepEqual(current.state.conversations.map((c) => c.id), [mid(1000), mid(1001), mid(1002)], "the three newest");
    assert.equal(current.state.hasMore, true, "two more are behind See all");
    assert.equal(listRequests(w)[0].get("limit"), "4", "one more than shown, to know whether more follow");
  });

  await test("tab: exactly three conversations leave no See all", async (w) => {
    seedMany(w, 3);
    const { useScholarHome } = w.use("@/hooks/useScholarHome");
    const handle = w.renderHook(useScholarHome);
    const current = await until(handle, (c) => c.state.phase === "ready", "the tab's list");
    assert.equal(current.state.conversations.length, 3);
    assert.equal(current.state.hasMore, false);
  });

  await test("history: the mock data pages and searches like the server, without a request", async (w) => {
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    // Pro on the mock plan: three conversations answered (a free account has one).
    w.use("@/data/journalRepository").setMockSubscriptionTier("pro");
    const mock = w.use("@/data/mock/scholar");
    mock.resetMockScholar();
    for (let n = 0; n < 3; n += 1) {
      const sent = repo(w).sendTurn(text(`${QUESTION} ${n}`, 10 + n, { conversationId: mid(100 + n) }));
      await advance(1_300);
      assert.equal((await sent).ok, true);
    }
    const viaMock = async (promise) => {
      await advance(400);
      return promise;
    };
    const first = await viaMock(repo(w).listConversations({ limit: 2 }));
    assert.equal(first.data.conversations.length, 2);
    assert.notEqual(first.data.nextCursor, null);
    const second = await viaMock(repo(w).listConversations({ limit: 2, cursor: first.data.nextCursor }));
    assert.equal(second.data.conversations.length, 1);
    assert.equal(second.data.nextCursor, null);
    const none = await viaMock(repo(w).listConversations({ limit: 5, query: "zzzz" }));
    assert.deepEqual(none.data.conversations, []);
    const spaces = await viaMock(repo(w).listConversations({ limit: 5, query: "   " }));
    assert.equal(spaces.data.conversations.length, 3, "spaces are no search");
    assert.equal(listRequests(w).length, 0, "the mock never reaches the server");
    mock.resetMockScholar();
  });
}

// ================================================================== the conversation
async function conversationChecks() {
  await test("conversation: a typed message shows at once, waits, then its answer comes; one turn at a time", async (w) => {
    const release = holdTurn(w);
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    assert.equal(handle.result.current.send(QUESTION), true);
    const waiting = await until(handle, (s) => s.sending, "waiting");
    assert.equal(waiting.messages.length, 1, "the person's message is on the screen at once");
    assert.equal(waiting.messages[0].status, "pending");
    assert.ok(waiting.rows.some((row) => row.kind === "waiting"), "with the waiting row under it");
    assert.equal(waiting.send("a second question"), false, "one turn at a time");
    release();
    const answered = await until(handle, (s) => !s.sending && s.messages.length === 2, "the answer");
    assert.equal(answered.messages[1].role, "scholar");
    assert.equal(answered.conversation.id, answered.conversationId, "the server's conversation is kept");
    assert.deepEqual(answered.fresh, [answered.messages[1].id], "the answer arrived during this visit");
    assert.equal(calls(w, "scholar-turn").length, 1);
    handle.unmount();
  });

  await test("conversation: a failure keeps the message with Try again, which sends the same id; the composer stays open", async (w) => {
    w.server.state.functions["scholar-turn"].push(() => json(503, { error: { code: "AI_UNAVAILABLE", message: "x", requestId: "r" } }));
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    handle.result.current.send(QUESTION);
    const failed = await until(handle, (s) => !s.sending && s.messages[0]?.status === "failed", "the failure");
    const row = failed.rows.find((item) => item.kind === "user");
    assert.equal(row.failure, "generic", "Scholar couldn’t answer just now, with Try again");
    const id = failed.messages[0].id;
    failed.retry(id);
    const answered = await until(handle, (s) => !s.sending && s.messages.length === 2, "the retried answer");
    assert.equal(answered.messages[0].id, id, "the same id");
    const sent = calls(w, "scholar-turn").map((call) => call.body.messageId);
    assert.deepEqual(sent, [id, id]);
    assert.equal(answered.send("and another"), true, "the composer was never blocked");
    await until(handle, (s) => !s.sending && s.messages.length === 4, "its answer");
    handle.unmount();
  });

  await test("conversation: the person's own messages are marked sent this visit, apart from the answers, and a failed turn announces nothing", async (w) => {
    w.server.state.functions["scholar-turn"].push(() => json(503, { error: { code: "AI_UNAVAILABLE", message: "x", requestId: "r" } }));
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    assert.deepEqual(handle.result.current.sentIds, [], "nothing sent yet");
    handle.result.current.send(QUESTION);
    const failed = await until(handle, (s) => !s.sending && s.messages[0]?.status === "failed", "the failure");
    assert.deepEqual(failed.sentIds, [failed.messages[0].id], "the message fades in when it is sent");
    assert.deepEqual(failed.fresh, [], "no answer arrived, so no answer is announced");
    failed.retry(failed.messages[0].id);
    const answered = await until(handle, (s) => !s.sending && s.messages.length === 2, "the retried answer");
    assert.deepEqual(answered.sentIds, [answered.messages[0].id], "a retry does not list the message twice");
    assert.deepEqual(answered.fresh, [answered.messages[1].id], "the answer is the one that is announced");
    handle.unmount();
  });

  await test("conversation: credits run low, then out: the countdown moves, the message waits with Try again, and renewal clears it", async (w) => {
    // 316 of the 400 spent, the window renewing in 25 minutes.
    w.server.state.scholarCreditRows.push({
      user_id: "user_a",
      used: 316,
      allowance: 400,
      renews_at: "2026-10-25T12:25:00.000000+00:00",
      updated_at: stamp(BASE),
    });
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    handle.result.current.send("one");
    let state = await until(handle, (s) => !s.sending && s.messages.length === 2, "the first answer");
    assert.deepEqual(state.creditsLow, { percent: 20, renewsInMinutes: 25 }, "80 of 400 left: the line above the composer");
    assert.equal(state.creditsOut, null);
    w.server.state.scholarCreditRows[0].used = 400;
    assert.equal(state.send("two"), true, "the composer still sends: the server screens it first");
    state = await until(handle, (s) => !s.sending && s.creditsOut !== null, "no credit left");
    assert.equal(state.creditsOut, 25, "the minutes until they renew");
    assert.equal(state.creditsLow, null);
    assert.equal(state.notice, null, "the credits say it, not a notice of their own");
    const held = state.rows.filter((row) => row.kind === "user").pop();
    assert.equal(held.failure, "limit", "only Try again");
    // The countdown is one repeating timer of SCHOLAR_CREDITS_TICK_MS while the window runs, and it stops once they renew.
    const tick = w.use("@/constants/app").SCHOLAR_CREDITS_TICK_MS;
    const countdowns = () => [...clock.timers.values()].filter((timer) => timer.repeat && timer.ms === tick).length;
    await advance(12 * 60_000);
    assert.equal(handle.result.current.creditsOut, 13, "the countdown moves while the screen is open");
    const running = countdowns();
    assert.ok(running >= 1, "the countdown ticks while the window runs");
    await advance(13 * 60_000);
    assert.equal(handle.result.current.creditsOut, null, "renewed: the old window's numbers are gone");
    assert.equal(handle.result.current.creditsLow, null);
    assert.equal(countdowns(), running - 1, "renewed: the countdown stops ticking");
    handle.result.current.retry(held.message.id);
    state = await until(handle, (s) => !s.sending && s.messages.length === 4, "the held message, answered");
    assert.equal(state.messages[2].id, held.message.id, "the same message, answered from a fresh window");
    assert.equal(state.creditsLow, null, "396 of 400 left: no line");
    handle.unmount();
  });

  await test("conversation: outside Pro a message is kept with Try again: the free plan sees the plans, a trial the day Scholar opens", async (w) => {
    w.server.state.serverPlans.user_a = "free";
    // Its free conversation was another one (2026-11-20): this one is told by the plan.
    freeUsedElsewhere(w);
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    assert.equal(handle.result.current.paywallAsk, 0, "nothing opens before a message");
    assert.equal(handle.result.current.send("one"), true, "the composer sends whatever the plan: the server screens it first");
    let state = await until(handle, (s) => !s.sending && s.notice !== null, "the free plan");
    assert.equal(state.notice, "plan", "Scholar is part of Pro, with See plans");
    assert.equal(state.paywallAsk, 1, "and the plans open by themselves, once");
    assert.equal(state.opensAt, null);
    const held = state.rows.filter((row) => row.kind === "user").pop();
    assert.equal(held.failure, "limit", "only Try again");
    const ends = new Date(BASE + 3 * 86_400_000).toISOString();
    w.server.state.serverPlans.user_a = "trial";
    w.server.state.serverPlanEnds.user_a = ends;
    state.retry(held.message.id);
    state = await until(handle, (s) => !s.sending && s.notice === "opensSaved", "the trial");
    assert.equal(Date.parse(state.opensAt), Date.parse(ends), "the day the plan begins");
    assert.equal(state.creditsOut, null, "a trial has no credits");
    assert.equal(state.paywallAsk, 1, "a trial is never sent to the plans");
    w.server.state.serverPlans.user_a = "pro";
    state.retry(held.message.id);
    state = await until(handle, (s) => !s.sending && s.messages.length === 2, "the plan has begun: answered");
    assert.equal(state.messages[0].id, held.message.id, "the same message");
    assert.equal(state.notice, null);
    assert.deepEqual(
      calls(w, "scholar-turn").map((call) => call.body.messageId),
      [held.message.id, held.message.id, held.message.id],
    );
    handle.unmount();
  });

  await test("conversation: a Pro account's credits are read when it opens, and only for an account RevenueCat calls Pro", async (w) => {
    w.server.state.scholarCreditRows.push({
      user_id: "user_a",
      used: 330,
      allowance: 400,
      renews_at: "2026-10-25T13:30:00.123456+00:00",
      updated_at: stamp(BASE),
    });
    const creditReads = () => w.server.state.requests.filter((r) => r.path === "/rest/v1/scholar_credits").length;
    const before = renderConversation(w, {});
    await until(before, (s) => s.phase === "ready", "ready");
    await settle(4);
    assert.equal(creditReads(), 0, "until RevenueCat has answered, nothing is read");
    assert.equal(before.result.current.creditsLow, null);
    before.unmount();
    const entitlement = w.use("@/store/entitlementStore").useEntitlementStore.getState();
    entitlement.start("user_a", "test_store");
    entitlement.setEntitlement("user_a", "pro", null);
    const handle = renderConversation(w, {});
    const state = await until(handle, (s) => s.creditsLow !== null, "the credits line");
    assert.deepEqual(state.creditsLow, { percent: 18, renewsInMinutes: 91 }, "70 of 400 left, renewing in an hour and a half");
    assert.equal(creditReads(), 1);
    handle.unmount();
  });

  await test("conversation: the credits' countdown moves within 30 seconds of a minute passing", async (w) => {
    // No credit left, renewing at half past a minute: 25.5 minutes away reads 26, and 30 seconds later 25.
    w.server.state.scholarCreditRows.push({
      user_id: "user_a",
      used: 400,
      allowance: 400,
      renews_at: "2026-10-25T12:25:30.000000+00:00",
      updated_at: stamp(BASE),
    });
    const entitlement = w.use("@/store/entitlementStore").useEntitlementStore.getState();
    entitlement.start("user_a", "test_store");
    entitlement.setEntitlement("user_a", "pro", null);
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.creditsOut !== null, "the credits read at open");
    assert.equal(handle.result.current.creditsOut, 26, "25.5 minutes away");
    await advance(30_000);
    assert.equal(handle.result.current.creditsOut, 25, "30 seconds later, a minute less");
    handle.unmount();
  });

  await test("entitlement: the screens learn the day a trial's plan begins from RevenueCat's trial, and nothing for another plan", async (w) => {
    const { useEntitlement } = w.use("@/hooks/useEntitlement");
    const store = w.use("@/store/entitlementStore").useEntitlementStore;
    const seen = () => {
      const handle = w.renderHook(useEntitlement, {});
      const { known, tier, trialEndsAt } = handle.result.current;
      handle.unmount();
      return { known, tier, trialEndsAt };
    };
    assert.deepEqual(seen(), { known: false, tier: null, trialEndsAt: null }, "until RevenueCat answers");
    const ends = BASE + 3 * 86_400_000;
    store.getState().start("user_a", "test_store");
    store.getState().setEntitlement("user_a", "trial", null, { endsAt: ends, willRenew: true });
    assert.deepEqual(seen(), { known: true, tier: "trial", trialEndsAt: new Date(ends).toISOString() }, "the day Scholar opens");
    store.getState().setEntitlement("user_a", "pro", null);
    assert.equal(seen().trialEndsAt, null, "a paying plan has no trial end");
    store.getState().setEntitlement("user_a", "trial", null, { endsAt: Number.NaN, willRenew: true });
    assert.equal(seen().trialEndsAt, null, "an end that cannot be read is none");
  }, { fakes: { "@/services/revenuecat": { refreshEntitlement: async () => undefined } } });

  await test("conversation: a credits read at open that comes back after an answer never replaces the answer's newer numbers", async (w) => {
    // 330 of 400 spent when the conversation opens. The read is held until the first answer has spent its message (334
    // spent), then answers with the older 330: the answer's numbers stay.
    const renews = "2026-10-25T13:30:00.000000+00:00";
    w.server.state.scholarCreditRows.push({ user_id: "user_a", used: 330, allowance: 400, renews_at: renews, updated_at: stamp(BASE) });
    let release = () => undefined;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    w.server.state.rest.scholar_credits.push(() => held);
    const entitlement = w.use("@/store/entitlementStore").useEntitlementStore.getState();
    entitlement.start("user_a", "test_store");
    entitlement.setEntitlement("user_a", "pro", null);
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    await until(handle, () => w.server.state.requests.some((r) => r.path === "/rest/v1/scholar_credits"), "the credits read, held");
    handle.result.current.send("one");
    await until(handle, (s) => !s.sending && s.messages.length === 2, "the first answer");
    assert.deepEqual(handle.result.current.creditsLow, { percent: 17, renewsInMinutes: 90 }, "66 of 400 left, from the answer");
    release(json(200, [{ used: 330, allowance: 400, renews_at: renews }]));
    await settle(8);
    assert.deepEqual(handle.result.current.creditsLow, { percent: 17, renewsInMinutes: 90 }, "the older read changes nothing");
    assert.equal(
      w.server.state.requests.filter((r) => r.path === "/rest/v1/scholar_credits").length,
      1,
      "read once, when the conversation opened",
    );
    handle.unmount();
  });

  await test("conversation: a heavy message is answered for any plan with its help line, no chips, no events, no credits line", async (w) => {
    w.server.state.serverPlans.user_a = "free";
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    handle.result.current.send("HEAVY tonight is too much");
    const state = await until(handle, (s) => !s.sending && s.messages.length === 2, "the answer");
    assert.equal(state.notice, null, "never the limit");
    assert.equal(state.heavy, true);
    assert.equal(state.help, "crisis");
    assert.equal(state.messages[1].helpLine, "crisis");
    assert.equal(state.creditsLow, null);
    assert.equal(state.creditsOut, null);
    const newest = state.rows.find((row) => row.kind === "answer");
    assert.equal(newest.newest, true, "the screen draws no chips for it: it checks heavy (source check below)");
    state.send("ABUSE someone hurts me at home");
    const abuse = await until(handle, (s) => !s.sending && s.messages.length === 4, "the second answer");
    assert.equal(abuse.help, "abuse", "the newest help line is the one the Get help button shows");
    assert.deepEqual(w.analyticsCalls, [], "nothing is sent about a heavy conversation");
    handle.unmount();
  });

  await test("conversation: a greeting gets a welcome, the newest answer, until the person says what they need", async (w) => {
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    handle.result.current.send("HELLO");
    const welcomed = await until(handle, (s) => !s.sending && s.messages.length === 2, "the welcome");
    const first = welcomed.rows.find((row) => row.kind === "answer");
    assert.equal(first.newest, true);
    assert.equal(first.message.welcome, true, "the screen draws the situations' chips under it (source check below)");
    const { copy } = w.use("@/constants/copy");
    assert.deepEqual(copy.scholar.chips.topics, [
      "I’m feeling anxious",
      "I’m feeling weary",
      "I’m grieving",
      "I need hope",
      "I need prayer",
    ]);
    welcomed.send("I am feeling anxious");
    const answered = await until(handle, (s) => !s.sending && s.messages.length === 4, "the answer");
    const answers = answered.rows.filter((row) => row.kind === "answer");
    assert.deepEqual(answers.map((row) => [row.newest, row.message.welcome]), [[false, true], [true, false]]);
    handle.unmount();
  });

  await test("conversation: the first answer starts the conversation's events, each answer after is a follow-up", async (w) => {
    const handle = renderConversation(w, { starter: "verse" });
    await until(handle, (s) => !s.sending && s.messages.length === 2, "the starter's answer");
    assert.equal(calls(w, "scholar-turn")[0].body.input.text, "Explain John 3:16 simply", "a starter is sent as it is written");
    handle.result.current.send("Explain it more simply");
    await until(handle, (s) => !s.sending && s.messages.length === 4, "the follow-up");
    assert.deepEqual(w.analyticsCalls, [
      ["scholar_conversation_started", { source: "starter" }],
      ["scholar_message_sent", { mode: "text", turn: "first" }],
      ["scholar_message_sent", { mode: "text", turn: "follow_up" }],
    ]);
    handle.unmount();
  });

  await test("conversation: from a reflection it finds that reflection's conversation, sends the entry id, and loads the reflection", async (w) => {
    const entry = serverRow(1);
    w.server.state.entries.push(entry);
    seedConversation(w, { id: mid(60), entryId: entry.id, messages: [userRow(61, "Why this passage?"), answerRow(62, 61)] });
    const handle = renderConversation(w, { entryId: entry.id });
    const state = await until(handle, (s) => s.phase === "ready" && s.entry !== null, "the reflection's conversation");
    assert.equal(state.conversationId, mid(60), "the conversation the reflection already has");
    assert.equal(state.messages.length, 2);
    assert.equal(state.entry.id, entry.id);
    state.send("What can I do today?");
    await until(handle, (s) => !s.sending && s.messages.length === 4, "the answer");
    const [call] = calls(w, "scholar-turn");
    assert.equal(call.body.entryId, entry.id);
    assert.equal(call.body.conversationId, mid(60));
    assert.equal(w.server.state.scholarConversations.length, 1, "still one conversation for the reflection");
    handle.unmount();
  });

  await test("conversation: when the server answers with the reflection's existing conversation, the next message goes there", async (w) => {
    const entry = serverRow(3);
    w.server.state.entries.push(entry);
    const handle = renderConversation(w, { entryId: entry.id });
    const fresh = await until(handle, (s) => s.phase === "ready" && s.entry !== null, "a new conversation for the reflection");
    const phoneId = fresh.conversationId;
    // Meanwhile another of the person's phones started the reflection's conversation.
    seedConversation(w, { id: mid(65), entryId: entry.id, messages: [userRow(66, "From the other phone"), answerRow(67, 66)] });
    fresh.send("Why this passage?");
    const first = await until(handle, (s) => !s.sending && s.messages.length >= 2, "the first answer");
    assert.equal(first.conversationId, mid(65), "the server's conversation is the one kept");
    assert.notEqual(phoneId, mid(65));
    first.send("What can I do today?");
    await until(handle, (s) => !s.sending && s.messages.length >= 4, "the second answer");
    assert.deepEqual(
      calls(w, "scholar-turn").map((call) => call.body.conversationId),
      [phoneId, mid(65)],
      "the second message goes to the conversation the server kept",
    );
    assert.equal(w.server.state.scholarConversations.length, 1, "no second conversation for the reflection");
    handle.unmount();
  });

  await test("conversation: from a reflection that was a heavy moment it is heavy from the start, with that reflection's help line", async (w) => {
    // A Pro account low on credits (70 of 400 left): they are read when the conversation opens, and a heavy one never shows them.
    w.server.state.scholarCreditRows.push({
      user_id: "user_a",
      used: 330,
      allowance: 400,
      renews_at: "2026-10-25T13:30:00.123456+00:00",
      updated_at: stamp(BASE),
    });
    const entitlement = w.use("@/store/entitlementStore").useEntitlementStore.getState();
    entitlement.start("user_a", "test_store");
    entitlement.setEntitlement("user_a", "pro", null);
    const entry = serverRow(2, { is_crisis: true, help_line: "abuse" });
    w.server.state.entries.push(entry);
    const handle = renderConversation(w, { entryId: entry.id });
    const state = await until(handle, (s) => s.phase === "ready" && s.entry !== null, "the reflection");
    await until(handle, () => w.server.state.requests.some((r) => r.path === "/rest/v1/scholar_credits"), "the credits read");
    await settle(4);
    assert.equal(handle.result.current.creditsLow, null, "read, and never shown in a heavy conversation");
    assert.equal(handle.result.current.creditsOut, null);
    assert.equal(state.messages.length, 0, "a new conversation");
    assert.equal(state.heavy, true, "before its first answer: no chips, the help button");
    assert.equal(state.help, "abuse", "the Get help sheet shows the reflection's own line");
    state.send("I don’t know what to do");
    const answered = await until(handle, (s) => !s.sending && s.messages.length === 2, "the answer");
    assert.equal(answered.heavy, true);
    assert.equal(answered.creditsLow, null);
    assert.equal(answered.creditsOut, null);
    assert.equal(w.server.state.scholarConversations[0].is_heavy, true, "the server started it heavy too");
    assert.deepEqual(w.analyticsCalls, [], "no event");
    handle.unmount();
  });

  await test("conversation: an unanswered message under a minute old is waited for; an older one offers Try again", async (w) => {
    clock.now = BASE - 10_000;
    seedConversation(w, { messages: [userRow(1, "still waiting", { status: "pending", claimed_at: stamp(clock.now) })] });
    clock.now = BASE;
    const handle = renderConversation(w, { conversationId: CONV });
    const waiting = await until(handle, (s) => s.phase === "ready" && s.sending, "the waiting row");
    assert.ok(waiting.rows.some((row) => row.kind === "waiting"));
    const person = w.server.state.scholarMessages.find((row) => row.id === mid(1));
    person.status = "ready";
    w.server.state.scholarMessages.push({ ...answerRow(2, 1), conversation_id: CONV, user_id: "user_a", status: "ready", input_type: null, error_code: null, is_heavy: false, claimed_at: null, created_at: stamp(clock.now) });
    await advance(3_000);
    const answered = await until(handle, (s) => !s.sending && s.messages.length === 2, "the answer, read again");
    assert.equal(answered.messages[1].replyTo, mid(1));
    handle.unmount();

    clock.now = BASE + 600_000;
    seedConversation(w, { id: mid(50), messages: [userRow(51, "long ago", { status: "pending" })] });
    clock.now = BASE + 600_000 + 120_000;
    const later = renderConversation(w, { conversationId: mid(50) });
    const old = await until(later, (s) => s.phase === "ready", "the old message");
    assert.equal(old.sending, false);
    assert.equal(old.rows.find((row) => row.kind === "user").failure, "generic", "Try again");
    later.unmount();
  });

  await test("conversation: leaving and coming back during a turn finds it in flight, and its answer lands once", async (w) => {
    seedConversation(w, { messages: [userRow(1, "first"), answerRow(2, 1)] });
    const first = renderConversation(w, { conversationId: CONV });
    await until(first, (s) => s.phase === "ready" && s.messages.length === 2, "loaded");
    const release = holdTurn(w);
    first.result.current.send(QUESTION);
    await until(first, (s) => s.sending, "in flight");
    first.unmount();
    const again = renderConversation(w, { conversationId: CONV });
    const back = await until(again, (s) => s.phase === "ready" && s.sending, "the turn in flight, found again");
    assert.equal(back.messages.length, 3, "the person's new message is drawn again under the earlier turn");
    assert.equal(back.rows.filter((row) => row.kind === "waiting").length, 1);
    release();
    const answered = await until(again, (s) => !s.sending && s.messages.length === 4, "the answer");
    assert.equal(answered.messages.filter((message) => message.role === "scholar").length, 2);
    assert.equal(calls(w, "scholar-turn").length, 1, "one request");
    again.unmount();
  });

  await test("conversation: a starter waits for the AI permission, then goes once", async (w) => {
    const handle = renderConversation(w, { starter: "pray" });
    await until(handle, (s) => s.phase === "ready", "ready");
    await settle(4);
    assert.equal(calls(w, "scholar-turn").length, 0, "nothing before the permission");
    assert.equal(handle.result.current.messages.length, 0);
    w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState().setAiPermission("user_a", new Date(clock.now).toISOString());
    handle.result.current.sendStarter();
    await until(handle, (s) => !s.sending && s.messages.length === 2, "the starter's answer");
    handle.result.current.sendStarter();
    await settle(4);
    assert.equal(calls(w, "scholar-turn").length, 1, "once");
    handle.unmount();
  }, { permission: true });

  await test("conversation: a take under a second is too short, offline a take is kept, and a sent one waits for its words", async (w) => {
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    assert.equal(handle.result.current.sendSpoken({ messageId: mid(5), uri: "file:///recordings/chat-a.m4a", durationMs: 600 }), "too_short");
    let state = await until(handle, (s) => s.notice === "tooShort", "the notice");
    offline(w);
    assert.equal(state.sendSpoken({ messageId: mid(5), uri: "file:///recordings/chat-a.m4a", durationMs: 4000 }), "kept");
    state = await until(handle, (s) => s.notice === "offline", "offline");
    assert.equal(calls(w, "scholar-turn").length, 0);
    w.use("@/store/offlineStore").useOfflineStore.getState().setNet(true, true);
    const release = holdTurn(w);
    assert.equal(state.sendSpoken({ messageId: mid(5), uri: `file:///recordings/chat-${mid(5)}.m4a`, durationMs: 4000 }), "sent");
    const waiting = await until(handle, (s) => s.sending, "in flight");
    assert.equal(waiting.messages[0].inputType, "audio");
    assert.equal(waiting.messages[0].blocks.length, 0, "a voice message until its words arrive");
    release();
    const answered = await until(handle, (s) => !s.sending && s.messages.length === 2, "the answer");
    assert.ok(answered.messages[0].blocks[0].text.length > 0, "the words that were heard");
    assert.equal(calls(w, "scholar-turn")[0].body.input.durationMs, 4000);
    handle.unmount();
  });

  await test("conversation: no words heard drops a spoken message that has none, and says so", async (w) => {
    w.server.state.functions["scholar-turn"].push(() => json(422, { error: { code: "NO_SPEECH", message: "x", requestId: "r" } }));
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    handle.result.current.sendSpoken({ messageId: mid(6), uri: `file:///recordings/chat-${mid(6)}.m4a`, durationMs: 3000 });
    const state = await until(handle, (s) => !s.sending && s.notice === "noWords", "no words");
    assert.equal(state.messages.length, 0, "nothing of it is drawn");
    handle.unmount();
  });

  await test("conversation: Scholar closed for the account shows the adults-only notice and no Try again", async (w) => {
    w.server.state.functions["scholar-turn"].push(() => json(403, { error: { code: "SCHOLAR_ADULTS_ONLY", message: "x", requestId: "r" } }));
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    handle.result.current.send(QUESTION);
    const state = await until(handle, (s) => !s.sending && s.notice === "adultsOnly", "the notice");
    assert.equal(state.rows.find((row) => row.kind === "user").failure, "none");
    handle.unmount();
  });

  await test("conversation: deleting it removes it and its messages on the server", async (w) => {
    seedConversation(w, { messages: [userRow(1, "first"), answerRow(2, 1)] });
    const handle = renderConversation(w, { conversationId: CONV });
    const state = await until(handle, (s) => s.phase === "ready" && s.messages.length === 2, "loaded");
    assert.equal(await state.remove(), true);
    assert.equal(w.server.state.scholarConversations.length, 0);
    handle.unmount();
  });

  await test("conversation: one that is gone is missing; one that cannot be read is an error with Try again", async (w) => {
    const gone = renderConversation(w, { conversationId: mid(40) });
    await until(gone, (s) => s.phase === "missing", "missing");
    gone.unmount();
    w.server.state.rest.scholar_conversations.push(json(500, { code: "XX000", message: "boom", details: null, hint: null }));
    const broken = renderConversation(w, { conversationId: CONV });
    const failed = await until(broken, (s) => s.phase === "error", "the error");
    seedConversation(w, { messages: [userRow(1, "first"), answerRow(2, 1)] });
    failed.reload();
    await until(broken, (s) => s.phase === "ready" && s.messages.length === 2, "read again");
    broken.unmount();
  });
}

// ================================================================== the rows
async function rowChecks() {
  await test("rows: an answer is shared as Scholar's words and prayer first, then its passages, never the person's message; nothing to share is null", async (w) => {
    const { answerShareText } = w.use("@/utils/scholarRows");
    const { copy } = w.use("@/constants/copy");
    const scripture = (verified, words, reference = "Psalm 23:1–2") => ({ reference, text: words, translation: "BSB", verified });
    const answer = (blocks) => ({
      id: "a1", conversationId: CONV, role: "scholar", replyTo: "u1", inputType: null, status: "ready", errorCode: null,
      blocks, isHeavy: false, helpLine: null, createdAt: new Date(BASE).toISOString(),
    });
    // Saved with the lead passage first, as the bubble draws it: the share still opens on Scholar's own words.
    const body = answerShareText(
      answer([
        { type: "passage", scripture: scripture(true, "The LORD is my shepherd; I shall not want.") },
        { type: "text", text: " First.\n\nSecond. " },
        { type: "passage", scripture: scripture(true, "He restores my soul.", "Psalm 23:3") },
        { type: "prayer", text: "Lord, stay near." },
      ]),
    );
    assert.equal(
      body,
      "First.\n\nSecond.\n\n“Lord, stay near. Amen.”\n\n“The LORD is my shepherd; I shall not want.”\n— Psalm 23:1–2 (BSB)\n\n“He restores my soul.”\n— Psalm 23:3 (BSB)",
    );
    assert.ok(body.startsWith("First."), "the share sheet's preview is Scholar's words, not the verse");
    assert.equal(copy.scholar.share.message(body), `${body}\n\nShared from GraceHush`);
    // An answer that is only a verified passage still shares it.
    assert.equal(
      answerShareText(answer([{ type: "passage", scripture: scripture(true, "The LORD is my shepherd; I shall not want.") }])),
      "“The LORD is my shepherd; I shall not want.”\n— Psalm 23:1–2 (BSB)",
    );
    // A passage that is not verified shares nothing of itself, and an answer with nothing to share is null.
    assert.equal(answerShareText(answer([{ type: "passage", scripture: scripture(false, null) }])), null);
    assert.equal(answerShareText(answer([{ type: "passage", scripture: scripture(true, "") }, { type: "text", text: "   " }])), null);
    assert.equal(
      answerShareText(answer([{ type: "passage", scripture: scripture(false, "Words that must not leave unverified") }, { type: "text", text: "Kept." }])),
      "Kept.",
    );
  });

  await test("share: WhatsApp's and Messages' links carry the whole message, encoded, and nothing else", async (w) => {
    const { whatsAppShareUrl, messagesShareUrl } = w.use("@/utils/shareLinks");
    const message =
      "Rest is a gift & a promise? Yes: 100% #1 + more.\n\n“Come to Me, all you who are weary.” — Matthew 11:28 (BSB)\n\nShared from GraceHush";
    const raw = (encoded) => !/[\s&#?+%]/.test(encoded.replace(/%[0-9A-F]{2}/g, ""));
    const url = whatsAppShareUrl(message);
    assert.ok(url.startsWith("whatsapp://send?text="), "WhatsApp's own send link, which opens its chat picker");
    const query = url.slice("whatsapp://send?".length);
    assert.deepEqual([...new URLSearchParams(query).keys()], ["text"], "one parameter: the text");
    assert.equal(new URLSearchParams(query).get("text"), message, "the whole message, every character, comes back out");
    assert.ok(raw(query.slice("text=".length)), "nothing raw that could end the text");
    const ios = messagesShareUrl(message, "ios");
    assert.ok(ios.startsWith("sms:&body="), "iOS: no recipient, the body after &");
    assert.equal(decodeURIComponent(ios.slice("sms:&body=".length)), message);
    assert.ok(raw(ios.slice("sms:&body=".length)));
    const android = messagesShareUrl(message, "android");
    assert.ok(android.startsWith("sms:?body="), "Android: the body after ?");
    assert.equal(decodeURIComponent(android.slice("sms:?body=".length)), message);
    assert.equal(whatsAppShareUrl(""), "whatsapp://send?text=");
  });

  await test("rows: the AI reminder opens every conversation and comes again after three hours; answers follow their messages", async (w) => {
    const { buildConversationRows } = w.use("@/utils/scholarRows");
    assert.deepEqual(buildConversationRows([], null).map((row) => row.kind), ["reminder"], "a new conversation starts with it");
    const at = (ms) => new Date(BASE + ms).toISOString();
    const message = (id, role, ms, extra = {}) => ({
      id,
      conversationId: CONV,
      role,
      replyTo: null,
      inputType: role === "user" ? "text" : null,
      status: "ready",
      errorCode: null,
      blocks: [{ type: "text", text: "words" }],
      isHeavy: false,
      helpLine: null,
      createdAt: at(ms),
      ...extra,
    });
    const rows = buildConversationRows(
      [
        message("a2", "scholar", 2_000, { replyTo: "u1" }),
        message("u1", "user", 0),
        message("u3", "user", 3 * 3_600_000 + 5_000),
        message("a4", "scholar", 3 * 3_600_000 + 6_000, { replyTo: "u3" }),
        message("u5", "user", 3 * 3_600_000 + 9_000, { inputType: "audio", status: "failed", blocks: [] }),
      ],
      null,
    );
    assert.deepEqual(
      rows.map((row) => `${row.kind}${row.message ? `:${row.message.id}` : ""}`),
      ["reminder", "user:u1", "answer:a2", "reminder", "user:u3", "answer:a4"],
      "a failed spoken message with no words is not drawn",
    );
    assert.equal(rows.find((row) => row.kind === "answer" && row.message.id === "a4").newest, true);
  });
}

// ================================================================== Listen
async function listenChecks() {
  const answerOf = async (w) => {
    const turn = await repo(w).sendTurn(text(QUESTION));
    return turn.data.answer.id;
  };

  await test("listen: parts play in order, one at a time, the next fetched while one plays; a replay makes no request", async (w) => {
    w.server.state.serverPlans.user_a = "pro";
    const id = await answerOf(w);
    const player = w.use("@/services/scholarPlayer");
    await player.playScholarAnswer(id);
    await settle(6);
    assert.equal(player.getScholarListenState().phase, "playing");
    assert.equal(w.audio.devotionalPauses, 1, "a devotional that is playing pauses first");
    assert.deepEqual(w.audio.modes, ["playback"]);
    assert.equal(w.audio.players.length, 1, "one part at a time");
    // The world's account has allowed ElevenLabs, in the default voice, so each part is read and cached in it.
    assert.ok(w.audio.players[0].uri.endsWith(`/cache/scholar/${id}-warm-0.wav`));
    assert.equal(w.audio.players[0].options.keepAudioSessionActive, false, "it never holds the session");
    assert.deepEqual(calls(w, "scholar-speak").map((call) => call.body.part), [0, 1], "the next part comes while one plays");
    assert.equal(calls(w, "scholar-speak")[0].headers["x-region"], "us-east-1");
    w.audio.players[0].emit({ didJustFinish: true });
    await settle(6);
    assert.equal(w.audio.players[0].released, true);
    assert.ok(w.audio.players[1].uri.endsWith(`-1.wav`));
    w.audio.players[1].emit({ didJustFinish: true });
    await settle(4);
    assert.equal(player.getScholarListenState().phase, "idle");
    await player.playScholarAnswer(id);
    await settle(6);
    assert.equal(calls(w, "scholar-speak").length, 2, "a replay in the same visit makes no request");
    player.clearScholarAudio();
  }, { player: true });

  await test("listen: leaving the app stops it, something covering it does not, and closing the screen empties the cache", async (w) => {
    w.server.state.serverPlans.user_a = "pro";
    const id = await answerOf(w);
    const player = w.use("@/services/scholarPlayer");
    await player.playScholarAnswer(id);
    await settle(6);
    // Control Center pulled down to turn up the volume: iOS says "inactive", and the voice goes on.
    w.appState.emit("inactive");
    w.appState.emit("active");
    assert.equal(player.getScholarListenState().phase, "playing", "a moment of inactive does not stop the voice");
    assert.equal(w.audio.players[0].released, false);
    w.appState.emit("inactive");
    w.appState.emit("background");
    assert.equal(player.getScholarListenState().phase, "idle");
    assert.equal(w.audio.players[0].released, true);
    assert.ok([...w.files.files.keys()].some((uri) => uri.includes("/cache/scholar/")), "the parts stay for the visit");
    player.clearScholarAudio();
    assert.equal([...w.files.files.keys()].filter((uri) => uri.includes("/cache/scholar/")).length, 0, "and go when it closes");
  }, { player: true });

  await test("listen: outside Pro it is refused by its plan (a trial with the day it opens), Pro spends credits on part 0, a heavy answer plays for everyone", async (w) => {
    const id = await answerOf(w);
    const player = w.use("@/services/scholarPlayer");
    const listen = async (messageId) => {
      await player.playScholarAnswer(messageId);
      await settle(6);
      return player.getScholarListenState();
    };
    w.server.state.serverPlans.user_a = "free";
    let state = await listen(id);
    assert.equal(state.phase, "failed");
    assert.deepEqual([state.usage.kind, state.usage.resetsAt], ["listen_plan", null], "the screen opens the Paywall with reason listen");
    const ends = new Date(BASE + 3 * 86_400_000).toISOString();
    w.server.state.serverPlans.user_a = "trial";
    w.server.state.serverPlanEnds.user_a = ends;
    state = await listen(id);
    assert.equal(state.usage.kind, "listen_plan");
    assert.equal(Date.parse(state.usage.resetsAt), Date.parse(ends), "the screen says the day Scholar opens");
    w.server.state.serverPlans.user_a = "pro";
    const row = w.server.state.scholarCreditRows.find((item) => item.user_id === "user_a");
    row.used = 400;
    state = await listen(id);
    assert.deepEqual([state.phase, state.usage.kind, state.usage.remaining], ["failed", "credits", 0], "no credit left");
    assert.equal(w.audio.players.length, 0, "nothing played");
    row.used = 100;
    state = await listen(id);
    assert.equal(state.phase, "playing");
    assert.deepEqual(calls(w, "scholar-speak").map((call) => call.body.part).slice(-2), [0, 1]);
    assert.equal(row.used, 100 + w.server.state.scholarListenCost, "part 0 spent the answer's cost, once");
    player.clearScholarAudio();
    w.server.state.serverPlans.user_a = "free";
    const heavy = await repo(w).sendTurn(text("HEAVY I cannot sleep", 20, { conversationId: mid(30) }));
    state = await listen(heavy.data.answer.id);
    assert.equal(state.phase, "playing", "a heavy answer plays for every plan");
    assert.equal(row.used, 100 + w.server.state.scholarListenCost, "and is never counted");
    player.clearScholarAudio();
  }, { player: true });

  await test("listen voice: with ElevenLabs allowed each part is asked for in the chosen voice and cached by voice; a voice changed while one plays is heard from the next listen; without the permission no voice goes", async (w) => {
    paid(w);
    allowTalk(w, { voiceKey: "storyteller" });
    const id = await answerOf(w);
    const player = w.use("@/services/scholarPlayer");
    const prefs = w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState();
    const asked = () => calls(w, "scholar-speak").map((call) => [call.body.part, call.body.voice ?? "none"]);
    await player.playScholarAnswer(id);
    await settle(6);
    assert.equal(player.getScholarListenState().phase, "playing");
    assert.deepEqual(asked(), [[0, "storyteller"], [1, "storyteller"]], "each part in the chosen voice, the next while one plays");
    assert.ok(w.audio.players[0].uri.endsWith(`/cache/scholar/${id}-storyteller-0.wav`), "cached under its voice");
    assert.equal(w.files.files.get(w.audio.players[0].uri).bytes.toString(), "RIFF-storyteller-part-0", "the part read in that voice is the one that plays");
    // Changed while part 0 plays: this listen keeps its voice to the end.
    prefs.setScholarVoice("user_a", "wise");
    w.audio.players[0].emit({ didJustFinish: true });
    await settle(6);
    assert.ok(w.audio.players[1].uri.endsWith(`/cache/scholar/${id}-storyteller-1.wav`), "one answer is never read in two chosen voices");
    assert.equal(calls(w, "scholar-speak").length, 2);
    w.audio.players[1].emit({ didJustFinish: true });
    await settle(4);
    assert.equal(player.getScholarListenState().phase, "idle");
    // The next listen is in the new voice, cached apart from the first.
    await player.playScholarAnswer(id);
    await settle(6);
    assert.deepEqual(asked().slice(2), [[0, "wise"], [1, "wise"]]);
    assert.ok(w.audio.players[2].uri.endsWith(`/cache/scholar/${id}-wise-0.wav`));
    player.stopScholarAudio();
    // ElevenLabs no longer allowed: no voice goes at all, and the parts are the devotional voice's own.
    prefs.setVoicePermission("user_a", null);
    await player.playScholarAnswer(id);
    await settle(6);
    const plain = calls(w, "scholar-speak").slice(4);
    assert.deepEqual(plain.map((call) => call.body.part), [0, 1]);
    assert.ok(plain.every((call) => !Object.prototype.hasOwnProperty.call(call.body, "voice")), "no voice key in the request");
    assert.ok(w.audio.players[3].uri.endsWith(`/cache/scholar/${id}-standard-0.wav`));
    assert.equal(w.files.files.get(w.audio.players[3].uri).bytes.toString(), "RIFF-standard-part-0");
    // Allowed again: the parts read in the chosen voice are still on the phone, so a replay asks for nothing.
    player.stopScholarAudio();
    prefs.setVoicePermission("user_a", new Date(clock.now).toISOString());
    await player.playScholarAnswer(id);
    await settle(6);
    assert.equal(calls(w, "scholar-speak").length, 6, "a replay in a voice already read makes no request");
    assert.ok(w.audio.players[4].uri.endsWith(`/cache/scholar/${id}-wise-0.wav`));
    player.clearScholarAudio();
  }, { permission: true, player: true });

  await test("listen voice: a voice chosen while the first part is on its way changes nothing of that listen, the part fetched ahead included", async (w) => {
    paid(w);
    allowTalk(w, { voiceKey: "storyteller" });
    const id = await answerOf(w);
    const player = w.use("@/services/scholarPlayer");
    const prefs = w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState();
    const asked = () => calls(w, "scholar-speak").map((call) => [call.body.part, call.body.voice ?? "none"]);
    const started = player.playScholarAnswer(id);
    // Chosen while part 0 is asked for, before anything plays.
    prefs.setScholarVoice("user_a", "wise");
    await started;
    await settle(6);
    assert.equal(player.getScholarListenState().phase, "playing");
    assert.deepEqual(asked(), [[0, "storyteller"], [1, "storyteller"]], "the part fetched ahead is in this listen's voice too");
    w.audio.players[0].emit({ didJustFinish: true });
    await settle(6);
    assert.ok(w.audio.players[1].uri.endsWith(`/cache/scholar/${id}-storyteller-1.wav`));
    assert.equal(calls(w, "scholar-speak").length, 2, "and no part is asked for twice");
    player.clearScholarAudio();
  }, { permission: true, player: true });

  await test("listen voice: the repository sends a voice only while ElevenLabs is allowed, whoever asks, and listenVoice says which", async (w) => {
    paid(w);
    allowTalk(w, { voice: false });
    const id = await answerOf(w);
    assert.equal(repo(w).listenVoice(), null, "no ElevenLabs permission, no voice");
    const plain = await repo(w).speak(id, 0, "storyteller");
    assert.equal(plain.ok, true, "the part is still read, in the devotional's voice");
    assert.ok(!Object.prototype.hasOwnProperty.call(calls(w, "scholar-speak")[0].body, "voice"), "a voice passed in without the permission is dropped");
    assert.equal(Buffer.from(plain.data.audioBase64, "base64").toString(), "RIFF-standard-part-0");
    allowTalk(w, { ai: false });
    assert.equal(repo(w).listenVoice(), "warm", "allowed with no voice chosen: the default voice");
    allowTalk(w, { ai: false, voiceKey: "deep" });
    assert.equal(repo(w).listenVoice(), "deep");
    const voiced = await repo(w).speak(id, 1, repo(w).listenVoice());
    assert.equal(voiced.ok, true);
    assert.equal(calls(w, "scholar-speak")[1].body.voice, "deep");
    assert.equal(Buffer.from(voiced.data.audioBase64, "base64").toString(), "RIFF-deep-part-1");
    // A call with no voice still asks with none.
    await repo(w).speak(id, 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(calls(w, "scholar-speak")[2].body, "voice"));
  }, { permission: true });
}

// ================================================================== the permission's words, the session
async function accountChecks() {
  await test("note: an account that allowed under the first words sees the note once, and seeing it records the new words", async (w) => {
    const prefs = w.use("@/store/profilePrefsStore");
    const store = prefs.useProfilePrefsStore;
    const at = new Date(clock.now).toISOString();
    store.setState((state) => {
      const { aiWording: _seen, ...entry } = state.byUser.user_a ?? {};
      return { byUser: { ...state.byUser, user_a: { ...entry, aiPermissionAt: at } } };
    });
    const { useAiWordingNote } = w.use("@/hooks/useAiPermission");
    const first = w.renderHook(useAiWordingNote);
    assert.equal(first.result.current.show, true);
    first.result.current.seen();
    assert.equal(store.getState().byUser.user_a.aiWording, prefs.AI_WORDING);
    first.unmount();
    const second = w.renderHook(useAiWordingNote);
    assert.equal(second.result.current.show, false, "never again");
    second.unmount();
    store.getState().setAiPermission("user_b", at);
    assert.equal(store.getState().byUser.user_b.aiWording, prefs.AI_WORDING, "allowing now is allowing the current words");
    store.getState().setAiPermission("user_b", null);
    assert.equal(store.getState().byUser.user_b.aiPermissionAt, null);
  });

  await test("session: signing out forgets the turn in flight and the uploads of this session", async (w) => {
    w.server.state.gate = new Promise(() => undefined);
    void repo(w).sendTurn(text(QUESTION));
    await settle();
    assert.notEqual(repo(w).getTurnInFlight(CONV), null);
    repo(w).forgetScholarSession();
    assert.equal(repo(w).getTurnInFlight(CONV), null);
  });
}

// ================================================================== what plain Node cannot draw
function sourceChecks() {
  sourceCheck("screen: no chips, no event and no limit in a heavy conversation; Get help and the delete link where the readers asked", () => {
    const screen = read("src/screens/scholar/ConversationScreen.tsx");
    assert.match(screen, /item\.newest && !chat\.heavy && !chat\.sending/, "chips under the newest answer only, never when heavy");
    assert.match(screen, /empty && !chat\.sending && !chat\.heavy \? \(/, "no starter chips in a conversation that starts heavy");
    assert.match(screen, /\{chat\.heavy \? \(/, "the Get help button in a heavy conversation");
    assert.match(screen, /onDelete=\{item\.message\.helpLine === "abuse" \? openDelete : null\}/, "the delete link under an abuse answer");
    assert.match(screen, /if \(!chat\.heavy && outsidePlan\("listen"\)\) return;/, "outside a heavy conversation, Listen asks the plan first");
    assert.match(
      screen,
      /function outsidePlan\(reason: "listen" \| "talk"\): boolean \{\s+if \(!known \|\| tier === "pro" \|\| !chat\.freeKnown\) return false;\s+if \(reason === "listen" \? chat\.freeHere : chat\.freeOpen\) return false;\s+if \(tier === "trial"\) chat\.noteOpens\(trialEndsAt\);\s+else navigation\.navigate\("Paywall", \{ source: "scholar", reason \}\);\s+return true;\s+\}/,
      "Pro plays; the free conversation listens and talks; a trial is told the day Scholar opens; the free plan sees the plans; until both have answered, the server decides",
    );
    assert.match(
      screen,
      /const \{ paywallAsk \} = chat;\s+useEffect\(\(\) => \{\s+if \(paywallAsk > 0\) navigation\.navigate\("Paywall", \{ source: "scholar", reason: "conversation" \}\);\s+\}, \[paywallAsk, navigation\]\);/,
      "a message the plan holds opens the plans by itself, with the conversation's own banner",
    );
    assert.match(
      screen,
      /\) : chat\.freeLeft !== null \? \([\s\S]{0,200}?<Text[^>]*>\s*\{copy\.scholar\.notices\.freeLeft\(chat\.freeLeft\)\}/,
      "the free messages left show above the composer",
    );
    assert.match(screen, /if \(outsidePlan\("talk"\)\) return;/, "Talk asks the same");
    assert.match(screen, /text=\{copy\.scholar\.notices\.creditsOut\}/, "no credit left: the notice above the composer");
    assert.match(
      screen,
      /detail=\{\{\s+text: credits\.renew\(credits\.renewsIn\(chat\.creditsOut\)\),\s+label: credits\.renew\(credits\.renewsInSpoken\(chat\.creditsOut\)\),\s+\}\}/,
      "under it, when they renew, written and spoken",
    );
    assert.match(
      screen,
      /if \(after\.usage\.kind === "listen_plan"\) \{\s+stopScholarAudio\(\);\s+if \(after\.usage\.resetsAt !== null\) chat\.noteOpens\(after\.usage\.resetsAt\);\s+else navigation\.navigate\("Paywall", \{ source: "scholar", reason: "listen" \}\);\s+\} else if \(after\.usage\.kind === "credits"\) \{\s+(\/\/[^\n]*\s+)*chat\.noteUsage\(after\.usage\);\s+\}/,
      "a refused Listen: outside the plan a trial is told the day and the free plan sees the plans; no credit left, the notice",
    );
    assert.match(
      screen,
      /noticeKind === "plan"\s+\? \{\s+label: copy\.scholar\.notices\.seePlans,\s+onPress: \(\) => navigation\.navigate\("Paywall", \{ source: "scholar", reason: "conversation" \}\),\s+\}\s+: undefined/,
      "See plans only on the plan's notice, to the Paywall with the free conversation’s banner",
    );
    assert.ok(!/accessibilityLiveRegion="polite"[^>]*credits\.low/.test(screen), "the credits line is not a live region: it moves every minute");
    assert.match(screen, /useEffect\(\(\) => \(\) => clearScholarAudio\(\), \[\]\)/, "closing the screen empties the cache");
    assert.ok(!/haptics/.test(screen), "no haptic on the screen");
    const hook = read("src/hooks/useConversation.ts");
    assert.match(hook, /if \(!saved\.isHeavy && !answer\.isHeavy\) \{/, "events only outside a heavy conversation");
    const composer = read("src/screens/scholar/ConversationComposer.tsx");
    assert.ok(!/usage|remaining|LIMIT/.test(composer), "the composer knows no limit");
  });

  sourceCheck("screen: under a welcome the chips are the situations GraceHush is for, under any other answer the ways to go further", () => {
    const screen = read("src/screens/scholar/ConversationScreen.tsx");
    assert.match(
      screen,
      /chips=\{item\.message\.welcome \? copy\.scholar\.chips\.topics : copy\.scholar\.chips\.after\}/,
      "the chips follow the newest answer",
    );
    assert.equal((screen.match(/copy\.scholar\.chips\.topics/g) ?? []).length, 1, "only under a welcome");
  });

  sourceCheck("chat: the person's bubble is plum and the answer's is a rose tint with the small corner on the other side; only what was sent or arrived this visit fades in", () => {
    const user = read("src/components/scholar/UserMessage.tsx");
    assert.match(user, /className="max-w-\[80%\] bg-plum px-4 py-3"/, "plum, at most 80% wide");
    assert.match(user, /borderBottomRightRadius: radii\.bubbleTail/, "the small corner is the sender's");
    assert.ok(!/border-petal|linen-deep/.test(user), "no petal border or linen-deep box any more");
    assert.match(user, /return animate \? \(\s*<FadeIn rise=\{8\} duration=\{150\}>/, "only a message sent this visit fades in");
    const answer = read("src/components/scholar/ScholarAnswer.tsx");
    assert.match(answer, /className="max-w-\[92%\] gap-3 self-start border border-rose\/50 bg-rose\/25 px-4 pb-1 pt-3" style=\{styles\.bubble\}/, "the answer sits in a rose-tinted bubble of its own, at most 92% wide");
    assert.match(answer, /borderBottomLeftRadius: radii\.bubbleTail/, "the small corner is the answer's, bottom-left: the mirror of the person's");
    assert.match(answer, /<View className="h-px bg-plum\/10" \/>/, "a hairline above the icon row");
    assert.equal((answer.match(/bg-plum"/g) ?? []).length, 1, "the only plum fill in an answer is Listen's playing circle");
    assert.match(answer, /<ScriptureCard scripture=\{block\.scripture\} tone="white" \/>/, "the verse card is white inside the tint");
    assert.match(answer, /rounded-xl border border-petal bg-card p-3/, "the prayer panel is white inside the tint");
    assert.match(answer, /<FadeIn rise=\{10\} duration=\{240\}>\s*\{bubble\}/, "the bubble arrives as one piece");
    assert.ok(!/BLOCK_DELAY_MS/.test(answer), "no block-by-block stagger inside the bubble");
    const scripture = read("src/components/ScriptureCard.tsx");
    assert.match(scripture, /tone === "white" \? "card" : "card card--blush"/, "the card is blush unless asked to be white");
    assert.match(scripture, /\{ scripture, tone = "blush" \}: ScriptureCardProps/, "Reflection's card stays blush: the default is blush");
    assert.match(answer, /text-label-md text-plum-deep">\{copy\.scholar\.name\}/, "the name in sentence case");
    assert.ok(!/eyebrow|copy\.scholar\.listen\./.test(answer), "no uppercase eyebrow, no word label on Listen");
    const screen = read("src/screens/scholar/ConversationScreen.tsx");
    assert.match(screen, /animate=\{chat\.sentIds\.includes\(item\.message\.id\)\}/, "a message fades in only when sent this visit");
    assert.match(screen, /animate=\{chat\.fresh\.includes\(item\.message\.id\)\}/, "an answer only when it arrived this visit");
    assert.match(screen, /if \(item\.kind === "waiting"\) return <TypingIndicator \/>;/, "the typing indicator waits for the answer");
    assert.ok(!/ActivityIndicator/.test(screen), "no spinner row any more");
  });

  sourceCheck("chat: Share is GraceHush's share panel with the answer's words only, never in a heavy conversation or under a help line", () => {
    const screen = read("src/screens/scholar/ConversationScreen.tsx");
    assert.match(
      screen,
      /onShare=\{chat\.heavy \|\| item\.message\.helpLine !== null \? null : \(\) => shareAnswer\(item\.message\)\}/,
      "offered only outside a heavy conversation and under an answer with no help line",
    );
    assert.match(
      screen,
      /const body = answerShareText\(message\);\s+return body === null \? null : copy\.scholar\.share\.message\(body\);/,
      "what is shared is built from the answer alone",
    );
    assert.match(screen, /const text = answerShareMessage\(message\);\s+if \(text !== null\) shareSheet\.share\(text\);/);
    assert.ok(!/haptics/.test(screen), "no haptic");
    assert.ok(!/track\(/.test(screen), "no event for a share");
    const rows = read("src/utils/scholarRows.ts");
    const builder = rows.slice(rows.indexOf("export function answerShareText"));
    assert.ok(!/role === "user"|messageText\(/.test(builder), "the builder never reads the person's words");
    assert.match(screen, /numberOfLines=\{1\} className="text-body-sm text-mauve"/, "the title sits under Scholar in the header");
  });

  sourceCheck("share: both share buttons open GraceHush's panel: WhatsApp and Messages open the app itself, More is the iPhone's menu", () => {
    for (const rel of ["src/screens/scholar/ConversationScreen.tsx", "src/screens/journal/ReflectionScreen.tsx"]) {
      const screen = read(rel);
      assert.match(screen, /const shareSheet = useShareSheet\(\);/, `${rel}: the hook`);
      assert.match(
        screen,
        /<ShareSheet text=\{shareSheet\.text\} whatsApp=\{shareSheet\.whatsApp\} onClose=\{shareSheet\.close\} \/>/,
        `${rel}: the panel`,
      );
      assert.equal((screen.match(/shareSheet\.share\(/g) ?? []).length, 1, `${rel}: one share`);
      assert.ok(
        !/Share\.share|\n  Share,\r?\n|activityType|openAppAfterShare|canOpenURL|whatsapp:\/\/|sms:/.test(screen),
        `${rel}: every share goes through the panel; nothing opened after the iPhone's menu`,
      );
    }
    const reflection = read("src/screens/journal/ReflectionScreen.tsx");
    assert.match(reflection, /if \(!scripture\.verified \|\| scripture\.text === null\) return null;/, "only a verified verse is shared");
    const hook = read("src/hooks/useShareSheet.ts");
    assert.match(hook, /const \[whatsApp, setWhatsApp\] = useState\(false\);/, "no WhatsApp tile until the phone answers");
    assert.match(hook, /if \(alive\) setWhatsApp\(value\);/, "a late answer after the screen has gone sets nothing");
    const links = read("src/services/externalLinks.ts");
    assert.match(links, /export async function canOpenWhatsApp\(\): Promise<boolean> \{\r?\n  if \(__DEV__\) return true;\r?\n  try \{\r?\n    return await Linking\.canOpenURL\("whatsapp:\/\/send"\);\r?\n  \} catch \{\r?\n    return false;/);
    assert.match(
      links,
      /const url = app === "whatsApp" \? whatsAppShareUrl\(message\) : messagesShareUrl\(message, Platform\.OS\);\r?\n  const opened = await openUrl\(url\);\r?\n  if \(!opened\.ok\) await openSystemShare\(message\);/,
      "an app that cannot be opened falls back to the iPhone's menu",
    );
    assert.match(links, /export async function openSystemShare\(message: string\): Promise<void> \{\r?\n  try \{\r?\n    await Share\.share\(\{ message \}\);/);
    assert.ok(!/openAppAfterShare|shareReturn|activityType/.test(links), "nothing opened after the iPhone's menu");
    const sheet = read("src/components/ShareSheet.tsx");
    assert.match(sheet, /<BottomSheet visible=\{text !== null\} onClose=\{onClose\} onDismiss=\{runAfter\}>/, "goes on from the dismissal");
    assert.match(
      sheet,
      /after\.current = \(\) => void send\(message\);\n    onClose\(\);\n    if \(Platform\.OS === "ios"\) setTimeout\(runAfter, MODAL_HANDOFF_FALLBACK_MS\);\n    else runAfter\(\);/,
      "on iOS after the panel has gone, or the fallback; at once on Android",
    );
    assert.match(sheet, /const run = after\.current;\n    after\.current = null;\n    run\?\.\(\);/, "a choice runs once");
    const order = ["key: \"whatsApp\"", "key: \"messages\"", "key: \"more\""].map((k) => sheet.indexOf(k));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), "WhatsApp, Messages, then More");
    assert.match(sheet, /\.\.\.\(whatsApp\r?\n?\s*\? \[/, "WhatsApp only on a phone that has it");
    assert.match(sheet, /send: \(message: string\) => shareToApp\("whatsApp", message\)/);
    assert.match(sheet, /send: \(message: string\) => shareToApp\("messages", message\)/);
    assert.match(sheet, /send: openSystemShare,/);
    assert.ok(!/haptics|track\(|console\./.test(sheet), "no haptic, event or log");
    const app = JSON.parse(read("app.json"));
    assert.deepEqual(app.expo.ios.infoPlist.LSApplicationQueriesSchemes, ["whatsapp"], "canOpenURL may ask about WhatsApp");
    for (const svg of ["assets/images/share-whatsapp.svg", "assets/images/share-messages.svg"]) {
      const text = read(svg);
      assert.ok(/<circle cx="28" cy="28" r="28" fill="#[0-9A-F]{6}"\/>/.test(text) && /fill="#FFFFFF"/.test(text), `${svg}: a brand circle with a white mark`);
      assert.ok(!/<script|xlink|href|<image|<text|<foreignObject/i.test(text), `${svg}: nothing but shapes`);
    }
    assert.ok(!/import |console\.|track\(/.test(read("src/utils/shareLinks.ts")), "the link builders are pure");
    for (const rel of ["src/utils/shareReturn.ts", "src/hooks/useWhatsAppAvailable.ts", "assets/images/whatsapp-logo.svg"]) {
      assert.ok(!fs.existsSync(path.join(REPO, rel)), `${rel} is gone`);
    }
    assert.ok(!/whatsapp|WhatsApp/.test(read("src/components/scholar/ScholarAnswer.tsx")), "no WhatsApp logo in the chat");
  });

  sourceCheck("chat: the typing indicator is three dots on the native driver, still under Reduce Motion, and stops with the screen", () => {
    const dots = read("src/components/scholar/TypingIndicator.tsx");
    assert.match(dots, /const DOT_COUNT = 3;/);
    assert.match(dots, /const DOT_STAGGER_MS = 150;/);
    assert.match(dots, /const PULSE_MS = 600;/);
    assert.match(dots, /const REST_MS = 300;/);
    assert.equal((dots.match(/useNativeDriver: true/g) ?? []).length, 1, "one timing helper, on the native driver");
    assert.match(dots, /if \(reduceMotion\) return undefined;/, "no animation under Reduce Motion");
    assert.match(dots, /reduceMotion\s+\? \{ opacity: STILL_OPACITY \}/, "still dots under Reduce Motion");
    assert.match(dots, /return \(\) => loop\.stop\(\);/, "the loop stops when the indicator goes");
    assert.match(dots, /accessibilityLabel=\{copy\.scholar\.a11y\.writing\}/, "one element that says Scholar is writing");
    assert.match(dots, /h-9 w-14 flex-row items-center justify-center gap-1\.5 rounded-full border border-rose\/50 bg-rose\/25/, "the pill wears the answer's tint");
    assert.ok(!/ActivityIndicator/.test(dots), "no spinner");
  });

  sourceCheck("composer: one white pill with the microphone bare inside it only while the field is empty; one circle outside, Send or Talk", () => {
    const composer = read("src/screens/scholar/ConversationComposer.tsx");
    assert.equal((composer.match(/rounded-hero border border-petal bg-card/g) ?? []).length, 3, "the Type, take and idle rows are one pill");
    assert.ok(!/rounded-input/.test(composer), "no 12-radius box any more");
    const type = composer.slice(composer.indexOf('{mode === "type" ? ('), composer.indexOf("<SpeakRow"));
    const mic = type.indexOf("copy.scholar.a11y.speak");
    const slot = type.indexOf('<View className="h-12 justify-center">');
    assert.ok(mic > 0 && slot > mic, "the microphone is inside the pill, before the slot outside it");
    assert.match(type, /\{hasText \? \(\s*<View className="w-4" \/>\s*\) : \(\s*<Pressable/, "the microphone only while the field is empty");
    assert.match(type, /\) : onTalk !== null \? \(\s*<View className="h-12 justify-center">\s*<TalkButton onPress=\{onTalk\} disabled=\{busy\} \/>/, "Talk outside the pill while the field is empty");
    assert.ok(!/border-petal bg-card">\s*<Icon name=\{icons\.mic\}/.test(type), "no bordered microphone circle");
  });

  sourceCheck("player: it never touches the lock screen and never holds the session; a take stops it", () => {
    const player = read("src/services/scholarPlayer.ts");
    assert.ok(!/setActiveForLockScreen|lockScreen|updateLockScreenMetadata/.test(player), "the readers: someone may watch the phone");
    assert.match(player, /keepAudioSessionActive: false/);
    assert.match(read("src/services/recorder.ts"), /stopAmbient\(\);\n\s+\/\/[^\n]*\n\s+stopScholarAudio\(\);/);
    const account = read("src/services/account.ts");
    assert.match(account, /clearScholarAudio\(\);\n\s+forgetScholarSession\(\);/, "sign-out stops the voice and forgets the session");
  });

  sourceCheck("app: no Scholar limit number lives in the app", () => {
    const app = read("src/constants/app.ts");
    const names = [...app.matchAll(/export const (SCHOLAR_\w+)/g)].map((match) => match[1]);
    for (const name of names) assert.ok(!/FREE|DAILY|PRO_|LISTEN/.test(name), `${name} would be a limit the server owns`);
  });
}

// ================================================================== copy
async function copyChecks() {
  await test("copy: curly punctuation, the GraceHush spelling, no confidential, private or human claim, and the help lines' numbers agree", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const strings = [];
    const walk = (value) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") strings.push(value(3), value(1));
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(copy.scholar);
    walk(copy.paywall.scholar);
    for (const string of strings) {
      const s = String(string);
      assert.ok(!s.includes("'"), `a straight apostrophe: ${s}`);
      assert.ok(!s.includes('"'), `a straight quote: ${s}`);
      assert.ok(!/Gracehush/.test(s), `the old spelling: ${s}`);
      assert.ok(!/confidential|private|human/i.test(s), `a claim Scholar cannot make: ${s}`);
    }
    assert.ok(copy.scholar.notices.adultsOnly("support@nouvrix.com").includes("support@nouvrix.com"));
    // The server's spoken help lines say the app's numbers.
    const crisis = w.use("@/constants/crisisResources");
    const heavy = read("supabase/functions/_shared/scholar/heavyChat.ts");
    const words = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
    const spokenDigits = (phrase) =>
      phrase
        .replace(/eight hundred/g, "eight zero zero")
        .split(/[\s,]+/)
        .filter((word) => word in words)
        .map((word) => words[word])
        .join("");
    assert.match(heavy, new RegExp(`Call or text ${crisis.HELPLINE_NUMBER.split("").map((d) => Object.keys(words)[d]).join(" ")} any time`));
    assert.match(heavy, new RegExp(`call ${crisis.EMERGENCY_NUMBER.split("").map((d) => Object.keys(words)[d]).join(" ")}`));
    const hotline = /call (one eight hundred, seven nine nine, seven two three three)/.exec(heavy);
    assert.ok(hotline, "the hotline is spoken");
    assert.equal(spokenDigits(hotline[1]), crisis.DV_HOTLINE_NUMBER.replace(/\D/g, ""));
    const textLine = new RegExp(`text ${crisis.DV_TEXT_BODY} to (eight eight seven eight eight)`).exec(heavy);
    assert.ok(textLine, "the text line is spoken with its word");
    assert.equal(spokenDigits(textLine[1]), crisis.DV_TEXT_NUMBER);
  });

  await test("copy: Scholar's plan and credits say what is true: Pro alone, the day a trial's plan begins, and when the credits renew", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const { notices, credits } = copy.scholar;
    assert.equal(notices.plan, "Scholar is part of GraceHush Pro. Your message is saved.");
    assert.equal(notices.opens("Friday, Nov 21"), "Scholar opens when your plan begins on Friday, Nov 21.");
    assert.equal(notices.opens(null), "Scholar opens when your plan begins.");
    assert.equal(
      notices.opensSaved("Friday, Nov 21"),
      "Scholar opens when your plan begins on Friday, Nov 21. Your message is saved.",
    );
    assert.equal(notices.creditsOut, "You’ve used today’s Scholar credits.");
    assert.equal(credits.renew(credits.renewsIn(372)), "They renew in 6 h 12 min.");
    assert.equal(credits.renewsIn(60), "1 h");
    assert.equal(credits.renewsIn(5), "5 min");
    assert.equal(credits.renewsInSpoken(372), "6 hours 12 minutes");
    assert.equal(credits.renewsInSpoken(61), "1 hour 1 minute");
    assert.equal(credits.low(15, credits.renewsIn(372)), "Scholar credits: 15% left · renews in 6 h 12 min");
    assert.equal(credits.lowSpoken(15, credits.renewsInSpoken(372)), "Scholar credits: 15 percent left. They renew in 6 hours 12 minutes.");
    for (const s of [notices.plan, notices.opens(null), notices.opensSaved(null), notices.creditsOut, credits.low(15, "1 h")]) {
      assert.ok(!/cancel|hurry|last chance|only today/i.test(s), `no pressure and no way out in Scholar's plan words: ${s}`);
    }
  });
}

// ================================================================== the live talk (step 39)
const talkOf = (w) => w.use("@/services/scholarTalk");

// The account's two answers (Google's AI, and its voice to ElevenLabs) and, optionally, its chosen voice.
function allowTalk(w, { ai = true, voice = true, voiceKey = null } = {}) {
  const store = w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState();
  const at = new Date(clock.now).toISOString();
  if (ai) store.setAiPermission("user_a", at);
  if (voice) store.setVoicePermission("user_a", at);
  if (voiceKey !== null) store.setScholarVoice("user_a", voiceKey);
}

const paid = (w, sub = "user_a") => void (w.server.state.serverPlans[sub] = "pro");

// The Talk screen's side: ElevenLabs' four calls, recorded. A typed turn can be made to fail.
function fakeControls(talk) {
  const controls = { starts: [], ends: 0, mutes: [], texts: [], failText: false };
  controls.detach = talk.attachTalkControls({
    start: (token, session) => void controls.starts.push({ token, session }),
    end: () => void (controls.ends += 1),
    setMuted: (muted) => void controls.mutes.push(muted),
    sendText: (words) => {
      controls.texts.push(words);
      return controls.failText ? Promise.reject(new Error("no connection")) : undefined;
    },
  });
  return controls;
}

const events = (w, name) => w.analyticsCalls.filter(([event]) => event === name).map(([, props]) => props);

// Begins a talk in CONV and connects it, as the Talk screen does.
async function liveTalk(w, talk, input = {}) {
  await talk.beginTalk({ conversationId: CONV, entryId: null, ...input });
  await settle(3);
  talk.talkEvent({ type: "connected" });
  await settle(2);
  assert.equal(talk.getTalkState().phase, "live");
}

async function talkChecks() {
  await test("talk gateway: a start carries the conversation, the voice key and the region in the database's region; an end only the talk", async (w) => {
    paid(w);
    allowTalk(w, { voiceKey: "deep" });
    const started = await repo(w).startTalk({ conversationId: CONV, entryId: null });
    assert.equal(started.ok, true);
    const [call] = calls(w, "scholar-voice-start");
    assert.deepEqual(Object.keys(call.body).sort(), ["conversationId", "region", "voice"]);
    assert.equal(call.body.voice, "deep", "the chosen voice, as a key: the phone never knows a voice id");
    assert.equal(call.body.region, w.use("@/utils/region").deviceRegionCode());
    assert.equal(call.headers["x-region"], "us-east-1");
    assert.equal(call.sub, "user_a", "the caller is the session's, never a body field");
    assert.equal(started.data.voice, "deep");
    assert.equal(started.data.conversationToken, "token-talk-1");
    assert.equal(started.data.session, "session-talk-1");
    assert.deepEqual(
      { talkSeconds: started.data.limits.talkSeconds, monthSecondsLeft: started.data.limits.monthSecondsLeft },
      { talkSeconds: 600, monthSecondsLeft: 3600 },
    );
    assert.match(started.data.limits.resetsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "a time the phone can read");
    const ended = await repo(w).finishTalk(started.data.talkId);
    assert.equal(ended.ok, true);
    assert.equal(ended.limits.monthSecondsLeft, 3540, "what is left is the server's number");
    const [end] = calls(w, "scholar-voice-end");
    assert.deepEqual(Object.keys(end.body), ["talkId"]);
    assert.equal(end.headers["x-region"], "us-east-1");
    // From a reflection, the entry rides along.
    const entry = serverRow(90);
    w.server.state.entries.push(entry);
    await repo(w).startTalk({ conversationId: mid(9), entryId: entry.id });
    assert.equal(calls(w, "scholar-voice-start")[1].body.entryId, entry.id);
    // An answer that is not the contract is UNKNOWN; a 402 carries talk_plan or talk_month.
    w.server.state.functions["scholar-voice-start"].push(() => json(200, { talkId: "talk-x" }));
    const odd = await repo(w).startTalk({ conversationId: CONV, entryId: null });
    assert.equal(odd.ok, false);
    assert.equal(odd.code, "UNKNOWN");
    w.server.state.talkMonthLeft = 20;
    const month = await repo(w).startTalk({ conversationId: CONV, entryId: null });
    assert.equal(month.ok, false);
    assert.equal(month.code, "LIMIT_REACHED");
    assert.equal(month.usage.kind, "talk_month");
    w.server.state.serverPlans.user_a = "free";
    // Its free conversation was another one (2026-11-20): a talk here is told by the plan.
    freeUsedElsewhere(w);
    const plan = await repo(w).startTalk({ conversationId: CONV, entryId: null });
    assert.equal(plan.code, "LIMIT_REACHED");
    assert.deepEqual([plan.usage.kind, plan.usage.resetsAt], ["talk_plan", null], "the free plan: the Talk screen opens the Paywall");
    const ends = new Date(BASE + 3 * 86_400_000).toISOString();
    w.server.state.serverPlans.user_a = "trial";
    w.server.state.serverPlanEnds.user_a = ends;
    const trial = await repo(w).startTalk({ conversationId: CONV, entryId: null });
    assert.equal(trial.code, "LIMIT_REACHED");
    assert.equal(trial.usage.kind, "talk_plan");
    assert.equal(Date.parse(trial.usage.resetsAt), Date.parse(ends), "a trial: the day Scholar, its talk included, opens");
  }, { permission: true });

  await test("talk gateway: no start without the AI permission, without the voice permission, offline or on the mock data; an end always", async (w) => {
    paid(w);
    const start = () => repo(w).startTalk({ conversationId: CONV, entryId: null });
    assert.equal((await start()).code, "NO_PERMISSION");
    allowTalk(w, { voice: false });
    assert.equal((await start()).code, "NO_VOICE_PERMISSION");
    allowTalk(w);
    offline(w);
    assert.equal((await start()).code, "OFFLINE");
    w.use("@/store/offlineStore").useOfflineStore.getState().setNet(true, true);
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    assert.equal((await start()).code, "MOCK");
    assert.equal(calls(w, "scholar-voice-start").length, 0, "nothing was sent");
    w.use("@/store/devStore").useDevStore.getState().setDataSource("supabase");
    const started = await start();
    assert.equal(started.ok, true);
    // A talk whose permission was taken back during it still closes.
    w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState().setVoicePermission("user_a", null);
    assert.equal((await repo(w).finishTalk(started.data.talkId)).ok, true);
  }, { permission: true });

  await test("talk: starting, connecting, live, ending, ended; the app's sound stops before and the playback mode comes back after", async (w) => {
    paid(w);
    allowTalk(w);
    const talk = talkOf(w);
    const controls = fakeControls(talk);
    const listening = w.appState.count();
    const begun = talk.beginTalk({ conversationId: CONV, entryId: null });
    assert.equal(talk.getTalkState().phase, "starting");
    assert.deepEqual(w.talkAudio.calls, ["quiet", "awake"], "the app's own sound stops and the screen stays awake first");
    assert.equal(w.appState.count(), listening + 1, "the talk watches the app's state");
    await begun;
    await settle(3);
    let state = talk.getTalkState();
    assert.equal(state.phase, "connecting");
    assert.equal(state.talkId, "talk-1");
    assert.equal(state.voice, "warm", "the default voice");
    assert.equal(state.secondsLeft, 600, "the talk's own cap, from the server");
    assert.deepEqual(controls.starts, [{ token: "token-talk-1", session: "session-talk-1" }], "ElevenLabs gets the token and the session");
    talk.talkEvent({ type: "connected" });
    assert.equal(talk.getTalkState().phase, "live");
    assert.deepEqual(events(w, "scholar_talk_started"), [{ voice: "warm" }]);
    await advance(65_000);
    assert.equal(talk.getTalkState().secondsLeft, 535, "the countdown follows the clock");
    talk.talkEvent({ type: "user_spoke" });
    assert.equal(talk.getTalkState().mode, "thinking");
    talk.talkEvent({ type: "mode", mode: "speaking" });
    assert.equal(talk.getTalkState().mode, "speaking");
    talk.talkEvent({ type: "mode", mode: "listening" });
    assert.equal(talk.getTalkState().mode, "listening");
    await advance(2_000);
    assert.ok(calls(w, "scholar-turn").length === 0, "a refresh only reads");
    await talk.endTalk();
    state = talk.getTalkState();
    assert.equal(state.phase, "ended");
    assert.equal(state.endedBy, "person");
    assert.equal(controls.ends, 1, "ElevenLabs' connection is closed");
    assert.deepEqual(w.talkAudio.calls, ["quiet", "awake", "asleep", "playback mode"], "the screen may sleep and the playback mode is back");
    assert.equal(w.appState.count(), listening, "the app's state is no longer watched");
    assert.deepEqual(events(w, "scholar_talk_ended"), [{ length: "1_to_5", ended_by: "person" }]);
    await talk.talkClosing();
    assert.deepEqual(calls(w, "scholar-voice-end").map((call) => call.body.talkId), ["talk-1"], "the server is told at once");
    const last = talk.getTalkState().last;
    assert.equal(last.requestedId, CONV);
    assert.equal(last.conversationId, CONV);
    assert.equal(last.limits.monthSecondsLeft, 3540, "what is left of the month, as the server answered the end");
    // The screen has gone: back to idle, with the last talk kept for the Conversation screen.
    talk.resetTalk();
    assert.equal(talk.getTalkState().phase, "idle");
    assert.equal(talk.getTalkState().last.seq, last.seq);
    controls.detach();
  }, { permission: true });

  await test("talk: the lock and the Home Screen end a talk, Control Center (inactive) does not", async (w) => {
    paid(w);
    allowTalk(w);
    const talk = talkOf(w);
    const controls = fakeControls(talk);
    await liveTalk(w, talk);
    w.appState.emit("inactive");
    await settle(3);
    assert.equal(talk.getTalkState().phase, "live", "inactive never ends a talk");
    assert.equal(controls.ends, 0);
    w.appState.emit("background");
    await settle(5);
    assert.equal(talk.getTalkState().phase, "ended");
    assert.equal(talk.getTalkState().endedBy, "left_app");
    assert.equal(controls.ends, 1);
    await talk.talkClosing();
    assert.equal(calls(w, "scholar-voice-end").length, 1);
  }, { permission: true });

  await test("talk: at its cap Scholar finishes its sentence, for 20 seconds at most; a silent talk ends at once; no time left is the server's 402", async (w) => {
    paid(w);
    allowTalk(w);
    w.server.state.talkMonthLeft = 90;
    const talk = talkOf(w);
    fakeControls(talk);
    // 90 seconds: at the cap Scholar is speaking, and the talk ends when it stops.
    await liveTalk(w, talk);
    assert.equal(talk.getTalkState().secondsLeft, 90);
    await advance(60_000);
    assert.equal(talk.getTalkState().secondsLeft, 30);
    talk.talkEvent({ type: "mode", mode: "speaking" });
    await advance(31_000);
    let state = talk.getTalkState();
    assert.equal(state.capReached, true);
    assert.equal(state.phase, "live", "Scholar finishes its sentence");
    talk.talkEvent({ type: "mode", mode: "listening" });
    await settle(5);
    assert.equal(talk.getTalkState().endedBy, "cap");
    await talk.talkClosing();
    // 30 seconds left of the month: speaking at the cap, it ends 20 seconds later.
    talk.resetTalk();
    await liveTalk(w, talk);
    assert.equal(talk.getTalkState().secondsLeft, 30);
    talk.talkEvent({ type: "mode", mode: "speaking" });
    await advance(31_000);
    await advance(18_000);
    assert.equal(talk.getTalkState().phase, "live", "the grace is 20 seconds");
    await advance(1_500);
    assert.equal(talk.getTalkState().phase, "ended");
    assert.equal(talk.getTalkState().endedBy, "cap");
    await talk.talkClosing();
    // Listening at the cap: it ends at once.
    w.server.state.talkMonthLeft = 60;
    talk.resetTalk();
    await liveTalk(w, talk);
    await advance(60_000);
    assert.equal(talk.getTalkState().phase, "ended");
    assert.equal(talk.getTalkState().endedBy, "cap");
    await talk.talkClosing();
    // No time left: the server refuses, and the talk fails with its numbers after the phone's side is put back.
    talk.resetTalk();
    const before = w.talkAudio.calls.length;
    await talk.beginTalk({ conversationId: CONV, entryId: null });
    await settle(3);
    state = talk.getTalkState();
    assert.equal(state.phase, "failed");
    assert.equal(state.failure.code, "LIMIT_REACHED");
    assert.equal(state.failure.usage.kind, "talk_month");
    assert.deepEqual(w.talkAudio.calls.slice(before), ["quiet", "awake", "asleep", "playback mode"]);
    assert.deepEqual(
      events(w, "scholar_talk_ended").map((props) => props.ended_by),
      ["cap", "cap", "cap"],
      "an ended talk is tracked once; a failed start never",
    );
  }, { permission: true });

  await test("talk: a heavy talk has its help line, no countdown and no cap, sends no event and costs nothing", async (w) => {
    paid(w);
    allowTalk(w);
    seedConversation(w, {
      heavy: true,
      messages: [
        userRow(1, "HEAVY words", { is_heavy: true }),
        answerRow(2, 1, { is_heavy: true, content: { blocks: [{ type: "text", text: "An answer." }], help: "abuse" } }),
      ],
    });
    const talk = talkOf(w);
    fakeControls(talk);
    await talk.beginTalk({ conversationId: CONV, entryId: null });
    await settle(5);
    let state = talk.getTalkState();
    assert.equal(state.heavy, true, "the server's answer says heavy");
    assert.equal(state.secondsLeft, null, "no countdown");
    assert.equal(state.help, "abuse", "the conversation's own help line");
    talk.talkEvent({ type: "connected" });
    await advance(700_000);
    state = talk.getTalkState();
    assert.equal(state.phase, "live", "never cut");
    assert.equal(state.capReached, false);
    await talk.endTalk();
    await talk.talkClosing();
    assert.deepEqual(events(w, "scholar_talk_started"), [], "no event about a hard moment");
    assert.deepEqual(events(w, "scholar_talk_ended"), []);
    assert.equal(talk.getTalkState().last.limits, null, "nothing of it is counted, so nothing is shown");
    assert.equal(calls(w, "scholar-voice-end").length, 1, "its end is still told");
    assert.equal(w.server.state.talkMonthLeft, 3600, "the month is untouched");
  }, { permission: true });

  await test("talk: a talk that turns heavy stops its countdown and takes the newest help line", async (w) => {
    paid(w);
    allowTalk(w);
    seedConversation(w, { messages: [userRow(1, "A question"), answerRow(2, 1)] });
    const talk = talkOf(w);
    fakeControls(talk);
    await liveTalk(w, talk);
    assert.equal(talk.getTalkState().secondsLeft, 600);
    // A turn of the talk was screened heavy: the server marks the conversation and saves the answer with its line.
    const conversation = w.server.state.scholarConversations.find((row) => row.id === CONV);
    conversation.is_heavy = true;
    w.server.state.scholarMessages.push(
      {
        id: mid(3), conversation_id: CONV, user_id: "user_a", role: "user", reply_to: null, input_type: "audio", status: "ready",
        error_code: null, is_heavy: true, claimed_at: null, created_at: stamp(clock.now + 10_000), content: { blocks: [{ type: "text", text: "HEAVY" }] },
      },
      {
        id: mid(4), conversation_id: CONV, user_id: "user_a", role: "scholar", reply_to: mid(3), input_type: null, status: "ready",
        error_code: null, is_heavy: true, claimed_at: null, created_at: stamp(clock.now + 11_000),
        content: { blocks: [{ type: "text", text: "An answer." }], help: "crisis" },
      },
    );
    talk.talkEvent({ type: "mode", mode: "speaking" });
    talk.talkEvent({ type: "mode", mode: "listening" });
    await advance(2_000);
    const state = talk.getTalkState();
    assert.equal(state.heavy, true);
    assert.equal(state.secondsLeft, null);
    assert.equal(state.help, "crisis");
    await advance(700_000);
    assert.equal(talk.getTalkState().phase, "live", "never cut once heavy");
    await talk.endTalk();
    assert.deepEqual(events(w, "scholar_talk_ended"), [], "a talk that ended heavy is not tracked");
  }, { permission: true });

  await test("talk: a connection that never comes ends after 20 seconds; a dropped one ends with no second close", async (w) => {
    paid(w);
    allowTalk(w);
    const talk = talkOf(w);
    const controls = fakeControls(talk);
    await talk.beginTalk({ conversationId: CONV, entryId: null });
    await settle(3);
    await advance(19_000);
    assert.equal(talk.getTalkState().phase, "connecting");
    await advance(1_500);
    assert.equal(talk.getTalkState().phase, "ended");
    assert.equal(talk.getTalkState().endedBy, "dropped");
    assert.equal(controls.ends, 1);
    assert.deepEqual(events(w, "scholar_talk_ended"), [], "a talk that never went live is not tracked");
    await talk.talkClosing();
    talk.resetTalk();
    await liveTalk(w, talk);
    talk.talkEvent({ type: "disconnected" });
    await settle(5);
    assert.equal(talk.getTalkState().endedBy, "dropped");
    assert.equal(controls.ends, 1, "a connection that is already gone is not closed again");
    talk.resetTalk();
    await liveTalk(w, talk);
    talk.talkEvent({ type: "error" });
    await settle(5);
    assert.equal(talk.getTalkState().endedBy, "dropped");
    assert.equal(controls.ends, 2, "after an error the connection is closed");
    await talk.talkClosing();
  }, { permission: true });

  await test("talk: one talk at a time; ending while it starts closes the server's talk and never reaches ElevenLabs", async (w) => {
    paid(w);
    allowTalk(w);
    let release;
    const held = new Promise((resolve) => (release = resolve));
    w.server.state.functions["scholar-voice-start"].push((call) => held.then(() => w.server.state.scholarRoutes.voiceStart(call.body, call.sub)));
    const talk = talkOf(w);
    const controls = fakeControls(talk);
    const first = talk.beginTalk({ conversationId: CONV, entryId: null });
    await settle(3);
    await talk.beginTalk({ conversationId: CONV, entryId: null });
    await settle(3);
    assert.equal(calls(w, "scholar-voice-start").length, 1, "a second start while one is on does nothing");
    await talk.endTalk();
    assert.equal(talk.getTalkState().phase, "ended");
    assert.equal(controls.ends, 0, "nothing to close at ElevenLabs yet");
    release();
    await first;
    await settle(5);
    await talk.talkClosing();
    assert.deepEqual(controls.starts, [], "the token never reaches ElevenLabs");
    assert.deepEqual(calls(w, "scholar-voice-end").map((call) => call.body.talkId), ["talk-1"], "the talk the server opened is closed");
  }, { permission: true });

  await test("talk: the end is told twice more after a failure, never after NOT_FOUND", async (w) => {
    paid(w);
    allowTalk(w);
    const talk = talkOf(w);
    fakeControls(talk);
    const queue = w.server.state.functions["scholar-voice-end"];
    queue.push(() => W.fnError(500, "INTERNAL"), () => W.fnError(500, "INTERNAL"));
    await liveTalk(w, talk);
    await talk.endTalk();
    await settle(3);
    assert.equal(calls(w, "scholar-voice-end").length, 1);
    await advance(2_000);
    assert.equal(calls(w, "scholar-voice-end").length, 2);
    await advance(5_000);
    assert.equal(calls(w, "scholar-voice-end").length, 3);
    await talk.talkClosing();
    assert.equal(talk.getTalkState().last.limits.monthSecondsLeft, 3540, "the third try answered");
    await advance(60_000);
    assert.equal(calls(w, "scholar-voice-end").length, 3, "and nothing more");
    talk.resetTalk();
    queue.push(() => W.fnError(404, "NOT_FOUND"));
    await liveTalk(w, talk);
    await talk.endTalk();
    await advance(60_000);
    assert.equal(calls(w, "scholar-voice-end").length, 4, "NOT_FOUND is not tried again");
  }, { permission: true });

  await test("talk: mute reaches ElevenLabs only while live; sign-out ends a talk and keeps nothing of it", async (w) => {
    paid(w);
    allowTalk(w);
    const talk = talkOf(w);
    const controls = fakeControls(talk);
    await talk.beginTalk({ conversationId: CONV, entryId: null });
    talk.setTalkMuted(true);
    assert.deepEqual(controls.mutes, [], "not before the talk is live");
    await settle(3);
    talk.talkEvent({ type: "connected" });
    talk.setTalkMuted(true);
    assert.deepEqual(controls.mutes, [true]);
    assert.equal(talk.getTalkState().muted, true);
    await talk.endLiveTalk();
    const state = talk.getTalkState();
    assert.equal(state.phase, "idle");
    assert.equal(state.last, null, "nothing of it is kept");
    assert.equal(state.muted, false);
    assert.equal(controls.ends, 1);
    await talk.talkClosing();
    assert.equal(calls(w, "scholar-voice-end").length, 1, "its end is told while the session still works");
  }, { permission: true });

  await test("talk: Hold mutes the microphone and tells Scholar to wait, Resume unmutes and says go on; only while live, and the talk's clock runs on", async (w) => {
    paid(w);
    allowTalk(w);
    const talk = talkOf(w);
    const controls = fakeControls(talk);
    const { TALK_HOLD_WORDS, TALK_RESUME_WORDS } = w.use("@/constants/app");
    await talk.beginTalk({ conversationId: CONV, entryId: null });
    talk.setTalkHeld(true);
    assert.deepEqual([controls.mutes, controls.texts], [[], []], "nothing before the talk is live");
    await settle(3);
    talk.talkEvent({ type: "connected" });
    await advance(10_000);
    talk.setTalkHeld(true);
    let state = talk.getTalkState();
    assert.equal(state.held, true);
    assert.equal(state.muted, true, "holding mutes the microphone");
    assert.deepEqual(controls.mutes, [true]);
    assert.deepEqual(controls.texts, [TALK_HOLD_WORDS], "Scholar is told to wait, as a typed turn");
    talk.setTalkHeld(true);
    assert.equal(controls.texts.length, 1, "holding twice sends nothing more");
    talk.setTalkMuted(false);
    assert.equal(talk.getTalkState().muted, true, "the microphone button does nothing while the talk is held");
    assert.deepEqual(controls.mutes, [true]);
    await advance(20_000);
    assert.equal(talk.getTalkState().secondsLeft, 570, "the talk's clock runs on while it is held: the time is the server's");
    talk.setTalkHeld(false);
    state = talk.getTalkState();
    assert.deepEqual([state.held, state.muted], [false, false]);
    assert.deepEqual(controls.mutes, [true, false]);
    assert.deepEqual(controls.texts, [TALK_HOLD_WORDS, TALK_RESUME_WORDS], "Scholar is asked to go on");
    // A typed turn that cannot be sent changes nothing: the talk goes on, and the person can speak instead.
    controls.failText = true;
    talk.setTalkHeld(true);
    await settle(2);
    assert.equal(talk.getTalkState().held, true);
    assert.equal(talk.getTalkState().phase, "live");
    // Ending a held talk clears the hold, and nothing is sent once the talk is over.
    await talk.endTalk();
    state = talk.getTalkState();
    assert.deepEqual([state.held, state.muted], [false, false]);
    talk.setTalkHeld(true);
    assert.equal(controls.texts.length, 3, "no hold once the talk is over");
    await talk.talkClosing();
  }, { permission: true });

  await test("talk orb: a quiet room is nothing, a full voice is one, the orb rises at once and settles over about a second", async (w) => {
    const { orbLevel, settleLevel, LEVEL_FLOOR, LEVEL_CEILING, LEVEL_RELEASE } = w.use("@/utils/orbLevel");
    assert.equal(orbLevel([]), 0);
    assert.equal(orbLevel([0.03, 0.02, 0.02, 0.01, 0.01]), 0, "the room's own noise is under the floor");
    assert.ok(orbLevel([LEVEL_FLOOR, LEVEL_FLOOR, LEVEL_FLOOR]) < 1e-9, "the floor is nothing");
    assert.ok(orbLevel([LEVEL_CEILING, LEVEL_CEILING, LEVEL_CEILING]) > 1 - 1e-9, "the ceiling is a full voice");
    assert.equal(orbLevel([1, 1, 1, 1, 1]), 1);
    const some = orbLevel([0.5, 0.5, 0.1, 0.05, 0.02]);
    const more = orbLevel([0.7, 0.7, 0.2, 0.1, 0.05]);
    assert.ok(some > 0.2 && some < 0.8, "a voice in a few of the bands is in between: " + some);
    assert.ok(more > some, "a louder voice is a higher level");
    for (const odd of [[Number.NaN, Number.POSITIVE_INFINITY, -5], [3, 3, 3], [Number.NaN]]) {
      const level = orbLevel(odd);
      assert.ok(Number.isFinite(level) && level >= 0 && level <= 1, "whatever the processor sends is a level: " + level);
    }
    assert.equal(orbLevel([Number.NaN, Number.POSITIVE_INFINITY, -5]), 0, "what is not a number counts as nothing");
    assert.equal(settleLevel(0, 0.8), 0.8, "a louder report is taken at once");
    assert.equal(settleLevel(0.8, 0.9), 0.9);
    assert.ok(Math.abs(settleLevel(0.8, 0) - 0.8 * LEVEL_RELEASE) < 1e-9, "a quieter one only lets the level fall by a share");
    let held = 1;
    let reports = 0;
    while (held > 0) {
      held = settleLevel(held, 0);
      reports += 1;
      assert.ok(reports < 100, "the orb comes to rest");
    }
    // Reports come every 40 ms: it is at rest in 0.8 to 1.6 seconds, and below a half in under a quarter of a second.
    assert.ok(reports >= 20 && reports <= 40, "reports until rest: " + reports);
    let half = 1;
    let toHalf = 0;
    while (half > 0.5) {
      half = settleLevel(half, 0);
      toHalf += 1;
    }
    assert.ok(toHalf * 40 < 250, "it is under half in under a quarter of a second: " + toHalf * 40 + " ms");
  });

  await test("talk orb: the outline is round at rest and changes shape with the voice, fast up and slower down, and sleeps when muted", async (w) => {
    const shape = w.use("@/utils/orbShape");
    const { LEVEL_FLOOR, LEVEL_CEILING } = w.use("@/utils/orbLevel");
    const sum = (values) => values.reduce((total, value) => total + value, 0);
    // The bands: each stretched like the level, low the first two, mid the third, high the last two.
    assert.equal(shape.bandLevel(LEVEL_FLOOR), 0);
    assert.equal(shape.bandLevel(LEVEL_CEILING), 1);
    assert.equal(shape.bandLevel(Number.NaN), 0);
    assert.deepEqual(shape.voiceBands([LEVEL_CEILING, 0, LEVEL_CEILING, 0, LEVEL_CEILING]), [0.5, 1, 0.5]);
    assert.deepEqual(shape.voiceBands([]), [0, 0, 0], "a report with no bands is silence");
    // The waves: about 1.5% of the radius at rest, at most about 11% with a full voice, nothing when still and silent.
    const rest = shape.lobeAmplitudes(0, 0, 0, 1);
    assert.ok(Math.abs(sum(rest) - 0.015) < 1e-9, "at rest: " + sum(rest));
    const full = shape.lobeAmplitudes(1, 1, 1, 1);
    assert.ok(sum(full) > 0.1 && sum(full) < 0.12, "a full voice: " + sum(full));
    assert.deepEqual(shape.lobeAmplitudes(0, 0, 0, 0), [0, 0, 0, 0]);
    const deep = shape.lobeAmplitudes(1, 0, 0, 0);
    const bright = shape.lobeAmplitudes(0, 0, 1, 0);
    assert.ok(deep[0] > deep[3] && bright[3] > bright[0], "a deep voice moves the broad lobes and a bright one the fine ones");
    // The goals.
    const goal = (state, still = false) => shape.orbGoal(state, still);
    assert.deepEqual([goal("speaking").agent, goal("speaking").mic], [1, 0], "Scholar's voice while Scholar speaks");
    assert.deepEqual([goal("listening").agent, goal("listening").mic, goal("listening").breath], [0, 1, 1]);
    for (const state of ["muted", "held", "ended"]) {
      assert.equal(goal(state).motion, 0, state + " is a still circle");
      assert.equal(goal(state).glowOn, 0, state + " has no glow");
      assert.ok(goal(state).alpha < 1, state + " is dimmer");
    }
    assert.equal(goal("ended").spin, 0, "the ribbons rest when the talk is over");
    assert.equal(goal("muted").spin, 1, "and turn while muted or held");
    assert.deepEqual(["connecting", "thinking", "listening", "speaking"].map((state) => goal(state).ripple), [true, true, false, false]);
    // A frame at a time, as the UI thread steps it.
    const run = (sim, state, agent, mic, ms, still = false) => {
      for (let t = 0; t < ms; t += 16) shape.stepOrb(sim, goal(state, still), agent, mic, 16);
      return sim;
    };
    const loud = [1, 1, 1, 1];
    const quiet = [0, 0, 0, 0];
    const uniforms = (sim, still = false) => shape.orbUniforms(sim, 200, 320, 1 / 3, still);
    let sim = run(shape.createOrbSim(), "speaking", quiet, quiet, 1000);
    const before = uniforms(sim);
    assert.ok(sum(before.amp) < 0.016, "quiet: a breath of an outline");
    run(sim, "speaking", loud, quiet, 160);
    const rising = uniforms(sim);
    assert.ok(rising.level > 0.85, "a voice is taken within about a tenth of a second: " + rising.level);
    assert.ok(sum(rising.amp) > 0.08, "and the outline bulges with it: " + sum(rising.amp));
    assert.ok(rising.swell > before.swell, "the sphere swells a little");
    assert.ok(rising.glow > before.glow, "and glows");
    run(sim, "speaking", quiet, quiet, 160);
    assert.ok(uniforms(sim).level > 0.2, "it falls slower than it rises");
    run(sim, "speaking", quiet, quiet, 1000);
    assert.ok(uniforms(sim).level < 0.01, "and comes to rest");
    // The person's voice does not move the orb while Scholar speaks.
    sim = run(shape.createOrbSim(), "speaking", quiet, loud, 1000);
    assert.ok(uniforms(sim).level < 0.01, "only the voice the orb follows counts");
    // The waves travel faster with the voice.
    const travel = (agent) => {
      const one = run(shape.createOrbSim(), "speaking", agent, quiet, 400);
      const start = one.phase[0];
      run(one, "speaking", agent, quiet, 500);
      return Math.abs(one.phase[0] - start);
    };
    assert.ok(travel(loud) > travel(quiet) * 2, "a full voice runs the waves about three times as fast");
    // Muted: a still circle, its waves stopped, the ribbons still turning.
    sim = run(shape.createOrbSim(), "muted", quiet, quiet, 1500);
    const muted = uniforms(sim);
    assert.ok(sum(muted.amp) < 0.0005, "muted is round: " + sum(muted.amp));
    assert.equal(muted.glow, 0);
    assert.ok(Math.abs(muted.alpha - 0.7) < 0.01);
    const phase = sim.phase[0];
    const turn = sim.turn[0];
    run(sim, "muted", quiet, quiet, 500);
    assert.ok(Math.abs(sim.phase[0] - phase) < 1e-3, "its waves are still");
    assert.ok(sim.turn[0] !== turn, "its ribbons turn");
    // Reduce Motion: round, no swell, nothing turns or travels, no ring; the voice only brightens the light and the glow.
    sim = run(shape.createOrbSim(), "thinking", quiet, quiet, 300, true);
    const still = { phase: [...sim.phase], turn: [...sim.turn], warp: [...sim.warp] };
    run(sim, "speaking", loud, quiet, 1000, true);
    const calm = uniforms(sim, true);
    assert.deepEqual(calm.amp, [0, 0, 0, 0]);
    assert.equal(calm.swell, 1);
    assert.equal(calm.ring, 1, "no ring");
    assert.deepEqual([sim.phase, sim.turn, sim.warp], [still.phase, still.turn, still.warp], "nothing moves");
    assert.ok(calm.level > 0.9 && calm.glow > 0.5, "the voice still brightens it");
    // Rings: one every 1.4 s while thinking; the one that is out finishes when thinking ends, and no new one starts.
    sim = run(shape.createOrbSim(), "thinking", quiet, quiet, 50);
    assert.ok(uniforms(sim).ring < 0.2, "a ring leaves the sphere");
    run(sim, "thinking", quiet, quiet, 1400);
    assert.ok(uniforms(sim).ring < 0.2, "and another 1.4 s later");
    run(sim, "speaking", quiet, quiet, 700);
    assert.ok(uniforms(sim).ring < 1, "the ring that is out finishes");
    run(sim, "speaking", quiet, quiet, 1400);
    assert.equal(uniforms(sim).ring, 1, "and no new one starts");
    // A long frame (the app was busy) moves the orb only a little; a frame never goes back.
    const jump = shape.createOrbSim();
    shape.stepOrb(jump, goal("speaking"), loud, quiet, 2000);
    assert.ok(jump.agent[0] < 0.8, "one long frame is not a jump to the voice");
    shape.stepOrb(jump, goal("speaking"), loud, quiet, -50);
    // The uniforms' geometry, and every angle kept in one turn.
    const shown = uniforms(run(shape.createOrbSim(), "listening", loud, loud, 30_000));
    assert.deepEqual([shown.center, shown.radius, shown.pixel], [[160, 160], 100, 1 / 3]);
    for (const angle of [...shown.phase, ...shown.turn, ...shown.warp]) {
      assert.ok(angle >= 0 && angle < Math.PI * 2, "an angle stays within one turn: " + angle);
    }
  });

  await test("talk orb: the shader's uniforms are the model's, by name, order and size", async (w) => {
    const shape = w.use("@/utils/orbShape");
    const { ORB_SHADER } = w.use("@/components/scholar/orbShader");
    const declared = [...ORB_SHADER.matchAll(/^uniform float(\d?) (\w+);$/gm)].map((match) => [match[2], Number(match[1] || 1)]);
    const model = shape.orbUniforms(shape.createOrbSim(), 200, 320, 1 / 3, false);
    assert.deepEqual(
      declared.map(([name]) => name),
      Object.keys(model),
      "the same uniforms, in the order the shader declares them",
    );
    for (const [name, floats] of declared) {
      const value = model[name];
      assert.equal(Array.isArray(value) ? value.length : 1, floats, name + " has the shader's size");
    }
    assert.match(ORB_SHADER, /half4 main\(float2 p\)/);
    assert.match(ORB_SHADER, /return half4\(float4\(col \* a, a\) \+ back \* \(1\.0 - a\)\);/, "premultiplied, the sphere over the glow");
    assert.match(ORB_SHADER, /float fade = 1\.0 - smoothstep\(center\.x \* 0\.8, center\.x \* 0\.97, r\);/, "the glow is gone before the canvas's edge");
    const tokens = { PLUM: "#5B3A5E", PLUM_DEEP: "#3E2741", ROSE: "#D4A5A5" };
    for (const [name, hex] of Object.entries(tokens)) {
      const rgb = new RegExp("const float3 " + name + " = float3\\(([\\d.]+), ([\\d.]+), ([\\d.]+)\\);").exec(ORB_SHADER);
      assert.ok(rgb, name + " is declared");
      const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
      channels.forEach((channel, index) => assert.ok(Math.abs(Number(rgb[index + 1]) - channel) < 0.002, name + " is the brand token"));
    }
  });

  // ElevenLabs' timing of what Scholar is about to say, 100 ms a character unless said otherwise.
  const piece = (words, step = 100) => {
    const chars = [...words];
    return { chars, char_start_times_ms: chars.map((_, i) => i * step), char_durations_ms: chars.map(() => step) };
  };

  await test("talk captions: Scholar's words come a phrase ahead of the voice and light as they are said; the pad is no word, a word split across pieces is one, and the block goes after its last word", async (w) => {
    const c = w.use("@/services/talkCaptions");
    c.resetCaptions();
    let notified = 0;
    const stop = c.subscribeCaptions(() => (notified += 1));
    const shown = () => (c.getCaptions().scholar?.words ?? []).map((word) => (word.lit ? word.text.toUpperCase() : word.text));
    const t0 = clock.now;
    // "Hi Sch" then "olar" and the server's invisible pad before "here".
    c.captionsScholarAlignment(piece("Hi Sch"));
    assert.deepEqual(shown(), [], "nothing before the voice starts");
    await advance(c.CAPTION_DELAY_MS - 1);
    assert.deepEqual(shown(), []);
    await advance(1);
    assert.deepEqual(shown(), ["HI", "Sch"], "the first word lights as the voice starts, the next waits dim");
    c.captionsScholarAlignment(piece("olar​ ​ here"));
    assert.deepEqual(shown(), ["HI", "Scholar"], "a word the last piece left open grows in place");
    await advance(300);
    assert.deepEqual(shown(), ["HI", "SCHOLAR"]);
    await advance(300);
    assert.deepEqual(shown(), ["HI", "SCHOLAR", "here"], "the next piece starts where the last one ends");
    await advance(800);
    assert.deepEqual(shown(), ["HI", "SCHOLAR", "HERE"], "and the pad between them is no word");
    assert.ok(notified > 0, "the screen is told of each change");
    // The last word is said at 2.0 s; the block stays two seconds, then fades and goes.
    await advance(t0 + 4_000 - clock.now - 1);
    assert.equal(c.getCaptions().scholar.leaving, null, "it stays two seconds after its last word");
    await advance(1);
    assert.equal(c.getCaptions().scholar.leaving, "fade");
    await advance(c.CAPTION_FADE_MS);
    assert.equal(c.getCaptions().scholar, null);
    stop();

    // A long piece: each word shows at most a second and a half before it is said, never the whole answer at once.
    c.resetCaptions();
    c.captionsScholarAlignment(piece("a b c d e f", 400));
    await advance(c.CAPTION_DELAY_MS);
    assert.deepEqual(shown(), ["A", "b"], "a lights now and b, 0.8 s away, waits dim");
    await advance(100);
    assert.deepEqual(shown(), ["A", "b", "c"], "c shows 1.5 s before it is said");
    await advance(700);
    assert.deepEqual(shown(), ["A", "B", "c"], "d is still more than 1.5 s away");
    await advance(100);
    assert.deepEqual(shown(), ["A", "B", "c", "d"]);

    // Timing that is not what ElevenLabs sends is not used.
    c.resetCaptions();
    for (const bad of [
      null,
      { chars: [], char_start_times_ms: [], char_durations_ms: [] },
      { chars: ["a"], char_start_times_ms: [0, 1], char_durations_ms: [1] },
      { chars: ["a"], char_start_times_ms: [-1], char_durations_ms: [1] },
      { chars: ["a"], char_start_times_ms: [Number.NaN], char_durations_ms: [1] },
      { chars: [1], char_start_times_ms: [0], char_durations_ms: [1] },
      { chars: "a", char_start_times_ms: [0], char_durations_ms: [1] },
    ]) {
      assert.equal(c.readAlignment(bad), null);
      c.captionsScholarAlignment(bad);
    }
    assert.deepEqual(c.getCaptions(), { person: null, scholar: null });
    assert.equal(c.cleanCaptionText("  Wait.​ ​ ⁠ "), "Wait.");

    // A very long answer keeps its newest words: older ones have long gone up out of sight.
    c.captionsScholarAlignment(piece("x ".repeat(c.CAPTION_MAX_WORDS + 1), 10));
    await advance(5_000);
    assert.equal(shown().length, c.CAPTION_MAX_WORDS + 1 - 60);
  });

  await test("talk captions: the person's sentence shows once heard and goes three seconds after Scholar starts, or eight; a new turn clears what was said but keeps an answer on its way; speaking over Scholar cuts it; reset forgets all", async (w) => {
    const c = w.use("@/services/talkCaptions");
    const person = () => c.getCaptions().person;
    const scholar = () => c.getCaptions().scholar;
    c.resetCaptions();
    c.captionsPersonWords("  How do I​ rest?  ", true);
    assert.deepEqual([person().text, person().final, person().leaving], ["How do I rest?", true, false]);
    c.captionsScholarAlignment(piece("Rest comes."));
    await advance(c.CAPTION_DELAY_MS + c.CAPTION_PERSON_AFTER_MS - 1);
    assert.equal(person().leaving, false);
    await advance(1);
    assert.equal(person().leaving, true, "it fades three seconds after Scholar's first word");
    await advance(c.CAPTION_FADE_MS);
    assert.equal(person(), null);

    c.resetCaptions();
    c.captionsPersonWords("Are you there?", true);
    await advance(c.CAPTION_PERSON_MAX_MS - 1);
    assert.equal(person().leaving, false);
    await advance(1);
    assert.equal(person().leaving, true, "with no answer it goes after eight seconds");

    // While they are still speaking (if ElevenLabs ever sends it), the same line fills in.
    c.resetCaptions();
    c.captionsPersonWords("​ ", false);
    assert.equal(person(), null, "nothing to show is nothing");
    c.captionsPersonWords("How do", false);
    const key = person().key;
    c.captionsPersonWords("How do I rest", false);
    assert.deepEqual([person().key, person().text, person().final], [key, "How do I rest", false]);
    c.captionsPersonWords("How do I rest?", true);
    assert.deepEqual([person().key, person().final], [key, true], "and is the same line once heard");

    // A new turn: what Scholar had finished saying fades.
    c.resetCaptions();
    c.captionsScholarAlignment(piece("Peace."));
    await advance(1_000);
    assert.equal(scholar().leaving, null);
    c.captionsPersonWords("Tell me more.", true);
    assert.equal(scholar().leaving, "fade");
    assert.equal(person().text, "Tell me more.");

    // An answer whose timing came a moment before the sentence stays, and the sentence goes three seconds after it starts.
    c.resetCaptions();
    c.captionsScholarAlignment(piece("Here is a thought."));
    c.captionsPersonWords("Is it enough?", true);
    assert.equal(scholar().leaving, null, "an answer on its way stays");
    await advance(c.CAPTION_DELAY_MS + c.CAPTION_PERSON_AFTER_MS);
    assert.equal(person().leaving, true);
    c.resetCaptions();
    c.captionsScholarAlignment(piece("A longer answer goes on and on."));
    await advance(500);
    c.captionsPersonWords("Is it enough?", true);
    assert.equal(scholar().leaving, null, "an answer already speaking stays");
    await advance(c.CAPTION_PERSON_AFTER_MS - 1);
    assert.equal(person().leaving, false);
    await advance(1);
    assert.equal(person().leaving, true, "the sentence stays its usual time from when it was heard");

    // Speaking over Scholar: its words go at once, and none of its later words comes back.
    c.resetCaptions();
    c.captionsScholarAlignment(piece("One two three four five six seven", 300));
    await advance(c.CAPTION_DELAY_MS);
    assert.ok(scholar().words.length > 0);
    c.captionsInterrupt();
    assert.equal(scholar().leaving, "cut");
    await advance(c.CAPTION_CUT_MS);
    assert.equal(scholar(), null);
    await advance(20_000);
    assert.equal(scholar(), null);
    c.captionsScholarAlignment(piece("New."));
    await advance(c.CAPTION_DELAY_MS);
    assert.deepEqual(scholar().words.map((word) => word.text), ["New."], "the next answer is a new block");

    // The timers of an answer that was cut, or of a talk that was reset, never touch what comes after: the person’s next
    // sentence keeps its whole time, because no old word marks a new answer as started.
    for (const end of ["cut", "reset"]) {
      c.resetCaptions();
      c.captionsScholarAlignment(piece("One two three four five six seven", 300));
      await advance(c.CAPTION_DELAY_MS);
      if (end === "cut") c.captionsInterrupt();
      else c.resetCaptions();
      await advance(c.CAPTION_CUT_MS);
      c.captionsPersonWords("Wait, one more thing.", true);
      await advance(c.CAPTION_PERSON_MAX_MS - 1);
      assert.equal(person().leaving, false, end + ": an old word never marks the next answer as started");
      await advance(1);
      assert.equal(person().leaving, true);
    }

    // A talk that ends forgets everything, and nothing scheduled comes back.
    c.captionsPersonWords("Hello.", true);
    c.captionsScholarAlignment(piece("Hi there."));
    c.resetCaptions();
    assert.deepEqual(c.getCaptions(), { person: null, scholar: null });
    await advance(30_000);
    assert.deepEqual(c.getCaptions(), { person: null, scholar: null });
  });

  await test("talk captions: the switch is kept per account on this phone, and only off is stored", async (w) => {
    const prefs = w.use("@/store/profilePrefsStore");
    const store = prefs.useProfilePrefsStore;
    const { useTalkCaptions } = w.use("@/hooks/useAiPermission");
    const handle = w.renderHook(useTalkCaptions);
    assert.equal(handle.result.current.on, true, "on by default");
    handle.result.current.setOn(false);
    await settle(2);
    assert.equal(store.getState().byUser.user_a.talkCaptions, false);
    assert.equal(handle.result.current.on, false);
    handle.result.current.setOn(true);
    await settle(2);
    assert.ok(!("talkCaptions" in store.getState().byUser.user_a), "on is the default, not a stored value");
    assert.equal(handle.result.current.on, true);
    assert.equal(store.getState().byUser.user_b, undefined, "another account is untouched");
    handle.unmount();
    const merged = store.persist.getOptions().merge(
      { byUser: { a: { talkCaptions: false }, b: { talkCaptions: "off" }, c: { talkCaptions: true } } },
      store.getState(),
    );
    assert.deepEqual(
      ["a", "b", "c"].map((id) => merged.byUser[id].talkCaptions),
      [false, undefined, undefined],
      "only an explicit false turns them off",
    );
  });

  await test("talk: a failed talk turn is a spoken message with its words, and Try again sends it under the same id with no upload", async (w) => {
    seedConversation(w, {
      messages: [
        userRow(1, "A spoken question", { input_type: "audio", status: "failed", error_code: "AI_UNAVAILABLE" }),
      ],
    });
    const handle = renderConversation(w, { conversationId: CONV });
    const state = await until(handle, (s) => s.phase === "ready" && s.messages.length === 1, "loaded");
    assert.equal(state.messages[0].inputType, "audio");
    state.retry(mid(1));
    await until(handle, (s) => !s.sending && s.messages.length === 2, "the answer");
    const [call] = calls(w, "scholar-turn");
    assert.equal(call.body.messageId, mid(1), "the same id");
    assert.deepEqual(call.body.input, { type: "audio", durationMs: 1_000 }, "the saved words answer it: no recording");
    assert.equal(w.upload.calls.length, 0, "nothing is uploaded");
    handle.unmount();
  });

  await test("talk: after a talk the conversation reads its turns from the server, in the conversation the server answered", async (w) => {
    seedConversation(w, { messages: [userRow(1, "A question"), answerRow(2, 1)] });
    const handle = renderConversation(w, { conversationId: CONV });
    await until(handle, (s) => s.phase === "ready" && s.messages.length === 2, "loaded");
    // The talk's two turns, saved on the server as this conversation's spoken messages.
    w.server.state.scholarMessages.push(
      {
        id: mid(3), conversation_id: CONV, user_id: "user_a", role: "user", reply_to: null, input_type: "audio", status: "ready",
        error_code: null, is_heavy: false, claimed_at: null, created_at: stamp(clock.now + 5_000), content: { blocks: [{ type: "text", text: "Spoken" }] },
      },
      {
        id: mid(4), conversation_id: CONV, user_id: "user_a", role: "scholar", reply_to: mid(3), input_type: null, status: "ready",
        error_code: null, is_heavy: false, claimed_at: null, created_at: stamp(clock.now + 6_000), content: { blocks: [{ type: "text", text: "Said." }] },
      },
    );
    await handle.result.current.refreshAfterTalk(CONV);
    const state = await until(handle, (s) => s.messages.length === 4, "the talk's turns");
    assert.deepEqual(state.messages.map((message) => message.id), [mid(1), mid(2), mid(3), mid(4)]);
    assert.equal(calls(w, "scholar-turn").length, 0, "reading is not sending");
    handle.unmount();
  });
}

// A server module with no imports, run in Node: the app's checks can then hold what it sends to what the server answers.
function loadPure(rel) {
  const ts = require(path.join(REPO, "node_modules", "typescript"));
  const out = ts.transpileModule(fs.readFileSync(path.join(REPO, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", out)(module, module.exports);
  return module.exports;
}

function talkSourceChecks() {
  sourceCheck("talk: the phone's voice keys equal the server's, and the default is the same", () => {
    const app = read("src/constants/scholarVoices.ts");
    const server = read("supabase/functions/_shared/voice/voices.ts");
    const appKeys = /SCHOLAR_VOICE_KEYS = \[([^\]]+)\]/.exec(app)[1].match(/"(\w+)"/g).map((key) => key.slice(1, -1));
    const serverKeys = [...server.matchAll(/\{ key: "(\w+)"/g)].map((match) => match[1]);
    assert.deepEqual(appKeys, serverKeys);
    assert.equal(/DEFAULT_SCHOLAR_VOICE: ScholarVoiceKey = "(\w+)"/.exec(app)[1], /DEFAULT_VOICE: VoiceKey = "(\w+)"/.exec(server)[1]);
    const ids = [...server.matchAll(/elevenLabsVoiceId: "(\w+)"/g)].map((match) => match[1]);
    assert.equal(ids.length, appKeys.length);
    for (const rel of ["src/constants/scholarVoices.ts", "src/constants/sounds.ts", "src/constants/copy.ts"]) {
      for (const id of ids) assert.ok(!read(rel).includes(id), `the phone holds no voice id (${rel})`);
    }
    const sounds = read("src/constants/sounds.ts");
    for (const key of appKeys) assert.match(sounds, new RegExp(`\\b${key}:`), `a preview for ${key}`);
  });

  sourceCheck("talk: only the Talk screen loads ElevenLabs, and only once its route opens; Talk shows only where a talk can run", () => {
    const files = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(path.join(REPO, dir))) {
        const rel = `${dir}/${name}`;
        if (fs.statSync(path.join(REPO, rel)).isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(name)) files.push(rel);
      }
    };
    walk("src");
    const importers = files.filter((rel) => /from "@elevenlabs\/|from "@livekit\//.test(read(rel)));
    assert.deepEqual(importers.sort(), ["src/screens/scholar/ScholarTalkScreen.tsx", "src/services/voiceSession.ts"]);
    const sessionUsers = files.filter((rel) => /from "@\/services\/voiceSession"/.test(read(rel)));
    assert.deepEqual(sessionUsers, ["src/screens/scholar/ScholarTalkScreen.tsx"]);
    const screenUsers = files.filter((rel) => /screens\/scholar\/ScholarTalkScreen/.test(read(rel)));
    assert.deepEqual(screenUsers, ["src/navigation/RootNavigator.tsx"]);
    assert.match(read("src/navigation/RootNavigator.tsx"), /getComponent=\{loadTalkScreen\}/, "loaded when the route opens");
    const conversation = read("src/screens/scholar/ConversationScreen.tsx");
    assert.match(conversation, /const canTalk = voiceSupported\(\) && !\(chat\.heavy && known && tier !== "pro"\);/, "in a heavy conversation Talk shows for Pro alone: never a paywall or a plan notice there");
    assert.match(read("src/services/talkAudio.ts"), /stopScholarAudio\(\);/);
  });

  sourceCheck("talk: the composer draws the Talk button in the Type row and in the idle Speak row, from one component, and never while a take is under way", () => {
    const composer = read("src/screens/scholar/ConversationComposer.tsx");
    assert.equal((composer.match(/<TalkButton\b/g) ?? []).length, 2, "one in the Type row, one in the idle Speak row");
    assert.equal((composer.match(/copy\.scholar\.talk\.button/g) ?? []).length, 1, "the button's label lives in one component");
    // SpeakRow returns the denied row, then the recording, paused and recorded row, then the idle row: only the last draws Talk.
    // (The slice starts at the denied branch: the function's own signature names onTalk as a parameter.)
    const speakFrom = composer.indexOf("function SpeakRow(");
    const speakRow = composer.slice(composer.indexOf('if (state === "denied") {', speakFrom));
    const underway = speakRow.indexOf("if (recording || paused || recorded) {");
    const idle = speakRow.indexOf("copy.scholar.speak.tap}</Text>");
    assert.ok(speakFrom > 0 && underway > 0 && idle > underway, "the idle row comes after the take-under-way row");
    assert.ok(!/TalkButton|onTalk/.test(speakRow.slice(0, idle)), "no Talk in the denied row or while a take is recording, paused or recorded");
    assert.match(speakRow.slice(idle), /onTalk !== null \? <TalkButton onPress=\{onTalk\} disabled=\{busy \|\| requesting\} \/> : null/, "the idle row draws Talk beside the mic and waits like the mic does");
    assert.match(composer, /onTalk=\{onTalk\}\s*\/>/, "the composer hands its Talk to the Speak row");
  });

  sourceCheck("talk: the Talk screen draws our saved words, never ElevenLabs' text, and knows no limit number", () => {
    const screen = read("src/screens/scholar/ScholarTalkScreen.tsx");
    assert.match(screen, /onMessage=\{\(\{ role, message \}\) =>/, "the person's heard words only: Scholar's text is never read");
    assert.ok(!/\b600\b|\b1800\b|\b3600\b|\b30 \* 60\b|\b60 \* 60\b/.test(screen), "the cap and the month are the server's");
    assert.match(
      screen,
      /if \(failure\.usage\?\.kind === "talk_plan" && failure\.usage\.resetsAt !== null\) \{\s+return \{ text: notices\.opens\(formatResetDay\(failure\.usage\.resetsAt\)\), retry: false \};/,
      "a trial is told the day Scholar opens, with no paywall",
    );
    assert.match(
      screen,
      /const needsPro =\s+failure\?\.code === "LIMIT_REACHED" && failure\.usage\?\.kind === "talk_plan" && failure\.usage\.resetsAt === null;/,
      "only the free plan is sent to the Paywall",
    );
    assert.ok(!/console\./.test(screen), "nothing is logged");
    const service = read("src/services/scholarTalk.ts");
    assert.ok(!/console\./.test(service));
    assert.match(service, /if \(next === "background"\) void finish\("left_app"\);/, "only the background ends a talk");
    assert.match(read("src/services/account.ts"), /await endLiveTalk\(\);/, "sign-out ends a talk first");
  });

  sourceCheck("talk: Hold says the server's stop word, and Resume is an ordinary turn the server answers with a recap", () => {
    const app = read("src/constants/app.ts");
    const hold = /TALK_HOLD_WORDS = "([^"]+)"/.exec(app)[1];
    const resume = /TALK_RESUME_WORDS = "([^"]+)"/.exec(app)[1];
    const { isStopOnly } = loadPure("supabase/functions/_shared/voice/stop.ts");
    assert.equal(isStopOnly(hold), true, "Scholar stops and says its stop line, with no model call and nothing saved");
    assert.equal(isStopOnly(resume), false, "an ordinary turn: the server writes the recap (SPOKEN_RESUME)");
    const service = read("src/services/scholarTalk.ts");
    assert.match(service, /controls\.sendText\(held \? TALK_HOLD_WORDS : TALK_RESUME_WORDS\)/, "the two words are the two turns");
    assert.match(service, /if \(state\.phase !== "live" \|\| controls === null \|\| state\.held\) return;/, "the microphone button waits while held");
  });

  sourceCheck("talk screen: the voice orb, three controls and nothing red; the orb follows the talk's state and its two tracks", () => {
    const screen = read("src/screens/scholar/ScholarTalkScreen.tsx");
    assert.equal((screen.match(/<ControlButton\b/g) ?? []).length, 3, "Hold, the microphone and End");
    assert.match(screen, /onPress=\{\(\) => setTalkHeld\(!state\.held\)\}/);
    assert.match(screen, /onPress=\{\(\) => setTalkMuted\(!state\.muted\)\}/);
    assert.match(screen, /onPress=\{leave\}/, "End leaves the talk");
    assert.match(screen, /large\s+filled=\{live && !state\.muted\}/, "the microphone is the large control, plum while it is on");
    assert.match(screen, /disabled=\{!live \|\| state\.held\}/, "the microphone waits while the talk is held");
    assert.ok(!/crisis/.test(screen), "End is not red: nothing is wrong when a talk ends");
    assert.ok(!/images\.logoMark|ActivityIndicator|usePulse/.test(screen), "the orb replaced the mark, the spinner and the halo");
    assert.match(screen, /<VoiceOrb size=\{orbSize\} state=\{orbState\(state\)\} agentTrack=\{tracks\.agent\} micTrack=\{tracks\.mic\} \/>/);
    assert.match(screen, /sendText: \(text\) => latest\.current\.sendUserMessage\(text\)/, "Hold and Resume are typed turns");
    assert.match(screen, /const conversation = useRawConversation\(\);/, "the room is reached through ElevenLabs' conversation");
    assert.match(screen, /const ROOM_EVENTS = \["trackSubscribed", "trackUnsubscribed", "localTrackPublished", "localTrackUnpublished"\] as const;/);
    assert.match(screen, /ROOM_EVENTS\.forEach\(\(event\) => room\.off\(event, update\)\)/, "the room's listeners go with the last subscriber");
    assert.match(screen, /if \(state\.phase === "ending" \|\| state\.phase === "ended" \|\| state\.phase === "failed"\) return "ended";/);
    assert.match(screen, /if \(state\.held\) return "held";/);
    assert.match(screen, /if \(state\.held\) return talk\.status\.held;/);
    assert.match(screen, /const orbSize = Math\.min\(state\.heavy \? ORB_HEAVY_MAX : ORB_MAX, Math\.round\(width \* 0\.56\)\);/, "smaller beside a help line");
    assert.match(screen, /\{state\.heavy \? <HelpLine kind=\{state\.help\} \/> : null\}/, "a heavy talk keeps its help line on screen");
    assert.match(screen, /<ScrollView\b/, "large text scrolls the middle, and the controls stay pinned");
    assert.ok(!/\bcloseLabel\b|talk\.close\b/.test(screen), "no X in the header: End is the way out");
  });

  sourceCheck("talk orb: its ears are LiveKit's native volume processor, read through react-native, a report costing no render", () => {
    const levels = read("src/components/scholar/voiceLevels.ts");
    for (const file of ["voiceLevels.ts", "VoiceOrb.tsx", "VoiceOrbSkia.tsx", "orbShader.ts"]) {
      const source = read("src/components/scholar/" + file);
      assert.ok(!/from "@livekit|from "@elevenlabs|from "livekit-client/.test(source), file + " imports nothing from LiveKit or ElevenLabs");
      assert.ok(!/console\./.test(source), file + " logs nothing");
    }
    assert.match(levels, /NativeModules\.LivekitReactNativeModule/);
    assert.match(levels, /native\.createMultibandVolumeProcessor\(PROCESSOR, peerConnectionId, trackId\)/);
    assert.match(levels, /native\.deleteMultibandVolumeProcessor\(processor, peerConnectionId, trackId\)/, "the processor goes with the track");
    assert.match(levels, /const LEVEL_EVENT = "LK_MULTIBAND_PROCESSED";/);
    assert.match(levels, /readBands\(event, processor\)/, "a report for another processor is not ours");
    assert.match(levels, /const reported: VoiceDrive = \[orbLevel\(bands\), low, mid, high\];/);
    assert.match(levels, /held = settleDrive\(held, reported\);/, "it rises at once and settles");
    assert.match(levels, /sink\.set\(held\);/);
    assert.match(levels, /subscription\.remove\(\);/, "the listener goes with the track");
    assert.match(levels, /sink\.clear\(\);/, "the voice is set back to silence");
    assert.ok(!/useState\(/.test(levels), "no React state");
    assert.match(levels, /export function getOrbLevelDebug\(\)/, "the walk-through reads what the processors report");
    assert.equal((levels.match(/if \(__DEV__\)/g) ?? []).length, 3, "the read-out is collected in development only");
  });

  sourceCheck("talk orb: the shader orb where the build has Skia, the image orb otherwise, and Skia never loaded without it", () => {
    const orb = read("src/components/scholar/VoiceOrb.tsx");
    assert.match(orb, /if \(TurboModuleRegistry\.get\("RNSkiaModule"\) === null\) return null;/, "no Skia module, no shader orb");
    assert.match(orb, /const loaded = require\("\.\/VoiceOrbSkia"\) as ShaderOrbModule;/, "Skia is required only then");
    assert.match(orb, /return loaded\.orbShaderReady \? loaded\.VoiceOrbSkia : null;/, "a shader that does not compile falls back");
    assert.match(orb, /\} catch \{\s+return null;/, "and so does anything that throws");
    assert.match(orb, /return ShaderOrb === null \? <ImageOrb \{\.\.\.props\} \/> : <ShaderOrb \{\.\.\.props\} \/>;/);
    assert.ok(!/@shopify\/react-native-skia|react-native-reanimated/.test(orb), "the entry imports neither Skia nor Reanimated");
    for (const file of ["src/screens/scholar/ScholarTalkScreen.tsx", "src/components/scholar/voiceLevels.ts", "src/utils/orbShape.ts", "src/components/scholar/orbShader.ts"]) {
      assert.ok(!/@shopify\/react-native-skia/.test(read(file)), file + " does not import Skia");
    }
    // The image orb, as built before the shader.
    assert.match(orb, /useTrackLevel\(agentTrack, "agent", nodes\.agentSink\);/);
    assert.match(orb, /useTrackLevel\(micTrack, "mic", nodes\.micSink\);/);
    assert.ok(!/useNativeDriver: false/.test(orb), "every animation runs on the native driver");
    assert.equal((orb.match(/useState\(/g) ?? []).length, 1, "the only state is the animated values, made once");
    assert.match(orb, /mixBlendMode: "screen"/);
    for (const layer of ["orbGlow", "orbCore", "orbRibbonRose", "orbRibbonLight", "orbSheen"]) {
      assert.match(orb, new RegExp("images\\." + layer + "\\b"), layer);
    }
    assert.match(orb, /fade\(nodes\.agentWeight, state === "speaking" \? 1 : 0, SOURCE_FADE_MS\)/, "Scholar's voice while Scholar speaks");
    assert.match(orb, /fade\(nodes\.micWeight, state === "listening" \? 1 : 0, SOURCE_FADE_MS\)/, "the person's voice while they speak");
    assert.match(orb, /fade\(nodes\.dim, ORB_ALPHA\[state\], DIM_MS\)/, "a sleeping orb is dimmer");
    assert.match(orb, /const turning = !reduceMotion && state !== "ended";/);
    assert.match(orb, /const rippling = !reduceMotion && \(state === "connecting" \|\| state === "thinking"\);/);
    assert.match(orb, /usePulse\(BREATH_TO, state === "listening", BREATH_HALF_MS\)/, "listening breathes");
    assert.match(orb, /transform: reduceMotion\s*\? \[\{ rotate: ROSE_START \}\]/, "the ribbons sit still under Reduce Motion");
    assert.match(orb, /pointerEvents="none"/);
    assert.match(orb, /accessibilityElementsHidden/);
    assert.match(orb, /importantForAccessibility="no-hide-descendants"/);
  });

  sourceCheck("talk orb: the shader orb runs its model on the UI thread once a frame and is a decoration", () => {
    const orb = read("src/components/scholar/VoiceOrbSkia.tsx");
    assert.match(orb, /const effect = Skia\.RuntimeEffect\.Make\(ORB_SHADER\);/, "the shader is compiled once");
    assert.match(orb, /export const orbShaderReady = effect !== null;/);
    assert.match(orb, /useFrameCallback\(\(frame\) => \{\s+"worklet";/, "the model steps on the UI thread");
    assert.match(orb, /return stepOrb\(value, now, voiceOfAgent, voiceOfMic, elapsed\);/);
    assert.match(orb, /uniforms\.set\(orbUniforms\(sim\.get\(\), size, canvas, pixel, now\.still\)\);/);
    assert.match(orb, /goal\.set\(orbGoal\(state, reduceMotion\)\);/, "the state and Reduce Motion set the goal");
    assert.match(orb, /<Shader source=\{effect\} uniforms=\{uniforms\} \/>/, "the shader reads the uniforms as a shared value");
    assert.match(orb, /useTrackLevel\(agentTrack, "agent", sinks\.agent\);/);
    assert.match(orb, /useTrackLevel\(micTrack, "mic", sinks\.mic\);/);
    assert.equal((orb.match(/useState\(/g) ?? []).length, 1, "the only React state is the two sinks, made once: a report or a frame renders nothing");
    assert.ok(!/\.value\b/.test(orb), "shared values through get and set, as the React Compiler needs");
    assert.match(orb, /const CANVAS_RATIO = 1\.6;/, "room for the glow and a ring");
    assert.match(orb, /pointerEvents="none"/);
    assert.match(orb, /accessibilityElementsHidden/);
    assert.match(orb, /importantForAccessibility="no-hide-descendants"/);
    const shape = read("src/utils/orbShape.ts");
    const worklets = [...shape.matchAll(/export function (\w+)\([^)]*\)[^{]*\{\n  "worklet";/g)].map((match) => match[1]);
    for (const name of ["approach", "lobeAmplitudes", "orbGoal", "orbVoice", "stepOrb", "orbUniforms"]) {
      assert.ok(worklets.includes(name), name + " is a worklet");
    }
    for (const name of ["bandLevel", "voiceBands", "settleDrive"]) {
      assert.ok(!worklets.includes(name), name + " runs where the reports arrive, not in the frame");
    }
  });

  sourceCheck("talk captions: the screen reads the person's heard words and Scholar's timing, never ElevenLabs' text of Scholar, and shows only four statuses", () => {
    const screen = read("src/screens/scholar/ScholarTalkScreen.tsx");
    assert.match(screen, /onMessage=\{\(\{ role, message \}\) => \{\s+if \(role !== "user"\) return;/, "Scholar's message text is never read");
    assert.match(screen, /captionsPersonWords\(message, true\);/);
    assert.match(screen, /if \(value\?\.type !== "tentative_user_transcript"\) return null;/, "the person's words while they speak, if they ever come");
    assert.match(screen, /onAudioAlignment=\{\(alignment\) => captionsScholarAlignment\(alignment\)\}/);
    assert.match(screen, /onInterruption=\{\(\) => captionsInterrupt\(\)\}/);
    assert.match(screen, /if \(!live\) resetCaptions\(\);/, "they go when the talk stops being live");
    assert.match(screen, /useEffect\(\(\) => \(\) => resetCaptions\(\), \[\]\);/, "and when the page goes");
    assert.match(screen, /\{captions\.on \? <TalkCaptions heavy=\{state\.heavy\} \/> : null\}/);
    const label = screen.slice(screen.indexOf("function labelText("), screen.indexOf("function endedText("));
    const shownStatuses = [...label.matchAll(/talk\.status\.(\w+)/g)].map((match) => match[1]).sort();
    assert.deepEqual(shownStatuses, ["connecting", "ending", "held", "muted"], "listening, thinking and speaking are not drawn");
    assert.match(label, /return null;/);
    assert.match(screen, /useAnnounce\(ended \?\? status\);/, "iOS still hears every status");
    assert.match(screen, /Platform\.OS === "android" \? \(\s+<Text accessibilityLiveRegion="polite" style=\{styles\.spoken\}>\s+\{talk\.a11y\.status\(status\)\}/, "and so does Android");
    assert.match(screen, /accessibilityRole="switch"\s+accessibilityLabel=\{talk\.captions\}/);
    assert.match(screen, /accessibilityState=\{\{ checked: captions\.on \}\}/);
    assert.match(screen, /onPress=\{\(\) => captions\.setOn\(!captions\.on\)\}/);
    assert.match(screen, /const ORB_MAX = 200;/);
    assert.ok(!/haptics/.test(screen), "no haptic");
    const service = read("src/services/talkCaptions.ts");
    assert.ok(!/^import /m.test(service), "the captions service imports nothing");
    assert.ok(!/console\.|AsyncStorage|fetch\(|track\(/.test(service), "nothing is logged, kept, sent or counted");
    const view = read("src/components/scholar/TalkCaptions.tsx");
    assert.match(view, /accessibilityElementsHidden/);
    assert.match(view, /importantForAccessibility="no-hide-descendants"/);
    assert.match(view, /pointerEvents="none"/);
    assert.ok(!/useNativeDriver: false|console\.|from "@elevenlabs/.test(view));
    assert.match(view, /if \(reduceMotion \|\| !grew\) \{\s+offset\.setValue\(target\);/, "under Reduce Motion the words just appear");
    assert.match(view, /className=\{word\.lit \? "text-ink" : "text-ink\/35"\}/, "dim, then lit");
    assert.match(view, /className="text-center text-body text-mauve"/, "the person’s sentence is centred");
    assert.match(view, /className="text-center font-dm-medium text-\[20px\] leading-\[30px\] text-ink"/, "Scholar’s words are centred");
  });
}

async function talkCopyChecks() {
  await test("talk copy: curly punctuation, the GraceHush spelling, no promise of privacy, and every voice named", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const strings = [];
    const walk = (value) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") {
        const arity = Math.max(value.length, 1);
        strings.push(String(value(...Array(arity).fill("3"))), String(value(...Array(arity).fill("1"))));
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(copy.scholar.talk);
    walk(copy.voicePermission);
    walk(copy.scholarVoice);
    walk(copy.profile.scholarVoice);
    walk(copy.profile.voicePermission);
    walk(copy.paywall.scholar.talk);
    assert.ok(strings.length > 30, "the talk's words are there");
    for (const s of strings) {
      assert.ok(!s.includes("'"), `a straight apostrophe: ${s}`);
      assert.ok(!s.includes('"'), `a straight quote: ${s}`);
      assert.ok(!/Gracehush/.test(s), `the old spelling: ${s}`);
      assert.ok(!/confidential|human|guarantee|encrypted/i.test(s), `a claim the app cannot make: ${s}`);
    }
    const keys = w.use("@/constants/scholarVoices").SCHOLAR_VOICE_KEYS;
    for (const key of keys) {
      assert.ok(copy.scholarVoice.voices[key]?.name, `a name for ${key}`);
      assert.ok(copy.scholarVoice.voices[key]?.description, `a line for ${key}`);
    }
    const names = keys.map((key) => copy.scholarVoice.voices[key].name);
    assert.equal(new Set(names).size, keys.length, "eight different names");
    // The permission names who hears the voice, and that nothing is recorded by the app.
    const permission = JSON.stringify(copy.voicePermission);
    assert.match(permission, /ElevenLabs/);
  });
}

// What plain Node cannot draw on the Conversations screen and the tab's "See all".
function historySourceChecks() {
  sourceCheck("history: the tab shows the latest three with See all only when more follow, and the Conversations screen is a route above the tabs", () => {
    const tab = read("src/screens/scholar/ScholarScreen.tsx");
    assert.match(tab, /\{state\.hasMore \? \(\s*<Pressable/, "See all only when more conversations follow");
    assert.match(tab, /navigation\.navigate\("ScholarHistory"\)/, "See all opens the Conversations screen");
    assert.match(tab, /accessibilityLabel=\{copy\.scholar\.history\.a11y\.seeAll\}/, "and says what it opens");
    const home = read("src/hooks/useScholarHome.ts");
    assert.match(home, /listConversations\(\{ limit: SCHOLAR_HOME_RECENTS \}\)/, "the tab asks for the latest few only");
    assert.match(home, /hasMore: result\.data\.nextCursor !== null/, "more exist when the server says another page follows");
    const app = read("src/constants/app.ts");
    assert.match(app, /SCHOLAR_HOME_RECENTS = 3;/);
    assert.match(app, /SCHOLAR_HISTORY_PAGE = 30;/);
    assert.match(app, /SCHOLAR_SEARCH_DEBOUNCE_MS = 350;/);
    assert.ok(!/SCHOLAR_RECENTS_LIMIT/.test(read("src/constants/app.ts") + read("src/data/scholarRemote.ts")), "the old fixed limit is gone");
    assert.match(read("src/navigation/types.ts"), /ScholarHistory: undefined;/);
    assert.match(read("src/navigation/RootNavigator.tsx"), /<Stack\.Screen name="ScholarHistory" component=\{ScholarHistoryScreen\} \/>/);
  });

  sourceCheck("history: the list is virtualised with sticky headings, loads on scroll, searches by title and asks before it deletes", () => {
    const screen = read("src/screens/scholar/ScholarHistoryScreen.tsx");
    assert.match(screen, /<FlatList/, "a virtualised list, so a hundred conversations cost no more than thirty");
    assert.match(screen, /stickyHeaderIndices=\{headerIndices\}/, "the group headings stick");
    assert.match(screen, /className="screen__content bg-linen pb-2 pt-5"/, "a sticky heading has the page's own background");
    assert.match(screen, /onEndReached=\{ready !== null && !ready\.moreFailed \? history\.loadMore : undefined\}/, "the next page on scroll, and not again after a failure until asked");
    assert.match(screen, /keyboardShouldPersistTaps="handled"/, "a tap on a row works with the keyboard up");
    assert.match(screen, /keyboardDismissMode="on-drag"/);
    assert.match(screen, /autoCorrect=\{false\}/, "a search is not autocorrected");
    assert.match(screen, /keyboardAppearance="light"/);
    assert.match(screen, /onLongPress=\{\(\) => onMenu\(item\.conversation\)\}/, "a long press offers the delete");
    assert.match(screen, /accessibilityActions=\{\[\{ name: "delete"/, "a screen reader gets the same action");
    assert.match(screen, /<BottomSheet visible=\{menuOpen\} onClose=\{\(\) => setMenuOpen\(false\)\} onDismiss=\{runAfterMenu\}>/, "the sheet hands over to the dialog once it has gone");
    assert.match(screen, /if \(Platform\.OS === "ios"\) setTimeout\(runAfterMenu, MODAL_HANDOFF_FALLBACK_MS\);\s+else runAfterMenu\(\);/);
    assert.match(screen, /tone="destructive"/, "the confirmation is the destructive one");
    assert.match(screen, /const empty =\s+state\.phase === "ready" \?/, "the empty states belong to a loaded list");
    assert.match(screen, /copy\.scholar\.history\.noResults\(applied\)/, "no results says what was searched for");
    assert.match(screen, /item\.conversation\.title \?\? copy\.scholar\.untitled/, "a conversation with no title has the plain name");
    assert.ok(!/scholarRepository/.test(screen), "the screen never calls the repository: its hook does");
    assert.ok(!/haptics|track\(|console\./.test(screen), "no haptic, event or log line");
    assert.ok(!/useScholarHome|scholarRemote/.test(screen));
    const hook = read("src/hooks/useScholarHistory.ts");
    assert.match(hook, /setTimeout\(\(\) => setApplied\(words\), SCHOLAR_SEARCH_DEBOUNCE_MS\)/, "the search waits for the typing to pause");
    assert.match(hook, /if \(id !== request\.current\) return;/, "a response that lost its turn is dropped");
    assert.match(hook, /if \(moreInFlight\.current\) return;/, "one next page at a time");
    assert.match(hook, /result\.code === "NETWORK" \? "offline" : "failed"/);
    assert.ok(!/haptics|track\(|console\./.test(hook), "no haptic, event or log line in the hook either");
    const remote = read("src/data/scholarRemote.ts");
    assert.match(remote, /\.order\("last_message_at", \{ ascending: false \}\)/);
    assert.match(remote, /query\.ilike\("title", options\.pattern\)/, "the search runs on the server, so it covers every conversation");
    assert.match(remote, /query\.lt\("last_message_at", options\.cursor\)/, "paging by the last time, as the server wrote it");
    assert.match(remote, /\.limit\(options\.limit \+ 1\)/);
    assert.match(remote, /\.eq\("user_id", userId\)/, "only this account's");
  });
}

function heroSourceChecks() {
  sourceCheck("hero: the tab's card sells what is here and leads to the live talk, and the ask bar is the one way to type", () => {
    const hero = read("src/components/scholar/ScholarHero.tsx");
    assert.match(hero, /onTalk: \(\(\) => void\) \| null;/, "the button is optional: a build that cannot hold a talk has none");
    assert.match(hero, /onTalk !== null \? \(\s*<Pressable/, "no talk, no button");
    assert.ok(!/onAsk/.test(hero), "the card no longer opens the keyboard: the ask bar under it does");
    assert.match(hero, /showPro \? copy\.scholar\.hero\.ctaFreeLabel : copy\.scholar\.hero\.cta/, "a free account hears that it is Pro");
    assert.match(hero, /\{showPro \? \(\s*<View className="rounded-full bg-plum px-2 py-0\.5">/, "the Pro chip is for a free account only");
    assert.match(hero, /waveIcon = \{ android: "graphic_eq", ios: "waveform" \}/, "the talk's own icon, as the Talk button draws it");
    assert.match(hero, /<View className="max-w-\[64%\]">/, "the text keeps to the left of the picture");
    assert.match(hero, /copy\.scholar\.hero\.eyebrow/);
    assert.match(hero, /accessibilityRole="header" className="mt-1 text-headline text-white"/, "the pitch is the heading");
    assert.match(hero, /contentPosition=\{narrow \? \{ left: "65%" \} : undefined\}/, "a narrow phone keeps both faces whole");
    assert.match(hero, /NARROW_WINDOW = 340;/);
    assert.ok(!/haptics|track\(|console\./.test(hero), "no haptic, event or log line");
    const tab = read("src/screens/scholar/ScholarScreen.tsx");
    assert.match(tab, /const notPro = known && tier !== "pro";/, "only a plan RevenueCat has reported counts");
    assert.match(tab, /useScholarHome\(notPro\)/, "the tab reads the free conversation only for an account that is not Pro");
    assert.match(tab, /const unclaimed = notPro && freeConversation === null;/, "an account whose free conversation is unclaimed");
    assert.match(
      tab,
      /const free = known && tier === "free" && freeConversation != null;/,
      "only a free account that has had its free conversation is sent to the plans",
    );
    assert.match(tab, /const showPro = notPro && !unclaimed;/, "no Pro mark while the free conversation waits: it is free");
    assert.match(tab, /<ScholarHero onTalk=\{voiceSupported\(\) \? talk : null\} showPro=\{showPro\} \/>/, "the button only where a talk can run");
    assert.match(
      tab,
      /function talk\(\) \{\s+if \(!free\) \{\s+open\(\{ compose: "talk" \}\);\s+return;\s+\}\s+if \(opening\.current\) return;\s+opening\.current = true;\s+navigation\.navigate\("Paywall", \{ source: "scholar", reason: "talk" \}\);/,
      "a free account sees the plans at once, once; anyone else starts the talk's own order",
    );
    assert.match(tab, /onAsk=\{\(\) => open\(\{ compose: "type" \}\)\}/, "the ask bar still opens the keyboard");
    assert.match(read("src/navigation/types.ts"), /compose\?: "type" \| "speak" \| "talk";/);
    const conversation = read("src/screens/scholar/ConversationScreen.tsx");
    assert.match(conversation, /const talkOnOpen = useRef\(params\.compose === "talk"\);/, "only a conversation opened for a talk starts one");
    assert.match(
      conversation,
      /if \(!talkOnOpen\.current \|\| !allowed \|\| chat\.phase !== "ready"\) return;\s+talkOnOpen\.current = false;\s+talkTimer\.current = setTimeout\(openTalk, FOCUS_DELAY_MS\);/,
      "once, after the permission is answered and the screen has slid in",
    );
    assert.match(conversation, /if \(talkTimer\.current !== null\) clearTimeout\(talkTimer\.current\);/, "leaving within that moment starts nothing");
    assert.match(conversation, /if \(params\.compose !== "type" \|\| !allowed \|\| chat\.phase !== "ready"\) return undefined;/, "a talk never brings the keyboard up");
  });
}

async function heroCopyChecks() {
  await test("hero: the tab says ask once, the hero's words are its own, and every claim is one the app keeps", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const hero = copy.scholar.hero;
    for (const key of ["eyebrow", "title", "caption", "cta", "pro", "ctaFreeLabel", "ctaFreeHint"]) {
      assert.equal(typeof hero[key], "string", `hero.${key}`);
      assert.ok(!/\bask/i.test(hero[key]), `the hero does not say ask (the ask bar does): ${hero[key]}`);
    }
    assert.ok(/\bask/i.test(copy.scholar.askBar), "the ask bar is where asking is said");
    assert.ok(copy.scholar.askBar !== hero.cta && !copy.scholar.askBar.includes("Scholar"), "and it says what to type, not the name again");
    assert.ok(!/\bask/i.test(copy.scholar.groups.starters), "the starters' heading does not say ask either");
    assert.equal(hero.cta, "Talk it through", "the product's own words for the talk (the reflection row says it too)");
    assert.ok(hero.title.length <= 16, `the heading stays on one line (180pt at 24pt fits the text column; a longer one wraps): ${hero.title}`);
    assert.match(hero.ctaFreeLabel, new RegExp(`^${hero.cta}, ${hero.pro}$`), "a screen reader hears the button's name and its plan");
    assert.match(hero.caption, /^AI /, "the card says what Scholar is, AI included");
    assert.ok(!/(?:guarantee|heal|fix|cure|always)/i.test(`${hero.title} ${hero.caption}`), "no outcome is promised");
    assert.equal(copy.scholar.title, undefined, "the old title is gone");
    assert.equal(copy.scholar.caption, undefined, "and the old caption");
  });
}

// The voices' Christian names and portraits, and the chat's voice sheet (2026-11-19, the owner's request).
async function voiceNameChecks() {
  await test("voices: a Christian name for each voice, no two alike, none sacred, and every voice still Scholar, an AI", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const keys = w.use("@/constants/scholarVoices").SCHOLAR_VOICE_KEYS;
    const names = keys.map((key) => copy.scholarVoice.voices[key].name);
    for (const name of names) assert.match(name, /^[A-Z][a-z]+$/, `one plain name: ${name}`);
    for (const old of ["Warm", "Bright", "Clear", "Soft", "Storyteller", "Deep", "Steady", "Wise"]) {
      assert.ok(!names.includes(old), `a person's name, not the old word for the sound: ${old}`);
    }
    assert.equal(new Set(names.map((name) => name[0])).size, keys.length, "eight different first letters, so no two are mistaken");
    // Scholar never speaks as God, as Jesus, as an angel or as a central figure of the Bible, so no voice carries such a name.
    const sacred = /^(?:God|Jesus|Christ|Lord|Yahweh|Jehovah|Spirit|Messiah|Mary|Joseph|Moses|Abraham|David|Solomon|Elijah|Paul|Peter|John|Michael|Gabriel|Raphael|Lucifer)$/;
    for (const name of names) assert.ok(!sacred.test(name), `not a name Scholar may not speak as: ${name}`);
    for (const key of keys) assert.match(copy.scholarVoice.voices[key].description, /^A (?:woman|man)’s voice · /, `${key} still says how it sounds`);
    assert.match(copy.scholarVoice.sheet.body, /Every voice is Scholar, an AI\./, "the voice sheet says every voice is Scholar, an AI");
    assert.equal(copy.scholar.talk.voice("Hannah"), "Hannah’s voice", "the Talk screen names the voice the person chose");
    assert.equal(copy.scholarVoice.a11y.preview("Hannah"), "Preview Hannah’s voice");
    assert.equal(copy.scholarVoice.a11y.change("Hannah"), "Scholar’s voice, Hannah", "the header's portrait says whose voice it is");
    assert.equal(typeof copy.scholarVoice.a11y.changeHint, "string");
    assert.match(copy.scholarVoice.changeLater, /chat/, "the voice can be changed in the chat as well as in Profile");
  });

  await test("voices: the rows show the boldest man's voice first, then a woman's and a man's in turn, every voice once", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const { SCHOLAR_VOICE_KEYS, SCHOLAR_VOICE_ORDER, DEFAULT_SCHOLAR_VOICE } = w.use("@/constants/scholarVoices");
    assert.equal(SCHOLAR_VOICE_ORDER.length, SCHOLAR_VOICE_KEYS.length, "every voice is shown");
    assert.deepEqual([...SCHOLAR_VOICE_ORDER].sort(), [...SCHOLAR_VOICE_KEYS].sort(), "each voice once, and no other");
    assert.equal(SCHOLAR_VOICE_ORDER[0], "deep", "Gideon, the deep voice, comes first");
    SCHOLAR_VOICE_ORDER.forEach((key, index) => {
      const kind = /^A (woman|man)’s voice/.exec(copy.scholarVoice.voices[key].description)[1];
      assert.equal(kind, index % 2 === 0 ? "man" : "woman", `${copy.scholarVoice.voices[key].name} at place ${index + 1}`);
    });
    const names = SCHOLAR_VOICE_ORDER.map((key) => copy.scholarVoice.voices[key].name);
    assert.deepEqual(names, ["Gideon", "Hannah", "Nathan", "Phoebe", "Caleb", "Lydia", "Ezra", "Selah"]);
    assert.equal(DEFAULT_SCHOLAR_VOICE, "warm", "the order changes nothing about the default");
  });

  await test("listen voice copy: the ElevenLabs permission, the voice sheet and Profile say the chosen voice also reads answers aloud", async (w) => {
    const { copy } = w.use("@/constants/copy");
    assert.match(copy.voicePermission.body, /when you tap Listen/, "the permission names Listen before anything is sent");
    assert.match(copy.voicePermission.body, /Google’s AI still writes the answers/);
    assert.match(copy.voicePermission.trust, /each answer it reads aloud, until GraceHush deletes them there/, "and what ElevenLabs keeps of a reading, until it is deleted");
    assert.match(copy.voicePermission.trust, /train its models is switched off/);
    assert.match(copy.scholarVoice.sheet.body, /when it reads an answer aloud/);
    assert.match(copy.profile.scholarVoice.helper, /when it reads an answer aloud/);
    assert.match(copy.profile.voicePermission.on, /ElevenLabs speaks Scholar’s answers/);
    assert.match(copy.profile.voicePermission.off, /Listen reads answers in the voice of your devotionals/, "off says what Listen does instead");
  });
}

// Height and width of a JPEG from its frame header, and whether it is progressive and carries an Exif block.
function jpegInfo(bytes) {
  assert.ok(bytes[0] === 0xff && bytes[1] === 0xd8, "a JPEG");
  let offset = 2;
  let exif = false;
  while (offset < bytes.length) {
    assert.equal(bytes[offset], 0xff, "a marker");
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe1) exif = true;
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), progressive: marker === 0xc2, exif };
    }
    offset += 2 + length;
  }
  throw new Error("no frame header");
}

function voiceAvatarSourceChecks() {
  sourceCheck("voices: every voice has its portrait, a small square JPEG drawn as a decorative circle beside its name", () => {
    const keys = /SCHOLAR_VOICE_KEYS = \[([^\]]+)\]/.exec(read("src/constants/scholarVoices.ts"))[1].match(/"(\w+)"/g).map((key) => key.slice(1, -1));
    const images = read("src/constants/images.ts");
    assert.match(images, /export const voiceAvatars: Record<ScholarVoiceKey, number> = \{/);
    for (const key of keys) {
      const name = `voiceAvatar${key[0].toUpperCase()}${key.slice(1)}`;
      assert.match(images, new RegExp(`import ${name} from "@/assets/images/voice-avatar-${key}\\.jpg";`), `${key}'s portrait is imported`);
      assert.match(images, new RegExp(`\\n  ${key}: ${name},`), `${key}'s portrait is in the map`);
      const bytes = fs.readFileSync(path.join(REPO, `assets/images/voice-avatar-${key}.jpg`));
      const info = jpegInfo(bytes);
      assert.deepEqual([info.width, info.height], [384, 384], `${key}: 384 by 384, enough for 40 points at 3x and no more`);
      assert.ok(info.progressive, `${key}: a progressive JPEG, as every picture of the app`);
      assert.ok(!info.exif, `${key}: no metadata`);
      assert.ok(bytes.length < 120_000, `${key}: small (${bytes.length} bytes)`);
    }
    const avatar = read("src/components/scholar/VoiceAvatar.tsx");
    assert.match(avatar, /accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/, "decorative: the name beside it is what is read");
    assert.match(avatar, /<Image source=\{voiceAvatars\[voice\]\} contentFit="cover" style=\{StyleSheet\.absoluteFill\} \/>/);
    assert.match(avatar, /selected \? "border-2 border-plum" : "border border-petal"/, "the chosen voice has a plum ring");
    const rows = read("src/components/scholar/VoiceRows.tsx");
    assert.match(rows, /const rows = SCHOLAR_VOICE_ORDER\.map\(/, "the rows follow the display order, not the server's");
    assert.ok(!/SCHOLAR_VOICE_KEYS/.test(rows), "nothing in the rows reads the server's order");
    assert.match(rows, /<VoiceAvatar voice=\{key\} size=\{40\} selected=\{checked\} \/>/, "each row shows the voice's portrait");
    assert.match(rows, /\{checked \? \(\s*<View\s+className="items-center justify-center rounded-full bg-plum"\s+style=\{styles\.check\}/, "a check on the chosen one only");
    assert.ok(!/size-2\.5 rounded-full bg-plum/.test(rows), "the radio dot beside the portrait is gone");
    assert.match(rows, /accessibilityRole=\{pro \? "button" : "radio"\}/, "a screen reader still hears a radio button, and whether it is checked");
    assert.match(rows, /accessibilityState=\{pro \? undefined : \{ checked \}\}/);
    assert.match(rows, /const pro = locked && key !== DEFAULT_SCHOLAR_VOICE;/, "every voice but the default is Pro when locked");
    assert.match(rows, /if \(pro\) \{\s+onLocked\?\.\(key\);\s+return;\s+\}/, "a Pro voice opens the plans and is never chosen");
    assert.match(rows, /\{voiceCopy\.pro\}/, "the Pro chip");
    assert.match(
      rows,
      /onPress=\{\(\) => \{\s+if \(previewing\) stopSample\(\);\s+else void playSample\(scholarVoicePreviews\[key\]\);\s+\}\}/,
      "the preview plays for every voice: hearing one is free",
    );
  });

  sourceCheck("voices: the chat's header portrait opens the voice sheet where a talk can run, never in a heavy conversation", () => {
    const screen = read("src/screens/scholar/ConversationScreen.tsx");
    assert.match(screen, /const showVoice = voiceSupported\(\) && chat\.phase === "ready" && !chat\.heavy;/);
    assert.match(
      screen,
      /\{showVoice \? \(\s*<Pressable\s+accessibilityRole="button"\s+accessibilityLabel=\{copy\.scholarVoice\.a11y\.change\(copy\.scholarVoice\.voices\[voice\]\.name\)\}\s+accessibilityHint=\{copy\.scholarVoice\.a11y\.changeHint\}\s+onPress=\{openVoices\}/,
      "the chosen voice's portrait, named, opens the voices",
    );
    assert.match(screen, /<VoiceAvatar voice=\{voice\} size=\{32\} \/>/);
    assert.match(
      screen,
      /function openVoices\(\) \{\s+stopScholarAudio\(\);\s+setVoicesStep\(voiceAllowed \? "voices" : "permission"\);\s+\}/,
      "an answer being read stops before a preview can play over it, and without ElevenLabs allowed the sheet asks first",
    );
    assert.match(screen, /<BottomSheet visible=\{voicesStep !== null\} onClose=\{\(\) => setVoicesStep\(null\)\} onDismiss=\{runAfterVoices\}>/);
    assert.match(screen, /const \{ voice, setVoice, locked: voicesLocked \} = useScholarVoice\(\);/);
    assert.match(
      screen,
      /function voiceLocked\(\) \{\s+setVoicesStep\(null\);\s+afterVoices\.current = \(\) => navigation\.navigate\("Paywall", \{ source: "scholar", reason: "voice" \}\);\s+if \(Platform\.OS === "ios"\) setTimeout\(runAfterVoices, MODAL_HANDOFF_FALLBACK_MS\);\s+else runAfterVoices\(\);\s+\}/,
      "the sheet closes first, then the plans open",
    );
    assert.match(
      screen,
      /function talkVoiceLocked\(\) \{\s+setTalkSheet\(null\);\s+afterTalkSheet\.current = \(\) => navigation\.navigate\("Paywall", \{ source: "scholar", reason: "voice" \}\);/,
      "the Talk sheet's voices do the same",
    );
    assert.match(screen, /locked=\{voicesLocked\}\s+onLocked=\{talkVoiceLocked\}/, "the Talk sheet's rows are locked alike");
    assert.match(
      screen,
      /\{voicesStep === "permission" \? \(\s*<VoicePermissionStep\s+onAllow=\{\(\) => \{\s+setVoiceAllowed\(true\);\s+setVoicesStep\("voices"\);\s+\}\}\s+onNotNow=\{\(\) => setVoicesStep\(null\)\}/,
      "Allow keeps the permission and shows the voices; Not now closes the sheet",
    );
    assert.equal(
      screen.split("<VoiceRows selected={voice} onSelect={setVoice} locked={voicesLocked} onLocked={voiceLocked} />").length - 1,
      1,
      "the sheet's rows keep the account's voice",
    );
    assert.match(screen, /label=\{copy\.scholarVoice\.sheet\.done\} onPress=\{\(\) => setVoicesStep\(null\)\}/);
    assert.ok(screen.indexOf("{showVoice ? (") < screen.indexOf("{chat.heavy ? ("), "the portrait sits before the menu, where Get help would be");
    const talk = read("src/screens/scholar/ScholarTalkScreen.tsx");
    assert.match(talk, /\{state\.voice !== null && !state\.heavy \? <VoiceAvatar voice=\{state\.voice\} size=\{20\} \/> : null\}/, "the talk shows the portrait, except in a heavy talk");
    assert.match(
      read("src/components/scholar/TalkSheet.tsx"),
      /<VoiceRows selected=\{voice\} onSelect=\{onChooseVoice\} locked=\{locked\} onLocked=\{onLocked\} \/>/,
      "the first talk's sheet shows the portraits too, locked alike",
    );
  });

  sourceCheck("listen voice: one ElevenLabs permission step for the first talk and the chat's voice sheet, and Listen decides its voice once", () => {
    const step = read("src/components/scholar/VoicePermissionStep.tsx");
    for (const part of ["{permission.title}", "{permission.body}", "{permission.trust}", "{permission.caption}"]) {
      assert.ok(step.includes(part), `the step says ${part}`);
    }
    assert.match(step, /label=\{permission\.allow\} onPress=\{onAllow\}/);
    assert.match(step, /label=\{permission\.notNow\} tone="ghost" onPress=\{onNotNow\}/);
    assert.match(step, /accessibilityRole="link"\s+accessibilityLabel=\{permission\.privacy\}\s+onPress=\{onOpenPrivacy\}/);
    const talkSheet = read("src/components/scholar/TalkSheet.tsx");
    assert.match(talkSheet, /<VoicePermissionStep onAllow=\{onAllow\} onNotNow=\{onClose\} onOpenPrivacy=\{onOpenPrivacy\} \/>/, "the first talk asks with the same step");
    assert.ok(!talkSheet.includes("permission.body"), "and holds no second copy of its words");
    const player = read("src/services/scholarPlayer.ts");
    assert.match(player, /const voice = listenVoice\(\);/, "the voice is decided once, when a listen starts");
    assert.match(player, /return `\$\{messageId\}-\$\{voice \?\? "standard"\}-\$\{part\}`;/, "and is part of each cached part's name");
    const repository = read("src/data/scholarRepository.ts");
    assert.match(repository, /return hasVoicePermission\(\) \? accountVoice\(\) : null;/);
    assert.match(
      repository,
      /return useEntitlementStore\.getState\(\)\.tier === "free" \? DEFAULT_SCHOLAR_VOICE : getScholarVoice\(\);/,
      "a free account listens in the default voice, as the server holds it to",
    );
    assert.match(repository, /const spokenIn = voice !== null && hasVoicePermission\(\) \? voice : null;/, "a voice goes only while ElevenLabs is allowed");
  });
}

// ================================================================== the free conversation (2026-11-20)
// An account that is not Pro has one free conversation with Scholar, ever: its first eight messages answered, its answers read
// aloud, and three minutes of live talk in it. A hard moment is answered on every plan, never counted and never claims it.
const freeRowOf = (w, sub = "user_a") => w.server.state.scholarFreeUse.find((row) => row.user_id === sub) ?? null;
const freeReads = (w) => w.server.state.requests.filter((r) => r.path === "/rest/v1/scholar_free_use").length;

function setTier(w, tier) {
  const entitlement = w.use("@/store/entitlementStore").useEntitlementStore.getState();
  entitlement.start("user_a", "test_store");
  entitlement.setEntitlement("user_a", tier, null);
}

async function freeChecks() {
  await test("free: one conversation of eight messages, each answered with what is left, the heads-up from three, the ninth kept with the plans, once, and Pro answers it", async (w) => {
    w.server.state.serverPlans.user_a = "free";
    const handle = renderConversation(w, {});
    let state = await until(handle, (s) => s.phase === "ready" && s.freeKnown, "the free conversation read");
    assert.deepEqual([state.freeHere, state.freeOpen, state.freeLeft], [false, true, null], "unclaimed: this one may be it");
    assert.equal(freeReads(w), 1, "read once when the conversation opens");
    const lefts = [];
    for (let n = 1; n <= 8; n += 1) {
      assert.equal(handle.result.current.send(`question ${n}`), true);
      state = await until(handle, (s) => !s.sending && s.messages.length === 2 * n, `answer ${n}`);
      assert.equal(state.notice, null, `message ${n} is answered`);
      lefts.push(state.freeLeft);
    }
    assert.deepEqual(lefts, [null, null, null, null, 3, 2, 1, null], "what is left shows from three down, and none once all are used");
    assert.equal(state.freeHere, true, "this is the free conversation");
    assert.equal(state.paywallAsk, 0, "nothing opens while a free message is left");
    const row = freeRowOf(w);
    assert.deepEqual([row.conversation_id, row.messages], [state.conversationId, 8], "the server counted eight, here");
    assert.equal(w.server.state.scholarCreditRows.length, 0, "a free message spends no credit");
    handle.result.current.send("question 9");
    state = await until(handle, (s) => !s.sending && s.notice !== null, "the ninth");
    assert.equal(state.notice, "plan", "Scholar is part of Pro, with See plans");
    assert.equal(state.paywallAsk, 1, "the plans open by themselves, once");
    const held = state.rows.filter((r) => r.kind === "user").pop();
    assert.equal(held.failure, "limit", "the ninth is kept with Try again");
    assert.equal(freeRowOf(w).messages, 8, "the ninth is not counted");
    w.server.state.serverPlans.user_a = "pro";
    state.retry(held.message.id);
    state = await until(handle, (s) => !s.sending && s.messages.length === 18, "Pro answers the ninth");
    assert.equal(state.notice, null);
    assert.equal(state.paywallAsk, 1, "nothing opens again");
    assert.equal(state.messages[16].id, held.message.id, "the same message, answered");
    assert.equal(w.server.state.scholarCreditRows[0].used, w.server.state.scholarMessageCost, "Pro's message spends its credits");
    handle.unmount();
  });

  await test("free: a hard moment never claims or counts; after the free conversation another is told by the plan, deleting it gives nothing back, and a trial is told the day its plan begins", async (w) => {
    w.server.state.serverPlans.user_a = "free";
    const heavy = await repo(w).sendTurn(text("HEAVY I cannot sleep", 1, { conversationId: mid(40) }));
    assert.equal(heavy.ok, true, "a hard moment is answered on the free plan");
    assert.deepEqual([heavy.data.answer.isHeavy, heavy.data.usage], [true, null], "with its help line and no count");
    assert.equal(w.server.state.scholarFreeUse.length, 0, "and it never claims the free conversation");
    assert.equal(await repo(w).readScholarFree(), null);
    const first = await repo(w).sendTurn(text(QUESTION, 2));
    assert.equal(first.ok, true, `the free conversation answers: ${JSON.stringify(first)}`);
    const usage = first.data.usage;
    assert.deepEqual([usage.kind, usage.used, usage.limit, usage.remaining, usage.resetsAt], ["free", 1, 8, 7, null]);
    assert.deepEqual(await repo(w).readScholarFree(), { conversationId: CONV, messages: 1 }, "the first conversation claims it");
    const second = await repo(w).sendTurn(text(QUESTION, 3, { conversationId: mid(41) }));
    assert.equal(second.code, "LIMIT_REACHED", "another conversation is told by the plan");
    assert.deepEqual([second.usage.kind, second.usage.resetsAt], ["scholar_plan", null]);
    assert.equal((await repo(w).deleteConversation(CONV)).ok, true);
    const third = await repo(w).sendTurn(text(QUESTION, 4, { conversationId: mid(42) }));
    assert.equal(third.code, "LIMIT_REACHED", "deleting the free conversation gives nothing back");
    assert.deepEqual(await repo(w).readScholarFree(), { conversationId: CONV, messages: 1 });
    const heavyAfter = await repo(w).sendTurn(text("HEAVY still awake", 5, { conversationId: mid(43) }));
    assert.equal(heavyAfter.ok, true, "a hard moment is answered after the free conversation too");
    assert.equal(heavyAfter.data.usage, null);
    assert.equal(freeRowOf(w).messages, 1, "and counts nothing");
    const ends = new Date(BASE + 3 * 86_400_000).toISOString();
    w.server.state.serverPlans.user_a = "trial";
    w.server.state.serverPlanEnds.user_a = ends;
    const trial = await repo(w).sendTurn(text(QUESTION, 6, { conversationId: mid(44) }));
    assert.equal(trial.usage.kind, "scholar_plan");
    assert.equal(Date.parse(trial.usage.resetsAt), Date.parse(ends), "a trial is told the day its plan begins, never the plans");
  });

  await test("free listen: the free conversation's answers are read aloud, in Hannah's voice on the free plan; a trial keeps its voice; another conversation is told by its plan", async (w) => {
    allowTalk(w, { voiceKey: "deep" });
    const other = (await repo(w).sendTurn(text(QUESTION, 1, { conversationId: mid(50) }))).data.answer.id;
    w.server.state.serverPlans.user_a = "free";
    const id = (await repo(w).sendTurn(text(QUESTION, 2))).data.answer.id;
    const player = w.use("@/services/scholarPlayer");
    const asked = () => calls(w, "scholar-speak").map((call) => call.body.voice ?? "none");
    const listen = async (messageId) => {
      await player.playScholarAnswer(messageId);
      await settle(6);
      return player.getScholarListenState();
    };
    // Before RevenueCat answers, the phone asks for the chosen voice and the server reads Hannah's for the free plan.
    let state = await listen(id);
    assert.equal(state.phase, "playing", "the free conversation listens on the free plan");
    assert.deepEqual(asked(), ["deep", "deep"]);
    assert.equal(w.files.files.get(w.audio.players[0].uri).bytes.toString(), "RIFF-warm-part-0", "and hears Hannah");
    player.clearScholarAudio();
    // RevenueCat has said free: the phone asks for Hannah's voice itself.
    setTier(w, "free");
    state = await listen(id);
    assert.deepEqual(asked().slice(2), ["warm", "warm"]);
    player.clearScholarAudio();
    // A trial hears the voice it chose.
    w.server.state.serverPlans.user_a = "trial";
    setTier(w, "trial");
    state = await listen(id);
    assert.deepEqual(asked().slice(4), ["deep", "deep"]);
    assert.equal(w.files.files.get(w.audio.players[2].uri).bytes.toString(), "RIFF-deep-part-0");
    player.clearScholarAudio();
    w.server.state.serverPlans.user_a = "free";
    state = await listen(other);
    assert.equal(state.phase, "failed", "another conversation is not the free one");
    assert.deepEqual([state.usage.kind, state.usage.resetsAt], ["listen_plan", null]);
    player.clearScholarAudio();
  }, { permission: true, player: true });

  await test("free talk: the free conversation talks for three minutes in all, in Hannah's voice with no month; used up, elsewhere or in a hard moment, the plan answers", async (w) => {
    w.server.state.serverPlans.user_a = "free";
    allowTalk(w, { voiceKey: "deep" });
    const start = (conversationId = CONV) => repo(w).startTalk({ conversationId, entryId: null });
    let started = await start();
    assert.equal(started.ok, true, "a talk on the free plan, in its free conversation");
    assert.equal(calls(w, "scholar-voice-start")[0].body.voice, "deep", "before RevenueCat answers, the chosen voice is asked for");
    assert.equal(started.data.voice, "warm", "and the server gives Hannah's");
    assert.deepEqual([started.data.limits.talkSeconds, started.data.limits.monthSecondsLeft], [180, null], "three minutes, no month");
    assert.deepEqual(await repo(w).readScholarFree(), { conversationId: CONV, messages: 0 }, "a talk claims the free conversation");
    let ended = await repo(w).finishTalk(started.data.talkId);
    assert.equal(ended.limits.talkSeconds, 120, "what is left of the three minutes");
    const elsewhere = await start(mid(60));
    assert.deepEqual([elsewhere.code, elsewhere.usage.kind], ["LIMIT_REACHED", "talk_plan"], "another conversation is told by the plan");
    setTier(w, "free");
    started = await start();
    assert.equal(calls(w, "scholar-voice-start").pop().body.voice, "warm", "RevenueCat said free: Hannah's voice is asked for");
    assert.equal(started.data.limits.talkSeconds, 120);
    ended = await repo(w).finishTalk(started.data.talkId);
    started = await start();
    ended = await repo(w).finishTalk(started.data.talkId);
    assert.equal(ended.limits.talkSeconds, 0, "the three minutes are used");
    const used = await start();
    assert.deepEqual([used.code, used.usage.kind, used.usage.resetsAt], ["LIMIT_REACHED", "talk_plan", null], "then the plans");
    const heavy = await repo(w).sendTurn(text("HEAVY I cannot sleep", 1, { conversationId: mid(61) }));
    assert.equal(heavy.data.conversation.isHeavy, true);
    const inHeavy = await start(mid(61));
    assert.deepEqual([inHeavy.code, inHeavy.usage.kind], ["LIMIT_REACHED", "talk_plan"], "no free talk in a hard moment");
  }, { permission: true });

  await test("free talk: a trial's free conversation talks in the voice it chose", async (w) => {
    const ends = new Date(BASE + 3 * 86_400_000).toISOString();
    w.server.state.serverPlans.user_a = "trial";
    w.server.state.serverPlanEnds.user_a = ends;
    setTier(w, "trial");
    allowTalk(w, { voiceKey: "deep" });
    const started = await repo(w).startTalk({ conversationId: CONV, entryId: null });
    assert.equal(started.ok, true);
    assert.equal(calls(w, "scholar-voice-start")[0].body.voice, "deep");
    assert.equal(started.data.voice, "deep", "a trial keeps all eight voices");
    assert.equal(started.data.limits.talkSeconds, 180);
    const elsewhere = await repo(w).startTalk({ conversationId: mid(62), entryId: null });
    assert.equal(Date.parse(elsewhere.usage.resetsAt), Date.parse(ends), "elsewhere a trial is told the day its plan begins");
  }, { permission: true });

  await test("free mock: the mock's free conversation answers eight, refuses the ninth and any other conversation by the plan, and reads back what it used", async (w) => {
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    w.use("@/data/journalRepository").setMockSubscriptionTier("free");
    const mock = w.use("@/data/mock/scholar");
    mock.resetMockScholar();
    const dev = w.use("@/store/devStore").useDevStore;
    const viaMock = async (promise) => {
      await advance(1_300);
      return promise;
    };
    assert.equal(await repo(w).readScholarFree(), null, "unclaimed");
    for (let n = 1; n <= 8; n += 1) {
      const answered = await viaMock(repo(w).sendTurn(text(QUESTION, n)));
      assert.equal(answered.ok, true, `free message ${n}`);
      assert.deepEqual([answered.data.usage.kind, answered.data.usage.used, answered.data.usage.remaining], ["free", n, 8 - n]);
    }
    const ninth = await viaMock(repo(w).sendTurn(text(QUESTION, 9)));
    assert.deepEqual([ninth.code, ninth.usage.kind, ninth.usage.resetsAt], ["LIMIT_REACHED", "scholar_plan", null]);
    const other = await viaMock(repo(w).sendTurn(text(QUESTION, 10, { conversationId: mid(70) })));
    assert.equal(other.code, "LIMIT_REACHED", "another conversation is told by the plan");
    assert.deepEqual(await repo(w).readScholarFree(), { conversationId: CONV, messages: 8 });
    dev.getState().setNextScholarOutcome("heavy");
    const heavy = await viaMock(repo(w).sendTurn(text("a hard night", 11, { conversationId: mid(71) })));
    assert.deepEqual([heavy.ok, heavy.data.usage], [true, null], "a hard moment is answered and never counted");
    w.use("@/data/journalRepository").setMockSubscriptionTier("trial");
    const trial = await viaMock(repo(w).sendTurn(text(QUESTION, 12, { conversationId: mid(72) })));
    assert.ok(Date.parse(trial.usage.resetsAt) > clock.now, "a trial is told the day its plan begins");
    assert.equal(calls(w, "scholar-turn").length, 0, "the mock never reaches the server");
    assert.equal(freeReads(w), 0, "nor its free conversation");
    mock.resetMockScholar();
    assert.equal(await repo(w).readScholarFree(), null, "a reset forgets it");
  });

  await test("free voices: a free account hears Hannah and its other voices are locked; a trial and Pro choose any, and the choice is kept", async (w) => {
    w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState().setScholarVoice("user_a", "deep");
    const { useScholarVoice } = w.use("@/hooks/useAiPermission");
    const read = () => {
      const handle = w.renderHook(useScholarVoice);
      const { voice, chosen, locked } = handle.result.current;
      handle.unmount();
      return [voice, chosen, locked];
    };
    assert.deepEqual(read(), ["deep", "deep", false], "until RevenueCat answers, the chosen voice: the server decides");
    setTier(w, "free");
    assert.deepEqual(read(), ["warm", "deep", true], "the free plan hears Hannah, and the choice is kept for later");
    setTier(w, "trial");
    assert.deepEqual(read(), ["deep", "deep", false], "a trial has every voice");
    setTier(w, "pro");
    assert.deepEqual(read(), ["deep", "deep", false]);
  });

  await test("free tab: the Scholar tab reads the free conversation only for an account that is not Pro", async (w) => {
    w.server.state.serverPlans.user_a = "free";
    const { useScholarHome } = w.use("@/hooks/useScholarHome");
    let handle = w.renderHook(useScholarHome, true);
    let current = await until(handle, (c) => c.free !== undefined, "the free conversation read");
    assert.equal(current.free, null, "unclaimed");
    handle.unmount();
    await repo(w).sendTurn(text(QUESTION));
    handle = w.renderHook(useScholarHome, true);
    current = await until(handle, (c) => c.free != null, "claimed");
    assert.deepEqual(current.free, { conversationId: CONV, messages: 1 });
    handle.unmount();
    const before = freeReads(w);
    handle = w.renderHook(useScholarHome, false);
    current = await until(handle, (c) => c.state.phase === "ready", "the list");
    await settle(4);
    assert.equal(handle.result.current.free, undefined, "Pro reads nothing of it");
    assert.equal(freeReads(w), before);
    handle.unmount();
  });

  await test("free copy: the free conversation's words are true, value-first and never teach leaving", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const { app } = { app: w.use("@/constants/app") };
    assert.equal(copy.paywall.scholar.conversation, "You’ve had your free conversation with Scholar. Scholar is part of GraceHush Pro.");
    assert.equal(copy.paywall.scholar.voice, "Scholar’s other voices are part of GraceHush Pro.");
    assert.equal(copy.scholar.notices.freeLeft(3), "3 free messages left in this conversation.");
    assert.equal(copy.scholar.notices.freeLeft(1), "1 free message left in this conversation.");
    assert.equal(app.SCHOLAR_LEFT_NOTICE_FROM, 3, "the heads-up shows from three messages left");
    assert.equal(copy.scholarVoice.pro, "Pro");
    assert.equal(copy.scholarVoice.a11y.lockedHint, "Opens GraceHush Pro");
    assert.equal(copy.scholarVoice.a11y.locked("Gideon", "Deep · Comforting"), "Gideon, Deep, Comforting, Pro");
    for (const s of [copy.paywall.scholar.conversation, copy.paywall.scholar.voice, copy.scholar.notices.freeLeft(2)]) {
      assert.ok(!/'|"|cancel|hurry|last chance|only today|expire/i.test(s), `curly punctuation, no pressure and no way out: ${s}`);
    }
  });
}

(async () => {
  await dataChecks();
  await historyChecks();
  await conversationChecks();
  await freeChecks();
  await rowChecks();
  await listenChecks();
  await accountChecks();
  sourceChecks();
  historySourceChecks();
  heroSourceChecks();
  await copyChecks();
  await heroCopyChecks();
  await talkChecks();
  talkSourceChecks();
  await talkCopyChecks();
  await voiceNameChecks();
  voiceAvatarSourceChecks();
  for (const stack of strayFetches) failures.push(stack);
  if (failures.length > 0) {
    console.log(`${passed} checks passed, ${failures.length} FAILED:\n`);
    for (const failure of failures) console.log(` - ${failure}\n`);
    process.exitCode = 1;
  } else {
    console.log(`${passed} checks passed`);
  }
})();
