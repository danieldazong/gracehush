// Fakes for the step 25 checks. The app's real Supabase client (supabase-js) runs against a fake server that answers what Supabase
// answers: PostgREST for journal_entries and daily_affirmations (filters, order, limit, the explicit column list, the count
// header, row level security by token, and the one column grant of the app), and the two Edge Functions with scripted answers.
// Under it are the fakes of step 24 (SQLite over node:sqlite, AES, the keychain, NetInfo, AppState, the recordings folder), the
// virtual clock, and a tiny React with the pieces zustand and the app's hooks use. The app's real api, data, db, services,
// stores and hooks run on top.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// The app reads these by their full names when its env module loads, so they come first.
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://abcdefghij.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_testkey";
const PUBLISHABLE_KEY = "sb_publishable_testkey";

const REPO = process.env.GRACEHUSH_REPO ?? path.resolve(__dirname, "..", "..", "..");
process.env.GRACEHUSH_REPO = REPO;
const { makeEnv } = require("../profile-sync/loader.cjs");
const offline = require("../offline/world.cjs");
const recording = require("../recording/world.cjs");

const { installClock, uninstallClock, clock } = offline;
const realSetImmediate = setImmediate;

// The loader transpiles every module again for every world, and a run makes about a hundred worlds. The source does not change
// during a run, so the output is remembered (by file and by text, so an edited file is never served from here).
{
  const ts = require(path.join(REPO, "node_modules", "typescript"));
  const transpileModule = ts.transpileModule;
  const remembered = new Map();
  ts.transpileModule = (source, options) => {
    const key = `${options?.fileName ?? ""}\u0000${source}`;
    let result = remembered.get(key);
    if (result === undefined) {
      result = transpileModule(source, options);
      remembered.set(key, result);
    }
    return result;
  };
}

// ------------------------------------------------------------------ a fixed Date under the virtual clock
// installClock replaces Date.now only; `new Date()` would still read the real clock. This makes both agree.
const RealDate = Date;
class VirtualDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(clock.now);
    else super(...args);
  }
  static now() {
    return clock.now;
  }
}
function installVirtualDate() {
  globalThis.Date = VirtualDate;
}
function uninstallVirtualDate() {
  globalThis.Date = RealDate;
}

// ------------------------------------------------------------------ settling: promises, then the real event loop
// A Response body, a SQLite call and a fetch all finish on the real event loop as well as in microtasks, so a check that
// waits for the app to settle yields to setImmediate between rounds. Timers stay virtual.
async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}
async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) {
    await flush();
    await new Promise((resolve) => realSetImmediate(resolve));
  }
}
// Runs every virtual timer that falls due in the next `ms` milliseconds, in order, letting the app settle after each.
async function advance(ms) {
  await settle(2);
  const end = clock.now + ms;
  for (;;) {
    let next = null;
    for (const [id, timer] of clock.timers) {
      if (timer.at <= end && (next === null || timer.at < next.timer.at)) next = { id, timer };
    }
    if (next === null) break;
    clock.now = Math.max(clock.now, next.timer.at);
    if (next.timer.repeat) next.timer.at += next.timer.ms;
    else clock.timers.delete(next.id);
    next.timer.fn();
    await settle(3);
  }
  clock.now = end;
  await settle(3);
}

// ------------------------------------------------------------------ React: the hooks of makeReact, plus what zustand needs
// One instance for the whole run: zustand keeps the first React it loads, so a patch of the module loader gives it this one.
// Hooks called outside a render throw, as in React.
function makeHooks() {
  const { react, renderHook } = recording.makeReact();
  react.useSyncExternalStore = (subscribe, getSnapshot) => {
    const [, force] = react.useState(0);
    const latest = react.useRef(undefined);
    const value = getSnapshot();
    latest.current = value;
    react.useEffect(
      () =>
        subscribe(() => {
          if (!Object.is(getSnapshot(), latest.current)) force((n) => n + 1);
        }),
      [subscribe],
    );
    return value;
  };
  react.useDebugValue = () => undefined;
  return { react, renderHook };
}

