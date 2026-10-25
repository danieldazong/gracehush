# 24-offline-cache-sync.md

Read AGENTS.md first and follow it strictly.

Make Gracehush work offline. Every new reflection (voice or written) is saved on the phone first, in a per-user SQLite **outbox** whose words are encrypted, and a **sync engine** prepares it when the phone can reach the server, with retries and clear states. Add real connectivity detection, show the unsent reflections on Journal Home as entry-shaped cards, let the person review and delete one the server refused, clean up old recordings, and delete the account's local data on sign out. The network step (upload and `process-entry`) stays mocked behind **one interface**, `src/services/entryProcessor.ts`: step 25 replaces its inside with the real calls and fills the read cache from Supabase. Screens keep their look, except for the pending card, two calm banners, one dialog and the New Entry failure view described here.

**The code is written and proven.** The old text of this step was a specification written before steps 17 to 23 were built, for a development build and a physical device that this project does not have (you test on an iPhone in Expo Go). The review checked it against the installed packages and the repo and found it wrong or impossible in several places (below). So this prompt carries the finished files word for word (sections 1 and 2) and the checks that prove them (section 3). They were proven in a copy of the repo outside the project: `tsc` and ESLint (with the React Compiler rules) clean, the Android and iOS bundles build, **44 Node checks** pass on real SQL (Node's own SQLite behind a fake shaped like expo-sqlite 58's) with fakes of the keychain, NetInfo, AppState, the recordings folder and the processor, and **52 deliberate breakages** of the code were each caught by a named check. What the review could not do, because it has no phone: anything that needs the native SQLite module, the keychain, NetInfo's real events or Airplane mode. That part is yours, written out step by step in "What you do yourself".

AGENTS.md requires approval before installing a dependency and before changing native config. The two installs are named under "Decisions": your go-ahead on this prompt approves them, and you can strike either one. **No native config changes**: no prebuild, no `eas.json`, no development build, nothing in `app.json`.

Sources, read in the review on 2026-10-25 (the packages themselves, not web pages, so they are the versions this app really runs):

- `expo-sqlite` 58.0.14 (the package was downloaded and read, not installed: `src/SQLiteDatabase.ts`, `ios/DatabaseFileUtils.swift`, `android/.../SQLiteHelpers.kt`, `plugin/src/withSQLite.ts`) and its one dependency `await-lock` 2.2.2; `@react-native-community/netinfo` 12.0.1; `node_modules/expo/bundledNativeModules.json` (the SDK 58 versions of both)
- `expo-crypto` 58.0.7 (the AES API in its type files) and `expo-secure-store` 58.0.2, both already installed
- the code of steps 05 to 23 (`src/`, `supabase/functions/process-entry/` for the error codes and the 402 body), `AGENTS.md`, and prompts 25, 26, 28, 29, 30, 33 and 35 (they call what this step builds)

---

## What the review found (these changed the prompt)

1. **Wrong paths and names in the old text.** `src/screens/NewEntryScreen.tsx` is `src/screens/journal/NewEntryScreen.tsx`. "The offline banner and pending card from step 09" are `src/components/OfflineBanner.tsx` and the `pending` kind of `src/components/JournalCard.tsx` (a chip, "Waiting to sync", on a card that is one labelled element). `submitEntry` lives in `src/data/journalRepository.ts` and is replaced here by `processMock`. `src/db/` and `src/lib/` do not exist: the new database code goes in `src/db/` (the one new folder), the rest in `src/services/`, `src/store/`, `src/data/` and `src/components/`. `**DEV**` is `__DEV__`.
2. **SQLCipher cannot be had, so the old decision 3 (the question about it) is made: no.** expo-sqlite's own docs say SQLCipher is not available in Expo Go. It is the config-plugin option `useSQLCipher`, which needs a native build that does not exist (no `ios/`, no `android/`, no `eas.json`, and the Apple account is last). Its key must also be applied to every connection, including the second one `withExclusiveTransactionAsync` opens. And a plain file cannot be turned into an encrypted one in place. **What is built instead: the words are encrypted by the app**, with expo-crypto's native AES (AES-256-GCM, native since SDK 55, so it runs in Expo Go and in every later build, and it adds no package). One random 256-bit key per signed-in user lives in SecureStore (`gracehush.dbkey.{hash}`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, this device only), and each value is sealed on its own: `"v1."` plus base64 of a 12-byte nonce, the ciphertext and the 16-byte tag. Sealed: a written entry in the outbox, and the entries and affirmations in the read cache. Not sealed: ids, statuses, counts and times. A file that is restored on another phone has no key there, so it cannot be read: the code deletes it and starts again (`db_key_reset`). The harness reads the bytes of the database and WAL files and finds none of the words.
3. **One connection, one transaction style.** `withExclusiveTransactionAsync` opens a second connection (docs), and the migration needs nothing else running, so everything uses one connection and `withTransactionAsync`. Opens, closes and deletes run one at a time (a queue), because the auth bridge can open and close in quick succession.
4. **The `audio_uri` column is gone.** A voice entry's file is `recordings/{clientEntryId}.m4a` (step 23): the address is rebuilt from the id. A stored `file://` path would point nowhere after an app update or a restore (step 23's note). There is no `meta` table either: nothing keeps a fact there yet, and step 28 can add its own table as migration 2. The schema has one extra column the old text lacked, `limit_resets_at` (see 7).
5. **"Record again" after a refusal needs a new `clientEntryId`.** The server keeps a refused entry under its id, and an upload never overwrites (step 18), so sending a second recording under the old id would re-process the old audio. After a refusal the item and its file are deleted and the next take gets a new id. A refused **written** reflection keeps its id: "Edit" and Journal's "Edit and resend" put the new words back under the same id (`enqueue` takes a refused written item back into the queue).
6. **A mock answer must never reach the persistent cache.** The mock's entries live in the in-memory mock database, which is rebuilt at every start: a persisted copy would outlive it and show a reflection that exists nowhere. `entryProcessor.ts` exports `processorIsMock` (true until step 25); while it is true the engine writes nothing to `entries_cache`.
7. **The free limit's week comes from the 402, not from `getUsage()`.** `getUsage()` is fixed mock data. The real 402 carries `usage.resetsAt` and the saved `entryId` (step 22), so the item stores both (`limit_resets_at`, `server_entry_id`). A held item goes again when its week ends (a timer, while the app is open) or when the plan this phone knows is paid (`getKnownTier()`: the mock plan or the profile sync's plan, so a purchase made on another phone counts too). `purchases.ts` also calls `resumeAfterUpgrade()` at once after a purchase or a restore.
8. **Retry storms and stuck queues.** `process-entry` refuses an eleventh entry within ten minutes (`RATE_LIMITED`) and keeps a claim for up to three minutes (`ALREADY_PROCESSING`), so the backoff has minimums (60 s and 30 s). One run at a time; a generation counter drops every result that arrives after sign-out; a call that never answers counts as `NETWORK` after 200 s (the server stops a request at 150); the timer runs only while the app is in front and the phone can send; coming back online or to the front starts a run. A refused session pauses everything and is asked again **once per visit**, never on a timer.
9. **Words on a card, and a card with a button.** A pending card never shows what was written or said (a screen can be seen by someone else): a written one says "Written reflection". A card with a button of its own (Review, See plans) is not one grouped accessibility element, or VoiceOver could not reach its button (AGENTS.md: a `Pressable` groups its children).
10. **No stacked Modals.** The old text opened a ConfirmDialog from inside a Modal sheet: the fragile case on iOS (AGENTS.md). Review is one `ConfirmDialog` with two steps, as Profile's delete dialog is.
11. **Claims the app could not keep are gone.** New Entry's header said "Saved locally" next to text that is saved nowhere until Submit (drafts are not built): the line is removed. The overlay said "You can close the app. Your reflection will be waiting in your Journal": nothing runs while the app is closed, so it now says the reflection is saved on the phone and "will finish in your Journal" if you leave the screen. The Journal's "All reflections synced" toast is shown only when nothing is left to send.
12. **Journal is reached with `popTo`, not `goBack`.** The dock opens New Entry from any tab, so `goBack` could land on Profile and hide the saved note. Reflection's own `popTo("MainTabs", { screen: "Journal" })` is used. A reflection the free limit held back opens the Paywall with an `entryId` (the server's, or else the client id): the Paywall's banner ("Your reflection is saved.") then shows and its crisis check works, because `getEntry()` answers a client id from the outbox with an entry that is not finished (Reflection shows "still being prepared", never "not found").
13. **The Journal waits for the database.** Screens show their loading state until the user's database is open (`dbReady`); a database that could not be opened shows the existing error state, and "Try again" opens it again. The pending list follows the engine's events while the screen is in front.
14. **Sign out.** The count in the dialog is what the server has never been given (everything in the outbox except what the free limit holds, which the server saved). `signOutCleanup()` stops the engine, deletes the database file, its sidecar files and its key, and keeps the line that deletes every recording. `deleteUserDatabase` never throws, and deletes the key even when the file is already gone.
15. **Dead code the old text asked for is dropped:** a `useConnectivity` hook (Journal reads the store), the `meta` table, a `PendingEntry` type, `resumeAll`. The failed card's disabled "Try again" pill stays for an entry the server marked failed (its marker moves to `TODO(25)`), because the phone has no copy of that entry's words to send again.
16. **Words that cannot be opened.** A written item whose key is gone (it cannot happen unless the keychain was wiped while the file stayed) is never sent: it becomes `needs_action` with the code `UNREADABLE`, and Review offers only Delete.

---

## What you do yourself (read this first)

The implementer cannot do this part: it needs your iPhone and Airplane mode. If you would rather be walked through it one instruction at a time, with a screenshot after each, say "guide me" (that is how steps 17 to 23 went).

### Keys and settings: nothing new (checked in the review, by names only)

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set. This step adds nothing to it. |
| `supabase/functions/.env.local` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `CLERK_ISSUER`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE` | all set. Not touched by this step. |

Nothing to do in Supabase, Clerk, Google Cloud or RevenueCat: the network step stays mocked, so there is no migration, no policy change, no Edge Function change, no deploy and no secret. The encryption key is made on the phone, in its keychain, the first time a user signs in; there is nothing to create or paste.

### A. Before the phone tests

1. Say yes to implement. That approves `npx expo install expo-sqlite @react-native-community/netinfo` (see Decisions), unless you strike it.
2. When the implementer is done, **restart Metro** with `npx expo start -c` (`package.json` changed, new files add modules and classes), then force-quit and reopen Expo Go. Both packages are in Expo Go SDK 58's native modules, so no new build is needed.
3. Your iPhone has Expo Go SDK 58 and you are signed in as yourself. The developer controls are at the bottom of the Profile tab, under "Developer": "Next submit" (now with `too_short`), "Fail next network call", "Outbox" (the counts per state and a "Sync now" button) and the mock plan.

### B. Phone walk-through (iPhone, Expo Go)

Expo Go cannot start a project while Metro is out of reach, so to test a restart offline, **kill Expo Go while Airplane mode is on, turn Airplane mode off, then reopen Expo Go**. Tell the implementer what you saw after each. The captions are drawn in capitals on some screens; the words below are how they are written.

1. **Offline save.** Turn Airplane mode on (Expo Go keeps running). Write a reflection (at least 10 characters) and submit: the screen leaves New Entry without an overlay and lands on Journal with the line "Saved. We’ll prepare your reflection when you’re back online." and the banner "Offline mode … 1 reflection is saved…". The card reads "Written reflection" (never your words) and "Saved on this phone · Waiting to connect". Record a voice reflection (a few seconds) and finish it: two cards, the banner says 2.
2. **Back online.** Turn Airplane mode off: the cards change to "Preparing your reflection…", one at a time, and each becomes a normal card (about 4 seconds each: the mock). "Outbox (dev)" ends at all zeros. The "All reflections synced" toast does **not** show while cards are still waiting.
3. **Kill while queued.** With Airplane mode on, queue one reflection, swipe Expo Go away, turn Airplane mode off, reopen Expo Go: the card is there, then it is prepared by itself.
4. **A call that gets no answer.** Press "Fail next network call (dev)", then submit a written reflection online: the overlay shows for about a second, closes to Journal with "Saved. We’ll finish your reflection as soon as we can.", and the card finishes by itself about 5 seconds later. Press the button again right after the first failure to see the second wait (about 15 seconds). Send the app to the Home screen while a retry is waiting: nothing is sent until you come back, and then it is.
5. **The free limit.** Set "Next submit" to `limit` and submit: the overlay, then the Paywall with "Your reflection is saved." (close it with the X). The Journal card reads "Saved · Unlocks with Pro or on {the weekday}" with a "See plans" button. Open "See plans", set the mock plan to Pro with the purchase (or press `pro` under "Mock plan (dev)"): the card becomes "Preparing your reflection…" and then a normal card.
6. **A refusal only you can fix.** Set "Next submit" to `too_short` and submit a written reflection: the overlay says "We couldn’t finish this reflection." with the reason and **Edit** (never "Try again"). Tap Close: the card says "We couldn’t finish this one." with **Review**. Review shows the reason; **Edit and resend** opens New Entry with your words; change them and submit: the card goes away and a normal one appears. Try Review, then Delete (a second step asks "Delete this reflection?"), and the same with a voice reflection (there, Review offers only Delete, and the overlay offers "Record again").
7. **Kill while preparing.** Submit online and, within 3 seconds, kill Expo Go; reopen it: the reflection is queued again and finishes once (one new card). (The mock database is in memory, so only one card means the queue did its job.)
8. **Sign out with unsent reflections.** Keep one on the list that will not go by itself: set "Next submit" to `too_short`, submit a written reflection and tap Close on the failure view (the card says "We couldn’t finish this one."). Then Profile, Sign Out: the dialog says "1 reflection on this phone hasn’t been sent yet…", with "Sign out anyway" and "Stay signed in". Stay: nothing changes. Sign out anyway, sign in again: no pending cards, and "Recordings (dev)" says 0. (A reflection the free limit holds is not counted: the server has it.)
9. **A second account.** Sign in with another account on the same phone: it sees none of the first account's pending cards.
10. **No offline flash.** Force-quit and reopen the app with a good connection: the "Offline mode" banner must not flash while it starts.

Not testable on an iPhone in Expo Go, and said so in the report: that the database file holds no readable words (the harness proves it on the file's bytes), and the SQLite inspector (Shift + M in the terminal running `expo start`: untested here).

### C. Android (optional, and only with your yes)

The emulator window holds your own signed-in account, so opening the app there runs it against your real project. The implementer asks first. If you say no, Android is reported "not verified".

### If something goes wrong: what it means

| what you see | what it means |
| --- | --- |
| Journal shows "We couldn’t load your reflections." right after a fresh start, and "Try again" fixes it | the database could not be opened the first time (the keychain was locked, or the disk is full). Tell the implementer if it repeats. |
| a submit shows "We couldn’t save this reflection." | the phone could not write to its own database: "Try again" tries once more, "Keep editing" keeps your words on screen. |
| a card says "Saved · Sign in to continue" | the server refused your session; the next time the app comes to the front it asks once more. Press "Supabase check (dev)" on Profile and sign in again if it stays. |
| "Outbox (dev)" says "the database is not open" | nobody is signed in, or the database failed to open. |
| every reflection waits "Waiting to connect" although the phone is online | NetInfo reports no internet. Try loading a web page; turn Wi-Fi off and on. |

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **Packages.** `npx expo install expo-sqlite @react-native-community/netinfo`: the local database and the connectivity events. `await-lock` comes with `expo-sqlite` (its one dependency). `expo-crypto` and `expo-secure-store` are already installed (steps 05 and 10). No other package, no removal.
2. **Encryption.** The words are sealed by the app with AES-256-GCM (finding 2): no SQLCipher, no native change. This **answers the old "ask": SQLCipher is not used**, and the report says "the words are encrypted, the bookkeeping is not".
3. **One database file per user**, `gracehush-{first 16 hex of SHA-256(userId)}.db`, one open connection, migrations by `PRAGMA user_version` inside one transaction (a file from a newer app is refused and left alone). The raw user id is never in a file name, a key name or a log.
4. **Schema version 1:** `outbox`, `entries_cache`, `affirmations_cache` (finding 4). Every query binds its values; no value is ever put into SQL text.
5. **The sync engine** (`src/services/syncEngine.ts`): the rules of finding 8, one failure policy table (`src/services/syncPolicy.ts`: `retry`, `limit`, `pause_auth`, `needs_action`; an unknown code is retried, never dropped), backoff 5 s, 15 s, 60 s, 5 min, 15 min, then 1 h, with 20% jitter, FIFO, never in the background, nothing logged but states, codes, counts and delays.
6. **The processor interface** (`entryProcessor.ts`): `processItem(item, onStage)` answers a `ProcessOutcome`. The mock (`processMock` in the repository, `TEMP(25)`) answers the dev store's `nextSubmitOutcome` (`ready`, `crisis`, `failed`, `limit`, and the new `too_short`) or, when the new one-shot `nextNetworkFails` is set, no answer.
7. **Journal.** Unsent reflections are entry-shaped cards above the entries (`HomeEntry = JournalEntry & { pending? }`), each with the status line of the old text (queued offline, preparing, refused with **Review**, held by the limit with **See plans**, paused for sign-in). Two calm banner kinds, never toasts: the offline banner counts only what the phone will send by itself, and a "saved" note that stays until dismissed or the list is refreshed.
8. **New Entry** saves first, then waits for the engine up to 90 seconds with the existing overlay (finding 12), and the overlay's failure view now has two kinds: the phone could not save it, or the server refused it. "Saved locally" is removed from the header (finding 11): this is a visual change to an approved screen, flagged here; say so if you would rather keep the line and build draft saving.
9. **Sign out** (finding 14) and **account deletion** both delete the user's database and key; deletion does not ask about unsent items (its dialog already says everything is removed).
10. **Recordings** with no outbox item that are over 7 days old are deleted once per launch (`recordingCleanup.ts`); a recording of unknown age and one with an item are never touched.
11. **A reflection the free limit holds** goes again when the plan is paid or the week ends (finding 7); `resumeAfterUpgrade()` is the one call a purchase makes.
12. **Two flagged limits, not decided:** (a) the database and the recordings live in the app's document folder, which iOS includes in iCloud and computer backups; the words are sealed with a key that is not in backups, so a restored phone cannot read them (the file is reset), but the bookkeeping and the recordings are in the backup; (b) if an account's session ends without a sign-out (Clerk revokes it) and a **different** account signs in on the phone, the first account's queued recordings have no item in the second account's database, so after 7 days they are cleaned: per-account recording folders would fix it and are a later change.

---

## 0. Before you write code

1. Read AGENTS.md (the new "Local Cache & Offline Rules", the vendor note on expo-sqlite, expo-crypto AES and NetInfo, the Audio Rules, "Haptics") and these files: `src/data/journalRepository.ts` (`submitEntry`, `getEntry`), `src/screens/journal/NewEntryScreen.tsx`, `ProcessingOverlay.tsx`, `JournalFeedScreen.tsx`, `src/components/JournalCard.tsx`, `OfflineBanner.tsx`, `ConfirmDialog.tsx`, `src/hooks/useJournalHome.ts`, `useProfileSettings.ts`, `src/services/account.ts`, `purchases.ts`, `recordingFiles.ts`, `src/components/SupabaseAuthBridge.tsx`, `src/store/devStore.ts`, `src/data/mock/scenario.ts`, `src/types/index.ts`, `src/navigation/types.ts` and `package.json`.
2. Baseline, red first. `node --version` must be 22.5 or newer (the harness uses `node:sqlite`; 24.15 here). `npm run typecheck` and `npm run lint` must pass before any change. Then run `node --no-warnings supabase/tests/offline/run.cjs`: it must **fail** with `cannot resolve @/db/database` (and the same for the other new files), because the step 24 files do not exist yet. That is the red.
3. Write down what you keep. `journalRepository.ts` keeps every name it exports except `submitEntry`, which becomes `processMock` (one caller in the app, `NewEntryScreen`, which is replaced). `SubmitResult` in `src/types/index.ts` goes with it. `getEntry`'s return type widens to `HomeEntry | null` and `filterEntries` becomes generic: no caller changes.
4. Install (approved under Decision 1): `npx expo install expo-sqlite @react-native-community/netinfo`. Afterwards `package.json` must list `expo-sqlite` ~58.0.14 and `@react-native-community/netinfo` 12.0.1, `package-lock.json` must gain those two and `await-lock` and nothing else, and `npx expo install --check` and `npx expo-doctor` must pass. If the command exits 1 only because it cannot write a plugin into the dynamic `app.config.ts`, add nothing: **no `expo-sqlite` plugin entry is wanted** (no option is needed). If it changes `app.json` or anything else, undo that part.
5. `expo-crypto` and `expo-secure-store` must already be in `package.json` (they are, since steps 05 and 10). If not, stop and ask.

---

## 1. The files to create (verbatim)

These 15 files are the ones the checks in section 3 were written against. Create them exactly as shown, with LF line endings. `src/db/` is the one new folder.

### 1.1 `src/db/schema.ts`

The schema as numbered migrations. Version 1 only; a migration that has shipped is never edited, a change is a new entry at the end.

```ts
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
];
```

### 1.2 `src/db/fieldCrypto.ts`

The words are sealed here: AES-256-GCM through expo-crypto, one key per user in SecureStore. Everything else in the database is bookkeeping.

```ts
import { AESEncryptionKey, AESKeySize, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

// Encryption of the words kept in the database (step 24). AES-256-GCM through expo-crypto's native AES (CryptoKit on iOS,
// javax.crypto on Android): it runs in Expo Go and in every build, and it adds no package. One random 256-bit key per
// signed-in user lives in the keychain or keystore, on this device only and while it is unlocked. It is never kept in the
// database, in a file, in a log or in an error message. A stored value is "v1." plus the base64 of nonce (12 bytes) +
// ciphertext + tag (16 bytes). The nonce is random for every value, and the tag makes a changed value fail to open instead
// of reading as something else.
//
// SQLCipher would encrypt the whole file, but expo-sqlite's own docs say it is unavailable in Expo Go (and it needs a native
// build that does not exist yet), so the words are encrypted here instead. The file's bookkeeping (ids, statuses, counts and
// times) is not.
const TOKEN_PREFIX = "v1.";

function keyName(hash: string): string {
  return `gracehush.dbkey.${hash}`;
}

let loaded: AESEncryptionKey | null = null;

// Loads this user's key. When there is none it makes one if `create` is set. False means there is no key.
export async function loadFieldKey(hash: string, create: boolean): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(keyName(hash));
  if (stored !== null) {
    loaded = await AESEncryptionKey.import(stored, "base64");
    return true;
  }
  if (!create) return false;
  const fresh = await AESEncryptionKey.generate(AESKeySize.AES256);
  await SecureStore.setItemAsync(keyName(hash), await fresh.encoded("base64"), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  loaded = fresh;
  return true;
}

// Forgets the key in memory (the database closed).
export function unloadFieldKey(): void {
  loaded = null;
}

// Removes the key from the keychain. A database file that is left behind can then never be read.
export async function deleteStoredFieldKey(hash: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyName(hash));
}

