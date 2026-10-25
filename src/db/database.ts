import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";

import { deleteStoredFieldKey, loadFieldKey, unloadFieldKey } from "@/db/fieldCrypto";
import { MIGRATIONS } from "@/db/schema";

export type Database = SQLite.SQLiteDatabase;

// One database file per signed-in user, opened once and shared by every module through getDb() (step 24). The file is
// named after a hash of the user id, so the id itself never appears in a file name or a log. Everything here that
// opens, closes or deletes a file runs one at a time (`serialize`): the auth bridge can open and close in quick
// succession, and a second open must not start while the first is still migrating.
//
// There is one connection and one transaction style, on purpose: withExclusiveTransactionAsync opens a second connection
// (expo-sqlite's docs), and the migration below needs nothing else running while it works.
class DatabaseNotOpenError extends Error {
  constructor() {
    super("The database is not open");
    this.name = "DatabaseNotOpenError";
  }
}

let current: { db: Database; hash: string } | null = null;
let lifecycle: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = lifecycle.then(task, task);
  lifecycle = run.catch(() => undefined);
  return run;
}

// Allowed in the log: a short code. Never an id, a path, a key or a word the person wrote.
function note(code: string) {
  if (__DEV__) {
    console.info(`[db] ${code}`);
  }
}

// The first 16 hex characters of SHA-256 of the Clerk user id. File names, the keychain entry and the notification
// identifiers (step 28) use it.
export async function userHash(userId: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, userId);
  return hex.slice(0, 16);
}

export function databaseName(hash: string): string {
  return `gracehush-${hash}.db`;
}

export function isDatabaseOpen(): boolean {
  return current !== null;
}

export function getDb(): Database {
  if (current === null) throw new DatabaseNotOpenError();
  return current.db;
}

async function schemaVersion(db: Pick<Database, "getFirstAsync">): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  return row?.user_version ?? 0;
}

// Brings a database up to the latest schema. The statements and the new version go in one transaction, so a failure
// leaves the file as it was. A file from a newer app is refused, never changed.
export async function migrate(
  db: Pick<Database, "execAsync" | "getFirstAsync" | "withTransactionAsync">,
  migrations: readonly (readonly string[])[] = MIGRATIONS,
): Promise<void> {
  const from = await schemaVersion(db);
  if (from > migrations.length) throw new Error("The database is newer than this app supports");
  if (from === migrations.length) return;
  await db.withTransactionAsync(async () => {
    for (const statements of migrations.slice(from)) {
      for (const statement of statements) {
        await db.execAsync(statement);
      }
    }
    await db.execAsync(`PRAGMA user_version = ${migrations.length}`);
  });
}

async function closeNow(): Promise<void> {
  const open = current;
  current = null;
  unloadFieldKey();
  if (open !== null) await open.db.closeAsync().catch(() => undefined);
}

async function openFile(hash: string, mayReset: boolean): Promise<Database> {
  const db = await SQLite.openDatabaseAsync(databaseName(hash));
  try {
    await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    const isNew = (await schemaVersion(db)) === 0;
    // A new file gets a key. An existing file needs its key: without it the words in it can never be read again.
    const hasKey = await loadFieldKey(hash, isNew);
    if (!hasKey) {
      if (!mayReset) throw new Error("The database key is missing");
      // The only case where a file is thrown away, and it holds nothing that can be read: start again with a new key.
      await db.closeAsync();
      await SQLite.deleteDatabaseAsync(databaseName(hash));
      note("db_key_reset");
      return openFile(hash, false);
    }
    await migrate(db);
    current = { db, hash };
    return db;
  } catch (error) {
    await db.closeAsync().catch(() => undefined);
    unloadFieldKey();
    throw error;
  }
}

// Opens (and creates, and migrates) this user's database, closing another user's first.
export function openUserDatabase(userId: string): Promise<Database> {
  return serialize(async () => {
    const hash = await userHash(userId);
    if (current?.hash === hash) return current.db;
    await closeNow();
    return openFile(hash, true);
  });
}

export function closeUserDatabase(): Promise<void> {
  return serialize(closeNow);
}

// Sign-out and account deletion. It never throws: whatever happens to the file, the key goes too, so a file that stays can
// never be read.
export function deleteUserDatabase(userId: string): Promise<void> {
  return serialize(async () => {
    const hash = await userHash(userId);
    if (current?.hash === hash) await closeNow();
    try {
      // expo-sqlite also removes the -wal, -shm and -journal files next to it.
      await SQLite.deleteDatabaseAsync(databaseName(hash));
    } catch {
      // There was no file, or it could not be removed.
    }
    await deleteStoredFieldKey(hash).catch(() => undefined);
  });
}
