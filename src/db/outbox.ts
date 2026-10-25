import { getDb } from "@/db/database";
import { decryptText, encryptText } from "@/db/fieldCrypto";
import type { AudioMimeType, InputType, OutboxItem, OutboxStatus } from "@/types";

// The queue of reflections that are saved on this phone and not prepared yet (step 24). Every query binds its values
// (`?`): no value is ever put into SQL text. The words of a text entry are stored encrypted (fieldCrypto.ts).
//
// A voice entry's recording is not in the database. It is the file recordings/{clientEntryId}.m4a (step 23, recordingUri()).

export type NewOutboxItem =
  | { clientEntryId: string; inputType: "text"; text: string }
  | { clientEntryId: string; inputType: "audio"; durationMs: number; mimeType: AudioMimeType };

type Row = {
  client_entry_id: string;
  input_type: InputType;
  text: string | null;
  duration_ms: number | null;
  mime_type: string | null;
  status: OutboxStatus;
  attempts: number;
  next_attempt_at: number;
  last_error_code: string | null;
  server_entry_id: string | null;
  limit_resets_at: number | null;
  created_at: number;
};

const COLUMNS = `client_entry_id, input_type, text, duration_ms, mime_type, status, attempts, next_attempt_at,
  last_error_code, server_entry_id, limit_resets_at, created_at`;

const MIME_TYPES: readonly string[] = ["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac"];

function isMimeType(value: string | null): value is AudioMimeType {
  return value !== null && MIME_TYPES.includes(value);
}

// A text entry whose words cannot be read has `text: null`: the engine marks it as needing the person (UNREADABLE).
async function toItem(row: Row): Promise<OutboxItem> {
  return {
    clientEntryId: row.client_entry_id,
    inputType: row.input_type,
    text: row.text === null ? null : await decryptText(row.text),
    durationMs: row.duration_ms,
    mimeType: isMimeType(row.mime_type) ? row.mime_type : null,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    serverEntryId: row.server_entry_id,
    limitResetsAt: row.limit_resets_at,
    createdAt: row.created_at,
  };
}

// Saves a new item, queued for now. The same id again changes nothing (a double tap), with one exception: a text entry that
// needs the person is queued again with its new words (the "Edit and resend" path).
export async function enqueue(item: NewOutboxItem, now: number = Date.now()): Promise<void> {
  const isText = item.inputType === "text";
  await getDb().runAsync(
    `INSERT INTO outbox (client_entry_id, input_type, text, duration_ms, mime_type, status, attempts, next_attempt_at,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
     ON CONFLICT (client_entry_id) DO UPDATE SET
       text = excluded.text, status = 'queued', attempts = 0, next_attempt_at = excluded.next_attempt_at,
       last_error_code = NULL, updated_at = excluded.updated_at
     WHERE outbox.status = 'needs_action' AND outbox.input_type = 'text' AND excluded.input_type = 'text'`,
    item.clientEntryId,
    item.inputType,
    isText ? await encryptText(item.text) : null,
    isText ? null : item.durationMs,
    isText ? null : item.mimeType,
    now,
    now,
    now,
  );
}

export async function get(clientEntryId: string): Promise<OutboxItem | null> {
  const row = await getDb().getFirstAsync<Row>(
    `SELECT ${COLUMNS} FROM outbox WHERE client_entry_id = ?`,
    clientEntryId,
  );
  return row === null ? null : toItem(row);
}

export async function exists(clientEntryId: string): Promise<boolean> {
  const row = await getDb().getFirstAsync<{ found: number }>(
    "SELECT 1 AS found FROM outbox WHERE client_entry_id = ?",
    clientEntryId,
  );
  return row !== null;
}

// Newest first, for the Journal.
export async function listPending(): Promise<OutboxItem[]> {
  const rows = await getDb().getAllAsync<Row>(
    `SELECT ${COLUMNS} FROM outbox ORDER BY created_at DESC, client_entry_id DESC`,
  );
  return Promise.all(rows.map(toItem));
}

// The oldest queued item that is due, so reflections are prepared in the order they were made.
export async function nextDue(now: number): Promise<OutboxItem | null> {
  const row = await getDb().getFirstAsync<Row>(
    `SELECT ${COLUMNS} FROM outbox WHERE status = 'queued' AND next_attempt_at <= ?
     ORDER BY created_at ASC, client_entry_id ASC LIMIT 1`,
    now,
  );
  return row === null ? null : toItem(row);
}

// When the engine should wake up next: the earliest retry of a queued item.
export async function nextAttemptAt(): Promise<number | null> {
  const row = await getDb().getFirstAsync<{ at: number | null }>(
    "SELECT MIN(next_attempt_at) AS at FROM outbox WHERE status = 'queued'",
  );
  return row?.at ?? null;
}

