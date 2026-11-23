// The step 25 checks: the real Journal and Reflection data. They run the app's real TypeScript (the Edge Function gateway, the
// queries, the read cache, the repository, the processor, the sync engine and both screen hooks) with the real supabase-js
// client against a fake Supabase (world.cjs) that answers like PostgREST and the two Edge Functions, and that records
// everything the database or AGENTS.md would refuse. Every check ends by asserting that nothing like that was sent and that
// the development log holds no word, id, token or verse.
//
//   node --no-warnings supabase/tests/journal-data/run.cjs         (needs Node 22.5 or newer for node:sqlite)
//   GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/journal-data/run.cjs
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const W = require("./world.cjs");

const {
  makeLiveWorld,
  serverRow,
  affirmationRows,
  readyResult,
  crisisResult,
  fnError,
  limitBody,
  json,
  stamp,
  fixtures,
  settle,
  advance,
  clock,
  BASE,
  installClock,
  uninstallClock,
  installVirtualDate,
  uninstallVirtualDate,
} = W;

const REPO = process.env.GRACEHUSH_REPO;
let passed = 0;
const failures = [];
let finished = false;
// FAILFAST=1 stops at the first check that fails (the rest are not run): the mutation runs only need to see one named failure.
let stopped = false;

// The real timers, taken before any check installs the virtual clock: a check that waits for something that never happens
// must fail by name, not leave Node to exit quietly with nothing printed.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const CHECK_LIMIT_MS = 20000;

// Words, ids, tokens and places that must never reach the development log.
const FORBIDDEN_IN_LOGS = [
  "the words of entry",
  "secret prayer",
  "shepherd",
  "devotional of entry",
  "tokA",
  "tokB",
  "user_a",
  "user_b",
  "c0000000-0000",
  "00000000-0000-4000",
  "abcdefghij",
  "sb_publishable",
  "file:///",
  "/raw/",
];

function assertQuiet(w) {
  for (const line of w.logs) {
    for (const word of FORBIDDEN_IN_LOGS) {
      assert.ok(!line.includes(word), `the development log holds "${word}": ${line.slice(0, 120)}`);
    }
  }
}

async function test(name, run, options = {}) {
  // ONLY=<text> runs the checks whose name holds that text (ONLY="a|b" runs those holding either): a quick way to try one
  // group while working.
  if (process.env.ONLY !== undefined && !process.env.ONLY.split("|").some((part) => name.includes(part))) return;
  if (stopped) return;
  const startedAt = process.hrtime.bigint();
  installClock();
  installVirtualDate();
  clock.now = options.now ?? BASE;
  const w = makeLiveWorld(options);
  let limit;
  try {
    if (options.signIn !== false) await w.signIn();
    await Promise.race([
      run(w),
      new Promise((_, reject) => {
        limit = realSetTimeout(() => reject(new Error("the check never finished: a promise was never settled")), CHECK_LIMIT_MS);
      }),
    ]);
    assert.deepEqual(w.server.state.violations, [], "the app sent something the database or AGENTS.md refuses");
    assertQuiet(w);
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 7).join("\n    ")}`);
    if (process.env.FAILFAST) stopped = true;
  } finally {
    realClearTimeout(limit);
    w.close();
    uninstallVirtualDate();
    uninstallClock();
    if (process.env.TIMINGS) process.stderr.write(`${Number((process.hrtime.bigint() - startedAt) / 1000000n)} ms  ${name.slice(0, 90)}${String.fromCharCode(10)}`);
  }
}

// ------------------------------------------------------------------ helpers
const WORDS = "I am carrying a secret prayer about my sister";
const text = (id, words = WORDS) => ({ clientEntryId: id, inputType: "text", text: words });
const audio = (id) => ({ clientEntryId: id, inputType: "audio", durationMs: 20000, mimeType: "audio/mp4" });
const ISO = (ms) => new Date(ms).toISOString();

// n rows on the fake server, newest first (1 is one minute before BASE), each finished one with its three affirmations.
function seedServer(w, count, build = () => ({})) {
  for (let n = 1; n <= count; n += 1) {
    const row = serverRow(n, build(n));
    w.server.state.entries.push(row);
    if (row.processing_status === "ready" && !row.is_crisis) w.server.state.affirmations.push(...affirmationRows(row.id, row.user_id));
  }
}

// The mapped model of server row n, as the app makes it.
const modelOf = (w, n, extra = {}) => w.use("@/data/mappers").toJournalEntry(serverRow(n, extra));

// Puts entries (and their affirmations) in the phone's read cache, as an earlier visit would have.
async function seedCache(w, models) {
  const cache = w.use("@/db/cache");
  const mappers = w.use("@/data/mappers");
  for (const model of models) {
    await cache.upsertEntry(model);
    if (model.status === "ready" && !model.isCrisis) {
      await cache.upsertAffirmations(model.id, affirmationRows(model.id).map(mappers.toAffirmation));
    }
  }
}

const journalReads = (w) => w.server.state.requests.filter((r) => r.method === "GET" && r.path.endsWith("/journal_entries"));
const affirmationReads = (w) => w.server.state.requests.filter((r) => r.method === "GET" && r.path.endsWith("/daily_affirmations"));
const functionCalls = (w, name) => w.server.state.requests.filter((r) => r.path === `/functions/v1/${name}`);
const query = (request) => new URLSearchParams(request.search);

function describeState(state) {
  if (state === null || state === undefined) return String(state);
  if (state.status !== "ready") return state.status;
  const parts = [`ready`];
  if ("entries" in state) parts.push(`entries ${state.entries.length}`);
  if ("entryCount" in state) parts.push(`count ${state.entryCount}`);
  if ("entry" in state) parts.push(`entry ${state.entry.id} ${state.entry.status}`);
  return parts.join(", ");
}

async function until(handle, predicate, label, rounds = 100) {
  for (let i = 0; i < rounds; i += 1) {
    if (predicate(handle.result.current)) return handle.result.current;
    await settle(2);
  }
  assert.fail(`${label}: the state never became what was waited for (last: ${describeState(handle.result.current)})`);
}

async function enqueue(w, item) {
  const outbox = w.use("@/db/outbox");
  await outbox.enqueue(item);
  return outbox.get(item.clientEntryId);
}

// The server weekWindow, read from the server file itself. That file imports the database layer (Deno), so only its pure week
// code is taken, from the WeekWindow type up to the limit types, and run here with the server constants.
function loadServerWeek() {
  const dir = path.join(REPO, "supabase", "functions", "_shared", "limits");
  const source = fs.readFileSync(path.join(dir, "weekly.ts"), "utf8");
  const start = source.indexOf("export type WeekWindow");
  const end = source.indexOf("export type LimitProfile");
  assert.ok(start >= 0 && end > start, "the week code of weekly.ts is where this check looks for it");
  const constants = fs.readFileSync(path.join(dir, "constants.ts"), "utf8");
  const startsOn = /export const WEEK_STARTS_ON = (\d)/.exec(constants);
  assert.ok(startsOn, "WEEK_STARTS_ON is in limits/constants.ts");
  const ts = require(path.join(REPO, "node_modules", "typescript"));
  const { outputText } = ts.transpileModule(`const WEEK_STARTS_ON = ${startsOn[1]};
${source.slice(start, end)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", outputText)(module.exports, module);
  return module.exports;
}

// ================================================================== the gateway to the two Edge Functions
async function gatewayChecks() {
  await test("gateway: a written reflection goes to process-entry with the session token, the publishable key and exactly the contract's fields", async (w) => {
    const api = w.use("@/api/journalApi");
    const result = await api.processEntry(text("c1", "hello there my friend"));
    assert.equal(result.ok, true);
    assert.equal(result.data.entry.clientEntryId, "c1");
    assert.equal(result.data.affirmations.length, 3);
    const [call] = functionCalls(w, "process-entry");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, "Bearer tokA");
    assert.equal(call.headers.apikey, W.PUBLISHABLE_KEY);
    assert.equal(call.headers["content-type"], "application/json");
    assert.equal(call.search, "", "no region and no query: the nearest function answers");
    assert.deepEqual(call.body, { clientEntryId: "c1", inputType: "text", text: "hello there my friend" });
    assert.equal(w.server.state.functionCalls.length, 1);
  });

  await test("gateway (step 37): an affirmation's verse is kept as it came; none, no verse key (a function from before step 37) or half a verse is null", async (w) => {
    const api = w.use("@/api/journalApi");
    const verse = { reference: "Psalm 46:1", text: "God is our refuge and strength,\nan ever-present help in times of trouble." };
    const base = readyResult(text("c1")).response;
    const answer = {
      ...base,
      affirmations: [
        { ...base.affirmations[0], verse },
        (({ verse: _gone, ...rest }) => rest)(base.affirmations[1]),
        { ...base.affirmations[2], verse: { reference: "Psalm 23:1", text: "   " } },
      ],
    };
    w.server.state.functions["process-entry"].push(() => json(200, answer));
    const result = await api.processEntry(text("c1"));
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.affirmations.map((item) => item.verse), [verse, null, null]);
  });

  await test("gateway: every response the function can give is accepted as it is (the seven fixtures of the contract)", async (w) => {
    const api = w.use("@/api/journalApi");
    for (const fixture of fixtures) {
      w.server.state.functions["process-entry"].push(() => json(200, fixture.expected));
      const result = await api.processEntry(text("c1"));
      assert.equal(result.ok, true, `${fixture.name}: ${JSON.stringify(result).slice(0, 200)}`);
      assert.deepEqual(result.data, fixture.expected, fixture.name);
    }
  });

  await test("gateway: an answer that is not what the contract promises is UNKNOWN with status 200, never a crash", async (w) => {
    const api = w.use("@/api/journalApi");
    const good = fixtures[1].expected;
    const bad = [
      json(200, {}),
      json(200, null),
      json(200, []),
      json(200, { entry: { id: 1 }, affirmations: [] }),
      json(200, { entry: good.entry }),
      json(200, { entry: good.entry, affirmations: [{ id: "x" }] }),
      json(200, { entry: { ...good.entry, status: "weird" }, affirmations: [] }),
      json(200, { entry: { ...good.entry, inputType: "voice" }, affirmations: [] }),
      json(200, { entry: { ...good.entry, scripture: { reference: "x" } }, affirmations: [] }),
      new Response("OK", { status: 200, headers: { "content-type": "text/plain" } }),
    ];
    for (const [index, response] of bad.entries()) {
      w.server.state.functions["process-entry"].push(() => response);
      const result = await api.processEntry(text("c1"));
      assert.equal(result.ok, false, `case ${index}`);
      assert.equal(result.code, "UNKNOWN", `case ${index}`);
      assert.equal(result.status, 200, `case ${index}`);
    }
  });

  await test("gateway: a failure keeps the function's own code and the HTTP status, and the parsed body", async (w) => {
    const api = w.use("@/api/journalApi");
    const cases = [
      [400, "INVALID_REQUEST"],
      [401, "UNAUTHORIZED"],
      [405, "METHOD_NOT_ALLOWED"],
      [409, "ALREADY_PROCESSING"],
      [413, "PAYLOAD_TOO_LARGE"],
      [422, "TOO_SHORT"],
      [422, "NO_SPEECH"],
      [429, "RATE_LIMITED"],
      [500, "INTERNAL"],
      [503, "AI_UNAVAILABLE"],
      [404, "AUDIO_NOT_FOUND"],
    ];
    for (const [status, code] of cases) {
      w.server.state.functions["process-entry"].push(() => fnError(status, code));
      const result = await api.processEntry(text("c1"));
      assert.equal(result.ok, false);
      assert.equal(result.status, status);
      assert.equal(result.code, code);
      assert.equal(result.body.error.code, code);
    }
  });

  await test("gateway: an answer with no code of ours falls back on the status (a platform page, an empty body, a function that is not deployed)", async (w) => {
    const api = w.use("@/api/journalApi");
    const cases = [
      [new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }), 502, "INTERNAL"],
      [new Response(null, { status: 546 }), 546, "INTERNAL"],
      [new Response(null, { status: 401 }), 401, "UNAUTHORIZED"],
      [new Response(null, { status: 403 }), 403, "UNAUTHORIZED"],
      [new Response(null, { status: 429 }), 429, "RATE_LIMITED"],
      [new Response(null, { status: 418 }), 418, "UNKNOWN"],
      [json(404, { message: "Requested function was not found" }, { "x-relay-error": "true" }), 404, "UNKNOWN"],
      [json(500, { error: "a string, not an object" }), 500, "INTERNAL"],
      [json(500, { error: { code: 7 } }), 500, "INTERNAL"],
    ];
    for (const [response, status, code] of cases) {
      w.server.state.functions["process-entry"].push(() => response);
      const result = await api.processEntry(text("c1"));
      assert.equal(result.ok, false);
      assert.equal(result.status, status, code);
      assert.equal(result.code, code, `status ${status}`);
    }
  });

  await test("gateway: no answer is NETWORK (status 0), and so is a request that outlasts its timeout", async (w) => {
    const api = w.use("@/api/journalApi");
    const { PROCESS_ENTRY_TIMEOUT_MS, CONFIRM_SCRIPTURE_TIMEOUT_MS } = w.use("@/constants/app");
    w.server.state.offline = true;
    let result = await api.processEntry(text("c1"));
    assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 0, code: "NETWORK" });
    w.server.state.offline = false;

    for (const [name, call, timeout] of [
      ["process-entry", () => api.processEntry(text("c1")), PROCESS_ENTRY_TIMEOUT_MS],
      ["confirm-scripture", () => api.confirmScripture("e1"), CONFIRM_SCRIPTURE_TIMEOUT_MS],
    ]) {
      w.server.state.functions[name].push(() => new Promise(() => undefined));
      let settled = null;
      const pending = call().then((r) => (settled = r));
      await advance(timeout - 1000);
      assert.equal(settled, null, `${name} gave up before its timeout`);
      await advance(1500);
      result = await pending;
      assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 0, code: "NETWORK" }, name);
    }
    assert.equal(PROCESS_ENTRY_TIMEOUT_MS, 155_000);
    assert.equal(CONFIRM_SCRIPTURE_TIMEOUT_MS, 15_000);
  });

  await test("gateway: signed out sends nothing; a token that cannot be had is UNAUTHORIZED with no request; a Clerk that cannot be reached is NETWORK", async (w) => {
    const api = w.use("@/api/journalApi");
    const client = w.use("@/services/supabaseClient");
    client.setSupabaseSession(null);
    let result = await api.processEntry(text("c1"));
    assert.deepEqual({ status: result.status, code: result.code }, { status: 0, code: "UNAUTHORIZED" });
    result = await api.confirmScripture("e1");
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(w.server.state.requests.length, 0);

    client.setSupabaseSession({ userId: "user_a", getToken: async () => null });
    result = await api.processEntry(text("c1"));
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(w.server.state.requests.length, 0, "no token, no request: the publishable key is never the bearer");

    client.setSupabaseSession({
      userId: "user_a",
      getToken: async () => {
        throw new TypeError("Network request failed");
      },
    });
    result = await api.processEntry(text("c1"));
    assert.deepEqual({ status: result.status, code: result.code }, { status: 0, code: "NETWORK" });
    assert.equal(w.server.state.requests.length, 0);
  });

  await test("gateway: a token the server refuses is UNAUTHORIZED with the status the function gave", async (w) => {
    const api = w.use("@/api/journalApi");
    w.use("@/services/supabaseClient").setSupabaseSession({ userId: "user_a", getToken: async () => "stale-token" });
    const result = await api.processEntry(text("c1"));
    assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 401, code: "UNAUTHORIZED" });
  });

  await test("gateway: the last call is remembered as a name, a status, a code and a time, never a body", async (w) => {
    const api = w.use("@/api/journalApi");
    assert.equal(api.getLastFunctionCall(), null);
    w.server.state.functions["process-entry"].push(() => json(402, limitBody("entry-x", "2026-10-26T00:00:00.000Z")));
    await api.processEntry(text("c1", "words that must not be remembered"));
    assert.deepEqual(Object.keys(api.getLastFunctionCall()).sort(), ["code", "ms", "name", "status"]);
    assert.deepEqual({ ...api.getLastFunctionCall(), ms: 0 }, { name: "process-entry", status: 402, code: "LIMIT_REACHED", ms: 0 });
    await api.confirmScripture("e1");
    assert.deepEqual({ ...api.getLastFunctionCall(), ms: 0 }, { name: "confirm-scripture", status: 200, code: null, ms: 0 });
    assert.ok(!JSON.stringify(api.getLastFunctionCall()).includes("words that"));
  });

  await test("gateway: readLimitBody reads the 402 and nothing else", async (w) => {
    const { readLimitBody } = w.use("@/api/journalApi");
    assert.deepEqual(readLimitBody(limitBody("e1", "2026-10-26T00:00:00.000Z")), { entryId: "e1", resetsAt: "2026-10-26T00:00:00.000Z" });
    for (const body of [null, undefined, "x", 4, [], {}, { entryId: 1, usage: { resetsAt: "x" } }, { entryId: "e", usage: null }, { entryId: "e", usage: {} }, { entryId: "e", usage: { resetsAt: 5 } }]) {
      assert.equal(readLimitBody(body), null, JSON.stringify(body));
    }
  });

  await test("gateway: confirm-scripture sends only the entry id and accepts a passage or none", async (w) => {
    const api = w.use("@/api/journalApi");
    let result = await api.confirmScripture("entry-1");
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { scripture: null });
    assert.deepEqual(functionCalls(w, "confirm-scripture")[0].body, { entryId: "entry-1" });
    const passage = { reference: "Psalm 23:1", text: "The LORD is my shepherd; I shall not want.", translation: "BSB", verified: true };
    w.server.state.functions["confirm-scripture"].push(() => json(200, { scripture: passage }));
    result = await api.confirmScripture("entry-1");
    assert.deepEqual(result.data, { scripture: passage });
    w.server.state.functions["confirm-scripture"].push(() => json(200, { scripture: { reference: "x" } }));
    assert.equal((await api.confirmScripture("entry-1")).code, "UNKNOWN");
    w.server.state.functions["confirm-scripture"].push(() => json(200, {}));
    assert.equal((await api.confirmScripture("entry-1")).code, "UNKNOWN");
    w.server.state.functions["confirm-scripture"].push(() => fnError(404, "NOT_FOUND"));
    result = await api.confirmScripture("entry-1");
    assert.deepEqual({ status: result.status, code: result.code }, { status: 404, code: "NOT_FOUND" });
  });
}

