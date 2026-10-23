import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { bibleTiming, clearChapterCache } from "../../_shared/bible/helloao.ts";
import type { EntryRow } from "../lifecycle.ts";

// An offline world for the tests: a stand-in for Clerk's key set, Gemini, the Bible API, PostgREST and Storage that is
// installed as `globalThis.fetch`. The real handler, the real jose and the real supabase-js run unchanged on top of it, so a test
// sees the same requests the hosted function would send.
//
// The fake database enforces what the step 18 migration enforces for these tables (check constraints, the unique keys,
// the foreign keys, the crisis trigger) and refuses a column that does not exist, so a wrong column name fails here.

export const ISSUER = "https://clerk.test";
export const SUPABASE_URL = "https://project.supabase.test";
export const GEMINI_HOST = "generativelanguage.googleapis.com";
export const BIBLE_HOST = "bible.helloao.org";

type Row = Record<string, unknown>;

export type Recorded = { method: string; url: URL; headers: Headers; text: string; json: unknown };

export type GeminiReply =
  | { kind: "json"; status: number; body: unknown; delayMs?: number }
  | { kind: "network" }
  // Never answers; the request ends when its AbortSignal fires (our own timeout).
  | { kind: "hang" };

// What the Bible API answers for one chapter, keyed "PHP/4". A chapter with no entry is served from the real chapters in
// _shared/bible/fixtures (404 when there is no fixture for it).
export type BibleReply =
  | { kind: "status"; status: number }
  | { kind: "json"; body: unknown }
  | { kind: "network" }
  | { kind: "hang" };

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "ins_test", alg: "RS256", use: "sig" };

// For a test that needs a token token() cannot make (for example one with no expiry).
export const privateTestKey = privateKey;

const ENV = {
  CLERK_ISSUER: ISSUER,
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL: "gemini-test-model",
  SUPABASE_URL,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_test_key" }),
};

const ENTRY_DEFAULTS = (): Row => ({
  client_entry_id: null,
  input_type: null,
  transcript: null,
  audio_path: null,
  processing_status: "pending",
  error_code: null,
  is_crisis: false,
  dominant_emotion: null,
  scripture_reference: null,
  scripture_text: null,
  scripture_verified: false,
  devotional_title: null,
  devotional_script: null,
  closing_prayer: null,
  devotional_audio_path: null,
  devotional_duration_ms: null,
  is_active_prayer: false,
  is_answered: false,
  answered_at: null,
  answered_notes: null,
  prayer_title: null,
  prayer_category: null,
  prayer_summary: null,
});

const COLUMNS: Record<string, string[]> = {
  users_profile: ["id", "created_at", "subscription_tier"],
  journal_entries: ["id", "user_id", "created_at", "updated_at", ...Object.keys(ENTRY_DEFAULTS())],
  daily_affirmations: [
    "id",
    "user_id",
    "entry_id",
    "time_slot",
    "headline",
    "affirmation_text",
    "is_delivered",
    "is_favorite",
    "scheduled_for",
    "created_at",
  ],
};

const CATEGORIES = [
  "FAMILY & HEALING",
  "VOCATION & CALLING",
  "INNER PEACE",
  "RELATIONSHIPS",
  "PROVISION",
  "GUIDANCE",
];

class PgError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export type World = {
  users: Row[];
  entries: Row[];
  affirmations: Row[];
  storage: Map<string, Uint8Array>;
  requests: Recorded[];
  // The reflection's requests (and a replacement passage's) and their replies. The crisis screening's requests are kept
  // apart, so a test can say how many of each were made; a screening request is told apart by the `risk` in its schema.
  geminiCalls: Recorded[];
  geminiQueue: GeminiReply[];
  // When this is empty a screening request is answered "clear" (see defaultScreenReply), so a test only queues what it
  // is about.
  screenCalls: Recorded[];
  screenQueue: GeminiReply[];
  // Every model request in the order it was made: "screening" or "reflection" (a replacement passage is a reflection).
  callOrder: ("screening" | "reflection")[];
  bible: Map<string, BibleReply>;
  bibleCalls: Recorded[];
  logs: string[];
  now(): string;
  token(claims?: Row, options?: { expiresIn?: number; kid?: string }): Promise<string>;
  seedUser(id: string): void;
  seedEntry(fields: Row): EntryRow;
  restore(): void;
};