const shared = makeHooks();
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "react") return shared.react;
  return originalLoad.call(this, request, parent, isMain);
};

// ------------------------------------------------------------------ rows and responses
const BASE = Date.parse("2026-10-25T12:00:00Z");
const pad = (n) => String(n).padStart(12, "0");
const SLOTS = ["morning", "afternoon", "evening"];
// PostgREST writes a timestamptz as ISO text with microseconds and +00:00.
const stamp = (ms) => new RealDate(ms).toISOString().replace(".000Z", ".123456+00:00").replace(/Z$/, "+00:00");

const fixtures = JSON.parse(
  fs.readFileSync(path.join(REPO, "supabase", "functions", "process-entry", "fixtures", "parity.json"), "utf8"),
);

// A row of journal_entries as the server stores it (every column). n = 1 is the newest, one minute before BASE.
function serverRow(n, extra = {}) {
  const created = stamp(BASE - n * 60_000);
  return {
    id: `00000000-0000-4000-8000-${pad(n)}`,
    user_id: "user_a",
    client_entry_id: `c0000000-0000-4000-8000-${pad(n)}`,
    created_at: created,
    updated_at: created,
    input_type: "text",
    transcript: `the words of entry ${n}`,
    audio_path: null,
    processing_status: "ready",
    error_code: null,
    is_crisis: false,
    dominant_emotion: "anxious",
    scripture_reference: "Psalm 23:1",
    scripture_text: "The LORD is my shepherd; I shall not want.",
    scripture_verified: true,
    devotional_title: `Title ${n}`,
    devotional_script: `The devotional of entry ${n}.`,
    closing_prayer: "Lord, hear us",
    devotional_audio_path: null,
    devotional_duration_ms: null,
    is_active_prayer: false,
    is_answered: false,
    answered_at: null,
    answered_notes: null,
    prayer_title: null,
    prayer_category: null,
    prayer_summary: null,
    ...extra,
  };
}

function affirmationRows(entryId, userId = "user_a") {
  return SLOTS.map((slot) => ({
    id: `aff-${entryId.slice(-12)}-${slot}`,
    entry_id: entryId,
    user_id: userId,
    time_slot: slot,
    headline: `Headline ${slot}`,
    affirmation_text: `Text ${slot}`,
    is_favorite: false,
    is_delivered: false,
    scheduled_for: null,
    created_at: "2026-10-25T00:00:00+00:00",
  }));
}

// The response process-entry gives for a finished reflection (the app's own models), and the rows it saved.
function readyResult(request, userId = "user_a", n = 900) {
  const row = serverRow(n, {
    user_id: userId,
    client_entry_id: request.clientEntryId,
    input_type: request.inputType,
    transcript: request.inputType === "text" ? request.text : "what was said",
    created_at: stamp(clock.now),
    updated_at: stamp(clock.now),
  });
  const affirmations = affirmationRows(row.id, userId);
  const entry = {
    id: row.id,
    clientEntryId: row.client_entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inputType: row.input_type,
    transcript: row.transcript,
    dominantEmotion: "anxious",
    status: "ready",
    isCrisis: false,
    scripture: { reference: row.scripture_reference, text: row.scripture_text, translation: "BSB", verified: true },
    devotional: { title: row.devotional_title, script: row.devotional_script, closingPrayer: row.closing_prayer, audioPath: null, durationMs: null },
    prayer: null,
    failureCode: null,
    isLocalOnly: false,
  };
  const response = {
    entry,
    affirmations: affirmations.map((a) => ({
      id: a.id,
      entryId: a.entry_id,
      slot: a.time_slot,
      headline: a.headline,
      text: a.affirmation_text,
      isFavorite: false,
    })),
  };
  return { row, affirmations, response };
}

