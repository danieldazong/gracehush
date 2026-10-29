import { PRAYER_PATCH_COLUMNS, type PrayerPatch } from "@/data/columns";
import { mergePatches, sanitizePatch } from "@/data/prayerPatches";
import { getDb } from "@/db/database";
import { decryptText, encryptText } from "@/db/fieldCrypto";

// The prayer changes made on this phone that the server has not confirmed yet (step 29). One row per entry: every change to that
// entry is merged into one patch of journal_entries columns (a later key wins), so a prayer marked, edited and moved back while
// offline goes as one update with the final values. The patch is stored encrypted, because a gratitude note is the person's
// words. Every query binds its values. The sync engine sends due rows before the outbox (services/syncEngine.ts), and signing
// out deletes the database file with this table in it.

export type PendingChange = {
  entryId: string;
  patch: PrayerPatch;
  // How many changes were merged into the row. The engine removes a row only when this has not moved since it read it.
  revision: number;
  attempts: number;
  nextAttemptAt: number; // epoch ms
  lastErrorCode: string | null;
};

// A refused session pauses every change until the app starts or comes to the front again, as the outbox's paused_auth does.
const PAUSED = "UNAUTHORIZED";

type Row = {
  entry_id: string;
  patch_json: string;
  revision: number;
  attempts: number;
  next_attempt_at: number;
  last_error_code: string | null;
};

const COLUMNS = "entry_id, patch_json, revision, attempts, next_attempt_at, last_error_code";
const ALLOWED: readonly string[] = PRAYER_PATCH_COLUMNS;

function note(code: string) {
  if (__DEV__) {
    console.info(`[db] ${code}`);
  }
}

// A row whose patch cannot be read (damaged, or sealed with another key) can never be sent, so it is removed.
async function toChange(row: Row): Promise<PendingChange | null> {
  const json = await decryptText(row.patch_json);
  let patch: PrayerPatch | null = null;
  if (json !== null) {
    try {
      patch = sanitizePatch(JSON.parse(json));
    } catch {
      patch = null;
    }
  }
  if (patch === null) {
    note("mutation_unreadable");
    await getDb().runAsync("DELETE FROM mutations WHERE entry_id = ? AND revision = ?", row.entry_id, row.revision);
    return null;
  }
  return {
    entryId: row.entry_id,
    patch,
    revision: row.revision,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
  };
}

// Merges run one at a time: each reads the row, adds to it and writes it back, and two at once would lose one.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

// Adds a change, merged into the entry's waiting one, and makes it due now. Only the prayer columns are ever kept: another key
// is a bug, which throws in development and is dropped otherwise.
export function enqueuePatch(entryId: string, patch: PrayerPatch, now: number = Date.now()): Promise<void> {
  const extra = Object.keys(patch).filter((key) => !ALLOWED.includes(key));
  if (extra.length > 0 && __DEV__) throw new Error(`Not a prayer column: ${extra.join(", ")}`);
  const clean = sanitizePatch(patch);
  if (clean === null) return Promise.resolve();
  return serial(async () => {
    const db = getDb();
    const row = await db.getFirstAsync<Row>(`SELECT ${COLUMNS} FROM mutations WHERE entry_id = ?`, entryId);
    const earlier = row === null ? null : await toChange(row);
    const merged = earlier === null ? clean : mergePatches(earlier.patch, clean);
    await db.runAsync(
      `INSERT INTO mutations (entry_id, patch_json, revision, attempts, next_attempt_at, last_error_code, updated_at)
       VALUES (?, ?, 1, 0, ?, NULL, ?)
       ON CONFLICT (entry_id) DO UPDATE SET patch_json = excluded.patch_json, revision = mutations.revision + 1,
         attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error_code = NULL, updated_at = excluded.updated_at`,
      entryId,
      await encryptText(JSON.stringify(merged)),
      now,
      now,
    );
  });
}

// The change that has waited longest among the ones that are due. A paused one waits for the app to come back.
export async function nextDueMutation(now: number): Promise<PendingChange | null> {
  for (;;) {
    const row = await getDb().getFirstAsync<Row>(
      `SELECT ${COLUMNS} FROM mutations WHERE next_attempt_at <= ? AND last_error_code IS NOT ?
       ORDER BY updated_at ASC, entry_id ASC LIMIT 1`,
      now,
      PAUSED,
    );
    if (row === null) return null;
    const change = await toChange(row);
    if (change !== null) return change;
  }
}

// When the engine should wake for the next retry: null when no change waits for one.
export async function nextMutationAt(): Promise<number | null> {
  const row = await getDb().getFirstAsync<{ at: number | null }>(
    "SELECT MIN(next_attempt_at) AS at FROM mutations WHERE last_error_code IS NOT ?",
    PAUSED,
  );
  return row?.at ?? null;
}

// A send that failed and goes again later. A change merged meanwhile (another revision) is left alone: it is due now.
export async function markRetry(
  entryId: string,
  revision: number,
  nextAttemptAtMs: number,
  code: string,
  now: number = Date.now(),
): Promise<void> {
  await getDb().runAsync(
    `UPDATE mutations SET attempts = attempts + 1, next_attempt_at = ?, last_error_code = ?, updated_at = ?
     WHERE entry_id = ? AND revision = ?`,
    nextAttemptAtMs,
    code,
    now,
    entryId,
    revision,
  );
}

// The session was refused: every change waits for the next start or return to the app.
export async function markPausedAuth(now: number = Date.now()): Promise<void> {
  await getDb().runAsync("UPDATE mutations SET last_error_code = ?, updated_at = ?", PAUSED, now);
}

export async function resumePausedMutations(now: number = Date.now()): Promise<number> {
  const result = await getDb().runAsync(
    `UPDATE mutations SET last_error_code = NULL, attempts = 0, next_attempt_at = ?, updated_at = ?
     WHERE last_error_code = ?`,
    now,
    now,
    PAUSED,
  );
  return result.changes;
}

// Removes a settled change, but only when nothing was merged into it since it was read (`revision`). True when it went.
export async function removeMutation(entryId: string, revision: number): Promise<boolean> {
  const result = await getDb().runAsync(
    "DELETE FROM mutations WHERE entry_id = ? AND revision = ?",
    entryId,
    revision,
  );
  return result.changes > 0;
}

// Drops whatever change waits for this entry, whatever its revision: the entry itself is gone (step 29b).
export async function dropMutation(entryId: string): Promise<void> {
  await getDb().runAsync("DELETE FROM mutations WHERE entry_id = ?", entryId);
}

export async function getMutation(entryId: string): Promise<PendingChange | null> {
  const row = await getDb().getFirstAsync<Row>(`SELECT ${COLUMNS} FROM mutations WHERE entry_id = ?`, entryId);
  return row === null ? null : toChange(row);
}

// Every waiting change, the oldest first.
export async function listMutations(): Promise<PendingChange[]> {
  const rows = await getDb().getAllAsync<Row>(`SELECT ${COLUMNS} FROM mutations ORDER BY updated_at ASC, entry_id ASC`);
  const changes: PendingChange[] = [];
  for (const row of rows) {
    const change = await toChange(row);
    if (change !== null) changes.push(change);
  }
  return changes;
}

export async function countMutations(): Promise<number> {
  const row = await getDb().getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM mutations");
  return row?.n ?? 0;
}
