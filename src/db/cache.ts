import { getDb } from "@/db/database";
import { decryptText, encryptText } from "@/db/fieldCrypto";
import type { Affirmation, JournalEntry } from "@/types";

// The read cache (step 24): the entries and affirmations this phone has seen, so Journal and Reflection can open without a
// network. Rows hold the mapped models (the same JournalEntry and Affirmation the screens use) as an encrypted JSON token.
// Step 25 fills it: the pages of the Journal and the entries Reflection opens are written here (data/entriesLive.ts), and so is
// every reflection the sync engine has prepared.
//
// A row that cannot be read (damaged, changed, or not the shape of a model) is deleted and counted as "cache_row_invalid" in
// the development log. It never breaks a list and it never logs what was in it.

function note(code: string) {
  if (__DEV__) {
    console.info(`[db] ${code}`);
  }
}

const STATUSES = ["pending", "uploading", "processing", "ready", "failed"];
const SLOTS = ["morning", "afternoon", "evening"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown): value is JournalEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.inputType === "text" || value.inputType === "audio") &&
    typeof value.status === "string" &&
    STATUSES.includes(value.status) &&
    typeof value.isCrisis === "boolean" &&
    typeof value.isLocalOnly === "boolean"
  );
}

function isAffirmation(value: unknown): value is Affirmation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.entryId === "string" &&
    typeof value.slot === "string" &&
    SLOTS.includes(value.slot) &&
    typeof value.headline === "string" &&
    typeof value.text === "string" &&
    typeof value.isFavorite === "boolean"
  );
}

async function open(token: string, check: (value: unknown) => boolean): Promise<unknown> {
  const json = await decryptText(token);
  if (json === null) return null;
  try {
    const value: unknown = JSON.parse(json);
    return check(value) ? value : null;
  } catch {
    return null;
  }
}

type EntryRow = { id: string; row_json: string };

async function readEntries(rows: EntryRow[]): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  for (const row of rows) {
    const value = await open(row.row_json, isEntry);
    if (value === null) {
      note("cache_row_invalid");
      await removeEntry(row.id);
    } else {
      entries.push(value as JournalEntry);
    }
  }
  return entries;
}

export async function upsertEntry(entry: JournalEntry): Promise<void> {
  await getDb().runAsync(
    `INSERT INTO entries_cache (id, client_entry_id, row_json, created_at, updated_at, is_prayer) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET client_entry_id = excluded.client_entry_id, row_json = excluded.row_json,
       created_at = excluded.created_at, updated_at = excluded.updated_at, is_prayer = excluded.is_prayer`,
    entry.id,
    entry.clientEntryId,
    await encryptText(JSON.stringify(entry)),
    entry.createdAt,
    entry.updatedAt,
    entry.prayer !== null ? 1 : 0,
  );
}

export async function getEntry(id: string): Promise<JournalEntry | null> {
  const row = await getDb().getFirstAsync<EntryRow>("SELECT id, row_json FROM entries_cache WHERE id = ?", id);
  return row === null ? null : ((await readEntries([row]))[0] ?? null);
}

export async function getEntryByClientId(clientEntryId: string): Promise<JournalEntry | null> {
  const row = await getDb().getFirstAsync<EntryRow>(
    "SELECT id, row_json FROM entries_cache WHERE client_entry_id = ?",
    clientEntryId,
  );
  return row === null ? null : ((await readEntries([row]))[0] ?? null);
}

// Newest first.
export async function listEntries(limit: number = 30): Promise<JournalEntry[]> {
  const rows = await getDb().getAllAsync<EntryRow>(
    "SELECT id, row_json FROM entries_cache ORDER BY created_at DESC, id DESC LIMIT ?",
    limit,
  );
  return readEntries(rows);
}

// The entries created since `sinceIso` (compared as text with created_at, so a UTC time with a margin of a day or so is the
// right bound: the caller filters again on the dates), newest first. The week's count of devotionals reads them (step 25).
export async function listEntriesSince(sinceIso: string): Promise<JournalEntry[]> {
  const rows = await getDb().getAllAsync<EntryRow>(
    "SELECT id, row_json FROM entries_cache WHERE created_at >= ? ORDER BY created_at DESC, id DESC",
    sinceIso,
  );
  return readEntries(rows);
}

// The cached entries that are prayers, newest first (step 29). A row cached before schema version 3 has not said yet whether it
// is one: it is opened this once and marked.
export async function listPrayerEntries(): Promise<JournalEntry[]> {
  const db = getDb();
  const rows = await db.getAllAsync<EntryRow & { is_prayer: number | null }>(
    "SELECT id, row_json, is_prayer FROM entries_cache WHERE is_prayer IS NOT 0 ORDER BY created_at DESC, id DESC",
  );
  const entries = await readEntries(rows);
  const unmarked = new Set(rows.filter((row) => row.is_prayer === null).map((row) => row.id));
  for (const entry of entries) {
    if (unmarked.has(entry.id)) {
      await db.runAsync("UPDATE entries_cache SET is_prayer = ? WHERE id = ?", entry.prayer !== null ? 1 : 0, entry.id);
    }
  }
  return entries.filter((entry) => entry.prayer !== null);
}

// An entry and its affirmations leave the cache together.
export async function removeEntry(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM affirmations_cache WHERE entry_id = ?", id);
  await db.runAsync("DELETE FROM entries_cache WHERE id = ?", id);
}

// Keeps every prayer, and the newest `keepNewest` other entries (and the affirmations of those), and removes the rest: Prayers
// reads its prayers from here (step 29). Returns how many went.
export async function pruneEntries(keepNewest: number = 200): Promise<number> {
  const db = getDb();
  const other = "COALESCE(is_prayer, 0) = 0";
  const keep = `SELECT id FROM entries_cache WHERE ${other} ORDER BY created_at DESC, id DESC LIMIT ?`;
  const gone = await db.runAsync(`DELETE FROM entries_cache WHERE ${other} AND id NOT IN (${keep})`, keepNewest);
  await db.runAsync(`DELETE FROM affirmations_cache WHERE entry_id NOT IN (SELECT id FROM entries_cache)`);
  return gone.changes;
}

// Replaces what the cache holds for each affirmation in the list (by id). The list is one entry's three slots.
export async function upsertAffirmations(entryId: string, list: readonly Affirmation[]): Promise<void> {
  const db = getDb();
  for (const affirmation of list) {
    await db.runAsync(
      `INSERT INTO affirmations_cache (id, entry_id, row_json) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET entry_id = excluded.entry_id, row_json = excluded.row_json`,
      affirmation.id,
      entryId,
      await encryptText(JSON.stringify(affirmation)),
    );
  }
}

// Ordered morning, afternoon, evening.
export async function listAffirmationsForEntry(entryId: string): Promise<Affirmation[]> {
  const rows = await getDb().getAllAsync<{ id: string; row_json: string }>(
    "SELECT id, row_json FROM affirmations_cache WHERE entry_id = ?",
    entryId,
  );
  const list: Affirmation[] = [];
  for (const row of rows) {
    const value = await open(row.row_json, isAffirmation);
    if (value === null) {
      note("cache_row_invalid");
      await getDb().runAsync("DELETE FROM affirmations_cache WHERE id = ?", row.id);
    } else {
      list.push(value as Affirmation);
    }
  }
  return list.sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
}

// Every entry and affirmation. (Sign-out deletes the whole file instead; this is for a reset inside a session.)
export async function clearAll(): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM affirmations_cache");
  await db.runAsync("DELETE FROM entries_cache");
}