function isoNow(): string {
  return new Date().toISOString();
}

function jsonResponse(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function check(table: string, row: Row, world: World, isInsert: boolean): void {
  const fail = (code: string, message: string): never => {
    throw new PgError(code === "23505" || code === "23503" ? 409 : 400, code, message);
  };
  if (table === "journal_entries") {
    if (!["text", "audio"].includes(String(row.input_type))) fail("23514", "journal_entries_input_type_check");
    if (!["pending", "uploading", "processing", "ready", "failed"].includes(String(row.processing_status))) {
      fail("23514", "journal_entries_status_check");
    }
    if (row.prayer_category !== null && !CATEGORIES.includes(String(row.prayer_category))) {
      fail("23514", "journal_entries_prayer_category_check");
    }
    if (typeof row.prayer_summary === "string" && row.prayer_summary.length > 200) {
      fail("23514", "journal_entries_prayer_summary_check");
    }
    if (row.is_crisis === true) {
      for (
        const column of [
          "devotional_title",
          "devotional_script",
          "closing_prayer",
          "devotional_audio_path",
          "scripture_reference",
          "scripture_text",
        ]
      ) {
        if (row[column] !== null) fail("23514", "journal_entries_crisis_check");
      }
      if (
        row.is_active_prayer === true || row.is_answered === true || row.prayer_title !== null ||
        row.prayer_category !== null || row.prayer_summary !== null
      ) fail("23514", "crisis_not_prayer");
    }
    if (row.is_answered !== (row.answered_at !== null)) fail("23514", "answered_fields_match");
    if (row.scripture_verified === true && (row.scripture_reference === null || row.scripture_text === null)) {
      fail("23514", "scripture_verified_check");
    }
    if (!world.users.some((user) => user.id === row.user_id)) fail("23503", "journal_entries_user_id_fkey");
    const clash = world.entries.some((other) =>
      other.id !== row.id && row.client_entry_id !== null &&
      other.user_id === row.user_id && other.client_entry_id === row.client_entry_id
    );
    if (clash) fail("23505", "journal_entries_client_entry_key");
  }
  if (table === "daily_affirmations") {
    if (!["morning", "afternoon", "evening"].includes(String(row.time_slot))) {
      fail("23514", "daily_affirmations_time_slot_check");
    }
    for (const column of ["headline", "affirmation_text", "user_id", "entry_id"]) {
      if (typeof row[column] !== "string") fail("23502", `${column} is null`);
    }
    const entry = world.entries.find((candidate) => candidate.id === row.entry_id && candidate.user_id === row.user_id);
    if (!entry) fail("23503", "daily_affirmations_entry_user_fkey");
    if (isInsert && entry?.is_crisis === true) fail("23514", "a crisis entry never has affirmations");
    const clash = world.affirmations.some((other) =>
      other.id !== row.id && other.entry_id === row.entry_id && other.time_slot === row.time_slot
    );
    if (clash) fail("23505", "daily_affirmations_entry_slot_key");
  }
}

type Filter = { column: string; op: string; value: string };

function filtersOf(url: URL): Filter[] {
  const reserved = new Set(["select", "on_conflict", "columns", "order", "limit", "offset"]);
  const filters: Filter[] = [];
  for (const [column, spec] of url.searchParams) {
    if (reserved.has(column)) continue;
    const dot = spec.indexOf(".");
    filters.push({ column, op: spec.slice(0, dot), value: spec.slice(dot + 1) });
  }
  return filters;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(({ column, op, value }) => {
    const cell = row[column] === null || row[column] === undefined ? null : String(row[column]);
    if (op === "eq") return cell === value;
    if (op === "neq") return cell !== value;
    if (op === "lt") return cell !== null && cell < value;
    if (op === "gte") return cell !== null && cell >= value;
    throw new Error(`fake PostgREST: operator "${op}" is not supported`);
  });
}

function prefer(request: Recorded): Set<string> {
  return new Set((request.headers.get("prefer") ?? "").split(",").map((part) => part.trim()).filter(Boolean));
}

function rest(world: World, table: string, request: Recorded): Response {
  const columns = COLUMNS[table];
  if (!columns) throw new PgError(404, "PGRST205", `Could not find the table '${table}' in the schema cache`);
  const rows = table === "users_profile"
    ? world.users
    : table === "journal_entries"
    ? world.entries
    : world.affirmations;
  const filters = filtersOf(request.url);
  const wants = prefer(request);
  const representation = wants.has("return=representation");

  const unknownColumns = (record: Row) => {
    for (const key of Object.keys(record)) {
      if (!columns.includes(key)) {
        throw new PgError(400, "PGRST204", `Could not find the '${key}' column of '${table}' in the schema cache`);
      }
    }
  };

  if (request.method === "GET" || request.method === "HEAD") {
    for (const { column } of filters) {
      if (!columns.includes(column)) throw new PgError(400, "42703", `column ${table}.${column} does not exist`);
    }
    const found = rows.filter((row) => matches(row, filters));
    const headers: Record<string, string> = {};
    if (wants.has("count=exact")) {
      headers["Content-Range"] = found.length === 0 ? "*/0" : `0-${found.length - 1}/${found.length}`;
    }
    return request.method === "HEAD"
      ? new Response(null, { status: 200, headers })
      : jsonResponse(200, found.map((row) => ({ ...row })), headers);
  }

  if (request.method === "POST") {
    const incoming = (Array.isArray(request.json) ? request.json : [request.json]) as Row[];
    const created: Row[] = [];
    const ignore = wants.has("resolution=ignore-duplicates");
    const conflictColumns = (request.url.searchParams.get("on_conflict") ?? "").split(",").filter(Boolean);
    for (const record of incoming) {
      unknownColumns(record);
      if (ignore && conflictColumns.length > 0) {
        const exists = rows.some((row) => conflictColumns.every((column) => row[column] === record[column]));
        if (exists) continue;
      }
      const now = world.now();
      let row: Row;
      if (table === "users_profile") row = { created_at: now, subscription_tier: "free", ...record };
      else if (table === "journal_entries") {
        row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...ENTRY_DEFAULTS(), ...record };
      } else {
        row = {
          id: crypto.randomUUID(),
          is_delivered: false,
          is_favorite: false,
          scheduled_for: null,
          created_at: now,
          ...record,
        };
      }
      if (table === "users_profile" && rows.some((other) => other.id === row.id)) {
        throw new PgError(409, "23505", "users_profile_pkey");
      }
      check(table, row, world, true);
      rows.push(row);
      created.push(row);
    }
    return representation ? jsonResponse(201, created.map((row) => ({ ...row }))) : new Response(null, { status: 201 });
  }

  if (request.method === "PATCH") {
    unknownColumns(request.json as Row);
    const targets = rows.filter((row) => matches(row, filters));
    const updated = targets.map((row) => ({ ...row, ...(request.json as Row), updated_at: world.now() }));
    for (const next of updated) check(table, next, world, false);
    targets.forEach((row, index) => Object.assign(row, updated[index]));
    return representation ? jsonResponse(200, updated.map((row) => ({ ...row }))) : new Response(null, { status: 204 });
  }

  if (request.method === "DELETE") {
    for (const row of rows.filter((candidate) => matches(candidate, filters))) rows.splice(rows.indexOf(row), 1);
    return new Response(null, { status: 204 });
  }

  throw new Error(`fake PostgREST: ${request.method} is not supported`);
}

