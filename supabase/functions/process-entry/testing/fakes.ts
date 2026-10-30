import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { bibleTiming, clearChapterCache } from "../../_shared/bible/helloao.ts";
import { clearTokenCache } from "../../_shared/tts/googleAuth.ts";
import { ttsTiming } from "../../_shared/tts/synthesize.ts";
import { makeServiceAccount, synthOk, tokenOk } from "../../_shared/tts/testing.ts";
import { speechTiming } from "../constants.ts";
import type { EntryRow } from "../lifecycle.ts";

// An offline world for the tests: a stand-in for Clerk's key set, Gemini, the Bible API, Google (its token endpoint and
// Text-to-Speech), PostgREST and Storage that is installed as `globalThis.fetch`. The real handler, the real jose and the
// real supabase-js run unchanged on top of it, so a test sees the same requests the hosted function would send.
//
// The fake database enforces what the step 18 migration enforces for these tables (check constraints, the unique keys,
// the foreign keys, the crisis trigger) and refuses a column that does not exist, so a wrong column name fails here.

export const ISSUER = "https://clerk.test";
export const SUPABASE_URL = "https://project.supabase.test";
export const GEMINI_HOST = "generativelanguage.googleapis.com";
export const BIBLE_HOST = "bible.helloao.org";
export const GOOGLE_TOKEN_HOST = "oauth2.googleapis.com";
export const GOOGLE_TTS_HOST = "texttospeech.googleapis.com";
export const REVENUECAT_HOST = "api.revenuecat.com";
export const CLERK_API_HOST = "api.clerk.com";

type Row = Record<string, unknown>;

export type Recorded = { method: string; url: URL; headers: Headers; text: string; json: unknown };

export type GeminiReply =
  | { kind: "json"; status: number; body: unknown; delayMs?: number }
  | { kind: "network" }
  // Never answers; the request ends when its AbortSignal fires (our own timeout).
  | { kind: "hang" };

// Google's replies have the same three shapes.
export type GoogleReply = GeminiReply;

// A real WAV (_shared/tts/fixtures: Cloud Text-to-Speech's own LINEAR16 answer, 24 kHz mono 16-bit, "Amen."), which a
// synthesize request is answered with unless a test queued something else. Its length, by ffprobe and by wavDuration.ts, is
// FIXTURE_WAV_MS.
export const FIXTURE_WAV = Deno.readFileSync(
  new URL("../../_shared/tts/fixtures/a-24k-mono-amen.wav", import.meta.url),
);
export const FIXTURE_WAV_MS = 1282;

// What the journal_media bucket accepts (step 18, and audio/wav since the 2026-10-24 migration): these types, and files up
// to 25 MiB.
const BUCKET_MIME_TYPES = ["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav"];
const BUCKET_MAX_BYTES = 26_214_400;
// The exports bucket (step 31): ZIP files only, up to the project's 50 MB upload limit (the dashboard counts a megabyte as
// 1,048,576 bytes).
export const EXPORTS_MAX_BYTES = 52_428_800;
// What Storage's list reports as created_at for a journal_media file a test put there by hand.
export const MEDIA_CREATED_AT = "2026-10-01T09:00:00.000Z";

