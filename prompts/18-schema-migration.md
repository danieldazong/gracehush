# 18-schema-migration.md

Read AGENTS.md first and follow it strictly.

Make the database real. The review of this step wrote, and proved, the SQL: two migrations that create `journal_entries`, `daily_affirmations`, the private `journal_media` bucket and the new `users_profile` columns, with every permission spelled out. This step has two parts: **(a)** you apply that SQL to your Supabase project and check it there (next section), and **(b)** the implementer changes the app to match: the generated types replace the hand-written ones, and the three Profile settings plus the time zone move from your phone to `users_profile` columns, with the phone keeping an offline copy.

No screen, hook, copy string or layout changes. No Edge Function (steps 19 to 22). No dashboard setting is changed. **The implementer runs no SQL against your project**: there is no database password, CLI link or management token anywhere in this repo, and none is needed.

Sources, checked in the review on 2026-10-22:

- https://supabase.com/docs/guides/database/postgres/column-level-security
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/api/rest/generating-types
- the installed `@supabase/supabase-js` 2.118.0 and `@supabase/postgrest-js` 2.118.0 types: the typed-client narrowing in section 2 was type-checked against them, with a file shaped like the generator's output.
- PGlite 0.5.11 (Postgres 18.6), a real Postgres engine compiled to WebAssembly: the SQL was run in it, because Docker is not installed on this machine.

---

## What you do yourself (read this first)

The implementer cannot do any of this: it is your Supabase project. It takes about 15 minutes. Do A to E in order, then tell the implementer ("A to E are done") and send the screenshot of step D. Nothing here changes a setting of your project, and every SQL file is safe to run again. If you would rather be walked through it, ask the implementer to guide you **one instruction at a time**, as in step 17: you do it, send a screenshot, and it tells you the next one.

### Keys: what this step needs (checked in the review)