// ...and the earliest time a held-back item may go again (the week resets).
export async function earliestLimitReset(): Promise<number | null> {
  const row = await getDb().getFirstAsync<{ at: number | null }>(
    "SELECT MIN(limit_resets_at) AS at FROM outbox WHERE status = 'limit_reached' AND limit_resets_at IS NOT NULL",
  );
  return row?.at ?? null;
}

// Takes a queued item for sending and counts the attempt. False when it is not queued (another run took it).
export async function markSending(clientEntryId: string, now: number): Promise<boolean> {
  const result = await getDb().runAsync(
    `UPDATE outbox SET status = 'sending', attempts = attempts + 1, updated_at = ?
     WHERE client_entry_id = ? AND status = 'queued'`,
    now,
    clientEntryId,
  );
  return result.changes > 0;
}

export async function markQueued(
  clientEntryId: string,
  nextAttemptAtMs: number,
  code: string | null,
  now: number,
): Promise<void> {
  await getDb().runAsync(
    `UPDATE outbox SET status = 'queued', next_attempt_at = ?, last_error_code = ?, updated_at = ?
     WHERE client_entry_id = ?`,
    nextAttemptAtMs,
    code,
    now,
    clientEntryId,
  );
}

export async function markNeedsAction(clientEntryId: string, code: string, now: number): Promise<void> {
  await getDb().runAsync(
    "UPDATE outbox SET status = 'needs_action', last_error_code = ?, updated_at = ? WHERE client_entry_id = ?",
    code,
    now,
    clientEntryId,
  );
}

// The server saved the entry and refused to prepare it (the free limit): keep its id and when the week resets.
export async function markLimitReached(
  clientEntryId: string,
  entryId: string | null,
  resetsAt: number | null,
  now: number,
): Promise<void> {
  await getDb().runAsync(
    `UPDATE outbox SET status = 'limit_reached', last_error_code = 'LIMIT_REACHED', server_entry_id = ?,
       limit_resets_at = ?, updated_at = ?
     WHERE client_entry_id = ?`,
    entryId,
    resetsAt,
    now,
    clientEntryId,
  );
}

// The session was refused: everything that was going to be sent waits for the next sign-in.
export async function markPausedAuth(now: number): Promise<void> {
  await getDb().runAsync(
    "UPDATE outbox SET status = 'paused_auth', updated_at = ? WHERE status IN ('queued', 'sending')",
    now,
  );
}

export async function remove(clientEntryId: string): Promise<void> {
  await getDb().runAsync("DELETE FROM outbox WHERE client_entry_id = ?", clientEntryId);
}

// The app was closed in the middle of a send: those items go back in the queue.
export async function resetSending(now: number): Promise<void> {
  await getDb().runAsync("UPDATE outbox SET status = 'queued', updated_at = ? WHERE status = 'sending'", now);
}

export async function resumePausedAuth(now: number): Promise<number> {
  const result = await getDb().runAsync(
    `UPDATE outbox SET status = 'queued', attempts = 0, next_attempt_at = ?, last_error_code = NULL, updated_at = ?
     WHERE status = 'paused_auth'`,
    now,
    now,
  );
  return result.changes;
}

// The person upgraded: every held-back item goes again.
export async function resumeLimitReached(now: number): Promise<number> {
  const result = await getDb().runAsync(
    `UPDATE outbox SET status = 'queued', attempts = 0, next_attempt_at = ?, last_error_code = NULL,
       limit_resets_at = NULL, updated_at = ?
     WHERE status = 'limit_reached'`,
    now,
    now,
  );
  return result.changes;
}

// The week reset: the held-back items whose time has come go again.
export async function resumeLimitReachedDue(now: number): Promise<number> {
  const result = await getDb().runAsync(
    `UPDATE outbox SET status = 'queued', attempts = 0, next_attempt_at = ?, last_error_code = NULL,
       limit_resets_at = NULL, updated_at = ?
     WHERE status = 'limit_reached' AND limit_resets_at IS NOT NULL AND limit_resets_at <= ?`,
    now,
    now,
    now,
  );
  return result.changes;
}

// The reflections the server has never been given: everything in the outbox except what the free limit holds back (the
// server saved those, and has their words). Signing out would lose these.
export async function countUnsent(): Promise<number> {
  const row = await getDb().getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE status != 'limit_reached'",
  );
  return row?.n ?? 0;
}

// The numbers for the developer panel: how many items are in each state.
export async function countsByStatus(): Promise<Partial<Record<OutboxStatus, number>>> {
  const rows = await getDb().getAllAsync<{ status: OutboxStatus; n: number }>(
    "SELECT status, COUNT(*) AS n FROM outbox GROUP BY status",
  );
  const counts: Partial<Record<OutboxStatus, number>> = {};
  for (const row of rows) counts[row.status] = row.n;
  return counts;
}