export async function encryptText(plain: string): Promise<string> {
  if (loaded === null) throw new Error("The database key is not loaded");
  const sealed = await aesEncryptAsync(new TextEncoder().encode(plain), loaded);
  return TOKEN_PREFIX + (await sealed.combined("base64"));
}

// Null when the value cannot be read: it is not one of ours, it was changed, or it was made with another key. Never throws.
export async function decryptText(token: string): Promise<string | null> {
  if (loaded === null || !token.startsWith(TOKEN_PREFIX)) return null;
  try {
    const bytes = await aesDecryptAsync(AESSealedData.fromCombined(token.slice(TOKEN_PREFIX.length)), loaded);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
```

### 1.3 `src/db/database.ts`

One file per user, opened once, migrated in one transaction, closed and deleted one at a time. `getDb()` is the only way the other `src/db/` files reach the connection.

```ts
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
```

### 1.4 `src/db/outbox.ts`

The queue of reflections saved on this phone that are not prepared yet. Every query binds its values.

```ts
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
```

### 1.5 `src/db/cache.ts`

The read cache (entries and affirmations the phone has seen). Step 25 fills it; the engine already writes to it once the processor is real.

```ts
import { getDb } from "@/db/database";
import { decryptText, encryptText } from "@/db/fieldCrypto";
import type { Affirmation, JournalEntry } from "@/types";

// The read cache (step 24): the entries and affirmations this phone has seen, so Journal and Reflection can open without a
// network. Rows hold the mapped models (the same JournalEntry and Affirmation the screens use) as an encrypted JSON token.
// Step 25 fills it from Supabase; until then nothing writes here, and it is tested on its own.
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
    `INSERT INTO entries_cache (id, client_entry_id, row_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET client_entry_id = excluded.client_entry_id, row_json = excluded.row_json,
       created_at = excluded.created_at, updated_at = excluded.updated_at`,
    entry.id,
    entry.clientEntryId,
    await encryptText(JSON.stringify(entry)),
    entry.createdAt,
    entry.updatedAt,
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

// An entry and its affirmations leave the cache together.
export async function removeEntry(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM affirmations_cache WHERE entry_id = ?", id);
  await db.runAsync("DELETE FROM entries_cache WHERE id = ?", id);
}

// Keeps the newest `keepNewest` entries (and the affirmations of those) and removes the rest. Returns how many went.
export async function pruneEntries(keepNewest: number = 200): Promise<number> {
  const db = getDb();
  const keep = `SELECT id FROM entries_cache ORDER BY created_at DESC, id DESC LIMIT ?`;
  const gone = await db.runAsync(`DELETE FROM entries_cache WHERE id NOT IN (${keep})`, keepNewest);
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
```

### 1.6 `src/store/offlineStore.ts`

The transient state of the offline machinery: is the database ready, what NetInfo said, whether a request has just failed, and the "saved" note Journal shows.

```ts
import { create } from "zustand";

// The transient state of the offline machinery (step 24). Not persisted: the database and the network are asked again at every
// start. The journal's data is never mirrored here: it lives in SQLite.
export type SavedNote = "offline" | "retry";

interface OfflineState {
  // The signed-in user's database is open and migrated, or it could not be opened. Neither is true while it is opening
  // and when nobody is signed in.
  dbReady: boolean;
  dbFailed: boolean;
  setDatabase: (state: "ready" | "failed" | "closed") => void;
  // What NetInfo last said. null is "not known yet": it counts as online for sending and shows no banner.
  netConnected: boolean | null;
  netReachable: boolean | null;
  // A request failed with NETWORK since NetInfo last changed or a request last got an answer.
  unreachable: boolean;
  // Every NetInfo event clears `unreachable`.
  setNet: (connected: boolean | null, reachable: boolean | null) => void;
  setUnreachable: (value: boolean) => void;
  // The calm line Journal shows after New Entry saved something that has not been prepared yet. Never a toast.
  savedNote: SavedNote | null;
  setSavedNote: (note: SavedNote | null) => void;
}

export const useOfflineStore = create<OfflineState>()((set) => ({
  dbReady: false,
  dbFailed: false,
  setDatabase: (state) => set({ dbReady: state === "ready", dbFailed: state === "failed" }),
  netConnected: null,
  netReachable: null,
  unreachable: false,
  setNet: (netConnected, netReachable) => set({ netConnected, netReachable, unreachable: false }),
  setUnreachable: (unreachable) => set({ unreachable }),
  savedNote: null,
  setSavedNote: (savedNote) => set({ savedNote }),
}));

type NetworkFacts = Pick<OfflineState, "netConnected" | "netReachable" | "unreachable">;

// For the banner and the "synced" toast: false when NetInfo says there is no connection or no internet, or a request has just
// failed; null while nothing is known yet; otherwise true.
export function selectIsOnline(state: NetworkFacts): boolean | null {
  if (state.unreachable || state.netConnected === false || state.netReachable === false) return false;
  if (state.netConnected === null && state.netReachable === null) return null;
  return true;
}

// For the sync engine: only what NetInfo knows. A failed request must not stop the retries that clear it.
export function selectCanSend(state: Pick<OfflineState, "netConnected" | "netReachable">): boolean {
  return state.netConnected !== false && state.netReachable !== false;
}
```

### 1.7 `src/services/connectivity.ts`

Hands NetInfo's answers to the store. One listener for the app.

```ts
import NetInfo from "@react-native-community/netinfo";

import { useOfflineStore } from "@/store/offlineStore";

// Hands NetInfo's answers to the offline store (step 24). One listener for the app, started by the auth bridge. NetInfo
// calls the listener with the last known state as soon as it is added, and again at every change. Its internet check
// uses the system's own reachability (useNativeReachability is on by default), so the app configures nothing.
let unsubscribe: (() => void) | null = null;

export function startConnectivity(): void {
  if (unsubscribe !== null) return;
  unsubscribe = NetInfo.addEventListener((state) => {
    useOfflineStore.getState().setNet(state.isConnected, state.isInternetReachable);
  });
}

export function stopConnectivity(): void {
  unsubscribe?.();
  unsubscribe = null;
}

// A request failed with NETWORK or got an answer. Only the first one marks the network unreachable.
export function markUnreachable(): void {
  useOfflineStore.getState().setUnreachable(true);
}

export function markReachable(): void {
  if (useOfflineStore.getState().unreachable) useOfflineStore.getState().setUnreachable(false);
}
```

### 1.8 `src/services/syncPolicy.ts`

What the engine does with each failure, and how long it waits. Pure.

```ts
// What the sync engine does with a failure (step 24). Pure, so it is tested without a device. The codes are the ones
// process-entry answers with (ProcessEntryErrorCode) plus the app's own: NETWORK (no answer), UNKNOWN (an answer the app
// does not know) and UNREADABLE (the words saved on this phone cannot be read).
//
//   retry         the same item again, later, with backoff
//   limit         the free limit: the entry is saved, and nothing is retried until the person upgrades or the week resets
//   pause_auth    the session was refused: everything waits for the next sign-in
//   needs_action  only the person can fix it: nothing is retried
export type FailureAction = "retry" | "limit" | "pause_auth" | "needs_action";

const ACTIONS: Record<string, FailureAction> = {
  NETWORK: "retry",
  AI_UNAVAILABLE: "retry",
  INTERNAL: "retry",
  RATE_LIMITED: "retry",
  ALREADY_PROCESSING: "retry",
  UNKNOWN: "retry",
  LIMIT_REACHED: "limit",
  UNAUTHORIZED: "pause_auth",
  TOO_SHORT: "needs_action",
  NO_SPEECH: "needs_action",
  PAYLOAD_TOO_LARGE: "needs_action",
  INVALID_REQUEST: "needs_action",
  AUDIO_NOT_FOUND: "needs_action",
  METHOD_NOT_ALLOWED: "needs_action",
  UNREADABLE: "needs_action",
};

// A code this table does not list is an answer the app has not met: it is tried again, never dropped.
export function classify(code: string): FailureAction {
  return ACTIONS[code] ?? "retry";
}

// 5 s, 15 s, 60 s, 5 min, 15 min, 1 h, and then 1 h again.
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000] as const;
export const JITTER = 0.2;

// Some answers mean "not yet" for longer than the first steps: the server counts entries in a 10-minute window
// (RATE_LIMITED), and a request that died leaves its claim for up to 3 minutes (ALREADY_PROCESSING).
const MIN_DELAY_MS: Record<string, number> = { RATE_LIMITED: 60_000, ALREADY_PROCESSING: 30_000 };

// `attempts` is how many times the item has been sent, this failure included (1 after the first). Plus or minus 20%, so
// a crowd of phones does not come back at the same second.
export function retryDelayMs(code: string, attempts: number, random: () => number = Math.random): number {
  const step = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1;
  const base = Math.max(BACKOFF_MS[step], MIN_DELAY_MS[code] ?? 0);
  return Math.round(base * (1 + (random() * 2 - 1) * JITTER));
}
```

### 1.9 `src/data/pendingEntries.ts`

How an outbox item shows on Journal Home: as an entry-shaped card with no words, and the merge with the server's entries.

```ts
import type { HomeEntry, JournalEntry, OutboxItem } from "@/types";

// How an outbox item shows on Journal Home (step 24): as an entry-shaped card, so the offline banner's count, the filters
// and the streak keep working as they are. It carries no words (a pending card never shows what was written or said: the
// screen can be seen by someone else) and no scripture, devotional or prayer. `id` is the client entry id: the entry has no
// server id yet, and a card that opens nothing needs only a stable key.
//
// sending            -> the "preparing" card (status processing)
// needs_action       -> the "failed" card, with Review
// everything else    -> the "waiting" card (status pending): queued, held back by the free limit, or waiting for a sign-in
export function toPendingEntry(item: OutboxItem): HomeEntry {
  const created = new Date(item.createdAt).toISOString();
  return {
    id: item.clientEntryId,
    clientEntryId: item.clientEntryId,
    createdAt: created,
    updatedAt: created,
    inputType: item.inputType,
    transcript: null,
    dominantEmotion: null,
    status: item.status === "sending" ? "processing" : item.status === "needs_action" ? "failed" : "pending",
    isCrisis: false,
    scripture: null,
    devotional: null,
    prayer: null,
    failureCode: null,
    isLocalOnly: true,
    pending: {
      status: item.status,
      lastErrorCode: item.lastErrorCode,
      serverEntryId: item.serverEntryId,
      resetsAt: item.limitResetsAt === null ? null : new Date(item.limitResetsAt).toISOString(),
    },
  };
}

// The pending cards first, newest first overall. An entry that has the same client entry id as a pending item is the
// server's copy of that same reflection (it was claimed, or it finished while the item was still being settled): the
// pending card wins while it exists, so one reflection is never listed twice.
export function mergePending(entries: readonly JournalEntry[], pending: readonly HomeEntry[]): HomeEntry[] {
  const unsent = new Set(pending.map((entry) => entry.clientEntryId));
  const rest = entries.filter((entry) => entry.clientEntryId === null || !unsent.has(entry.clientEntryId));
  return [...pending, ...rest].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
```

### 1.10 `src/services/entryProcessor.ts`

The one place an outbox item is handed to be prepared. Step 25 replaces its inside and sets `processorIsMock` to `false`.

```ts
import { processMock } from "@/data/journalRepository";
import type { OutboxItem, ProcessingStage, ProcessOutcome } from "@/types";

// The one place the sync engine hands an outbox item to be prepared (step 24). It answers with the finished entry, or with
// why not (a ProcessEntryErrorCode, or NETWORK when no answer came). It never throws and it reports its progress through
// `onStage`, which the New Entry overlay shows.
//
// TEMP(25): the real processor uploads the recording (uploadRawRecording), calls process-entry and maps its answer. Keep
// this interface. While `processorIsMock` is true the engine does not write the answer to the read cache: the mock's
// entries live in the in-memory mock database, and a persisted copy of them would outlive the mock.
export const processorIsMock = true;

export function processItem(
  item: OutboxItem,
  onStage: (stage: ProcessingStage) => void,
): Promise<ProcessOutcome> {
  return processMock(item, onStage);
}
```

### 1.11 `src/services/recordingCleanup.ts`

Deletes a recording that has no queue item and is over a week old. Once per launch, never throws.

```ts
import { exists } from "@/db/outbox";
import { deleteRecording, listRecordings } from "@/services/recordingFiles";

// A recording that belongs to no outbox item and has been on the phone for a week is a leftover (an entry that was never
// saved, or a delete that failed): it goes (step 24). A recording that has an outbox item is never touched, and neither
// is one whose age is not known. Runs once per launch, when the sync engine starts. Never throws; returns how many went.
export const RECORDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function cleanOldRecordings(now: number = Date.now()): Promise<number> {
  let removed = 0;
  try {
    for (const recording of listRecordings()) {
      if (recording.modifiedAt <= 0 || now - recording.modifiedAt < RECORDING_MAX_AGE_MS) continue;
      if (await exists(recording.clientEntryId)) continue;
      await deleteRecording(recording.clientEntryId);
      removed += 1;
    }
  } catch {
    // Nothing more can be done: the next launch tries again.
  }
  return removed;
}
```

### 1.12 `src/services/syncEngine.ts`

The engine: one run at a time, oldest first, only while the app is in front and the phone can send, with a generation counter so nothing lands after sign-out.

```ts
import { AppState } from "react-native";

import { getKnownTier } from "@/data/journalRepository";
import * as cache from "@/db/cache";
import { isDatabaseOpen } from "@/db/database";
import * as outbox from "@/db/outbox";
import { processItem, processorIsMock } from "@/services/entryProcessor";
import { cleanOldRecordings } from "@/services/recordingCleanup";
import { deleteRecording } from "@/services/recordingFiles";
import { markReachable, markUnreachable } from "@/services/connectivity";
import { classify, retryDelayMs } from "@/services/syncPolicy";
import { selectCanSend, useOfflineStore } from "@/store/offlineStore";
import type { OutboxItem, OutboxStatus, ProcessingStage, ProcessOutcome } from "@/types";

// The sync engine (step 24): it sends what is in the outbox, one reflection at a time, oldest first, whenever the app is in
// front, the phone can send and the database is open. It never runs in the background and it uses no background task.
//
// Rules the code below keeps:
// - One flight: a second syncNow while a run is going only asks the run to go round again.
// - A generation counter: stopSyncEngine (sign-out) makes every run and every answer still in the air stop touching the
//   database, which may already be closed or deleted.
// - On success the answer is saved first, then the outbox row is removed, then the recording is deleted: a crash in between
//   leaves an item that is sent again, and the server answers a finished entry with the same entry (nothing is made twice).
// - Nothing logs a word the person wrote, a file path, an id or a key. A log line is a state, an error code, an attempt
//   count or a delay. A crisis answer is logged like any other ("finished"): the app logs nothing about a crisis entry.
export type SyncReason = "start" | "foreground" | "online" | "timer" | "submit" | "upgrade" | "manual";

export type SyncEvent =
  | { type: "changed" }
  | { type: "stage"; clientEntryId: string; stage: ProcessingStage }
  | { type: "finished"; clientEntryId: string; entryId: string; isCrisis: boolean }
  | {
      type: "settled";
      clientEntryId: string;
      status: OutboxStatus;
      code: string | null;
      entryId: string | null;
    };

// What a screen that waits for one item gets back.
export type WaitResult =
  | { kind: "ready"; entryId: string; isCrisis: boolean }
  | { kind: "limit"; entryId: string | null }
  | { kind: "needs_action"; code: string }
  | { kind: "later" };

// A processor call that has not answered after this long counts as no answer, so a call that never returns cannot stall
// the queue. The server stops a request at about 150 s.
export const MAX_PROCESS_MS = 200_000;
// How long New Entry waits on the overlay before it lets go and the engine carries on without it.
export const WAIT_MS = 90_000;
const MIN_TIMER_MS = 1_000;
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

let started = false;
let generation = 0;
let runningGeneration: number | null = null;
let runAgain = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let appActive = true;
let stopListening: (() => void) | null = null;
const listeners = new Set<(event: SyncEvent) => void>();

function log(message: string) {
  if (__DEV__) {
    console.log(`[sync] ${message}`);
  }
}

function emit(event: SyncEvent) {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A listener's failure must not stop the engine.
    }
  }
}

// Emits after every change to the outbox, and when an item finishes or stops. Returns the way to stop listening.
export function subscribe(listener: (event: SyncEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSyncEngineStarted(): boolean {
  return started;
}

function canRun(): boolean {
  return started && appActive && isDatabaseOpen() && selectCanSend(useOfflineStore.getState());
}

function clearTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

// Wakes the engine for the earliest retry, or the earliest end of a held-back week. Not while offline or in the background:
// coming back online and coming back to the app both start a run.
async function arm(gen: number): Promise<void> {
  clearTimer();
  if (!canRun()) return;
  try {
    const [retryAt, resetAt] = await Promise.all([outbox.nextAttemptAt(), outbox.earliestLimitReset()]);
    if (gen !== generation) return;
    const times = [retryAt, resetAt].filter((time): time is number => time !== null);
    if (times.length === 0) return;
    const wait = Math.min(Math.max(Math.min(...times) - Date.now(), MIN_TIMER_MS), MAX_TIMER_MS);
    timer = setTimeout(() => {
      timer = null;
      void onTimer(gen);
    }, wait);
  } catch {
    // The database closed.
  }
}

async function onTimer(gen: number): Promise<void> {
  if (gen !== generation) return;
  await resumeHeld(false);
  await syncNow("timer");
}

// What was held back goes back in the queue when whatever held it is over:
// - items the free limit held: when the plan this phone knows is paid (wherever the purchase was made: the profile sync
//   brings the server's plan), or when the week that held them ends;
// - items held for a refused session, but only when the app starts or comes to the front (`withAuth`): a refused session
//   is asked again once per visit, never on a timer.
async function resumeHeld(withAuth: boolean): Promise<void> {
  try {
    const now = Date.now();
    const tier = getKnownTier();
    const paid = tier === "trial" || tier === "pro";
    let resumed = withAuth ? await outbox.resumePausedAuth(now) : 0;
    resumed += paid ? await outbox.resumeLimitReached(now) : await outbox.resumeLimitReachedDue(now);
    if (resumed > 0) emit({ type: "changed" });
  } catch {
    // The database closed.
  }
}

// The processor, with a ceiling on how long it may take. It never rejects.
function runProcessor(item: OutboxItem): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const ceiling = setTimeout(() => resolve({ ok: false, code: "NETWORK" }), MAX_PROCESS_MS);
    processItem(item, (stage) => emit({ type: "stage", clientEntryId: item.clientEntryId, stage })).then(
      (outcome) => {
        clearTimeout(ceiling);
        resolve(outcome);
      },
      () => {
        clearTimeout(ceiling);
        resolve({ ok: false, code: "UNKNOWN" });
      },
    );
  });
}

