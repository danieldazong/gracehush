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

  await test("entries: the affirmations of an entry carry the six columns the app shows and no more, and another user's are never returned", async (w) => {
    seedServer(w, 2);
    w.server.state.affirmations.push(...affirmationRows(serverRow(99).id, "user_b"));
    const remote = w.use("@/data/entriesRemote");
    const result = await remote.selectAffirmations(serverRow(1).id);
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 3);
    assert.deepEqual(Object.keys(result.data[0]).sort(), ["affirmation_text", "entry_id", "headline", "id", "is_favorite", "time_slot"]);
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
      const end = types.indexOf("};", row);
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

  await test("processor: the overlay's steps follow the usual time (4 s, 12 s) and stop when the answer comes", async (w) => {
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
    await advance(3900);
    assert.deepEqual(stages, ["receiving"]);
    await advance(200);
    assert.deepEqual(stages, ["receiving", "reflecting"]);
    await advance(7800);
    assert.deepEqual(stages, ["receiving", "reflecting"]);
    await advance(300);
    assert.deepEqual(stages, ["receiving", "reflecting", "preparing"]);
    release();
    assert.equal((await run).ok, true);
    await advance(60_000);
    assert.deepEqual(stages, ["receiving", "reflecting", "preparing"], "no step after the answer");
    assert.equal([...W.clock.timers.values()].filter((t) => t.ms === 4000 || t.ms === 12000).length, 0, "the step timers are cleared");

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

  await test("engine: a crisis answer is cached as it is, with no affirmations, and logged like any other", async (w) => {
    w.server.state.makeEntry = crisisResult;
    await w.startEngine();
    const engine = w.use("@/services/syncEngine");
    await w.use("@/db/outbox").enqueue(text("c1", "words that mean a crisis"));
    const result = await engine.syncAndWait("c1", { waitMs: 60_000 });
    assert.deepEqual({ kind: result.kind, isCrisis: result.isCrisis }, { kind: "ready", isCrisis: true });
    const cache = w.use("@/db/cache");
    assert.equal((await cache.getEntry(result.entryId)).isCrisis, true);
    assert.deepEqual(await cache.listAffirmationsForEntry(result.entryId), []);
    assert.ok(w.logs.every((line) => !/crisis/i.test(line)), "the app logs nothing about a crisis entry");
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

  await test("engine: a database from step 24 (version 1) is upgraded to version 2 with its rows and its key kept", async (w) => {
    const database = w.use("@/db/database");
    const outbox = w.use("@/db/outbox");
    await outbox.enqueue(text("c1"));
    await outbox.enqueue(audio("a1"));
    const db = database.getDb();
    await db.execAsync("ALTER TABLE outbox DROP COLUMN uploaded");
    await db.execAsync("PRAGMA user_version = 1");
    await database.closeUserDatabase();
    await database.openUserDatabase("user_a");
    assert.equal((await database.getDb().getFirstAsync("PRAGMA user_version")).user_version, 2);
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
    offlineStore.getState().setSavedNote("retry");
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
    Object.assign(w.server.state.entries[0], serverRow(1, { updated_at: stamp(BASE + 6_000) }));
    await advance(5_000);
    state = await until(handle, (s) => s.status === "ready" && s.entry.status === "ready", "the finished entry");
    assert.equal(state.entry.devotional.title, "Title 1");
    const done = reads();
    await advance(60_000);
    assert.equal(reads(), done, "a finished entry is not read again");
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

  await test("reflection: no confirmation is asked for a verified passage, a crisis entry, an unfinished one, the mock data, or while offline", async (w) => {
    seedServer(w, 4, (n) => {
      if (n === 2) return { is_crisis: true, scripture_verified: false, scripture_text: null };
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
    assert.equal(confirm.needsScriptureConfirmation({ ...model, isCrisis: true }), false);
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

  await test("selectors: the newest finished entry that is not a crisis, or none", async (w) => {
    const selectors = w.use("@/data/selectors");
    const crisis = modelOf(w, 1, { is_crisis: true });
    const processing = modelOf(w, 2, { processing_status: "processing" });
    const ready1 = modelOf(w, 3);
    const ready2 = modelOf(w, 4);
    assert.equal(selectors.getNewestReadyEntry([crisis, processing, ready1, ready2]).id, ready1.id);
    assert.equal(selectors.getNewestReadyEntry([crisis, processing]), null);
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