`.env.local` already holds the three names the app uses, all set (checked by name only, never by value): `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. **This step needs no new key or ID.** Never copy any of these into a file or into the chat: the database password, the `service_role` key, a key that starts with `sb_secret_`, or a Supabase access token (if you use the CLI route in E, its login keeps the token on this computer, outside the repo).

### How to run a SQL file (it is the same every time)

1. Dashboard, your Gracehush project, left sidebar **SQL Editor**, then **New query**. (If you only see a list of saved snippets, press the **+** at the top of that list.)
2. In VS Code open the file, press **Ctrl+A** then **Ctrl+C**. Click inside the editor box, press **Ctrl+A** (this selects the old text) and **Ctrl+V**.
3. Press the green **Run** button (or Ctrl+Enter). If the dashboard answers "Potential issue detected", it only noticed a word such as DROP or REVOKE in the file: press **Run this query**.
4. Read the answer under the box. Open a **new** query for each file.

### A. Look before you change (read-only)

Run `supabase/tests/preflight.sql`. It changes nothing and answers with a table of 11 rows. Compare it with the "before" column:

| # | item | before | after step B |
| --- | --- | --- | --- |
| 1 | Postgres version | a number, 15 to 17 | the same |
| 2 | table users_profile | exists | exists |
| 3 | users_profile columns | id, created_at, subscription_tier, reminder_morning, reminder_afternoon, reminder_evening, last_active_at | the same seven, then affirmations_enabled, ambient_sound, ambient_volume, timezone, updated_at |
| 4 | users_profile row level security | on | on |
| 5 | function requesting_user_id() | exists | exists |
| 6 | table journal_entries | absent | exists |
| 7 | table daily_affirmations | absent | exists |
| 8 | signed-out visitors (anon) can touch | nothing | nothing |
| 9 | policies on the public tables | the three users_profile policies (insert_own, select_own, update_own) | seven: those three, plus select_own and update_own for each of journal_entries and daily_affirmations |
| 10 | policies on storage.objects | none | journal_media_insert_own_raw (INSERT), journal_media_select_own (SELECT) |
| 11 | bucket journal_media | absent | private, 25 MB, audio/mp4 audio/m4a audio/x-m4a audio/aac audio/mpeg |

If row 6, 7 or 11 already says "exists", or row 8 is not "nothing", **stop and send the table to the implementer** (something was created by hand, and the migration must not run over it without a look).

### B. Apply the migration

Run `supabase/migrations/20261022120100_gracehush_v1_schema.sql`. Expect "Success. No rows returned." Do **not** run the other file in that folder (`20261022120000_baseline_users_profile.sql`): it is step 17's `schema.sql`, which you already ran. If the editor shows a red error, send the message to the implementer and do not edit the file; the file is safe to run again once the cause is known.

### C. Run the two self-tests

1. Run `supabase/tests/rls_selftest.sql`. It pretends to be three users, a signed-out visitor and the server, tries what must work and what must be refused, and undoes every try. Expect **45 rows, and `passed = true` on every one**. It touches only fake ids that start with `selftest_` and deletes them at the end, so it is safe on a project with real accounts.
2. Run `supabase/selftest.sql` (the step 17 test) again. Expect **11 rows, all true**: the new migration must not have broken the profile rules.

If any row says false, **send the whole table** to the implementer and go no further. If only rows 36 to 42 (storage) are false, say so: the tables are fine and the bucket policy needs a look; the app does not upload before step 23.

### D. Look again

Run `supabase/tests/preflight.sql` once more and compare it with the "after" column above. Send this table to the implementer. (Optional: dashboard, **Storage**; `journal_media` is listed as a private bucket.)

### E. Download the generated types

The file `src/types/supabase.ts` is made from your real database and is never edited by hand. Two ways; pick one:

- **From the dashboard (nothing to install).** Open https://supabase.com/dashboard/project/_/api?page=tables-intro, choose your project if asked, and find the TypeScript types on that page (Supabase documents a "generate and download TypeScript types" option there; the button's label may differ). Save the result as `src/types/supabase.ts` in the project. If you cannot find it within a few minutes, send the implementer a screenshot of the page.
- **From the command line.** In **Git Bash** (not PowerShell: Windows PowerShell 5.1 writes the file as UTF-16), once: `npx supabase login` (a browser opens; the token stays on this computer). Then in the project folder: `npx supabase gen types typescript --project-id <your project ref> --schema public > src/types/supabase.ts`. Your project ref is the part of your Supabase address before `.supabase.co`.

Check the file in VS Code: it starts with `export type Json =` and contains `journal_entries`, `daily_affirmations`, `users_profile` and `ambient_sound`. Do not edit it.

### After the step is verified

- To build a second project (for release) from scratch: run the two files in `supabase/migrations/` in order, then both self-tests, then download the types again.
- The SQL editor does not record migrations. If you ever use the Supabase CLI against this project, run `npx supabase migration repair --status applied 20261022120000 20261022120100` first (or let `db push` run them again: they are idempotent).
- Changing this database later means a new file in `supabase/migrations/`, new checks in `rls_selftest.sql`, and the same A to E (A and D are quick).

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **No Docker, no CLI, no database password.** The old draft needed all three (`supabase init`, `db reset`, `link`, `db push`, a local stack). Docker is not installed here, and the CLI needs a password or a token that must not live in the repo. So the SQL is proven offline in PGlite, then applied by you in the SQL editor and judged by a self-test that runs there. The two migration files are still the record of the schema.
2. **The migration creates the tables and the bucket.** The old draft assumed `journal_entries`, `daily_affirmations`, a `journal_media` bucket with old policies and a `process-entry` draft already existed, and backfilled a `devotional_audio_url` column. None of that exists: the project has only `users_profile` from step 17. So there is nothing to read in `supabase/functions/`, no backfill, no deprecated column and no `config.toml` Clerk domain (Third-Party Auth is set in the dashboard, step 17).
3. **The app cannot insert or delete entries or affirmations.** The old draft let the phone insert `pending` entries and delete its own. Prompt 19's Edge Function claims every entry with the service role (`ON CONFLICT (user_id, client_entry_id) DO NOTHING`), and no later prompt has the phone insert one, so the grant is not needed and a smaller grant is a smaller attack surface. The phone can read its rows and update only the prayer columns and `is_favorite`. A "delete this reflection" feature would add a migration and a policy then.
4. **Explicit grants for every role, safe whether or not the dashboard exposes new tables.** Each table is revoked from `anon` and `authenticated` first and granted back column by column (Postgres ignores a column-level REVOKE while a table-wide GRANT exists); `service_role` gets explicit grants too. The whole suite passes with "Automatically expose new tables" OFF (this project) and ON (the older default), so you never need to touch that setting.
5. **Rules live in the tables, not only in code** (the tables are empty, so this is the cheap moment): a crisis entry has no devotional, audio, scripture or prayer; a prayer is answered on a date and only then, and its note stops at 1,000 characters (the three rules prompt 29 section 7 proposes, with its constraint names, so 29 skips that section); verified scripture always has its reference and text; an entry has one affirmation per slot, owned by the same user, and a crisis entry never gets one (a trigger); `client_entry_id` is unique per user so a retried submit creates nothing twice; `updated_at` is kept by a trigger; deleting a profile cascades.
6. **Storage.** `journal_media` is private, 25 MB, audio types only. The phone can read its own folder and upload only into `{userId}/raw/{clientEntryId}.m4a` (no overwrite, no delete: step 23 must upload with `upsert: false`); the Edge Function writes `{userId}/devotionals/{entryId}.mp3` with the service role. Staying on Supabase Storage for V1 is the recommendation; moving audio to Cloudflare R2 would be a later, separate decision.
7. **Generated types, with the writable columns narrowed.** `src/types/supabase.ts` is generated and never hand-edited. `src/types/database.ts` re-exports the row types and wraps `Database` so that `Insert` is `never` on the two tables the server owns and `Update` is only the granted columns: a write the database would refuse does not compile. It indexes `Database["public"]["Tables"][…]` directly instead of the generator's helper types, which have changed shape between CLI versions.
8. **The settings sync (what the old draft got wrong).** The old draft deleted `profilePrefsStore`, which would also have deleted the offline copy of the sign-up date and the plan (step 17's report said step 18 or 24 had to keep one), and it never said how an offline change reaches the server. Now: the server column is the truth; the phone keeps a `snapshot` of what the server last said and `unsent` changes the server has not confirmed; Profile shows unsent over snapshot. The rule is the one the reminder times already follow: **an unsent edit wins, otherwise the server wins**. One request carries the reminder times, the settings and the time zone, and the server's answer replaces the snapshot. Version 1 of the store (step 17) migrates in place: the settings kept on the phone become unsent edits and are sent once, only where they differ from what the server has.
9. **Time zone.** The phone sends its zone when the row is created and whenever it differs from the row's (the server uses it for the week boundary of the free limit, step 22). It is not shown anywhere and has no unsent state: a failed send is retried by the next sync.
10. **`getProfile()` opens Profile when the first sync read the row but failed to send something.** Found by the checks in the review: it used to throw although the snapshot was saved. Only a sync that could not read the row now leaves nothing to show.
11. **Three names change** because they no longer concern only reminders: `scheduleReminderSync` is `scheduleProfileSync`, `cancelReminderSync` is `cancelProfileSync`, `startReminderSync` is `watchReminderEdits`. Their only callers are `SupabaseAuthBridge`, `account.ts` and `journalRepository.ts`.
12. **The checks are kept in the repo** (`supabase/tests/`): the SQL self-tests, the PGlite runner and the profile sync checks. AGENTS.md says one-off scripts stay outside the repo; these are not one-off, they are the regression checks for the database and the sync, and steps 24, 29 and 33 extend them. PGlite itself is not a dependency: it is installed in a scratch folder.
13. **No `types:db` npm script.** Prompts 22, 29, 30, 31 and 33 say `npm run types:db`; generating types needs your CLI login, so the command is documented in AGENTS.md (Database Rules) instead of hidden in a script. Ask if you want the script.

---

## 0. Before you write code

1. Read AGENTS.md (Database Rules, the Schema section, Authentication Rules, the Onboarding store and Data layer paragraphs, Backend rules 7 and 10, TypeScript Rules, the Step 17 log entry), then: `supabase/schema.sql`, `supabase/selftest.sql`, everything in `supabase/migrations/` and `supabase/tests/`, `src/types/database.ts`, `src/types/index.ts`, `src/data/mappers.ts`, `src/data/profileRemote.ts`, `src/services/profileSync.ts`, `src/store/profilePrefsStore.ts`, `src/store/onboardingStore.ts`, `src/data/journalRepository.ts`, `src/services/account.ts`, `src/components/SupabaseAuthBridge.tsx`, `src/data/mock/entries.ts` and the Supabase check in `src/components/dev/DevToolsPanel.tsx`.
2. **`src/types/supabase.ts` must exist** (part E). Check that it names the three tables and `ambient_sound`. If it does not, print the "What you do yourself" list again and guide the user one instruction at a time. Do not write it yourself, do not hand-type "something like it", and do not start sections 2 to 4 without it (everything in them is typed against it).
3. `.env.local`: print variable **names and set or empty only**, never values (a small Node script). Expect the three names listed above, all set. Nothing new is needed; if a secret-looking name (`SERVICE_ROLE`, `SECRET`, `PASSWORD`, `ACCESS_TOKEN`) is present, stop and tell the user.
4. **Line endings.** Most files in the working tree are CRLF (see AGENTS.md, Verifying on this machine). Count `tr -cd '\r' < file | wc -c` for each file you edit and keep its endings. In a CRLF file, make multi-line replacements with a small Node script that matches on the LF text and writes CRLF back (check the count before and after). Files you create with the Write tool are LF, which git converts on commit.
5. **Red first.** Run `node supabase/tests/profile-sync/run.cjs` before changing any code: it fails (it expects the step 18 names, so it stops on the first sync call). It must pass after section 4: 88 checks. These checks run the app's real stores, repository, sync and Supabase client in Node against a fake PostgREST that refuses a column the migration does not grant and a value its checks would refuse, so a request that carries the plan or a bad volume fails here.
6. The user's Metro hot-reloads every save onto their iPhone. Work in this order, and tell the user before you start that a red screen may flash for a few seconds in step 2 and clears when its last file is saved:
   1. `src/types/database.ts`, `src/data/mappers.ts`, `src/data/mock/entries.ts` (types and one mock field: nothing changes at run time).
   2. These six files are one change; save them one after another, quickly: `src/store/profilePrefsStore.ts`, `src/data/profileRemote.ts`, `src/services/profileSync.ts`, `src/data/journalRepository.ts`, `src/services/account.ts`, `src/components/SupabaseAuthBridge.tsx`.
   3. `src/components/dev/DevToolsPanel.tsx`.
   4. The typing proof (section 5), then delete it.

The code below was written in the review and passed `tsc`, `eslint` (the React Compiler rules included) and 88 checks, and the checks were shown to fail when the code is broken on purpose (five mutations, each failing the checks it should: unsent settings never cleared, the plan added to a request, a value the server already has sent again, a setting edited mid-request wrongly cleared, and `getProfile` throwing after a failed send; a sixth, harmless edit stayed green). Copy it; change only what the repo needs at that moment, and say what you changed.

---

## 1. What the review created (read these; do not rewrite them)

| File | What it is |
| --- | --- |
| `supabase/migrations/20261022120000_baseline_users_profile.sql` | `schema.sql` (step 17) under a short header. Already applied by hand; kept so a new project can be built from the folder alone. |
| `supabase/migrations/20261022120100_gracehush_v1_schema.sql` | The v1 migration: `set_updated_at()`; five new `users_profile` columns with checks; `journal_entries` and `daily_affirmations` with their constraints, indexes, triggers, row level security and grants; the `journal_media` bucket and its two policies. Idempotent; it never deletes data. |
| `supabase/tests/rls_selftest.sql` | The hosted judge: 45 checks. Run it in the SQL editor after the migration. |
| `supabase/tests/preflight.sql` | Read-only: 11 rows that show what the database looks like before and after. |
| `supabase/tests/run-in-pglite.mjs` | The offline runner (see Verify, part A). |
| `supabase/tests/profile-sync/` | The 88 app-side checks (`loader.cjs`, `run.cjs`). |

**What the signed-in app may do** (the grants; AGENTS.md, Database Rules, has the same list):

| Table | read | insert | update | delete |
| --- | --- | --- | --- | --- |
| `users_profile` (its own row) | all columns | `id`, the three reminder times, `timezone`, `affirmations_enabled`, `ambient_sound`, `ambient_volume` | the same without `id` | no |
| `journal_entries` | all columns | no | `is_active_prayer`, `is_answered`, `answered_at`, `answered_notes`, `prayer_category` | no |
| `daily_affirmations` | all columns | no | `is_favorite` | no |

Never the plan (`subscription_tier`), `created_at`, `updated_at`, `last_active_at`, `is_crisis`, `processing_status`, `error_code`, the transcript, the scripture, devotional and audio columns, `prayer_title` or `prayer_summary`. `service_role` has select, insert, update and delete on all three. `anon` has nothing.

**How they were proven** (in the review, offline, in PGlite): each migration applied twice with no error; `selftest.sql` 11 of 11 and `rls_selftest.sql` 45 of 45, twice each, under both settings of "Automatically expose new tables"; no rows left behind; 17 deliberately broken variants (no `service_role` grants, a table-wide UPDATE, row level security off, no crisis trigger, an upload policy that lets anyone write anywhere, a delete policy on storage, an INSERT grant on entries, a public bucket, a missing unique key, a missing owner key, the plan writable again, each of the four prayer and scripture rules removed, and both ways default grants can leak) each failing exactly the checks they should. The hosted self-test you ran in part C is the final judge.

---

## 2. `src/types/database.ts` (replace the whole file)

```ts
// The database types. The row types come from src/types/supabase.ts, which is generated from the real database and
// never edited by hand (see "Regenerating the types" in AGENTS.md, Database Rules). This file only narrows what the
// signed-in app may SEND, so a column the database would refuse is a compile error here instead of an HTTP 403.
import type { Database as GeneratedDatabase } from "@/types/supabase";