async function applySuccess(item: OutboxItem, outcome: Extract<ProcessOutcome, { ok: true }>): Promise<void> {
  const id = item.clientEntryId;
  if (!processorIsMock) {
    await cache.upsertEntry(outcome.entry);
    await cache.upsertAffirmations(outcome.entry.id, outcome.affirmations);
  }
  await outbox.remove(id);
  if (item.inputType === "audio") await deleteRecording(id);
  markReachable();
  log("finished");
  emit({ type: "finished", clientEntryId: id, entryId: outcome.entry.id, isCrisis: outcome.entry.isCrisis });
  emit({ type: "changed" });
}

async function applyFailure(
  item: OutboxItem,
  code: string,
  entryId: string | null,
  resetsAt: string | null,
): Promise<void> {
  const id = item.clientEntryId;
  const now = Date.now();
  const attempts = item.attempts + 1;
  if (code === "NETWORK") markUnreachable();
  else markReachable();
  switch (classify(code)) {
    case "retry": {
      const delay = retryDelayMs(code, attempts);
      await outbox.markQueued(id, now + delay, code, now);
      log(`retry ${code}, attempt ${attempts}, in ${Math.round(delay / 1000)} s`);
      emit({ type: "settled", clientEntryId: id, status: "queued", code, entryId: null });
      break;
    }
    case "limit": {
      const at = resetsAt === null ? Number.NaN : Date.parse(resetsAt);
      await outbox.markLimitReached(id, entryId, Number.isFinite(at) ? at : null, now);
      log("held by the free limit");
      emit({ type: "settled", clientEntryId: id, status: "limit_reached", code, entryId });
      break;
    }
    case "pause_auth":
      await outbox.markPausedAuth(now);
      log("paused until the next sign-in");
      emit({ type: "settled", clientEntryId: id, status: "paused_auth", code, entryId: null });
      break;
    case "needs_action":
      await outbox.markNeedsAction(id, code, now);
      log(`needs the person: ${code}`);
      emit({ type: "settled", clientEntryId: id, status: "needs_action", code, entryId: null });
      break;
  }
  emit({ type: "changed" });
}

async function sendOne(item: OutboxItem, gen: number): Promise<void> {
  const id = item.clientEntryId;
  try {
    // Words that cannot be read (see outbox.toItem) can never be sent: the person has to look at it.
    if (item.inputType === "text" && item.text === null) {
      await applyFailure(item, "UNREADABLE", null, null);
      return;
    }
    if (!(await outbox.markSending(id, Date.now()))) return;
    emit({ type: "changed" });
    const outcome = await runProcessor({ ...item, attempts: item.attempts + 1, status: "sending" });
    if (gen !== generation) return;
    if (outcome.ok) await applySuccess(item, outcome);
    else await applyFailure(item, outcome.code, outcome.entryId ?? null, outcome.resetsAt ?? null);
  } catch {
    // Either the database closed (sign-out), which leaves nothing to update, or a write failed with the database still open.
    // Then the item must not stay "sending": it goes back in the queue, and a second send is harmless.
    if (gen === generation && isDatabaseOpen()) {
      try {
        const now = Date.now();
        await outbox.markQueued(id, now + retryDelayMs("UNKNOWN", item.attempts + 1), "UNKNOWN", now);
      } catch {
        // Nothing more can be done: the next start puts it back.
      }
    }
  }
}

async function drain(gen: number): Promise<void> {
  while (gen === generation && canRun()) {
    let item: OutboxItem | null;
    try {
      item = await outbox.nextDue(Date.now());
    } catch {
      return;
    }
    if (item === null) return;
    await sendOne(item, gen);
  }
}

// Runs the queue now. Safe to call from anywhere, at any time: while a run is going it only asks it to go round again.
export async function syncNow(reason: SyncReason): Promise<void> {
  if (!started) return;
  if (runningGeneration === generation) {
    runAgain = true;
    return;
  }
  const gen = generation;
  runningGeneration = gen;
  log(`run (${reason})`);
  try {
    do {
      runAgain = false;
      await drain(gen);
    } while (runAgain && gen === generation);
  } finally {
    if (runningGeneration === gen) runningGeneration = null;
  }
  if (gen === generation) await arm(gen);
}

async function begin(gen: number): Promise<void> {
  try {
    const now = Date.now();
    // The app was closed in the middle of a send, or while held back: those items go in the queue again.
    await outbox.resetSending(now);
    await resumeHeld(true);
    emit({ type: "changed" });
    void cleanOldRecordings();
  } catch {
    // The database closed while starting.
  }
  if (gen === generation) await syncNow("start");
}

// Idempotent. The auth bridge calls it once the user's database is open.
export function startSyncEngine(): void {
  if (started) return;
  started = true;
  generation += 1;
  const gen = generation;
  appActive = AppState.currentState === "active";
  const appState = AppState.addEventListener("change", (status) => {
    if (status === "active") {
      appActive = true;
      void resumeHeld(true).then(() => (gen === generation ? syncNow("foreground") : undefined));
    } else {
      appActive = false;
      clearTimer();
    }
  });
  let couldSend = selectCanSend(useOfflineStore.getState());
  const network = useOfflineStore.subscribe((state) => {
    const can = selectCanSend(state);
    if (can && !couldSend) void syncNow("online");
    couldSend = can;
  });
  stopListening = () => {
    appState.remove();
    network();
  };
  void begin(gen);
}

// Sign-out, or the user changed. Whatever is in the air is ignored when it lands.
export function stopSyncEngine(): void {
  started = false;
  generation += 1;
  clearTimer();
  stopListening?.();
  stopListening = null;
}

// The person deleted a refused reflection (Journal's Review), or chose to record it again: the item and its recording
// go, and the lists refresh.
export async function discardItem(clientEntryId: string): Promise<void> {
  try {
    await outbox.remove(clientEntryId);
  } catch {
    // The database closed (sign-out): there is nothing left to remove.
  }
  await deleteRecording(clientEntryId);
  emit({ type: "changed" });
}

// The plan may have changed (a purchase, a restore): what the free limit held back goes again, now, when the plan is
// paid. A call on the free plan changes nothing.
export async function resumeAfterUpgrade(): Promise<void> {
  if (!started) return;
  await resumeHeld(false);
  await syncNow("upgrade");
}

// New Entry: runs the queue and waits for what happens to this one item. It resolves when the item is finished or has
// stopped (a retry later, the free limit, a refused session, or something only the person can fix), or after WAIT_MS:
// then the engine goes on by itself and the screen lets go.
export function syncAndWait(
  clientEntryId: string,
  options: { onStage?: (stage: ProcessingStage) => void; waitMs?: number } = {},
): Promise<WaitResult> {
  return new Promise((resolve) => {
    let done = false;
    let stopWaiting: () => void = () => undefined;
    const finish = (result: WaitResult) => {
      if (done) return;
      done = true;
      clearTimeout(limit);
      stopWaiting();
      resolve(result);
    };
    const limit = setTimeout(() => finish({ kind: "later" }), options.waitMs ?? WAIT_MS);
    stopWaiting = subscribe((event) => {
      if (event.type === "stage" && event.clientEntryId === clientEntryId) {
        options.onStage?.(event.stage);
      } else if (event.type === "finished" && event.clientEntryId === clientEntryId) {
        finish({ kind: "ready", entryId: event.entryId, isCrisis: event.isCrisis });
      } else if (event.type === "settled" && event.clientEntryId === clientEntryId) {
        if (event.status === "needs_action") finish({ kind: "needs_action", code: event.code ?? "UNKNOWN" });
        else if (event.status === "limit_reached") finish({ kind: "limit", entryId: event.entryId });
        else finish({ kind: "later" });
      }
    });
    if (!started) finish({ kind: "later" });
    else void syncNow("submit");
  });
}
```

### 1.13 `src/services/offlineSession.ts`

The signed-in user's database, then the engine. Started and ended by the auth bridge; started again by Journal's "Try again".

```ts
import { closeUserDatabase, openUserDatabase } from "@/db/database";
import { startSyncEngine, stopSyncEngine } from "@/services/syncEngine";
import { useOfflineStore } from "@/store/offlineStore";

// The signed-in user's offline machinery (step 24): their database, then the sync engine that reads it. The auth bridge
// starts it when a user signs in and ends it when they sign out, and Journal's "Try again" starts it again when the
// database could not be opened. Only the newest start or end may act on what it finds: an open that finishes after
// the session has already ended must not mark the database ready or start the engine.
let session = 0;

function note(code: string) {
  if (__DEV__) {
    console.info(`[db] ${code}`);
  }
}

export async function startOfflineSession(userId: string): Promise<void> {
  session += 1;
  const mine = session;
  useOfflineStore.getState().setDatabase("closed");
  try {
    await openUserDatabase(userId);
  } catch {
    if (mine === session) {
      note("open_failed");
      useOfflineStore.getState().setDatabase("failed");
    }
    return;
  }
  if (mine !== session) return;
  useOfflineStore.getState().setDatabase("ready");
  startSyncEngine();
}

// Sign-out, or the user changed. The file stays on the phone, encrypted: signOutCleanup deletes it when the person
// signs out on purpose.
export async function endOfflineSession(): Promise<void> {
  session += 1;
  stopSyncEngine();
  useOfflineStore.getState().setDatabase("closed");
  await closeUserDatabase();
}
```

### 1.14 `src/components/NoticeBanner.tsx`

A calm line that stays until dismissed or the list is refreshed. The same blush card as the offline banner.

```tsx
import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors } from "@/constants/theme";

const icons = {
  saved: { android: "check_circle", ios: "checkmark.circle" },
  close: { android: "close", ios: "xmark" },
} satisfies Record<string, SymbolViewProps["name"]>;

type NoticeBannerProps = {
  message: string;
  onDismiss: () => void;
};

// A calm line that stays until the person dismisses it or pulls to refresh, never on a timer (step 24). A polite live
// region, so a screen reader says it when it appears. The same blush card as the offline banner.
export function NoticeBanner({ message, onDismiss }: NoticeBannerProps) {
  return (
    <View accessibilityLiveRegion="polite" className="card card--blush flex-row items-center gap-3">
      <View className="size-8 items-center justify-center rounded-full bg-petal">
        <Icon name={icons.saved} size={19} color={colors.plumDeep} />
      </View>
      <Text className="flex-1 text-body-sm text-ink/80">{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.common.dismiss}
        onPress={onDismiss}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {/* 44 square, pulled into the card's padding so a one-line note stays compact. */}
        <View className="-my-2 -mr-2 size-11 items-center justify-center">
          <Icon name={icons.close} size={18} color={colors.mauve} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
```

### 1.15 `src/components/PendingReviewDialog.tsx`

What "Review" on a refused reflection offers: the reason, "Edit and resend" for written ones, and delete. One `ConfirmDialog`, two steps.

```tsx
import { useState } from "react";
import { Pressable, Text } from "react-native";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { copy } from "@/constants/copy";
import type { HomeEntry } from "@/types";

const { review } = copy.journal;

type PendingReviewDialogProps = {
  // The card the person tapped "Review" on, or null while the dialog is closed.
  entry: HomeEntry | null;
  onClose: () => void;
  // Text only: opens New Entry with the same words and the same client entry id.
  onEdit: (clientEntryId: string) => void;
  onDelete: (clientEntryId: string) => Promise<void>;
};

// What a reflection that the server refused (a card with "Review") offers: read why, fix and send a written one
// again, or delete it. One ConfirmDialog with two steps, as on Profile: a second Modal opened from inside the first is
// the fragile case on iOS.
export function PendingReviewDialog({ entry, onClose, onEdit, onDelete }: PendingReviewDialogProps) {
  const [step, setStep] = useState<"review" | "delete">("review");
  const [busy, setBusy] = useState(false);
  // The content stays after the dialog closes, so the fade-out never shows an empty card. Kept in state and compared
  // during render, like the Journal's offline flag.
  const [kept, setKept] = useState<HomeEntry | null>(null);
  if (entry !== null && entry !== kept) {
    setKept(entry);
    setStep("review");
  }
  const shown = entry ?? kept;
  if (shown === null) return null;

  const isText = shown.inputType === "text";
  // Words that cannot be read (their key is gone) can only be deleted.
  const canEdit = isText && shown.pending?.lastErrorCode !== "UNREADABLE";

  async function confirmDelete() {
    if (busy || shown === null) return;
    setBusy(true);
    try {
      await onDelete(shown.clientEntryId ?? shown.id);
    } finally {
      setBusy(false);
    }
    onClose();
  }

  function confirm() {
    if (shown === null) return;
    if (step === "delete") {
      void confirmDelete();
    } else if (canEdit) {
      onEdit(shown.clientEntryId ?? shown.id);
    } else {
      setStep("delete");
    }
  }

  if (step === "delete") {
    return (
      <ConfirmDialog
        visible={entry !== null}
        tone="destructive"
        title={review.delete.title}
        body={isText ? review.delete.bodyText : review.delete.bodyAudio}
        confirmLabel={review.delete.confirm}
        cancelLabel={review.delete.cancel}
        loading={busy}
        onConfirm={confirm}
        onCancel={onClose}
      />
    );
  }

  return (
    <ConfirmDialog
      visible={entry !== null}
      title={review.title}
      body={copy.problems.reason(shown.pending?.lastErrorCode ?? null)}
      confirmLabel={canEdit ? review.edit : review.deleteAction}
      cancelLabel={review.close}
      onConfirm={confirm}
      onCancel={onClose}
    >
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={review.deleteAction}
          className="mt-3 min-h-11 items-center justify-center px-4"
          onPress={() => setStep("delete")}
        >
          <Text className="btn-text__label btn-text__label--rosewood">{review.deleteAction}</Text>
        </Pressable>
      ) : null}
    </ConfirmDialog>
  );
}
```

---

## 2. Edits to the existing files

Each block gives the text to find (it occurs exactly once in its file, as LF text) and the text that replaces it. Three files are replaced whole (2.18 to 2.20). These files use CRLF line endings: `src/types/index.ts`, `src/constants/copy.ts`, `src/data/mock/scenario.ts`, `src/store/devStore.ts`, `src/data/journalRepository.ts`, `src/data/selectors.ts`, `src/hooks/useProfileSettings.ts`, `src/services/purchases.ts`, `src/services/account.ts`, `src/components/SupabaseAuthBridge.tsx`, `src/navigation/types.ts`, `src/screens/paywall/PaywallScreen.tsx`, `src/screens/profile/ProfileScreen.tsx`, `src/components/dev/DevToolsPanel.tsx`, `src/screens/journal/NewEntryScreen.tsx` (count with `tr -cd '\r' < file | wc -c` before editing). These are LF: `src/services/recordingFiles.ts`, `src/screens/journal/JournalFeedScreen.tsx`, `src/screens/journal/ProcessingOverlay.tsx`, `src/hooks/useJournalHome.ts`, `src/components/JournalCard.tsx`. The Edit tool matches single lines in a CRLF file but may fail on a multi-line block, so use a small Node script that matches the LF text and writes CRLF back, as steps 17 to 23 did: each file keeps its own endings and git shows only the real change. For a whole-file replacement keep the file's own endings too.

Anything not listed stays as it is: no layout, no token, no class and no other copy string changes. Dev-panel strings stay inline (AGENTS.md: dev-only UI is exempt from `copy.ts`). **Delete nothing else**: `SubmitResult` and `submitEntry` are the only removals.

### 2.1 `src/types/index.ts`

`SubmitResult` goes (its only user was the mock `submitEntry`); the outbox, the card and the processor types take its place.

a) Find:

```ts
export type ProcessingStage = "receiving" | "reflecting" | "preparing";
export type SubmitResult =
  | { kind: "ready"; entryId: string }
  | { kind: "crisis"; entryId: string }
  | { kind: "error"; code: ProcessEntryErrorCode };