// ================================================================== the queries
async function queryChecks() {
  await test("entries: the first page asks for the explicit columns, this user, the listed statuses, newest first and one row more than the page", async (w) => {
    seedServer(w, 12);
    const remote = w.use("@/data/entriesRemote");
    const { ENTRY_COLUMNS } = w.use("@/data/columns");
    const page = await remote.selectEntriesPage(null, 5);
    assert.equal(page.ok, true);
    const [request] = journalReads(w);
    const q = query(request);
    assert.equal(q.get("select"), ENTRY_COLUMNS.replace(/\s/g, ""));
    assert.ok(!q.get("select").split(",").some((c) => ["*", "audio_path", "user_id"].includes(c)));
    assert.equal(q.get("user_id"), "eq.user_a");
    assert.equal(q.get("processing_status"), "in.(ready,processing)");
    assert.equal(q.get("order"), "created_at.desc");
    assert.equal(q.get("limit"), "6");
    assert.equal(q.get("created_at"), null, "the first page has no cursor");
    assert.match(request.headers.prefer ?? "", /count=exact/);
    assert.equal(request.headers.authorization, "Bearer tokA");
  });

  await test("entries: pages walk the whole list with a cursor, none twice and none skipped, and the cursor keeps the server's own text while the rows get canonical times", async (w) => {
    seedServer(w, 12);
    const remote = w.use("@/data/entriesRemote");
    const ids = [];
    let cursor = null;
    let first = null;
    for (let guard = 0; guard < 5; guard += 1) {
      const page = await remote.selectEntriesPage(cursor, 5);
      assert.equal(page.ok, true);
      if (cursor === null) first = page.data;
      else assert.equal(page.data.total, null, "only the first page counts the whole list");
      ids.push(...page.data.rows.map((row) => row.id));
      if (page.data.nextCursor === null) break;
      cursor = page.data.nextCursor;
      assert.equal(cursor, ids.length === 5 ? serverRow(5).created_at : serverRow(10).created_at, "the cursor is the last row's text as the server wrote it");
      const last = journalReads(w).at(-1);
      assert.equal(query(last).get("limit"), "6");
    }
    assert.equal(first.total, 12);
    assert.equal(first.rows.length, 5);
    const { normalizeTimestamp } = w.use("@/utils/timestamp");
    assert.equal(first.rows[0].created_at, normalizeTimestamp(serverRow(1).created_at));
    assert.match(first.rows[0].created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "three digits and a Z: the form every engine reads");
    assert.match(first.rows[0].updated_at, /\.\d{3}Z$/);
    assert.deepEqual(ids, Array.from({ length: 12 }, (_, i) => serverRow(i + 1).id));
    const withCursor = journalReads(w).filter((r) => query(r).get("created_at") !== null);
    assert.equal(withCursor.length, 2);
    assert.equal(query(withCursor[0]).get("created_at"), `lt.${serverRow(5).created_at}`);
    assert.match(serverRow(5).created_at, /\+00:00$/);
  });

  await test("entries: only this user's rows come back, and only the listed statuses", async (w) => {
    seedServer(w, 3);
    for (const [n, status] of [[10, "failed"], [11, "failed"], [12, "pending"], [13, "processing"]]) {
      w.server.state.entries.push(serverRow(n, { processing_status: status }));
    }
    for (let n = 20; n < 24; n += 1) w.server.state.entries.push(serverRow(n, { user_id: "user_b" }));
    const page = await w.use("@/data/entriesRemote").selectEntriesPage(null, 10);
    assert.equal(page.ok, true);
    assert.equal(page.data.total, 4);
    assert.deepEqual(page.data.rows.map((r) => r.processing_status).sort(), ["processing", "ready", "ready", "ready"]);
    assert.ok(page.data.rows.every((row) => !("audio_path" in row) && !("user_id" in row)));
  });

  await test("entries: one entry by id of any status; missing and someone else's are null", async (w) => {
    seedServer(w, 2);
    w.server.state.entries.push(serverRow(30, { processing_status: "failed", error_code: "AI_UNAVAILABLE" }));
    w.server.state.entries.push(serverRow(31, { user_id: "user_b" }));
    const remote = w.use("@/data/entriesRemote");
    let result = await remote.selectEntry(serverRow(1).id);
    assert.equal(result.ok, true);
    assert.equal(result.data.id, serverRow(1).id);
    assert.match(result.data.created_at, /\.\d{3}Z$/, "the times are in the form the app keeps");
    result = await remote.selectEntry(serverRow(30).id);
    assert.equal(result.data.processing_status, "failed");
    assert.equal((await remote.selectEntry("nope")).data, null);
    assert.equal((await remote.selectEntry(serverRow(31).id)).data, null);
    const q = query(journalReads(w)[0]);
    assert.equal(q.get("id"), `eq.${serverRow(1).id}`);
    assert.equal(q.get("user_id"), "eq.user_a");
  });

  await test("entries: the affirmations of an entry carry the eight columns the app shows and no more, and another user's are never returned", async (w) => {
    seedServer(w, 2);
    w.server.state.affirmations.push(...affirmationRows(serverRow(99).id, "user_b"));
    const remote = w.use("@/data/entriesRemote");
    const result = await remote.selectAffirmations(serverRow(1).id);
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 3);
    assert.deepEqual(Object.keys(result.data[0]).sort(), [
      "affirmation_text",
      "entry_id",
      "headline",
      "id",
      "is_favorite",
      "position",
      "time_slot",
      "verse_reference",
      "verse_text",
    ]);
    assert.deepEqual((await remote.selectAffirmations(serverRow(99).id)).data, []);
  });

  await test("entries: a favorite sends is_favorite and nothing else, filtered by id and by user; a missing or foreign affirmation is NOT_FOUND", async (w) => {
    seedServer(w, 1);
    const own = affirmationRows(serverRow(1).id)[0];
    const foreign = affirmationRows(serverRow(50).id, "user_b")[0];
    w.server.state.affirmations.push(...affirmationRows(serverRow(50).id, "user_b"));
    const remote = w.use("@/data/entriesRemote");
    const saved = await remote.updateAffirmationFavorite(own.id, true);
    assert.equal(saved.ok, true);
    assert.equal(saved.data.is_favorite, true);
    assert.equal(w.server.state.affirmations.find((a) => a.id === own.id).is_favorite, true);
    const patch = w.server.state.requests.find((r) => r.method === "PATCH");
    assert.deepEqual(patch.body, { is_favorite: true });
    assert.equal(query(patch).get("id"), `eq.${own.id}`);
    assert.equal(query(patch).get("user_id"), "eq.user_a");
    assert.match(patch.headers.prefer ?? "", /return=representation/);
    assert.equal((await remote.updateAffirmationFavorite(foreign.id, true)).code, "NOT_FOUND");
    assert.equal(w.server.state.affirmations.find((a) => a.id === foreign.id).is_favorite, false);
    assert.equal((await remote.updateAffirmationFavorite("missing", true)).code, "NOT_FOUND");
  });

  await test("entries: failures map to NETWORK, UNAUTHORIZED and UNKNOWN, and the one dev line holds a table and a code only", async (w) => {
    seedServer(w, 2);
    const remote = w.use("@/data/entriesRemote");
    assert.equal(remote.getLastEntriesError(), null);
    w.server.state.offline = true;
    let result = await remote.selectEntriesPage(null, 5);
    assert.equal(result.ok, false);
    assert.equal(result.code, "NETWORK");
    assert.match(remote.getLastEntriesError(), /^journal_entries: /);
    w.server.state.offline = false;
    w.server.state.rest.journal_entries.push(json(500, { code: "XX000", message: "boom with words the person wrote" }));
    result = await remote.selectEntry("x");
    assert.equal(result.code, "UNKNOWN");
    assert.equal(remote.getLastEntriesError(), "journal_entries: XX000");
    w.server.state.rest.daily_affirmations.push(json(403, { code: "42501", message: "permission denied" }));
    result = await remote.selectAffirmations("x");
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(remote.getLastEntriesError(), "daily_affirmations: 42501");
    assert.equal((await remote.selectEntriesPage(null, 5)).ok, true);
    assert.equal(remote.getLastEntriesError(), null);
    w.use("@/services/supabaseClient").setSupabaseSession({ userId: "user_a", getToken: async () => "stale" });
    result = await remote.selectEntriesPage(null, 5);
    assert.equal(result.code, "UNAUTHORIZED");
    assert.ok(w.logs.some((line) => line.startsWith("[supabase] ")), "the dev warning exists");
    assert.ok(w.logs.every((line) => !line.includes("boom") && !line.includes("words the person")));
  });

  await test("entries: signed out, nothing is read or written", async (w) => {
    w.use("@/services/supabaseClient").setSupabaseSession(null);
    const remote = w.use("@/data/entriesRemote");
    for (const result of [
      await remote.selectEntriesPage(null, 5),
      await remote.selectEntry("x"),
      await remote.selectAffirmations("x"),
      await remote.updateAffirmationFavorite("x", true),
    ]) {
      assert.equal(result.ok, false);
      assert.equal(result.code, "UNAUTHORIZED");
    }
    assert.equal(w.server.state.requests.length, 0);
  });

  await test("columns: the explicit lists are the generated row types minus audio_path and user_id, and the six columns of an affirmation", async (w) => {
    const types = fs.readFileSync(path.join(REPO, "src", "types", "supabase.ts"), "utf8");
    const rowKeys = (table) => {
      const start = types.indexOf(`      ${table}: {`);
      assert.ok(start > 0, `${table} is in the generated types`);
      const row = types.indexOf("Row: {", start);
      // The Row block ends at its own closing brace, with or without a semicolon: the dashboard's download writes none.
      const close = /\r?\n {8}\};?\r?\n/.exec(types.slice(row));
      assert.ok(close, `${table}'s Row ends`);
      const end = row + close.index;
      return [...types.slice(row, end).matchAll(/^\s{10}(\w+)\??:/gm)].map((m) => m[1]);
    };
    const { ENTRY_COLUMNS, AFFIRMATION_COLUMNS } = w.use("@/data/columns");
    const list = (value) => value.split(",").map((c) => c.trim());
    assert.deepEqual(list(ENTRY_COLUMNS).sort(), rowKeys("journal_entries").filter((c) => !["audio_path", "user_id"].includes(c)).sort());
    assert.deepEqual(
      list(AFFIRMATION_COLUMNS).sort(),
      rowKeys("daily_affirmations").filter((c) => !["user_id", "is_delivered", "scheduled_for", "created_at"].includes(c)).sort(),
    );
    assert.ok(!ENTRY_COLUMNS.includes("*") && !AFFIRMATION_COLUMNS.includes("*"));
  }, { signIn: false });

  await test("mapper: the validation line (step 36) reaches the devotional as the server wrote it, and a row from before it gives null", async (w) => {
    const { toJournalEntry } = w.use("@/data/mappers");
    const line = "Your interview is tomorrow and the car broke down, and that is real.";
    assert.equal(toJournalEntry(serverRow(1, { validation_line: line })).devotional.validation, line);
    assert.equal(toJournalEntry(serverRow(2, { validation_line: null })).devotional.validation, null);
    const older = serverRow(3);
    delete older.validation_line;
    assert.equal(toJournalEntry(older).devotional.validation, null, "a cached row written before the column existed");
  }, { signIn: false });

  await test("headline: the validation line first, then the devotional's first sentence, then the fixed line of the emotion (step 36)", async (w) => {
    const { getReflectionHeadline, firstSentence, getValidationHeadline } = w.use("@/utils/format");
    const { copy } = w.use("@/constants/copy");
    const devotional = (validation, script) => ({ title: "T", validation, script, closingPrayer: null, audioPath: null, durationMs: null });
    const line = "Your son's surgery is Thursday and your hands won't stop shaking, and that's real.";
    const script = "Tears came in the driveway over a warm meal. Then more words.\n\nA second paragraph.";
    // The line wins, never the stock line of the emotion.
    assert.equal(getReflectionHeadline({ dominantEmotion: "anxious", devotional: devotional(line, script) }), line);
    assert.notEqual(getReflectionHeadline({ dominantEmotion: "anxious", devotional: devotional(line, script) }), copy.reflection.headlines.anxious);
    // No line, or an empty one: the devotional's first sentence, before the fixed line.
    for (const missing of [null, undefined, "   "]) {
      assert.equal(
        getReflectionHeadline({ dominantEmotion: "weary", devotional: devotional(missing, script) }),
        "Tears came in the driveway over a warm meal.",
      );
    }
    // Neither: the fixed line of the emotion, and the generic one for an emotion the app does not know.
    assert.equal(getReflectionHeadline({ dominantEmotion: "weary", devotional: null }), getValidationHeadline("weary"));
    assert.equal(getReflectionHeadline({ dominantEmotion: "overwhelmed", devotional: null }), copy.reflection.headlines.unknown);
    // The first sentence by the server's rule: a closing quote stays with it, a decimal point does not end it.
    assert.equal(firstSentence("“You said it.” Then more."), "“You said it.”");
    assert.equal(firstSentence("It cost 2.50 today. Then more."), "It cost 2.50 today.");
    assert.equal(firstSentence("No end mark at all"), "No end mark at all");
    assert.equal(firstSentence("  "), null);
    // A first sentence over 160 characters is cut at a word boundary, with an ellipsis, 160 characters at most.
    const long = `${"word ".repeat(60).trim()}.`;
    const cut = firstSentence(long);
    assert.ok(cut.length <= 160 && cut.endsWith("…") && !cut.includes(" …"), cut);
    assert.ok(long.startsWith(cut.slice(0, -1)));
    // The words around the headline (step 36): the sublines say where it came from, and the transcript row's title.
    assert.equal(copy.reflection.subline.audio, "Written from what you spoke.");
    assert.equal(copy.reflection.subline.text, "Written from what you wrote.");
    assert.equal(copy.reflection.words.titleAudio, "What we heard you say");
    assert.equal(copy.reflection.words.titleText, "Your written prayer");
  }, { signIn: false });
}

// ================================================================== the live source and the read cache
async function liveChecks() {
  await test("live: the first page is written to the cache and trims it to the newest 200; a later page does not trim", async (w) => {
    const live = w.use("@/data/entriesLive");
    const cache = w.use("@/db/cache");
    const mappers = w.use("@/data/mappers");
    seedServer(w, 8);
    for (let i = 0; i < 300; i += 1) {
      await cache.upsertEntry(mappers.toJournalEntry(serverRow(5000 + i, { id: `old-${i}`, client_entry_id: `old-c-${i}` })));
    }
    const first = await live.loadEntriesPage(null, 5);
    assert.equal(first.ok, true);
    assert.equal((await cache.listEntries(1000)).length, 200);
    const cached = (await cache.listEntries(1000)).map((e) => e.id);
    for (let n = 1; n <= 5; n += 1) assert.ok(cached.includes(serverRow(n).id), `entry ${n} is cached`);
    for (let i = 0; i < 20; i += 1) {
      await cache.upsertEntry(mappers.toJournalEntry(serverRow(7000 + i, { id: `older-${i}`, client_entry_id: `older-c-${i}` })));
    }
    const second = await live.loadEntriesPage(first.data.nextCursor, 5);
    assert.equal(second.ok, true);
    assert.equal((await cache.listEntries(1000)).length, 200 + 20 + 3, "page 2 added its 3 and trimmed nothing");
  });

  await test("live: the next cursor is the last row the server returned, even when that row is not listed", async (w) => {
    const live = w.use("@/data/entriesLive");
    seedServer(w, 8, (n) => (n === 5 ? { processing_status: "processing", updated_at: stamp(BASE - 20 * 60_000) } : {}));
    const page = await live.loadEntriesPage(null, 5);
    assert.equal(page.ok, true);
    assert.deepEqual(page.data.entries.map((e) => e.id), [1, 2, 3, 4].map((n) => serverRow(n).id), "the stale processing entry is not listed");
    assert.equal(page.data.nextCursor, serverRow(5).created_at);
    assert.equal(page.data.total, 8);
    const last = await live.loadEntriesPage(page.data.nextCursor, 5);
    assert.deepEqual(last.data.entries.map((e) => e.id), [6, 7, 8].map((n) => serverRow(n).id));
    assert.equal(last.data.nextCursor, null);
    assert.equal(last.data.total, null);
  });

  await test("live: fetchEntry caches what it finds, forgets what the server no longer has, falls back to the cache offline and throws with nothing cached", async (w) => {
    const live = w.use("@/data/entriesLive");
    const cache = w.use("@/db/cache");
    seedServer(w, 2);
    const entry = await live.fetchEntry(serverRow(1).id);
    assert.equal(entry.id, serverRow(1).id);
    assert.deepEqual(await cache.getEntry(serverRow(1).id), entry);
    await seedCache(w, [modelOf(w, 77)]);
    assert.equal(await live.fetchEntry(serverRow(77).id), null);
    assert.equal(await cache.getEntry(serverRow(77).id), null, "an entry the server does not have leaves the cache");
    w.server.state.offline = true;
    assert.deepEqual(await live.fetchEntry(serverRow(1).id), entry);
    await assert.rejects(() => live.fetchEntry(serverRow(2).id), /NETWORK/);
  });

  await test("live (step 37): an affirmation's verse is read, mapped and cached; one cached before verses existed reads with none", async (w) => {
    const live = w.use("@/data/entriesLive");
    const cache = w.use("@/db/cache");
    const rows = affirmationRows(serverRow(1).id);
    rows[0].verse_reference = "Psalm 23:1";
    rows[0].verse_text = "The LORD is my shepherd;\nI shall not want.";
    w.server.state.affirmations.push(...rows);
    const list = await live.fetchAffirmations(serverRow(1).id);
    assert.deepEqual(list.map((item) => item.verse), [
      { reference: "Psalm 23:1", text: "The LORD is my shepherd;\nI shall not want." },
      null,
      null,
    ]);
    assert.deepEqual(await cache.listAffirmationsForEntry(serverRow(1).id), list);
    // A row cached by an older app has no verse key at all: it is read as none, never as undefined.
    const older = list.map(({ verse: _gone, ...rest }) => rest);
    await cache.upsertAffirmations(serverRow(1).id, older);
    const read = await cache.listAffirmationsForEntry(serverRow(1).id);
    assert.deepEqual(read.map((item) => item.verse), [null, null, null]);
  });

  await test("live: fetchAffirmations orders by slot, caches, falls back to the cache offline and throws with nothing cached", async (w) => {
    const live = w.use("@/data/entriesLive");
    const cache = w.use("@/db/cache");
    const rows = affirmationRows(serverRow(1).id);
    w.server.state.affirmations.push(rows[2], rows[0], rows[1]);
    const list = await live.fetchAffirmations(serverRow(1).id);
    assert.deepEqual(list.map((a) => a.slot), ["morning", "afternoon", "evening"]);
    assert.deepEqual(await cache.listAffirmationsForEntry(serverRow(1).id), list);
    w.server.state.offline = true;
    assert.deepEqual(await live.fetchAffirmations(serverRow(1).id), list);
    await assert.rejects(() => live.fetchAffirmations(serverRow(2).id), /NETWORK/);
  });

  await test("live: saving a favorite changes the cache only when the server accepted it", async (w) => {
    const live = w.use("@/data/entriesLive");
    const cache = w.use("@/db/cache");
    seedServer(w, 1);
    await live.fetchAffirmations(serverRow(1).id);
    const id = affirmationRows(serverRow(1).id)[1].id;
    w.server.state.offline = true;
    assert.equal((await live.saveFavorite(id, true)).ok, false);
    assert.equal((await cache.listAffirmationsForEntry(serverRow(1).id)).find((a) => a.id === id).isFavorite, false);
    w.server.state.offline = false;
    const saved = await live.saveFavorite(id, true);
    assert.equal(saved.ok, true);
    assert.equal(saved.data.isFavorite, true);
    assert.equal((await cache.listAffirmationsForEntry(serverRow(1).id)).find((a) => a.id === id).isFavorite, true);
    assert.equal((await live.saveFavorite(id, false)).data.isFavorite, false);
  });

  await test("live: the week's count takes finished entries with a devotional from the start of the week, the start included, crisis and unfinished ones never", async (w) => {
    const live = w.use("@/data/entriesLive");
    const since = new Date(BASE - 3 * 86_400_000);
    // Exact to the millisecond, so the start of the week itself is tested and not 123 ms after it.
    const at = (ms, extra = {}) => modelOf(w, 0, { id: `e-${ms}-${Object.keys(extra).join("")}`, client_entry_id: `c-${ms}-${Object.keys(extra).join("")}`, created_at: ISO(ms), updated_at: ISO(ms), ...extra });
    await seedCache(w, [
      at(since.getTime()),
      at(since.getTime() + 1),
      at(since.getTime() - 1),
      at(since.getTime() - 30 * 3_600_000),
      at(since.getTime() + 1000, { is_crisis: true, devotional_script: null, devotional_title: null, closing_prayer: null }),
      // A crisis entry never holds a devotional (the table forbids it), but the count does not rely on that.
      { ...at(since.getTime() + 1500), isCrisis: true },
      at(since.getTime() + 2000, { processing_status: "failed", devotional_script: null, devotional_title: null, closing_prayer: null }),
      at(since.getTime() + 3000, { processing_status: "processing", devotional_script: null }),
      at(BASE - 1000),
    ]);
    assert.equal(await live.countDevotionalsSince(since), 3);
  });

  await test("live: the cached list hides failed and stale processing entries, keeps fresh processing and crisis ones, and honors the limit", async (w) => {
    const live = w.use("@/data/entriesLive");
    const models = [
      modelOf(w, 1),
      modelOf(w, 2, { processing_status: "failed", error_code: "AI_UNAVAILABLE" }),
      modelOf(w, 3, { processing_status: "processing", updated_at: stamp(BASE - 20 * 60_000), created_at: stamp(BASE - 25 * 60_000) }),
      modelOf(w, 4, { processing_status: "processing", updated_at: stamp(BASE - 60_000) }),
      modelOf(w, 5, { is_crisis: true }),
      modelOf(w, 6),
    ];
    await seedCache(w, models);
    const listed = await live.readCachedEntries();
    assert.deepEqual(listed.map((e) => e.id), [1, 4, 5, 6].map((n) => serverRow(n).id));
    assert.equal((await live.readCachedEntries(2)).length, 2);
    assert.deepEqual(await live.readCachedAffirmations("nope"), []);
    const latest = await live.readCachedLatestAffirmations();
    assert.equal(latest.length, 3, "the newest finished entry that is not a crisis");
    assert.equal(latest[0].entryId, serverRow(1).id);
  });

  await test("live: a screen opens the rows it shows and a few more, not the whole cache", async (w) => {
    const live = w.use("@/data/entriesLive");
    const models = [];
    for (let n = 1; n <= 80; n += 1) models.push(modelOf(w, n));
    await seedCache(w, models);
    w.counts.decrypts = 0;
    const shown = await live.readCachedEntries(5);
    assert.deepEqual(shown.map((e) => e.id), [1, 2, 3, 4, 5].map((n) => serverRow(n).id));
    assert.ok(w.counts.decrypts <= 25, `opened ${w.counts.decrypts} rows to show 5`);
    w.counts.decrypts = 0;
    assert.equal((await live.readCachedLatestAffirmations()).length, 3);
    assert.ok(w.counts.decrypts <= 20 + 3, `opened ${w.counts.decrypts} rows to find the latest affirmations`);
    w.counts.decrypts = 0;
    assert.equal((await live.readCachedEntries()).length, 80, "the whole list, for the one screen that counts them");
    assert.ok(w.counts.decrypts >= 80);
  });

  await test("live: with the database closed every read gives nothing and every write is skipped, never an error", async (w) => {
    const live = w.use("@/data/entriesLive");
    seedServer(w, 3);
    await w.use("@/db/database").closeUserDatabase();
    assert.deepEqual(await live.readCachedEntries(), []);
    assert.equal(await live.readCachedEntry("x"), null);
    assert.deepEqual(await live.readCachedAffirmations("x"), []);
    assert.deepEqual(await live.readCachedLatestAffirmations(), []);
    assert.equal(await live.countDevotionalsSince(new Date(0)), 0);
    const page = await live.loadEntriesPage(null, 5);
    assert.equal(page.ok, true, "the network still answers");
    assert.equal(page.data.entries.length, 3);
    assert.equal((await live.fetchEntry(serverRow(1).id)).id, serverRow(1).id);
    assert.equal((await live.fetchAffirmations(serverRow(1).id)).length, 3);
  });
}

// ================================================================== the repository
const ZONES = [
  "UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Africa/Lagos", "Asia/Kolkata", "Pacific/Auckland",
  "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Sao_Paulo", "Pacific/Apia", "America/Havana", "Australia/Lord_Howe", "Not/AZone",
];

