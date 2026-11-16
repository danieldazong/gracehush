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
function seedConversation(w, { id = CONV, sub = "user_a", heavy = false, entryId = null, messages = [] } = {}) {
  const at = stamp(clock.now);
  w.server.state.scholarConversations.push({
    id,
    user_id: sub,
    entry_id: entryId,
    title: heavy ? null : "A question about peace",
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
    assert.equal(usage.kind, "free_day");
    assert.equal(usage.remaining, 4);
    // The function answers with PostgREST's microseconds; the app keeps three digits and a Z, as every server time.
    for (const time of [conversation.createdAt, conversation.lastMessageAt, message.createdAt, answer.createdAt]) {
      assert.match(time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `a time the phone can read: ${time}`);
    }
  });

  await test("gateway: an answer that is not the contract is UNKNOWN, and a 402 carries the day's numbers", async (w) => {
    w.server.state.functions["scholar-turn"].push(() => json(200, { conversation: { id: CONV }, answer: "nonsense" }));
    const odd = await repo(w).sendTurn(text(QUESTION));
    assert.equal(odd.ok, false);
    assert.equal(odd.code, "UNKNOWN");
    w.server.state.scholarFreeLimit = 0;
    const held = await repo(w).sendTurn(text(QUESTION, 2));
    assert.equal(held.ok, false);
    assert.equal(held.code, "LIMIT_REACHED");
    assert.deepEqual(
      { kind: held.usage.kind, remaining: held.usage.remaining, limit: held.usage.limit },
      { kind: "free_day", remaining: 0, limit: 0 },
    );
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
    const list = await repo(w).listConversations();
    assert.equal(list.ok, true);
    assert.deepEqual(list.data.map((item) => item.id), [CONV, mid(80)], "only this account's, the newest first");
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
    const mock = w.use("@/data/mock/scholar");
    mock.resetMockScholar();
    const dev = w.use("@/store/devStore").useDevStore;
    // The mock waits a moment, as the server would, on the virtual clock.
    const viaMock = async (promise) => {
      await advance(1_300);
      return promise;
    };
    const ready = await viaMock(repo(w).sendTurn(text(QUESTION)));
    assert.equal(ready.ok, true);
    dev.getState().setNextScholarOutcome("heavy");
    const heavy = await viaMock(repo(w).sendTurn(text("a hard night", 2)));
    assert.equal(heavy.data.answer.helpLine, "crisis");
    assert.equal(heavy.data.usage, null, "a heavy conversation has no count");
    dev.getState().setNextScholarOutcome("resting");
    const resting = await viaMock(repo(w).sendTurn(text(QUESTION, 3, { conversationId: mid(70) })));
    assert.equal(resting.code, "SCHOLAR_UNAVAILABLE");
    assert.equal(dev.getState().nextScholarOutcome, "ready", "the outcome is used once");
    assert.equal(calls(w, "scholar-turn").length, 0, "the mock never reaches the server");
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

  await test("conversation: the free limit holds a message with Try again alone, and the heads-up follows the server's numbers", async (w) => {
    w.server.state.scholarFreeLimit = 3;
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    handle.result.current.send("one");
    let state = await until(handle, (s) => !s.sending && s.messages.length === 2, "the first answer");
    assert.equal(state.headsUp, 2, "two free messages left today");
    state.send("two");
    state = await until(handle, (s) => !s.sending && s.messages.length === 4, "the second answer");
    assert.equal(state.headsUp, 1);
    state.send("three");
    state = await until(handle, (s) => !s.sending && s.messages.length === 6, "the third answer");
    assert.equal(state.headsUp, null, "none left: the heads-up gives way");
    assert.equal(state.send("four"), true, "the composer still sends: the server screens it first");
    state = await until(handle, (s) => !s.sending && s.notice !== null, "the limit");
    assert.equal(state.notice, "freeLimit");
    const held = state.rows.filter((row) => row.kind === "user").pop();
    assert.equal(held.failure, "limit", "only Try again");
    // Another day's count would come from the server too: a bigger limit shows a bigger number.
    w.server.state.scholarFreeLimit = 5;
    state.retry(held.message.id);
    state = await until(handle, (s) => !s.sending && s.messages.length === 8, "the held message, answered");
    assert.equal(state.headsUp, 1, "the server's numbers, not the app's");
    handle.unmount();
  });

  await test("conversation: a heavy message is answered with its help line, no chips, no events, no heads-up, never the limit", async (w) => {
    w.server.state.scholarFreeLimit = 0;
    const handle = renderConversation(w, {});
    await until(handle, (s) => s.phase === "ready", "ready");
    handle.result.current.send("HEAVY tonight is too much");
    const state = await until(handle, (s) => !s.sending && s.messages.length === 2, "the answer");
    assert.equal(state.notice, null, "never the limit");
    assert.equal(state.heavy, true);
    assert.equal(state.help, "crisis");
    assert.equal(state.messages[1].helpLine, "crisis");
    assert.equal(state.headsUp, null);
    const newest = state.rows.find((row) => row.kind === "answer");
    assert.equal(newest.newest, true, "the screen draws no chips for it: it checks heavy (source check below)");
    state.send("ABUSE someone hurts me at home");
    const abuse = await until(handle, (s) => !s.sending && s.messages.length === 4, "the second answer");
    assert.equal(abuse.help, "abuse", "the newest help line is the one the Get help button shows");
    assert.deepEqual(w.analyticsCalls, [], "nothing is sent about a heavy conversation");
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
    const entry = serverRow(2, { is_crisis: true, help_line: "abuse" });
    w.server.state.entries.push(entry);
    const handle = renderConversation(w, { entryId: entry.id });
    const state = await until(handle, (s) => s.phase === "ready" && s.entry !== null, "the reflection");
    assert.equal(state.messages.length, 0, "a new conversation");
    assert.equal(state.heavy, true, "before its first answer: no chips, the help button");
    assert.equal(state.help, "abuse", "the Get help sheet shows the reflection's own line");
    state.send("I don’t know what to do");
    const answered = await until(handle, (s) => !s.sending && s.messages.length === 2, "the answer");
    assert.equal(answered.heavy, true);
    assert.equal(answered.headsUp, null);
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
  await test("rows: an answer is shared as its words, passages and prayer in the saved order, never the person's message; nothing to share is null", async (w) => {
    const { answerShareText } = w.use("@/utils/scholarRows");
    const { copy } = w.use("@/constants/copy");
    const scripture = (verified, words) => ({ reference: "Psalm 23:1–2", text: words, translation: "BSB", verified });
    const answer = (blocks) => ({
      id: "a1", conversationId: CONV, role: "scholar", replyTo: "u1", inputType: null, status: "ready", errorCode: null,
      blocks, isHeavy: false, helpLine: null, createdAt: new Date(BASE).toISOString(),
    });
    const body = answerShareText(
      answer([
        { type: "passage", scripture: scripture(true, "The LORD is my shepherd; I shall not want.") },
        { type: "text", text: " First.\n\nSecond. " },
        { type: "prayer", text: "Lord, stay near." },
      ]),
    );
    assert.equal(body, "“The LORD is my shepherd; I shall not want.”\n— Psalm 23:1–2 (BSB)\n\nFirst.\n\nSecond.\n\n“Lord, stay near. Amen.”");
    assert.equal(copy.scholar.share.message(body), `${body}\n\nShared from GraceHush`);
    // A passage that is not verified shares nothing of itself, and an answer with nothing to share is null.
    assert.equal(answerShareText(answer([{ type: "passage", scripture: scripture(false, null) }])), null);
    assert.equal(answerShareText(answer([{ type: "passage", scripture: scripture(true, "") }, { type: "text", text: "   " }])), null);
    assert.equal(
      answerShareText(answer([{ type: "passage", scripture: scripture(false, "Words that must not leave unverified") }, { type: "text", text: "Kept." }])),
      "Kept.",
    );
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
    assert.ok(w.audio.players[0].uri.endsWith(`/cache/scholar/${id}-0.wav`));
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

  await test("listen: a free account is refused with listen_plan; in a heavy conversation it plays for everyone", async (w) => {
    const id = await answerOf(w);
    const player = w.use("@/services/scholarPlayer");
    await player.playScholarAnswer(id);
    await settle(4);
    const refused = player.getScholarListenState();
    assert.equal(refused.phase, "failed");
    assert.equal(refused.usage.kind, "listen_plan", "the screen opens the Paywall with reason listen");
    assert.equal(w.audio.players.length, 0);
    const heavy = await repo(w).sendTurn(text("HEAVY I cannot sleep", 2, { conversationId: mid(30) }));
    await player.playScholarAnswer(heavy.data.answer.id);
    await settle(6);
    assert.equal(player.getScholarListenState().phase, "playing");
    player.clearScholarAudio();
  }, { player: true });
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
    assert.match(screen, /!chat\.heavy && known && !isPaid/, "a free account's Listen opens the Paywall, except when heavy");
    assert.match(screen, /useEffect\(\(\) => \(\) => clearScholarAudio\(\), \[\]\)/, "closing the screen empties the cache");
    assert.ok(!/haptics/.test(screen), "no haptic on the screen");
    const hook = read("src/hooks/useConversation.ts");
    assert.match(hook, /if \(!saved\.isHeavy && !answer\.isHeavy\) \{/, "events only outside a heavy conversation");
    const composer = read("src/screens/scholar/ConversationComposer.tsx");
    assert.ok(!/usage|remaining|LIMIT/.test(composer), "the composer knows no limit");
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

  sourceCheck("chat: Share is the system sheet with the answer's words only, never in a heavy conversation or under a help line", () => {
    const screen = read("src/screens/scholar/ConversationScreen.tsx");
    assert.match(
      screen,
      /onShare=\{chat\.heavy \|\| item\.message\.helpLine !== null \? null : \(\) => void shareAnswer\(item\.message\)\}/,
      "offered only outside a heavy conversation and under an answer with no help line",
    );
    assert.match(screen, /const body = answerShareText\(message\);\s+if \(body === null\) return;/, "what is shared is built from the answer alone");
    assert.match(screen, /await Share\.share\(\{ message: copy\.scholar\.share\.message\(body\) \}\);/);
    assert.ok(!/haptics/.test(screen), "no haptic");
    assert.ok(!/track\(/.test(screen), "no event for a share");
    const rows = read("src/utils/scholarRows.ts");
    const builder = rows.slice(rows.indexOf("export function answerShareText"));
    assert.ok(!/role === "user"|messageText\(/.test(builder), "the builder never reads the person's words");
    assert.match(screen, /numberOfLines=\{1\} className="text-body-sm text-mauve"/, "the title sits under Scholar in the header");
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
      { talkSeconds: 600, monthSecondsLeft: 1800 },
    );
    assert.match(started.data.limits.resetsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "a time the phone can read");
    const ended = await repo(w).finishTalk(started.data.talkId);
    assert.equal(ended.ok, true);
    assert.equal(ended.limits.monthSecondsLeft, 1740, "what is left is the server's number");
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
    const plan = await repo(w).startTalk({ conversationId: CONV, entryId: null });
    assert.equal(plan.code, "LIMIT_REACHED");
    assert.equal(plan.usage.kind, "talk_plan");
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
    assert.equal(last.limits.monthSecondsLeft, 1740, "what is left of the month, as the server answered the end");
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
    assert.equal(w.server.state.talkMonthLeft, 1800, "the month is untouched");
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
    assert.equal(talk.getTalkState().last.limits.monthSecondsLeft, 1740, "the third try answered");
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
    assert.match(conversation, /const canTalk = voiceSupported\(\) && !\(chat\.heavy && known && !isPaid\);/, "never a paywall in a heavy conversation");
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
    assert.ok(!/\b600\b|\b1800\b|\b30 \* 60\b/.test(screen), "the cap is the server's");
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

(async () => {
  await dataChecks();
  await conversationChecks();
  await rowChecks();
  await listenChecks();
  await accountChecks();
  sourceChecks();
  await copyChecks();
  await talkChecks();
  talkSourceChecks();
  await talkCopyChecks();
  for (const stack of strayFetches) failures.push(stack);
  if (failures.length > 0) {
    console.log(`${passed} checks passed, ${failures.length} FAILED:\n`);
    for (const failure of failures) console.log(` - ${failure}\n`);
    process.exitCode = 1;
  } else {
    console.log(`${passed} checks passed`);
  }
})();
