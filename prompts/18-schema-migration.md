# 18-schema-migration.md

Read AGENTS.md first and follow it strictly.

Create the first real Supabase migration for Gracehush. It adds the
planned columns, locks columns the client must never write, makes media
storage private with per-user folders, regenerates TypeScript types and
moves the step 17 device-only prefs into real columns. This step touches
the database, RLS, grants and storage. AGENTS.md requires approval for
all of these. You write and test locally; you apply to the hosted
project ONLY after the user says yes (section 8).

No UI changes. No Edge Function changes or deploys (steps 19–22). No
Clerk or Supabase dashboard changes beyond the bucket check the user
does themselves.

Docs (source of truth, follow exactly):

- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/guides/local-development/cli/getting-started
- https://supabase.com/docs/guides/auth/third-party/clerk (local config)
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/postgres/column-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/docs/guides/api/rest/generating-types

---

## 1. Before writing SQL

1. Read supabase/schema.sql, src/types/database.ts (every field marked
   // planned: migration in step 18), AGENTS.md "Known Schema Gaps",
   src/data/mappers.ts, src/store/profilePrefsStore.ts (step 17),
   src/data/journalRepository.ts and supabase/functions/process-entry/.
2. Build a table of planned columns: name, table, type, nullability,
   default, where it's used (file:line). Compare database.ts with
   AGENTS.md. If they disagree on a name or type, or a mapper uses a
   field that's in neither, stop and show the table. Do not guess.
3. Confirm the Supabase CLI is available (`npx supabase --version`).
   Do not install it globally. If the repo has no supabase/config.toml,
   ask before running `npx supabase init`. Docker is required for the
   local stack. If it isn't running, say so and stop.
4. Report the current state of the live project WITHOUT changing it.
   Ask the user to run these in the SQL editor (or run them yourself
   only against the local stack):
   select id, public, file_size_limit, allowed_mime_types
   from storage.buckets where id = 'journal_media';
   select grantee, privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name in
   ('users_profile','journal_entries','daily_affirmations');
   select policyname, cmd, tablename from pg_policies
   where schemaname in ('public','storage');
   select count(\*) from journal_entries where devotional_audio_url is not null;
5. If schema.sql has been applied by hand (no supabase/migrations
   folder), create a baseline first: `npx supabase db pull` into
   supabase/migrations/<timestamp>\_baseline.sql after asking. Keep
   schema.sql only as documentation and add a header comment saying the
   migrations folder is the source of truth.

---

## 2. Migration file

`npx supabase migration new gracehush_v1_schema`. One file, wrapped in a
transaction by the CLI. Every statement is idempotent where Postgres
allows (`add column if not exists`, `create index if not exists`,
`drop policy if exists` before `create policy`).

Expected columns. Reconcile with the section 1 table; the section 1
result wins on exact names.

users_profile

- affirmations_enabled boolean not null default true
- ambient_sound text not null default 'off'
  check in the AmbientSound union values from src/types/index.ts
- ambient_volume real not null default 0.5 check between 0 and 1
- timezone text not null default 'UTC'
  (client writes the real zone; no check beyond length 1–64)
- updated_at timestamptz not null default now()

journal_entries

- client_entry_id uuid (nullable for old rows)
  unique (user_id, client_entry_id)
- processing_status text not null default 'ready'
  check in the ProcessingStatus union values
- is_crisis boolean not null default false
- audio_path text (raw recording, saved first)
- devotional_audio_path text
- devotional_duration_ms integer check >= 0 (the duration field from
  step 12; use its real name)
- scripture_verified boolean not null default false
- prayer_summary text check length <= 200
- prayer_category text check in the PrayerCategory union values
- answered note column: keep the existing name from schema.sql
  (answered_notes or answered_note); add only if missing
- error_code text (last processing failure code, nullable)
- updated_at timestamptz not null default now()
- Keep devotional_audio_url for now: comment it
  'DEPRECATED: use devotional_audio_path (step 22)'.
- Keep embedding VECTOR(768) untouched. No vector index (V2).

daily_affirmations

- is_favorite boolean not null default false
- scheduled_for timestamptz (nullable; step 28)
- confirm entry_id exists with a FK to journal_entries; add it if
  missing (ask first, because existing rows need a value).

Constraints and indexes

- Crisis rule: check (not is_crisis or (devotional_script is null and
  devotional_audio_path is null and scripture_reference is null)).
  If any existing row violates it, stop and report the count. Never
  delete or edit rows to make it pass.
- FKs from journal_entries.user_id and daily_affirmations.user_id to
  users_profile(id) ON DELETE CASCADE. If an FK exists without cascade,
  drop and recreate it.
- Indexes: journal_entries (user_id, created_at desc);
  journal_entries (user_id) where is_active_prayer;
  daily_affirmations (user_id, entry_id).
- A shared set_updated_at() trigger function (security invoker,
  search_path = ''), BEFORE UPDATE triggers on users_profile and
  journal_entries.

Backfill (same migration):

- devotional_audio_path = the part after
  '/storage/v1/object/public/journal_media/' in devotional_audio_url,
  only where the URL matches that prefix. Report the rows that don't
  match; leave them null.
- devotional_duration_ms stays null for old rows (the player falls back
  to the file's real length in step 26).

---

## 3. RLS policies (rewrite)

- Keep RLS enabled on all three tables. Add `alter table ... force row
level security` only if the user agrees (it affects the table owner,
  not the service role).
- Replace the body of requesting_user_id() with
  `select nullif((select auth.jwt()) ->> 'sub', '')` (stable,
  security invoker, search_path = ''). Keep the name so nothing breaks.
- Recreate per-table policies `to authenticated` with
  `using ((select requesting_user_id()) = <owner column>)` and the same
  `with check` on insert/update:
  users_profile: select, insert, update (no delete).
  journal_entries: select, insert, update, delete.
  daily_affirmations: select, update (no insert/delete from client;
  the Edge Function creates them).
- No policy for `anon` on any table.
- Report the old and new policy names.

---

## 4. Column privileges (the Pro lock)

Postgres ignores a column-level REVOKE while a table-level grant
exists. So revoke at table level and grant back only allowed columns:

revoke insert, update on public.users_profile from authenticated, anon;
grant insert (id, reminder_morning, reminder_afternoon,
reminder_evening, timezone) on public.users_profile to authenticated;
grant update (reminder_morning, reminder_afternoon, reminder_evening,
affirmations_enabled, ambient_sound, ambient_volume, timezone)
on public.users_profile to authenticated;

revoke insert, update on public.journal_entries from authenticated, anon;
grant insert (user_id, client_entry_id, input_type, transcript,
audio_path, processing_status) on public.journal_entries
to authenticated;
grant update (is_active_prayer, is_answered, answered_at,
<answered note column>, prayer_category) on public.journal_entries
to authenticated;

revoke insert, update on public.daily_affirmations from authenticated, anon;
grant update (is_favorite) on public.daily_affirmations to authenticated;

- Keep select (and delete on journal_entries) for authenticated.
- Revoke all on these tables from anon.
- Client inserts into journal_entries may set processing_status only
  to 'pending': add a check via the insert policy's with check
  (processing_status = 'pending' and not is_crisis).
- service_role keeps full access (Edge Functions, RevenueCat webhook).
- Before writing these lists, grep the client for every
  .insert/.update/.upsert and confirm each column it sends is granted.
  Report any client write that would now fail. Fix the client only if
  it's sending a column it shouldn't (e.g. subscription_tier).

---

## 5. Private storage

Ask the user to confirm: "Make journal_media private? Existing public
links will stop working; the app will use signed links from step 22."
Do not run the storage part without a yes.

- update storage.buckets set public = false,
  file_size_limit = 26214400 (25 MB),
  allowed_mime_types = array['audio/mp4','audio/m4a','audio/x-m4a',
  'audio/aac','audio/mpeg']
  where id = 'journal_media'. Create it with these settings if missing.
- Path layout (document in AGENTS.md):
  {userId}/raw/{clientEntryId}.m4a (client upload, step 23)
  {userId}/devotionals/{entryId}.mp3 (Edge Function, step 22)
- Drop the old journal_media policies. Create on storage.objects,
  `to authenticated`:
  select: bucket_id = 'journal_media' and
  (storage.foldername(name))[1] = (select requesting_user_id())
  insert: same, plus (storage.foldername(name))[2] = 'raw'
  No client update or delete policy (no overwrite, no deletion from
  the app). Service role handles devotionals and deletes.
- Recommendation in the report: stay on Supabase Storage for V1 (it's
  what the code uses). Moving audio to Cloudflare R2 is a later,
  separate decision.

---

## 6. Local config and testing

- supabase/config.toml, for local third-party auth:
  [auth.third_party.clerk]
  enabled = true
  domain = "<Clerk development domain>"
  Ask the user for the domain. Never invent it.
- `npx supabase db reset` applies the baseline + this migration on the
  local stack. It must run clean twice in a row.
- Add supabase/tests/rls_test.sql (pgTAP or plain SQL with
  `set local role authenticated` and
  `set local request.jwt.claims = '{"sub":"user_a","role":"authenticated"}'`)
  proving:
  1. user_a sees only user_a rows in all three tables.
  2. user_a cannot update subscription_tier (permission denied).
  3. user_a cannot insert a profile with subscription_tier.
  4. user_a cannot insert an entry for user_b, or with is_crisis true,
     or with processing_status 'ready'.
  5. user_a cannot read or upload under user_b/ in journal_media, and
     cannot upload outside raw/.
  6. anon reads nothing.
  7. deleting user_a's profile (as service role) removes their entries
     and affirmations.
  8. a crisis row with a devotional script is rejected.
     Run with `npx supabase test db` if pgTAP is set up; otherwise run the
     file with psql against the local stack and show the output.

---

## 7. Types and app code

- Generate: `npx supabase gen types typescript --local >
src/types/supabase.ts`. Do not hand-edit it. Add an npm script
  "types:db" with the same command.
- Typed client from step 17 now uses `Database` from
  src/types/supabase.ts. src/types/database.ts re-exports row types
  from it (Tables<'journal_entries'> etc.) and drops the hand-written
  copies. Remove every // planned: migration in step 18 marker.
- Mappers: keep the safe defaults (old rows may be null) but remove
  defaults for columns that are now NOT NULL.
- Move step 17 device-only prefs:
  - Repository updateProfile writes affirmations_enabled,
    ambient_sound, ambient_volume to users_profile.
  - One-time move in profileSync: if profilePrefsStore has values for
    this userId and the server row still has the column defaults,
    write them once, then delete that user's entry. When the store is
    empty for all users, delete src/store/profilePrefsStore.ts and its
    AsyncStorage key `gracehush.profilePrefs`.
  - Write timezone (Intl resolvedOptions().timeZone) on sign-in when it
    differs from the row.
- Search the client for devotional_audio_url reads and leave
  // TODO(22): use signed URL from devotional_audio_path.
- Do not change UI, copy or Edge Function code.

---

## 8. Apply to the hosted project (approval gate)

Stop and show the user:

1. The full migration SQL.
2. The rls_test output (all passing).
3. Row counts affected by the backfill and any unmatched URLs.
4. Any client writes changed in section 4.
   Ask: "Apply this migration to the linked Supabase project?"
   Only on yes:

- `npx supabase link --project-ref <ref>` if not linked (ask for the
  ref; never read it from another project).
- `npx supabase db push --dry-run`, show the output, then
  `npx supabase db push`.
- Regenerate types with `--linked` and confirm no diff from local.
  Recommend a database backup or branch first (Dashboard → Database →
  Backups) and say so before pushing. Never run `db reset` against the
  linked project.

---

## 9. AGENTS.md updates

- Known Schema Gaps: remove every gap fixed here. Keep: embedding unused
  (V2), devotional_audio_url deprecated (remove after step 22),
  storage file deletion on account delete (step 31).
- Add "Database Rules": migrations only via supabase/migrations; client
  may write only granted columns (list them); subscription_tier is
  service-role only; storage path layout; run rls_test before any
  policy change.

---

## 10. Verify

1. `npx supabase db reset` (twice) and the RLS tests pass locally.
2. `npx expo start -c`, `npm run lint`, `npm run typecheck`.
3. On a dev build against local or hosted (after approval): sign in →
   profile loads; change reminders, ambient sound, volume and
   affirmations toggle → the row updates; kill/reopen → kept.
4. From the app in **DEV**, a temporary attempt to update
   subscription_tier fails with permission denied (then remove it).
5. Second account: sees only its own data and prefs.
6. The old public devotional URL now fails (expected); the
   devotional_audio_path is filled for matched rows.
7. Steps 15–16 mock scenarios still work with profileSource 'mock'.

Report: the planned-column table; migration file name; policies before
and after; granted columns; bucket settings; test results; backfill
counts; whether it was pushed; files created, changed and deleted; and
every TODO left for steps 19, 22, 23, 28, 30 and 31.