async function repositoryChecks() {
  await test("repository: the free plan's usage counts this week's devotionals from the cache in the device's zone, up to the limit", async (w) => {
    const repo = w.use("@/data/journalRepository");
    const weekly = loadServerWeek();
    const results = {};
    for (const zone of ["UTC", "Pacific/Auckland"]) {
      process.env.TZ = zone;
      const week = weekly.weekWindow(new Date(clock.now), zone);
      const at = (ms, tag) => modelOf(w, 0, { id: `${zone}-${tag}`, client_entry_id: `${zone}-c-${tag}`, created_at: stamp(ms), updated_at: stamp(ms) });
      await w.use("@/db/cache").clearAll();
      await seedCache(w, [at(week.start.getTime() + 1000, "in-1"), at(week.start.getTime() - 1000, "out-1"), at(week.start.getTime() + 5000, "in-2")]);
      const usage = await repo.getUsage();
      results[zone] = usage;
      assert.equal(usage.tier, "free");
      assert.equal(usage.limit, 3);
      assert.equal(usage.used, 2, zone);
      assert.equal(usage.resetsAt, week.end.toISOString(), zone);
    }
    assert.notEqual(results.UTC.resetsAt, results["Pacific/Auckland"].resetsAt, "the zone changes when the week ends");
    process.env.TZ = "UTC";
    await w.use("@/db/cache").clearAll();
    const many = [];
    for (let i = 0; i < 6; i += 1) many.push(modelOf(w, 0, { id: `m-${i}`, client_entry_id: `m-c-${i}`, created_at: stamp(BASE - i * 1000), updated_at: stamp(BASE - i * 1000) }));
    await seedCache(w, many);
    assert.equal((await repo.getUsage()).used, 3, "capped at the limit: a lapsed subscriber can have made more");
  });

  await test("repository: a trial or pro plan is unlimited and counts nothing", async (w) => {
    for (const plan of ["pro", "trial"]) {
      await w.signIn({ plan });
      const usage = await w.use("@/data/journalRepository").getUsage();
      assert.deepEqual({ tier: usage.tier, used: usage.used, limit: usage.limit }, { tier: plan, used: 0, limit: null });
      assert.equal(typeof usage.resetsAt, "string");
    }
  });

  await test("repository: the week of the app equals the week of the server for 14 zones across daylight-saving changes and week edges", async (w) => {
    const app = w.use("@/utils/week");
    const server = loadServerWeek();
    const instants = [
      "2026-01-01T00:00:00Z", "2026-03-08T06:59:59Z", "2026-03-08T07:00:01Z", "2026-03-29T00:59:59Z", "2026-03-29T01:00:01Z",
      "2026-04-05T14:30:00Z", "2026-09-27T12:00:00Z", "2026-10-04T15:00:00Z", "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z",
      "2026-10-26T00:00:00Z", "2026-10-31T23:59:59Z", "2026-11-01T06:30:00Z", "2026-11-01T09:00:00Z", "2026-12-31T23:59:59Z",
    ];
    let compared = 0;
    for (const zone of ZONES) {
      for (const iso of instants) {
        const now = new Date(iso);
        const a = app.weekWindow(now, zone);
        const b = server.weekWindow(now, zone);
        assert.equal(a.start.toISOString(), b.start.toISOString(), `${zone} ${iso} start`);
        assert.equal(a.end.toISOString(), b.end.toISOString(), `${zone} ${iso} end`);
        assert.equal(a.zoneFallback, b.zoneFallback, `${zone} fallback`);
        assert.ok(a.start.getTime() <= now.getTime() && now.getTime() < a.end.getTime());
        compared += 1;
      }
    }
    assert.equal(compared, 14 * 15);
    assert.equal(app.weekWindow(new Date("2026-10-25T12:00:00Z"), "Not/AZone").zoneFallback, true);
  }, { signIn: false });

  await test("repository: the real list is the read cache; the mock list is the mock database; the cached reads give nothing for the mock", async (w) => {
    const repo = w.use("@/data/journalRepository");
    const dev = w.use("@/store/devStore").useDevStore;
    await seedCache(w, [modelOf(w, 1), modelOf(w, 2)]);
    assert.deepEqual((await repo.listEntries()).map((e) => e.id), [1, 2].map((n) => serverRow(n).id));
    assert.equal((await repo.readCachedEntry(serverRow(1).id)).id, serverRow(1).id);
    assert.equal((await repo.readCachedAffirmations(serverRow(1).id)).length, 3);
    dev.getState().setDataSource("mock");
    assert.deepEqual(await repo.readCachedEntries(), []);
    assert.equal(await repo.readCachedEntry(serverRow(1).id), null);
    assert.deepEqual(await repo.readCachedAffirmations(serverRow(1).id), []);
    assert.deepEqual(await repo.readCachedLatestAffirmations(), []);
    const pending = repo.listEntries();
    await advance(400);
    const mock = await pending;
    assert.ok(mock.length >= 20, "the step 06 entries");
    assert.equal(w.server.state.requests.length, 0, "the mock never reaches the server");
  });

  // 2026-11-10: Reflection opens by the client entry id after New Entry's handoff. The mock's getEntry finds the clone the mock
  // processor made under its own id by that client id, as the real source finds the finished reflection in the cache.
  await test("repository: the mock's getEntry answers a finished mock reflection by its client entry id too, and an outbox item by its id", async (w) => {
    const repo = w.use("@/data/journalRepository");
    const dev = w.use("@/store/devStore").useDevStore;
    const { addMockEntry } = w.use("@/data/mock/db");
    dev.getState().setDataSource("mock");
    const madeId = addMockEntry("ready", { clientEntryId: "c-mock-1", inputType: "text", text: "a made-up prayer about rest" });
    const byServerId = repo.getEntry(madeId);
    await advance(400);
    assert.equal((await byServerId).id, madeId, "by its own id");
    const byClientId = repo.getEntry("c-mock-1");
    await advance(400);
    const found = await byClientId;
    assert.equal(found.id, madeId, "by the client entry id, the same reflection");
    assert.equal(found.clientEntryId, "c-mock-1");
    assert.equal(found.isLocalOnly, false, "the clone is a finished reflection, not an item on the phone");
    await w.use("@/db/outbox").enqueue(text("c-mock-2"));
    const waiting = repo.getEntry("c-mock-2");
    await advance(400);
    assert.equal((await waiting).pending?.status, "queued", "an item still on the phone is the pending entry");
    const missing = repo.getEntry("c-mock-none");
    await advance(400);
    assert.equal(await missing, null, "nothing for an id nobody has");
    assert.equal(w.server.state.requests.length, 0, "the mock never reaches the server");
  });

  await test("repository: a page of the real source, and of the mock; the page size comes from the dev store", async (w) => {
    const repo = w.use("@/data/journalRepository");
    const dev = w.use("@/store/devStore").useDevStore;
    seedServer(w, 12);
    dev.getState().setPageSize(5);
    const page = await repo.loadEntriesPage(null);
    assert.equal(page.ok, true);
    assert.equal(page.data.entries.length, 5);
    assert.equal(page.data.total, 12);
    assert.equal(query(journalReads(w)[0]).get("limit"), "6");
    dev.getState().setDataSource("mock");
    const mockPage = repo.loadEntriesPage(null);
    await advance(400);
    const mock = await mockPage;
    assert.equal(mock.ok, true);
    assert.equal(mock.data.nextCursor, null);
    assert.equal(mock.data.total, null);
    assert.ok(mock.data.entries.length >= 20);
  });

  await test("repository: getEntry answers a reflection still in the outbox as an unfinished entry, without asking the server; any other id goes to the server", async (w) => {
    const repo = w.use("@/data/journalRepository");
    seedServer(w, 2);
    await enqueue(w, text("c-pending"));
    const waiting = await repo.getEntry("c-pending");
    assert.equal(waiting.isLocalOnly, true);
    assert.equal(waiting.status, "pending");
    assert.equal(waiting.transcript, null, "a pending card never shows the words");
    assert.equal(journalReads(w).length, 0);
    const found = await repo.getEntry(serverRow(1).id);
    assert.equal(found.id, serverRow(1).id);
    assert.equal(await repo.getEntry("nobody"), null);
  });

  await test("repository: the latest affirmations come from the newest finished entry that is not a crisis, never throw, and fall back on the cache", async (w) => {
    const repo = w.use("@/data/journalRepository");
    seedServer(w, 3, (n) => (n === 1 ? { is_crisis: true, dominant_emotion: null, scripture_reference: null, devotional_script: null, devotional_title: null, closing_prayer: null } : {}));
    assert.deepEqual(await repo.getLatestAffirmations(), [], "nothing is cached yet, so there is no entry to ask about");
    await repo.loadEntriesPage(null);
    const list = await repo.getLatestAffirmations();
    assert.equal(list.length, 3);
    assert.equal(list[0].entryId, serverRow(2).id);
    w.server.state.offline = true;
    assert.deepEqual(await repo.getLatestAffirmations(), list, "offline: the cached copy");
    await w.use("@/db/cache").clearAll();
    assert.deepEqual(await repo.getLatestAffirmations(), [], "offline with an empty cache: none, no error");
    // The newest entry is on the phone but its affirmations are not, and nothing answers: none, and no error (Journal Home then
    // shows no affirmation card).
    w.server.state.offline = false;
    await repo.loadEntriesPage(null);
    w.server.state.offline = true;
    assert.deepEqual(await repo.getLatestAffirmations(), [], "the entry is cached, its affirmations are not, and there is no answer: none, no error");
  });

  await test("repository: a favorite is saved on the server in the real mode and in the mock rows in the mock mode, where the dev flag fails it once", async (w) => {
    const repo = w.use("@/data/journalRepository");
    const dev = w.use("@/store/devStore").useDevStore;
    seedServer(w, 1);
    const id = affirmationRows(serverRow(1).id)[0].id;
    assert.equal((await repo.setAffirmationFavorite(id, true)).data.isFavorite, true);
    assert.equal(w.server.state.affirmations.find((a) => a.id === id).is_favorite, true);
    dev.getState().setDataSource("mock");
    const mockRow = w.use("@/data/mock/db").getMockDb().affirmations[0];
    let run = repo.setAffirmationFavorite(mockRow.id, true);
    await advance(400);
    assert.equal((await run).ok, true);
    assert.equal(mockRow.is_favorite, true);
    dev.getState().setNextPrayerMutationFails(true);
    run = repo.setAffirmationFavorite(mockRow.id, false);
    await advance(400);
    const failed = await run;
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "NETWORK");
    assert.equal(mockRow.is_favorite, true);
    assert.equal(dev.getState().nextPrayerMutationFails, false, "the flag is spent");
    run = repo.setAffirmationFavorite("missing", true);
    await advance(400);
    assert.equal((await run).code, "NOT_FOUND");
  });
}

// ================================================================== the processor
async function processorChecks() {
  async function itemOf(w, input) {
    return enqueue(w, input);
  }

  await test("processor: a written reflection is sent exactly as written, with the user id only in the token, and answers the entry and its affirmations", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const item = await itemOf(w, text("c1"));
    const stages = [];
    const outcome = await processor.processItem(item, (stage) => stages.push(stage));
    assert.equal(outcome.ok, true);
    assert.equal(outcome.entry.clientEntryId, "c1");
    assert.equal(outcome.affirmations.length, 3);
    assert.deepEqual(stages, ["receiving"]);
    const [call] = functionCalls(w, "process-entry");
    assert.deepEqual(call.body, { clientEntryId: "c1", inputType: "text", text: WORDS });
    assert.ok(!JSON.stringify(call.body).includes("user_a"));
    assert.equal(w.upload.calls.length, 0, "a written entry uploads nothing");
  });

  // Since 2026-11-09 the stages are the Journal card's (New Entry leaves after 4 s): reflecting at 3 s, preparing at 9 s.
  await test("processor: the card's stages follow the usual time (3 s, 9 s) and stop when the answer comes", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const item = await itemOf(w, text("c1"));
    let release;
    w.server.state.functions["process-entry"].push(
      () =>
        new Promise((resolve) => {
          release = () => resolve(json(200, readyResult(text("c1")).response));
        }),
    );
    const stages = [];
    const run = processor.processItem(item, (stage) => stages.push(stage));
    await advance(2900);
    assert.deepEqual(stages, ["receiving"]);
    await advance(200);
    assert.deepEqual(stages, ["receiving", "reflecting"]);
    await advance(5800);
    assert.deepEqual(stages, ["receiving", "reflecting"]);
    await advance(300);
    assert.deepEqual(stages, ["receiving", "reflecting", "preparing"]);
    release();
    assert.equal((await run).ok, true);
    await advance(60_000);
    assert.deepEqual(stages, ["receiving", "reflecting", "preparing"], "no step after the answer");
    assert.equal([...W.clock.timers.values()].filter((t) => t.ms === 3000 || t.ms === 9000).length, 0, "the step timers are cleared");

    // An answer that comes early (a retry of a reflection the server already has): the later steps never show.
    const early = await itemOf(w, text("c2"));
    const earlyStages = [];
    w.server.state.functions["process-entry"].push(() => json(200, readyResult(text("c2"), "user_a", 901).response));
    assert.equal((await processor.processItem(early, (stage) => earlyStages.push(stage))).ok, true);
    await advance(30_000);
    assert.deepEqual(earlyStages, ["receiving"], "no step after an early answer");
  });

  await test("processor: a recording is uploaded once to its own path, then process-entry names that path, its length and its type", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const outbox = w.use("@/db/outbox");
    const item = await itemOf(w, audio("a1"));
    const outcome = await processor.processItem(item, () => undefined);
    assert.equal(outcome.ok, true);
    assert.deepEqual(w.upload.calls, [{ id: "a1", uri: "file:///recordings/a1.m4a", userId: "user_a" }]);
    const [call] = functionCalls(w, "process-entry");
    assert.deepEqual(call.body, { clientEntryId: "a1", inputType: "audio", audioPath: "user_a/raw/a1.m4a", durationMs: 20000, mimeType: "audio/mp4" });
    assert.equal((await outbox.get("a1")).uploaded, true, "remembered");
  });

  await test("processor: receiving is reported once a recording is uploaded, so New Entry's Sent and the card's stages follow the request and not the upload; a failed upload reports no stage", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const outbox = w.use("@/db/outbox");
    const item = await itemOf(w, audio("a1"));
    const uploadsAtStage = [];
    const outcome = await processor.processItem(item, (stage) => uploadsAtStage.push([stage, w.upload.calls.length]));
    assert.equal(outcome.ok, true);
    assert.deepEqual(uploadsAtStage[0], ["receiving", 1], "the upload was done when receiving was reported");
    assert.deepEqual(uploadsAtStage.map(([stage]) => stage), ["receiving"], "no stage before the request");
    await itemOf(w, audio("a2"));
    w.upload.script.push({ ok: false, code: "NETWORK" });
    const stages = [];
    const failed = await processor.processItem(await outbox.get("a2"), (stage) => stages.push(stage));
    assert.equal(failed.ok, false);
    assert.deepEqual(stages, [], "a recording that could not be uploaded was never handed to the server");
  });

  await test("processor: the times of the entry the function answers with are in the form the app keeps, the prayer's too", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const item = await itemOf(w, text("c1"));
    const answered = fixtures[4].expected;
    assert.notEqual(answered.entry.prayer, null);
    assert.notEqual(answered.entry.prayer.answeredAt, null);
    // The same millisecond with microseconds and an offset after it, as PostgREST writes it.
    const micro = (iso) => iso.replace(/\.(\d{3})Z$/, ".$1456+00:00");
    const raw = {
      ...answered,
      entry: {
        ...answered.entry,
        createdAt: micro(answered.entry.createdAt),
        updatedAt: micro(answered.entry.updatedAt),
        prayer: { ...answered.entry.prayer, createdAt: micro(answered.entry.prayer.createdAt), answeredAt: micro(answered.entry.prayer.answeredAt) },
      },
    };
    w.server.state.functions["process-entry"].push(() => json(200, raw));
    const outcome = await processor.processItem(item, () => undefined);
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.entry, answered.entry, "the same entry, with the same instants, in the canonical form");
    assert.deepEqual(outcome.affirmations, answered.affirmations);
    const crisis = fixtures[2].expected;
    w.server.state.functions["process-entry"].push(() => json(200, crisis));
    assert.deepEqual((await processor.processItem(item, () => undefined)).entry, crisis.entry, "an entry with no prayer passes through");
  });

  await test("processor: an upload that failed stops there, and each failure maps to the code the engine understands", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const expected = { NETWORK: "NETWORK", UNAUTHORIZED: "UNAUTHORIZED", NOT_FOUND: "AUDIO_NOT_FOUND", TOO_LARGE: "PAYLOAD_TOO_LARGE", UNKNOWN: "UNKNOWN" };
    let n = 0;
    for (const [code, mapped] of Object.entries(expected)) {
      n += 1;
      const item = await itemOf(w, audio(`a${n}`));
      w.upload.script.push({ ok: false, code });
      const outcome = await processor.processItem(item, () => undefined);
      assert.deepEqual({ ok: outcome.ok, code: outcome.code }, { ok: false, code: mapped });
    }
    assert.equal(functionCalls(w, "process-entry").length, 0, "no request for a recording that is not there");
    assert.equal((await w.use("@/db/outbox").get("a1")).uploaded, false);
  });

  await test("processor: after a failed request the recording is not uploaded again", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const outbox = w.use("@/db/outbox");
    await itemOf(w, audio("a1"));
    w.server.state.functions["process-entry"].push(() => fnError(503, "AI_UNAVAILABLE"));
    let outcome = await processor.processItem(await outbox.get("a1"), () => undefined);
    assert.deepEqual({ ok: outcome.ok, code: outcome.code }, { ok: false, code: "AI_UNAVAILABLE" });
    assert.equal(w.upload.calls.length, 1);
    outcome = await processor.processItem(await outbox.get("a1"), () => undefined);
    assert.equal(outcome.ok, true);
    assert.equal(w.upload.calls.length, 1, "uploaded once");
    const calls = functionCalls(w, "process-entry");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body, calls[1].body, "the same request, so the server finds the same entry");
  });

  await test("processor: every failure keeps its code; the free limit also carries the saved entry and the reset time; anything unknown is UNKNOWN", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const item = await itemOf(w, text("c1"));
    const codes = [
      "INVALID_REQUEST", "UNAUTHORIZED", "METHOD_NOT_ALLOWED", "ALREADY_PROCESSING", "PAYLOAD_TOO_LARGE", "TOO_SHORT", "AUDIO_NOT_FOUND",
      "NO_SPEECH", "RATE_LIMITED", "INTERNAL", "AI_UNAVAILABLE",
    ];
    for (const code of codes) {
      w.server.state.functions["process-entry"].push(() => fnError(code === "UNAUTHORIZED" ? 401 : 500, code));
      const outcome = await processor.processItem(item, () => undefined);
      assert.deepEqual({ ok: outcome.ok, code: outcome.code }, { ok: false, code });
    }
    w.server.state.functions["process-entry"].push(() => fnError(500, "SOMETHING_NEW"));
    assert.equal((await processor.processItem(item, () => undefined)).code, "UNKNOWN");
    w.server.state.functions["process-entry"].push(() => json(402, limitBody("entry-x", "2026-10-26T00:00:00.000Z")));
    assert.deepEqual(await processor.processItem(item, () => undefined), { ok: false, code: "LIMIT_REACHED", entryId: "entry-x", resetsAt: "2026-10-26T00:00:00.000Z" });
    w.server.state.functions["process-entry"].push(() => fnError(402, "LIMIT_REACHED"));
    assert.deepEqual(await processor.processItem(item, () => undefined), { ok: false, code: "LIMIT_REACHED" });
    w.server.state.offline = true;
    assert.equal((await processor.processItem(item, () => undefined)).code, "NETWORK");
    w.server.state.offline = false;
    w.server.state.functions["process-entry"].push(() => new Response("<html>", { status: 502 }));
    assert.equal((await processor.processItem(item, () => undefined)).code, "INTERNAL");
    w.server.state.functions["process-entry"].push(() => json(200, { nope: true }));
    assert.equal((await processor.processItem(item, () => undefined)).code, "UNKNOWN");
  });

  await test("processor: signed out answers UNAUTHORIZED without a request; items that cannot be sent are INVALID_REQUEST", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const item = await itemOf(w, text("c1"));
    const voice = await itemOf(w, audio("a1"));
    for (const broken of [{ ...item, text: null }, { ...voice, durationMs: null }, { ...voice, mimeType: null }]) {
      assert.deepEqual(await processor.processItem(broken, () => undefined), { ok: false, code: "INVALID_REQUEST" });
    }
    w.use("@/services/supabaseClient").setSupabaseSession(null);
    assert.deepEqual(await processor.processItem(item, () => undefined), { ok: false, code: "UNAUTHORIZED" });
    assert.deepEqual(await processor.processItem(voice, () => undefined), { ok: false, code: "UNAUTHORIZED" });
    assert.equal(w.server.state.requests.length, 0);
    assert.equal(w.upload.calls.length, 0, "a recording is not uploaded for nobody");
  });

  await test("processor: with the mock data source the mock answers, nothing goes to the server, and the engine is told it is a mock", async (w) => {
    const processor = w.use("@/services/entryProcessor");
    const dev = w.use("@/store/devStore").useDevStore;
    assert.equal(processor.isProcessorMock(), false);
    dev.getState().setDataSource("mock");
    assert.equal(processor.isProcessorMock(), true);
    const item = await itemOf(w, text("c1"));
    const stages = [];
    const run = processor.processItem(item, (stage) => stages.push(stage));
    await advance(4500);
    const outcome = await run;
    assert.equal(outcome.ok, true);
    assert.deepEqual(stages, ["receiving", "reflecting", "preparing"]);
    assert.equal(w.server.state.requests.length, 0);
  });
}