function crisisResult(request, userId = "user_a", n = 901) {
  const row = serverRow(n, {
    user_id: userId,
    client_entry_id: request.clientEntryId,
    input_type: request.inputType,
    transcript: request.inputType === "text" ? request.text : "what was said",
    is_crisis: true,
    dominant_emotion: null,
    scripture_reference: null,
    scripture_text: null,
    scripture_verified: false,
    devotional_title: null,
    devotional_script: null,
    closing_prayer: null,
    created_at: stamp(clock.now),
    updated_at: stamp(clock.now),
  });
  const entry = {
    id: row.id,
    clientEntryId: row.client_entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inputType: row.input_type,
    transcript: row.transcript,
    dominantEmotion: null,
    status: "ready",
    isCrisis: true,
    scripture: null,
    devotional: null,
    prayer: null,
    failureCode: null,
    isLocalOnly: false,
  };
  return { row, affirmations: [], response: { entry, affirmations: [] } };
}

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const fnError = (status, code) => json(status, { error: { code, message: "A fixed message", requestId: "req-1" } });
const limitBody = (entryId, resetsAt) => ({
  error: { code: "LIMIT_REACHED", message: "A fixed message", requestId: "req-1" },
  entryId,
  usage: { used: 3, limit: 3, resetsAt },
});