// The speech secrets of the test world: a real RSA key in a service account (so the sign-in signs for real), made once.
const SPEECH_ACCOUNT = await makeServiceAccount();
export const SPEECH_VOICE = "en-US-Chirp3-HD-Aoede";
export const SPEECH_EMAIL = SPEECH_ACCOUNT.account.clientEmail;
const SPEECH_NAMES = ["GOOGLE_TTS_CREDENTIALS_B64", "TTS_VOICE_NAME", "TTS_SPEAKING_RATE"];

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
  // Billing (step 30): the V1 secret key, and the webhook's Authorization value and signing secret.
  REVENUECAT_SECRET_API_KEY: "sk_test_billing_key",
  REVENUECAT_WEBHOOK_AUTH: "test-webhook-auth",
  REVENUECAT_WEBHOOK_SIGNING_SECRET: "test-signing-secret",
  // Account deletion (step 31): the Clerk instance's secret key, for its Backend API.
  CLERK_SECRET_KEY: "sk_test_clerk_backend_key",
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
  users_profile: [
    "id",
    "created_at",
    "subscription_tier",
    "timezone",
    "subscription_expires_at",
    "subscription_synced_at",
  ],
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
  deleted_devotionals: ["entry_id", "user_id", "made_at", "deleted_at"],
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
  // Google, for the speech step (step 22). A token request is answered with a fresh token ("ya29.test-1", "-2"...) unless
  // tokenQueue holds a reply, and a synthesize request with FIXTURE_WAV unless ttsQueue does.
  tokenCalls: Recorded[];
  tokenQueue: GoogleReply[];
  ttsCalls: Recorded[];
  ttsQueue: GoogleReply[];
  // Every file the function uploaded to journal_media, as storage-js sent it (the bytes are in `storage`).
  uploads: { path: string; contentType: string; upsert: boolean; cacheControl: string }[];
  // delete-entry (step 29b): the server-only record of devotionals that were deleted, every Storage removal as the paths storage-js
  // sent it, and calls to fail on purpose (each counter is how many more calls of that kind will fail, one after another).
  deletedDevotionals: Row[];
  removals: string[][];
  // Calls to fail on purpose (each counter is how many more calls of that kind will fail, one after another). Step 31 added
  // storageList (a folder listing in any bucket), storageSign (a signed link), exportUpload (a ZIP into the exports bucket),
  // profileDelete (deleting a users_profile row) and rowsRead (reading journal_entries or daily_affirmations); storageRemove
  // covers every bucket since then.
  fail: {
    storageRemove: number;
    recordDeleted: number;
    deleteEntry: number;
    profileUpdate: number;
    storageList: number;
    storageSign: number;
    exportUpload: number;
    profileDelete: number;
    rowsRead: number;
  };
  // RevenueCat (step 30): GET /v1/subscribers/{id} with a secret key. A queued reply answers first; otherwise the customer
  // stored here for that app user id (200), or, as the real API does for an id it has never seen, a new empty customer (201).
  // DELETE /v1/subscribers/{id} (step 31) removes the stored customer (200), or answers 404 when there is none.
  revenuecat: Map<string, Row>;
  revenuecatQueue: GeminiReply[];
  revenuecatCalls: Recorded[];
  // The exports bucket (step 31): the ZIPs export-data wrote, with the time each was made (what Storage's list reports as
  // created_at). Its uploads and removals are kept apart from journal_media's (`uploads`, `removals`).
  exports: Map<string, { bytes: Uint8Array; createdAt: string }>;
  exportUploads: { path: string; contentType: string; upsert: boolean }[];
  exportRemovals: string[][];
  // Every Storage request of step 31's kinds, as storage-js sent it: folder listings, signed links and files read.
  lists: { bucket: string; prefix: string; limit: number; offset: number }[];
  signs: { bucket: string; path: string; expiresIn: number }[];
  downloads: string[];
  // Clerk's Backend API (step 31): GET and DELETE /v1/users/{id} with the instance's secret key. The users that exist are the
  // ids in clerkUsers; a queued reply answers first. A well-formed secret key of another instance finds nobody (404).
  clerkUsers: Set<string>;
  clerkQueue: GeminiReply[];
  clerkCalls: Recorded[];
  // False makes deleting a profile leave its entries, affirmations and records behind: a cascade that did not happen.
  cascade: boolean;
  logs: string[];
  // The database's clock: every call gives a later time than the one before, to the millisecond, so that two rows never
  // share a created_at (the real database hands out a distinct time to each insert).
  now(): string;
  token(claims?: Row, options?: { expiresIn?: number; kid?: string }): Promise<string>;
  seedUser(id: string): void;
  seedEntry(fields: Row): EntryRow;
  restore(): void;
};

let lastClockMs = 0;
function isoNow(): string {
  lastClockMs = Math.max(Date.now(), lastClockMs + 1);
  return new Date(lastClockMs).toISOString();
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
  if (table === "deleted_devotionals") {
    for (const column of ["entry_id", "user_id", "made_at"]) {
      if (typeof row[column] !== "string") fail("23502", `${column} is null`);
    }
    if (!world.users.some((user) => user.id === row.user_id)) fail("23503", "deleted_devotionals_user_id_fkey");
    if (world.deletedDevotionals.some((other) => other.entry_id === row.entry_id)) {
      fail("23505", "deleted_devotionals_pkey");
    }
  }
}

type Filter = { column: string; op: string; value: string; negate: boolean };

// PostgREST writes a filter as `column=op.value`, and a negated one as `column=not.op.value` (`not.is.null`).
function filtersOf(url: URL): Filter[] {
  const reserved = new Set(["select", "on_conflict", "columns", "order", "limit", "offset"]);
  const filters: Filter[] = [];
  for (const [column, spec] of url.searchParams) {
    if (reserved.has(column)) continue;
    const negate = spec.startsWith("not.");
    const rest = negate ? spec.slice(4) : spec;
    const dot = rest.indexOf(".");
    filters.push({ column, op: rest.slice(0, dot), value: rest.slice(dot + 1), negate });
  }
  return filters;
}