type GeneratedTables = GeneratedDatabase["public"]["Tables"];

export type UserProfileRow = GeneratedTables["users_profile"]["Row"];
export type JournalEntryRow = GeneratedTables["journal_entries"]["Row"];
export type DailyAffirmationRow = GeneratedTables["daily_affirmations"]["Row"];

// The columns the `authenticated` role is granted (supabase/migrations/20261022120100_gracehush_v1_schema.sql, section 6).
// subscription_tier, created_at, updated_at and last_active_at are not here on purpose: only the server writes them.
export type UserProfileInsert = Pick<
  GeneratedTables["users_profile"]["Insert"],
  | "id"
  | "reminder_morning"
  | "reminder_afternoon"
  | "reminder_evening"
  | "timezone"
  | "affirmations_enabled"
  | "ambient_sound"
  | "ambient_volume"
>;
export type UserProfileUpdate = Omit<UserProfileInsert, "id">;

// The app never inserts or deletes an entry or an affirmation (the Edge Function does), and changes only these.
export type JournalEntryUpdate = Pick<
  GeneratedTables["journal_entries"]["Update"],
  "is_active_prayer" | "is_answered" | "answered_at" | "answered_notes" | "prayer_category"
>;
export type DailyAffirmationUpdate = Pick<GeneratedTables["daily_affirmations"]["Update"], "is_favorite">;

// The shape supabase-js wants: the generated database with the three tables narrowed. `Insert: never` makes
// `.insert()` and `.upsert()` on a table the app may not insert into a type error.
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & {
    Tables: {
      users_profile: Omit<GeneratedTables["users_profile"], "Insert" | "Update"> & {
        Insert: UserProfileInsert;
        Update: UserProfileUpdate;
      };
      journal_entries: Omit<GeneratedTables["journal_entries"], "Insert" | "Update"> & {
        Insert: never;
        Update: JournalEntryUpdate;
      };
      daily_affirmations: Omit<GeneratedTables["daily_affirmations"], "Insert" | "Update"> & {
        Insert: never;
        Update: DailyAffirmationUpdate;
      };
    };
  };
};
```

`UserProfileRow`, `JournalEntryRow` and `DailyAffirmationRow` keep their names, so the mappers, the mocks and `profileRemote` keep their imports. `UserProfileInsert` and `UserProfileUpdate` keep theirs too (their contents are now the granted columns, including the new ones). What disappears: the hand-written `interface`s with their `// planned` fields, `devotional_audio_url`, and the comment about hand-writing.

---

## 3. The settings sync

How the pieces fit:

- **Where a setting lives.** The server column is the truth. For each user the phone keeps `snapshot` (what the server last said: sign-up date, plan and the three settings) and `unsent` (settings the user changed that the server has not confirmed). `getProfile()` shows `unsent` over `snapshot`, so Profile is right at once, also offline.
- **When it is sent.** `updateProfile` saves the change as unsent and calls `scheduleProfileSync()`; 800 ms after the last change a sync runs (also at sign-in, and when the app comes back to the foreground: at once if anything is unsent, otherwise at most every 30 seconds). One sync is one read of the row and, if anything needs sending, one `PATCH` that carries the reminder times (if edited), the unsent settings that differ from the server's, and the time zone (if it differs). The answer replaces the snapshot; `clearUnsent` then drops every unsent setting that was not edited again while the request was away, and a setting that was edited again goes in the next run.
- **Sign out** drops an unsent reminder edit (the times are device-wide, so they must never reach the next account) and keeps each user's unsent settings (they are keyed by Clerk user id and wait for that user). **Account deletion** forgets the user's whole entry (unchanged).
- **A failure shows nothing.** The edit stays unsent, the snapshot is still saved, and the next trigger tries again.

### 3.1 `src/store/profilePrefsStore.ts` (replace the whole file; same file name and storage key, version 2)

```ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { AMBIENT_SOUNDS } from "@/constants/app";
import type { ProfilePatch, SubscriptionTier } from "@/types";

import { safeStorage } from "./safeStorage";

// The offline copy of the signed-in user's profile, kept per Clerk user so a second account on the same phone never
// sees the first one's (step 17; step 18 moved the three settings to users_profile columns):
// - `snapshot` is what the server last said: when the account was created, the plan and the three settings.
// - `unsent` holds the settings the user changed on this device that the server has not confirmed yet. They show on
//   top of the snapshot and win over the server until a sync sends them, the same rule the reminder times follow.
// No journal text is kept here.
export type Settings = Required<ProfilePatch>;

export type ServerSnapshot = Settings & {
  createdAt: string; // ISO
  subscriptionTier: SubscriptionTier;
  syncedAt: string; // ISO, when the server last said so
};

export type ProfileEntry = { unsent: ProfilePatch; snapshot: ServerSnapshot | null };

interface ProfilePrefsState {
  byUser: Record<string, ProfileEntry>;
  saveUnsent: (userId: string, patch: ProfilePatch) => void; // the user changed a setting
  clearUnsent: (userId: string, sent: ProfilePatch) => void; // the server has these: drop each one not edited since
  saveSnapshot: (userId: string, snapshot: ServerSnapshot) => void;
  forgetUser: (userId: string) => void; // account deletion
}

const TIERS: readonly SubscriptionTier[] = ["free", "trial", "pro"];
// The column defaults of supabase/migrations/20261022120100_gracehush_v1_schema.sql, for a snapshot saved before
// step 18 (it has no settings).
const DEFAULT_SETTINGS: Settings = { affirmationsEnabled: true, ambientSound: "off", ambientVolume: 0.5 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function readVolume(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function readUnsent(value: unknown): ProfilePatch {
  const saved = isRecord(value) ? value : {};
  const unsent: ProfilePatch = {};
  if (typeof saved.affirmationsEnabled === "boolean") unsent.affirmationsEnabled = saved.affirmationsEnabled;
  const sound = AMBIENT_SOUNDS.find((item) => item === saved.ambientSound);
  if (sound !== undefined) unsent.ambientSound = sound;
  const volume = readVolume(saved.ambientVolume);
  if (volume !== undefined) unsent.ambientVolume = volume;
  return unsent;
}

function readSnapshot(value: unknown): ServerSnapshot | null {
  if (!isRecord(value)) return null;
  const tier = TIERS.find((item) => item === value.subscriptionTier);
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.syncedAt) || tier === undefined) return null;
  return {
    createdAt: value.createdAt,
    subscriptionTier: tier,
    syncedAt: value.syncedAt,
    affirmationsEnabled:
      typeof value.affirmationsEnabled === "boolean"
        ? value.affirmationsEnabled
        : DEFAULT_SETTINGS.affirmationsEnabled,
    ambientSound: AMBIENT_SOUNDS.find((item) => item === value.ambientSound) ?? DEFAULT_SETTINGS.ambientSound,
    ambientVolume: readVolume(value.ambientVolume) ?? DEFAULT_SETTINGS.ambientVolume,
  };
}

const emptyEntry = (): ProfileEntry => ({ unsent: {}, snapshot: null });

export const useProfilePrefsStore = create<ProfilePrefsState>()(
  persist(
    (set) => ({
      byUser: {},
      saveUnsent: (userId, patch) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          const unsent: ProfilePatch = { ...entry.unsent };
          if (patch.affirmationsEnabled !== undefined) unsent.affirmationsEnabled = patch.affirmationsEnabled;
          if (patch.ambientSound !== undefined) unsent.ambientSound = patch.ambientSound;
          if (patch.ambientVolume !== undefined) unsent.ambientVolume = patch.ambientVolume;
          return { byUser: { ...state.byUser, [userId]: { ...entry, unsent } } };
        }),
      clearUnsent: (userId, sent) =>
        set((state) => {
          const entry = state.byUser[userId];
          if (entry === undefined) return state;
          // A setting edited again while the request was away no longer equals what was sent, so it stays unsent.
          const unsent: ProfilePatch = { ...entry.unsent };
          if (sent.affirmationsEnabled !== undefined && unsent.affirmationsEnabled === sent.affirmationsEnabled) {
            delete unsent.affirmationsEnabled;
          }
          if (sent.ambientSound !== undefined && unsent.ambientSound === sent.ambientSound) {
            delete unsent.ambientSound;
          }
          if (sent.ambientVolume !== undefined && unsent.ambientVolume === sent.ambientVolume) {
            delete unsent.ambientVolume;
          }
          if (Object.keys(unsent).length === Object.keys(entry.unsent).length) return state;
          return { byUser: { ...state.byUser, [userId]: { ...entry, unsent } } };
        }),
      saveSnapshot: (userId, snapshot) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          return { byUser: { ...state.byUser, [userId]: { ...entry, snapshot } } };
        }),
      forgetUser: (userId) =>
        set((state) => ({
          byUser: Object.fromEntries(Object.entries(state.byUser).filter(([id]) => id !== userId)),
        })),
    }),
    {
      name: "gracehush.profilePrefs",
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ byUser: state.byUser }),
      // Version 1 (step 17) kept the three settings in `prefs`: nothing sent them anywhere, so every one of them is an
      // edit the server has not seen. They become `unsent`, and the first sync sends the ones that differ.
      migrate: (persisted: unknown, version: number) => {
        if (version >= 2 || !isRecord(persisted) || !isRecord(persisted.byUser)) return persisted;
        const byUser = Object.fromEntries(
          Object.entries(persisted.byUser).flatMap(([userId, entry]) =>
            isRecord(entry) ? [[userId, { unsent: entry.prefs, snapshot: entry.snapshot }]] : [],
          ),
        );
        return { byUser };
      },
      // zustand's default merge is shallow, and the saved JSON may be damaged: check every field, and drop what fails.
      merge: (persisted: unknown, current: ProfilePrefsState): ProfilePrefsState => {
        const saved = isRecord(persisted) && isRecord(persisted.byUser) ? persisted.byUser : {};
        const byUser = Object.fromEntries(
          Object.entries(saved).flatMap(([userId, entry]) => {
            if (!isRecord(entry)) return [];
            return [[userId, { unsent: readUnsent(entry.unsent), snapshot: readSnapshot(entry.snapshot) }]];
          }),
        );
        return { ...current, byUser };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error && __DEV__) {
          console.warn("[profilePrefs] could not load the saved state", error);
        }
      },
    },
  ),
);
```