// ------------------------------------------------------------------ the fake server
function withAbort(signal, promise) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function makeServer() {
  const state = {
    entries: [],
    affirmations: [],
    requests: [],
    // Everything the app sent that the real database or the platform would refuse, or that breaks a rule of AGENTS.md.
    violations: [],
    tokens: { tokA: "user_a", tokB: "user_b" },
    offline: false,
    // A promise every request waits for: holds the network until a check releases it.
    gate: null,
    // Queues of answers for the two functions: (call) => Response | Promise<Response>. An empty queue answers "finished".
    functions: { "process-entry": [], "confirm-scripture": [] },
    functionCalls: [],
    // Answers for the REST tables: the next request of that table is answered with this instead (a Response, or a function).
    rest: { journal_entries: [], daily_affirmations: [] },
    // What a process-entry call with no scripted answer makes of the entry.
    makeEntry: readyResult,
  };

  function applyFilters(rows, params) {
    let out = rows;
    for (const [key, value] of params) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      const m = /^(eq|neq|lt|lte|gt|gte|in)\.(.*)$/s.exec(value);
      if (!m) throw new Error(`the fake server does not know the filter ${key}=${value}`);
      const [, op, operand] = m;
      out = out.filter((row) => {
        const cell = row[key];
        if (op === "eq") return String(cell) === operand;
        if (op === "neq") return String(cell) !== operand;
        if (op === "in") return operand.replace(/^\(|\)$/g, "").split(",").includes(String(cell));
        if (op === "lt") return cell < operand;
        if (op === "lte") return cell <= operand;
        if (op === "gt") return cell > operand;
        return cell >= operand;
      });
    }
    return out;
  }

  function project(rows, selectParam, table) {
    if (selectParam === null) return rows;
    const columns = selectParam.split(",").map((c) => c.trim());
    if (columns.includes("*")) state.violations.push(`select * on ${table}`);
    if (table === "journal_entries" && columns.includes("audio_path")) state.violations.push("audio_path was selected");
    if (columns.includes("user_id")) state.violations.push(`user_id was selected on ${table}`);
    return rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]])));
  }

  async function rest(table, method, url, headers, body, sub) {
    const params = [...url.searchParams.entries()];
    if (!params.some(([k, v]) => k === "user_id" && v === `eq.${sub}`)) state.violations.push(`no user filter on ${table}`);
    const visible = state[table === "journal_entries" ? "entries" : "affirmations"].filter((row) => row.user_id === sub);
    const matched = applyFilters(visible, params);
    if (method === "GET") {
      const rows = [...matched];
      if (url.searchParams.get("order") === "created_at.desc") {
        rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
      }
      const total = rows.length;
      const limit = url.searchParams.get("limit");
      const page = limit === null ? rows : rows.slice(0, Number(limit));
      const result = project(page, url.searchParams.get("select"), table);
      const counted = (headers.prefer ?? "").includes("count=exact");
      const range = total === 0 ? "*/0" : `0-${page.length - 1}/${total}`;
      return json(200, result, counted ? { "content-range": range } : {});
    }
    if (method === "PATCH" && table === "daily_affirmations") {
      const extra = Object.keys(body ?? {}).filter((key) => key !== "is_favorite");
      if (extra.length > 0) {
        state.violations.push(`grant: ${extra.join(", ")}`);
        return json(403, { code: "42501", message: "permission denied for table daily_affirmations", details: null, hint: null });
      }
      matched.forEach((row) => Object.assign(row, body));
      if ((headers.prefer ?? "").includes("return=representation")) {
        return json(200, project(matched, url.searchParams.get("select"), table));
      }
      return new Response(null, { status: 204 });
    }
    state.violations.push(`${method} ${table}`);
    return json(405, { message: "the fake server does not answer this" });
  }

  async function fake(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const rawHeaders = init.headers instanceof Headers ? [...init.headers.entries()] : Object.entries(init.headers ?? {});
    const headers = Object.fromEntries(rawHeaders.map(([k, v]) => [k.toLowerCase(), v]));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    state.requests.push({ method, path: url.pathname, search: url.search, headers, body });
    if (state.offline) throw new TypeError("Network request failed");
    if (headers.apikey !== PUBLISHABLE_KEY) state.violations.push("the publishable key was not sent as apikey");
    const bearer = (headers.authorization ?? "").replace(/^Bearer /, "");
    if (bearer === PUBLISHABLE_KEY) state.violations.push("the publishable key was sent as the bearer token");
    await withAbort(init.signal, state.gate ?? Promise.resolve());
    const sub = state.tokens[bearer];
    if (url.pathname.startsWith("/functions/v1/")) {
      const name = url.pathname.slice("/functions/v1/".length);
      if (!sub) return fnError(401, "UNAUTHORIZED");
      const call = { name, headers, body, sub };
      state.functionCalls.push(call);
      const next = state.functions[name]?.shift();
      if (next !== undefined) return withAbort(init.signal, Promise.resolve(next(call)));
      if (name === "process-entry") {
        const made = state.makeEntry(body, sub);
        state.entries.push(made.row);
        state.affirmations.push(...made.affirmations);
        return json(200, made.response);
      }
      return json(200, { scripture: null });
    }
    if (!sub) return json(401, { code: "PGRST301", message: "JWT invalid", details: null, hint: null });
    for (const table of ["journal_entries", "daily_affirmations"]) {
      if (url.pathname === `/rest/v1/${table}`) {
        const scripted = state.rest[table].shift();
        if (scripted !== undefined) return withAbort(init.signal, Promise.resolve(typeof scripted === "function" ? scripted() : scripted));
        return rest(table, method, url, headers, body, sub);
      }
    }
    return json(404, { message: "the fake server has no such route" });
  }

  return { fake, state };
}

// ------------------------------------------------------------------ the upload (services/mediaUpload)
function makeUpload() {
  const upload = { calls: [], script: [] };
  upload.module = {
    __esModule: true,
    rawRecordingPath: (userId, clientEntryId) => `${userId}/raw/${clientEntryId}.m4a`,
    uploadRawRecording: async (audio, userId) => {
      upload.calls.push({ id: audio.clientEntryId, uri: audio.uri, userId });
      const next = upload.script.shift();
      if (next === undefined) return { ok: true, path: `${userId}/raw/${audio.clientEntryId}.m4a` };
      return typeof next === "function" ? next(audio) : next;
    },
  };
  return upload;
}