// ================================================================== the engine, end to end
async function engineChecks() {
  await test("engine: a written reflection is sent, saved in the read cache with its affirmations, removed from the outbox, and announced", async (w) => {
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const outbox = w.use("@/db/outbox");
    const cache = w.use("@/db/cache");
    const events = [];
    engine.subscribe((event) => events.push(event.type));
    await outbox.enqueue(text("c1"));
    const result = await engine.syncAndWait("c1", { waitMs: 60_000 });
    assert.equal(result.kind, "ready");
    assert.equal(result.isCrisis, false);
    assert.equal(await outbox.get("c1"), null);
    const entry = await cache.getEntry(result.entryId);
    assert.equal(entry.clientEntryId, "c1");
    assert.equal((await cache.listAffirmationsForEntry(result.entryId)).length, 3);
    assert.ok(events.includes("finished"));
    assert.equal(functionCalls(w, "process-entry").length, 1);
    assert.equal((await w.use("@/data/journalRepository").getEntry(result.entryId)).id, result.entryId, "Reflection opens it at once");
  });

  await test("engine: a heavy moment is cached whole, with its three affirmations and no prayer, and logged like any other", async (w) => {
    w.server.state.makeEntry = crisisResult;
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    await w.use("@/db/outbox").enqueue(text("c1", "words that carry something very heavy"));
    const result = await engine.syncAndWait("c1", { waitMs: 60_000 });
    assert.deepEqual({ kind: result.kind, isCrisis: result.isCrisis }, { kind: "ready", isCrisis: true });
    const cache = w.use("@/db/cache");
    const entry = await cache.getEntry(result.entryId);
    assert.equal(entry.isCrisis, true);
    assert.notEqual(entry.devotional, null, "a heavy moment is a whole reflection (2026-11-08)");
    assert.equal(entry.prayer, null, "never made a prayer by the server");
    assert.equal((await cache.listAffirmationsForEntry(result.entryId)).length, 3);
    assert.ok(w.logs.every((line) => !/crisis|heavy/i.test(line)), "the app logs nothing about a heavy moment");
  });

  await test("engine: the free limit holds the reflection, keeps the saved entry's id and the reset time, and caches nothing", async (w) => {
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const outbox = w.use("@/db/outbox");
    w.server.state.functions["process-entry"].push(() => json(402, limitBody("entry-x", "2026-10-26T00:00:00.000Z")));
    await outbox.enqueue(text("c1"));
    const result = await engine.syncAndWait("c1", { waitMs: 60_000 });
    assert.deepEqual(result, { kind: "limit", entryId: "entry-x" });
    const item = await outbox.get("c1");
    assert.equal(item.status, "limit_reached");
    assert.equal(item.serverEntryId, "entry-x");
    assert.equal(item.limitResetsAt, Date.parse("2026-10-26T00:00:00.000Z"));
    assert.deepEqual(await w.use("@/db/cache").listEntries(), []);
    assert.equal(functionCalls(w, "process-entry").length, 1);
    await advance(3 * 3_600_000);
    assert.equal(functionCalls(w, "process-entry").length, 1, "not tried again before the week resets");
  });

  await test("engine: a plan that turns paid sends what the limit held", async (w) => {
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const outbox = w.use("@/db/outbox");
    w.server.state.functions["process-entry"].push(() => json(402, limitBody("entry-x", "2026-10-30T00:00:00.000Z")));
    await outbox.enqueue(text("c1"));
    await engine.syncAndWait("c1", { waitMs: 60_000 });
    assert.equal((await outbox.get("c1")).status, "limit_reached");
    w.use("@/store/profilePrefsStore").useProfilePrefsStore.getState().saveSnapshot("user_a", {
      createdAt: "2026-10-01T12:00:00.000Z",
      subscriptionTier: "pro",
      syncedAt: ISO(clock.now),
      affirmationsEnabled: true,
      ambientSound: "off",
      ambientVolume: 0.5,
    });
    await engine.resumeAfterUpgrade();
    await settle(30);
    assert.equal(await outbox.get("c1"), null);
    assert.equal(functionCalls(w, "process-entry").length, 2);
    assert.deepEqual(functionCalls(w, "process-entry")[1].body, functionCalls(w, "process-entry")[0].body, "the same client entry id");
  });

  await test("engine: a plan that the profile sync turns paid sends what the limit held; staying free, going back to free, another user's plan and a stopped watcher send nothing", async (w) => {
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const outbox = w.use("@/db/outbox");
    const prefs = w.use("@/store/profilePrefsStore").useProfilePrefsStore;
    const { watchPlan } = w.use("@/services/upgradeWatcher");
    const snapshot = (tier) => ({
      createdAt: "2026-10-01T12:00:00.000Z",
      subscriptionTier: tier,
      syncedAt: ISO(clock.now),
      affirmationsEnabled: true,
      ambientSound: "off",
      ambientVolume: 0.5,
    });
    const hold = async (id) => {
      w.server.state.functions["process-entry"].push(() => json(402, limitBody(`entry-${id}`, "2026-10-30T00:00:00.000Z")));
      await outbox.enqueue(text(id));
      await engine.syncAndWait(id, { waitMs: 60_000 });
      assert.equal((await outbox.get(id)).status, "limit_reached", id);
    };
    const stop = watchPlan("user_a");
    await hold("c1");
    prefs.getState().saveSnapshot("user_a", snapshot("free"));
    prefs.getState().saveSnapshot("user_b", snapshot("pro"));
    await settle(30);
    assert.equal((await outbox.get("c1")).status, "limit_reached", "free again, and someone else's plan: nothing");
    assert.equal(functionCalls(w, "process-entry").length, 1);
    prefs.getState().saveSnapshot("user_a", snapshot("trial"));
    await settle(40);
    assert.equal(await outbox.get("c1"), null, "free to trial: sent");
    assert.equal(functionCalls(w, "process-entry").length, 2);
    prefs.getState().saveSnapshot("user_a", snapshot("pro"));
    await settle(20);
    assert.equal(functionCalls(w, "process-entry").length, 2, "trial to pro: already paid, nothing to resume");
    prefs.getState().saveSnapshot("user_a", snapshot("free"));
    await hold("c2");
    prefs.getState().saveSnapshot("user_a", snapshot("pro"));
    await settle(40);
    assert.equal(await outbox.get("c2"), null, "free to pro: sent");
    stop();
    prefs.getState().saveSnapshot("user_a", snapshot("free"));
    await hold("c3");
    prefs.getState().saveSnapshot("user_a", snapshot("pro"));
    await settle(30);
    assert.equal((await outbox.get("c3")).status, "limit_reached", "a stopped watcher does nothing");
  });

  await test("engine: no answer queues the reflection with a delay, and the same client entry id is sent again until one entry exists", async (w) => {
    // No jitter: with Math.random at one half the delays are exactly the table's (5 s, then 30 s for ALREADY_PROCESSING).
    const realRandom = Math.random;
    Math.random = () => 0.5;
    try {
      await w.startEngine();
      const engine = w.use("@/services/syncEngine");
      const outbox = w.use("@/db/outbox");
      const start = clock.now;
      w.server.state.offline = true;
      await outbox.enqueue(text("c1"));
      const first = await engine.syncAndWait("c1", { waitMs: 60_000 });
      assert.deepEqual(first, { kind: "later" });
      const queued = await outbox.get("c1");
      assert.equal(queued.status, "queued");
      assert.equal(queued.attempts, 1);
      assert.equal(queued.lastErrorCode, "NETWORK");
      assert.equal(queued.nextAttemptAt, start + 5_000, "the first wait is 5 s");
      w.server.state.offline = false;
      w.server.state.functions["process-entry"].push(() => fnError(409, "ALREADY_PROCESSING"));
      await advance(7_000);
      const second = await outbox.get("c1");
      assert.equal(second.attempts, 2);
      assert.equal(second.lastErrorCode, "ALREADY_PROCESSING");
      assert.equal(second.nextAttemptAt, start + 5_000 + 30_000, "a claim that is still running is waited for at least 30 s");
      await advance(40_000);
      assert.equal(await outbox.get("c1"), null);
      assert.equal(w.server.state.entries.length, 1, "one entry, however many times it was sent");
      assert.deepEqual(w.server.state.functionCalls.map((c) => c.body.clientEntryId), ["c1", "c1"], "the second and the third try reached the server; the first had no answer");
    } finally {
      Math.random = realRandom;
    }
  });

  await test("engine: a recording is uploaded once across retries and its file is deleted when the entry is saved", async (w) => {
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const outbox = w.use("@/db/outbox");
    w.recordings.files.set("a1", 0);
    w.server.state.functions["process-entry"].push(() => fnError(503, "AI_UNAVAILABLE"));
    await outbox.enqueue(audio("a1"));
    const first = await engine.syncAndWait("a1", { waitMs: 60_000 });
    assert.equal(first.kind, "later");
    assert.equal(w.upload.calls.length, 1);
    await advance(8_000);
    assert.equal(await outbox.get("a1"), null);
    assert.equal(w.upload.calls.length, 1);
    assert.ok(w.recordings.log.includes("delete a1"));
    assert.deepEqual(functionCalls(w, "process-entry").map((c) => c.body.audioPath), ["user_a/raw/a1.m4a", "user_a/raw/a1.m4a"]);
  });

  await test("engine: a refused session pauses every item until the next sign-in, and nothing is cached", async (w) => {
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const outbox = w.use("@/db/outbox");
    w.server.state.functions["process-entry"].push(() => fnError(401, "UNAUTHORIZED"));
    await outbox.enqueue(text("c1"));
    await outbox.enqueue(text("c2"));
    await engine.syncAndWait("c1", { waitMs: 60_000 });
    assert.equal((await outbox.get("c1")).status, "paused_auth");
    assert.equal((await outbox.get("c2")).status, "paused_auth");
    assert.deepEqual(await w.use("@/db/cache").listEntries(), []);
  });

  await test("engine: something only the person can fix is not retried", async (w) => {
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const outbox = w.use("@/db/outbox");
    w.server.state.functions["process-entry"].push(() => fnError(422, "NO_SPEECH"));
    await outbox.enqueue(audio("a1"));
    const result = await engine.syncAndWait("a1", { waitMs: 60_000 });
    assert.deepEqual(result, { kind: "needs_action", code: "NO_SPEECH" });
    await advance(2 * 3_600_000);
    assert.equal(functionCalls(w, "process-entry").length, 1);
    assert.equal((await outbox.get("a1")).status, "needs_action");
  });

  await test("engine: with the mock data source nothing reaches the cache or the server", async (w) => {
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    await w.use("@/db/outbox").enqueue(text("c1"));
    const pending = engine.syncAndWait("c1", { waitMs: 60_000 });
    await advance(5_000);
    assert.equal((await pending).kind, "ready");
    assert.deepEqual(await w.use("@/db/cache").listEntries(), []);
    assert.equal(w.server.state.requests.length, 0);
  });

  await test("engine: a database from step 24 (version 1) is upgraded to the latest version with its rows and its key kept", async (w) => {
    const database = w.use("@/db/database");
    const outbox = w.use("@/db/outbox");
    await outbox.enqueue(text("c1"));
    await outbox.enqueue(audio("a1"));
    const db = database.getDb();
    // What version 1 did not have yet: version 2's column, version 3's table and column (step 29) and version 4's table (the
    // Word Deck's calendar, 2026-11-17).
    await db.execAsync("ALTER TABLE outbox DROP COLUMN uploaded");
    await db.execAsync("DROP TABLE mutations");
    await db.execAsync("ALTER TABLE entries_cache DROP COLUMN is_prayer");
    await db.execAsync("DROP TABLE word_calendar");
    await db.execAsync("PRAGMA user_version = 1");
    await database.closeUserDatabase();
    await database.openUserDatabase("user_a");
    assert.equal((await database.getDb().getFirstAsync("PRAGMA user_version")).user_version, 4);
    const names = (await database.getDb().getAllAsync("SELECT name FROM sqlite_master WHERE type = 'table'")).map((row) => row.name);
    assert.ok(names.includes("word_calendar"), "version 4's table is made");
    assert.equal((await outbox.get("c1")).text, WORDS, "the words are still readable with the same key");
    assert.equal((await outbox.get("c1")).uploaded, false);
    assert.equal((await outbox.get("a1")).uploaded, false);
    await outbox.markUploaded("a1");
    assert.equal((await outbox.get("a1")).uploaded, true);
    assert.equal(w.sqlite.stats.deletes.length, 0, "no file was thrown away");
  });
}