### 3.2 `src/data/profileRemote.ts` (replace the whole file)

```ts
import { copy } from "@/constants/copy";
import { getDeviceTimezone } from "@/data/mappers";
import { getSupabase, getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { ProfilePatch, RepoResult, TimeSlot } from "@/types";
import type { UserProfileRow, UserProfileUpdate } from "@/types/database";
import { describeFailure, toFailureCode } from "@/utils/supabaseErrors";

// The only code that sends a request about users_profile (steps 17 and 18). It reads the row, creates it on the
// first sign-in, and writes the columns the migration grants to the app: the three reminder times, the time zone and
// the three settings. The plan (subscription_tier) is never in a request: only the server writes it.

let lastError: string | null = null;

// For the dev panel's Supabase check: the code of the last failure, or null after a success.
export function getLastProfileError(): string | null {
  return lastError;
}

function unauthorized(): RepoResult<never> {
  lastError = "no session";
  return { ok: false, code: "UNAUTHORIZED", message: copy.profile.errors.load };
}

function fail(status: number, error: { message?: string | null; code?: string | null }): RepoResult<never> {
  const code = toFailureCode(status, error);
  lastError = describeFailure("users_profile", status, error);
  if (__DEV__) {
    // Only the table and the code, never a message, a row, a token or an id.
    console.warn(`[supabase] ${lastError}`);
    if (error.code === "42501") {
      console.warn(
        "[supabase] row level security refused the request: check the Clerk integration and that the files in supabase/migrations/ were applied",
      );
    }
    if (error.code === "PGRST204") {
      console.warn(
        "[supabase] a column is missing: apply supabase/migrations/20261022120100_gracehush_v1_schema.sql, then try again",
      );
    }
  }
  return { ok: false, code, message: copy.profile.errors.load };
}

// "08:00" to the "08:00:00" a TIME column takes.
function toTimeColumn(hhmm: string): string {
  return `${hhmm}:00`;
}

export function reminderColumns(times: Record<TimeSlot, string>): UserProfileUpdate {
  return {
    reminder_morning: toTimeColumn(times.morning),
    reminder_afternoon: toTimeColumn(times.afternoon),
    reminder_evening: toTimeColumn(times.evening),
  };
}

// Only the settings that are present, so a request carries exactly what changed.
export function settingColumns(settings: ProfilePatch): UserProfileUpdate {
  const columns: UserProfileUpdate = {};
  if (settings.affirmationsEnabled !== undefined) columns.affirmations_enabled = settings.affirmationsEnabled;
  if (settings.ambientSound !== undefined) columns.ambient_sound = settings.ambientSound;
  if (settings.ambientVolume !== undefined) columns.ambient_volume = settings.ambientVolume;
  return columns;
}

// The signed-in user's row, or null when there is none yet. RLS shows only their own row; the filter is for clarity.
export async function selectProfileRow(): Promise<RepoResult<UserProfileRow | null>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { data, error, status } = await supabase
    .from("users_profile")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error !== null) return fail(status, error);
  lastError = null;
  return { ok: true, data };
}

// How many rows of users_profile this user can see. Row level security must make it 1 (or 0 before the row exists),
// whatever the table holds: the dev panel's Supabase check shows it.
export async function countVisibleProfileRows(): Promise<RepoResult<number>> {
  const supabase = getSupabase();
  if (supabase === null) return unauthorized();
  const { count, error, status } = await supabase
    .from("users_profile")
    .select("*", { count: "exact", head: true });
  if (error !== null) return fail(status, error);
  lastError = null;
  return { ok: true, data: count ?? 0 };
}

// The row, created from this device if the account has none yet: its reminder times, its time zone and the settings
// the user changed here before the account existed. The insert never overwrites a row that exists (ON CONFLICT DO
// NOTHING), so two devices signing in together cannot fight over it. The app can send only the columns it has an
// INSERT grant on: the plan is always the database default.
export async function fetchOrCreateProfileRow(): Promise<RepoResult<UserProfileRow>> {
  const found = await selectProfileRow();
  if (!found.ok) return found;
  if (found.data !== null) return { ok: true, data: found.data };

  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { reminders } = useOnboardingStore.getState();
  const unsent = useProfilePrefsStore.getState().byUser[userId]?.unsent ?? {};
  const { error, status } = await supabase.from("users_profile").upsert(
    { id: userId, ...reminderColumns(reminders), timezone: getDeviceTimezone(), ...settingColumns(unsent) },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error !== null) return fail(status, error);

  // Read it back: either this insert or another device's made the row.
  const created = await selectProfileRow();
  if (!created.ok) return created;
  return created.data === null
    ? { ok: false, code: "UNKNOWN", message: copy.profile.errors.load }
    : { ok: true, data: created.data };
}

// Writes the given columns in one request and answers with the row as the server now has it. An update that changes
// no row means the row is missing or hidden from this user.
export async function pushProfileColumns(columns: UserProfileUpdate): Promise<RepoResult<UserProfileRow>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { data, error, status } = await supabase
    .from("users_profile")
    .update(columns)
    .eq("id", userId)
    .select();
  if (error !== null) return fail(status, error);
  lastError = null;
  const row = data[0];
  return row === undefined
    ? { ok: false, code: "NOT_FOUND", message: copy.profile.errors.load }
    : { ok: true, data: row };
}
```

### 3.3 `src/services/profileSync.ts` (replace the whole file)