// ------------------------------------------------------------------ one world per check
function makeLiveWorld({ userId = "user_a", token = "tokA", tier = "free" } = {}) {
  const sqlite = offline.makeSqlite();
  const secure = offline.makeSecureStore();
  const net = offline.makeNetInfo();
  const appState = recording.makeAppState();
  const recordings = offline.makeRecordings();
  recordings.module.recordingUri = (clientEntryId) => `file:///recordings/${clientEntryId}.m4a`;
  const server = makeServer();
  const upload = makeUpload();
  // How many rows of the read cache were opened (decrypted): a screen must not open the whole cache to show one page.
  const counts = { decrypts: 0 };
  const crypto = offline.makeCrypto();
  const decrypt = crypto.aesDecryptAsync;
  crypto.aesDecryptAsync = async (...args) => {
    counts.decrypts += 1;
    return decrypt(...args);
  };
  const { react, renderHook } = shared;
  const realFetch = globalThis.fetch;
  globalThis.fetch = server.fake;
  const fakes = {
    "expo-sqlite": sqlite.module,
    "expo-crypto": crypto,
    "expo-secure-store": secure.module,
    "@react-native-community/netinfo": net.module,
    "react-native": appState.module,
    "@/services/recordingFiles": recordings.module,
    "@/services/mediaUpload": upload.module,
    "@react-navigation/native": { useFocusEffect: (effect) => react.useEffect(() => effect(), [effect]) },
    react,
  };
  const env = makeEnv({ fakes });
  const logs = [];
  const real = { log: console.log, info: console.info, warn: console.warn };
  console.log = console.info = console.warn = (...args) => void logs.push(args.map(String).join(" "));
  const world = {
    env,
    use: (spec) => env.use(spec),
    sqlite,
    secure,
    net,
    appState,
    recordings,
    server,
    upload,
    counts,
    renderHook,
    logs,
    userId,
    // The signed-in session and the user's own database, as the auth bridge sets them up, with the profile the first sync
    // would have saved (so Profile data opens at once, as it does after the first launch).
    async signIn({ id = userId, getToken = async () => token, plan = tier } = {}) {
      const prefs = env.use("@/store/profilePrefsStore").useProfilePrefsStore;
      await prefs.persist.rehydrate();
      await env.use("@/store/onboardingStore").useOnboardingStore.persist.rehydrate();
      prefs.getState().saveSnapshot(id, {
        createdAt: "2026-10-01T12:00:00.000Z",
        subscriptionTier: plan,
        syncedAt: new RealDate(clock.now).toISOString(),
        affirmationsEnabled: true,
        ambientSound: "off",
        ambientVolume: 0.5,
      });
      env.use("@/services/supabaseClient").setSupabaseSession({ userId: id, getToken });
      await env.use("@/db/database").openUserDatabase(id);
      env.use("@/store/offlineStore").useOfflineStore.getState().setDatabase("ready");
    },
    // The sync engine, started the way the auth bridge starts it.
    async startEngine(id = userId) {
      await env.use("@/services/offlineSession").startOfflineSession(id);
      await settle();
    },
    close() {
      try {
        env.use("@/services/syncEngine").stopSyncEngine();
      } catch {
        // The module was never loaded in this world.
      }
      globalThis.fetch = realFetch;
      console.log = real.log;
      console.info = real.info;
      console.warn = real.warn;
      sqlite.cleanup();
    },
  };
  return world;
}

module.exports = {
  makeLiveWorld,
  makeServer,
  serverRow,
  affirmationRows,
  readyResult,
  crisisResult,
  fnError,
  limitBody,
  json,
  stamp,
  fixtures,
  shared,
  installVirtualDate,
  uninstallVirtualDate,
  installClock,
  uninstallClock,
  clock,
  advance,
  flush,
  settle,
  makeEnv,
  BASE,
  PUBLISHABLE_KEY,
};