```

Replace with:

```ts
export type ProcessingStage = "receiving" | "reflecting" | "preparing";

// The offline queue (step 24). An item is a reflection that is saved on this phone and has not been prepared yet.
//   queued         waiting its turn, or for the next retry
//   sending        being prepared now
//   needs_action   the server refused it for a reason only the person can fix (no speech heard, too short, ...)
//   limit_reached  the free limit stopped it: it goes again when the plan is paid or the week resets
//   paused_auth    the session was refused: it goes again at the next sign-in
export type OutboxStatus = "queued" | "sending" | "needs_action" | "limit_reached" | "paused_auth";
export type OutboxItem = {
  clientEntryId: string;
  inputType: InputType;
  text: string | null; // a written entry's words. null for a recording, and for words that could not be read
  durationMs: number | null; // a recording's length
  mimeType: AudioMimeType | null; // a recording's type
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number; // epoch ms
  lastErrorCode: string | null;
  serverEntryId: string | null; // the entry the server saved when the free limit stopped this one
  limitResetsAt: number | null; // epoch ms: when the week that holds it back ends
  createdAt: number; // epoch ms
};

// What Journal Home knows about an entry that is still in the outbox: it is listed as an entry-shaped card.
export type PendingInfo = {
  status: OutboxStatus;
  lastErrorCode: string | null;
  serverEntryId: string | null;
  resetsAt: string | null; // ISO 8601
};
export type HomeEntry = JournalEntry & { pending?: PendingInfo };

// What preparing one item gives back (services/entryProcessor.ts). `code` is a process-entry error code, NETWORK when
// no answer came, or UNKNOWN for an answer the app does not know. A LIMIT_REACHED answer carries the entry the server
// saved and when the week resets.
export type ProcessOutcome =
  | { ok: true; entry: JournalEntry; affirmations: Affirmation[] }
  | {
      ok: false;
      code: ProcessEntryErrorCode | "NETWORK" | "UNKNOWN";
      entryId?: string;
      resetsAt?: string;
    };
```

### 2.2 `src/constants/copy.ts`

New strings, the removed "Saved locally", the reworded overlay note, the new failure view, and the sign-out variant. Two `TODO(24)` markers go. (The curly apostrophe U+2019 is used, as in the rest of the file.)

a) Find:

```ts
import type { AmbientSound, PlaybackRate, TimeSlot } from "@/types";
```

Replace with:

```ts
import type { AmbientSound, OutboxStatus, PlaybackRate, TimeSlot } from "@/types";
```

b) Find:

```ts
  common: {
    close: "Close",
```

Replace with:

```ts
  common: {
    close: "Close",
    dismiss: "Dismiss",
```

c) Find:

```ts
      support: "Support resources",
      // The parts of a card's spoken summary. The transcript is never part of it.
```

Replace with:

```ts
      support: "Support resources",
      // A reflection that is only on this phone never shows its words.
      writtenReflection: "Written reflection",
      review: "Review",
      reviewLabel: "Review this reflection",
      seePlans: "See plans",
      seePlansLabel: "See plans to prepare this reflection",
      // The status line of a reflection that is saved on this phone and has not been prepared yet (step 24). The card shows
      // it and a screen reader speaks it. `weekday` is when the free limit's week ends.
      pendingLine: (status: OutboxStatus, online: boolean | null, weekday: string | null) => {
        switch (status) {
          case "queued":
            return online === false
              ? "Saved on this phone · Waiting to connect"
              : "Preparing your reflection…";
          case "sending":
            return "Preparing your reflection…";
          case "needs_action":
            return "We couldn’t finish this one.";
          case "limit_reached":
            return weekday ? `Saved · Unlocks with Pro or on ${weekday}` : "Saved · Unlocks with Pro";
          case "paused_auth":
            return "Saved · Sign in to continue";
        }
      },
      // The parts of a card's spoken summary. The transcript is never part of it.
```

d) Find:

```ts
    synced: "All reflections synced",
    empty: {
```

Replace with:

```ts
    // What "Review" on a refused reflection offers (one ConfirmDialog with two steps).
    review: {
      title: "We couldn’t finish this one",
      edit: "Edit and resend",
      deleteAction: "Delete",
      close: "Close",
      delete: {
        title: "Delete this reflection?",
        bodyText: "It will be deleted from this phone.",
        bodyAudio: "The recording will be deleted from this phone.",
        confirm: "Delete",
        cancel: "Keep",
      },
    },
    // The calm line New Entry leaves on Journal after it saved something that has not been prepared yet. It stays until
    // it is dismissed or the list is refreshed, never on a timer.
    notes: {
      offline: "Saved. We’ll prepare your reflection when you’re back online.",
      retry: "Saved. We’ll finish your reflection as soon as we can.",
    },
    synced: "All reflections synced",
    empty: {
```

e) Find:

```ts
      title: "New Reflection",
      // TODO(24): reflect real local save
      saved: "Saved locally",
      private: "Private",
```

Replace with:

```ts
      title: "New Reflection",
      private: "Private",
```

f) Find:

```ts
      // TODO(25): "waiting in your Journal" is true once processing continues after the screen closes
      note: "You can close the app. Your reflection will be waiting in your Journal.",
      close: "Close",
      error: {
        title: "We couldn’t finish this reflection.",
        // TODO(24): "Your words are safe" is true once the entry is saved on the device before it is sent
        body: "Your words are safe. Try again, or save it and we’ll retry later.",
        retry: "Try again",
        saveAndClose: "Save and close",
      },
    },
  },
```

Replace with:

```ts
      // The reflection is in the outbox before this screen shows. The app prepares it while it is open (never in the
      // background), so this does not promise more than that.
      note: "Your reflection is saved on this phone. If you leave this screen, it will finish in your Journal.",
      close: "Close",
      // The two ways the overlay can fail now: the phone could not save the reflection, or the server refused it for a
      // reason only the person can fix. Anything else is saved and retried by itself, with no error shown.
      failures: {
        save: {
          title: "We couldn’t save this reflection.",
          body: "Your words are still on this screen. Please try again.",
          primary: "Try again",
          secondary: "Keep editing",
        },
        refused: {
          title: "We couldn’t finish this reflection.",
          editText: "Edit",
          recordAgain: "Record again",
          close: "Close",
        },
      },
    },
  },
  // Why a refused reflection could not be prepared, for New Entry's overlay and for Journal's "Review".
  problems: {
    reason: (code: string | null) => {
      switch (code) {
        case "TOO_SHORT":
          return "That reflection was too short to prepare. You can add a little more.";
        case "NO_SPEECH":
          return "We couldn’t hear anything in that recording. You can record it again.";
        case "PAYLOAD_TOO_LARGE":
          return "That reflection is too large to send. You can shorten it or record a shorter one.";
        default:
          return "Something about this reflection can’t be prepared. You can edit it, record it again or delete it.";
      }
    },
  },
```

g) Find:

```ts
        // TODO(24): "Your words are safe" is true once the entry is saved on the device before it is sent
        // TODO(25): "try again from your journal" is true once a failed entry has a "Try again"
        body: "Your words are safe. You can try again from your journal.",
```

Replace with:

```ts
        // TODO(25): "try again from your journal" is true once a failed entry has a "Try again"
        body: "Your words are safe. You can try again from your journal.",
```

h) Find:

```ts
        // TODO(24): the body says how many reflections on this phone have not been sent yet, when there are any
        title: "Sign out of Gracehush?",
        body: "Your journal stays safe in your account.",
        confirm: "Sign out",
        cancel: "Stay",
      },
```

Replace with:

```ts
        title: "Sign out of Gracehush?",
        body: "Your journal stays safe in your account.",
        confirm: "Sign out",
        cancel: "Stay",
      },
      // The same dialog when reflections on this phone have not been sent yet: signing out deletes them from the phone.
      signOutUnsent: {
        body: (count: number) =>
          count === 1
            ? "1 reflection on this phone hasn’t been sent yet. If you sign out, it will be deleted from this phone."
            : `${count} reflections on this phone haven’t been sent yet. If you sign out, they’ll be deleted from this phone.`,
        confirm: "Sign out anyway",
        cancel: "Stay signed in",
      },
```

### 2.3 `src/data/mock/scenario.ts`

A `too_short` outcome for the mock, and the one-shot network failure.

a) Find:

```ts
// What the next mock submit answers (step 10): a finished entry, a crisis entry, a failure or the free limit.
export type MockSubmitOutcome = "ready" | "crisis" | "failed" | "limit";
```

Replace with:

```ts
// What the next mock submit answers (step 10): a finished entry, a crisis entry, a failure, the free limit, or (step 24)
// a refusal that only the person can fix.
export type MockSubmitOutcome = "ready" | "crisis" | "failed" | "limit" | "too_short";
```

b) Find:

```ts
// What the next mock purchase answers (step 16).
```

Replace with:

```ts
// One-shot too (step 24): true when the next mock call to the server "gets no answer", so the engine's retries can be
// seen. The flag clears in the same call.
export function takeMockNetworkFailure(): boolean {
  if (!__DEV__) return false;
  const dev = useDevStore.getState();
  if (!dev.nextNetworkFails) return false;
  dev.setNextNetworkFails(false);
  return true;
}

// What the next mock purchase answers (step 16).
```

### 2.4 `src/store/devStore.ts`

The flag behind `takeMockNetworkFailure`.

a) Find:

```ts
  // The next Reflection load fails once, so its error state can be reached.
  nextReflectionLoadFails: boolean;
```

Replace with:

```ts
  // The next call the sync engine makes to the (mock) server gets no answer, once, so its retries can be seen
  // (takeMockNetworkFailure). Step 24.
  nextNetworkFails: boolean;
  setNextNetworkFails: (value: boolean) => void;
  // The next Reflection load fails once, so its error state can be reached.
  nextReflectionLoadFails: boolean;
```

b) Find:

```ts
  nextReflectionLoadFails: false,
```

Replace with:

```ts
  nextNetworkFails: false,
  setNextNetworkFails: (nextNetworkFails) => set({ nextNetworkFails }),
  nextReflectionLoadFails: false,
```

### 2.5 `src/data/journalRepository.ts`

`submitEntry` becomes `processMock` (it answers a `ProcessOutcome`); `getEntry` answers a reflection that is only on this phone; three small readers the screens and the engine use.

a) Find:

```ts
// TEMP(24/25/29): internals move to the SQLite cache and Supabase. Keep the names and argument order; those steps widen some return types to RepoResult. The profile is real since step 17.
```

Replace with:

```ts
// TEMP(25/29): internals move to Supabase and the SQLite read cache (built in step 24, filled by step 25). Keep the names and argument order; those steps widen some return types to RepoResult. The profile is real since step 17.
```

b) Find:

```ts
import {
  getProfileSource,
  takeMockPrayerMutationFailure,
  takeMockSubmitOutcome,
  type MockSubmitOutcome,
} from "@/data/mock/scenario";
```

Replace with:

```ts
import {
  getProfileSource,
  takeMockNetworkFailure,
  takeMockPrayerMutationFailure,
  takeMockSubmitOutcome,
  type MockSubmitOutcome,
} from "@/data/mock/scenario";
import { toPendingEntry } from "@/data/pendingEntries";
import { isDatabaseOpen } from "@/db/database";
import * as outbox from "@/db/outbox";
```

c) Find:

```ts
import type {
  Affirmation,
  JournalEntry,
  MarkAnsweredInput,
  PlanUsage,
  Prayer,
  ProcessEntryRequest,
  ProcessingStage,
  ProfilePatch,
  RepoResult,
  SubmitResult,
  SubscriptionTier,
```

Replace with:

```ts
import type {
  Affirmation,
  HomeEntry,
  JournalEntry,
  MarkAnsweredInput,
  OutboxItem,
  PlanUsage,
  Prayer,
  ProcessEntryRequest,
  ProcessingStage,
  ProcessOutcome,
  ProfilePatch,
  RepoResult,
  SubscriptionTier,
```

d) Find:

```ts
  failed: ["receiving", "reflecting"],
  limit: ["receiving"],
};
```

Replace with:

```ts
  failed: ["receiving", "reflecting"],
  limit: ["receiving"],
  too_short: ["receiving"],
};
```

e) Find:

```ts
export async function getEntry(id: string): Promise<JournalEntry | null> {
  await simulateLatency();
  return readEntries().find((entry) => entry.id === id) ?? null;
}
```

Replace with:

```ts
// A reflection that is still only on this phone has no server id: its id is its client entry id, and it is an entry
// that is not finished yet (Reflection shows "still being prepared"), never "not found" (step 24).
export async function getEntry(id: string): Promise<HomeEntry | null> {
  await simulateLatency();
  const found = readEntries().find((entry) => entry.id === id);
  if (found) return found;
  const item = await findPendingItem(id);
  return item === null ? null : toPendingEntry(item);
}

async function findPendingItem(clientEntryId: string): Promise<OutboxItem | null> {
  if (!isDatabaseOpen()) return null;
  try {
    return await outbox.get(clientEntryId);
  } catch {
    return null;
  }
}

// The reflections saved on this phone and not prepared yet, newest first. Empty while the database is not open, and when
// it cannot be read: Journal and Profile show what the server has either way.
export async function listPendingItems(): Promise<OutboxItem[]> {
  if (!isDatabaseOpen()) return [];
  try {
    return await outbox.listPending();
  } catch {
    return [];
  }
}

// How many reflections signing out would lose: the ones the server has never been given. 0 while the database is not open.
export async function countUnsentItems(): Promise<number> {
  if (!isDatabaseOpen()) return 0;
  try {
    return await outbox.countUnsent();
  } catch {
    return 0;
  }
}

// The plan as this device knows it, with no waiting. The sync engine uses it to send what the free limit held back as soon
// as the plan is paid, wherever the purchase was made. A mock purchase counts first, because the screens show the mock
// plan until step 30 (TEMP(30)); otherwise it is the plan the last profile sync read, or null before the first sync.
export function getKnownTier(): SubscriptionTier | null {
  const mock = getMockSubscriptionTier();
  if (mock !== "free" || getProfileSource() === "mock") return mock;
  const userId = getSupabaseUserId();
  return userId === null ? null : (readLocalProfile(userId)?.subscriptionTier ?? null);
}
```

f) Find:

```ts
// TEMP(25): call process-entry via api/journalApi.ts
// A mock run: it reports each stage 1.2 s apart, then answers with what the dev store asked for (one
// shot, see takeMockSubmitOutcome). A finished or crisis outcome adds an entry to the mock database.
export async function submitEntry(
  req: ProcessEntryRequest,
  onStage: (stage: ProcessingStage) => void,
): Promise<SubmitResult> {
  const taken = takeMockSubmitOutcome();
  // A paid plan never hits the free limit, so there a "limit" run finishes like a normal one.
  const outcome = taken === "limit" && getMockSubscriptionTier() !== "free" ? "ready" : taken;
  // The outcome is never logged: a crisis outcome must leave no log line (AGENTS.md Crisis Safety Rules).
  for (const stage of STAGES[outcome]) {
    if (__DEV__) console.log(`[submitEntry] stage ${stage}`);
    onStage(stage);
    await new Promise((resolve) => setTimeout(resolve, STAGE_MS));
  }
  switch (outcome) {
    case "ready":
      return { kind: "ready", entryId: addMockEntry("ready", req) };
    case "crisis":
      return { kind: "crisis", entryId: addMockEntry("crisis", req) };
    case "failed":
      return { kind: "error", code: "AI_UNAVAILABLE" };
    case "limit":
      return { kind: "error", code: "LIMIT_REACHED" };
  }
}
```

Replace with:

```ts
// What the mock database needs of an outbox item. It reads the words of a written entry and nothing else.
function toMockRequest(item: OutboxItem): ProcessEntryRequest {
  if (item.inputType === "text") {
    return { clientEntryId: item.clientEntryId, inputType: "text", text: item.text ?? "" };
  }
  return {
    clientEntryId: item.clientEntryId,
    inputType: "audio",
    audioPath: "",
    durationMs: item.durationMs ?? 0,
    mimeType: item.mimeType ?? "audio/mp4",
  };
}

// TEMP(25): the real processor uploads the recording and calls process-entry (services/entryProcessor.ts)
// A mock run for the sync engine: it reports each stage 1.2 s apart, then answers with what the dev store asked for (one
// shot, see takeMockSubmitOutcome), or with no answer at all when the dev panel failed the network. A finished or crisis
// outcome adds an entry to the mock database and answers with it, as the server does.
export async function processMock(
  item: OutboxItem,
  onStage: (stage: ProcessingStage) => void,
): Promise<ProcessOutcome> {
  if (takeMockNetworkFailure()) {
    onStage("receiving");
    await new Promise((resolve) => setTimeout(resolve, STAGE_MS));
    return { ok: false, code: "NETWORK" };
  }
  const taken = takeMockSubmitOutcome();
  // A paid plan never hits the free limit, so there a "limit" run finishes like a normal one.
  const outcome = taken === "limit" && getMockSubscriptionTier() !== "free" ? "ready" : taken;
  // The outcome is never logged: a crisis outcome must leave no log line (AGENTS.md Crisis Safety Rules).
  for (const stage of STAGES[outcome]) {
    if (__DEV__) console.log(`[process] stage ${stage}`);
    onStage(stage);
    await new Promise((resolve) => setTimeout(resolve, STAGE_MS));
  }
  switch (outcome) {
    case "ready":
    case "crisis": {
      const entryId = addMockEntry(outcome, toMockRequest(item));
      const entry = readEntries().find((candidate) => candidate.id === entryId);
      if (entry === undefined) return { ok: false, code: "INTERNAL" };
      return { ok: true, entry, affirmations: readAffirmations(entryId) };
    }
    case "failed":
      return { ok: false, code: "AI_UNAVAILABLE" };
    case "too_short":
      return { ok: false, code: "TOO_SHORT" };
    case "limit":
      // TODO(25): the 402 body carries the entry the server saved (entryId) and usage.resetsAt
      return { ok: false, code: "LIMIT_REACHED", resetsAt: nextWeekStart(new Date()).toISOString() };
  }
}
```

### 2.6 `src/data/selectors.ts`

The Offline Reflections count includes the outbox; the offline banner counts only what the phone will send by itself; `filterEntries` keeps the type of what it is given.

a) Find:

```ts
// What Profile's "Offline Reflections" row shows. An entry that exists only on this device is pending, every
// other one is synced. TODO(24): step 24 counts the outbox instead.
export function getSyncSummary(entries: JournalEntry[]): { synced: number; pending: number } {
  const pending = entries.filter((entry) => entry.isLocalOnly).length;
  return { synced: entries.length - pending, pending };
}
```

Replace with:

```ts
// What Profile's "Offline Reflections" row shows. An entry that exists only on this device is pending, every
// other one is synced. `unsent` is how many reflections the outbox holds (step 24): they are not entries yet, so they
// are pending and no part of the synced count.
export function getSyncSummary(
  entries: readonly JournalEntry[],
  unsent: number = 0,
): { synced: number; pending: number } {
  const local = entries.filter((entry) => entry.isLocalOnly).length;
  return { synced: entries.length - local, pending: local + unsent };
}