// ================================================================== Journal Home
async function journalChecks() {
  async function render(w) {
    const { useJournalHome } = w.use("@/hooks/useJournalHome");
    return w.renderHook(useJournalHome);
  }

  await test("journal: the phone's own copy shows first, then the server's first page replaces it", async (w) => {
    seedServer(w, 5);
    await seedCache(w, [modelOf(w, 3), modelOf(w, 4)]);
    let release;
    w.server.state.gate = new Promise((resolve) => (release = resolve));
    const handle = await render(w);
    assert.equal(handle.result.current.status, "loading");
    const cached = await until(handle, (s) => s.status === "ready", "the cached entries");
    assert.deepEqual(cached.entries.map((e) => e.id), [3, 4].map((n) => serverRow(n).id));
    assert.equal(cached.affirmations.length, 3);
    release();
    const live = await until(handle, (s) => s.status === "ready" && s.entries.length === 5, "the server's page");
    assert.deepEqual(live.entries.map((e) => e.id), [1, 2, 3, 4, 5].map((n) => serverRow(n).id));
    assert.equal(live.entryCount, 5);
    handle.unmount();
  });

  // Step 28, found on the iPhone: after a sign-in the cache is empty, and a plan made before the newest reflection's
  // affirmations are on the phone finds no headlines and schedules nothing (or cancels what was scheduled).
  await test("journal: the notifications are planned again only once the newest reflection's affirmations are on this phone", async (w) => {
    seedServer(w, 3);
    const name = w.sqlite.files().find((file) => file.endsWith(".db"));
    const raw = w.sqlite.raw(name);
    const newest = serverRow(1).id;
    const seen = [];
    w.use("@/services/affirmationScheduler").requestAffirmationReschedule = () => {
      seen.push(raw.prepare("SELECT COUNT(*) AS n FROM affirmations_cache WHERE entry_id = ?").get(newest).n);
    };
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3 && s.affirmations.length === 3, "the server's page");
    raw.close();
    assert.ok(seen.length > 0, "Journal asks for the notifications to be planned again after its first page");
    assert.deepEqual(seen, seen.map(() => 3), "each time, the newest reflection's three affirmations are already on this phone");
    handle.unmount();
  });

  // The Word Deck (2026-11-17): Today's card shows the word of the reminder that last fired, read from the scheduler's calendar.
  const calendarRow = (w, n, slot, ago) => {
    const entryId = serverRow(n).id;
    return {
      day: 20261025,
      slot,
      fireAt: BASE - ago,
      entryId,
      affirmationId: `aff-${entryId.slice(-12)}-${slot}`,
    };
  };

  await test("journal: the word is none without a calendar; the word of the reminder that last fired shows once the scheduler writes one, and the same read changes nothing", async (w) => {
    seedServer(w, 3);
    const repo = w.use("@/data/journalRepository");
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3 && s.affirmations.length === 3, "the server's page");
    assert.equal(handle.result.current.word, null, "no calendar, no word: the card keeps the newest reflection's word");
    assert.equal(w.calendarListeners(), 1, "the screen follows the scheduler's calendar while it is in front");
    await repo.saveWordCalendar([calendarRow(w, 2, "evening", 3_600_000)], BASE);
    w.calendarChanged();
    const state = await until(handle, (s) => s.status === "ready" && s.word !== null, "the calendar's word");
    assert.equal(state.word.entry.id, serverRow(2).id, "it is the word of the reflection the calendar names, not the newest one");
    assert.equal(state.word.affirmation.id, calendarRow(w, 2, "evening", 0).affirmationId);
    assert.equal(state.word.slot, "evening");
    const first = state.word;
    w.calendarChanged();
    await settle(30);
    assert.equal(handle.result.current.word, first, "a read that finds the same word does not redraw the screen");
    handle.unmount();
    assert.equal(w.calendarListeners(), 0, "leaving the screen stops following the calendar");
  });

  await test("journal: the word's heart follows the affirmation's, and a deleted reflection takes its word away", async (w) => {
    seedServer(w, 3);
    const repo = w.use("@/data/journalRepository");
    await repo.hydrateWordPool(new Date(BASE));
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3 && s.affirmations.length === 3, "the server's page");
    await repo.saveWordCalendar([calendarRow(w, 2, "afternoon", 7_200_000)], BASE);
    w.calendarChanged();
    let state = await until(handle, (s) => s.status === "ready" && s.word !== null, "the calendar's word");
    state.toggleFavorite(state.word.affirmation);
    state = await until(handle, (s) => s.status === "ready" && s.word !== null && s.word.affirmation.isFavorite, "the word's heart");
    await settle(20);
    assert.equal(w.server.state.affirmations.find((a) => a.id === state.word.affirmation.id).is_favorite, true, "the save is the affirmation's own");
    w.use("@/services/syncEngine").announceEntryDeleted(serverRow(2).id);
    state = await until(handle, (s) => s.status === "ready" && s.word === null, "the word of the deleted reflection gone");
    assert.ok(!state.entries.some((entry) => entry.id === serverRow(2).id));
    handle.unmount();
  });

  await test("journal: a calendar row older than a day and a word the phone no longer holds are not shown", async (w) => {
    seedServer(w, 3);
    const repo = w.use("@/data/journalRepository");
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3 && s.affirmations.length === 3, "the server's page");
    await repo.saveWordCalendar([calendarRow(w, 2, "morning", 30 * 3_600_000)], BASE);
    w.calendarChanged();
    await settle(30);
    assert.equal(handle.result.current.word, null, "a reminder from over a day ago is not today's word");
    await repo.saveWordCalendar([{ ...calendarRow(w, 2, "evening", 3_600_000), affirmationId: "no-such-word" }], BASE);
    w.calendarChanged();
    await settle(30);
    assert.equal(handle.result.current.word, null, "a word that is not in the cache falls back to the newest reflection's");
    handle.unmount();
  });

  // Walk-through F1 (2026-11-18, the owner's iPhone): when a reminder had fired, or a reflection had been deleted, while Today was
  // covered, the card kept the previous word until the screen's own load came back, 1 to 3 seconds after Today was shown. The hook
  // followed the sync engine's deletions and the scheduler's calendar only while the screen was in front, and read the word again
  // only together with the first page from the server.
  await test("journal: a reflection deleted while the screen is covered leaves its list, count and word at once, and showing the screen again loads as before", async (w) => {
    seedServer(w, 3);
    const repo = w.use("@/data/journalRepository");
    await repo.hydrateWordPool(new Date(BASE));
    // The sync engine's listeners the screen holds, counted by wrapping subscribe (the screen calls it through the module).
    const engine = w.use("@/services/syncEngine");
    const subscribeToEngine = engine.subscribe;
    let listening = 0;
    engine.subscribe = (listener) => {
      listening += 1;
      const stop = subscribeToEngine(listener);
      return () => {
        listening -= 1;
        stop();
      };
    };
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3 && s.affirmations.length === 3, "the server's page");
    await repo.saveWordCalendar([calendarRow(w, 2, "afternoon", 7_200_000)], BASE);
    w.calendarChanged();
    await until(handle, (s) => s.status === "ready" && s.word !== null, "the calendar's word");
    w.setFocused(false);
    await settle(20);
    assert.equal(listening, 1, "covered, the screen follows only the deletions, which the sync engine announces");
    // The two steps of a deletion that matter here: the server deletes first, then the phone forgets the entry and tells the lists.
    assert.equal((await repo.deleteEntry(serverRow(2).id)).ok, true, "the server deleted the reflection");
    w.use("@/services/syncEngine").announceEntryDeleted(serverRow(2).id);
    const covered = await until(handle, (s) => s.status === "ready" && s.word === null, "the word of the deleted reflection gone while the screen is covered");
    assert.deepEqual(covered.entries.map((entry) => entry.id), [1, 3].map((n) => serverRow(n).id), "its card left the list");
    assert.equal(covered.entryCount, 2, "and the count is one lower");
    const reads = journalReads(w).length;
    w.setFocused(true);
    for (let i = 0; i < 100 && journalReads(w).length === reads; i += 1) await settle(2);
    assert.ok(journalReads(w).length > reads, "showing the screen again loads it again");
    await settle(40);
    assert.deepEqual(handle.result.current.entries.map((entry) => entry.id), [1, 3].map((n) => serverRow(n).id), "the deleted reflection does not come back");
    assert.equal(handle.result.current.word, null);
    handle.unmount();
    assert.equal(listening, 0, "gone, the screen follows nothing");
  });

  await test("journal: the scheduler's calendar is followed while the screen is covered, for as long as the screen exists", async (w) => {
    seedServer(w, 3);
    const repo = w.use("@/data/journalRepository");
    await repo.hydrateWordPool(new Date(BASE));
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3 && s.affirmations.length === 3, "the server's page");
    await repo.saveWordCalendar([calendarRow(w, 2, "afternoon", 7_200_000)], BASE);
    w.calendarChanged();
    await until(handle, (s) => s.status === "ready" && s.word !== null && s.word.entry.id === serverRow(2).id, "the first word");
    w.setFocused(false);
    await settle(20);
    assert.equal(w.calendarListeners(), 1, "the screen goes on following the calendar while it is covered");
    await repo.saveWordCalendar([calendarRow(w, 3, "evening", 3_600_000)], BASE);
    w.calendarChanged();
    const covered = await until(handle, (s) => s.status === "ready" && s.word !== null && s.word.entry.id === serverRow(3).id, "the new deal's word, read while the screen is covered");
    assert.equal(covered.word.slot, "evening");
    handle.unmount();
    assert.equal(w.calendarListeners(), 0, "the screen stops following the calendar when it is gone");
  });

  await test("journal: a word that changed with the clock while the screen was covered shows the moment the screen is shown again, before the first page comes", async (w) => {
    seedServer(w, 3);
    const repo = w.use("@/data/journalRepository");
    await repo.hydrateWordPool(new Date(BASE));
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3 && s.affirmations.length === 3, "the server's page");
    // The scheduler has dealt the reminder that last fired and the next one, ten minutes ahead.
    await repo.saveWordCalendar([calendarRow(w, 2, "afternoon", 7_200_000), calendarRow(w, 3, "evening", -600_000)], BASE);
    w.calendarChanged();
    await until(handle, (s) => s.status === "ready" && s.word !== null && s.word.entry.id === serverRow(2).id, "the word that last fired");
    w.setFocused(false);
    await settle(20);
    // The next reminder fires while the screen is covered: nothing is written and nothing is announced, the clock alone moves it.
    clock.now = BASE + 20 * 60_000;
    let release;
    w.server.state.gate = new Promise((resolve) => (release = resolve));
    w.setFocused(true);
    const shown = await until(handle, (s) => s.status === "ready" && s.word !== null && s.word.entry.id === serverRow(3).id, "the word of the reminder that fired, shown while the first page is still on its way");
    assert.equal(shown.word.slot, "evening");
    release();
    await settle(40);
    assert.equal(handle.result.current.word.entry.id, serverRow(3).id, "the first page that follows keeps it");
    handle.unmount();
  });

  // What stays tied to the screen being in front: the success tap (Reflection gives it when Journal is covered, so it is never felt
  // twice) and the loads a finished reflection starts.
  await test("journal: a reflection that finishes while the screen is covered gives no success tap and starts no load here", async (w) => {
    seedServer(w, 2);
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 2, "the entries");
    w.setFocused(false);
    await settle(20);
    const reads = journalReads(w).length;
    await w.use("@/db/outbox").enqueue(text("c-covered"));
    const done = await engine.syncAndWait("c-covered", { waitMs: 60_000 });
    assert.equal(done.kind, "ready", "the reflection finished");
    await settle(40);
    assert.deepEqual(w.hapticsCalls, [], "the tap is given by the screen that is in front");
    assert.equal(journalReads(w).length, reads, "and the covered screen reads nothing from the server");
    handle.unmount();
  });

  await test("today: the screen draws the calendar's word and falls back to the newest reflection's word for the slot", async () => {
    const screen = fs.readFileSync(path.join(REPO, "src/screens/journal/JournalFeedScreen.tsx"), "utf8").replace(/\r\n/g, "\n");
    assert.ok(screen.includes("const word = ready.word;"), "the card reads the hook's word");
    assert.ok(screen.includes("word === null ? getAffirmationForSlot(ready.affirmations, ready.currentSlot) : null"), "no word: the old rule");
    assert.ok(screen.includes("word?.slot ?? fallback?.slot"), "the label's slot is the word's own slot");
    assert.ok(screen.includes("word !== null ? word.entry"), "the card shows when the word's own reflection was made");
    assert.ok(screen.includes("getWordStack({ affirmation, entry: source, slot }, ready.entries, ready.words)"), "today's word lies on top of the deck");
    assert.ok(screen.includes("entryId: card.affirmation.entryId, tab: \"affirmations\""), "a card opens the reflection its word is from");
  }, { signIn: false });

  await test("journal: the deck's words come behind the list: what the phone lacks is fetched in one request, and every finished reflection gets a card", async (w) => {
    // Two reflections this week and eight older ones. The reminders' pool is the week's two topped up with the five newest older
    // ones, read from the phone's cache, where each already has its words: so the one request for several reflections' words is
    // the deck's own, for the two the phone has none of.
    const older = (n) => (n <= 2 ? {} : { created_at: stamp(BASE - (n + 10) * 86_400_000), updated_at: stamp(BASE - (n + 10) * 86_400_000) });
    seedServer(w, 10, older);
    await seedCache(w, [1, 2, 3, 4, 5, 6, 7, 9].map((n) => modelOf(w, n, older(n))));
    const handle = await render(w);
    const ids = Array.from({ length: 10 }, (_, i) => serverRow(i + 1).id);
    const state = await until(handle, (s) => s.status === "ready" && s.entries.length === 10 && ids.every((id) => (s.words[id] ?? []).length === 3), "every reflection's words");
    const many = affirmationReads(w).filter((r) => (query(r).get("entry_id") ?? "").startsWith("in."));
    assert.equal(many.length, 1, "one request for the words the phone lacks");
    assert.equal(query(many[0]).get("entry_id"), `in.(${serverRow(8).id},${serverRow(10).id})`, "only those of the reflections it has none of");
    assert.equal(query(many[0]).get("user_id"), "eq.user_a", "filtered by the user too");
    const cards = w.use("@/data/selectors").getWordStack({ affirmation: state.affirmations[0], entry: state.entries[0], slot: "morning" }, state.entries, state.words);
    assert.deepEqual(cards.map((card) => card.entry.id), ids, "today's word on top, then one card for each earlier reflection, newest first");
    handle.unmount();
  });

  await test("journal: the deck goes on into each older page: its reflections' words are fetched in one request when the page comes", async (w) => {
    seedServer(w, 10);
    w.use("@/store/devStore").useDevStore.getState().setPageSize(5);
    const handle = await render(w);
    const first = Array.from({ length: 5 }, (_, i) => serverRow(i + 1).id);
    let state = await until(handle, (s) => s.status === "ready" && s.entries.length === 5 && first.every((id) => s.words[id]?.length === 3), "the first page's words");
    const many = () => affirmationReads(w).filter((r) => (query(r).get("entry_id") ?? "").startsWith("in."));
    const before = many().length;
    state.loadMore();
    const second = Array.from({ length: 5 }, (_, i) => serverRow(i + 6).id);
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 10 && second.every((id) => s.words[id]?.length === 3), "the second page's words");
    const added = many().slice(before);
    assert.equal(added.length, 1, "one request for the page");
    assert.equal(query(added[0]).get("entry_id"), `in.(${second.join(",")})`, "for its reflections");
    handle.unmount();
  });

  await test("journal: a heart on an earlier card of the deck saves that word and shows it saved on its card", async (w) => {
    seedServer(w, 3);
    const handle = await render(w);
    const second = serverRow(2).id;
    let state = await until(handle, (s) => s.status === "ready" && s.words[second]?.length === 3, "the earlier reflection's words");
    const target = state.words[second][0];
    state.toggleFavorite(target);
    state = await until(handle, (s) => s.status === "ready" && s.words[second].find((a) => a.id === target.id)?.isFavorite === true, "the heart on its card");
    await settle(20);
    assert.equal(w.server.state.affirmations.find((a) => a.id === target.id).is_favorite, true, "the save is that word's own");
    assert.ok(state.affirmations.every((a) => !a.isFavorite), "today's words are untouched");
    assert.ok(state.words[serverRow(1).id].every((a) => !a.isFavorite));
    const cards = w.use("@/data/selectors").getWordStack({ affirmation: state.affirmations[0], entry: state.entries[0], slot: "morning" }, state.entries, state.words);
    assert.equal(cards[1].affirmation.id, target.id, "the card shows the word that was saved");
    assert.equal(cards[1].affirmation.isFavorite, true);
    handle.unmount();
  });

  await test("journal: offline the deck takes its words from the phone and asks the server for none", async (w) => {
    seedServer(w, 3);
    w.server.state.offline = true;
    await seedCache(w, [modelOf(w, 1), modelOf(w, 2)]);
    const handle = await render(w);
    const state = await until(handle, (s) => s.status === "ready" && [1, 2].every((n) => s.words[serverRow(n).id]?.length === 3), "the phone's words");
    await settle(30);
    assert.equal(affirmationReads(w).length, 0, "no word is asked for while there is no answer");
    assert.equal(Object.keys(state.words).length, 2);
    handle.unmount();
  });

  await test("journal: the deck's words are all read again from the phone on a pull-to-refresh, and none the phone holds is asked for", async (w) => {
    seedServer(w, 3);
    const handle = await render(w);
    const second = serverRow(2).id;
    let state = await until(handle, (s) => s.status === "ready" && [1, 2, 3].every((n) => s.words[serverRow(n).id]?.length === 3), "every card's words");
    await settle(20);
    assert.ok(handle.result.current.words[second].every((a) => !a.isFavorite));
    // The phone now holds a heart for an earlier card (a save that came back while the screen showed something else, say).
    const mappers = w.use("@/data/mappers");
    const saved = affirmationRows(second).map(mappers.toAffirmation).sort((a, b) => a.position - b.position);
    saved[0] = { ...saved[0], isFavorite: true };
    await w.use("@/db/cache").upsertAffirmations(second, saved);
    const many = () => affirmationReads(w).filter((r) => (query(r).get("entry_id") ?? "").startsWith("in.")).length;
    const before = many();
    handle.result.current.refresh();
    state = await until(handle, (s) => s.status === "ready" && s.words[second]?.[0]?.isFavorite === true, "the phone's heart on its card");
    assert.equal(state.words[second][0].id, saved[0].id);
    await settle(20);
    assert.equal(many(), before, "the phone holds every reflection's words, so the server is asked for none");
    handle.unmount();
  });

  await test("journal: a heart tapped while the deck's words are on their way stays on its card when the older read lands", async (w) => {
    const older = (n) => (n <= 2 ? {} : { created_at: stamp(BASE - (n + 10) * 86_400_000), updated_at: stamp(BASE - (n + 10) * 86_400_000) });
    seedServer(w, 10, older);
    // The phone holds the newest reflection with no words: the deck reads them from the phone behind the page, as the server
    // sent them before the heart.
    await seedCache(w, [2, 3, 4, 5, 6, 7, 9].map((n) => modelOf(w, n, older(n))));
    await w.use("@/db/cache").upsertEntry(modelOf(w, 1));
    const newest = serverRow(1).id;
    // The deck's request for the page's words, and the heart's save, are held until the check lets them go.
    const fake = globalThis.fetch;
    let heldRead = false;
    let heldSave = false;
    let releaseRead = () => {};
    let releaseSave = () => {};
    const readGate = new Promise((resolve) => (releaseRead = resolve));
    const saveGate = new Promise((resolve) => (releaseSave = resolve));
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname.endsWith("/daily_affirmations")) {
        const method = init.method ?? "GET";
        if (method === "GET" && !heldRead && (url.searchParams.get("entry_id") ?? "").includes(serverRow(8).id)) {
          heldRead = true;
          await readGate;
        } else if (method === "PATCH" && !heldSave) {
          heldSave = true;
          await saveGate;
        }
      }
      return fake(input, init);
    };
    const waitFor = async (check, label) => {
      for (let i = 0; i < 200; i += 1) {
        if (check()) return;
        await settle(2);
      }
      assert.fail(`${label} never happened`);
    };
    try {
      const handle = await render(w);
      await waitFor(() => heldRead, "the deck's request for the page's words");
      let state = await until(handle, (s) => s.status === "ready" && s.words[newest]?.length === 3, "the newest reflection's words");
      const target = state.words[newest][0];
      assert.equal(target.isFavorite, false);
      state.toggleFavorite(target);
      await waitFor(() => heldSave, "the heart's save");
      await until(handle, (s) => s.words[newest][0].isFavorite === true, "the heart at once");
      releaseRead();
      await until(handle, (s) => [8, 10].every((n) => s.words[serverRow(n).id]?.length === 3), "the page's words");
      await settle(20);
      assert.equal(handle.result.current.words[newest][0].isFavorite, true, "the older read of the phone does not take the heart back");
      releaseSave();
      await settle(30);
      assert.equal(handle.result.current.words[newest][0].isFavorite, true, "and the save keeps it");
      assert.equal(w.server.state.affirmations.find((a) => a.id === target.id).is_favorite, true, "saved on the server");
      handle.unmount();
    } finally {
      releaseRead();
      releaseSave();
      globalThis.fetch = fake;
    }
  });

  await test("journal: with the mock data the deck's words are the mock rows, and nothing reaches the server", async (w) => {
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    const before = w.server.state.requests.length;
    const handle = await render(w);
    await advance(3_000);
    const state = await until(handle, (s) => s.status === "ready" && s.entries.length >= 20 && Object.keys(s.words).length > 0, "the mock entries and their words");
    const finished = new Set(state.entries.filter((e) => e.status === "ready" && e.devotional !== null).map((e) => e.id));
    for (const [entryId, list] of Object.entries(state.words)) {
      assert.ok(finished.has(entryId), "only finished reflections have words");
      assert.ok(list.length > 0 && list.every((a) => a.entryId === entryId));
    }
    assert.equal(w.server.state.requests.length, before, "the mock never reaches the server");
    handle.unmount();
  });

  await test("journal: with no network the cached entries stay on screen; with nothing cached it is the error state, and Try again works", async (w) => {
    seedServer(w, 3);
    w.server.state.offline = true;
    let handle = await render(w);
    await until(handle, (s) => s.status === "error", "the error state");
    handle.unmount();
    await seedCache(w, [modelOf(w, 1), modelOf(w, 2)]);
    handle = await render(w);
    const state = await until(handle, (s) => s.status === "ready", "the cached entries");
    await settle(30);
    assert.equal(handle.result.current.status, "ready", "a failed refresh keeps what is on screen");
    assert.equal(handle.result.current.entries.length, 2);
    assert.ok(state.entries.length === 2);
    handle.unmount();
    await w.use("@/db/cache").clearAll();
    handle = await render(w);
    const failed = await until(handle, (s) => s.status === "error", "the error state again");
    w.server.state.offline = false;
    failed.retry();
    const ok = await until(handle, (s) => s.status === "ready", "the entries after Try again");
    assert.equal(ok.entries.length, 3);
    handle.unmount();
  });

  await test("journal: older pages load on scroll, once at a time, to the end; the count is the whole list from the first page", async (w) => {
    seedServer(w, 12);
    w.use("@/store/devStore").useDevStore.getState().setPageSize(5);
    const handle = await render(w);
    let state = await until(handle, (s) => s.status === "ready" && s.entries.length === 5, "page 1");
    assert.equal(state.entryCount, 12);
    state.loadMore();
    state.loadMore();
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 10 && !s.loadingMore, "page 2");
    assert.equal(journalReads(w).filter((r) => query(r).get("created_at") !== null).length, 1, "two calls, one request");
    assert.equal(state.entryCount, 12);
    state.loadMore();
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 12 && !s.loadingMore, "page 3");
    const reads = journalReads(w).length;
    state.loadMore();
    await settle(20);
    assert.equal(journalReads(w).length, reads, "no older entry, no request");
    assert.deepEqual(handle.result.current.entries.map((e) => e.id), Array.from({ length: 12 }, (_, i) => serverRow(i + 1).id));
    assert.equal(handle.result.current.entryCount, 12);
    handle.unmount();
  });

  await test("journal: a page that fails keeps the pages on screen and is asked for again on the next scroll", async (w) => {
    seedServer(w, 12);
    w.use("@/store/devStore").useDevStore.getState().setPageSize(5);
    const handle = await render(w);
    let state = await until(handle, (s) => s.status === "ready" && s.entries.length === 5, "page 1");
    w.server.state.rest.journal_entries.push(json(500, { code: "XX000", message: "boom" }));
    state.loadMore();
    await settle(20);
    assert.equal(journalReads(w).filter((r) => query(r).get("created_at") !== null).length, 1, "the page was asked for");
    assert.equal(handle.result.current.loadingMore, false);
    assert.equal(handle.result.current.status, "ready");
    assert.equal(handle.result.current.entries.length, 5);
    handle.result.current.loadMore();
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 10, "the page, asked again");
    handle.unmount();
  });

  await test("journal: coming back to the app keeps the older pages; pull-to-refresh starts again from the first page", async (w) => {
    seedServer(w, 12);
    w.use("@/store/devStore").useDevStore.getState().setPageSize(5);
    const handle = await render(w);
    let state = await until(handle, (s) => s.status === "ready" && s.entries.length === 5, "page 1");
    state.loadMore();
    await until(handle, (s) => s.status === "ready" && s.entries.length === 10 && !s.loadingMore, "page 2");
    const row = serverRow(40, { created_at: stamp(BASE + 30_000), updated_at: stamp(BASE + 30_000) });
    w.server.state.entries.push(row);
    w.server.state.affirmations.push(...affirmationRows(row.id));
    const before = journalReads(w).length;
    w.appState.emit("active");
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 11 && s.entries[0].id === row.id, "the foreground reload");
    assert.ok(journalReads(w).length > before);
    assert.equal(state.entryCount, 13);
    state.loadMore();
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 13 && !s.loadingMore, "the next page after the reload");
    assert.deepEqual(state.entries.map((e) => e.id), [serverRow(40).id, ...Array.from({ length: 12 }, (_, i) => serverRow(i + 1).id)], "the reload kept the cursor of the older pages");
    await state.refresh();
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 5, "the refreshed first page");
    assert.equal(state.entries[0].id, row.id);
    assert.equal(state.entryCount, 13);
    state.loadMore();
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 10 && !s.loadingMore, "page 2 again");
    handle.unmount();
  });

  await test("journal: a reflection that finishes appears at the top, its waiting card goes, and the saved note is cleared", async (w) => {
    seedServer(w, 3);
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const offlineStore = w.use("@/store/offlineStore").useOfflineStore;
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3, "the entries");
    offlineStore.getState().setSavedNote("offline");
    await w.use("@/db/outbox").enqueue(text("c-new"));
    const waiting = engine.syncAndWait("c-new", { waitMs: 60_000 });
    const result = await waiting;
    assert.equal(result.kind, "ready");
    const state = await until(handle, (s) => s.status === "ready" && s.entries.length === 4 && s.entries[0].id === result.entryId, "the new entry on top");
    assert.equal(state.entries.some((e) => e.isLocalOnly), false, "no waiting card is left");
    assert.equal(state.savedNote, null);
    assert.equal(state.entryCount, 4);
    handle.unmount();
  });

  // 2026-11-10: a reflection being prepared is one card that says only that ("Preparing your reflection…"): the progress is
  // shown once, on New Entry's overlay, and the handoff lands on Reflection. Journal tracks no stage any more (the 2026-11-09
  // progress bar and its stage lines went at the owner's request), and gives the success tap only when it is the screen in front.
  await test("journal: a reflection being prepared is one plain card with no stage of its own, and a finish while Journal is in front gives one success tap; a heavy moment gives none", async (w) => {
    seedServer(w, 2);
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 2, "the entries");
    assert.equal("stages" in handle.result.current, false, "Journal keeps no stages");
    let release;
    w.server.state.functions["process-entry"].push(
      () =>
        new Promise((resolve) => {
          release = () => {
            // What the fake server does by itself for an ungated call: the row and its affirmations exist from the answer on.
            const made = readyResult(text("c-new"));
            w.server.state.entries.push(made.row);
            w.server.state.affirmations.push(...made.affirmations);
            resolve(json(200, made.response));
          };
        }),
    );
    await w.use("@/db/outbox").enqueue(text("c-new"));
    let outcome = null;
    engine.syncAndWait("c-new").then((value) => (outcome = value));
    let state = await until(handle, (s) => s.status === "ready" && s.entries[0]?.pending?.status === "sending", "the card being sent");
    assert.equal(state.entries[0].isLocalOnly, true, "the card is the item on this phone");
    assert.equal(state.entries[0].transcript, null, "and never its words");
    await advance(2_900);
    assert.equal(outcome, null, "New Entry is still on its screen inside the three seconds");
    await advance(200);
    assert.deepEqual(outcome, { kind: "later" }, "New Entry has left after its 3 seconds");
    await advance(6_000);
    state = handle.result.current;
    assert.equal(state.entries[0].pending?.status, "sending", "still the one plain card while the server works");
    assert.equal("stages" in state, false, "and no stage of its own at any point");
    assert.deepEqual(w.hapticsCalls, [], "no tap before the answer");
    release();
    state = await until(handle, (s) => s.status === "ready" && s.entries.length === 3 && !s.entries[0].isLocalOnly, "the finished reflection");
    assert.equal(state.entries[0].clientEntryId, "c-new");
    assert.deepEqual(w.hapticsCalls, ["success"], "one success tap when the reflection finishes with Journal in front");

    // A heavy moment finishes like any other, with no tap (Crisis Safety Rules: nothing louder than the screen).
    w.server.state.makeEntry = crisisResult;
    await w.use("@/db/outbox").enqueue(text("c-heavy"));
    const heavy = await engine.syncAndWait("c-heavy", { waitMs: 60_000 });
    assert.equal(heavy.isCrisis, true);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 4, "the heavy moment");
    assert.deepEqual(w.hapticsCalls, ["success"], "no tap for a heavy moment");
    handle.unmount();
  });

  await test("journal: a reflection the server refuses for good stays as its card with Review, and gives no tap", async (w) => {
    seedServer(w, 1);
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 1, "the entries");
    let release;
    w.server.state.functions["process-entry"].push(
      () =>
        new Promise((resolve) => {
          release = () => resolve(fnError(422, "TOO_SHORT"));
        }),
    );
    await w.use("@/db/outbox").enqueue(text("c-short"));
    engine.syncNow("submit");
    await until(handle, (s) => s.status === "ready" && s.entries[0]?.pending?.status === "sending", "the card while it is sent");
    release();
    const state = await until(handle, (s) => s.status === "ready" && s.entries[0].pending?.status === "needs_action", "the refusal");
    assert.equal(state.entries.length, 2, "the refused card stays, with Review");
    assert.equal(state.entries[0].pending?.lastErrorCode, "TOO_SHORT");
    assert.deepEqual(w.hapticsCalls, [], "no tap for a refusal");
    handle.unmount();
  });

  await test("journal: reflections saved on this phone come first as cards; a finished copy of the same reflection is never listed twice", async (w) => {
    seedServer(w, 2, (n) => (n === 1 ? { client_entry_id: "c-same" } : {}));
    await enqueue(w, text("c-same"));
    await enqueue(w, text("c-other"));
    const handle = await render(w);
    const state = await until(handle, (s) => s.status === "ready" && s.entries.length === 3, "pending and server entries");
    assert.deepEqual(state.entries.filter((e) => e.isLocalOnly).map((e) => e.clientEntryId).sort(), ["c-other", "c-same"]);
    assert.equal(state.entries.filter((e) => e.clientEntryId === "c-same").length, 1);
    assert.ok(state.entries.every((e) => e.transcript === null || !e.isLocalOnly));
    handle.unmount();
  });

  await test("journal: failed entries and stale ones that never finished are not listed; fresh ones and crisis ones are", async (w) => {
    seedServer(w, 6, (n) => {
      if (n === 2) return { processing_status: "failed", error_code: "AI_UNAVAILABLE" };
      if (n === 3) return { processing_status: "processing", updated_at: stamp(BASE - 30 * 60_000) };
      if (n === 4) return { processing_status: "processing", updated_at: stamp(BASE - 60_000) };
      if (n === 5) return { is_crisis: true, dominant_emotion: null, scripture_reference: null, devotional_script: null, devotional_title: null, closing_prayer: null };
      return {};
    });
    const handle = await render(w);
    const state = await until(handle, (s) => s.status === "ready" && s.entries.length > 0, "the entries");
    await settle(20);
    assert.deepEqual(handle.result.current.entries.map((e) => e.id), [1, 4, 5, 6].map((n) => serverRow(n).id));
    assert.equal(handle.result.current.entryCount, 5, "the count is the server's: it counts the stale one it cannot tell apart");
    assert.ok(state);
    handle.unmount();
  });

  await test("journal: the heart shows at once, is saved on the server and in the cache, and goes back with a calm flag when the save fails", async (w) => {
    seedServer(w, 2);
    const handle = await render(w);
    let state = await until(handle, (s) => s.status === "ready" && s.affirmations.length === 3, "the affirmations");
    const target = state.affirmations[1];
    state.toggleFavorite(target);
    state = await until(handle, (s) => s.status === "ready" && s.affirmations.find((a) => a.id === target.id).isFavorite, "the optimistic heart");
    await settle(20);
    assert.equal(w.server.state.affirmations.find((a) => a.id === target.id).is_favorite, true);
    assert.equal((await w.use("@/db/cache").listAffirmationsForEntry(target.entryId)).find((a) => a.id === target.id).isFavorite, true);
    assert.equal(handle.result.current.favoriteFailed, false);
    w.server.state.rest.daily_affirmations.push(json(500, { code: "XX000", message: "boom" }));
    handle.result.current.toggleFavorite(handle.result.current.affirmations.find((a) => a.id === target.id));
    state = await until(handle, (s) => s.status === "ready" && s.favoriteFailed, "the failure flag");
    assert.equal(state.affirmations.find((a) => a.id === target.id).isFavorite, true, "rolled back to what it was");
    state.toggleFavorite(state.affirmations.find((a) => a.id === target.id));
    state = await until(handle, (s) => s.status === "ready" && !s.favoriteFailed && !s.affirmations.find((a) => a.id === target.id).isFavorite, "the next try");
    await settle(20);
    assert.equal(w.server.state.affirmations.find((a) => a.id === target.id).is_favorite, false);
    handle.unmount();
  });

  await test("analytics: the heart sends affirmation_favorited with its new state only after a save that succeeded", async (w) => {
    seedServer(w, 2);
    const handle = await render(w);
    let state = await until(handle, (s) => s.status === "ready" && s.affirmations.length === 3, "the affirmations");
    const target = state.affirmations[0];
    assert.deepEqual(w.analyticsCalls, [], "loading Journal sends nothing");
    state.toggleFavorite(target);
    await until(handle, (s) => s.status === "ready" && s.affirmations.find((a) => a.id === target.id).isFavorite, "the heart");
    await settle(20);
    assert.deepEqual(w.analyticsCalls, [["affirmation_favorited", { favorited: true }]]);
    w.server.state.rest.daily_affirmations.push(json(500, { code: "XX000", message: "boom" }));
    handle.result.current.toggleFavorite(handle.result.current.affirmations.find((a) => a.id === target.id));
    await until(handle, (s) => s.status === "ready" && s.favoriteFailed, "the failure flag");
    await settle(20);
    assert.equal(w.analyticsCalls.length, 1, "a save that failed sends nothing");
    handle.result.current.toggleFavorite(handle.result.current.affirmations.find((a) => a.id === target.id));
    await until(handle, (s) => s.status === "ready" && !s.favoriteFailed && !s.affirmations.find((a) => a.id === target.id).isFavorite, "the next try");
    await settle(20);
    assert.deepEqual(w.analyticsCalls[1], ["affirmation_favorited", { favorited: false }]);
    assert.equal(w.analyticsCalls.length, 2);
    handle.unmount();
  });

  // The real tap routing, with the notifications service and the navigation ref faked (plain Node cannot load either).
  const tapRig = { listener: null, navigations: [] };
  const tapFakes = {
    "@/services/notifications": {
      __esModule: true,
      showNotificationsQuietly: () => undefined,
      takeLastTap: () => null,
      addTapListener: (listener) => {
        tapRig.listener = listener;
        return () => undefined;
      },
    },
    "@/navigation/navigationRef": {
      __esModule: true,
      navigationRef: {
        isReady: () => true,
        getRootState: () => ({ routeNames: ["MainTabs", "Reflection"] }),
        navigate: (name, params) => void tapRig.navigations.push({ name, params }),
      },
    },
  };
  await test("analytics: a tapped notification sends its slot and nothing else: no entry, account or words", async (w) => {
    const routing = w.use("@/services/notificationRouting");
    routing.startNotificationRouting();
    const hash = "0123456789abcdef";
    routing.setTapUser(hash);
    tapRig.listener({ key: "aff-afternoon-1", data: { kind: "affirmation", entryId: "entry-secret", slot: "afternoon", userHash: hash } });
    assert.deepEqual(tapRig.navigations, [{ name: "Reflection", params: { entryId: "entry-secret", tab: "affirmations" } }]);
    assert.deepEqual(w.analyticsCalls, [["affirmation_notification_opened", { slot: "afternoon" }]]);
    assert.ok(!JSON.stringify(w.analyticsCalls).includes("entry-secret"));
    assert.ok(!JSON.stringify(w.analyticsCalls).includes(hash));
    // Another account's notification opens nothing and sends nothing.
    tapRig.listener({ key: "aff-morning-2", data: { kind: "affirmation", entryId: "entry-x", slot: "morning", userHash: "fedcba9876543210" } });
    assert.equal(w.analyticsCalls.length, 1);
    assert.equal(tapRig.navigations.length, 1);
  }, { fakes: tapFakes });

  await test("journal: switching the data source in the dev panel loads the other source and shows no data of the first one meanwhile", async (w) => {
    seedServer(w, 3);
    const dev = w.use("@/store/devStore").useDevStore;
    const handle = await render(w);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3, "the real entries");
    const reads = w.server.state.requests.length;
    dev.getState().setDataSource("mock");
    await settle(5);
    assert.equal(handle.result.current.status, "loading");
    await advance(3_000);
    const state = await until(handle, (s) => s.status === "ready" && s.entries.length >= 20, "the mock entries");
    assert.ok(state.entries.every((e) => !e.id.startsWith("00000000-0000-4000")), "none of the server's");
    assert.equal(w.server.state.requests.length, reads, "the mock never reaches the server");
    dev.getState().setDataSource("supabase");
    await advance(1_000);
    await until(handle, (s) => s.status === "ready" && s.entries.length === 3, "the real entries again");
    handle.unmount();
  });

  await test("journal: a database that could not be opened is the error state, and Try again opens it and loads", async (w) => {
    seedServer(w, 2);
    const offlineStore = w.use("@/store/offlineStore").useOfflineStore;
    offlineStore.getState().setDatabase("failed");
    const handle = await render(w);
    const failed = await until(handle, (s) => s.status === "error", "the error state");
    failed.retry();
    const state = await until(handle, (s) => s.status === "ready" && s.entries.length === 2, "the entries after the database opened");
    assert.equal(offlineStore.getState().dbReady, true);
    assert.ok(state);
    handle.unmount();
  });

  await test("journal: the dev flag that fails the next load still works once and clears itself", async (w) => {
    seedServer(w, 2);
    const dev = w.use("@/store/devStore").useDevStore;
    dev.getState().setNextHomeLoadFails(true);
    const handle = await render(w);
    const failed = await until(handle, (s) => s.status === "error", "the error state");
    assert.equal(dev.getState().nextHomeLoadFails, false);
    failed.retry();
    await until(handle, (s) => s.status === "ready", "the entries");
    handle.unmount();
  });
}