```ts
import { getDeviceTimezone, toUserProfile } from "@/data/mappers";
import { getProfileSource } from "@/data/mock/scenario";
import {
  fetchOrCreateProfileRow,
  pushProfileColumns,
  reminderColumns,
  settingColumns,
} from "@/data/profileRemote";
import { copy } from "@/constants/copy";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import { type ServerSnapshot, type Settings, useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { ProfilePatch, RepoResult, TimeSlot } from "@/types";
import type { UserProfileRow, UserProfileUpdate } from "@/types/database";

// Keeps this device and users_profile in step (steps 17 and 18): it makes sure the account has a row, remembers what
// the server says (the plan, the sign-up date, the settings), and moves whatever is newer in either direction: the
// reminder times, the three settings and the time zone. One request sends everything that needs sending.
// Nothing here shows an error to the user: a failure leaves the edit marked unsent and the next trigger tries again.

const SYNC_DEBOUNCE_MS = 800;
const FOREGROUND_SYNC_GAP_MS = 30_000;

const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

type Times = Record<TimeSlot, string>;
export type ReminderAction = "mark-synced" | "push" | "apply-server";

export function sameTimes(a: Times, b: Times): boolean {
  return SLOTS.every((slot) => a[slot] === b[slot]);
}

// Equal: nothing to move. Different, and this device holds an edit the server has not seen: the edit wins, it is the
// newest thing the user did. Different and nothing unsent: the server has the newest times (another phone, or the
// table editor).
export function decideReminderSync(server: Times, local: Times, dirty: boolean): ReminderAction {
  if (sameTimes(server, local)) return "mark-synced";
  return dirty ? "push" : "apply-server";
}

// The settings changed on this device that the server does not have. An unsent value equal to the server's is already
// there, so it needs no request. (Any other setting, edited on another phone, is simply the server's.)
export function settingsToPush(server: Settings, unsent: ProfilePatch): ProfilePatch {
  const push: ProfilePatch = {};
  if (unsent.affirmationsEnabled !== undefined && unsent.affirmationsEnabled !== server.affirmationsEnabled) {
    push.affirmationsEnabled = unsent.affirmationsEnabled;
  }
  if (unsent.ambientSound !== undefined && unsent.ambientSound !== server.ambientSound) {
    push.ambientSound = unsent.ambientSound;
  }
  if (unsent.ambientVolume !== undefined && unsent.ambientVolume !== server.ambientVolume) {
    push.ambientVolume = unsent.ambientVolume;
  }
  return push;
}

function hasUnsentSettings(userId: string | null): boolean {
  const unsent = userId === null ? undefined : useProfilePrefsStore.getState().byUser[userId]?.unsent;
  return unsent !== undefined && Object.keys(unsent).length > 0;
}

function toSnapshot(row: UserProfileRow): ServerSnapshot {
  const profile = toUserProfile(row);
  return {
    createdAt: profile.createdAt,
    subscriptionTier: profile.subscriptionTier,
    syncedAt: new Date().toISOString(),
    affirmationsEnabled: profile.affirmationsEnabled,
    ambientSound: profile.ambientSound,
    ambientVolume: profile.ambientVolume,
  };
}

function unauthorized(): RepoResult<never> {
  return { ok: false, code: "UNAUTHORIZED", message: copy.profile.errors.load };
}

let running: Promise<RepoResult<null>> | null = null;
let runAgain = false;
let lastOkAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

async function runOnce(): Promise<RepoResult<null>> {
  const userId = getSupabaseUserId();
  if (userId === null) return unauthorized();
  // The mock profile needs no network.
  if (getProfileSource() !== "supabase") return { ok: true, data: null };

  const fetched = await fetchOrCreateProfileRow();
  if (!fetched.ok) return fetched;
  // The user may have signed out, or another account signed in, while the request was away.
  if (getSupabaseUserId() !== userId) return unauthorized();

  const row = fetched.data;
  const server = toUserProfile(row);
  const prefs = useProfilePrefsStore.getState();
  prefs.saveSnapshot(userId, toSnapshot(row));

  // What this run decided to send, taken before the request: an edit made while it is away is not part of it.
  const unsent = prefs.byUser[userId]?.unsent ?? {};
  const onboarding = useOnboardingStore.getState();
  const reminderAction = decideReminderSync(server.reminders, onboarding.reminders, onboarding.remindersDirty);
  const sentReminders = { ...onboarding.reminders };
  const columns: UserProfileUpdate = settingColumns(settingsToPush(server, unsent));
  if (reminderAction === "push") Object.assign(columns, reminderColumns(sentReminders));
  // The server uses the zone for the week boundary of the free limit; a phone that travels updates it.
  const zone = getDeviceTimezone();
  if (row.timezone !== zone) columns.timezone = zone;

  if (reminderAction === "apply-server") {
    onboarding.applyServerReminders(server.reminders);
    // TODO(28): reschedule the affirmation notifications for the new times
  } else if (reminderAction === "mark-synced" && (onboarding.remindersDirty || onboarding.remindersSyncedAt === null)) {
    onboarding.markRemindersSynced();
  }

  if (Object.keys(columns).length > 0) {
    const written = await pushProfileColumns(columns);
    if (!written.ok) return written;
    if (getSupabaseUserId() !== userId) return unauthorized();
    useProfilePrefsStore.getState().saveSnapshot(userId, toSnapshot(written.data));
    if (reminderAction === "push") {
      const latest = useOnboardingStore.getState();
      // An edit made while the request was away is not on the server yet: it stays unsent and goes in a moment.
      if (sameTimes(latest.reminders, sentReminders)) latest.markRemindersSynced();
      else scheduleProfileSync();
    }
  }

  // The server now has every unsent setting that has not been edited again since this run began.
  useProfilePrefsStore.getState().clearUnsent(userId, unsent);
  if (hasUnsentSettings(userId)) scheduleProfileSync();
  lastOkAt = Date.now();
  return { ok: true, data: null };
}

// One sync at a time. A call that arrives while one is running asks for another run right after it, so an edit
// that came in too late for the running one is never skipped.
export function syncProfile(): Promise<RepoResult<null>> {
  if (running !== null) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    let result = await runOnce();
    while (runAgain) {
      runAgain = false;
      result = await runOnce();
    }
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function scheduleProfileSync(): void {
  cancelProfileSync();
  timer = setTimeout(() => {
    timer = null;
    syncProfile();
  }, SYNC_DEBOUNCE_MS);
}

export function cancelProfileSync(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

// Called when the app comes back to the foreground: at once when an edit is unsent, otherwise at most every 30 s.
export function syncProfileOnForeground(): void {
  const unsent = useOnboardingStore.getState().remindersDirty || hasUnsentSettings(getSupabaseUserId());
  if (unsent || Date.now() - lastOkAt >= FOREGROUND_SYNC_GAP_MS) {
    syncProfile();
  }
}

// Sends a reminder edit 800 ms after the last change (a setting edit schedules its own sync, in updateProfile).
// Returns the function that stops watching.
export function watchReminderEdits(): () => void {
  const unsubscribe = useOnboardingStore.subscribe((state, previous) => {
    if (state.remindersDirty && state.reminders !== previous.reminders) scheduleProfileSync();
  });
  return () => {
    unsubscribe();
    cancelProfileSync();
  };
}
```

---

## 4. Edits to the existing files

Each block is a unified diff of the current file (compared with line endings ignored). Apply it by hand or with a small script; remember section 0, item 4 for CRLF files. Nothing else in these files changes.

**`src/data/journalRepository.ts`**

