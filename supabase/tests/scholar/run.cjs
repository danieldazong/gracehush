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

// The Talk screen's side: ElevenLabs' three calls, recorded.
function fakeControls(talk) {
  const controls = { starts: [], ends: 0, mutes: [] };
  controls.detach = talk.attachTalkControls({
    start: (token, session) => void controls.starts.push({ token, session }),
    end: () => void (controls.ends += 1),
    setMuted: (muted) => void controls.mutes.push(muted),
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
    assert.match(screen, /onMessage=\{\(\{ role \}\) =>/, "ElevenLabs' text is never read: only who spoke");
    assert.ok(!/\b600\b|\b1800\b|\b30 \* 60\b/.test(screen), "the cap is the server's");
    assert.ok(!/console\./.test(screen), "nothing is logged");
    const service = read("src/services/scholarTalk.ts");
    assert.ok(!/console\./.test(service));
    assert.match(service, /if \(next === "background"\) void finish\("left_app"\);/, "only the background ends a talk");
    assert.match(read("src/services/account.ts"), /await endLiveTalk\(\);/, "sign-out ends a talk first");
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