// ================================================================== Reflection
async function reflectionChecks() {
  async function render(w, id) {
    const { useReflection } = w.use("@/hooks/useReflection");
    return w.renderHook(useReflection, id);
  }
  const unverified = { scripture_verified: false, scripture_text: null };
  const passage = { reference: "Psalm 23:1", text: "The LORD is my shepherd; I shall not want.", translation: "BSB", verified: true };

  await test("reflection: the copy on the phone shows first, then the server's version replaces it", async (w) => {
    seedServer(w, 1, () => ({ devotional_title: "Fresh from the server" }));
    await seedCache(w, [modelOf(w, 1, { devotional_title: "From the phone" })]);
    let release;
    w.server.state.gate = new Promise((resolve) => (release = resolve));
    const handle = await render(w, serverRow(1).id);
    const first = await until(handle, (s) => s.status === "ready", "the cached entry");
    assert.equal(first.entry.devotional.title, "From the phone");
    assert.equal(first.affirmations.length, 3);
    release();
    const live = await until(handle, (s) => s.status === "ready" && s.entry.devotional.title === "Fresh from the server", "the server's entry");
    assert.equal(live.affirmations.length, 3);
    assert.equal(live.profile.id, "user_a");
    handle.unmount();
  });

  await test("reflection: an entry the server does not have is not found and leaves the cache; no network and nothing cached is the error state with Try again", async (w) => {
    seedServer(w, 1);
    await seedCache(w, [modelOf(w, 9)]);
    let handle = await render(w, serverRow(9).id);
    await until(handle, (s) => s.status === "not-found", "not found");
    assert.equal(await w.use("@/db/cache").getEntry(serverRow(9).id), null);
    handle.unmount();
    w.server.state.offline = true;
    handle = await render(w, serverRow(1).id);
    const failed = await until(handle, (s) => s.status === "error", "the error state");
    w.server.state.offline = false;
    failed.retry();
    await until(handle, (s) => s.status === "ready", "the entry after Try again");
    handle.unmount();
  });

  await test("reflection: offline with a cached copy still opens it", async (w) => {
    seedServer(w, 1);
    await seedCache(w, [modelOf(w, 1)]);
    w.server.state.offline = true;
    const handle = await render(w, serverRow(1).id);
    await until(handle, (s) => s.status === "ready", "the cached entry");
    await settle(30);
    assert.equal(handle.result.current.status, "ready");
    assert.equal(handle.result.current.affirmations.length, 3);
    handle.unmount();
  });

  await test("reflection: an entry the server is still preparing is read again every 5 seconds until it is ready, then left alone", async (w) => {
    seedServer(w, 1, () => ({ processing_status: "processing", devotional_script: null, devotional_title: null, closing_prayer: null, scripture_reference: null, scripture_text: null, scripture_verified: false, dominant_emotion: null, updated_at: stamp(BASE - 1000) }));
    const handle = await render(w, serverRow(1).id);
    let state = await until(handle, (s) => s.status === "ready", "the entry");
    assert.equal(state.entry.status, "processing");
    const reads = () => journalReads(w).length;
    const first = reads();
    await advance(4_900);
    assert.equal(reads(), first, "not before 5 s");
    await advance(200);
    assert.equal(reads(), first + 1);
    Object.assign(w.server.state.entries[0], serverRow(1, { updated_at: stamp(BASE + 6_000), devotional_audio_path: "user_a/devotionals/1.wav", devotional_duration_ms: 90_000 }));
    await advance(5_000);
    state = await until(handle, (s) => s.status === "ready" && s.entry.status === "ready", "the finished entry");
    assert.equal(state.entry.devotional.title, "Title 1");
    const done = reads();
    await advance(60_000);
    assert.equal(reads(), done, "a finished entry is not read again");
    handle.unmount();
  });

  // 2026-11-09: the server answers with the text and reads the devotional aloud behind the answer, so a finished reflection
  // without audio, changed within AUDIO_PENDING_MS, is read again like one still being prepared, and says so.
  await test("reflection: a finished reflection whose audio is still being made says audioPending and is read again every 5 s until the audio lands, then left alone", async (w) => {
    seedServer(w, 1, () => ({ updated_at: stamp(BASE - 1_000) }));
    const handle = await render(w, serverRow(1).id);
    let state = await until(handle, (s) => s.status === "ready", "the entry");
    assert.equal(state.entry.devotional.audioPath, null);
    assert.equal(state.audioPending, true, "the audio is on its way");
    const reads = () => journalReads(w).length;
    const first = reads();
    await advance(4_900);
    assert.equal(reads(), first, "not before 5 s");
    await advance(200);
    assert.equal(reads(), first + 1, "read again at 5 s");
    Object.assign(w.server.state.entries[0], serverRow(1, { updated_at: stamp(clock.now), devotional_audio_path: "user_a/devotionals/1.wav", devotional_duration_ms: 88_000 }));
    await advance(5_000);
    state = await until(handle, (s) => s.status === "ready" && s.entry.devotional.audioPath !== null, "the audio landed");
    assert.equal(state.audioPending, false);
    assert.equal(state.entry.devotional.durationMs, 88_000);
    const done = reads();
    await advance(60_000);
    assert.equal(reads(), done, "a reflection with its audio is not read again");
    handle.unmount();
  });

  await test("reflection: an audio that never lands stops being pending when its window passes, and a reflection whose speech failed is never pending", async (w) => {
    const { AUDIO_PENDING_MS } = w.use("@/constants/app");
    assert.equal(AUDIO_PENDING_MS, 120_000);
    seedServer(w, 2, (n) => (n === 1 ? { updated_at: stamp(BASE - 1_000) } : { updated_at: stamp(BASE - 1_000), error_code: "TTS_FAILED" }));
    const failed = await render(w, serverRow(2).id);
    const failedState = await until(failed, (s) => s.status === "ready", "the entry whose speech failed");
    assert.equal(failedState.audioPending, false, "TTS_FAILED is an answer, not a wait");
    const failedReads = journalReads(w).length;
    await advance(30_000);
    assert.equal(journalReads(w).length, failedReads, "and it is not read again");
    failed.unmount();
    const handle = await render(w, serverRow(1).id);
    await until(handle, (s) => s.status === "ready" && s.audioPending === true, "the pending entry");
    await advance(AUDIO_PENDING_MS + 5_000);
    const state = await until(handle, (s) => s.status === "ready" && s.audioPending === false, "the window passed");
    assert.equal(state.entry.devotional.audioPath, null, "still no audio: the card now reads as text only");
    const after = journalReads(w).length;
    await advance(30_000);
    assert.equal(journalReads(w).length, after, "no more reads once the window has passed");
    handle.unmount();
  });

  await test("reflection: reading stops after two minutes, and when the screen is left", async (w) => {
    seedServer(w, 2, (n) => ({ processing_status: "processing", devotional_script: null, devotional_title: null, closing_prayer: null, scripture_reference: null, scripture_text: null, scripture_verified: false, dominant_emotion: null, updated_at: stamp(BASE + 9_999_999 + n) }));
    const first = await render(w, serverRow(1).id);
    await until(first, (s) => s.status === "ready", "the entry");
    const start = journalReads(w).filter((r) => query(r).get("id") === `eq.${serverRow(1).id}`).length;
    await advance(10 * 60_000);
    const total = journalReads(w).filter((r) => query(r).get("id") === `eq.${serverRow(1).id}`).length - start;
    assert.equal(total, 24, "5 s apart for 120 s");
    first.unmount();
    const second = await render(w, serverRow(2).id);
    await until(second, (s) => s.status === "ready", "the second entry");
    const before = journalReads(w).length;
    second.unmount();
    await advance(60_000);
    assert.equal(journalReads(w).length, before, "left behind, nothing is read");
  });

  await test("reflection: an entry that is only in this phone's outbox is never read from the server", async (w) => {
    const outbox = w.use("@/db/outbox");
    await outbox.enqueue(text("c-wait"));
    await outbox.markSending("c-wait", clock.now);
    const handle = await render(w, "c-wait");
    const state = await until(handle, (s) => s.status === "ready", "the pending entry");
    assert.equal(state.entry.status, "processing");
    assert.equal(state.entry.isLocalOnly, true);
    await advance(30_000);
    assert.equal(journalReads(w).length, 0);
    assert.equal(affirmationReads(w).length, 0, "no affirmations exist for a reflection the server has not seen");
    assert.deepEqual(state.affirmations, []);
    handle.unmount();
  });

  // 2026-11-10: New Entry hands a reflection to Reflection after its three seconds, by the id this phone gave it. The hook shows
  // the item being prepared, turns it into the reflection on the engine's finish (with the success tap New Entry used to give),
  // and reads by the server's id from then on.
  await test("reflection: opened by the id this phone gave it, it shows the reflection being prepared, becomes the reflection on the engine's finish with one success tap, and follows the server's id from then on", async (w) => {
    seedServer(w, 1);
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    let release;
    let made = null;
    w.server.state.functions["process-entry"].push(
      () =>
        new Promise((resolve) => {
          release = () => {
            made = readyResult(text("c-new"));
            w.server.state.entries.push(made.row);
            w.server.state.affirmations.push(...made.affirmations);
            resolve(json(200, made.response));
          };
        }),
    );
    await w.use("@/db/outbox").enqueue(text("c-new"));
    engine.syncNow("submit");
    const handle = await render(w, "c-new");
    let state = await until(handle, (s) => s.status === "ready" && s.entry.isLocalOnly === true, "the item on this phone");
    assert.ok(["pending", "processing"].includes(state.entry.status), "shown as being prepared (queued or being sent: one view)");
    assert.ok(["queued", "sending"].includes(state.entry.pending?.status), "the item is waiting or on its way");
    assert.equal(state.addAffirmation, null, "nothing to add to yet");
    await advance(10_000);
    assert.equal(handle.result.current.entry.isLocalOnly, true, "still the item on this phone while the server works");
    assert.deepEqual(w.hapticsCalls, [], "no tap before the answer");
    release();
    state = await until(handle, (s) => s.status === "ready" && s.entry.status === "ready" && !s.entry.isLocalOnly, "the finished reflection");
    assert.equal(state.entry.id, made.row.id, "the server's id");
    assert.equal(state.entry.clientEntryId, "c-new");
    assert.equal(state.entry.devotional.title, made.response.entry.devotional.title);
    assert.equal(state.affirmations.length, 3, "its three affirmations");
    assert.deepEqual(w.hapticsCalls, ["success"], "one success tap, the moment the reflection is there");
    assert.notEqual(state.addAffirmation, null, "and one more affirmation can be added");
    // From here the hook works by the server's id: a prayer change lands on the reflection.
    const changed = await state.setTracked(true);
    assert.equal(changed.ok, true, "the prayer change goes by the server's id");
    state = await until(handle, (s) => s.status === "ready" && s.entry.prayer !== null, "the prayer shown");
    assert.equal(state.entry.id, made.row.id);
    assert.equal(journalReads(w).filter((r) => query(r).get("id") === "eq.c-new").length, 0, "the server is never asked for the client id");
    handle.unmount();
  });

  await test("reflection: a finish that landed before the first read is found by the client id through the cache, and the hook follows the server's id; a heavy moment gives no tap", async (w) => {
    seedServer(w, 1);
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    await w.use("@/db/outbox").enqueue(text("c-fast"));
    const fast = await engine.syncAndWait("c-fast", { waitMs: 60_000 });
    assert.equal(fast.kind, "ready", "finished before the screen opened");
    const handle = await render(w, "c-fast");
    const state = await until(handle, (s) => s.status === "ready" && s.entry.status === "ready", "the finished reflection, by the client id");
    assert.equal(state.entry.id, fast.entryId, "the server's id");
    assert.equal(state.entry.clientEntryId, "c-fast");
    assert.equal(state.affirmations.length, 3);
    assert.equal(journalReads(w).filter((r) => query(r).get("id") === "eq.c-fast").length, 0, "the server is never asked for the client id");
    handle.unmount();

    // A heavy moment finishing on this screen is met as calmly as any reflection: no tap (Crisis Safety Rules).
    w.hapticsCalls.length = 0;
    let release;
    w.server.state.functions["process-entry"].push(
      () =>
        new Promise((resolve) => {
          release = () => {
            const made = crisisResult(text("c-heavy"));
            w.server.state.entries.push(made.row);
            w.server.state.affirmations.push(...made.affirmations);
            resolve(json(200, made.response));
          };
        }),
    );
    await w.use("@/db/outbox").enqueue(text("c-heavy"));
    engine.syncNow("submit");
    const heavy = await render(w, "c-heavy");
    await until(heavy, (s) => s.status === "ready" && s.entry.isLocalOnly === true, "the heavy moment on its way");
    release();
    const shown = await until(heavy, (s) => s.status === "ready" && s.entry.status === "ready" && s.entry.isCrisis, "the heavy moment");
    assert.equal(shown.entry.isLocalOnly, false);
    assert.deepEqual(w.hapticsCalls, [], "no tap for a heavy moment");
    heavy.unmount();
  });

  await test("reflection: a refusal after the handoff is shown as the refused item with its reason, and the free limit as the held item with the entry the server saved", async (w) => {
    seedServer(w, 1);
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    let refuse;
    w.server.state.functions["process-entry"].push(() => new Promise((resolve) => (refuse = () => resolve(fnError(422, "TOO_SHORT")))));
    await w.use("@/db/outbox").enqueue(text("c-short"));
    engine.syncNow("submit");
    const short = await render(w, "c-short");
    await until(short, (s) => s.status === "ready" && s.entry.isLocalOnly === true, "the item on its way");
    refuse();
    const refused = await until(short, (s) => s.status === "ready" && s.entry.pending?.status === "needs_action", "the refusal");
    assert.equal(refused.entry.status, "failed", "a refused item reads as failed, with its reason");
    assert.equal(refused.entry.pending?.lastErrorCode, "TOO_SHORT");
    assert.equal(refused.entry.isLocalOnly, true, "the words stay on the phone, with Review on Journal");
    assert.deepEqual(w.hapticsCalls, [], "no tap for a refusal");
    short.unmount();

    let hold;
    const resetsAt = new Date(BASE + 3 * 86_400_000).toISOString();
    w.server.state.functions["process-entry"].push(
      () => new Promise((resolve) => (hold = () => resolve(json(402, limitBody("00000000-0000-4000-8000-000000000402", resetsAt))))),
    );
    await w.use("@/db/outbox").enqueue(text("c-held"));
    engine.syncNow("submit");
    const held = await render(w, "c-held");
    await until(held, (s) => s.status === "ready" && s.entry.isLocalOnly === true, "the item on its way");
    hold();
    const limited = await until(held, (s) => s.status === "ready" && s.entry.pending?.status === "limit_reached", "the held item");
    assert.equal(limited.entry.pending?.serverEntryId, "00000000-0000-4000-8000-000000000402", "the entry the server saved, for the Paywall");
    assert.equal(limited.entry.pending?.resetsAt, resetsAt);
    assert.deepEqual(w.hapticsCalls, []);
    held.unmount();
  });

  await test("reflection: the screens' source: New Entry's handoff opens Reflection by the client id, Reflection shows a refusal and opens the Paywall for the free limit, and Journal's card draws no progress bar", async () => {
    const read = (file) => fs.readFileSync(path.join(REPO, file), "utf8").replace(/\r\n/g, "\n");
    const has = (haystack, needle, message) => assert.ok(haystack.includes(needle), `${message}: ${needle}`);
    const lacks = (haystack, needle, message) => assert.ok(!haystack.includes(needle), `${message}: ${needle}`);
    const newEntry = read("src/screens/journal/NewEntryScreen.tsx");
    const laterAt = newEntry.indexOf('case "later":');
    const later = newEntry.slice(laterAt, newEntry.indexOf("break;", laterAt));
    has(later, "leaving.current = true;", "the deliberate exit passes the leave guard");
    has(later, 'navigation.replace("Reflection", { entryId: item.clientEntryId });', "Reflection opens by the client id");
    lacks(later, "leaveToJournal", "no handoff to Journal any more");
    const screen = read("src/screens/journal/ReflectionScreen.tsx");
    has(screen, 'state.entry.pending?.status === "needs_action"', "a refusal has its own branch");
    has(screen, "<ReflectionRefused reason={copy.problems.reason(state.entry.pending.lastErrorCode)} onReturn={returnToJournal} />", "the refused view with its reason");
    has(screen, 'navigation.replace("Paywall", { source: "limit", entryId: held.pending?.serverEntryId ?? held.id });', "the free limit opens the Paywall with the entry the server saved");
    const card = read("src/components/JournalCard.tsx");
    for (const gone of ["PreparingProgress", "progressFill", "ProcessingStage", "stage="]) lacks(card, gone, "no progress bar and no stage on the Journal card");
    const home = read("src/hooks/useJournalHome.ts");
    for (const gone of ["stages", "ProcessingStage"]) lacks(home, gone, "Journal keeps no stages");
    const copyText = read("src/constants/copy.ts");
    lacks(copyText, "Reflecting on what you shared…", "the stage lines are gone");
    has(copyText, 'body: "It’s on your Today screen, where Review shows what you can do.",', "the refused view's words");
    has(copyText, 'body: "It’ll appear here as soon as it’s ready.",', "the preparing view no longer sends the person to Journal");
    has(copyText, 'note: "Your reflection is saved. It’ll open in a moment.",', "the overlay's note");
    has(copyText, 'sent: "Sent. Preparing your devotional, which opens in a moment.",', "the overlay's last announcement");
    for (const file of ["src/screens/journal/ReflectionStateViews.tsx", "src/hooks/useReflection.ts"]) {
      const source = read(file);
      lacks(source, "console.", `${file} logs nothing`);
      for (const tap of ["haptics.selection", "haptics.light", "haptics.medium"]) lacks(source, tap, `${file} taps only success`);
    }
  });

  await test("reflection: a passage kept as a reference is asked for again once, shown when verified, cached, and not asked again within a minute", async (w) => {
    seedServer(w, 1, () => unverified);
    w.server.state.functions["confirm-scripture"].push(() => {
      Object.assign(w.server.state.entries[0], { scripture_verified: true, scripture_text: passage.text });
      return json(200, { scripture: passage });
    });
    const handle = await render(w, serverRow(1).id);
    const state = await until(handle, (s) => s.status === "ready" && s.entry.scripture.verified, "the verified passage");
    assert.equal(state.entry.scripture.text, passage.text);
    assert.deepEqual(functionCalls(w, "confirm-scripture").map((c) => c.body), [{ entryId: serverRow(1).id }]);
    assert.equal((await w.use("@/db/cache").getEntry(serverRow(1).id)).scripture.verified, true);
    handle.unmount();
    const again = await render(w, serverRow(1).id);
    await until(again, (s) => s.status === "ready", "the entry again");
    await settle(20);
    assert.equal(functionCalls(w, "confirm-scripture").length, 1, "within a minute: not asked again");
    again.unmount();
  });

  await test("reflection: a passage that is still unverified is asked for again after a minute and not before; one that turns out not to exist is dropped from the screen and the cache", async (w) => {
    seedServer(w, 1, () => unverified);
    w.server.state.functions["confirm-scripture"].push(() => json(200, { scripture: { ...passage, text: null, verified: false } }));
    let handle = await render(w, serverRow(1).id);
    await until(handle, (s) => s.status === "ready", "the entry");
    await settle(30);
    assert.equal(functionCalls(w, "confirm-scripture").length, 1);
    assert.equal(handle.result.current.entry.scripture.verified, false, "still unverified");
    handle.unmount();
    // Opened again within the minute: the entry is still unverified, and nobody is asked.
    await advance(30_000);
    handle = await render(w, serverRow(1).id);
    await until(handle, (s) => s.status === "ready", "the entry again");
    await settle(30);
    assert.equal(functionCalls(w, "confirm-scripture").length, 1, "not asked again within a minute");
    handle.unmount();
    await advance(31_000);
    w.server.state.functions["confirm-scripture"].push(() => json(200, { scripture: null }));
    handle = await render(w, serverRow(1).id);
    const state = await until(handle, (s) => s.status === "ready" && s.entry.scripture === null, "the passage dropped");
    assert.equal(functionCalls(w, "confirm-scripture").length, 2);
    assert.equal((await w.use("@/db/cache").getEntry(serverRow(1).id)).scripture, null);
    assert.ok(state);
    handle.unmount();
  });

  await test("reflection: a failed confirmation leaves the reference as it was and shows no error", async (w) => {
    seedServer(w, 1, () => unverified);
    w.server.state.functions["confirm-scripture"].push(() => fnError(500, "INTERNAL"));
    const handle = await render(w, serverRow(1).id);
    await until(handle, (s) => s.status === "ready", "the entry");
    await settle(30);
    const state = handle.result.current;
    assert.equal(state.status, "ready");
    assert.equal(state.entry.scripture.verified, false);
    assert.equal(state.entry.scripture.reference, "Psalm 23:1");
    assert.equal(functionCalls(w, "confirm-scripture").length, 1);
    handle.unmount();
  });

  await test("reflection: no confirmation is asked for a verified passage, an entry with no passage, an unfinished one, the mock data, or while offline", async (w) => {
    seedServer(w, 4, (n) => {
      // A heavy moment saved before 2026-11-08: no reflection, so no passage to confirm.
      if (n === 2) return { is_crisis: true, dominant_emotion: null, scripture_reference: null, scripture_text: null, scripture_verified: false, devotional_title: null, devotional_script: null, closing_prayer: null };
      if (n === 3) return { processing_status: "processing", ...unverified };
      return n === 4 ? unverified : {};
    });
    for (const n of [1, 2, 3]) {
      const handle = await render(w, serverRow(n).id);
      await until(handle, (s) => s.status === "ready", `entry ${n}`);
      await settle(20);
      handle.unmount();
    }
    assert.equal(functionCalls(w, "confirm-scripture").length, 0);
    w.use("@/store/offlineStore").useOfflineStore.getState().setNet(false, false);
    let handle = await render(w, serverRow(4).id);
    await until(handle, (s) => s.status === "ready", "the entry offline");
    await settle(20);
    handle.unmount();
    assert.equal(functionCalls(w, "confirm-scripture").length, 0, "offline");
    w.use("@/store/offlineStore").useOfflineStore.getState().setNet(true, true);
    const confirm = w.use("@/services/scriptureConfirm");
    w.use("@/store/devStore").useDevStore.getState().setDataSource("mock");
    const model = modelOf(w, 4, unverified);
    assert.equal(await confirm.confirmScriptureIfNeeded(model, clock.now + 1_000_000), model);
    assert.equal(functionCalls(w, "confirm-scripture").length, 0, "the mock data");
    assert.equal(confirm.needsScriptureConfirmation(model), true);
    assert.equal(confirm.needsScriptureConfirmation({ ...model, scripture: { ...model.scripture, verified: true } }), false);
    assert.equal(confirm.needsScriptureConfirmation({ ...model, scripture: null }), false);
    assert.equal(confirm.needsScriptureConfirmation({ ...model, isCrisis: true }), true, "a heavy moment's passage is confirmed like any other");
    assert.equal(confirm.needsScriptureConfirmation({ ...model, status: "processing" }), false);
  });

  await test("reflection: another entry is never shown under the id of the one asked for", async (w) => {
    seedServer(w, 2);
    const { useReflection } = w.use("@/hooks/useReflection");
    const handle = w.renderHook(useReflection, serverRow(1).id);
    const first = await until(handle, (s) => s.status === "ready", "the first entry");
    assert.equal(first.entry.id, serverRow(1).id);
    handle.unmount();
    const other = w.renderHook(useReflection, serverRow(2).id);
    assert.equal(other.result.current.status, "loading");
    const second = await until(other, (s) => s.status === "ready", "the second entry");
    assert.equal(second.entry.id, serverRow(2).id);
    other.unmount();
  });

  await test("reflection: the dev flag that fails the next load works once", async (w) => {
    seedServer(w, 1);
    const dev = w.use("@/store/devStore").useDevStore;
    dev.getState().setNextReflectionLoadFails(true);
    const handle = await render(w, serverRow(1).id);
    const failed = await until(handle, (s) => s.status === "error", "the error state");
    assert.equal(dev.getState().nextReflectionLoadFails, false);
    failed.retry();
    await until(handle, (s) => s.status === "ready", "the entry");
    handle.unmount();
  });
}