// How many reflections the phone will send by itself once it can: the ones waiting or being sent, and the mock's
// local-only entries. A refused one (needs the person), one held by the free limit and one waiting for a sign-in are
// not counted: reconnecting does not send them. The offline banner says this number.
export function getUnsentCount(entries: readonly HomeEntry[]): number {
  return entries.filter(
    (entry) =>
      entry.isLocalOnly &&
      (entry.pending === undefined ||
        entry.pending.status === "queued" ||
        entry.pending.status === "sending"),
  ).length;
}
```

b) Find:

```ts
export function filterEntries(entries: JournalEntry[], filter: JournalFilter): JournalEntry[] {
```

Replace with:

```ts
export function filterEntries<T extends JournalEntry>(entries: T[], filter: JournalFilter): T[] {
```

c) Find:

```ts
  EmotionKey,
  JournalEntry,
  PlaybackTrack,
```

Replace with:

```ts
  EmotionKey,
  HomeEntry,
  JournalEntry,
  PlaybackTrack,
```

### 2.7 `src/hooks/useProfileSettings.ts`

Profile's sync row counts the outbox.

a) Find:

```ts
import { getProfile, getUsage, listEntries, updateProfile } from "@/data/journalRepository";
```

Replace with:

```ts
import {
  getProfile,
  getUsage,
  listEntries,
  listPendingItems,
  updateProfile,
} from "@/data/journalRepository";
```

b) Find:

```ts
      const [profile, usage, entries, notificationStatus, trialEligible] = await Promise.all([
        getProfile(),
        getUsage(),
        listEntries(),
        getNotificationPermission(),
        readTrialEligible(),
      ]);
```

Replace with:

```ts
      const [profile, usage, entries, pending, notificationStatus, trialEligible] = await Promise.all([
        getProfile(),
        getUsage(),
        listEntries(),
        listPendingItems(),
        getNotificationPermission(),
        readTrialEligible(),
      ]);
```

c) Find:

```ts
        syncSummary: getSyncSummary(entries),
```

Replace with:

```ts
        syncSummary: getSyncSummary(entries, pending.length),
```

### 2.8 `src/services/purchases.ts`

A purchase or a restore sends what the free limit held back, at once.

a) Find:

```ts
import { takeMockPurchaseOutcome } from "@/data/mock/scenario";
import { useDevStore } from "@/store/devStore";
```

Replace with:

```ts
import { takeMockPurchaseOutcome } from "@/data/mock/scenario";
import { resumeAfterUpgrade } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
```

b) Find:

```ts
      if (tier === "trial") dev.setTrialEligible(false);
      dev.bumpMockProfileVersion();
      return { ok: true, tier };
```

Replace with:

```ts
      if (tier === "trial") dev.setTrialEligible(false);
      dev.bumpMockProfileVersion();
      // What the free limit held back goes now (step 24). Step 30's entitlement listener calls this too.
      void resumeAfterUpgrade();
      return { ok: true, tier };
```

c) Find:

```ts
    setMockSubscriptionTier("pro");
    dev.bumpMockProfileVersion();
    return { ok: true, restored: true, tier: "pro" };
```

Replace with:

```ts
    setMockSubscriptionTier("pro");
    dev.bumpMockProfileVersion();
    void resumeAfterUpgrade();
    return { ok: true, restored: true, tier: "pro" };
```

### 2.9 `src/services/account.ts`

Sign-out stops the engine and deletes the user's database, its key and the recordings.

a) Find:

```ts
import { cancelProfileSync } from "@/services/profileSync";
import { deleteAllRecordings } from "@/services/recordingFiles";
import { getSupabaseUserId } from "@/services/supabaseClient";
```

Replace with:

```ts
import { deleteUserDatabase } from "@/db/database";
import { endOfflineSession } from "@/services/offlineSession";
import { cancelProfileSync } from "@/services/profileSync";
import { deleteAllRecordings } from "@/services/recordingFiles";
import { getSupabaseUserId } from "@/services/supabaseClient";
```

b) Find:

```ts
  // A prayer's audio must not outlive the session: every finished recording on this phone goes (step 23). A take that
  // is still being made cannot be running here: Sign Out is on Profile, and New Entry, which owns the recorder, is a
  // screen above the tabs. Step 24 may decide to keep an unsent queue per user instead.
  await deleteAllRecordings();
  // TODO(24): stop the sync engine and clear this user's SQLite cache
```

Replace with:

```ts
  // The sync engine stops first, so nothing is sent or written while the files go. Then this user's database is deleted
  // with its key (the outbox, the cached entries and every written word in them: step 24), and every recording on this
  // phone: a prayer must not outlive the session (step 23). A take that is still being made cannot be running here: Sign
  // Out is on Profile, and New Entry, which owns the recorder, is a screen above the tabs. Profile has already asked
  // when reflections that were never sent would be lost.
  const userId = getSupabaseUserId();
  await endOfflineSession();
  if (userId !== null) await deleteUserDatabase(userId);
  await deleteAllRecordings();
```

### 2.10 `src/services/recordingFiles.ts`

A comment only: the cleanup that its `TODO(24)` asked for exists.

a) Find:

```ts
// Every finished recording on the phone. The developer panel uses it now.
// TODO(24): delete a recording that has no queue item and is older than 7 days (`modifiedAt` is there for that).
```

Replace with:

```ts
// Every finished recording on the phone. The developer panel and services/recordingCleanup.ts (which deletes a recording
// that has no queue item and is older than 7 days, by `modifiedAt`) use it.
```

### 2.11 `src/components/SupabaseAuthBridge.tsx`

Starts NetInfo, and opens the user's database and the engine when a user signs in.

a) Find:

```tsx
import { syncProfile, syncProfileOnForeground, watchReminderEdits } from "@/services/profileSync";
import { setSupabaseSession } from "@/services/supabaseClient";
```

Replace with:

```tsx
import { startConnectivity, stopConnectivity } from "@/services/connectivity";
import { endOfflineSession, startOfflineSession } from "@/services/offlineSession";
import { syncProfile, syncProfileOnForeground, watchReminderEdits } from "@/services/profileSync";
import { setSupabaseSession } from "@/services/supabaseClient";
```

b) Find:

```tsx
  // The work that follows a sign-in, and again when the app returns to the foreground. A failure blocks nothing:
  // the next foreground tries again. Later steps add their lines here (24 opens the user's database, 30 sets up
  // purchases, 33 starts realtime).
```

Replace with:

```tsx
  // NetInfo's answers go to the offline store for as long as the app runs (step 24).
  useEffect(() => {
    startConnectivity();
    return stopConnectivity;
  }, []);

  // The signed-in user's own database and the sync engine that reads it (step 24). Opened before any screen reads it:
  // the Journal waits for it. A different user closes the previous one first.
  useEffect(() => {
    if (signedInUserId === null) return;
    void startOfflineSession(signedInUserId);
    return () => {
      void endOfflineSession();
    };
  }, [signedInUserId]);

  // The work that follows a sign-in, and again when the app returns to the foreground. A failure blocks nothing:
  // the next foreground tries again. Later steps add their lines here (30 sets up purchases, 33 starts realtime).
```

### 2.12 `src/navigation/types.ts`

`NewEntry` takes the id of the refused reflection to edit.

a) Find:

```ts
  NewEntry: { mode: "speak" | "write" };
```

Replace with:

```ts
  // `resend` is the client entry id of a refused written reflection: New Entry opens with its words (Journal's
  // "Edit and resend") and sends them again under the same id.
  NewEntry: { mode: "speak" | "write"; resend?: string };
```

### 2.13 `src/screens/paywall/PaywallScreen.tsx`

A comment only: the `TODO(25)` about resuming a held reflection is done by `purchases.ts`.

a) Find:

```tsx
      // TODO(25): with source "limit" and an entryId, resume that entry's devotional generation (step 25)
```

Replace with:

```tsx
      // A reflection the free limit held back goes by itself: services/purchases.ts calls resumeAfterUpgrade() (step 24)
```

### 2.14 `src/screens/profile/ProfileScreen.tsx`

The Sign Out dialog says how many reflections would be lost. Two `TODO(24)` markers go.

a) Find:

```tsx
import { deleteAccount, requestDataExport, signOutCleanup } from "@/services/account";
```

Replace with:

```tsx
import { countUnsentItems } from "@/data/journalRepository";
import { deleteAccount, requestDataExport, signOutCleanup } from "@/services/account";
```

b) Find:

```tsx
  // TODO(24): with unsent items in the outbox the body becomes "{n} reflections on this phone haven’t been sent yet…"
  signOut: { strings: text.dialogs.signOut, destructive: false },
```

Replace with:

```tsx
  signOut: { strings: text.dialogs.signOut, destructive: false },
```

c) Find:

```tsx
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
```

Replace with:

```tsx
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // How many reflections on this phone the server has never been given: signing out deletes them (step 24).
  const [unsentCount, setUnsentCount] = useState(0);
```

d) Find:

```tsx
  function openDialog(kind: DialogKind) {
    setDialog(kind);
    setDialogError(null);
    setDialogOpen(true);
  }
```

Replace with:

```tsx
  function openDialog(kind: DialogKind) {
    setDialog(kind);
    setDialogError(null);
    setDialogOpen(true);
  }

  // The count is read before the dialog opens, so its first frame already says the truth.
  async function openSignOut() {
    setUnsentCount(await countUnsentItems());
    openDialog("signOut");
  }
```

e) Find:

```tsx
  const dialogContent = DIALOGS[dialog];
```

Replace with:

```tsx
  const dialogContent = DIALOGS[dialog];
  const { signOutUnsent } = text.dialogs;
  const dialogStrings =
    dialog === "signOut" && unsentCount > 0
      ? {
          ...dialogContent.strings,
          body: signOutUnsent.body(unsentCount),
          confirm: signOutUnsent.confirm,
          cancel: signOutUnsent.cancel,
        }
      : dialogContent.strings;
```

f) Find:

```tsx
                  {/* TODO(24): the counts come from the outbox, not from the mock entries */}
                  <SettingsRow
```

Replace with:

```tsx
                  <SettingsRow
```

g) Find:

```tsx
                onPress={() => openDialog("signOut")}
```

Replace with:

```tsx
                onPress={openSignOut}
```

h) Find:

```tsx
        title={dialogContent.strings.title}
        body={dialogContent.strings.body}
        confirmLabel={dialogContent.strings.confirm}
        cancelLabel={dialogContent.strings.cancel}
```

Replace with:

```tsx
        title={dialogStrings.title}
        body={dialogStrings.body}
        confirmLabel={dialogStrings.confirm}
        cancelLabel={dialogStrings.cancel}
```

### 2.15 `src/components/dev/DevToolsPanel.tsx`

`too_short`, "Fail next network call", the Outbox counts and "Sync now", and the plan buttons resume held reflections.

a) Find:

```tsx
import type { MainTabScreenProps, RootStackParamList } from "@/navigation/types";
```

Replace with:

```tsx
import { isDatabaseOpen } from "@/db/database";
import * as outbox from "@/db/outbox";
import type { MainTabScreenProps, RootStackParamList } from "@/navigation/types";
```

b) Find:

```tsx
import { listRecordings } from "@/services/recordingFiles";
```

Replace with:

```tsx
import { listRecordings } from "@/services/recordingFiles";
import { resumeAfterUpgrade, subscribe, syncNow } from "@/services/syncEngine";
```

c) Find:

```tsx
import type { JournalEntry, PermissionResult, SubscriptionTier } from "@/types";
```

Replace with:

```tsx
import type { JournalEntry, OutboxStatus, PermissionResult, SubscriptionTier } from "@/types";
```

d) Find:

```tsx
const SUBMIT_OUTCOMES: MockSubmitOutcome[] = ["ready", "crisis", "failed", "limit"];
```

Replace with:

```tsx
const SUBMIT_OUTCOMES: MockSubmitOutcome[] = ["ready", "crisis", "failed", "limit", "too_short"];
const OUTBOX_STATES: OutboxStatus[] = ["queued", "sending", "needs_action", "limit_reached", "paused_auth"];
```

e) Find:

```tsx
function recordingsLine(): string {
  return `recordings on this phone: ${listRecordings().length}`;
}
```

Replace with:

```tsx
function recordingsLine(): string {
  return `recordings on this phone: ${listRecordings().length}`;
}

// How many reflections are in each state of the outbox: numbers only, never a word that was written.
async function outboxLine(): Promise<string> {
  if (!isDatabaseOpen()) return "outbox: the database is not open";
  try {
    const counts = await outbox.countsByStatus();
    return `outbox: ${OUTBOX_STATES.map((name) => `${name} ${counts[name] ?? 0}`).join(", ")}`;
  } catch {
    return "outbox: could not be read";
  }
}
```

f) Find:

```tsx
  const setNextPrayerMutationFails = useDevStore((state) => state.setNextPrayerMutationFails);
```

Replace with:

```tsx
  const setNextPrayerMutationFails = useDevStore((state) => state.setNextPrayerMutationFails);
  const nextNetworkFails = useDevStore((state) => state.nextNetworkFails);
  const setNextNetworkFails = useDevStore((state) => state.setNextNetworkFails);
```

g) Find:

```tsx
  const [recordingBusy, setRecordingBusy] = useState(false);
```

Replace with:

```tsx
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [outboxText, setOutboxText] = useState("outbox: …");
```

h) Find:

```tsx
  function changePlan(next: SubscriptionTier) {
    setMockSubscriptionTier(next);
    bumpMockProfileVersion();
  }
```

Replace with:

```tsx
  // The outbox counts follow the sync engine: every change it makes to the queue refreshes them.
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      outboxLine().then((line) => {
        if (!cancelled) setOutboxText(line);
      });
    };
    read();
    const stopFollowing = subscribe(read);
    return () => {
      cancelled = true;
      stopFollowing();
    };
  }, []);

  function changePlan(next: SubscriptionTier) {
    setMockSubscriptionTier(next);
    bumpMockProfileVersion();
    // What the free limit held back goes as soon as the plan is paid (a no-op on the free plan).
    void resumeAfterUpgrade();
  }
```

i) Find:

```tsx
        <DevButton
          label="Fail next save (dev)"
          selected={nextPrayerMutationFails}
          onPress={() => setNextPrayerMutationFails(true)}
        />
```

Replace with:

```tsx
        <DevButton
          label="Fail next save (dev)"
          selected={nextPrayerMutationFails}
          onPress={() => setNextPrayerMutationFails(true)}
        />
        {/* The next call the sync engine makes gets no answer, so its retries (5 s, 15 s, 60 s) can be watched. */}
        <DevButton
          label="Fail next network call (dev)"
          selected={nextNetworkFails}
          onPress={() => setNextNetworkFails(true)}
        />
        <View className="items-center gap-2">
          <Text className="text-center text-body-sm text-mauve">Outbox (dev)</Text>
          <Text className="text-center text-body-sm text-ink">{outboxText}</Text>
          <DevButton label="Sync now (dev)" onPress={() => void syncNow("manual")} />
        </View>
```

### 2.16 `src/screens/journal/JournalFeedScreen.tsx`

Banners, the review dialog, the card's new props and the corrected synced toast. This file is LF.

a) Find:

```tsx
import { JournalCard } from "@/components/JournalCard";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PrimaryButton } from "@/components/PrimaryButton";
```

Replace with:

```tsx
import { JournalCard } from "@/components/JournalCard";
import { NoticeBanner } from "@/components/NoticeBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PendingReviewDialog } from "@/components/PendingReviewDialog";
import { PrimaryButton } from "@/components/PrimaryButton";
```

b) Find:

```tsx
  getGreeting,
  type JournalFilter,
} from "@/data/selectors";
```

Replace with:

```tsx
  getGreeting,
  getUnsentCount,
  type JournalFilter,
} from "@/data/selectors";
```

c) Find:

```tsx
import type { MainTabScreenProps } from "@/navigation/types";
import type { JournalEntry } from "@/types";
```

Replace with:

```tsx
import type { MainTabScreenProps } from "@/navigation/types";
import { discardItem } from "@/services/syncEngine";
import type { HomeEntry } from "@/types";
```

d) Find:

```tsx
  const listRef = useRef<FlatList<JournalEntry>>(null);
```

Replace with:

```tsx
  const listRef = useRef<FlatList<HomeEntry>>(null);
```

e) Find:

```tsx
  const [sheetVisible, setSheetVisible] = useState(false);

  // The synced toast shows when the device goes from offline to online. The previous value is kept in
  // state and compared during render, and only while the data is ready: a scenario switch shows the
  // skeleton in between, and it must still count as offline to online.
  const isOffline = state.status === "ready" ? state.isOffline : null;
  const [wasOffline, setWasOffline] = useState(false);
  const [syncedVisible, setSyncedVisible] = useState(false);
  if (isOffline !== null && isOffline !== wasOffline) {
    setWasOffline(isOffline);
    if (wasOffline) {
      setSyncedVisible(true);
    }
  }
```

Replace with:

```tsx
  const [sheetVisible, setSheetVisible] = useState(false);
  // The refused reflection whose "Review" was tapped.
  const [reviewing, setReviewing] = useState<HomeEntry | null>(null);

  // The synced toast shows when the device goes from offline to online and nothing is left to send. The previous
  // value is kept in state and compared during render, and only while the data is ready: a scenario switch shows the
  // skeleton in between, and it must still count as offline to online. With reflections still waiting, "All
  // reflections synced" would not be true yet: their cards change instead.
  const unsentCount = state.status === "ready" ? getUnsentCount(state.entries) : 0;
  const isOffline = state.status === "ready" ? state.isOffline : null;
  const [wasOffline, setWasOffline] = useState(false);
  const [syncedVisible, setSyncedVisible] = useState(false);
  if (isOffline !== null && isOffline !== wasOffline) {
    setWasOffline(isOffline);
    if (wasOffline) {
      setSyncedVisible(unsentCount === 0);
    }
  }
```

f) Find:

```tsx
      {ready.isOffline ? (
        <OfflineBanner unsyncedCount={ready.entries.filter((entry) => entry.isLocalOnly).length} />
      ) : null}
```

Replace with:

```tsx
      {ready.isOffline ? <OfflineBanner unsyncedCount={unsentCount} /> : null}
      {ready.savedNote !== null ? (
        <NoticeBanner message={copy.journal.notes[ready.savedNote]} onDismiss={ready.dismissNote} />
      ) : null}
