# 24-offline-cache-sync.md

Read AGENTS.md first and follow it strictly.

Make Gracehush work offline. Every new entry (voice or text) is saved on
the device first in an encrypted SQLite outbox, then a sync engine sends
it when the device is online, with retries and clear states. Add real
connectivity detection, show pending entries on Journal Home, clean up
old recordings, and clear the account's local data on sign out. The
network step (upload + process-entry) stays mocked behind one interface;
step 25 replaces it with the real calls and fills the read cache from
Supabase. Screens keep their exact look except for the pending states
described here.

AGENTS.md requires approval before installing dependencies and changing
native config. Ask where this prompt says ask.

Docs (source of truth, follow exactly):

- https://docs.expo.dev/versions/latest/sdk/sqlite/
  (openDatabaseAsync, runAsync / getAllAsync / getFirstAsync with bound
  params, withExclusiveTransactionAsync, PRAGMA user_version migrations,
  WAL, SQLCipher via useSQLCipher + PRAGMA key)
- https://docs.expo.dev/versions/latest/sdk/securestore/
- https://docs.expo.dev/versions/latest/sdk/crypto/
- https://github.com/react-native-netinfo/react-native-netinfo
- https://docs.expo.dev/versions/latest/sdk/filesystem/

---

## 1. Before writing code