export function geminiOk(output: unknown, usage = { in: 321, out: 654, thought: 87 }, delayMs = 0): GeminiReply {
  return {
    kind: "json",
    status: 200,
    delayMs,
    body: {
      id: "int_test",
      status: "completed",
      steps: [{
        type: "model_output",
        status: "done",
        content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
      }],
      usage: {
        total_input_tokens: usage.in,
        total_output_tokens: usage.out,
        total_thought_tokens: usage.thought,
        total_tokens: usage.in + usage.out + usage.thought,
      },
    },
  };
}

export function geminiError(
  status: number,
  body: unknown = { error: { code: status, message: "x", status: "UNAVAILABLE" } },
): GeminiReply {
  return { kind: "json", status, body };
}

// The crisis screening's request is the only one whose schema has a `risk`.
function isScreeningRequest(json: unknown): boolean {
  const body = json as { response_format?: { schema?: { properties?: Record<string, unknown> } } } | null;
  const properties = body?.response_format?.schema?.properties;
  return properties !== undefined && "risk" in properties;
}

// What the screening answers when a test has not queued a reply: clear. A recording is "heard" as SPOKEN.
function defaultScreenReply(json: unknown): GeminiReply {
  const audio = Array.isArray((json as { input?: unknown } | null)?.input);
  return geminiOk(screenOutput(audio ? { transcript: SPOKEN } : {}));
}