```

g) Find:

```tsx
            <JournalCard
              entry={item}
              now={ready.now}
              onOpen={(entryId) => navigation.navigate("Reflection", { entryId })}
            />
```

Replace with:

```tsx
            <JournalCard
              entry={item}
              now={ready.now}
              online={ready.isOffline ? false : ready.isOnline}
              onOpen={(entryId) => navigation.navigate("Reflection", { entryId })}
              onReview={setReviewing}
              onUnlock={(entry) =>
                navigation.navigate("Paywall", {
                  source: "limit",
                  entryId: entry.pending?.serverEntryId ?? entry.id,
                })
              }
            />
```

h) Find:

```tsx
        count={visibleEntries.length}
      />
    </SafeAreaView>
```

Replace with:

```tsx
        count={visibleEntries.length}
      />
      <PendingReviewDialog
        entry={reviewing}
        onClose={() => setReviewing(null)}
        onEdit={(clientEntryId) => {
          setReviewing(null);
          navigation.navigate("NewEntry", { mode: "write", resend: clientEntryId });
        }}
        onDelete={discardItem}
      />
    </SafeAreaView>
```

### 2.17 `src/screens/journal/ProcessingOverlay.tsx`

One failure view with a title, a body and two actions, in place of the fixed "Try again / Save and close". This file is LF.

a) Find:

```tsx
type ProcessingOverlayProps = {
  entryKind: "audio" | "text";
  stage: ProcessingStage | null;
  error: boolean;
  onClose: () => void;
  onRetry: () => void;
  onSaveAndClose: () => void;
};
```

Replace with:

```tsx
// The overlay's one failure view (step 24): what went wrong, and the two things the person can do about it.
export type OverlayFailure = {
  title: string;
  body: string;
  primary: { label: string; onPress: () => void };
  secondary: { label: string; onPress: () => void };
};