```diff
--- a/src/data/journalRepository.ts
+++ b/src/data/journalRepository.ts
@@ -6,7 +6,7 @@
   WEEK_STARTS_ON,
 } from "@/constants/app";
 import { copy } from "@/constants/copy";
-import { toAffirmation, toJournalEntry, toPrayer, toUserProfile } from "@/data/mappers";
+import { getDeviceTimezone, toAffirmation, toJournalEntry, toPrayer, toUserProfile } from "@/data/mappers";
 import { addMockEntry, getMockDb } from "@/data/mock/db";
 import {
   getProfileSource,
@@ -14,7 +14,7 @@
   takeMockSubmitOutcome,
   type MockSubmitOutcome,
 } from "@/data/mock/scenario";
-import { syncProfile } from "@/services/profileSync";
+import { scheduleProfileSync, syncProfile } from "@/services/profileSync";
 import { getSupabaseUserId } from "@/services/supabaseClient";
 import { useOnboardingStore } from "@/store/onboardingStore";
 import { useProfilePrefsStore } from "@/store/profilePrefsStore";
@@ -33,7 +33,7 @@
   TimeSlot,
   UserProfile,
 } from "@/types";
-import type { JournalEntryRow, UserProfileRow } from "@/types/database";
+import type { JournalEntryRow } from "@/types/database";
 import { answeredDateToTimestamp, isValidAnsweredDate } from "@/utils/prayerDates";
 
 const SLOT_ORDER: readonly TimeSlot[] = ["morning", "afternoon", "evening"];
@@ -85,31 +85,29 @@
   };
 }
 
-// The signed-in user's profile as this device knows it (step 17): the sign-up date and the plan from the last sync,
-// the reminder times from the onboarding store, and the settings users_profile has no column for yet. Null until
-// the first sync has finished. TODO(18): the settings become columns, and the prefs store goes away.
+// The signed-in user's profile as this device knows it: the sign-up date, the plan and the settings from the last sync,
+// the settings changed since then (not yet sent) on top, and the reminder times from the onboarding store. Null until
+// the first sync has finished.
 function readLocalProfile(userId: string): UserProfile | null {
   const entry = useProfilePrefsStore.getState().byUser[userId];
   if (entry === undefined || entry.snapshot === null) return null;
-  const { prefs, snapshot } = entry;
-  const row: UserProfileRow = {
+  const { unsent, snapshot } = entry;
+  return {
     id: userId,
-    created_at: snapshot.createdAt,
-    subscription_tier: snapshot.subscriptionTier,
-    reminder_morning: null,
-    reminder_afternoon: null,
-    reminder_evening: null,
-    last_active_at: null,
-    ambient_sound: prefs.ambientSound ?? null,
-    ambient_volume: prefs.ambientVolume ?? null,
-    affirmations_enabled: prefs.affirmationsEnabled ?? null,
+    createdAt: snapshot.createdAt,
+    subscriptionTier: snapshot.subscriptionTier,
+    reminders: { ...useOnboardingStore.getState().reminders },
+    timezone: getDeviceTimezone(),
+    ambientSound: unsent.ambientSound ?? snapshot.ambientSound,
+    ambientVolume: unsent.ambientVolume ?? snapshot.ambientVolume,
+    affirmationsEnabled: unsent.affirmationsEnabled ?? snapshot.affirmationsEnabled,
   };
-  return { ...toUserProfile(row), reminders: { ...useOnboardingStore.getState().reminders } };
 }
 
 // Never waits for the network once the account has synced, so Journal, Reflection and Profile open offline and as
 // fast as they did on the mock. The first call after sign-in waits for the sync the app already started (one request).
-// A failure throws: the hooks that call this already show their error state and retry on the next focus.
+// Failing to read the profile at all throws: the hooks that call this already show their error state and retry on the
+// next focus.
 export async function getProfile(): Promise<UserProfile> {
   if (getProfileSource() === "mock") {
     await simulateLatency();
@@ -119,8 +117,10 @@
   if (userId === null) throw new Error("There is no signed-in user.");
   const known = readLocalProfile(userId);
   if (known !== null) return known;
-  const synced = await syncProfile();
-  const afterSync = synced.ok ? readLocalProfile(userId) : null;
+  // The sync saves the profile as soon as it has read the row, so even a sync that failed later (while sending an
+  // edit) leaves one to show. Only a sync that could not read the row leaves nothing.
+  await syncProfile();
+  const afterSync = readLocalProfile(userId);
   if (afterSync === null) throw new Error(copy.profile.errors.load);
   return afterSync;
 }
@@ -269,8 +269,8 @@
 }
 
 // Saves what Profile can change. Same order as the prayer writes: wait (mock only), the dev failure flag, validate,
-// write. The mock mode writes the mock row. Otherwise the three settings are kept on this device for the signed-in
-// user, because users_profile has no column for them yet. TODO(18): write the columns, and delete the prefs store.
+// write. The mock mode writes the mock row. Otherwise the change is kept on this device as an unsent edit for the
+// signed-in user and a sync sends it to users_profile 800 ms later, so it also works offline (step 18).
 export async function updateProfile(patch: ProfilePatch): Promise<RepoResult<UserProfile>> {
   const isMock = getProfileSource() === "mock";
   if (isMock) await simulateWrite(PROFILE_CHANGE_MS);
@@ -288,7 +288,8 @@
   }
   const userId = getSupabaseUserId();
   if (userId === null) return failure("UNAUTHORIZED", copy.profile.errors.save);
-  useProfilePrefsStore.getState().savePrefs(userId, clean);
+  useProfilePrefsStore.getState().saveUnsent(userId, clean);
+  scheduleProfileSync();
   const saved = readLocalProfile(userId);
   return saved === null ? failure("NOT_FOUND", copy.profile.errors.save) : { ok: true, data: saved };
 }
```

**`src/data/mappers.ts`**

```diff
--- a/src/data/mappers.ts
+++ b/src/data/mappers.ts
@@ -51,9 +51,6 @@
   "TTS_FAILED",
 ];
 
-// Where the old public devotional URLs keep the storage path (the same backfill step 18 does).
-const PUBLIC_AUDIO_MARKER = "/storage/v1/object/public/journal_media/";
-
 // The allowed value equal to `value`, else null. Unknown strings never reach the app models.
 function pick<T extends string>(allowed: readonly T[], value: string | null | undefined): T | null {
   return allowed.find((item) => item === value) ?? null;
@@ -120,19 +117,13 @@
   };
 }
 
-function audioPathFromPublicUrl(url: string | null): string | null {
-  const start = url ? url.indexOf(PUBLIC_AUDIO_MARKER) : -1;
-  if (!url || start === -1) return null;
-  return url.slice(start + PUBLIC_AUDIO_MARKER.length) || null;
-}
-
 function toDevotional(row: JournalEntryRow): Devotional | null {
   if (!row.devotional_script) return null;
   return {
     title: row.devotional_title || copy.common.defaultDevotionalTitle,
     script: row.devotional_script,
     closingPrayer: row.closing_prayer ?? null,
-    audioPath: row.devotional_audio_path || audioPathFromPublicUrl(row.devotional_audio_url),
+    audioPath: row.devotional_audio_path || null,
     durationMs: row.devotional_duration_ms ?? null,
   };
 }
```

**`src/data/mock/entries.ts`**

```diff
--- a/src/data/mock/entries.ts
+++ b/src/data/mock/entries.ts
@@ -32,7 +32,6 @@
     scripture_reference: null,
     scripture_text: null,
     devotional_script: null,
-    devotional_audio_url: null,
     is_active_prayer: false,
     is_answered: false,
     answered_at: null,
```

**`src/services/account.ts`**

```diff
--- a/src/services/account.ts
+++ b/src/services/account.ts
@@ -2,7 +2,7 @@
 import { copy } from "@/constants/copy";
 import { simulateWrite } from "@/data/journalRepository";
 import { takeMockPrayerMutationFailure } from "@/data/mock/scenario";
-import { cancelReminderSync } from "@/services/profileSync";
+import { cancelProfileSync } from "@/services/profileSync";
 import { getSupabaseUserId } from "@/services/supabaseClient";
 import { useOnboardingStore } from "@/store/onboardingStore";
 import { usePlayerStore } from "@/store/playerStore";
@@ -42,8 +42,9 @@
 export async function signOutCleanup(): Promise<void> {
   // TODO(33): stopRealtime() first, before the database and the token go
   // A reminder edit that has not reached the server belongs to the account that made it: it must never be sent to
-  // the next account that signs in on this phone.
-  cancelReminderSync();
+  // the next account that signs in on this phone. (The reminder times are device-wide. An unsent setting is kept
+  // per user in the prefs store and is sent when that account signs in again.)
+  cancelProfileSync();
   useOnboardingStore.getState().discardUnsyncedReminders();
   // TODO(24): stop the sync engine and clear this user's SQLite cache
   // A full reset of the player: the position, the speed and the session's ambient choice.
```

**`src/components/SupabaseAuthBridge.tsx`**

```diff
--- a/src/components/SupabaseAuthBridge.tsx
+++ b/src/components/SupabaseAuthBridge.tsx
@@ -2,7 +2,7 @@
 import { useEffect, useLayoutEffect } from "react";
 import { AppState } from "react-native";
 
-import { startReminderSync, syncProfile, syncProfileOnForeground } from "@/services/profileSync";
+import { syncProfile, syncProfileOnForeground, watchReminderEdits } from "@/services/profileSync";
 import { setSupabaseSession } from "@/services/supabaseClient";
 
 // Connects the signed-in Clerk user to Supabase and renders nothing. It sits above the navigator, inside
@@ -25,13 +25,13 @@
   useEffect(() => {
     if (signedInUserId === null) return;
     syncProfile();
-    const stopReminderSync = startReminderSync();
+    const stopWatchingReminders = watchReminderEdits();
     const subscription = AppState.addEventListener("change", (status) => {
       if (status === "active") syncProfileOnForeground();
     });
     return () => {
       subscription.remove();
-      stopReminderSync();
+      stopWatchingReminders();
     };
   }, [signedInUserId]);
 
```

**`src/components/dev/DevToolsPanel.tsx`**

