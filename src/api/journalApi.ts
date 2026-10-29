import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

import { CONFIRM_SCRIPTURE_TIMEOUT_MS, DELETE_ENTRY_TIMEOUT_MS, PROCESS_ENTRY_TIMEOUT_MS } from "@/constants/app";
import { getSupabase } from "@/services/supabaseClient";
import type {
  Affirmation,
  ConfirmScriptureRequest,
  ConfirmScriptureResponse,
  DeleteEntryRequest,
  DeleteEntryResponse,
  Devotional,
  JournalEntry,
  Prayer,
  ProcessEntryRequest,
  ProcessEntryResponse,
  Scripture,
} from "@/types";
import { NO_SESSION_ERROR_NAME } from "@/utils/supabaseErrors";

// The only code that calls the Edge Functions (step 25, and delete-entry since step 29b). supabase-js sends the Clerk session token as the bearer
// token by itself (the accessToken option of src/services/supabaseClient.ts), so nothing here builds an Authorization
// header or asks Clerk for a token. Every call answers with data or with a failure that carries the HTTP status and a
// code; it never throws.
//
// supabase.functions.invoke does not throw either: a non-2xx answer comes back as a FunctionsHttpError whose `context` is
// the Response, which is where the function's own error code (and, for a 402, the saved entry and the numbers) is read.
// Nothing here logs a body, a token, a text or an id: the dev panel's Supabase check reads getLastFunctionCall().

export type FunctionName = "process-entry" | "confirm-scripture" | "delete-entry";

export type FunctionResult<T> =
  | { ok: true; data: T }
  // `code` is the function's own error code, or one of NETWORK (no answer), UNAUTHORIZED, RATE_LIMITED, INTERNAL and UNKNOWN
  // worked out from the status. `body` is the parsed error body (null when there was none): a 402 carries the entry that
  // was saved and when the week resets.
  | { ok: false; status: number; code: string; body: unknown };

export type FunctionCall = { name: FunctionName; status: number; code: string | null; ms: number };

let lastCall: FunctionCall | null = null;

// For the developer panel: what the last call to a function came to. A name, a status, a code and a time, nothing else.
export function getLastFunctionCall(): FunctionCall | null {
  return lastCall;
}

function record<T>(name: FunctionName, started: number, result: FunctionResult<T>): FunctionResult<T> {
  lastCall = {
    name,
    status: result.ok ? 200 : result.status,
    code: result.ok ? null : result.code,
    ms: Date.now() - started,
  };
  return result;
}

// ---- shapes: small guards for what the functions promise (src/types/index.ts, kept equal to contracts.ts) -------------
const STATUSES: readonly string[] = ["pending", "uploading", "processing", "ready", "failed"];
const SLOTS: readonly string[] = ["morning", "afternoon", "evening"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isScripture(value: unknown): value is Scripture {
  return (
    isRecord(value) &&
    isString(value.reference) &&
    isNullableString(value.text) &&
    value.translation === "BSB" &&
    typeof value.verified === "boolean"
  );
}

function isDevotional(value: unknown): value is Devotional {
  return (
    isRecord(value) &&
    isString(value.title) &&
    isString(value.script) &&
    isNullableString(value.closingPrayer) &&
    isNullableString(value.audioPath) &&
    (value.durationMs === null || typeof value.durationMs === "number")
  );
}

function isPrayer(value: unknown): value is Prayer {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isNullableString(value.category) &&
    isString(value.summary) &&
    isNullableString(value.scriptureReference) &&
    isString(value.createdAt) &&
    typeof value.isAnswered === "boolean" &&
    isNullableString(value.answeredAt) &&
    isNullableString(value.answeredNote)
  );
}

function isEntry(value: unknown): value is JournalEntry {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isNullableString(value.clientEntryId) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    (value.inputType === "text" || value.inputType === "audio") &&
    isNullableString(value.transcript) &&
    isNullableString(value.dominantEmotion) &&
    isString(value.status) &&
    STATUSES.includes(value.status) &&
    typeof value.isCrisis === "boolean" &&
    (value.scripture === null || isScripture(value.scripture)) &&
    (value.devotional === null || isDevotional(value.devotional)) &&
    (value.prayer === null || isPrayer(value.prayer)) &&
    isNullableString(value.failureCode) &&
    typeof value.isLocalOnly === "boolean"
  );
}

function isAffirmation(value: unknown): value is Affirmation {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.entryId) &&
    isString(value.slot) &&
    SLOTS.includes(value.slot) &&
    isString(value.headline) &&
    isString(value.text) &&
    typeof value.isFavorite === "boolean"
  );
}