1. Read src/data/journalRepository.ts (submitEntry // TEMP(25), list and
   get functions), src/data/mappers.ts, src/types/index.ts
   (ProcessingStatus, ProcessEntryRequest, ProcessEntryErrorCode,
   RecordedAudio), src/screens/NewEntryScreen.tsx (submit + Processing
   overlay + // TODO(24)), src/hooks/useJournalHome.ts (// TODO(24):
   NetInfo), the offline banner and pending card from step 09,
   src/services/recordingFiles.ts and mediaUpload.ts (step 23),
   src/services/account.ts (signOutCleanup // TODO(24)),
   src/store/devStore.ts and package.json.
2. Check packages; ask before each install, then `npx expo install`:
   - expo-sqlite (required)
   - @react-native-community/netinfo (required for the real banner)
   - expo-secure-store and expo-crypto must already be installed (steps
     05 and 10). If not, stop and ask.
3. Ask: "Encrypt the on-device journal cache with SQLCipher? It needs a
   native rebuild." On yes, add to app.json / app.config.ts:
   ["expo-sqlite", { "useSQLCipher": true }]
   then `npx expo prebuild --clean` and rebuild Android (step 05b; the
   iPhone stays on Expo Go for now). On no,
   build everything else unencrypted and write in the report: "Local
   cache is not encrypted."

---

## 2. Database: src/db/database.ts

openUserDatabase(userId: string): Promise<SQLiteDatabase>
getDb(): SQLiteDatabase // throws if not open
closeUserDatabase(): Promise<void>
deleteUserDatabase(userId: string): Promise<void>

- File name: `gracehush-${hash}.db`, where hash = first 16 hex chars of
  SHA-256(userId) via expo-crypto. Never put the raw user id in a file
  name or log.
- One open connection at a time, module scope. Opening for a different
  user closes the previous one first.
- SQLCipher on: the key is 32 random bytes (Crypto.getRandomBytes) as
  hex, stored in SecureStore under `gracehush.dbkey.${hash}` with
  keychainAccessible WHEN_UNLOCKED_THIS_DEVICE_ONLY. The first statement
  after opening is `PRAGMA key = "x'<hex>'"` (raw-key form, no user
  input involved). Missing key for an existing file means it can't be
  read: delete the file, create a new one, and log "db_key_reset" only.
- Then: PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON.
- Migrations with PRAGMA user_version, inside
  withExclusiveTransactionAsync. Version 1 = section 3. Future changes
  only add new versions.
- Open it in the step 17 SupabaseAuthBridge when userId becomes
  available, before the sync engine starts. Screens wait for a
  `dbReady` flag (small Zustand slice, not persisted). Show the existing
  loading state while waiting.
- All queries use bound parameters (? or $name). Never build SQL with
  string interpolation of any value. execAsync only for fixed DDL and
  PRAGMAs.

---

## 3. Schema (version 1): src/db/schema.ts

outbox
client_entry_id TEXT PRIMARY KEY
input_type TEXT NOT NULL CHECK (input_type IN ('text','audio'))
text TEXT -- text entries only
audio_uri TEXT -- local file, audio only
duration_ms INTEGER
mime_type TEXT
status TEXT NOT NULL CHECK (status IN
('queued','sending','needs_action','limit_reached','paused_auth'))
attempts INTEGER NOT NULL DEFAULT 0
next_attempt_at INTEGER NOT NULL -- epoch ms
last_error_code TEXT
server_entry_id TEXT
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL

entries_cache
id TEXT PRIMARY KEY -- server entry id
client_entry_id TEXT UNIQUE
row_json TEXT NOT NULL -- mapped JournalEntry JSON
created_at TEXT NOT NULL -- ISO, for ordering
updated_at TEXT NOT NULL

affirmations_cache
id TEXT PRIMARY KEY
entry_id TEXT NOT NULL
row_json TEXT NOT NULL
-- index on entry_id

meta
key TEXT PRIMARY KEY
value TEXT NOT NULL

- Indexes: outbox(status, next_attempt_at); entries_cache(created_at).
- row_json stores the camelCase model (mappers output) so screens read
  the same type everywhere. Validate shape on read; a bad row is
  deleted and logged as "cache_row_invalid".
- Text entries are stored here so they survive offline. This replaces
  the step 10 rule "text never persisted" with: "text is stored only in
  the encrypted (or per-account) SQLite outbox, never in AsyncStorage."
  Update that line in AGENTS.md.

---

## 4. Data modules

src/db/outbox.ts:
enqueue(item): Promise<void> // insert or ignore by id
listPending(): Promise<OutboxItem[]> // newest first
nextDue(now): Promise<OutboxItem | null>
markSending / markQueued(id, nextAttemptAt, code) /
markNeedsAction(id, code) / markLimitReached(id) /
markPausedAuth() / remove(id) / resumeAll(statuses)
countUnsent(): Promise<number>

src/db/cache.ts:
upsertEntry(entry), getEntry(id), getEntryByClientId(clientEntryId),
listEntries(limit), upsertAffirmations(entryId, list),
listAffirmationsForEntry(entryId), clearAll()
// TODO(25): filled from Supabase reads (read-through).

Types (src/types/index.ts):
type OutboxStatus = 'queued' | 'sending' | 'needs_action' |
'limit_reached' | 'paused_auth';
type OutboxItem = { clientEntryId; inputType; text: string | null;
audioUri: string | null; durationMs: number | null;
mimeType: string | null; status: OutboxStatus; attempts: number;
nextAttemptAt: number; lastErrorCode: string | null;
serverEntryId: string | null; createdAt: number };
type PendingEntry = OutboxItem & { kind: 'pending' };
Unit tests for both modules use a real in-memory database
(openDatabaseAsync(':memory:')) if the test setup supports it;
otherwise test the pure helpers (backoff, error policy) only and say so.

---

## 5. Connectivity: src/services/connectivity.ts + useConnectivity.ts

- NetInfo.addEventListener once at app start (in the bridge). Store
  { isOnline: boolean | null } in a small Zustand slice.
- isOnline = false only when isConnected === false or
  isInternetReachable === false. null (unknown) is treated as online for
  sending and hidden for the banner.
- A request that fails with NETWORK marks the state "unreachable" until
  the next NetInfo change or a successful request.
- Replace the step 09 // TODO(24) in useJournalHome: isOffline comes
  from useConnectivity in production; devStore scenario 'offline' still
  forces it in **DEV**.

---

## 6. Sync engine: src/services/syncEngine.ts

startSyncEngine(): void // idempotent
stopSyncEngine(): void
syncNow(reason): Promise<void>
subscribe(listener): unsubscribe // emits after each state change

Processor interface (src/services/entryProcessor.ts):
process(item: OutboxItem): Promise<ProcessOutcome>
type ProcessOutcome =
| { ok: true; entry: JournalEntry; affirmations: Affirmation[] }
| { ok: false; code: ProcessEntryErrorCode | 'NETWORK';
entryId?: string };
Mock implementation marked // TEMP(25): replace with
uploadRawRecording + process-entry, keep the interface. It uses
devStore.nextSubmitOutcome ('ready' | 'crisis' | 'failed' | 'limit')
plus new devStore.nextNetworkFails (boolean, **DEV** only), returns
mock entries built from the item, and waits about 1.5 s.

Rules:

- Single flight: one item at a time, never two loops. A second syncNow
  while running sets a "run again" flag.
- Triggers: engine start, app foreground (AppState 'active'), online
  regained, a new enqueue, and a timer for the earliest next_attempt_at
  while the app is active. Clear the timer on background and stop.
- Skip when offline (isOnline === false) or signed out.
- Before each send: markSending. On app start, any item left in
  'sending' becomes 'queued' (the app was closed mid-send).
- Outcome policy (src/services/syncPolicy.ts, pure, unit-tested):
  ok → cache.upsertEntry + upsertAffirmations, outbox.remove, delete the
  local recording (server has it).
  NETWORK, AI_UNAVAILABLE, INTERNAL, RATE_LIMITED, ALREADY_PROCESSING →
  queued with backoff.
  LIMIT_REACHED → limit_reached (no automatic retry); keep entryId as
  server_entry_id.
  UNAUTHORIZED → paused_auth for all items; resume on next sign-in.
  TOO_SHORT, NO_SPEECH, PAYLOAD_TOO_LARGE, INVALID_REQUEST,
  AUDIO_NOT_FOUND → needs_action (no automatic retry).
- Backoff: delays [5 s, 15 s, 60 s, 5 min, 15 min, 1 h], then 1 h,
  with ±20% jitter. ALREADY_PROCESSING always waits at least 30 s.
- limit_reached items resume (status queued, attempts 0) when the tier
  becomes trial/pro (step 16 purchase success, step 30 later) or when
  the week resets (compare with getUsage().resetsAt on foreground).
- Never run in the background. No background task library.
- Never log text, file paths or user ids. Allowed: status changes,
  error codes, attempts, delay.

---

## 7. New Entry flow change (NewEntryScreen)

On submit (speak or write), after the step 10 checks:

1. Speak: finalizeRecording (step 23) with the entry's clientEntryId.
2. outbox.enqueue({ status: 'queued', next_attempt_at: now, ... }).
   Only after this succeeds is "Saved locally" true.
3. Online (not false) → show the step 10 Processing overlay and call
   syncNow('submit'). Wait for this item's outcome via subscribe:
   ready / crisis → navigation.replace('Reflection', { entryId }).
   LIMIT_REACHED → navigation.replace('Paywall', { source: 'limit',
   entryId }) (step 16 rules).
   needs_action → the step 10 error state with the matching message
   and "Record again" / "Edit" (text), never "Try again" for these.
   retryable failure → close the overlay with a calm note: "Saved.
   We'll finish your reflection as soon as we can." and return to
   Journal.
   Still sending after 90 s → same calm note; the engine keeps going.
4. Offline → no overlay; return to Journal with the note "Saved. We'll
   prepare your reflection when you're back online."
5. The notes are inline banners on Journal Home (persist until the next
   refresh or tap), never timed toasts.
   Remove the step 10 // TODO(24) markers. Keep the leave guards.

---

## 8. Journal Home pending items

- useJournalHome merges outbox.listPending() (newest first) above the
  entries list, and refreshes on engine events.
- Pending card: reuse the step 09 offline/pending card. If none exists,
  build a variant of the entry card (same component, a `pending` prop).
  Show date, input type icon, and a status line:
  queued + offline → "Saved on this phone · Waiting to connect"
  queued / sending → "Preparing your reflection…"
  needs_action → "We couldn't finish this one" + "Review"
  limit_reached → "Saved · Unlocks with Pro or on {weekday}"
  paused_auth → "Saved · Sign in to continue"
- Never show transcript text on pending cards (privacy on a shared
  screen). Text entries show "Written reflection".
- Tap actions: needs_action → a small sheet (RN Modal) with the reason,
  "Delete" (ConfirmDialog) and, for text, "Edit and resend"; for audio,
  "Delete" only. limit_reached → Paywall { source: 'limit', entryId }.
- Offline banner (step 09) shows the unsent count: "You're offline.
  {n} reflections are saved on this phone." (singular form for 1).
- Reflection opened for a pending item shows the existing processing
  state, not "not found".

---

## 9. Recording cleanup: src/services/recordingCleanup.ts

- On engine start (once per app launch): list recordings/ files. Delete
  any file whose clientEntryId has no outbox row and is older than 7
  days (file modification time). Never delete a file that has an outbox
  row.
- Remove the step 23 // TODO(24).

---

## 10. Sign out and delete account

signOutCleanup (step 15) now:

1. stopSyncEngine.
2. If outbox.countUnsent() > 0 and this is a normal sign out, the sign
   out dialog body becomes: "{n} reflections on this phone haven't been
   sent yet. If you sign out, they'll be deleted from this phone."
   Confirm "Sign out anyway", cancel "Stay signed in". (Count is read
   before showing the dialog; add it to the step 15 dialog, same
   component.)
3. closeUserDatabase, deleteUserDatabase(userId) (file + WAL/SHM files
   - SecureStore key), delete every file in recordings/.
4. Then the existing steps (player stop, caches, Clerk signOut).
   Delete account always runs 3 without asking about unsent items (the
   step 15 dialog already warns that everything is removed).
   Remove the step 15 // TODO(24).

---

## 11. Dev tools (DevToolsPanel, **DEV** only)

- nextNetworkFails toggle.
- "Outbox": counts per status (numbers only).
- "Sync now" button.
- "Open SQLite inspector" note: Shift + M in the Expo CLI terminal →
  expo-sqlite (from the docs). With SQLCipher on, the inspector may not
  read the file; that's expected.

---

## 12. Rules

- Only the dependencies approved in section 1. No `any`.
- No changes to layouts beyond the pending card variant, banners and
  sheet described here. All new strings go in copy.ts.
- Never store journal text in AsyncStorage. Never log text, paths,
  user ids or keys.
- Bound parameters in every query.

---

## 13. Verify (dev build, physical devices)

Run `npx expo start -c`, `npm run lint`, `npm run typecheck`, then:

1. Airplane mode: record and write one entry each. Both appear as
   "Waiting to connect"; the banner says 2 reflections.
2. Kill the app, reopen offline: both are still there.
3. Turn airplane mode off: both become "Preparing…" then ready (mock),
   one at a time. Recordings are deleted after ready.
4. nextNetworkFails on: the item retries at about 5 s, 15 s, 60 s (check
   logs), and stops retrying while the app is in the background.
5. nextSubmitOutcome 'limit': limit_reached card; mock purchase in
   Paywall → it sends automatically.
6. A needs_action item (simulate TOO_SHORT in the mock): Review sheet,
   Delete works, Edit and resend for text works with the same
   clientEntryId.
7. Close the app during "Preparing…", reopen: the item goes back to
   queued and finishes once (no duplicate entry).
8. Sign out with unsent items: the dialog shows the count; Stay keeps
   everything; Sign out anyway removes the database file, its key and
   recordings.
9. Second account on the same phone: sees none of the first account's
   pending items.
10. With SQLCipher on: copy the .db file from a simulator and try to
    open it with a plain SQLite tool; it must not be readable.
11. NetInfo unknown (right after launch): no offline banner flash.

Report: packages installed; SQLCipher decision; database file and key
naming; schema version; the error policy table; files created, changed
and deleted; test results 1–11; and every TODO left for steps 25 and 30.