```diff
--- a/src/components/dev/DevToolsPanel.tsx
+++ b/src/components/dev/DevToolsPanel.tsx
@@ -38,6 +38,7 @@
 } from "@/services/supabaseClient";
 import { useDevStore } from "@/store/devStore";
 import { useOnboardingStore } from "@/store/onboardingStore";
+import { useProfilePrefsStore } from "@/store/profilePrefsStore";
 import type { JournalEntry, PermissionResult, SubscriptionTier } from "@/types";
 import {
   formatDuration,
@@ -161,9 +162,17 @@
   lines.push(
     `profile row: ${found.ok ? (found.data === null ? "not found" : "found") : `error ${found.code}`}`,
   );
+  // The columns step 18 added: a database without them has not had the v1 migration applied.
+  if (found.ok && found.data !== null) {
+    lines.push(`settings columns: ${"ambient_sound" in found.data ? "yes" : "NO: apply the step 18 migration"}`);
+  }
   // Row level security: this must say 1 (or 0 before the row exists) even when the table holds other accounts.
   const visible = await countVisibleProfileRows();
   lines.push(`rows this user can see: ${visible.ok ? visible.data : `error ${visible.code}`}`);
+  // Settings changed on this device that the server has not confirmed yet (names only, never values).
+  const userId = getSupabaseUserId();
+  const unsent = userId === null ? [] : Object.keys(useProfilePrefsStore.getState().byUser[userId]?.unsent ?? {});
+  lines.push(`unsent settings: ${unsent.length === 0 ? "none" : unsent.join(", ")}`);
   lines.push(`last error: ${getLastProfileError() ?? "none"}`);
   return lines;
 }
```

---

## 5. The typing proof

Create `src/types/typing-proof.ts` with this text, run `npm run typecheck` (it must exit 0: every `@ts-expect-error` line must be *used*, and an unused one is itself an error), then delete the file.

```ts
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

// Step 18 typing proof: what the signed-in app may send is checked by the compiler. Delete this file after the check.
const supabase = createClient<Database>("https://abcd1234.supabase.co", "sb_publishable_x");

// Allowed: exactly the columns the migration grants.
supabase.from("users_profile").update({ reminder_morning: "08:00:00", ambient_volume: 0.5, timezone: "UTC" });
supabase
  .from("users_profile")
  .upsert({ id: "user_1", timezone: "UTC", ambient_sound: "off" }, { onConflict: "id", ignoreDuplicates: true });
supabase.from("journal_entries").update({ is_answered: true, answered_at: "2026-01-01T00:00:00Z", prayer_category: "INNER PEACE" });
supabase.from("daily_affirmations").update({ is_favorite: true });
supabase.from("journal_entries").select("*").eq("user_id", "user_1");

// Refused at compile time.
// @ts-expect-error the plan is the server's
supabase.from("users_profile").update({ subscription_tier: "pro" });
// @ts-expect-error created_at is the server's
supabase.from("users_profile").insert({ id: "user_1", created_at: "2026-01-01" });
// @ts-expect-error updated_at is kept by a trigger
supabase.from("users_profile").update({ updated_at: "2026-01-01" });
// @ts-expect-error the app never inserts an entry
supabase.from("journal_entries").insert({ user_id: "user_1", input_type: "text" });
// @ts-expect-error a processing status is the server's
supabase.from("journal_entries").update({ processing_status: "ready" });
// @ts-expect-error nor is_crisis
supabase.from("journal_entries").update({ is_crisis: true });
// @ts-expect-error nor an affirmation's text
supabase.from("daily_affirmations").update({ headline: "x" });
// @ts-expect-error nor insert an affirmation
supabase.from("daily_affirmations").upsert({ id: "x" });
// @ts-expect-error a column that does not exist
supabase.from("users_profile").update({ nonsense: 1 });

// The rows are typed from the database.
export async function rows() {
  const { data } = await supabase.from("journal_entries").select("*").limit(1);
  const entry = data?.[0];
  if (entry) {
    const status: string = entry.processing_status;
    const crisis: boolean = entry.is_crisis;
    const path: string | null = entry.devotional_audio_path;
    // @ts-expect-error devotional_audio_url never existed in the real table
    const old = entry.devotional_audio_url;
    return [status, crisis, path, old];
  }
  return [];
}
```

---

## 6. Rules

- No new dependency. PGlite is installed in a scratch folder outside the repo, never in `package.json`. No `any`, no `@ts-ignore`.
- No SQL is run against the hosted project by the implementer, and no Supabase token, database password or `service_role` key is read, written or logged. If you find one in the repo or in `.env.local`, stop and tell the user.
- Do not edit `src/types/supabase.ts` or either migration. If a migration is wrong, say so and write a new one with the user's agreement (a migration that has been applied is never edited).
- No screen, hook, copy string or layout change. Never log a token, a Clerk user id, an email or a row; a development warning may carry a table name and an error code only.
- The five `TODO(18)` markers go (in `database.ts`, `profileRemote.ts`, `profilePrefsStore.ts` and twice in `journalRepository.ts`: the drafts in sections 2 to 4 already drop them). The drafts add no marker. Keep `TODO(19)` (`supabaseClient.ts`: the Edge Function verifies the Clerk session token) and `TODO(28)` (`profileSync.ts`: reschedule the notifications after the sync applies new reminder times); `TEMP(29)` and `TEMP(30)` stay where they are. The release gate `grep -rnE "TEMP\(|TODO: real" src` still prints 17 lines. Say in the log entry that step 24's cache could take over the prefs store's offline copy of the profile.

---

## 7. AGENTS.md updates

Already applied in the review (do not redo; check they still read right): Database Rules (the migrations, the proof, "nothing reaches the hosted database", the type command, what the app may write), the Schema section (what step 18 built and what is open), Backend rule 7 (private storage, decided), the TypeScript Rules sentence about the generated types, and two bullets in "Verifying on this machine" (no Docker and the PGlite runner; line endings after the rebase).

Do now, in the same step:

- **Architecture tree:** `types/supabase.ts` (generated) and `types/database.ts` (re-exports the rows and narrows what the app may send); `store/profilePrefsStore.ts` is version 2 (`snapshot` and `unsent` per user); `services/profileSync.ts` (the settings and the time zone join the reminder times; the three renamed functions); `data/profileRemote.ts` (`pushProfileColumns`, `reminderColumns`, `settingColumns`); the `journalRepository.ts` line (`updateProfile` saves an unsent edit and schedules a sync; `getProfile` opens when the first sync read the row); a `supabase/` entry for `migrations/`, `tests/` (the SQL checks, `run-in-pglite.mjs`, `profile-sync/`), `schema.sql` and `selftest.sql`. Search with `grep -n "prefs store\|profilePrefsStore\|gracehush.profilePrefs\|TODO(18)\|startReminderSync\|cancelReminderSync" AGENTS.md` and fix every sentence that says the settings are device-only or that step 18 deletes the store.
- **Authentication Rules** (the sign-out exceptions): the prefs store now keeps each account's offline copy of the sign-up date, the plan and the three settings, plus its unsent setting edits, keyed by Clerk user id; sign out drops only an unsent reminder edit; account deletion removes that account's entry.
- **Log entry** "Step 18 — Schema migration (date)": the numbered decisions above (shortened), the files created and changed, the measured values (the sizes of the self-test and harness results, the time from changing a setting to the row changing, the offline Profile time), what was verified and what was not (iOS), the open items and the markers.
- Then `cp AGENTS.md prompts/AGENTS.md` and `cmp` them (both files are CRLF in the working tree). Update the memory notes if you learned something the next prompt needs.

---

## 8. Verify

### Part A: always (no emulator)