function isProcessEntryResponse(value: unknown): value is ProcessEntryResponse {
  return isRecord(value) && isEntry(value.entry) && Array.isArray(value.affirmations) && value.affirmations.every(isAffirmation);
}

function isConfirmScriptureResponse(value: unknown): value is ConfirmScriptureResponse {
  return isRecord(value) && "scripture" in value && (value.scripture === null || isScripture(value.scripture));
}

function isDeleteEntryResponse(value: unknown): value is DeleteEntryResponse {
  return isRecord(value) && value.deleted === true;
}

// ---- failures ------------------------------------------------------------------------------------------------------
// For an answer that has none of our codes in it: the platform's own 4xx and 5xx (a function that is not deployed, a
// worker that ran out of memory, a request that took too long).
function codeFromStatus(status: number): string {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL";
  return "UNKNOWN";
}

async function readFailure(error: unknown): Promise<{ status: number; code: string; body: unknown }> {
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const response = error.context as Response;
    const status = typeof response.status === "number" ? response.status : 0;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // An answer with no JSON in it (the platform's own page): the status says what it was.
    }
    const named = isRecord(body) && isRecord(body.error) && isString(body.error.code) ? body.error.code : null;
    return { status, code: named ?? codeFromStatus(status), body };
  }
  if (error instanceof FunctionsFetchError) {
    // No answer at all: offline, a dropped connection, our own timeout, or the token callback of the Supabase client
    // that threw. Only the last one is about the session: the Clerk token could not be had because nobody is signed in.
    const cause: unknown = error.context;
    const noSession = cause instanceof Error && cause.name === NO_SESSION_ERROR_NAME;
    return { status: 0, code: noSession ? "UNAUTHORIZED" : "NETWORK", body: null };
  }
  return { status: 0, code: "UNKNOWN", body: null };
}

async function callFunction<T>(
  name: FunctionName,
  body: ProcessEntryRequest | ConfirmScriptureRequest | DeleteEntryRequest,
  timeout: number,
  isValid: (value: unknown) => value is T,
): Promise<FunctionResult<T>> {
  const started = Date.now();
  const supabase = getSupabase();
  // Signed out (or no Supabase address): nothing is sent.
  if (supabase === null) return record(name, started, { ok: false, status: 0, code: "UNAUTHORIZED", body: null });
  try {
    // `timeout` aborts the request itself, which comes back as a FunctionsFetchError: no answer, so NETWORK.
    const { data, error } = await supabase.functions.invoke<unknown>(name, { body, timeout });
    if (error !== null) return record(name, started, { ok: false, ...(await readFailure(error)) });
    if (isValid(data)) return record(name, started, { ok: true, data });
    // The function answered 200 with something that is not what it promises.
    return record(name, started, { ok: false, status: 200, code: "UNKNOWN", body: null });
  } catch {
    return record(name, started, { ok: false, status: 0, code: "UNKNOWN", body: null });
  }
}

// process-entry (steps 19 to 22). It takes up to about 145 seconds (the function stops itself at 150), so the call gives up
// at PROCESS_ENTRY_TIMEOUT_MS, and the sync engine's own ceiling is above that.
export function processEntry(request: ProcessEntryRequest): Promise<FunctionResult<ProcessEntryResponse>> {
  return callFunction("process-entry", request, PROCESS_ENTRY_TIMEOUT_MS, isProcessEntryResponse);
}

// confirm-scripture (step 20): the passage of one reflection, read again from the Bible.
export function confirmScripture(entryId: string): Promise<FunctionResult<ConfirmScriptureResponse>> {
  return callFunction("confirm-scripture", { entryId }, CONFIRM_SCRIPTURE_TIMEOUT_MS, isConfirmScriptureResponse);
}

// delete-entry (step 29b): one reflection, deleted for good on the server (its files, its affirmations and the row). NOT_FOUND
// means it is already gone: the caller counts that as deleted.
export function deleteEntry(entryId: string): Promise<FunctionResult<DeleteEntryResponse>> {
  return callFunction("delete-entry", { entryId }, DELETE_ENTRY_TIMEOUT_MS, isDeleteEntryResponse);
}

// The 402 body (step 22): the entry the server saved and when the free week ends. Null for any other body.
export function readLimitBody(body: unknown): { entryId: string; resetsAt: string } | null {
  if (!isRecord(body) || !isString(body.entryId) || !isRecord(body.usage) || !isString(body.usage.resetsAt)) return null;
  return { entryId: body.entryId, resetsAt: body.usage.resetsAt };
}