// The operators are compared as text, which is exact for the ISO timestamps and the ids the function filters on. As in
// SQL, a comparison with a null cell is not true (`is` is the way to ask about null).
function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(({ column, op, value, negate }) => {
    const cell = row[column] === null || row[column] === undefined ? null : String(row[column]);
    let found: boolean;
    if (op === "eq") found = cell === value;
    else if (op === "neq") found = cell !== null && cell !== value;
    else if (op === "is") found = value === "null" ? cell === null : cell === value;
    else if (op === "lt") found = cell !== null && cell < value;
    else if (op === "lte") found = cell !== null && cell <= value;
    else if (op === "gt") found = cell !== null && cell > value;
    else if (op === "gte") found = cell !== null && cell >= value;
    else throw new Error(`fake PostgREST: operator "${op}" is not supported`);
    return negate ? !found : found;
  });
}

// PostgREST's `order=created_at.asc,id.asc`: compared as text, which is exact for the ISO timestamps and the ids used here.
function sortRows(rows: Row[], order: string): Row[] {
  const keys = order.split(",").map((part) => {
    const [column, direction] = part.split(".");
    return { column, sign: direction === "desc" ? -1 : 1 };
  });
  return [...rows].sort((a, b) => {
    for (const { column, sign } of keys) {
      const left = String(a[column] ?? "");
      const right = String(b[column] ?? "");
      if (left !== right) return left < right ? -sign : sign;
    }
    return 0;
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
    : table === "deleted_devotionals"
    ? world.deletedDevotionals
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
    if (
      request.method === "GET" && world.fail.rowsRead > 0 &&
      (table === "journal_entries" || table === "daily_affirmations")
    ) {
      world.fail.rowsRead -= 1;
      throw new PgError(500, "XX000", "the rows could not be read");
    }
    for (const { column } of filters) {
      if (!columns.includes(column)) throw new PgError(400, "42703", `column ${table}.${column} does not exist`);
    }
    const order = request.url.searchParams.get("order");
    const found = order === null
      ? rows.filter((row) => matches(row, filters))
      : sortRows(rows.filter((row) => matches(row, filters)), order);
    // `.range(from, to)` is sent as offset and limit (step 31 pages through a person's rows).
    const offset = Number(request.url.searchParams.get("offset") ?? 0);
    const limit = request.url.searchParams.get("limit");
    const page = limit === null ? found.slice(offset) : found.slice(offset, offset + Number(limit));
    const headers: Record<string, string> = {};
    if (wants.has("count=exact")) {
      headers["Content-Range"] = page.length === 0
        ? `*/${found.length}`
        : `${offset}-${offset + page.length - 1}/${found.length}`;
    }
    return request.method === "HEAD"
      ? new Response(null, { status: 200, headers })
      : jsonResponse(200, page.map((row) => ({ ...row })), headers);
  }

  if (request.method === "POST") {
    if (table === "deleted_devotionals" && world.fail.recordDeleted > 0) {
      world.fail.recordDeleted -= 1;
      throw new PgError(500, "XX000", "the record could not be written");
    }
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
      if (table === "users_profile") {
        row = {
          created_at: now,
          subscription_tier: "free",
          timezone: "UTC",
          subscription_expires_at: null,
          subscription_synced_at: null,
          ...record,
        };
      } else if (table === "journal_entries") {
        row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...ENTRY_DEFAULTS(), ...record };
      } else if (table === "deleted_devotionals") {
        row = { deleted_at: now, ...record };
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
    if (table === "users_profile" && world.fail.profileUpdate > 0) {
      world.fail.profileUpdate -= 1;
      throw new PgError(500, "XX000", "the profile could not be updated");
    }
    unknownColumns(request.json as Row);
    const targets = rows.filter((row) => matches(row, filters));
    const updated = targets.map((row) => ({ ...row, ...(request.json as Row), updated_at: world.now() }));
    for (const next of updated) check(table, next, world, false);
    targets.forEach((row, index) => Object.assign(row, updated[index]));
    return representation ? jsonResponse(200, updated.map((row) => ({ ...row }))) : new Response(null, { status: 204 });
  }

  if (request.method === "DELETE") {
    if (table === "journal_entries" && world.fail.deleteEntry > 0) {
      world.fail.deleteEntry -= 1;
      throw new PgError(500, "XX000", "the row could not be deleted");
    }
    if (table === "users_profile" && world.fail.profileDelete > 0) {
      world.fail.profileDelete -= 1;
      throw new PgError(500, "XX000", "the profile could not be deleted");
    }
    const removed = rows.filter((candidate) => matches(candidate, filters));
    for (const row of removed) rows.splice(rows.indexOf(row), 1);
    // The affirmations of a deleted entry go with it (the foreign key's on delete cascade, step 18).
    if (table === "journal_entries") {
      const gone = new Set(removed.map((row) => row.id));
      const kept = world.affirmations.filter((affirmation) => !gone.has(affirmation.entry_id));
      world.affirmations.splice(0, world.affirmations.length, ...kept);
    }
    // A deleted profile takes everything of its user with it (each table's user_id foreign key, on delete cascade): the
    // entries, the affirmations and the records of deleted devotionals. world.cascade false is a cascade that did not happen.
    if (table === "users_profile" && world.cascade) {
      const gone = new Set(removed.map((row) => row.id));
      for (const list of [world.entries, world.affirmations, world.deletedDevotionals]) {
        const kept = list.filter((row) => !gone.has(row.user_id));
        list.splice(0, list.length, ...kept);
      }
    }
    // Like PostgREST: the deleted rows come back when the request asks for them.
    return representation ? jsonResponse(200, removed.map((row) => ({ ...row }))) : new Response(null, { status: 204 });
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

// Plays one queued reply as the network would: a connection that fails, a call that never answers (it ends when the
// request's own timeout aborts it), or an answer, after its delay if it has one.
async function play(reply: GeminiReply, request: Request): Promise<Response> {
  if (reply.kind === "network") throw new TypeError("network down");
  if (reply.kind === "hang") {
    return await new Promise<Response>((_resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }
  if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
  return jsonResponse(reply.status, reply.body);
}

// A file sent to journal_media. storage-js sends a Uint8Array as a plain POST that carries its type, its cache time and
// x-upsert in headers. The bucket refuses a type it does not list, a file over its limit, and a path that is taken when
// the upload does not say it may replace it (the answers are the real ones: a 400 whose body says 409 for a duplicate).
function upload(world: World, path: string, headers: Headers, bytes: Uint8Array): Response {
  const contentType = headers.get("content-type") ?? "";
  if (!BUCKET_MIME_TYPES.includes(contentType)) {
    return jsonResponse(415, {
      statusCode: "415",
      error: "invalid_mime_type",
      message: `mime type ${contentType} is not supported`,
    });
  }
  if (bytes.length > BUCKET_MAX_BYTES) {
    return jsonResponse(413, {
      statusCode: "413",
      error: "Payload too large",
      message: "The object exceeded the maximum allowed size",
    });
  }
  const upsert = headers.get("x-upsert") === "true";
  if (world.storage.has(path) && !upsert) {
    return jsonResponse(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
  }
  world.storage.set(path, bytes);
  world.uploads.push({
    path,
    contentType,
    upsert,
    cacheControl: (headers.get("cache-control") ?? "").replace("max-age=", ""),
  });
  return jsonResponse(200, { Id: crypto.randomUUID(), Key: `journal_media/${path}` });
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

// storage-js remove(): DELETE /object/{bucket} with { prefixes }. Storage answers with the objects it removed; a path that is not
// there is simply not in the answer, and that is not an error.
function removeObjects(world: World, bucket: string, request: Recorded): Response {
  if (world.fail.storageRemove > 0) {
    world.fail.storageRemove -= 1;
    return jsonResponse(500, { statusCode: "500", error: "Internal", message: "the files could not be removed" });
  }
  const prefixes = (request.json as { prefixes?: unknown } | null)?.prefixes;
  if (!Array.isArray(prefixes) || !prefixes.every((path) => typeof path === "string")) {
    return jsonResponse(400, { statusCode: "400", error: "Bad Request", message: "prefixes must be a list of paths" });
  }
  // The real Storage API takes at most 1,000 paths in one request.
  if (prefixes.length > 1000) {
    return jsonResponse(400, { statusCode: "400", error: "Bad Request", message: "too many paths" });
  }
  (bucket === "exports" ? world.exportRemovals : world.removals).push([...prefixes]);
  const removed = prefixes.filter((path) =>
    bucket === "exports" ? world.exports.delete(path) : world.storage.delete(path)
  );
  return jsonResponse(200, removed.map((name) => ({ name, bucket_id: bucket })));
}

// The files of a bucket as Storage's list sees them: each path with its size, its type and when it was made.
function bucketFiles(world: World, bucket: string): Map<string, { size: number; mimetype: string; createdAt: string }> {
  const files = new Map<string, { size: number; mimetype: string; createdAt: string }>();
  if (bucket === "exports") {
    for (const [path, file] of world.exports) {
      files.set(path, { size: file.bytes.length, mimetype: "application/zip", createdAt: file.createdAt });
    }
  } else {
    for (const [path, bytes] of world.storage) {
      const mimetype = path.endsWith(".wav") ? "audio/wav" : path.endsWith(".mp3") ? "audio/mpeg" : "audio/mp4";
      files.set(path, { size: bytes.length, mimetype, createdAt: MEDIA_CREATED_AT });
    }
  }
  return files;
}

// storage-js list(prefix, { limit, offset }): POST /object/list/{bucket}. Like the real API it answers one level of the folder
// at a time, sorted by name: a file with its id and metadata, a sub-folder as an entry whose id and metadata are null.
function listObjects(world: World, bucket: string, json: unknown): Response {
  if (world.fail.storageList > 0) {
    world.fail.storageList -= 1;
    return jsonResponse(500, { statusCode: "500", error: "Internal", message: "the folder could not be listed" });
  }
  const body = (json ?? {}) as { prefix?: unknown; limit?: unknown; offset?: unknown };
  const prefix = typeof body.prefix === "string" ? body.prefix.replace(/\/+$/, "") : "";
  const limit = typeof body.limit === "number" ? body.limit : 100;
  const offset = typeof body.offset === "number" ? body.offset : 0;
  world.lists.push({ bucket, prefix, limit, offset });
  const children = new Map<string, Row>();
  for (const [path, file] of bucketFiles(world, bucket)) {
    if (prefix !== "" && !path.startsWith(`${prefix}/`)) continue;
    const rest = prefix === "" ? path : path.slice(prefix.length + 1);
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      const name = rest.slice(0, slash);
      children.set(name, {
        name,
        id: null,
        updated_at: null,
        created_at: null,
        last_accessed_at: null,
        metadata: null,
      });
    } else {
      children.set(rest, {
        name: rest,
        id: crypto.randomUUID(),
        updated_at: file.createdAt,
        created_at: file.createdAt,
        last_accessed_at: file.createdAt,
        metadata: { size: file.size, mimetype: file.mimetype, cacheControl: "max-age=3600", httpStatusCode: 200 },
      });
    }
  }
  const sorted = [...children.values()].sort((a, b) =>
    String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0
  );
  return jsonResponse(200, sorted.slice(offset, offset + limit));
}

// storage-js createSignedUrl(path, expiresIn): POST /object/sign/{bucket}/{path}. Storage refuses to sign a file that is not
// there (a 400 whose body says 404), and answers a relative signedURL that carries the token.
function signObject(world: World, bucket: string, path: string, json: unknown): Response {
  if (world.fail.storageSign > 0) {
    world.fail.storageSign -= 1;
    return jsonResponse(500, { statusCode: "500", error: "Internal", message: "the link could not be made" });
  }
  const exists = bucket === "exports" ? world.exports.has(path) : world.storage.has(path);
  if (!exists) return jsonResponse(400, { statusCode: "404", error: "not_found", message: "Object not found" });
  const expiresIn = Number((json as { expiresIn?: unknown } | null)?.expiresIn);
  world.signs.push({ bucket, path, expiresIn });
  return jsonResponse(200, { signedURL: `/object/sign/${bucket}/${path}?token=signed-test-token` });
}

// A ZIP sent to the exports bucket: only application/zip, up to EXPORTS_MAX_BYTES, and never over a file that is there unless
// the upload says it may replace it.
function uploadExport(world: World, path: string, headers: Headers, bytes: Uint8Array): Response {
  if (world.fail.exportUpload > 0) {
    world.fail.exportUpload -= 1;
    return jsonResponse(500, { statusCode: "500", error: "Internal", message: "the file could not be stored" });
  }
  const contentType = headers.get("content-type") ?? "";
  if (contentType !== "application/zip") {
    return jsonResponse(415, {
      statusCode: "415",
      error: "invalid_mime_type",
      message: `mime type ${contentType} is not supported`,
    });
  }
  if (bytes.length > EXPORTS_MAX_BYTES) {
    return jsonResponse(413, {
      statusCode: "413",
      error: "Payload too large",
      message: "The object exceeded the maximum allowed size",
    });
  }
  const upsert = headers.get("x-upsert") === "true";
  if (world.exports.has(path) && !upsert) {
    return jsonResponse(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
  }
  world.exports.set(path, { bytes, createdAt: world.now() });
  world.exportUploads.push({ path, contentType, upsert });
  return jsonResponse(200, { Id: crypto.randomUUID(), Key: `exports/${path}` });
}

// Clerk's Backend API (step 31): GET and DELETE /v1/users/{id}. The instance's own secret key finds the users in clerkUsers; a
// well-formed secret key of another instance finds nobody (404), and anything else is refused (401).
async function clerkApi(world: World, request: Request, recorded: Recorded): Promise<Response> {
  world.clerkCalls.push(recorded);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer sk_")) {
    return jsonResponse(401, { errors: [{ code: "authentication_invalid", message: "Unauthorized request" }] });
  }
  const queued = world.clerkQueue.shift();
  if (queued) return await play(queued, request);
  const match = /^\/v1\/users\/([^/]+)$/.exec(recorded.url.pathname);
  if (!match) throw new Error(`the test world has no Clerk route for ${recorded.url.pathname}`);
  const id = decodeURIComponent(match[1]);
  // The instance's own key is the world's, whatever a test has put in the environment since.
  const sameInstance = authorization === `Bearer ${ENV.CLERK_SECRET_KEY}`;
  if (!sameInstance || !world.clerkUsers.has(id)) {
    return jsonResponse(404, { errors: [{ code: "resource_not_found", message: "not found" }] });
  }
  if (request.method === "GET") return jsonResponse(200, { id, object: "user" });
  if (request.method === "DELETE") {
    world.clerkUsers.delete(id);
    return jsonResponse(200, { id, object: "user", deleted: true });
  }
  throw new Error(`the test world has no Clerk route for ${request.method}`);
}

export function installWorld(): World {
  const original = globalThis.fetch;
  const saved: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(ENV)) {
    saved[name] = Deno.env.get(name);
    Deno.env.set(name, value);
  }
  // Speech is off in a fresh world, whatever the shell running the tests holds: speechOn(world) turns it on.
  for (const name of SPEECH_NAMES) {
    saved[name] = Deno.env.get(name);
    Deno.env.delete(name);
  }
  const originalLog = console.log;
  const savedBibleTiming = { ...bibleTiming };
  bibleTiming.retryDelayMs = 1;
  bibleTiming.requestTimeoutMs = 300;
  // A busy Google is tried again after a millisecond here, not a second. A test that shortens the speech budget gets it
  // back as it was when the world is restored.
  const savedTtsTiming = { ...ttsTiming };
  const savedSpeechTiming = { ...speechTiming };
  ttsTiming.retryPauseMs = 1;
  clearChapterCache();
  clearTokenCache();
  let googleTokens = 0;

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
    tokenCalls: [],
    tokenQueue: [],
    ttsCalls: [],
    ttsQueue: [],
    uploads: [],
    deletedDevotionals: [],
    removals: [],
    fail: {
      storageRemove: 0,
      recordDeleted: 0,
      deleteEntry: 0,
      profileUpdate: 0,
      storageList: 0,
      storageSign: 0,
      exportUpload: 0,
      profileDelete: 0,
      rowsRead: 0,
    },
    revenuecat: new Map(),
    revenuecatQueue: [],
    revenuecatCalls: [],
    exports: new Map(),
    exportUploads: [],
    exportRemovals: [],
    lists: [],
    signs: [],
    downloads: [],
    clerkUsers: new Set(),
    clerkQueue: [],
    clerkCalls: [],
    cascade: true,
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
        world.users.push({
          id,
          created_at: world.now(),
          subscription_tier: "free",
          timezone: "UTC",
          subscription_expires_at: null,
          subscription_synced_at: null,
        });
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
      Object.assign(ttsTiming, savedTtsTiming);
      Object.assign(speechTiming, savedSpeechTiming);
      clearChapterCache();
      clearTokenCache();
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
    const url = new URL(request.url);
    // A file sent to Storage is binary, so it is read as bytes and never as text.
    const isUpload = url.origin === SUPABASE_URL && request.method === "POST" &&
      (url.pathname.startsWith("/storage/v1/object/journal_media/") ||
        url.pathname.startsWith("/storage/v1/object/exports/"));
    const bytes = isUpload ? new Uint8Array(await request.arrayBuffer()) : null;
    const text = bytes !== null || request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (a form, as the Google token request is).
    }
    const recorded: Recorded = { method: request.method, url, headers: request.headers, text, json };

    if (url.origin === ISSUER) return jsonResponse(200, { keys: [publicJwk] });

    if (url.host === GEMINI_HOST) {
      const screening = isScreeningRequest(json);
      (screening ? world.screenCalls : world.geminiCalls).push(recorded);
      world.callOrder.push(screening ? "screening" : "reflection");
      const reply = (screening ? world.screenQueue : world.geminiQueue).shift() ??
        (screening ? defaultScreenReply(json) : undefined);
      if (!reply) throw new Error("the test queued no Gemini reply");
      return await play(reply, request);
    }

    if (url.host === GOOGLE_TOKEN_HOST) {
      world.tokenCalls.push(recorded);
      googleTokens += 1;
      return await play(world.tokenQueue.shift() ?? tokenOk(`ya29.test-${googleTokens}`), request);
    }

    if (url.host === GOOGLE_TTS_HOST) {
      world.ttsCalls.push(recorded);
      return await play(world.ttsQueue.shift() ?? synthOk(FIXTURE_WAV), request);
    }

    if (url.host === CLERK_API_HOST) return await clerkApi(world, request, recorded);

    if (url.host === REVENUECAT_HOST) {
      world.revenuecatCalls.push(recorded);
      // The real API refuses a request without a secret key (a public SDK key cannot read a customer).
      if (!(request.headers.get("authorization") ?? "").startsWith("Bearer sk_")) {
        return jsonResponse(401, { code: 7225, message: "Invalid API Key." });
      }
      const queued = world.revenuecatQueue.shift();
      if (queued) return await play(queued, request);
      const id = decodeURIComponent(url.pathname.slice("/v1/subscribers/".length));
      // Step 31: deleting the customer. RevenueCat queues the deletion and answers at once; an id it does not know is a 404.
      if (request.method === "DELETE") {
        if (!world.revenuecat.delete(id)) return jsonResponse(404, { code: 7259, message: "Subscriber not found." });
        return jsonResponse(200, { app_user_id: id, deleted: true });
      }
      const known = world.revenuecat.get(id);
      return jsonResponse(known ? 200 : 201, {
        request_date: new Date().toISOString(),
        request_date_ms: Date.now(),
        subscriber: known ?? rcCustomer(null),
      });
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
        const removal = /^\/storage\/v1\/object\/(journal_media|exports)$/.exec(url.pathname);
        if (removal && request.method === "DELETE") return removeObjects(world, removal[1], recorded);
        const listing = /^\/storage\/v1\/object\/list\/(journal_media|exports)$/.exec(url.pathname);
        if (listing && request.method === "POST") return listObjects(world, listing[1], json);
        const signing = /^\/storage\/v1\/object\/sign\/(journal_media|exports)\/(.+)$/.exec(url.pathname);
        if (signing && request.method === "POST") {
          return signObject(world, signing[1], decodeURIComponent(signing[2]), json);
        }
        if (url.pathname.startsWith("/storage/v1/object/exports/") && bytes !== null) {
          const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/exports/".length));
          return uploadExport(world, path, request.headers, bytes);
        }
        if (url.pathname.startsWith("/storage/v1/object/journal_media/")) {
          const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/journal_media/".length));
          if (bytes !== null) return upload(world, path, request.headers, bytes);
          world.downloads.push(path);
          const stored = world.storage.get(path);
          return stored
            ? new Response(new Uint8Array(stored), { status: 200, headers: { "Content-Type": "audio/mp4" } })
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

// Turns speech on in the world's environment: the test service account (a real RSA key) and a Chirp 3 HD voice.
// world.restore() puts the environment back. The Google counters start again from here.
export function speechOn(world: World): void {
  Deno.env.set("GOOGLE_TTS_CREDENTIALS_B64", SPEECH_ACCOUNT.encoded);
  Deno.env.set("TTS_VOICE_NAME", SPEECH_VOICE);
  Deno.env.delete("TTS_SPEAKING_RATE");
  world.tokenCalls.length = 0;
  world.ttsCalls.length = 0;
  clearTokenCache();
}

// A finished reflection of this user, as process-entry leaves one: ready, with its devotional and no audio. Pass fields to
// change it (a created_at in another week, an audio path, an error code).
export function seedDevotional(world: World, userId: string, over: Row = {}): EntryRow {
  return world.seedEntry({
    user_id: userId,
    client_entry_id: crypto.randomUUID(),
    input_type: "text",
    transcript: TEXT,
    processing_status: "ready",
    dominant_emotion: "anxious",
    devotional_title: "Peace in the Waiting",
    devotional_script: DEVOTIONAL,
    closing_prayer: "Lord, we bring you the weight of this week and ask for your peace. Amen.",
    ...over,
  });
}

// A record that a devotional of this user's, made at this time, was deleted (step 29b). The free tier counts it with the
// reflections that exist.
export function seedDeletedDevotional(world: World, userId: string, madeAt: string): Record<string, unknown> {
  world.seedUser(userId);
  const row: Record<string, unknown> = {
    entry_id: crypto.randomUUID(),
    user_id: userId,
    made_at: madeAt,
    deleted_at: world.now(),
  };
  world.deletedDevotionals.push(row);
  return row;
}

// Every request the function sent about a user's own tables carried that user's id: a filter on reads, updates and
// deletes, a column on inserts. Returns the requests that did not. (A user's profile is filtered by its `id`; the
// profile's own insert is not checked, because ensureProfile also creates another user's row in some tests.)
export function unscopedRequests(world: World, userId: string): string[] {
  const offenders: string[] = [];
  for (const request of world.requests) {
    const table = request.url.pathname.startsWith("/rest/v1/") ? request.url.pathname.slice("/rest/v1/".length) : "";
    if (
      table === "users_profile" && request.method !== "POST" && request.url.searchParams.get("id") !== `eq.${userId}`
    ) {
      offenders.push(`${request.method} ${table}${request.url.search}`);
    }
    if (table !== "journal_entries" && table !== "daily_affirmations" && table !== "deleted_devotionals") continue;
    if (request.method === "POST") {
      const rows = (Array.isArray(request.json) ? request.json : [request.json]) as Row[];
      if (!rows.every((row) => row.user_id === userId)) offenders.push(`${request.method} ${table}`);
    } else if (request.url.searchParams.get("user_id") !== `eq.${userId}`) {
      offenders.push(`${request.method} ${table}${request.url.search}`);
    }
  }
  return offenders;
}

// Every Storage request of step 31's kinds stayed inside this user's own folder: the listings, the signed links, the files read,
// the ZIPs written and every path removed in either bucket. Returns the requests that did not.
export function unscopedStorage(world: World, userId: string): string[] {
  const own = (path: string) => path.startsWith(`${userId}/`) && !path.includes("..");
  const offenders: string[] = [];
  for (const list of world.lists) {
    if (list.prefix !== userId && !own(list.prefix)) offenders.push(`list ${list.bucket}:${list.prefix}`);
  }
  for (const sign of world.signs) if (!own(sign.path)) offenders.push(`sign ${sign.bucket}:${sign.path}`);
  for (const path of world.downloads) if (!own(path)) offenders.push(`download journal_media:${path}`);
  for (const upload of world.exportUploads) if (!own(upload.path)) offenders.push(`upload exports:${upload.path}`);
  for (const batch of world.removals) {
    for (const path of batch) if (!own(path)) offenders.push(`remove journal_media:${path}`);
  }
  for (const batch of world.exportRemovals) {
    for (const path of batch) if (!own(path)) offenders.push(`remove exports:${path}`);
  }
  return offenders;
}

// A RevenueCat customer as GET /v1/subscribers/{id} answers it (the `subscriber` object), with a pro entitlement or none.
// `expires` null is a lifetime grant; `periodType` "trial" makes it a trial. The shape was confirmed against the real API on
// 2026-10-29 for an empty customer; the entitlement and subscription fields follow RevenueCat's v1 reference.
export function rcCustomer(
  pro: { expires: string | null; grace?: string | null; periodType?: string; product?: string } | null,
): Row {
  const product = pro?.product ?? "gracehush_pro_yearly";
  const purchased = "2026-10-29T11:00:00Z";
  return {
    entitlements: pro === null ? {} : {
      pro: {
        expires_date: pro.expires,
        grace_period_expires_date: pro.grace ?? null,
        product_identifier: product,
        purchase_date: purchased,
      },
    },
    first_seen: purchased,
    last_seen: purchased,
    management_url: null,
    non_subscriptions: {},
    original_app_user_id: "customer",
    original_application_version: null,
    original_purchase_date: null,
    other_purchases: {},
    subscriptions: pro === null ? {} : {
      [product]: {
        auto_resume_date: null,
        billing_issues_detected_at: null,
        expires_date: pro.expires,
        grace_period_expires_date: pro.grace ?? null,
        is_sandbox: true,
        original_purchase_date: purchased,
        period_type: pro.periodType ?? "normal",
        purchase_date: purchased,
        refunded_at: null,
        store: "test_store",
        unsubscribe_detected_at: null,
      },
    },
  };
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