// The real chapter from _shared/bible/fixtures, or a 404 when there is none (the API answers 404 for a chapter it lacks).
function bibleFixture(key: string): BibleReply {
  try {
    const path = new URL(`../../_shared/bible/fixtures/${key.replace("/", "_")}.simple.json`, import.meta.url);
    return { kind: "json", body: JSON.parse(Deno.readTextFileSync(path)) };
  } catch {
    return { kind: "status", status: 404 };
  }
}

export function installWorld(): World {
  const original = globalThis.fetch;
  const saved: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(ENV)) {
    saved[name] = Deno.env.get(name);
    Deno.env.set(name, value);
  }
  const originalLog = console.log;
  const savedBibleTiming = { ...bibleTiming };
  bibleTiming.retryDelayMs = 1;
  bibleTiming.requestTimeoutMs = 300;
  clearChapterCache();

  const world: World = {
    users: [],
    entries: [],
    affirmations: [],
    storage: new Map(),
    requests: [],
    geminiCalls: [],
    geminiQueue: [],
    screenCalls: [],
    screenQueue: [],
    callOrder: [],
    bible: new Map(),
    bibleCalls: [],
    logs: [],
    now: isoNow,
    async token(claims = {}, options = {}) {
      const seconds = Math.floor(Date.now() / 1000);
      return await new SignJWT({ sid: "sess_test", role: "authenticated", ...claims })
        .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "ins_test", typ: "JWT" })
        .setIssuer(ISSUER)
        .setSubject(typeof claims.sub === "string" ? claims.sub : "user_test")
        .setIssuedAt(seconds)
        .setNotBefore(seconds - 1)
        .setExpirationTime(seconds + (options.expiresIn ?? 60))
        .sign(privateKey);
    },
    seedUser(id) {
      if (!world.users.some((user) => user.id === id)) {
        world.users.push({ id, created_at: world.now(), subscription_tier: "free" });
      }
    },
    seedEntry(fields) {
      const now = world.now();
      const row: Row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...ENTRY_DEFAULTS(), ...fields };
      world.seedUser(String(row.user_id));
      world.entries.push(row);
      return row as unknown as EntryRow;
    },
    restore() {
      globalThis.fetch = original;
      console.log = originalLog;
      Object.assign(bibleTiming, savedBibleTiming);
      clearChapterCache();
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    },
  };

  console.log = (...args: unknown[]) => {
    world.logs.push(args.map(String).join(" "));
  };

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON.
    }
    const recorded: Recorded = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      text,
      json,
    };
    const { url } = recorded;

    if (url.origin === ISSUER) return jsonResponse(200, { keys: [publicJwk] });

    if (url.host === GEMINI_HOST) {
      const screening = isScreeningRequest(json);
      (screening ? world.screenCalls : world.geminiCalls).push(recorded);
      world.callOrder.push(screening ? "screening" : "reflection");
      const reply = (screening ? world.screenQueue : world.geminiQueue).shift() ??
        (screening ? defaultScreenReply(json) : undefined);
      if (!reply) throw new Error("the test queued no Gemini reply");
      if (reply.kind === "network") throw new TypeError("network down");
      if (reply.kind === "hang") {
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      return jsonResponse(reply.status, reply.body);
    }

    if (url.host === BIBLE_HOST) {
      world.bibleCalls.push(recorded);
      const key = url.pathname.slice("/api/BSB/".length, -".simple.json".length);
      const reply = world.bible.get(key) ?? bibleFixture(key);
      if (reply.kind === "network") throw new TypeError("network down");
      if (reply.kind === "hang") {
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return reply.kind === "status"
        ? new Response("Bible API error", { status: reply.status })
        : jsonResponse(200, reply.body);
    }

    if (url.origin === SUPABASE_URL) {
      world.requests.push(recorded);
      try {
        if (url.pathname.startsWith("/rest/v1/")) return rest(world, url.pathname.slice("/rest/v1/".length), recorded);
        if (url.pathname.startsWith("/storage/v1/object/journal_media/")) {
          const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/journal_media/".length));
          const bytes = world.storage.get(path);
          return bytes
            ? new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "audio/mp4" } })
            : jsonResponse(400, { statusCode: "404", error: "not_found", message: "Object not found" });
        }
      } catch (error) {
        if (error instanceof PgError) return jsonResponse(error.status, { code: error.code, message: error.message });
        throw error;
      }
    }
    throw new Error(`the test world has no route for ${url.origin}${url.pathname}`);
  };

  return world;
}