// ================================================================== the form of the server's times
async function timestampChecks() {
  await test("timestamp: a server time becomes three digits and a Z with the same instant; text that is not a time is left alone", async (w) => {
    const { normalizeTimestamp } = w.use("@/utils/timestamp");
    const at = Date.UTC(2026, 9, 25, 11, 59, 0, 123);
    // [what the server writes, what the app keeps, the instant in milliseconds]
    const cases = [
      ["2026-10-25T11:59:00.123456+00:00", "2026-10-25T11:59:00.123Z", at],
      ["2026-10-25T11:59:00.123+00:00", "2026-10-25T11:59:00.123Z", at],
      ["2026-10-25T11:59:00.123Z", "2026-10-25T11:59:00.123Z", at],
      ["2026-10-25T11:59:00.123z", "2026-10-25T11:59:00.123Z", at],
      ["2026-10-25T11:59:00.12345678Z", "2026-10-25T11:59:00.123Z", at],
      ["2026-10-25T11:59:00.123999+00:00", "2026-10-25T11:59:00.123Z", at],
      ["2026-10-25 11:59:00.123456+00", "2026-10-25T11:59:00.123Z", at],
      ["2026-10-25T11:59:00.123456-00:00", "2026-10-25T11:59:00.123Z", at],
      ["2026-10-25T11:59:00+00:00", "2026-10-25T11:59:00.000Z", at - 123],
      ["2026-10-25T11:59:00.5Z", "2026-10-25T11:59:00.500Z", at - 123 + 500],
      ["2026-10-25T11:59:00.123456+01:00", "2026-10-25T11:59:00.123+01:00", at - 3_600_000],
      ["2026-10-25T11:59:00.123456+0530", "2026-10-25T11:59:00.123+05:30", at - 19_800_000],
      ["2026-10-25T11:59:00-07", "2026-10-25T11:59:00.000-07:00", at - 123 + 25_200_000],
    ];
    for (const [input, expected, instant] of cases) {
      assert.equal(normalizeTimestamp(input), expected, input);
      assert.equal(normalizeTimestamp(expected), expected, `${expected} is already in the form`);
      assert.equal(Date.parse(expected), instant, `${expected} is the same instant`);
      assert.match(expected, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/);
    }
    for (const text of ["", "garbage", "2026-10-25", "2026-10-25T11:59", "yesterday", "2026-10-25T11:59:00.123456 UTC", "2026-10-25T11:59:00.123456+1"]) {
      assert.equal(normalizeTimestamp(text), text, JSON.stringify(text));
    }
  }, { signIn: false });
}

// ================================================================== the pure rules of the lists
async function selectorChecks() {
  await test("selectors: a processing entry is listed until nothing has touched it for ten minutes; ready and crisis ones always; failed and waiting ones never", async (w) => {
    const selectors = w.use("@/data/selectors");
    const { STALE_PROCESSING_MS } = w.use("@/constants/app");
    const now = clock.now;
    const entry = (status, updatedAt, extra = {}) => ({ ...modelOf(w, 1), status, updatedAt: ISO(updatedAt), ...extra });
    assert.equal(STALE_PROCESSING_MS, 600_000);
    assert.equal(selectors.isListedEntry(entry("processing", now - STALE_PROCESSING_MS + 1), now), true);
    assert.equal(selectors.isListedEntry(entry("processing", now - STALE_PROCESSING_MS), now), false);
    assert.equal(selectors.isListedEntry(entry("processing", now + 60_000), now), true, "a clock that runs a little behind the server's");
    assert.equal(selectors.isListedEntry(entry("ready", now - 10 * STALE_PROCESSING_MS), now), true);
    assert.equal(selectors.isListedEntry(entry("ready", now, { isCrisis: true }), now), true);
    for (const status of ["failed", "pending", "uploading"]) assert.equal(selectors.isListedEntry(entry(status, now), now), false, status);
  }, { signIn: false });

  await test("selectors: merging puts the newer read of an entry over the older one, newest first, a tie broken by id, and changes neither input", async (w) => {
    const selectors = w.use("@/data/selectors");
    const a = modelOf(w, 1);
    const b = modelOf(w, 2);
    const c = modelOf(w, 3);
    const newerB = { ...b, devotional: { ...b.devotional, title: "Newer read" } };
    const existing = [c, b];
    const incoming = [a, newerB];
    const merged = selectors.mergeEntries(existing, incoming);
    assert.deepEqual(merged.map((e) => e.id), [a.id, b.id, c.id]);
    assert.equal(merged[1].devotional.title, "Newer read");
    assert.deepEqual(existing, [c, b]);
    assert.deepEqual(incoming, [a, newerB]);
    const tieA = { ...a, id: "id-a", clientEntryId: "ca" };
    const tieB = { ...a, id: "id-b", clientEntryId: "cb" };
    assert.deepEqual(selectors.mergeEntries([tieA], [tieB]).map((e) => e.id), ["id-b", "id-a"]);
    assert.deepEqual(selectors.mergeEntries([tieB], [tieA]).map((e) => e.id), ["id-b", "id-a"], "the same whichever came first");
    assert.deepEqual(selectors.mergeEntries([], []), []);
  }, { signIn: false });

  // 2026-11-09: isAudioPending is the one rule the Journal card, the Reflection player card and the Reflection hook share.
  await test("selectors: a finished reflection with no audio, no TTS_FAILED and a change within two minutes has its audio pending; anything else does not", async (w) => {
    const selectors = w.use("@/data/selectors");
    const { AUDIO_PENDING_MS } = w.use("@/constants/app");
    const now = clock.now;
    const entry = (extra = {}) => modelOf(w, 1, { updated_at: ISO(now - 1_000), ...extra });
    assert.equal(selectors.isAudioPending(entry(), now), true);
    assert.equal(selectors.isAudioPending(entry({ updated_at: ISO(now - AUDIO_PENDING_MS + 1) }), now), true, "inside the window");
    assert.equal(selectors.isAudioPending(entry({ updated_at: ISO(now - AUDIO_PENDING_MS) }), now), false, "the window has passed");
    assert.equal(selectors.isAudioPending(entry({ updated_at: ISO(now + 30_000) }), now), true, "a clock a little behind the server's");
    assert.equal(selectors.isAudioPending(entry({ error_code: "TTS_FAILED" }), now), false, "the speech step failed");
    assert.equal(selectors.isAudioPending(entry({ devotional_audio_path: "user_a/devotionals/1.wav", devotional_duration_ms: 90_000 }), now), false, "it has its audio");
    assert.equal(selectors.isAudioPending(entry({ processing_status: "processing", devotional_script: null, devotional_title: null, closing_prayer: null }), now), false, "not finished");
    assert.equal(selectors.isAudioPending(entry({ is_crisis: true, dominant_emotion: null, scripture_reference: null, scripture_text: null, scripture_verified: false, devotional_title: null, devotional_script: null, closing_prayer: null }), now), false, "no devotional");
    assert.equal(selectors.isAudioPending(entry({ is_crisis: true }), now), true, "a heavy moment's audio is made like any other's");
  }, { signIn: false });

  await test("selectors: the newest finished reflection, a heavy moment's included; one with no devotional is passed over; or none", async (w) => {
    const selectors = w.use("@/data/selectors");
    const heavy = modelOf(w, 1, { is_crisis: true });
    const legacy = modelOf(w, 1, { is_crisis: true, dominant_emotion: null, scripture_reference: null, scripture_text: null, scripture_verified: false, devotional_title: null, devotional_script: null, closing_prayer: null });
    const processing = modelOf(w, 2, { processing_status: "processing" });
    const ready1 = modelOf(w, 3);
    const ready2 = modelOf(w, 4);
    assert.equal(selectors.getNewestReadyEntry([heavy, processing, ready1, ready2]).id, heavy.id);
    assert.equal(selectors.getNewestReadyEntry([legacy, processing, ready1, ready2]).id, ready1.id);
    assert.equal(selectors.getNewestReadyEntry([legacy, processing]), null);
    assert.equal(selectors.getNewestReadyEntry([]), null);
  }, { signIn: false });
}

// ================================================================== the words the screens show
async function copyChecks() {
  await test("copy: the new strings use curly apostrophes and say what the app does", async (w) => {
    const { copy } = w.use("@/constants/copy");
    for (const value of [copy.journal.affirmation.saveError, copy.journal.loadingMore, copy.reflection.states.failed.body]) {
      assert.equal(typeof value, "string");
      assert.ok(!value.includes("'"), value);
      assert.ok(value.length > 3);
    }
    assert.match(copy.reflection.states.failed.body, /Your words are safe/);
    assert.ok(!/notify|email|we.ll send/i.test(copy.reflection.states.failed.body));
  }, { signIn: false });
}

