// The database schema as numbered migrations (step 24). database.ts runs the ones a file has not had yet, in one transaction,
// and records how many there are in PRAGMA user_version. A migration that has shipped is never edited: a change is a new
// entry at the end of the list. Each entry is a list of fixed statements, so no value is ever put into SQL text.
//
// What is encrypted is the words. The columns outbox.text, entries_cache.row_json and affirmations_cache.row_json hold a token
// made by fieldCrypto.ts, never plain text. Everything else is bookkeeping: ids, statuses, counts and times.
export const MIGRATIONS: readonly (readonly string[])[] = [
  // Version 1.
  [
    // A reflection saved on this phone that has not been prepared yet. The recording of a voice entry is not here: it is the file
    // recordings/{client_entry_id}.m4a (step 23), and its address is rebuilt from the id.
    `CREATE TABLE outbox (
      client_entry_id TEXT PRIMARY KEY NOT NULL,
      input_type TEXT NOT NULL CHECK (input_type IN ('text', 'audio')),
      text TEXT,
      duration_ms INTEGER,
      mime_type TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'needs_action', 'limit_reached', 'paused_auth')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      last_error_code TEXT,
      server_entry_id TEXT,
      limit_resets_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (
        (input_type = 'text' AND text IS NOT NULL AND duration_ms IS NULL AND mime_type IS NULL) OR
        (input_type = 'audio' AND text IS NULL AND duration_ms IS NOT NULL AND mime_type IS NOT NULL)
      )
    )`,
    "CREATE INDEX outbox_status_next ON outbox (status, next_attempt_at)",
    // The read cache (step 25 fills it from Supabase). row_json is the mapped JournalEntry, encrypted.
    `CREATE TABLE entries_cache (
      id TEXT PRIMARY KEY NOT NULL,
      client_entry_id TEXT UNIQUE,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX entries_cache_created ON entries_cache (created_at)",
    `CREATE TABLE affirmations_cache (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL,
      row_json TEXT NOT NULL
    )`,
    "CREATE INDEX affirmations_cache_entry ON affirmations_cache (entry_id)",
  ],
  // Version 2 (step 25): a recording that is already uploaded is not uploaded again when its reflection is sent again.
  ["ALTER TABLE outbox ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0"],
];