// Words that make a valid devotional (about 120 words): enough for the 80 to 260 word rule.
const DEVOTIONAL = Array.from(
  { length: 6 },
  (_, index) =>
    `Paragraph ${
      index + 1
    } holds a quiet thought about rest and trust that lasts for a good number of gentle words, spoken slowly and kindly so that the person who hears it can breathe again.`,
).join("\n\n");

export function readyOutput(overrides: Row = {}): Row {
  return {
    is_crisis: false,
    dominant_emotion: "anxious",
    reflection_title: "Peace in the Waiting",
    scripture: { book_id: "PHP", chapter: 4, verse_start: 6, verse_end: 7 },
    devotional_text: DEVOTIONAL,
    closing_prayer:
      "Lord, we bring you the weight of this week and ask for your quiet peace to settle on our hearts. Amen.",
    prayer: {
      is_active_prayer: true,
      title: "Peace for the week",
      summary: "Peace and steadiness for a heavy week.",
      category: "INNER PEACE",
    },
    affirmations: [
      { time_slot: "morning", headline: "You are held", text: "Begin the day knowing you are held." },
      { time_slot: "afternoon", headline: "Rest is allowed", text: "Pause and breathe; the work will wait." },
      { time_slot: "evening", headline: "It is enough", text: "You did what you could today." },
    ],
    ...overrides,
  };
}

// What the fake recording "says" when a test does not queue a screening reply of its own.
export const SPOKEN = "I have been carrying a lot this week.";

// The crisis screening's reply (_shared/safety/screen.ts): by default a clear written entry. A recording's reply has
// `transcript` set.
export function screenOutput(overrides: Row = {}): Row {
  return { no_speech: false, transcript: "", risk: "none", categories: [], ...overrides };
}

// A reflection request that comes back flagged as a crisis (the last of the three layers).
export function crisisOutput(): Row {
  return {
    is_crisis: true,
    dominant_emotion: "weary",
    reflection_title: null,
    scripture: null,
    devotional_text: null,
    closing_prayer: null,
    prayer: { is_active_prayer: false, title: "", summary: "", category: "NONE" },
    affirmations: [],
  };
}

// Every request the function sent about a user's own tables carried that user's id: a filter on reads, updates and
// deletes, a column on inserts. Returns the requests that did not.
export function unscopedRequests(world: World, userId: string): string[] {
  const offenders: string[] = [];
  for (const request of world.requests) {
    const table = request.url.pathname.startsWith("/rest/v1/") ? request.url.pathname.slice("/rest/v1/".length) : "";
    if (table !== "journal_entries" && table !== "daily_affirmations") continue;
    if (request.method === "POST") {
      const rows = (Array.isArray(request.json) ? request.json : [request.json]) as Row[];
      if (!rows.every((row) => row.user_id === userId)) offenders.push(`${request.method} ${table}`);
    } else if (request.url.searchParams.get("user_id") !== `eq.${userId}`) {
      offenders.push(`${request.method} ${table}${request.url.search}`);
    }
  }
  return offenders;
}

export const TEXT = "I have been so anxious about work this week and I can not seem to rest.";
export const ENTRY_ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

export async function post(world: World, handle: (req: Request) => Promise<Response>, body: unknown, options: {
  token?: string | null;
  sub?: string;
  method?: string;
  headers?: Record<string, string>;
  raw?: string;
} = {}): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...options.headers };
  const token = options.token === undefined ? await world.token({ sub: options.sub ?? "user_test" }) : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return await handle(
    new Request("https://project.supabase.test/functions/v1/process-entry", {
      method: options.method ?? "POST",
      headers,
      body: options.method === "GET" ? undefined : (options.raw ?? JSON.stringify(body)),
    }),
  );
}