// ================================================================== the Today tab (2026-11-16)
async function todayChecks() {
  await test("today: Listen again plays the newest finished reflection that has audio, and never a heavy moment", async (w) => {
    const selectors = w.use("@/data/selectors");
    const withAudio = (n, extra = {}) =>
      modelOf(w, n, { devotional_audio_path: "user_a/devotionals/" + n + ".wav", devotional_duration_ms: 90_000, ...extra });
    const heavy = withAudio(1, { is_crisis: true });
    const noAudio = modelOf(w, 2);
    const processing = modelOf(w, 3, { processing_status: "processing" });
    const playable = withAudio(4);
    const older = withAudio(5);
    assert.equal(selectors.getListenAgainEntry([heavy, noAudio, processing, playable, older]).id, playable.id, "the newest one that can be played");
    assert.equal(selectors.getListenAgainEntry([noAudio, processing]), null, "nothing to play");
    assert.equal(selectors.getListenAgainEntry([heavy]), null, "a heavy moment is never put on the first screen");
    assert.equal(selectors.getListenAgainEntry([]), null);
    const input = [heavy, playable];
    selectors.getListenAgainEntry(input);
    assert.deepEqual(input, [heavy, playable], "the list is not changed");
  }, { signIn: false });

  await test("today: the words say what you get, in curly punctuation, with no promise, no time and no privacy claim", async (w) => {
    const { copy } = w.use("@/constants/copy");
    const { today } = copy;
    assert.equal(copy.tabs.today, "Today");
    assert.equal(today.hero.title, copy.newEntry.speak.title, "the hero asks what New Entry asks");
    assert.deepEqual(Object.values(today.hero.gets), ["Scripture", "Spoken devotional", "Affirmations"]);
    const hero = [today.hero.title, ...Object.values(today.hero.gets), today.hero.speak, today.hero.speakLabel, today.hero.speakHint, today.hero.write, today.hero.writeLabel, today.hero.writeHint];
    const all = [...hero, today.listenAgain.eyebrow, today.listenAgain.hint, today.word.title, copy.tabs.today, copy.journal.empty.title, copy.journal.empty.body];
    for (const value of all) {
      assert.equal(typeof value, "string");
      assert.ok(value.length > 2, value);
      assert.ok(!value.includes("'") && !value.includes("..."), "typographic punctuation: " + value);
    }
    assert.ok(!/private|confidential|safe|secure|encrypt|guarantee|free|second|minute|will make|will heal|answer/i.test(hero.join(" ")), "the hero promises nothing and names no time");
    assert.equal("action" in copy.journal.empty, false, "the empty list has nothing to press: the hero is the way in");
    assert.equal(today.listenAgain.meta(null, "1:30"), "1:30");
    assert.equal(today.listenAgain.meta("Psalm 4:8", "1:30"), "Psalm 4:8 · 1:30");
    const label = today.listenAgain.label("Rest in Him", "1 minute 30 seconds");
    assert.ok(label.includes("Rest in Him") && label.includes("1 minute 30 seconds") && label.startsWith("Listen again"));
    // the week strip's sentence: the count of days stays in it, a quiet week is just "This week.", and nothing counts what was missed
    assert.equal(today.week.label([], 0), "This week.");
    assert.equal(today.week.label(["Monday", "Thursday"], 1), "This week. You reflected on Monday, Thursday. 1 day of reflection.");
    assert.equal(today.week.label(["Sunday"], 5), "This week. You reflected on Sunday. 5 days of reflection.");
    assert.equal(today.week.label([], 3), "This week. 3 days of reflection.");
    for (const spoken of [today.week.label([], 0), today.week.label(["Monday"], 2)]) {
      assert.ok(!/miss|break|lost|behind|streak|don.t|keep it up|only/i.test(spoken), "no guilt in the strip: " + spoken);
    }
    // the word card: its one button reads the headline and then the verse, and the two actions are named
    assert.equal(today.word.openLabel("Peace surrounds your sleep", "“I will lie down.”"), "Peace surrounds your sleep. “I will lie down.”");
    for (const value of [today.word.openHint, today.word.share, today.word.shareHint]) {
      assert.ok(typeof value === "string" && value.length > 2 && !value.includes("'"), value);
    }
    // the deck of words (2026-11-20): an earlier card's heading names its day and its footer what it is tied to, the link goes
    // back to today, and a screen reader's two actions turn the cards; nothing presses anyone to keep swiping
    assert.equal(today.word.from("Tuesday, Nov 12"), "From Tuesday, Nov 12");
    assert.equal(today.word.tiedTo("yesterday’s prayer"), "Tied to yesterday’s prayer");
    assert.equal(today.word.today, "Today");
    assert.equal(today.word.todayLabel, "Back to today’s word");
    assert.equal(today.word.next, "Next reflection");
    assert.equal(today.word.previous, "Previous reflection");
    const deck = [
      today.word.from("Tuesday, Nov 12"),
      today.word.tiedTo("yesterday’s prayer"),
      today.word.today,
      today.word.todayLabel,
      today.word.next,
      today.word.previous,
    ];
    for (const value of deck) assert.ok(!value.includes("'") && !value.includes("..."), "typographic punctuation: " + value);
    assert.ok(!/miss|streak|don.t|keep|only|left|last chance|hurry|unlock|more to see/i.test(deck.join(" ")), "the deck's words press no one");
  }, { signIn: false });

  await test("today: the deck lays today's word on top, then one word for each earlier finished reflection, newest first, a heavy moment like any other", async (w) => {
    const selectors = w.use("@/data/selectors");
    const mappers = w.use("@/data/mappers");
    const withVerse = { verse_reference: "Psalm 4:8", verse_text: "In peace I will lie down and sleep." };
    // An entry's words, out of order, with a verse only on the one at `verseAt` (if any).
    const wordsOf = (n, verseAt = null) =>
      affirmationRows(serverRow(n).id)
        .map((row) => mappers.toAffirmation(row.position === verseAt ? { ...row, ...withVerse } : row))
        .reverse();
    const entries = [
      modelOf(w, 1),
      modelOf(w, 2),
      modelOf(w, 3),
      modelOf(w, 4, { processing_status: "processing" }),
      modelOf(w, 5, { devotional_script: null }),
      modelOf(w, 6, { is_crisis: true, help_line: "crisis" }),
      modelOf(w, 7),
    ];
    const words = {
      [serverRow(1).id]: wordsOf(1),
      [serverRow(2).id]: wordsOf(2, 2),
      [serverRow(3).id]: wordsOf(3),
      [serverRow(4).id]: wordsOf(4),
      [serverRow(5).id]: wordsOf(5),
      [serverRow(6).id]: wordsOf(6),
    };
    const top = { affirmation: words[serverRow(1).id][2], entry: entries[0], slot: "morning" };
    const before = JSON.stringify({ entries, words });
    assert.deepEqual(selectors.getWordStack(null, entries, words), [], "no word, no deck");
    const cards = selectors.getWordStack(top, entries, words);
    assert.equal(cards[0], top, "today's word on top, as it is");
    assert.deepEqual(cards.map((card) => card.entry.id), [1, 2, 3, 6].map((n) => serverRow(n).id), "the top's own reflection once; one still being made, one with no devotional and one with no words are left out; newest first");
    assert.equal(cards[1].affirmation.position, 2, "a reflection's first word with a verse");
    assert.equal(cards[2].affirmation.position, 1, "or, with no verse, its first word");
    assert.equal(cards[3].entry.isCrisis, true, "a heavy moment is a card like any other");
    assert.deepEqual(Object.keys(cards[3]).sort(), ["affirmation", "entry", "slot"], "with nothing that labels it");
    assert.ok(cards.slice(1).every((card) => card.slot === null), "only today's word was delivered at a slot");
    assert.equal(JSON.stringify({ entries, words }), before, "nothing it was given is changed");
  }, { signIn: false });

  await test("today: the week strip is the last seven days in the profile's time zone, oldest first, today last, and only a finished reflection marks a day", async (w) => {
    const selectors = w.use("@/data/selectors");
    const at = (n, iso, extra = {}) => modelOf(w, n, { created_at: iso, updated_at: iso, ...extra });
    const now = new Date("2026-11-16T12:00:00.000Z"); // a Monday in UTC
    const dots = selectors.getWeekDots([], now, "UTC");
    assert.equal(dots.length, 7);
    assert.deepEqual(dots.map((dot) => dot.key), ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
    assert.deepEqual(dots.map((dot) => dot.letter), ["T", "W", "T", "F", "S", "S", "M"]);
    assert.deepEqual(dots.map((dot) => dot.name), ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Monday"]);
    assert.deepEqual(dots.map((dot) => dot.today), [false, false, false, false, false, false, true]);
    assert.ok(dots.every((dot) => dot.reflected === false), "an empty week marks nothing");

    // a finished reflection marks its day; unfinished ones, a reflection with no devotional (a heavy moment's words only) and
    // other days do not
    const entries = [
      at(1, "2026-11-16T08:00:00.000Z"),
      at(2, "2026-11-14T08:00:00.000Z"),
      at(3, "2026-11-13T08:00:00.000Z", { processing_status: "processing" }),
      at(4, "2026-11-12T08:00:00.000Z", { devotional_script: null }),
      at(5, "2026-11-01T08:00:00.000Z"),
    ];
    const marked = selectors.getWeekDots(entries, now, "UTC").filter((dot) => dot.reflected).map((dot) => dot.key);
    assert.deepEqual(marked, ["2026-11-14", "2026-11-16"]);
    assert.equal(selectors.getWeekDots(entries, now, "UTC").at(-1).reflected && selectors.getWeekDots(entries, now, "UTC").at(-1).today, true, "today can be both");

    // the day is the day on the profile's clock: 23:30 UTC on Sunday is already Monday in Auckland and still Sunday in Pago Pago
    const late = [at(6, "2026-11-15T23:30:00.000Z")];
    assert.deepEqual(selectors.getWeekDots(late, now, "Pacific/Auckland").filter((dot) => dot.reflected).map((dot) => dot.key), ["2026-11-16"]);
    assert.deepEqual(selectors.getWeekDots(late, now, "Pacific/Pago_Pago").filter((dot) => dot.reflected).map((dot) => dot.key), ["2026-11-15"]);
    // and "today" follows that clock too
    assert.equal(selectors.getWeekDots([], new Date("2026-11-16T23:30:00.000Z"), "Pacific/Auckland").at(-1).key, "2026-11-17");
    assert.equal(selectors.getWeekDots([], new Date("2026-11-16T00:30:00.000Z"), "Pacific/Pago_Pago").at(-1).key, "2026-11-15");

    // a month and a year boundary
    const edge = selectors.getWeekDots([], new Date("2027-01-02T12:00:00.000Z"), "UTC");
    assert.deepEqual(edge.map((dot) => dot.key), ["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    // a zone Intl does not know never throws: the phone's own is used
    assert.equal(selectors.getWeekDots([], now, "Not/AZone").length, 7);
    // the list is not changed
    const copyOf = JSON.stringify(entries);
    selectors.getWeekDots(entries, now, "UTC");
    assert.equal(JSON.stringify(entries), copyOf);
  }, { signIn: false });

  await test("today: the screens' source: a new person gets the hero, everyone else the deck of words and the capture bar, the week replaces the tag, no dock, a heavy moment never on the first screen", async () => {
    const read = (file) => fs.readFileSync(path.join(REPO, file), "utf8").replace(/\r\n/g, "\n");
    const has = (haystack, needle, message) => assert.ok(haystack.includes(needle), message + ": " + needle);
    const lacks = (haystack, needle, message) => assert.ok(!haystack.includes(needle), message + ": " + needle);
    const feed = read("src/screens/journal/JournalFeedScreen.tsx");
    has(feed, "const header = (", "the header is always drawn, so the way in does not wait for the data");
    lacks(feed, "const header = ready ?", "the way in is not hidden while the data loads");
    has(feed, "ListHeaderComponent={header}", "the list takes the header as it is");
    has(feed, "const wayIn = hasNoEntries ? (", "the hero only for a person with no reflection; the compact bar for everyone else, loading included");
    has(feed, "<TodayHero", "the hero");
    has(feed, "<CaptureBar", "the capture bar");
    assert.equal(feed.split('onSpeak={() => openNewEntry("speak")}').length - 1, 2, "both open a spoken reflection");
    assert.equal(feed.split('onWrite={() => openNewEntry("write")}').length - 1, 2, "and a written one");
    assert.equal(feed.split("active={focused}").length - 1, 2, "the orb moves only while the tab is in front");
    has(feed, "if (opening.current) {", "a second tap is blocked until New Entry has taken focus");
    has(feed, "const paddingBottom = barClearance + BOTTOM_AIR;", "the content ends above the bar alone");
    lacks(feed, "useTabScreenBottomPadding()", "no room is kept for a dock that is not there");
    has(feed, "getListenAgainEntry(ready.entries)", "the row takes the selector's entry, a heavy moment never");
    has(feed, "onPlay={playEntry}", "a Journal card's play pill and the row share one function");
    has(feed, "onPlay={() => playEntry(listenEntry)}", "the row plays its entry");
    has(feed, "<ScreenHeader title={copy.tabs.today} />", "the header names the tab Today");
    lacks(feed, "copy.journal.empty.action", "the empty list has no button of its own");
    lacks(feed, "images.logoMark", "and no logo circle");
    // the week strip replaced the tag in the greeting
    has(feed, "getWeekDots(ready.entries, ready.now, ready.profile.timezone)", "the strip reads the profile's clock");
    has(feed, "streakDays={ready.reflectionDays}", "the run of days stays, in the spoken sentence");
    has(feed, "const weekDots = getWeekDots(ready.entries, ready.now, ready.profile.timezone);", "the week is worked out once");
    has(feed, "{weekDots.some((dot) => dot.reflected) ? (", "the strip is drawn only once one of its seven days is filled: a blank week is not shown");
    lacks(feed, "{hasNoEntries ? null : (", "it no longer shows seven blank rings to a person who has not reflected this week");
    lacks(feed, "<WeekStrip dots={getWeekDots(", "the strip takes the week already worked out and does not work it out a second time");
    // one rhythm: 24 between the sections, 16 between the greeting and the strip
    has(feed, '<View className="gap-6 pb-6">', "24 between the header's sections");
    has(feed, '<View className="gap-4">\n        <GreetingBlock', "16 between the greeting and the strip");
    lacks(feed, "copy.journal.reflectionDays(", "the tag is gone");
    lacks(feed, "reflectionDays={ready.reflectionDays}", "the greeting no longer takes the count");
    lacks(feed, "chip--terracotta", "and no chip");
    // the deck of words (2026-11-20): today's word on top, one card for each earlier reflection behind it
    lacks(feed, "<AffirmationCard", "the word is a card on the hour's scene now");
    lacks(feed, "<WordCard", "the screen draws the deck, and the deck draws its cards");
    has(feed, "<WordStack", "the deck");
    has(feed, "const cards = getWordStack({ affirmation, entry: source, slot }, ready.entries, ready.words);", "today's word on top, the earlier reflections' words behind it");
    has(feed, "scenes={deckScenes(\n            cards.map((card) => card.entry),\n            getPlayerSceneForHour(ready.now.getHours()),\n          )}", "each card's scene interprets its reflection, the hour's only for a card with none");
    lacks(feed, "scene={getPlayerSceneForHour(", "no card is left on the hour's scene alone");
    has(feed, "pageWidth={width}", "one page for each window width");
    has(feed, "side={sidePadding}", "and the list's side padding around each card");
    has(feed, 'onOpen={(card) => navigation.navigate("Reflection", { entryId: card.affirmation.entryId, tab: "affirmations" })}', "a card opens its own reflection on its Affirmations tab");
    has(feed, "onToggleFavorite={(card) => ready.toggleFavorite(card.affirmation)}", "a card's heart saves its own word");
    has(feed, "onNearEnd={ready.loadMore}", "the deck goes on into the next page of reflections");
    has(feed, "copy.today.word.tiedTo(getAffirmationSource(card.entry.createdAt, ready.now))", "an earlier card with no verse says what it is tied to");
    // Since 2026-11-20 Share sends the card as a picture (supabase/tests/share-card); the verse as text is what it falls back to.
    has(feed, "shareSheet.share(copy.reflection.share.message(quoteVerse(verse.text), verse.reference))", "the text share sends the verse the way Reflection does");
    has(feed, "<ShareSheet text={shareSheet.text} whatsApp={shareSheet.whatsApp} onClose={shareSheet.close} />", "through the share panel");
    has(feed, "    if (!verse) return;\n", "and the screen shares nothing without a verse");
    has(feed, "const asPicture = card.entry !== null && !card.entry.isCrisis;", "a heavy moment's word, and a word whose reflection is not held, keep the text share");
    has(feed, "    if (wordShare.preparing) return;\n    setSharingId(affirmation.id);", "one picture at a time, and the spinner on the card it is for");
    has(feed, "sharing={wordShare.preparing ? sharingId : null}", "only while a picture is being made");
    has(feed, "saveFailed={ready.favoriteFailed}", "a heart that could not be saved says so");
    has(feed, "if (ready && !hasNoEntries) {", "and only a person with a reflection has one");
    const order = ["{greeting}", "<OfflineBanner", "<NoticeBanner", "{wordStack}", "{wayIn}", "<AnalyticsConsentCard", "<ListenAgainCard", "<SectionRow"].map((marker) => {
      const at = feed.indexOf("      " + marker) >= 0 ? feed.indexOf("      " + marker) : feed.indexOf(marker);
      assert.ok(at >= 0, "the header holds " + marker);
      return at;
    });
    assert.deepEqual([...order].sort((a, b) => a - b), order, "greeting and week, status, the word, the way in, consent, listen again, the history");

    const hero = read("src/components/today/TodayHero.tsx");
    has(hero, "const ORB = 104;", "a large target");
    has(hero, 'size={ORB} state="listening" agentTrack={null} micTrack={null}', "the living orb, at rest, listening");
    has(hero, "{active ? <VoiceOrb", "drawn only while the tab is in front");
    has(hero, "const MIC = 34;", "with a white microphone on it");
    has(hero, 'color="white"', "white");
    has(hero, "accessibilityLabel={hero.speakLabel}", "the orb is named");
    assert.equal(hero.split('accessibilityRole="button"').length - 1, 2, "two buttons: the orb and the written way");
    has(hero, "bg-white/25", "the strip's circles are brighter");
    has(hero, "text-white/95", "and so are its labels");
    has(hero, "size={20}", "with larger icons");
    lacks(hero, "bg-white\"", "no white disc under the microphone any more");
    lacks(hero, "usePulse", "and no flat halo: the orb breathes by itself");
    lacks(hero, "HALO", "no halo");
    has(hero, "importantForAccessibility=\"no\"", "the caption under the orb is for the eye, the button already says it");

    const bar = read("src/components/today/CaptureBar.tsx");
    has(bar, "const ORB = 56;", "the same orb, smaller: 56, the size of the dock's pair");
    has(bar, "min-h-[80px]", "80 tall: 12 of padding round a 56 orb");
    has(bar, 'size={ORB} state="listening" agentTrack={null} micTrack={null}', "living");
    has(bar, "{active ? <VoiceOrb", "drawn only while the tab is in front");
    has(bar, "{hero.title}", "the question New Entry asks");
    assert.equal(bar.split('accessibilityRole="button"').length - 1, 2, "two buttons: speak and write, as separate controls");
    has(bar, "accessibilityLabel={hero.writeLabel}", "the pen is named");
    // the pen's circle and the orb are one size from one number, and their glyphs are one size from one number
    lacks(bar, "size-11", "the pen is no longer a smaller circle than the orb");
    assert.equal(bar.split("style={styles.orbArea}").length - 1, 2, "the orb's area and the pen's circle share one style, so they cannot differ");
    has(bar, "orbArea: { width: ORB, height: ORB }", "that style is the orb's size");
    has(bar, "const GLYPH = 26;", "one glyph size");
    assert.equal(bar.split("size={GLYPH}").length - 1, 2, "the microphone and the pen are drawn at that size");

    const strip = read("src/components/today/WeekStrip.tsx");
    has(strip, "accessible accessibilityLabel={copy.today.week.label(reflected, streakDays)}", "one sentence for a screen reader");
    has(strip, 'importantForAccessibility="no-hide-descendants"', "the circles are skipped");
    lacks(strip, "<Pressable", "nothing to press");
    has(strip, "size-[28px]", "28 circles");
    lacks(strip, "size-[30px]", "not the 30 of the first pass");
    has(strip, 'name={icons.sun} size={14} color="white"', "a small white sun on a reflection day");
    has(strip, "border-rose bg-rose/20", "today's empty ring is rose over a faint rose fill");
    has(strip, 'border-plum/40"', "other empty days are a clear ring: plum at 40%, not the petal that vanished on the linen");
    lacks(strip, "border-petal", "no near-invisible ring");
    for (const gone of ["crisis", "text-rosewood", "bg-terracotta", "missed", "console.", "haptics"]) lacks(strip, gone, "no red, no word for a day without a reflection");

    const word = read("src/components/today/WordCard.tsx");
    // The card's measures live in utils/wordCardLayout.ts since 2026-11-20, where the picture of the card reads them too.
    const wordLayout = read("src/utils/wordCardLayout.ts");
    has(word, "paddingTop: WORD_CARD.sceneRoom, paddingHorizontal: WORD_CARD.sidePadding", "the scene stays clear at the top");
    has(wordLayout, "  sceneRoom: 112,", "by 112");
    has(word, "minHeight: WORD_CARD.minHeight,", "the card has a least height, so more of the painting shows");
    has(wordLayout, "  minHeight: 280,", "280");
    has(word, "colors={gradients.wordFade.colors}", "the text sits on the fade");
    // The fade's inner stops are pinned to points (2026-11-21), so a tall card's headline stays on the dense part of it.
    has(word, "locations={wordFadeLocations(height, gradients.wordFade.locations)}", "worked out against the scenes, pinned to points");
    has(word, "onLayout={(event) => setHeight(event.nativeEvent.layout.height)}", "the card's own height pins the fade");
    has(word, "useState<number>(WORD_CARD.minHeight)", "a card not laid out yet has the theme's own stops");
    lacks(word, "locations={gradients.wordFade.locations}", "never the theme's stops stretched over a tall card");
    has(word, "text-[24px] leading-[30px] text-white", "a white headline");
    has(word, "word.openLabel(affirmation.headline, detail)", "the card reads as one button");
    assert.equal(word.split("<Pressable").length - 1, 3, "the card, Share and the heart");
    assert.ok(word.indexOf("</Pressable>") < word.indexOf("{onShare ? ("), "Share and the heart are beside the card's button, never inside it");
    has(word, "onShare: (() => void) | null;", "only a verse is shared");
    has(word, "accessibilityLabel={word.share}", "Share is named");
    has(word, "favorite ? copy.journal.affirmation.unsave : copy.journal.affirmation.save", "the heart says what it does");
    lacks(word, "accessibilityLiveRegion", "the line about a heart that could not be saved is the deck's, under it, once");
    has(word, "width: 44, height: 44", "44 targets");
    // on the top card a screen reader turns the cards with two actions, and only when there is a card that way
    has(word, '...(onNext ? [{ name: "next", label: word.next }] : []),', "Next reflection");
    has(word, '...(onPrevious ? [{ name: "previous", label: word.previous }] : []),', "Previous reflection");
    has(word, "accessibilityActions={turns.length > 0 ? turns : undefined}", "no actions where there is nowhere to turn");
    has(word, 'if (event.nativeEvent.actionName === "next") onNext?.();', "the action turns the card");

    // the deck: three cards show (the top one whole, two peeking out on the right, smaller and dimmed), and a swipe turns one
    // card at a time through the whole history, on the phone's own paging scroll view and the native driver
    const stack = read("src/components/today/WordStack.tsx");
    has(stack, "const STACK_MIN_HEIGHT = 300;", "the deck's least height");
    has(stack, "if (measured > height + 0.5) setHeight(measured);", "which only grows, so nothing under it jumps while the cards turn");
    has(stack, "const measured = event.nativeEvent.layout.height - ROOM_TOP - ROOM_BOTTOM;", "the card's height, without the shadow's room");
    has(stack, "minHeight: height + ROOM_TOP + ROOM_BOTTOM,\n            paddingTop: ROOM_TOP,\n            paddingBottom: ROOM_BOTTOM,", "the scroll view holds that height, with room for the shadow");
    // the shadow's room fits the gaps that are already there (12 under the heading, 24 above the capture bar), and the margins
    // give it back, so nothing on the screen moves
    has(stack, "const ROOM_TOP = 12;\nconst ROOM_BOTTOM = 24;", "room for the shadow: 12 above the cards, 24 under them");
    has(stack, "marginHorizontal: -side, marginTop: -ROOM_TOP, marginBottom: -ROOM_BOTTOM", "given back by negative margins");
    has(stack, 'className="flex-row items-center gap-3" style={styles.heading}', "the heading row over the room");
    has(stack, "heading: { zIndex: 1 },", "so the link back to today keeps its touch area");
    has(feed, "{wordStack}\n      {wayIn}", "the capture bar right under the deck, 24 below it");
    has(feed, '<View className="gap-6 pb-6">', "in the header's 24 gaps");
    has(stack, "const PEEK = 7;\nconst PEEK_NARROW = 5;\nconst NARROW = 360;", "each card behind peeks 7 out, 5 on a narrow phone");
    has(stack, "const SCALES = [1, 0.95, 0.9, 0.85] as const;", "each a little smaller");
    has(stack, "const VEILS = [0, 0.6, 0.8, 0.8] as const;", "and fading toward the page: each strip one even tone, no painting streaks");
    // the wash is what the deck's motion uses: the top card clear, the cards behind washed by depth, the fourth unseen
    has(stack, "outputRange: [VEILS[2], VEILS[1], VEILS[0]],", "a card clears to its painting as it comes to the front");
    has(stack, "veil: VEILS[k],", "and under Reduce Motion each card keeps its depth's wash");
    has(stack, "backgroundColor: colors.linen }", "a linen wash, never a darker shade");
    lacks(stack, "colors.plumDeep", "no plum shade over the cards behind (dark on the top card's dark edge)");
    // each card casts a soft shadow from its own layer, with its corners, so it moves, scales and fades with its card
    has(stack, "lift: { borderRadius: radii.hero, ...shadows.deckCard },", "each card's shadow, with the card's corners");
    has(stack, "styles.card,\n        styles.lift,", "on the card's own moving layer, not inside the clipped card");
    has(stack, "(pageWidth - 2 * side) * ((1 - SCALES[1]) / 2) + (pageWidth < NARROW ? PEEK_NARROW : PEEK)", "the step makes up for the smaller size");
    has(stack, "// Cards held around the top one.\nconst BEFORE = 1;\nconst AFTER = 3;", "a few cards are mounted, the others are empty pages");
    has(stack, "{depth >= -BEFORE && depth <= AFTER ? (", "around the top one");
    has(stack, "    opacity: scrollX.interpolate({ inputRange: [at(3), at(2)], outputRange: [0, 1], extrapolate: \"clamp\" }),", "three show: a fourth fades in only as the top one leaves");
    has(stack, "horizontal\n          pagingEnabled", "the phone's own paging");
    has(stack, "scrollEnabled={cards.length > 1}", "a deck of one does not move");
    has(stack, "removeClippedSubviews={false}", "the cards behind are drawn outside their pages");
    has(stack, "scrollEventThrottle={16}", "every frame");
    has(stack, "Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })", "the scroll drives the cards on the native driver");
    has(stack, "transform: [{ translateX: motion.translateX }, { scale: motion.scale }],", "translate before scale");
    has(stack, "zIndex: cards.length - position", "the top card over the ones behind it");
    has(stack, 'pointerEvents={top ? "auto" : "none"}', "only the top card is touched");
    has(stack, "accessibilityElementsHidden={!top}", "and only the top card is read, on iOS");
    has(stack, 'importantForAccessibility={top ? "auto" : "no-hide-descendants"}', "and on Android");
    has(stack, "onNext={top ? rest.onNext : null}", "the top card's actions turn the deck");
    has(stack, "onNext={position < last ? () => goTo(position + 1, !reduced) : null}", "to the next card, when there is one");
    has(stack, "onPrevious={position > 0 ? () => goTo(position - 1, !reduced) : null}", "and back");
    has(stack, "at === 0 || entry === null ? copy.today.word.title : copy.today.word.from(formatResetDay(entry.createdAt))", "the heading names an earlier card's day");
    has(stack, 'accessibilityRole="header"\n          accessibilityLiveRegion="polite"', "Android hears the heading change");
    has(stack, "useAnnounce(announcement);", "iOS hears the heading and the headline");
    has(stack, "{current > 0 ? (", "the link back to today, away from today's word only");
    has(stack, "accessibilityLabel={copy.today.word.todayLabel}", "named");
    has(stack, "onPress={() => goTo(0, current <= SLIDE_BACK_MAX && !reduced)}", "it slides back from close, and jumps from far");
    has(stack, "const SLIDE_BACK_MAX = 3;", "three cards at most");
    has(stack, "if (target > 0 && target >= cards.length - NEAR_END) actions.onNearEnd();", "close to the end the next page is asked for");
    has(stack, "const NEAR_END = 3;", "three cards from the end");
    has(stack, "if (page === null || Math.abs(page - Math.round(page)) > 0.01) return;", "a drag that stops between pages waits for its momentum");
    has(stack, "scrollRef.current?.scrollTo({ x: current * pageWidth, animated: false });", "the scroll view follows a deck that got shorter");
    // the cards are given the deck's position again whenever they change: on iOS a newly placed card is tied to the scroll
    // only at the next scroll event, so after a reflection was made the cards behind stayed hidden until a pan (2026-11-20)
    has(stack, 'const cardKey = cards.map((card) => card.affirmation.id).join(" ");', "the cards, by their words");
    has(stack, "    scrollX.setValue(shownAt.current * pageWidth);\n  }, [cardKey, current, pageWidth, side, reduced, scrollX]);", "set the deck's position whenever the cards, the top card or the layout change");
    has(stack, "    if (moving.current) {\n      resyncLater.current = true;\n      return;\n    }", "never while a finger or a slide moves the deck");
    has(stack, "onScrollBeginDrag={onDragStart}", "a drag is a move");
    has(stack, "if (animated && target !== shownAt.current) moving.current = true;", "and so is a slide the deck asks for");
    has(stack, "    shownAt.current = Math.round(page);\n    stopped();\n    settle(Math.round(page));\n  };\n  const onScrollEnd", "a drag that stops on a page ends the move");
    has(stack, "    shownAt.current = Math.round(page);\n    stopped();\n    settle(Math.round(page));\n  };\n\n  const onLayout", "and so does the end of a slide");
    has(stack, "    moving.current = false;\n    if (!resyncLater.current) return;\n    resyncLater.current = false;\n    scrollX.setValue(shownAt.current * pageWidth);", "a resync that waited is done once the deck stops, at its page");
    {
      const resync = stack.indexOf("const cardKey = ");
      const follow = stack.indexOf("scrollRef.current?.scrollTo({ x: current * pageWidth, animated: false });");
      assert.ok(follow > 0 && resync > follow, "the resync runs after the scroll view is brought to the top card's page");
    }
    has(stack, "const current = Math.min(index, Math.max(last, 0));", "a card deleted under the top one does not leave the deck empty");
    has(stack, "scene={scenes[position] ?? scenes[0] ?? 0}", "each card takes the scene chosen for its own reflection");
    has(stack, "? () => actions.onShare(item, scenes[position] ?? scenes[0] ?? 0)", "and Share draws the card with that same painting");
    lacks(stack, "% playerScenes.length", "the cards no longer cycle through the scenes in turn");
    has(stack, "item.affirmation.verse\n                        ? () =>", "only a verse is shared");
    has(stack, "sharing={sharing === item.affirmation.id}", "the spinner on the card being shared, not on all of them");
    has(stack, "  if (reduced) {", "under Reduce Motion");
    has(stack, "      scale: SCALES[k],", "the cards behind do not grow");
    has(stack, "      opacity: k >= 3 ? 0 : 1,", "and none fades");
    has(stack, '<Text accessibilityLiveRegion="polite" className="text-body-sm text-rosewood">\n          {copy.journal.affirmation.saveError}', "a heart that could not be saved says so, under the deck");
    for (const gone of ["react-native-gesture-handler", "react-native-reanimated", "PanResponder", "listener:", "useNativeDriver: false"]) {
      lacks(stack, gone, "the deck is the scroll view and the native driver, with no gesture library and no JavaScript in each frame");
    }
    for (const [name, source] of [["TodayHero", hero], ["CaptureBar", bar], ["WeekStrip", strip], ["WordCard", word], ["WordStack", stack]]) {
      for (const gone of ["haptics", "console.", "track(", "from \"@/services/analytics\""]) lacks(source, gone, name + " makes no haptic, event or log line");
    }
    const theme = read("src/constants/theme.ts");
    has(theme, "locations: [0, 0.26, 0.4, 0.54, 1],", "the fade's stops");
    has(
      theme,
      "deckCard: {\n    boxShadow: [\n      { offsetX: 0, offsetY: 6, blurRadius: 16, color: `${colors.ink}24` },\n      { offsetX: 0, offsetY: 1, blurRadius: 4, color: `${colors.ink}38` },\n    ],\n  },",
      "the deck's shadow: soft (ink 14%, 6 down, blur 16) over a contact edge (ink 22%, 1 down, blur 4), inside its room (10 above, 22 under)",
    );

    const card = read("src/components/today/ListenAgainCard.tsx");
    assert.equal(card.split("<Pressable").length - 1, 1, "the row is one button");
    has(card, "formatDurationSpoken(durationMs)", "a screen reader hears the length in words");
    lacks(card, "haptics", "the row makes no haptic");
    // a quiet row: 60 tall, a 40 play circle, a hairline border and no shadow, so it stays under the word card and the capture bar
    has(card, "card min-h-[60px] flex-row items-center gap-3 px-3 py-2.5", "a 60 dp row");
    has(card, "size-10 items-center justify-center rounded-full bg-plum", "with a 40 play circle");
    lacks(card, "shadows.card", "no shadow");
    lacks(card, "p-3.5", "not the 80 dp card");
    assert.equal(card.split("numberOfLines={1}").length - 1, 2, "the title and the line under it are each one line");

    const dock = read("src/components/GracehushTabBar.tsx");
    has(dock, 'TABS_WITHOUT_DOCK: readonly (keyof MainTabParamList)[] = ["Journal", "Scholar"]', "the dock is hidden where a screen has its own way in");
    has(dock, "label: copy.tabs.today", "the first tab is called Today");
    has(dock, 'ios: "sun.max"', "with a sun");
    const tabs = read("src/navigation/MainTabs.tsx");
    has(tabs, 'initialRouteName="Journal"', "the route keeps its name");
    has(tabs, '<Tab.Screen name="Journal" component={JournalFeedScreen} />', "so navigation and analytics keep working");
  });
}

(async () => {
  await gatewayChecks();
  await queryChecks();
  await liveChecks();
  await repositoryChecks();
  await processorChecks();
  await engineChecks();
  await journalChecks();
  await reflectionChecks();
  await timestampChecks();
  await selectorChecks();
  await copyChecks();
  await todayChecks();
  finished = true;
  console.log(`${passed} checks passed${failures.length > 0 ? `, ${failures.length} FAILED` : ""}`);
  if (failures.length > 0) {
    console.log(failures.map((failure) => `  FAIL ${failure}`).join("\n"));
    process.exit(1);
  }
})().catch((error) => {
  console.log("THE RUN CRASHED", error);
  process.exit(1);
});

process.on("exit", (code) => {
  if (!finished && code === 0) {
    console.log("THE RUN ENDED BEFORE ITS SUMMARY: a promise was never settled");
    process.exitCode = 1;
  }
});