1. `npm run lint` and `npm run typecheck` exit 0 (read the whole output; no piping to `tail`). `npx expo install --check` is up to date. `npx expo export` for Android, then for iOS (one platform at a time, `NODE_OPTIONS=--max-old-space-size=3072`, output folder outside the repo): both exit 0.
2. The typing proof from section 5 passes, then is deleted.
3. `node supabase/tests/profile-sync/run.cjs` prints **88 passed, 0 failed**. They cover: the env check, the error mapper and the JWT reader; the onboarding store and its migration; the prefs store (saving, `clearUnsent` keeping a setting edited mid-request, repair of damaged data, the version 1 migration, a `__proto__` user id); the sync (new account, existing account on a new phone, an unsent reminder, an unsent setting alone, a setting the server already has, reminders and settings and zone in **one** request, a different zone, a failed send, a failed read, an edit made while a send is away, another account signing in mid-request, two calls at once, the debounce, the foreground rule, the upgrade from step 17); the repository (the first `getProfile`, a first sync that fails to send, an edit that answers at once and is sent 800 ms later, offline, bad input, the mock source, the plan staying the mock's, sign-out and deletion); the client over the fake PostgREST (the create body, the new row carrying the settings changed before the account existed, the exact columns of a send, offline in under 0.5 s, HTTP 401/403/500, `PGRST204`, no secret in any log line, and the fake itself refusing the plan, `created_at` and a bad value); and everything together (sign-up, Profile edits, another phone's change, an unsent edit beating the server's value, offline, two accounts, the upgrade, a database without the migration).
4. If you touched a SQL file: `PGLITE=<scratch>/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/run-in-pglite.mjs --negative` (after `npm install @electric-sql/pglite@0.5.11` in a scratch folder outside the repo) prints `ALL GOOD`. A hosted run of both self-tests (part C) follows any SQL change.
5. `grep -rn "devotional_audio_url\|savePrefs\|cancelReminderSync\|scheduleReminderSync\|startReminderSync\|pushReminderColumns" src App.tsx supabase` finds nothing, and `grep -rn "\.prefs\b" src` finds only the version 1 migration in `profilePrefsStore.ts`. `grep -rnE "service_role|SERVICE_ROLE|sb_secret_" src App.tsx .env.example` finds only the guard in `src/constants/env.ts`. `grep -rnE "TEMP\(|TODO: real" src` prints 17 lines. `git status` shows no `ios/`, `android/` or `supabase/config.toml`.
6. With `.env.local` lacking the Supabase values (or the dev switch on `mock`): the app starts without a red screen and the step 15 and 16 flows behave as before, including the ambient and affirmations switches on Profile.

### Part B: after A to E (Expo Go on the emulator; the iPhone in Expo Go is the user's check)

Sign in with a Clerk test address (the development instance accepts any `+clerk_test` address with the code `424242`): `gracehush18a+clerk_test@example.com`. Follow AGENTS.md "Verifying on this machine" for Metro, the emulator and its traps (the Clerk toast, Back at the tab root, a size change resetting the dev store).

1. **Supabase check (dev)** on Profile, bottom: keys yes, profile source supabase, signed in yes, Clerk token has role = authenticated, profile row found, **settings columns: yes**, rows this user can see 1, **unsent settings: none**, last error none. (The user opens the Table Editor, table `users_profile`: the row has the new columns, `timezone` is the phone's zone, and `subscription_tier` is `free`.)
2. Change Daily Affirmations, the ambient sound and the volume on Profile. The summary changes at once. Two seconds later the user sees all three in the Table Editor and `updated_at` has moved; the check says `unsent settings: none`. Measure and report the time from the tap to the changed row.
3. Force-stop Expo Go and reopen: the three settings are kept. Sign out and in again: kept (now from the server).
4. Airplane mode (`adb shell cmd connectivity airplane-mode enable`): change the ambient sound. Profile shows it at once, no error appears anywhere, and the check says `unsent settings: ambientSound`. Turn airplane mode off and bring the app to the foreground: within seconds the row changes in the Table Editor and the check says `none`.
5. In the Table Editor change `ambient_sound` by hand. Bring the app to the foreground (after 30 seconds): Profile shows the server's value (nothing was unsent, so the server wins).
6. A second account (`gracehush18b+clerk_test@example.com`): its own row with the column defaults (Off, 50%, on), its `timezone` set, the Table Editor shows two rows, the check on each account says **rows this user can see: 1**, and the first account's values are untouched.
7. The upgrade from step 17: if the emulator or the iPhone still has settings saved by step 17 for an account (a non-default sound or volume), open the app once after the code change and check that the Table Editor now holds them (they were sent once), and that the check says `unsent settings: none`.
8. Signed out: the check says `signed in: no` and stops there; nothing was sent. The dev store `profileSource` on `mock`: the step 15 and 16 scenarios work; back on `supabase` the real profile returns; buying the mock trial writes nothing (the `subscription_tier` in the Table Editor stays `free`).
9. Logs: `adb logcat -d -s ReactNativeJS:V` and Metro's output hold no token, Clerk id, email or row from this step, only `[supabase] users_profile: <code>` lines if something failed.
10. The user's iPhone (Expo Go, restart Metro with `npx expo start -c` once): items 1, 2 and 4 (airplane mode from Control Center), and a look at Journal, Reflection and Profile: nothing should look different from before this step.

### Troubleshooting (for the user and for the implementer)

| What you see | Cause | Fix |
| --- | --- | --- |
| Check: "settings columns: NO" | the migration (part B) was not run on this project | run B, then C |
| last error `users_profile: PGRST204` ("a column is missing") | same, or the Data API has not noticed the new columns yet | do B; wait 30 seconds; or run `notify pgrst, 'reload schema';` in the SQL editor |
| last error `users_profile: 42501` | the grants are missing or partial | run B again, then the self-tests |
| A self-test row is false | something differs from the proven SQL (a table or policy made by hand, an edited file) | send the whole table; run `preflight.sql` and send that too |
| Only rows 36 to 42 are false | the bucket or its policies | send the table; nothing in the app needs storage before step 23 |
| B stops with "permission denied" for `buckets` or `objects` | the SQL editor's role may not write the storage tables on this project | send the message first; the fallback is the dashboard: **Storage**, new bucket `journal_media`, public **off**, file size limit 25 MB, allowed types `audio/mp4, audio/m4a, audio/x-m4a, audio/aac, audio/mpeg`, then the two policies from the file under **Storage, Policies**; run B again for everything else and C to check |
| `rows this user can see` is 2 or more | row level security is off or wrong | stop; run `rls_selftest.sql` and send the table |
| `npm run typecheck` fails inside `src/types/supabase.ts` | the file was edited or saved as UTF-16 | download it again (E); never edit it |
| The typing proof shows "Unused '@ts-expect-error' directive" | `database.ts` does not narrow a table | compare it with section 2 |
| Profile shows its error card on the very first launch after sign-in | the first read of the row failed and there is no network | connect, then Try again; later launches work offline |

---

## 9. Report

Which of A to E you walked the user through and what the tables showed (the preflight before and after, the 45 and the 11 rows); the generated types file (size; the three tables found; the CLI or the dashboard); files created, changed and deleted (none deleted; the SQL files, the runner and the checks already existed); the typing proof; the profile sync checks before (red) and after (88 green); the Part B values (time from a tap to the changed row, Profile offline time, what the user saw in the Table Editor); which settings are now columns and what the prefs store still holds; the markers left; and these mismatches in later prompts (reported, not edited):

- **19** (and **20, 21, 22, 30, 31**) test Edge Functions with `npx supabase start` and `functions serve`, which need Docker (not installed), and 19 reads `supabase/config.toml` and `supabase/functions/process-entry/`, neither of which exists. Use the hosted project (deploying a function asks the user first) or run the function with Deno directly. Its claim insert (`user_id`, `client_entry_id`, `input_type`, `transcript`, `audio_path`, `processing_status`) and its crisis update fit the columns and constraints exactly; a crisis update must null the prayer fields in the same statement.
- **22** asks to confirm that `devotional_audio_url` exists (section 1, item 2: "if any is missing, stop and ask") and later to drop it: the column was never created. Skip both. It writes `{userId}/devotionals/{entryId}.mp3` with `upsert: true`, which only the service role may do (fine).
- **29** section 7: the three prayer rules are already in `journal_entries` with the same constraint names (`answered_fields_match`, `crisis_not_prayer`, `answered_note_length`): skip the section and its `db reset`. Its section 1 grant check passes as written (UPDATE on `is_active_prayer`, `is_answered`, `answered_at`, `answered_notes`, `prayer_category`; not `prayer_summary`).
- **22, 29, 30, 31, 33** say `npx supabase db reset`, `supabase/tests/rls_test.sql` and `npm run types:db`. The equivalents are: apply the new migration in the SQL editor, add checks to `supabase/tests/rls_selftest.sql` and a variant to `run-in-pglite.mjs`, and regenerate the types as AGENTS.md (Database Rules) says.
- **23** uploads to `{userId}/raw/{clientEntryId}.m4a` with `upsert: false`: that is exactly what the policy allows (`upsert: true` would need an UPDATE policy). **23, 25 and 33** still say `src/lib/supabase.ts` (reported in step 17).
- **24**: the SQLite `client_entry_id TEXT` maps to the `uuid` column; keep canonical lowercase UUID strings.
- **25**: its `ENTRY_COLUMNS` omit `prayer_title`, so every prayer would read "Prayer from Oct 2" (`getPrayerTitle`); add it if the column should be read. "Reflection title" is `devotional_title` and "answered note" is `answered_notes`.
- **28**: its premise is right: the app can update only `is_favorite` on `daily_affirmations`, so `scheduled_for` and `is_delivered` stay unused.
- **31**: the cascade is real (deleting the `users_profile` row removes the entries and affirmations); storage files are not removed by it, so the Edge Function deletes `{userId}/` in `journal_media` with the service role.