type ProcessingOverlayProps = {
  entryKind: "audio" | "text";
  stage: ProcessingStage | null;
  failure: OverlayFailure | null;
  onClose: () => void;
};
```

b) Find:

```tsx
export function ProcessingOverlay({
  entryKind,
  stage,
  error,
  onClose,
  onRetry,
  onSaveAndClose,
}: ProcessingOverlayProps) {
```

Replace with:

```tsx
export function ProcessingOverlay({ entryKind, stage, failure, onClose }: ProcessingOverlayProps) {
```

c) Find:

```tsx
  const haloScale = usePulse(1.08, !error);
```

Replace with:

```tsx
  const haloScale = usePulse(1.08, failure === null);
```

d) Find:

```tsx
  const announcement = error ? processing.error.title : stageMessage;
```

Replace with:

```tsx
  const announcement = failure ? failure.title : stageMessage;
```

e) Find:

```tsx
        {error ? (
          <>
            <Text
              accessibilityRole="header"
              className="text-center text-headline text-plum-deep"
              style={styles.title}
            >
              {processing.error.title}
            </Text>
            <Text className="mt-2 text-center text-body text-mauve" style={styles.subtitle}>
              {processing.error.body}
            </Text>
            <View className="mt-6 w-full">
              <PrimaryButton label={processing.error.retry} onPress={onRetry} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={processing.error.saveAndClose}
              className="mt-2 min-h-11 items-center justify-center px-4"
              onPress={onSaveAndClose}
            >
              <Text className="btn-text__label">{processing.error.saveAndClose}</Text>
            </Pressable>
          </>
```

Replace with:

```tsx
        {failure ? (
          <>
            <Text
              accessibilityRole="header"
              className="text-center text-headline text-plum-deep"
              style={styles.title}
            >
              {failure.title}
            </Text>
            <Text className="mt-2 text-center text-body text-mauve" style={styles.subtitle}>
              {failure.body}
            </Text>
            <View className="mt-6 w-full">
              <PrimaryButton label={failure.primary.label} onPress={failure.primary.onPress} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={failure.secondary.label}
              className="mt-2 min-h-11 items-center justify-center px-4"
              onPress={failure.secondary.onPress}
            >
              <Text className="btn-text__label">{failure.secondary.label}</Text>
            </Pressable>
          </>
```

### 2.18 `src/hooks/useJournalHome.ts`

Replace the whole file. Waits for the database, merges the outbox above the entries, follows the engine while the screen is in front, and reads the network from the store. This file is LF.

```ts
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  getLatestAffirmations,
  getProfile,
  listEntries,
  listPendingItems,
} from "@/data/journalRepository";
import type { MockScenario } from "@/data/mock/scenario";
import { mergePending, toPendingEntry } from "@/data/pendingEntries";
import { getCurrentSlot, getReflectionDays } from "@/data/selectors";
import { startOfflineSession } from "@/services/offlineSession";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { subscribe } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import { selectIsOnline, useOfflineStore, type SavedNote } from "@/store/offlineStore";
import type {
  Affirmation,
  HomeEntry,
  JournalEntry,
  OutboxItem,
  TimeSlot,
  UserProfile,
} from "@/types";

export type HomeState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      now: Date;
      profile: UserProfile;
      // The reflections saved on this phone and not prepared yet come first (step 24), then the server's.
      entries: HomeEntry[];
      affirmations: Affirmation[];
      reflectionDays: number;
      currentSlot: TimeSlot;
      isOffline: boolean;
      // false while NetInfo has not answered yet (no banner), true or false after.
      isOnline: boolean | null;
      // The calm line New Entry leaves behind when it saved something that has not been prepared yet.
      savedNote: SavedNote | null;
      dismissNote: () => void;
      refresh: () => Promise<void>;
      refreshing: boolean;
    };

// What a load produced, with the scenario it was for: data loaded for another scenario is not shown.
type LoadResult =
  | {
      scenario: MockScenario;
      status: "ready";
      profile: UserProfile;
      entries: JournalEntry[];
      affirmations: Affirmation[];
    }
  | { scenario: MockScenario; status: "error" };

// Journal Home data. It loads when the screen takes focus (the first time too), when the app returns
// to the foreground while the screen is focused, when the scenario changes, and on pull-to-refresh. It waits for the
// signed-in user's database (the reflections saved on this phone live in it), and, while the screen is in front, it
// follows the sync engine: the list of unsent reflections refreshes after every change, and the whole list after a
// reflection has been prepared.
export function useJournalHome(): HomeState {
  const scenario = useDevStore((state) => state.scenario);
  const dbReady = useOfflineStore((state) => state.dbReady);
  const dbFailed = useOfflineStore((state) => state.dbFailed);
  const online = useOfflineStore(selectIsOnline);
  const savedNote = useOfflineStore((state) => state.savedNote);
  const [now, setNow] = useState(() => new Date());
  const [result, setResult] = useState<LoadResult | null>(null);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);
  const latestPending = useRef(0);

  const refreshPending = useCallback(async () => {
    latestPending.current += 1;
    const request = latestPending.current;
    const items = await listPendingItems();
    if (request === latestPending.current) setPending(items);
  }, []);

  const load = useCallback(async () => {
    if (!dbReady) return;
    latestRequest.current += 1;
    const request = latestRequest.current;
    latestPending.current += 1;
    const pendingRequest = latestPending.current;
    setNow(new Date());
    try {
      const dev = useDevStore.getState();
      if (dev.nextHomeLoadFails) {
        dev.setNextHomeLoadFails(false);
        throw new Error("Journal load failed on purpose (dev)");
      }
      const [profile, entries, affirmations, items] = await Promise.all([
        getProfile(),
        listEntries(),
        getLatestAffirmations(),
        listPendingItems(),
      ]);
      if (request !== latestRequest.current) return;
      if (pendingRequest === latestPending.current) setPending(items);
      setResult({ scenario, status: "ready", profile, entries, affirmations });
    } catch {
      if (request !== latestRequest.current) return;
      // A failed refresh keeps the data that is already on screen.
      setResult((previous) =>
        previous?.status === "ready" && previous.scenario === scenario
          ? previous
          : { scenario, status: "error" },
      );
    }
  }, [scenario, dbReady]);

  // The callback changes with the scenario and with the database, so useFocusEffect reloads then if the screen is
  // focused, and otherwise on the next focus. Leaving the screen drops a response that is still on its way.
  useFocusEffect(
    useCallback(() => {
      load();
      const subscription = AppState.addEventListener("change", (status) => {
        if (status === "active") load();
      });
      const stopFollowing = subscribe((event) => {
        if (event.type === "finished") {
          // What New Entry left behind is no longer true once the reflection is ready.
          useOfflineStore.getState().setSavedNote(null);
          load();
        } else if (event.type === "changed") {
          refreshPending();
        }
      });
      return () => {
        subscription.remove();
        stopFollowing();
        latestRequest.current += 1;
      };
    }, [load, refreshPending]),
  );

  const retry = useCallback(() => {
    setResult(null);
    if (dbFailed) {
      // The database could not be opened: open it again, and the load follows once it is ready.
      const userId = getSupabaseUserId();
      if (userId !== null) void startOfflineSession(userId);
      return;
    }
    load();
  }, [load, dbFailed]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    useOfflineStore.getState().setSavedNote(null);
    await load();
    setRefreshing(false);
  }, [load]);

  const dismissNote = useCallback(() => useOfflineStore.getState().setSavedNote(null), []);

  if (dbFailed) {
    return { status: "error", retry };
  }
  const current = dbReady && result?.scenario === scenario ? result : null;
  if (current === null) {
    return { status: "loading" };
  }
  if (current.status === "error") {
    return { status: "error", retry };
  }
  const entries = mergePending(current.entries, pending.map(toPendingEntry));
  return {
    status: "ready",
    now,
    profile: current.profile,
    entries,
    affirmations: current.affirmations,
    reflectionDays: getReflectionDays(entries, now),
    currentSlot: getCurrentSlot(now, current.profile.reminders),
    // The dev scenario still forces the offline look in development.
    isOffline: scenario === "offline" || online === false,
    isOnline: online,
    savedNote,
    dismissNote,
    refresh,
    refreshing,
  };
}
```

### 2.19 `src/components/JournalCard.tsx`

Replace the whole file. The pending status lines, the two pill buttons, and a card with a button that is not one grouped element. The old disabled "Try again" on a server-failed entry is kept (its marker is now `TODO(25)`). This file is LF.

```tsx
import type { SymbolViewProps } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { EmotionBadge } from "@/components/EmotionBadge";
import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import type { HomeEntry, JournalEntry } from "@/types";
import {
  formatDuration,
  formatDurationSpoken,
  formatEntryTimestamp,
  formatWeekday,
} from "@/utils/format";

const icons = {
  play: { android: "play_arrow", ios: "play.fill" },
  hourglass: { android: "hourglass_top", ios: "hourglass" },
  refresh: { android: "refresh", ios: "arrow.clockwise" },
  support: { android: "favorite", ios: "heart" },
} satisfies Record<string, SymbolViewProps["name"]>;

// Every status has its own card. A crisis entry is a finished one in the data, but it is never
// shown as ready: no emotion, no scripture, no transcript.
type CardKind = "ready" | "textOnly" | "processing" | "uploading" | "pending" | "failed" | "crisis";

function getKind(entry: JournalEntry): CardKind {
  if (entry.isCrisis) return "crisis";
  switch (entry.status) {
    case "ready":
      return entry.devotional?.audioPath ? "ready" : "textOnly";
    case "processing":
    case "uploading":
    case "pending":
    case "failed":
      return entry.status;
  }
}

// The status line of a reflection that is saved on this phone and not prepared yet (entry.pending). The card shows it
// and a screen reader speaks it, so it is one string.
function getPendingLine(entry: HomeEntry, online: boolean | null): string | null {
  const { pending } = entry;
  if (!pending) return null;
  const weekday = pending.resetsAt === null ? null : formatWeekday(pending.resetsAt);
  return copy.journal.card.pendingLine(pending.status, online, weekday);
}

// One summary for a screen reader, built from the parts the card shows. The transcript is not part of it.
function getLabel(entry: HomeEntry, kind: CardKind, timestamp: string, pendingLine: string | null): string {
  const { a11y } = copy.journal.card;
  const parts = [a11y.from(timestamp)];
  if (pendingLine !== null) {
    parts.push(pendingLine);
    return `${parts.join(". ")}.`;
  }
  switch (kind) {
    case "ready":
    case "textOnly": {
      if (entry.dominantEmotion) parts.push(a11y.emotion(entry.dominantEmotion.toLowerCase()));
      if (entry.scripture) parts.push(entry.scripture.reference);
      const durationMs = entry.devotional?.durationMs;
      if (kind === "textOnly") {
        parts.push(copy.journal.card.textOnly);
      } else {
        parts.push(
          durationMs ? a11y.devotional(formatDurationSpoken(durationMs)) : a11y.devotionalAudio,
        );
      }
      break;
    }
    case "processing":
      parts.push(a11y.preparing);
      break;
    case "uploading":
      parts.push(a11y.saving);
      break;
    case "pending":
      parts.push(copy.journal.card.waiting);
      break;
    case "failed":
      parts.push(a11y.failed);
      break;
    case "crisis":
      parts.push(a11y.support);
      break;
  }
  return `${parts.join(". ")}.`;
}

// The two lines of the card's body. An audio entry has no transcript until the server has processed
// it, and a crisis entry's transcript is never shown. A reflection that is only on this phone never
// shows its words (the screen can be seen by someone else), so a written one says only that it is one.
function Excerpt({ entry }: { entry: HomeEntry }) {
  if (entry.isCrisis) {
    return <Text className="text-body text-ink">{copy.journal.card.crisis}</Text>;
  }
  const transcript = entry.transcript?.trim();
  if (!transcript) {
    return (
      <Text className="text-body text-mauve" numberOfLines={2}>
        {entry.inputType === "text"
          ? copy.journal.card.writtenReflection
          : copy.journal.card.voiceReflection}
      </Text>
    );
  }
  return (
    <Text className="text-body text-ink" numberOfLines={2}>
      {copy.journal.card.quote(transcript)}
    </Text>
  );
}

// durationMs is nullable (audio can exist without a measured length), so then it shows the icon alone.
// A plain View while the whole card opens Reflection.
// TODO(26): play in place (its own Pressable, with hitSlop so the touch area is 44)
function DurationPill({ durationMs }: { durationMs: number | null | undefined }) {
  return (
    <View className="min-h-[26px] flex-row items-center gap-1.5 rounded-full bg-plum-deep px-3 py-1">
      <Icon name={icons.play} size={14} color="white" />
      {durationMs ? (
        <Text
          className="font-dm-semibold text-[12px] leading-[18px] text-white"
          style={styles.tabular}
        >
          {formatDuration(durationMs)}
        </Text>
      ) : null}
    </View>
  );
}

// A small outlined button on a card: "Review", "See plans".
function PillButton({
  label,
  accessibilityLabel,
  icon,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  icon?: SymbolViewProps["name"];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // The pill is about 28 tall, so 8 above and below makes a 44 touch area.
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressedSoft}
    >
      <View className="shrink-0 flex-row items-center gap-1 rounded-full border border-petal bg-card px-3 py-1">
        {icon ? <Icon name={icon} size={14} color={colors.ink} /> : null}
        <Text className="text-label-md text-ink">{label}</Text>
      </View>
    </Pressable>
  );
}

type PendingFooterProps = {
  entry: HomeEntry;
  line: string;
  online: boolean | null;
  onReview?: (entry: HomeEntry) => void;
  onUnlock?: (entry: HomeEntry) => void;
};

// The footer of a reflection that is saved on this phone and not prepared yet.
function PendingFooter({ entry, line, online, onReview, onUnlock }: PendingFooterProps) {
  const { card } = copy.journal;
  const status = entry.pending?.status;
  if (status === "needs_action") {
    return (
      <View className="flex-row items-center gap-3 pt-0.5">
        <Text className="flex-1 text-body-sm text-rosewood">{line}</Text>
        {onReview ? (
          <PillButton
            label={card.review}
            accessibilityLabel={card.reviewLabel}
            onPress={() => onReview(entry)}
          />
        ) : null}
      </View>
    );
  }
  if (status === "limit_reached") {
    return (
      <View className="flex-row items-center gap-3 pt-0.5">
        <Text className="flex-1 text-body-sm text-mauve">{line}</Text>
        {onUnlock ? (
          <PillButton
            label={card.seePlans}
            accessibilityLabel={card.seePlansLabel}
            onPress={() => onUnlock(entry)}
          />
        ) : null}
      </View>
    );
  }
  // Being sent now, or about to be: a spinner. Waiting for the phone to connect or for a sign-in: the hourglass.
  if (status === "sending" || (status === "queued" && online !== false)) {
    return (
      <View className="flex-row items-center gap-2 pt-0.5">
        <ActivityIndicator size="small" color={colors.plum} />
        <Text className="flex-1 text-body-sm text-mauve">{line}</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-2 pt-0.5">
      <Icon name={icons.hourglass} size={14} color={colors.mauve} />
      <Text className="flex-1 text-body-sm text-mauve">{line}</Text>
    </View>
  );
}

function CardFooter({
  entry,
  kind,
  pendingLine,
  online,
  onReview,
  onUnlock,
}: {
  entry: HomeEntry;
  kind: CardKind;
  pendingLine: string | null;
  online: boolean | null;
  onReview?: (entry: HomeEntry) => void;
  onUnlock?: (entry: HomeEntry) => void;
}) {
  const { card } = copy.journal;
  if (pendingLine !== null) {
    return (
      <PendingFooter
        entry={entry}
        line={pendingLine}
        online={online}
        onReview={onReview}
        onUnlock={onUnlock}
      />
    );
  }
  switch (kind) {
    case "ready":
    case "textOnly":
      return (
        <View className="flex-row items-center justify-end pt-0.5">
          {entry.scripture ? (
            <Text
              className="mr-3 flex-1 font-fraunces-italic text-[15px] leading-[20px] text-rosewood"
              numberOfLines={1}
            >
              {entry.scripture.reference}
            </Text>
          ) : null}
          {kind === "ready" ? (
            <DurationPill durationMs={entry.devotional?.durationMs} />
          ) : (
            <View className="chip">
              <Text className="chip__label">{card.textOnly}</Text>
            </View>
          )}
        </View>
      );
    case "processing":
    case "uploading":
      return (
        <View className="flex-row items-center gap-2 pt-0.5">
          <ActivityIndicator size="small" color={colors.plum} />
          <Text className="flex-1 text-body-sm text-mauve">
            {kind === "processing" ? card.preparing : card.saving}
          </Text>
        </View>
      );
    case "pending":
      return (
        <View className="flex-row pt-0.5">
          <View className="chip gap-1.5">
            <Icon name={icons.hourglass} size={12} color={colors.mauve} />
            <Text className="chip__label">{card.waiting}</Text>
          </View>
        </View>
      );
    case "failed":
      // An entry the server marked failed, which has no copy of its words on this phone to send again. (A refused
      // reflection that is still on this phone has `pending`, and the Review button in PendingFooter.)
      return (
        <View className="flex-row items-center gap-3 pt-0.5">
          <Text className="flex-1 text-body-sm text-rosewood">{card.failed}</Text>
          {/* TODO(25): retry a failed entry from the server copy of its words */}
          <Pressable
            disabled
            accessibilityRole="button"
            accessibilityLabel={card.tryAgain}
            accessibilityState={{ disabled: true }}
            style={styles.disabled}
          >
            <View className="shrink-0 flex-row items-center gap-1 rounded-full border border-petal bg-card px-3 py-1">
              <Icon name={icons.refresh} size={14} color={colors.ink} />
              <Text className="text-label-md text-ink">{card.tryAgain}</Text>
            </View>
          </Pressable>
        </View>
      );
    case "crisis":
      return (
        <View className="flex-row pt-0.5">
          <View className="chip gap-1.5">
            <Icon name={icons.support} size={12} color={colors.mauve} />
            <Text className="chip__label">{card.support}</Text>
          </View>
        </View>
      );
  }
}

type JournalCardProps = {
  entry: HomeEntry;
  now: Date;
  // false when the phone has no connection, null before NetInfo has answered.
  online: boolean | null;
  onOpen: (entryId: string) => void;
  // A refused reflection on this phone: "Review" opens what can be done with it.
  onReview?: (entry: HomeEntry) => void;
  // A reflection the free limit is holding back: "See plans" opens the Paywall.
  onUnlock?: (entry: HomeEntry) => void;
};

export function JournalCard({ entry, now, online, onOpen, onReview, onUnlock }: JournalCardProps) {
  const kind = getKind(entry);
  const timestamp = formatEntryTimestamp(entry.createdAt, now);
  const pendingLine = getPendingLine(entry, online);
  const label = getLabel(entry, kind, timestamp, pendingLine);
  const isFinished = kind === "ready" || kind === "textOnly";
  // A card with a button of its own is not one grouped element: a button inside it must be reachable on its own.
  const hasButton =
    entry.pending?.status === "needs_action" || entry.pending?.status === "limit_reached";

  const card = (
    <View className="card gap-2.5" style={shadows.card}>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-body-sm text-mauve" numberOfLines={1}>
          {timestamp}
        </Text>
        {isFinished && entry.dominantEmotion ? (
          <EmotionBadge emotion={entry.dominantEmotion} />
        ) : null}
      </View>
      <Excerpt entry={entry} />
      <CardFooter
        entry={entry}
        kind={kind}
        pendingLine={pendingLine}
        online={online}
        onReview={onReview}
        onUnlock={onUnlock}
      />
    </View>
  );

  // Only a finished entry and a crisis entry open Reflection. The others are one labelled element and
  // not a button. The Pressable carries only the style function: classes go on the inner View.
  if (!isFinished && kind !== "crisis") {
    return (
      <View accessible={!hasButton} accessibilityLabel={hasButton ? undefined : label}>
        {card}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onOpen(entry.id)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { transform: [{ scale: 0.98 }] },
  pressedSoft: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  tabular: { fontVariant: ["tabular-nums"] },
});
```

### 2.20 `src/screens/journal/NewEntryScreen.tsx`

Replace the whole file. Save first, then wait for the engine; the two failure kinds; `popTo` Journal; "Edit and resend"; the "Saved locally" line is gone. This file is CRLF.

```tsx
import { usePreventRemove, type NavigationAction } from "@react-navigation/native";
import { randomUUID } from "expo-crypto";
import type { SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { MIN_RECORDING_MS, MIN_TEXT_LENGTH } from "@/constants/app";
import { copy } from "@/constants/copy";
import { colors, layout } from "@/constants/theme";
import * as outbox from "@/db/outbox";
import { useRecorder } from "@/hooks/useRecorder";
import type { RootStackScreenProps } from "@/navigation/types";
import { haptics } from "@/services/haptics";
import { discardItem, syncAndWait, syncNow } from "@/services/syncEngine";
import { selectIsOnline, useOfflineStore, type SavedNote } from "@/store/offlineStore";
import type { ProcessingStage } from "@/types";

import { ProcessingOverlay, type OverlayFailure } from "./ProcessingOverlay";
import { SpeakSection } from "./SpeakSection";
import { WriteSection } from "./WriteSection";

const { header, modes, footer, discard, discardRecording, processing } = copy.newEntry;

// After the modal transition, as in EmailSheet: autoFocus inside a modal can leave the keyboard closed.
const FOCUS_DELAY_MS = 350;

// The footer button's padding, gap and icon, and the width of its longest label at 15 SemiBold. Below
// their sum (scaled with the font) the button wraps under Cancel instead of clipping.
const BUTTON_CHROME = 74;
const LONGEST_BUTTON_LABEL = 130;

const icons = {
  close: { android: "close", ios: "xmark" },
  lock: { android: "lock", ios: "lock.fill" },
  arrow: { android: "arrow_forward", ios: "arrow.right" },
} satisfies Record<string, SymbolViewProps["name"]>;

const modeItems = [
  { value: "speak", label: modes.speak },
  { value: "write", label: modes.write },
] as const;

type Phase = "editing" | "sending" | "error";
type DialogKind = "leave" | "record-again";
// The phone could not save the reflection, or the server refused it for a reason only the person can fix.
type Failure = { kind: "save" } | { kind: "refused"; code: string };
type QueuedItem = Parameters<typeof outbox.enqueue>[0];

export function NewEntryScreen({ navigation, route }: RootStackScreenProps<"NewEntry">) {
  const { width, fontScale } = useWindowDimensions();
  // One id per reflection: the recording is named after it (recordings/{id}.m4a), the outbox row is keyed by it, and the
  // server treats a second request with it as the same reflection. "Edit and resend" opens this screen with the id of
  // the item it edits. "Record again" after a refusal makes a new one, because the server has kept the old one.
  const [clientEntryId, setClientEntryId] = useState(() => route.params.resend ?? randomUUID());
  const recorder = useRecorder(clientEntryId);
  const [mode, setMode] = useState(route.params.mode);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("editing");
  const [stage, setStage] = useState<ProcessingStage | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  // True while a reflection is being saved on this phone with no overlay (the phone is offline).
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);
  // The removal the guard stopped, kept until the dialog is answered.
  const pendingLeave = useRef<NavigationAction | null>(null);
  // Set just before every deliberate exit, so the guard lets it through.
  const leaving = useRef(false);
  const mounted = useRef(false);
  // Blocks a second press while a submit is on its way.
  const submitting = useRef(false);
  // What was last saved, for "Try again" after the phone could not save it.
  const lastItem = useRef<QueuedItem | null>(null);
  // True once the reflection is in the outbox. Leaving on purpose with "Discard" then deletes it as well.
  const inOutbox = useRef(false);

  // A take that is recording or paused is already something to keep, and the toggle stays locked until it is stopped.
  const recordingOpen = recorder.state === "recording" || recorder.state === "paused";
  const hasAudio = recordingOpen || recorder.state === "recorded";
  const hasContent = hasAudio || text.trim().length > 0;
  const canSubmit =
    mode === "speak"
      ? hasAudio && recorder.durationMs >= MIN_RECORDING_MS
      : text.trim().length >= MIN_TEXT_LENGTH;
  const modeLocked = recordingOpen || recorder.state === "requesting";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (route.params.mode !== "write") {
      return undefined;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [route.params.mode]);

  // "Edit and resend" from Journal: the words that were refused come back into the field, and sending them again
  // reuses the same id (outbox.enqueue puts the refused item back in the queue with the new words).
  const resend = route.params.resend;
  useEffect(() => {
    if (resend === undefined) return undefined;
    let cancelled = false;
    outbox.get(resend).then(
      (item) => {
        if (!cancelled && item?.text) {
          inOutbox.current = true;
          setText(item.text);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [resend]);

  // Every removal fires this, replace() included, so deliberate exits set `leaving` first and the
  // guard passes the action straight on. While sending nothing may leave; otherwise ask first.
  usePreventRemove(phase !== "editing" || hasContent, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
    } else if (phase !== "sending") {
      pendingLeave.current = data.action;
      setDialog("leave");
    }
  });

  function keepEditing() {
    pendingLeave.current = null;
    setDialog(null);
  }

  async function confirmLeave() {
    const action = pendingLeave.current;
    pendingLeave.current = null;
    setDialog(null);
    await recorder.discard();
    // Discarding deletes the reflection from this phone, the queued copy too.
    if (inOutbox.current) await discardItem(clientEntryId);
    // The kept action already carries the routes the guard asked about, so it passes.
    if (action) navigation.dispatch(action);
  }

  async function confirmRecordAgain() {
    setDialog(null);
    await recorder.discard();
  }

  // A reflection that is saved and not finished leaves this screen for Journal, where its card is, with one calm line.
  function leaveToJournal(note: SavedNote | null) {
    if (note !== null) useOfflineStore.getState().setSavedNote(note);
    leaving.current = true;
    navigation.popTo("MainTabs", { screen: "Journal" });
  }

  // Saves the reflection on this phone first, and only then tries the network: what is saved is never lost to a failed
  // request. Online, the overlay shows while the sync engine prepares it. Offline, there is nothing to wait for.
  async function save(item: QueuedItem) {
    const online = selectIsOnline(useOfflineStore.getState()) !== false;
    if (online) {
      setFailure(null);
      setPhase("sending");
      setStage("receiving");
    } else {
      setSaving(true);
    }
    try {
      // A refused written reflection is still in the outbox under this id. If the person has switched to Speak since,
      // the recording replaces it: the old row goes (its words are not wanted any more), and the new one takes its id.
      if (inOutbox.current) {
        const existing = await outbox.get(item.clientEntryId);
        if (existing !== null && existing.inputType !== item.inputType) await outbox.remove(item.clientEntryId);
      }
      await outbox.enqueue(item);
      inOutbox.current = true;
    } catch {
      if (!mounted.current) return;
      submitting.current = false;
      setSaving(false);
      setFailure({ kind: "save" });
      setPhase("error");
      return;
    }
    if (!mounted.current) return;
    if (!online) {
      void syncNow("submit");
      leaveToJournal("offline");
      return;
    }
    const result = await syncAndWait(item.clientEntryId, {
      onStage: (next) => {
        if (mounted.current) setStage(next);
      },
    });
    if (!mounted.current) return;
    switch (result.kind) {
      case "ready":
        leaving.current = true;
        // Only a finished devotional gets the success tap: a crisis result is as calm as the screen it opens.
        if (!result.isCrisis) haptics.success();
        // Reflection decides what to show; the crisis state is a data state (step 13). A crisis is checked before the
        // free limit, so it never reaches the Paywall.
        navigation.replace("Reflection", { entryId: result.entryId });
        break;
      case "limit":
        leaving.current = true;
        // The reflection is saved (here, and on the server once step 25 sends it): the Paywall says so.
        navigation.replace("Paywall", { source: "limit", entryId: result.entryId ?? item.clientEntryId });
        break;
      case "needs_action":
        submitting.current = false;
        setFailure({ kind: "refused", code: result.code });
        setPhase("error");
        break;
      case "later":
        // No answer yet (offline again, busy, a retry is scheduled): the engine goes on by itself.
        leaveToJournal("retry");
        break;
    }
  }

  async function submit() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    Keyboard.dismiss();
    let item: QueuedItem;
    if (mode === "speak") {
      // Finish while recording or paused stops first (the file is then in recordings/), then queues what was recorded.
      const audio = recordingOpen ? await recorder.stop() : recorder.recording;
      if (!audio) {
        submitting.current = false;
        return;
      }
      item = {
        clientEntryId,
        inputType: "audio",
        durationMs: audio.durationMs,
        mimeType: audio.mimeType,
      };
    } else {
      item = { clientEntryId, inputType: "text", text: text.trim() };
    }
    lastItem.current = item;
    await save(item);
  }

  // The phone could not save the reflection: the same item again, with the same id.
  function retrySave() {
    if (!lastItem.current || submitting.current) return;
    submitting.current = true;
    void save(lastItem.current);
  }

  // Back to what was on screen. A refused written reflection stays in the outbox until it is sent again or deleted.
  function backToEditing() {
    submitting.current = false;
    setSaving(false);
    setFailure(null);
    setPhase("editing");
  }

  // A refused recording cannot be fixed: the item and its file go, and the next take gets a new id.
  async function recordAgainAfterRefusal() {
    await discardItem(clientEntryId);
    await recorder.discard();
    inOutbox.current = false;
    lastItem.current = null;
    setClientEntryId(randomUUID());
    backToEditing();
  }

  // The item stays in the outbox: Journal shows it with "Review".
  function closeAfterRefusal() {
    leaveToJournal(null);
  }

  function closeWhileSending() {
    // The engine goes on with it, and Journal shows its card.
    leaveToJournal("retry");
  }

  let overlayFailure: OverlayFailure | null = null;
  if (phase === "error" && failure !== null) {
    const { save: saveFailure, refused } = processing.failures;
    overlayFailure =
      failure.kind === "save"
        ? {
            title: saveFailure.title,
            body: saveFailure.body,
            primary: { label: saveFailure.primary, onPress: retrySave },
            secondary: { label: saveFailure.secondary, onPress: backToEditing },
          }
        : {
            title: refused.title,
            body: copy.problems.reason(failure.code),
            primary:
              mode === "speak"
                ? { label: refused.recordAgain, onPress: () => void recordAgainAfterRefusal() }
                : { label: refused.editText, onPress: backToEditing },
            secondary: { label: refused.close, onPress: closeAfterRefusal },
          };
  }

  const padding = width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding;
  const editing = phase === "editing";

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {/* The editing view stays mounted under the overlay, so a retry keeps the text and the recording. */}
        <View
          style={styles.flex}
          accessibilityElementsHidden={!editing}
          importantForAccessibility={editing ? "auto" : "no-hide-descendants"}
        >
          <View className="screen__content min-h-14 flex-row items-center gap-2 py-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.common.close}
              onPress={() => navigation.goBack()}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View className="size-11 items-center justify-center">
                <Icon name={icons.close} size={20} color={colors.ink} />
              </View>
            </Pressable>
            <View className="flex-1">
              <Text accessibilityRole="header" className="text-section text-plum-deep">
                {header.title}
              </Text>
            </View>
            <View className="shrink-0 flex-row items-center gap-1 rounded-full bg-linen-deep px-2.5 py-1">
              <Icon name={icons.lock} size={14} color={colors.plumDeep} />
              <Text className="text-label-md text-plum-deep">{header.private}</Text>
            </View>
          </View>
          <View className="screen__content my-1">
            <View className="divider" />
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: padding, paddingBottom: 24 }}
          >
            <View className="mb-4 mt-1">
              <SegmentedControl
                items={modeItems}
                value={mode}
                onChange={setMode}
                variant="plum"
                compact
                disabled={modeLocked}
                accessibilityLabel={modes.label}
              />
            </View>
            {mode === "speak" ? (
              <SpeakSection
                recorder={recorder}
                onRecordAgain={() => setDialog("record-again")}
                onWriteInstead={() => setMode("write")}
              />
            ) : (
              <WriteSection text={text} onChangeText={setText} inputRef={inputRef} />
            )}
          </ScrollView>

          <View className="screen__content flex-row flex-wrap items-center gap-x-4 gap-y-2 pb-3 pt-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={footer.cancel}
              className="min-h-11 justify-center px-5"
              onPress={() => navigation.goBack()}
            >
              <Text className="text-label-lg text-ink/80">{footer.cancel}</Text>
            </Pressable>
            <View className="flex-1" style={{ minWidth: BUTTON_CHROME + LONGEST_BUTTON_LABEL * fontScale }}>
              <PrimaryButton
                label={mode === "speak" ? footer.finish : footer.submit}
                iconRight={icons.arrow}
                disabled={!canSubmit}
                loading={saving}
                onPress={submit}
              />
            </View>
          </View>
        </View>

        {editing ? null : (
          <ProcessingOverlay
            entryKind={mode === "speak" ? "audio" : "text"}
            stage={stage}
            failure={overlayFailure}
            onClose={closeWhileSending}
          />
        )}
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={dialog === "leave"}
        tone="destructive"
        title={discard.title}
        body={discard.body}
        confirmLabel={discard.confirm}
        cancelLabel={discard.cancel}
        onConfirm={confirmLeave}
        onCancel={keepEditing}
      />
      <ConfirmDialog
        visible={dialog === "record-again"}
        tone="destructive"
        title={discardRecording.title}
        body={discardRecording.body}
        confirmLabel={discardRecording.confirm}
        cancelLabel={discardRecording.cancel}
        onConfirm={confirmRecordAgain}
        onCancel={() => setDialog(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.linen },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
});
```

---

## 3. The checks the review created (`supabase/tests/offline/`)

`run.cjs` and `world.cjs` are already in the repo. They run the app's real `database.ts`, `fieldCrypto.ts`, `outbox.ts`, `cache.ts`, `syncPolicy.ts`, `syncEngine.ts`, `offlineSession.ts`, `connectivity.ts`, `offlineStore.ts`, `pendingEntries.ts`, `recordingCleanup.ts` and `account.ts` in Node (the repo's TypeScript and the loader of the step 17 and 18 sync checks, `supabase/tests/profile-sync/loader.cjs`), on fakes:

- **expo-sqlite**, shaped like 58's `SQLiteDatabase`, backed by Node's own `node:sqlite` on real files in a temporary folder: every statement the app writes runs for real, the constraints bite, WAL files appear, and "delete the database" removes real files (the fake rejects when there is no file, as the real one does);
- **expo-crypto's AES** (`AESEncryptionKey`, `AESSealedData`, `aesEncryptAsync`, `aesDecryptAsync`) over `node:crypto` AES-256-GCM, so a changed token really fails to open;
- **SecureStore** (with an option to make the keychain unreadable), **NetInfo** (listener called at once, then on `emit`), **AppState**, the **recordings folder**, and a **scripted processor** (a queue of outcomes or functions, so a call can hang, throw, answer late or be counted);
- the **virtual clock** of the step 23 checks, so a 200-second ceiling, a 1-hour retry and a week's reset take no real time.

Run it with `node --no-warnings supabase/tests/offline/run.cjs` (about 6 seconds, no device; Node 22.5 or newer). It must end with `44 of 44 passed`. The 44:

| group | checks | what they prove |
| --- | --- | --- |
| database | 9 | file named after a hash and never the id, WAL, version 1, the key's keychain option; reopen keeps rows; a newer file refused and untouched; a failed migration changes nothing; a missing key resets once and logs one code; an unreadable keychain deletes nothing; delete removes file, sidecars and key and never throws; another user gets another file; overlapping opens, closes and deletes end consistent |
| encryption | 1 | a `v1.` token, never the same twice, unicode and empty text, a changed, foreign-prefix or non-token value opens as nothing, a key from the keychain opens an old token, another user's key does not |
| outbox | 9 | stored sealed, a double tap changes nothing, a refused written item takes new words and nothing else is rewritten, FIFO and due-ness, one attempt per take, every way to stop keeps what the next step needs, the unsent count, SQL-looking ids and the table constraints, unreadable words, and **no word in the bytes of the database files** |
| cache | 1 | newest first, replace, prune, affirmations leave with their entry, clear |
| policy, stores, cards | 4 | every error code's action, an unknown code retried, the delays with jitter and minimums; unknown network counts as online for sending and shows no banner; one NetInfo listener; pending cards carry no words and a server copy never shows twice |
| engine | 19 | one at a time and oldest first, cache then dequeue then delete the recording (in that order), a mock answer never cached, 5 s then 15 s then success, nothing in the background, 30 and 60 second minimums, the limit held until the plan is paid or the week ends, a refused session asked again once per visit, a refusal never retried and told to the waiting screen, nothing sent offline, a `sending` item queued again at start, an answer after sign-out ignored, `syncAndWait` ends (ready, crisis, limit, 90 seconds, not started), a call that never answers after 200 seconds and one that throws, a second reflection saved mid-run, unreadable words never sent, discard, recording cleanup, the session start and a stale open, **nothing sensitive in the log** |
| sign out | 1 | engine stopped before the file is deleted, then file, key and recordings gone, the other cleanups run, and a second call is harmless |

**The review's mutation run.** The code was broken 52 ways, one at a time, in the copy of the repo, and the run had to go red each time (file named after the raw id, no WAL, the version not recorded, a newer file accepted, a missing key quietly re-made, a key left behind, opens not serialized, another user's database left open, words stored in the clear, a foreign token accepted; a double tap rewriting words, newest first, an item taken twice, the unsent count including the limit, a refused session pausing what needs the person, a held item resumed early, the Journal list reversed; affirmations left behind, pruning the wrong end, a wrong-shape row believed; the free limit retried, a refusal retried, an unknown code dropped, no minimum for a rate limit, no jitter; the outbox row removed before the cache, the recording kept, a mock answer cached, an answer after sign-out applied, no reset of `sending`, the network ignored, the background ignored, a refused session not asked again, a retry that never grows, a waiting screen that never gives up, a call with no ceiling, unreadable words sent, two runs at once, the plan always paid, a discard that keeps the recording, a stale open that starts the engine; a recording with an item cleaned, an unknown age cleaned, words on a pending card, a double listing, unknown network as offline or as online, a network event that does not clear a failed request; sign-out leaving the file, deleting before stopping, leaving the recordings; two NetInfo listeners). **52 caught by a named check, none survived.**

**The older checks were extended in the review.** `supabase/tests/profile-sync/run.cjs` loads `account.ts` and `journalRepository.ts` in plain Node, and both now import the user's database (and `account.ts` the sync session), which plain Node cannot load (step 23's note predicted this). The review added fakes for `@/db/database`, `@/db/outbox` and `@/services/offlineSession` at the three places that need them (`makeSyncEnv`, `clientEnv` and the step 17 upgrade check). It passes **88 of 88 both before and after** the step 24 files exist, so it is no red or green signal for this step: do not touch it again unless a check names a missing module.

**What the checks cannot show** is everything that needs a phone: the native SQLite and AES modules, the real keychain, NetInfo's real events, Airplane mode, and how the new cards and banners look. Those are your walk-through (B).

---

## 4. AGENTS.md updates

**Already made in the review (do not repeat):** the Tech Stack bullet for the local database; the "Local Cache & Offline Rules" encryption bullet (now the decision, with the sentence on how a reflection is saved, retried and held) and a second bullet on the outbox; and one vendor note at the end of "SDK and Vendor Version Notes" (expo-sqlite 58, expo-crypto AES and NetInfo 12, with what the harness can and cannot show). Also made: `docs/legal-brief.md` (three lines) and `docs/privacy-policy.md` (the "What stays on your device" TODO) now state what this step settles about the on-device copy: the words are encrypted, the bookkeeping and the recordings are not, and a backup includes them. The privacy page is still a draft for a lawyer.

**You make these, once the code is in and the checks pass.** AGENTS.md is CRLF: use the same script as section 2, then `cp AGENTS.md prompts/AGENTS.md` and `cmp` them.

**4.1 Tech Stack.** In the Client list, after the `expo-notifications` bullet, add: `expo-sqlite` and `@react-native-community/netinfo` for the offline outbox and read cache (step 24), with the installed versions (`expo-sqlite` ~58.0.14 and NetInfo 12.0.1 if that is what `npx expo install` wrote), and that `await-lock` came with `expo-sqlite`. In "Decision Making & Clarifications", at the end of the "Approved so far" list add `and in step 24 expo-sqlite and @react-native-community/netinfo (named by the step prompt)`.

**4.2 Architecture tree.** Add the new folder and files, each with its exported names: `src/db/` (`schema.ts`: `MIGRATIONS`; `fieldCrypto.ts`: `loadFieldKey`, `unloadFieldKey`, `deleteStoredFieldKey`, `encryptText`, `decryptText`; `database.ts`: `userHash`, `databaseName`, `isDatabaseOpen`, `getDb`, `migrate`, `openUserDatabase`, `closeUserDatabase`, `deleteUserDatabase`; `outbox.ts`; `cache.ts`), `store/offlineStore.ts` (`useOfflineStore`, `selectIsOnline`, `selectCanSend`), `services/` (`connectivity.ts`, `syncPolicy.ts`, `syncEngine.ts`, `entryProcessor.ts`, `offlineSession.ts`, `recordingCleanup.ts`), `data/pendingEntries.ts` (`toPendingEntry`, `mergePending`), `components/` (`NoticeBanner.tsx`, `PendingReviewDialog.tsx`), and under `supabase/tests/` the folder `offline/` with the description `offline/ (44 checks of the database, the outbox, the cache, the failure policy, the sync engine and the sign-out cleanup, on real SQL: node --no-warnings supabase/tests/offline/run.cjs)`. Update the lines that change: `journalRepository.ts` (`processMock`, `listPendingItems`, `countUnsentItems`, `getKnownTier`, and `getEntry` answering a pending reflection), `JournalCard.tsx` (`HomeEntry`, `online`, `onReview`, `onUnlock`), `useJournalHome.ts` (waits for the database, merges the outbox, follows the engine), `selectors.ts` (`getUnsentCount`, `getSyncSummary(entries, unsent)`), `ProcessingOverlay.tsx` (`OverlayFailure`), `navigation/types.ts` (`NewEntry` takes `resend`), the paragraph on the dev panel and dev store (`nextNetworkFails`, `too_short`, the Outbox group), and the `src/types/index.ts` line (`OutboxStatus`, `OutboxItem`, `PendingInfo`, `HomeEntry`, `ProcessOutcome`; `SubmitResult` is gone).

**4.3 Screen Specifications.** *3. Journal Home:* replace the sentence about the pending card with: an unsent reflection is an entry-shaped card above the entries, never showing its words ("Written reflection" or "Voice reflection"), with a status line (queued offline "Saved on this phone · Waiting to connect", otherwise "Preparing your reflection…"; refused "We couldn’t finish this one." with **Review**; held by the free limit "Saved · Unlocks with Pro or on {weekday}" with **See plans**; paused "Saved · Sign in to continue"); the Offline banner counts only what the phone will send by itself; a dismissible "saved" note (never a toast) shows after New Entry saved something that has not been prepared; the synced toast shows only when nothing is left to send; Review is one `ConfirmDialog` with two steps (reason, then delete) and, for a written reflection, "Edit and resend". Add the loading and error behavior: the screen waits for the user's database, a database that cannot be opened shows the error state and "Try again" opens it again. *4. New Entry:* replace "(shown only while there is a recording or text; a mock until step 24 makes it true) and" in the header bullet with "no 'Saved locally' line (nothing is saved until Submit)", and replace the sentences about Submit and the Processing state with: Submit saves the reflection in the outbox first; online the overlay shows while the engine prepares it (up to 90 seconds), and ready or crisis opens Reflection, the free limit opens the Paywall with the entry, a refusal shows the failure view with the reason and **Edit** (written) or **Record again** (voice) and **Close**, anything else (no answer, busy) leaves for Journal with the note "Saved. We’ll finish your reflection as soon as we can."; offline there is no overlay and the note says "…when you’re back online."; the overlay's note reads "Your reflection is saved on this phone. If you leave this screen, it will finish in your Journal."; the failure view for a database that cannot save says "We couldn’t save this reflection." with "Try again" and "Keep editing". *7. Profile:* the Offline Reflections counts include the outbox, and the Sign Out dialog says how many reflections the server has never been given ("{n} reflections on this phone haven’t been sent yet…", "Sign out anyway", "Stay signed in").

**4.4 Navigation Map.** `NewEntry` takes `{ mode, resend? }`; after a saved reflection that is not finished it leaves with `popTo("MainTabs", { screen: "Journal" })` and a note; the leave guard asks "Discard this reflection?" and, when the reflection is already in the outbox, discarding deletes it from the outbox too.

**4.5 Authentication Rules, "On sign-out".** Add to what `signOutCleanup()` does: stops the sync engine, deletes the signed-in user's database file, its sidecar files and its key (step 24), then the recordings as before.

**4.6 Linting and Validation.** Add the command `node --no-warnings supabase/tests/offline/run.cjs` (44 checks, about 6 seconds, no device, Node 22.5 or newer) beside the other harnesses, with the sentence: "The offline checks fail with `cannot resolve @/db/database` in a tree without the step 24 files: that is the expected red."

**4.7 Release gate.** The count that `grep -rnE "TEMP\(|TODO: real" src` prints changes: write the new number that it prints: 18 (it was 16 after step 23; 15 `TEMP(` and 3 `TODO: real`). Name which markers went (every `TODO(24)` and `TEMP(24)`) and which came (`TEMP(25)` in `entryProcessor.ts`, `TEMP(30)` in `getKnownTier`, and one `TODO(25)` for the limit answer in `processMock`).

**4.8 Build Status & Decisions Log: a "Step 24 — Offline cache and sync" entry**, in the form of the steps before it: the decisions (this prompt's list and any you struck), the packages installed, the files added and changed, the differences from this prompt, the measured results (checks, bundles, the mutation run), what the phone walk-through showed (B1 to B10, one line each, in your words and the user's), what was not verified (Android unless run, the native modules on a device, the file's contents on a device, the SQLite inspector), and the open items and markers left (`TEMP(25)` in `entryProcessor.ts` and `journalRepository.ts`, `TODO(25)` in the repository's limit answer and on the failed card, `TODO(26)` where it was).

---

## 5. Rules

- Only the two approved packages. No `any`. No new tokens, no new fonts, no `StyleSheet` where a class works. The visual additions are exactly: the pending-card status lines and their two pill buttons, the note banner, the review dialog and the New Entry failure view.
- Never store journal text in AsyncStorage, and never write a word to the database without sealing it (`encryptText`). Never log text, a path, a client entry id, a user id, a key or a token: the engine, the database code and the cache log only a state, a code, a count or a delay (the checks assert it).
- Bound parameters in every query. `execAsync` only for fixed statements and PRAGMAs. Never put a value into SQL text.
- A reflection is in the outbox **before** the network is tried, and a failed network call never deletes it. Only a successful answer, an explicit discard, sign-out and account deletion remove an item.
- The engine never runs in the background and uses no background-task library. It never retries what only the person can fix.
- Crisis support is never held back: a crisis answer is a normal `ok` answer (the server screens before it counts), and the screens open Reflection for it. Nothing is logged about a crisis entry.
- `entryProcessor.ts` is the only code that talks to the server for an outbox item. While `processorIsMock` is true the engine never writes the answer to the cache.
- Keep each file's line endings (the list is in section 2; the files in section 1 are LF).

---

## 6. Notes for later steps (reported, not edited: reconcile each at its own review)

- **25 (journal and reflection data).** The whole step is the inside of `src/services/entryProcessor.ts`: replace `processMock` with `uploadRawRecording(item, userId)` (a voice item; step 23: pass `{ clientEntryId, uri: recordingUri(clientEntryId) }`) and the `process-entry` call, map its answer to `ProcessOutcome` (`ok: true` with the entry and affirmations; a 402 to `{ ok: false, code: "LIMIT_REACHED", entryId, resetsAt: usage.resetsAt }`; a refused token to `UNAUTHORIZED`; a dropped request to `NETWORK`; `UploadFailure` `NOT_FOUND` to `AUDIO_NOT_FOUND`, `TOO_LARGE` to `PAYLOAD_TOO_LARGE`, `UNKNOWN` to `UNKNOWN`), set `processorIsMock` to `false`, delete `processMock`, `toMockRequest` and the `nextNetworkFails` flag's reader, and pass its `request timeout` above the function's slowest answer (the engine gives up on a call at 200 seconds; the function ends by about 145). Fill the read cache through `listEntries`, `getEntry` and `listAffirmationsForEntry` (read-through, `cache.upsertEntry` after each read; the cache API and `pruneEntries` are ready and tested, and `getEntry` already answers a client id from the outbox). Prompt 25's own text about queued items and `limit` reflects the old design: the 402's `entryId` and `usage.resetsAt` are already stored per item.
- **26 (devotional playback).** Nothing changes. `entry.pending` never reaches a player (`getPlaybackTrack` needs `status === "ready"`).
- **28 (notifications).** `syncEngine.subscribe` emits `finished` with the new entry's id and whether it is a crisis: a good place to reschedule affirmations (never for a crisis). A small table of plain facts (a plan's signature) is a migration 2 in `src/db/schema.ts`: append to `MIGRATIONS`, never edit version 1.
- **29 (prayers).** The three `TEMP(29)` writes stay mocks. If prayer changes should survive offline, they need their own queue table (migration 2); this step queues only reflections.
- **30 (billing).** Call `resumeAfterUpgrade()` from RevenueCat's entitlement listener after a purchase or restore (`purchases.ts` does it for the mock today), and keep the profile sync reading the server's plan: the engine also resumes held reflections whenever `getKnownTier()` is paid.
- **31 (export and delete).** `deleteAccount()` already runs `signOutCleanup()`, which deletes the database, its key and the recordings; the server side must also delete `{userId}/raw/` and `{userId}/devotionals/` in storage.
- **33 and 34.** No realtime or analytics event is added here. Never send an event for a pending, refused or held reflection that carries its id or its words.
- **35 (iOS developer account).** SQLCipher may be reconsidered with a development build, but the field encryption stays (it covers the words, and works in Expo Go): do not stack them without a migration. Test the Airplane-mode checks (B1 to B3) again on the development build.

---

## 7. Verify

### Part A: always (the implementer, no phone)

1. `npm run typecheck` and `npm run lint` exit 0. Read the whole output: lint warnings count, and nothing is disabled with a comment.
2. `node --no-warnings supabase/tests/offline/run.cjs` ends `44 of 44 passed` (it was red in section 0). Then the older checks still pass: `node supabase/tests/recording/run.cjs` (68 passed), `node supabase/tests/profile-sync/run.cjs` (88 passed, about 40 seconds) and `node supabase/tests/process-entry/parity.cjs` (7 of 7).
3. `npx expo install --check` says "Dependencies are up to date" and `npx expo-doctor` passes. `package.json` gained exactly `expo-sqlite` and `@react-native-community/netinfo`; `package-lock.json` gained those two and `await-lock`; `app.json` is unchanged (`git diff --stat` must not list it).
4. Bundle both platforms, one at a time, to a folder outside the repo: `NODE_OPTIONS=--max-old-space-size=3072 npx expo export --platform android --output-dir <a temp folder> --no-minify --no-bytecode --max-workers 2`, then the same for `ios`. Both exit 0. In the unminified bundles, `openDatabaseAsync`, `aesEncryptAsync`, `gracehush.dbkey.` and `Saved on this phone` each appear. Do not export while the emulator and two Metro servers are running (host memory, AGENTS.md).
5. Greps, each with the result named: `grep -rn "TODO(24)\|TEMP(24)" src` finds nothing; `grep -rn "submitEntry" src` finds nothing; `grep -rnE "TEMP\(|TODO: real" src | wc -l` prints 18 (15 `TEMP(` and 3 `TODO: real`), the number you write into AGENTS.md; `grep -rn 'from "expo-sqlite"' src` finds only `src/db/database.ts`; `grep -rln "getDb()" src` lists only the files in `src/db/`; `grep -rn "console\." src/db src/services/syncEngine.ts src/services/offlineSession.ts` finds only `__DEV__`-guarded lines that print a code or a state; no file in `src` interpolates a value into SQL (`grep -rn '\${' src/db | grep -v 'COLUMNS\|keep\|migrations.length'` finds nothing that is a value).
6. Line endings: the CRLF files in section 2 still have CRLF (`tr -cd '\r' < file | wc -c` is larger than before by the number of added lines) and `git diff --stat` shows only real changes, no whole-file rewrites. The new files are LF.
7. **Mutation smoke test** (the review's 52 are in section 3; prove the checks are wired to *your* files). One at a time, make the break, run `node --no-warnings supabase/tests/offline/run.cjs`, see a named check fail, then restore the line (compare with `git diff`):
   - in `database.ts`, make `userHash` return `userId`;
   - in `syncEngine.ts`, delete `await outbox.remove(id);` from `applySuccess`;
   - in `syncPolicy.ts`, change `LIMIT_REACHED: "limit"` to `"retry"`;
   - in `outbox.ts`, delete `AND status = 'queued'` from `markSending`;
   - in `fieldCrypto.ts`, make `encryptText` return `plain`;
   - in `account.ts`, delete the `deleteUserDatabase` line from `signOutCleanup`.
8. With the user's yes only (see "What you do yourself", C): boot the emulator as AGENTS.md says (Metro first, then the emulator; never open it against the real project without asking) and drive Journal and New Entry once with the network off (`adb shell cmd connectivity airplane-mode enable`). Put every override back and shut the emulator down.

### Part B: the phone walk-through (you, on the iPhone in Expo Go)

"What you do yourself", B1 to B10. The implementer asks for the results one by one and writes them into the log entry. B1, B2 and B5 prove the outbox, the engine and the limit; B8 proves the sign-out wipe.

### Not verified, and said so

Say each of these in the report unless it was run: the iPhone entirely until Part B is done; Android on a device; that the native `expo-sqlite` and AES modules behave as the fakes do (the fakes are shaped from the package sources and docs); the file's contents on a real phone; NetInfo's real events and its first answer on a cold start; the look of the pending cards, the note banner, the review dialog and the failure view; iOS backups and a restored phone; and the SQLite inspector.

---

## 8. Report

Say, in this order and briefly: the files created, changed and deleted (one line each); the two packages installed (names and versions) and that `package-lock.json` gained only those and `await-lock`; the encryption decision ("the words are encrypted, the bookkeeping is not"); the database file and key naming and the schema version; the failure policy table; the checks (typecheck, lint, the 44, the three older ones, doctor, both bundles and what was found in them, the greps with their results, the six hand breakages and which check named each); the phone walk-through results B1 to B10 (and any you did not get); the Android run if the user said yes; what was not verified; the markers left (`TEMP(25)` and `TODO(25)` and where); the AGENTS.md changes of section 4 and that `prompts/AGENTS.md` equals it; and anything that differs from this prompt, with the reason. If you changed any of the code in sections 1 and 2, say which line and which check still proves it.
