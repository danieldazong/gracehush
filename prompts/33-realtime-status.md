# 33-realtime-status.md

Read AGENTS.md first and follow it strictly.

Make the journal update by itself. When a reflection, a prayer or an affirmation changes on the server (another phone, the server finishing a reflection this phone stopped waiting for, a change in the dashboard), the open screen shows it within a second or two, without a pull to refresh. The database sends a tiny "this entry changed" message to a private channel that only its owner can join, and the app reads the entry again through the repository, as it already does. Journal Home's "days of reflection" chip gets its number from the server, so it is right however many reflections are loaded. Polling (step 25) stays only as a fallback. **Screens keep their exact look**: nothing is added on screen except in the developer panel.

**Status of this text.** Reviewed and rewritten on 2026-10-31 from the code of steps 17 to 32 (read file by file) and from Supabase's current pages and the installed packages (listed below). Nothing in it has been built or applied. The migration is written out in full (section 1); the app code is specified closely enough to build, and the implementer proves it (section 6), as steps 29b, 30 and 31 did. Where this text gives a shape and the real code disagrees, follow the real code and say so in the report.

Sources read: `AGENTS.md`; `src/services/supabaseClient.ts`, `src/components/SupabaseAuthBridge.tsx`, `src/hooks/useReflection.ts`, `src/hooks/useJournalHome.ts`, `src/hooks/usePrayers.ts`, `src/services/syncEngine.ts`, `src/services/entryDeletion.ts`, `src/services/account.ts`, `src/services/affirmationScheduler.ts` (`requestAffirmationReschedule`), `src/data/entriesLive.ts` (`fetchEntry`, `fetchAffirmations`, `forgetEntry`, `withPendingChanges`), `src/data/entriesRemote.ts`, `src/data/selectors.ts` (`getReflectionDays`), `src/db/cache.ts`, `src/db/outbox.ts`, `src/db/schema.ts`, `src/store/offlineStore.ts`, `src/types/database.ts`, `src/types/supabase.ts`, `src/components/dev/DevToolsPanel.tsx`, `src/constants/copy.ts`; `supabase/migrations/` (the v1 schema: `updated_at` is set by `set_updated_at()`, `daily_affirmations` carries `user_id`), `supabase/tests/rls_selftest.sql`, `supabase/tests/run-in-pglite.mjs`, `supabase/tests/journal-data/world.cjs`; the installed `@supabase/supabase-js` 2.118.0 (`SupabaseClient.ts`) and `@supabase/realtime-js` 2.118.0 (`RealtimeClient.ts`, `RealtimeChannel.ts`, `lib/constants.ts`, `lib/websocket-factory.ts`); the notes for step 33 left in prompts 25, 28, 29 and 29b; and these pages, which are the source of truth for anything this text does not settle:

- https://supabase.com/docs/guides/realtime/broadcast (Broadcast from the Database, `realtime.send`, daily partitions, `WarnSendingBroadcastMessage`, Broadcast Replay)
- https://supabase.com/docs/guides/realtime/authorization (`realtime.messages` policies, `realtime.topic()`, `extension`, the locked `realtime` schema)
- https://supabase.com/docs/guides/realtime/settings ("Allow public access to channels")
- https://supabase.com/docs/guides/realtime/limits and https://supabase.com/docs/guides/realtime/pricing
- https://supabase.com/docs/guides/auth/third-party/overview and https://supabase.com/docs/guides/auth/third-party/clerk
- https://supabase.com/docs/guides/api/api-keys (publishable keys and Realtime)
- https://supabase.com/docs/reference/javascript/subscribe
- https://supabase.com/docs/guides/realtime/postgres-changes (for the comparison only)

---

## What was checked when this was written (these shaped the prompt)

1. **The old text predated steps 17 to 32 and named things that do not exist.** `src/lib/supabase.ts` is `src/services/supabaseClient.ts` (`getSupabase()`, null while signed out); `rescheduleAffirmations('realtime')` is `requestAffirmationReschedule()`; `supabase/tests/rls_test.sql` is `supabase/tests/rls_selftest.sql`; there is no `npm run types:db` (the types come from the dashboard's download, Database Rules); there is no SQLite `meta` table; "local first, tests, second yes before pushing" is PGlite offline and then your SQL editor (no Docker, no CLI link); and "two physical phones" cannot run here: you have one iPhone in Expo Go, so the other phone is the Supabase SQL editor, whose writes fire the same trigger another phone's would (section 6, Part B).
2. **The markers to close are five.** `git grep` finds `TODO(33)` at `src/hooks/useReflection.ts:49` (the polling), `src/hooks/useJournalHome.ts:314` (the streak counts the entries loaded so far), `src/hooks/usePrayers.ts:56` (Realtime across devices), `src/services/account.ts:94` (stop Realtime first at sign-out) and `src/services/entryDeletion.ts:20` (the DELETE handler calls `forgetOnThisPhone`). AGENTS.md mentions `TODO(33)` in the tree (`entryDeletion.ts`), in Journal Data Rules (the polling) and in the Prayer Rules' "known limit until Realtime" (section 7).
3. **supabase-js 2.118 refreshes the Realtime token by itself.** With the `accessToken` option (step 17), Realtime calls the token callback when the socket connects and after every heartbeat (25 s by default), and pushes a changed token to every joined channel. Clerk's session token lives 60 s, so **no 45-second `setAuth` timer is needed** (the old text's section 4). Two details matter: a join carries the token Realtime holds at that moment, so the app awaits `client.realtime.setAuth()` (no argument: it calls the callback) right before `subscribe()`; and the app's one client is created once and outlives a sign-out (`client ??=`), so without that call a second account's first join would carry the first account's token. When the callback throws (`NoSessionError`), Realtime keeps its last token and logs nothing (no `logger` is set). `removeChannel` leaves the socket open for 50 s before closing it, so stopping also calls `client.realtime.disconnect()`. Presence is off unless a presence listener is added. The socket is React Native's own `WebSocket`. Details: AGENTS.md, the vendor note "Supabase Realtime".
4. **Clerk tokens and the publishable key both work with Realtime.** Supabase's Third-Party Auth pages name Realtime among the products a Clerk token can use, and the API keys page says a connection upgraded with a third-party user token is not held to the 24-hour limit of public connections. No new key or ID is needed (the table below).
5. **Broadcast from the database:** `realtime.send(payload => …, event => …, topic => …, private => true)` (named arguments) inserts into `realtime.messages`, partitioned by day and kept 72 hours to 4 days. **A partition is created when a client connects, not by `realtime.send`**: on a day no client has connected yet, the insert fails and Postgres logs `WarnSendingBroadcastMessage`; the write that fired the trigger still succeeds. So the trigger can never break a write, and the hosted self-test's live checks need the app to have connected once that day (they report "skipped" otherwise). The `realtime` schema is locked (no new tables or functions there), but policies on `realtime.messages` may be created by the `postgres` role; **never** `alter table realtime.messages enable row level security` (it is already on, and the statement fails with `42501 must be owner` and aborts the migration).
6. **"Allow public access to channels" is on by default.** Then anyone holding the publishable key (it ships inside the app) may use public channels on your project, and broadcasts there count against your message quota. The app uses private channels only, so you turn it off (section B). Free plan: 200 concurrent connections, 100 messages a second and 2 million messages a month; a reflection makes roughly eight messages for one connected phone (counted from the writes `process-entry` makes: the claim, the status changes, three affirmations, the audio; not measured), so the quota is far away.
7. **Postgres Changes is not used:** it sends whole rows (the transcript, the verse, the gratitude note) and checks row level security for every change and subscriber. Broadcast carries ids only and the app reads the row itself.
8. **The chip counts a run, not all days.** `getReflectionDays` counts consecutive local days, ending today or yesterday, with at least one finished, non-crisis reflection. The old SQL (`count(distinct day)`) counted every day ever, a different number. The server function computes the same run as the client (section 1.4), named `reflection_streak_days` for that reason. It matters because the client sees only what is loaded (a page of 30 on screen, up to 200 in the read cache).
9. **The screens already catch up by themselves.** Journal Home and Prayers reload when they take focus and when the app returns to the front (`AppState`), and Reflection reloads on focus; the sync engine already emits `finished`, `prayer`, `deleted` and `changed`. So the old "catch-up refresh" exists; Realtime adds what happens while a screen is in front, and across devices, plus one reload after the channel drops and comes back while the app stayed in front.
10. **The cache keeps the last write** (`cache.upsertEntry` has no `updated_at` check), so the handler reads one entry at a time per id and skips a message that is not newer than what the phone holds (decision 9).
11. **The app's own changes come back as messages** (a prayer change, a heart, a delete), and must be harmless the second time: the cached `updated_at` is already the new one, and a deleted entry is no longer in the cache.
12. **An entry's affirmations are saved before it turns `ready`** (Edge Function Rules: `ready` is the last write), but the messages can arrive in either order, so a finished entry's handler also reads its affirmations before the notifications are planned again (step 28's note: a reflection that arrives through Realtime calls `requestAffirmationReschedule()` once its affirmations are on the phone).
13. **Account deletion cascades** (step 31): deleting the profile fires a DELETE message for every entry. The app stops Realtime before it asks for the deletion, with the rest of its background work.

---

## What you do yourself (read this first)

Nothing here costs money: no new plan, package, key or billed call. The walk-through changes rows with the SQL editor instead of making reflections, so it spends no Gemini or Text-to-Speech credit. When you do the dashboard steps the implementer guides you one instruction at a time and checks your screenshots. The dashboard's labels may differ slightly from the names below: send a screenshot when one does not match.

### Keys and settings (checked by names only, on 2026-10-31)

| file | has now | this step adds |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY` | nothing |
| `supabase/functions/.env.local` | `CLERK_ISSUER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE`, `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_WEBHOOK_SIGNING_SECRET`, `CLERK_SECRET_KEY` | nothing |

Realtime uses the Supabase address and publishable key the app already has, and the Clerk session token it already sends. No Edge Function changes, so there is no `secrets set` and no deploy in this step.

### A. The order of work

1. **Before the implementation (you, about 3 minutes):** B below.
2. The implementer writes the migration and proves it offline (section 6, Part A, first half).
3. **At the deploy gate (you):** apply the migration, run the two self-tests and download the types (C). The implementer asks first. The app code needs the downloaded types (the new function must be in `src/types/supabase.ts` before the app can call it), so the gate comes **in the middle** of the work this time.
4. The implementer builds the app side and proves it (Part A, second half).
5. The implementer asks whether to start the phone walk-through (E).

### B. Before the implementation (the Realtime settings)

1. In the Supabase dashboard open your `gracehush` project, then **Realtime** in the left column, then **Settings** (in some layouts it is **Project Settings**, then **Realtime**). Check that **Enable Realtime service** is on. Change nothing yet.
2. On the same page, turn **Allow public access to channels** **off**, then press **Save**. (Supabase says every Realtime setting change disconnects the connected clients once: nothing uses Realtime yet, so nothing notices.)
3. Send a screenshot of the page, then tell the implementer "done".

### C. At the deploy gate: the migration, the self-tests and the types (you, in the browser)

1. In VS Code open `supabase/migrations/20261031120000_realtime_broadcast.sql` (written by the implementer). Press **Ctrl+A**, then **Ctrl+C**. In the Supabase dashboard open **SQL Editor**, press **+** for a new query, paste and press **Run**. Expect **Success. No rows returned.** (If a dialog warns about destructive operations, it is the `drop … if exists` lines: run it.)
2. Open `supabase/tests/rls_selftest.sql`, copy it all into a **new** query, and at the very end add a blank line and:
   `select count(*) as checks, count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed, count(*) filter (where passed is null) as skipped from rls_results;`
   Press **Run** (answer **Run without RLS** if a dialog appears). Expect the counts the implementer gives you (64 checks, 0 failed). Two or three checks may say **skipped** today: they need a message row, and the day's message table appears only once a phone has connected to Realtime that day. The walk-through runs this again after the phone connects (B2), and then nothing is skipped. Send a screenshot.
3. Run `supabase/selftest.sql` the same way, with this line at the end instead: `select count(*) as checks, count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from selftest_results;` Expect 11, 11, 0.
4. **Download the types:** **Integrations**, **Data API**, **Docs**, then **Tables and Views**, **Introduction**, and the button **Generate and download types**. Save the file over `src/types/supabase.ts` (replace everything in it). Tell the implementer "done": it checks that the only change is the new function under `Functions`.

### D. No Edge Function deploy

No function changes in this step, and no secret is added.

### E. Phone walk-through (iPhone, Expo Go)

The checks are at the end of section 6 (Part B). Before B0, restart the dev server with `npx expo start -c` (new files), then force-quit and reopen Expo Go. You will run short SQL statements the implementer writes for you; each changes or creates one test row and puts it back.

### F. If something goes wrong: what it means

| what you see | what it means |
| --- | --- |
| The developer panel says `realtime: connecting` and never `live` | Realtime is off for the project (B1), or the phone has no connection. |
| `realtime: offline` with the reason `Unauthorized` or "You do not have permissions to read from this Channel topic" | The policy is missing (C1 not run) or the token is not the account's (sign out and in again). |
| `PrivateOnly` | The app joined a public channel: a bug, because it always asks for a private one. |
| `live`, but a change in the SQL editor does not reach the phone | The change was to another account's row, or (rarely) no message table exists for today yet: close and reopen the app once, then try again. |
| The chip shows a number the SQL count does not match | Compare in the same time zone: the server counts in the profile's zone, which the profile sync keeps equal to the phone's. |

---

## Decisions (approved with this prompt by your "Implement it.")

1. **No new package and no native change.** Realtime comes with the installed `@supabase/supabase-js` 2.118.0 (`@supabase/realtime-js` 2.118.0). `package.json`, the lockfile and `app.json` are untouched, and it runs in Expo Go.
2. **Broadcast from the database, not Postgres Changes.** One private channel per account, topic `user:{userId}` (the Clerk user id), and two events: `entry_changed` with `{ id, op, status, updated_at }` (`op` is `INSERT`, `UPDATE` or `DELETE`) and `affirmations_changed` with `{ entry_id }`. Payloads carry ids, an operation, a status and a time, and nothing a person wrote or the app made from it: no transcript, title, verse, note, summary, emotion, headline or crisis flag.
3. **Triggers:** after insert, update or delete on `journal_entries`, and after insert or update on `daily_affirmations` (an entry's delete already removes its affirmations from the phone, so their own delete sends nothing). Each sends one message per row through `realtime.send` inside its own exception block, so a broadcast that cannot be sent never fails the write; the warning names no value. The two functions are `security definer` with `search_path = ''`, and no app role may execute them.
4. **Authorization:** one `select` policy on `realtime.messages` for `authenticated`: the topic is `'user:' || requesting_user_id()` and the extension is `broadcast`. No insert policy: the phone never sends on these channels.
5. **"Allow public access to channels" off** (your step B2), so only private, policy-checked channels exist on the project.
6. **The streak on the server:** `public.reflection_streak_days(tz text) returns integer`, the run of consecutive days ending today or yesterday in `tz` with a ready, non-crisis entry (the client's rule, finding 8); `security invoker`, `stable`, `search_path = ''`; an unknown zone raises `22023`; execute revoked from `public` and `anon`, granted to `authenticated`.
7. **The streak in the app:** Journal Home asks for it after its first page has loaded (on focus, on returning to the app, on pull-to-refresh) and after a reflection finishes. Until it answers, offline, with the mock data and on any error, the chip shows the client count from what the phone holds (the read cache keeps up to 200 entries). The server's number is kept in memory for the signed-in account and the day it was computed; no local schema change (no SQLite `meta` table: it would save one number at a cold start offline).
8. **The Realtime service** (`src/services/realtime.ts`) runs only while: someone is signed in, the data source is the real one, the user's database is open, the app is in front, and NetInfo says the phone can send (the sync engine's `selectCanSend`). It stops when any of these ends (background, offline, sign-out) and starts again when they all hold. It awaits `client.realtime.setAuth()` and then subscribes. On `CHANNEL_ERROR` or `TIMED_OUT`, or a `CLOSED` it did not ask for, it removes the channel and tries again with the step 24 backoff (`retryDelayMs`: 5 s, 15 s, 60 s, 5 min, 15 min, then 1 h, with jitter) while the app is in front; `SUBSCRIBED` resets the backoff. A generation counter, as the sync engine has, drops anything that lands after a stop.
9. **Reactions** (`src/services/realtimeHandlers.ts`):
   - `entry_changed` `DELETE`: when the phone holds that entry (the read cache or the loaded player), `forgetEntry` then `forgetOnThisPhone` (step 29b); otherwise nothing, so this phone's own delete coming back is a no-op.
   - `INSERT` or `UPDATE`: skipped when the cached entry's `updatedAt` is the same or newer than the message's (both in the step 25 canonical form), or when the cached entry belongs to an outbox item that is being sent (the sync engine writes the answer itself). Otherwise, after 300 ms of quiet for that id, one `fetchEntry(id)` (the network, this phone's waiting prayer changes on top, written to the cache); at most one read per id at a time, and a message that arrives during one schedules one more. An entry the server no longer has is handled as a DELETE.
   - A fetched entry that is finished (ready, or a crisis entry): when it is not a crisis, its affirmations are read too (`fetchAffirmations`); then `requestAffirmationReschedule()`. When its client entry id belongs to a **queued** outbox item (this phone gave up waiting for it), that item is made due now and the engine is woken (`syncNow("realtime")`): the server answers the finished row with no model call, and the waiting card turns into the reflection.
   - `affirmations_changed`: after 300 ms of quiet for that entry, `fetchAffirmations(entryId)`, then `requestAffirmationReschedule()`.
   - Each reaction ends with an app event the screens follow (decision 10). A payload that does not have the contract's shape is ignored (`realtime_bad_payload` in development only).
10. **Screens:**
    - **Reflection** reads the entry and its affirmations again from the phone when its entry changes, shows "This reflection couldn’t be found." when its entry is deleted, and polls every 5 s (step 25) **only while Realtime is not live**.
    - **Journal Home** merges a changed entry into its list (`mergeEntries`; a new listed entry adds one to the known total), reads the newest reflection's affirmations again from the phone on either event, and asks for the streak again when an entry finished.
    - **Prayers** reads its list again from the phone on an entry event.
    - All three reload as on focus after a `resync` event: the channel came back after dropping while the app stayed in front.
11. **Sign-out and deletion:** `signOutCleanup()` awaits `stopRealtime()` first, before the database and the token go. `deleteAccount()` stops Realtime before its request, with the engine and the plan watch, and starts it again when the deletion fails.
12. **Developer panel** (`__DEV__` only): a "Realtime (dev)" group with the status (`live`, `connecting` or `offline`), the events received since launch and the reconnects; a **Force polling (dev)** switch that keeps Realtime stopped (so the step 25 polling can be watched); and **Open newest preparing (dev)**, which opens Reflection on the newest entry the phone holds that a server is still preparing, read from the cache at the moment of the tap (a preparing card on Journal does not open, and the panel's "Open reflection" row is read when the panel loads, so it would miss a row made a moment ago). Never a payload, a topic or an id.
13. **Logs:** development only, `[realtime] <status>` and `[realtime] realtime_bad_payload`. Never a payload, a topic, a token or an id.
14. **One new `SyncReason`, `"realtime"`**, and one new outbox function, `makeDue(clientEntryId, now)`, which moves only a `queued` item's next attempt to now.
15. **Not used:** Broadcast Replay (finding 5: the screens reload from the server on focus and on `resync`, which covers what was missed), a mini player or any new screen element, Realtime while the app is in the background (iOS closes the socket), and messages about the profile or the plan (they keep following the profile sync).

---

## Out of scope

- Realtime in the background or after the app is closed (iOS ends the socket; the screens catch up when the app returns).
- Sending anything from the phone on a channel, presence ("online now"), or a channel shared between accounts.
- Broadcast Replay.
- Profile and plan changes through Realtime (the profile sync of steps 17 and 30 covers them).
- Showing the server's week count of devotionals on Profile (a known limit of step 29b, unchanged).

---

## 0. Before you write code

1. **Baseline, written down before any change** (the numbers after step 32, 2026-10-31; record what you see):
   - `npm run typecheck` and `npm run lint` exit 0; the app-side suites: account 10, billing 24, offline 44 of 44, journal-data 87, notifications 48, prayers 33, deletion 32, profile-sync 88, recording 68, playback 133, ambient 64, parity 7 of 7.
   - Deno (the commands in AGENTS.md, Linting and Validation): the main run 512 tests and export-data's 23, lint 110 files, fmt 127 files. This step changes no function, so these stay as they are.
   - PGlite: 56 of 56 and 31 broken variants caught.
   - The release gate prints 4 lines.
2. **The five markers** of finding 2, each closed here or explained in the report.
3. **Section B is done:** without the user's "done" and screenshot, stop and ask. Write no code before that. **Never search a folder that holds a `.env.local` with a plain `grep`** (search `git ls-files`, or exclude the file), so no secret ever reaches a log.
4. **Red first:** write the new checks (section 6) before the code, run them against the tree as it is, and write down the red numbers.

---

## 1. The migration: `supabase/migrations/20261031120000_realtime_broadcast.sql` (new)

Additive and idempotent, like the others. Prove it in PGlite (section 2) before the deploy gate. If PGlite or the hosted self-test disagrees with this text, fix the SQL and say so in the report.

### 1.1 The entry trigger

```sql
create or replace function public.broadcast_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  begin
    perform realtime.send(
      payload => jsonb_build_object(
        'id', r.id, 'op', tg_op, 'status', r.processing_status, 'updated_at', r.updated_at),
      event => 'entry_changed',
      topic => 'user:' || r.user_id,
      private => true);
  exception when others then
    -- A broadcast that cannot be sent (no message table for today yet, Realtime off) never fails the write.
    raise warning 'broadcast_entry_change: not sent';
  end;
  return null;
end;
$$;

revoke all on function public.broadcast_entry_change() from public, anon, authenticated;

drop trigger if exists journal_entries_broadcast on public.journal_entries;
create trigger journal_entries_broadcast
  after insert or update or delete on public.journal_entries
  for each row execute function public.broadcast_entry_change();
```

### 1.2 The affirmations trigger

```sql
create or replace function public.broadcast_affirmations_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      payload => jsonb_build_object('entry_id', new.entry_id),
      event => 'affirmations_changed',
      topic => 'user:' || new.user_id,
      private => true);
  exception when others then
    raise warning 'broadcast_affirmations_change: not sent';
  end;
  return null;
end;
$$;

revoke all on function public.broadcast_affirmations_change() from public, anon, authenticated;

drop trigger if exists daily_affirmations_broadcast on public.daily_affirmations;
create trigger daily_affirmations_broadcast
  after insert or update on public.daily_affirmations
  for each row execute function public.broadcast_affirmations_change();
```

### 1.3 Who may receive

```sql
drop policy if exists user_broadcast_select_own on realtime.messages;
create policy user_broadcast_select_own on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) = 'user:' || (select public.requesting_user_id())
    and realtime.messages.extension = 'broadcast'
  );
```

No insert policy. Never add `alter table realtime.messages …` (finding 5).

### 1.4 The streak

```sql
create or replace function public.reflection_streak_days(tz text)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  with days as (
    select distinct (e.created_at at time zone tz)::date as local_day
    from public.journal_entries e
    where e.user_id = (select public.requesting_user_id())
      and e.processing_status = 'ready'
      and not e.is_crisis
  ),
  anchor as (
    select case
      when exists (select 1 from days where local_day = (now() at time zone tz)::date)
        then (now() at time zone tz)::date
      when exists (select 1 from days where local_day = (now() at time zone tz)::date - 1)
        then (now() at time zone tz)::date - 1
    end as start_day
  ),
  ranked as (
    select d.local_day, a.start_day, (row_number() over (order by d.local_day desc))::int as n
    from days d cross join anchor a
    where d.local_day <= a.start_day
  )
  -- The CASE reads the zone even when there are no entries, so an unknown zone always raises (22023).
  select case
    when (now() at time zone tz) is null then null
    else (select count(*)::int from ranked where local_day = start_day - (n - 1))
  end;
$$;

revoke all on function public.reflection_streak_days(text) from public, anon;
grant execute on function public.reflection_streak_days(text) to authenticated;

notify pgrst, 'reload schema';
```

The run is the days that follow the anchor without a gap: in descending order, day `n` must equal the anchor minus `n - 1`, and once a day is missing no later row can match again. With no ready entry today or yesterday the anchor is null and the answer is 0.

---

## 2. Self-tests and the offline runner

### 2.1 `supabase/tests/run-in-pglite.mjs`

- **A stub of the `realtime` schema**, created before the migrations like the `auth` and `storage` stubs: `realtime.messages` (`id`, `topic`, `extension`, `event`, `payload jsonb`, `private`, `inserted_at`), row level security on, `select` and `insert` granted to `authenticated` (so the policy is what decides; the hosted project's own grants on that table were not read in the review, which is why check 62's live part looks at them first); `realtime.topic()` reading `current_setting('realtime.topic', true)`; and `realtime.send(payload, event, topic, private)` that inserts a `broadcast` row and **raises an exception when the setting `test.realtime_send_fails` is `on`** (the hosted function ignores that setting).
- The runner's "left behind" count includes `realtime.messages`.
- **Broken variants**, each failing exactly its check(s): the entry trigger without its exception block (59); `security invoker` on a broadcast function (58); a broadcast function without `search_path` (58); `execute` granted to `authenticated` on a broadcast function (58); the entry payload with `transcript` added (60); the affirmations payload with `headline` added (61); the policy `using (true)` (62); an insert policy for `authenticated` on `realtime.messages` (63); the streak as `count(distinct …)` of all days (64); the streak counting crisis entries (64); `execute` on the streak granted to `anon` (64); the entry trigger without `delete` (57); and "no message table today" (a trigger on the stub's `realtime.messages` that raises on insert): 59 must still pass and 60 to 62's live parts must report skipped, never failed.

### 2.2 `supabase/tests/rls_selftest.sql`: checks 57 to 64

Each in the file's existing form (inside its rolled-back block, nothing left behind):

57. The broadcast triggers exist: `journal_entries_broadcast` after insert, update and delete, `daily_affirmations_broadcast` after insert and update, both for each row (`pg_trigger`).
58. Both broadcast functions are `security definer`, have `search_path` set to an empty value, and `public`, `anon` and `authenticated` may not execute them (`pg_proc`, `has_function_privilege`).
59. An owner may still change their entry's prayer columns when a broadcast cannot be sent (the check sets `test.realtime_send_fails` to `on` for its own transaction).
60. An entry change writes exactly one private `entry_changed` message on `user:<owner>` whose payload keys are exactly `id`, `op`, `status` and `updated_at`. **Skipped** (`passed` null) when a probe row cannot be inserted into `realtime.messages` today (no partition yet).
61. An affirmation change writes one private `affirmations_changed` message whose only key is `entry_id`. Skipped likewise.
62. The policy on `realtime.messages`: exactly one `select` policy for `authenticated` naming `realtime.topic`, `requesting_user_id` and `extension` (static, always); and, when a probe row can be inserted and `authenticated` holds `select` on the table (`has_table_privilege`; skipped otherwise, with the reason in the check's name), user A with `realtime.topic` set to `user:A` sees A's broadcast, with `user:B` sees nothing, and never sees a `presence` row.
63. No policy on `realtime.messages` lets `anon` or `authenticated` insert, update or delete.
64. The streak, as user A in a fixed zone: entries today, yesterday and three days ago give 2; B's entries change nothing; a day with only a crisis entry, or only a failed or processing one, breaks the run; no entry today or yesterday gives 0; an unknown zone raises; `anon` may not execute it.

The total becomes **64**. `supabase/tests/preflight.sql` gains a 15th row: the two triggers, the policy and the streak function exist.

---

## 3. The message contract: `src/types/index.ts`

```ts
export type EntryChangedMessage = {
  id: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  status: ProcessingStatus | null;
  updated_at: string | null;
};
export type AffirmationsChangedMessage = { entry_id: string };
export type RealtimeStatus = "connecting" | "live" | "offline";
```

The type guards live in `src/services/realtime.ts` and read only these keys. `updated_at` is turned into the step 25 canonical form (`normalizeTimestamp`) before it is compared.

---

## 4. The app

### 4.1 `src/store/realtimeStore.ts` (new, not persisted)

`status: RealtimeStatus` (`offline` until started), `events: number` (received since launch), `reconnects: number`, `forcePolling: boolean` (development only), with setters; `selectRealtimeLive(state)` is true only when `status === "live"`.

### 4.2 `src/services/realtime.ts` (new)

- `startRealtime(userId: string): void` (idempotent), `stopRealtime(): Promise<void>`, `subscribeRealtime(listener: (event: RealtimeEvent) => void): () => void` and `isRealtimeLive(): boolean`, where `RealtimeEvent` is `{ type: "entry"; entryId: string; op: "INSERT" | "UPDATE" | "DELETE" } | { type: "affirmations"; entryId: string } | { type: "resync" }`.
- The channel: `client.channel(\`user:${userId}\`, { config: { private: true } })` with `.on("broadcast", { event: "entry_changed" }, …)` and `.on("broadcast", { event: "affirmations_changed" }, …)`, subscribed after `await client.realtime.setAuth()` (finding 3). The callback's message is `{ type, event, payload }`: only `payload` is read.
- The conditions of decision 8, watched through `AppState`, the offline store (`selectCanSend`, `dbReady`), `getDataSource()` and the realtime store's `forcePolling`.
- `stopRealtime()`: the generation moves on, the retry timer is cleared, the channel is removed (`client.removeChannel`) and the socket is closed (`client.realtime.disconnect()`); the status becomes `offline`. Errors are ignored.
- The `resync` event is emitted on a `SUBSCRIBED` that follows a drop while the app stayed in front (not on the first one of a session, and not after a return to the front: the screens reload by themselves then).

### 4.3 `src/services/realtimeHandlers.ts` (new)

The reactions of decision 9, on the live data layer (`readCachedEntry`, `fetchEntry`, `fetchAffirmations`, `forgetEntry` in `src/data/entriesLive.ts`, through `src/data/journalRepository.ts` where it already exposes them), `forgetOnThisPhone` (`src/services/entryDeletion.ts`), `requestAffirmationReschedule`, the outbox (`get`, the new `makeDue`) and `syncNow("realtime")`. The 300 ms quiet time is `REALTIME_COALESCE_MS` in `src/constants/app.ts`. It writes nothing and emits nothing once its generation has moved on.

### 4.4 The streak: `src/data/entriesRemote.ts` and `src/data/journalRepository.ts`

- `selectReflectionStreak(tz)` in `entriesRemote.ts` (it reads `journal_entries`, so it lives with the other queries): `supabase.rpc("reflection_streak_days", { tz })`, answering a `RepoResult<number>` and logging only the code in development.
- `getReflectionStreak(tz)` in the repository: `null` for the mock data source; otherwise the server's answer, kept in memory for the signed-in account and the local day; a failed call answers the number kept from earlier the same day, or `null`. The hook shows the client count when it gets `null`.

### 4.5 Hooks

- `src/hooks/useReflection.ts`: the interval loads again only when `preparing.current` and Realtime is not live (`isRealtimeLive()`, which is false while Force polling is on); an `entry` event for this entry, or a `resync`, reads it again (from the phone for `entry`, the whole `load()` for `resync`); the sync engine's `deleted` event for this entry shows the not-found state. Close the `TODO(33)` in the comment.
- `src/hooks/useJournalHome.ts`: on an `entry` event, read the entry from the phone and merge it into the list (`mergeEntries`; a listed entry that was not there adds one to `total` when it is known; one that is no longer listed, such as a failed entry, leaves the list), and read the newest reflection's affirmations again from the phone; on `affirmations`, the latter; on `resync`, `load()`. The ready state's `reflectionDays` is the server's number when `getReflectionStreak` gave one, else `getReflectionDays(entries, now)`. Close the `TODO(33)`.
- `src/hooks/usePrayers.ts`: on an `entry` event, `reloadFromPhone()`; on `resync`, the focus refresh. Close the `TODO(33)`.

### 4.6 Wiring

- `src/components/SupabaseAuthBridge.tsx`: `startRealtime(signedInUserId)` in the sign-in effect (it waits for its own conditions), `void stopRealtime()` in that effect's cleanup.
- `src/services/account.ts`: `await stopRealtime()` as the first line of `signOutCleanup()` (close the `TODO(33)`); in `deleteAccount()`, `await stopRealtime()` before the request and `startRealtime(userId)` again on a failure.
- `src/services/entryDeletion.ts`: the comment says the DELETE handler calls `forgetOnThisPhone` (close the `TODO(33)`).
- `src/services/syncEngine.ts`: `SyncReason` gains `"realtime"`. `src/db/outbox.ts`: `makeDue(clientEntryId, now)`.
- `src/components/dev/DevToolsPanel.tsx`: the "Realtime (dev)" group of decision 12, beside the Supabase check.

### 4.7 Docs

`docs/legal-brief.md`: one line where the server's processing is described: the database sends a short message about a changed reflection to the person's own private channel, holding only ids, a status and a time, kept by Supabase for 3 to 4 days; nothing a person wrote. `docs/privacy-policy.md` needs no change unless it lists Supabase's processing in detail (check, and add the same sentence if it does).

---

## 5. Privacy and safety

- No message carries content (decision 2), and the policy lets only the account's owner receive its messages; the phone can send none.
- A crisis entry is handled like any other: its message says only that it changed; the phone reads it through the repository and shows the crisis view, never a devotional. No log line, event name or developer line says "crisis".
- Nothing is logged but a status, an error code and counts (decision 13).
- Signing out stops Realtime before the database and the token go (decision 11).

---

## 6. Verification

### Part A: automated (offline)

**First half, before the deploy gate:**

1. PGlite (AGENTS.md, Verifying on this machine): every migration twice under both settings of "Automatically expose new tables", `selftest.sql` 11 of 11 and `rls_selftest.sql` 64 of 64 twice each, nothing left behind, 15 preflight rows, and every broken variant (the 31 old ones and the new ones of section 2.1) caught, each failing exactly its check(s).
2. Then ask for the deploy gate (C). After the download, `git diff src/types/supabase.ts` must show only additions under `public.Functions`: `reflection_streak_days: { Args: { tz: string }; Returns: number }`, and possibly the two trigger functions (the app never calls them). Anything else that changed is reported before the app code is written.

**Second half, after the gate:**

3. `npm run typecheck` and `npm run lint` exit 0.
4. **A new suite, `supabase/tests/realtime/`** (`node --no-warnings supabase/tests/realtime/run.cjs`), on the journal-data world. It fakes the channel on the real client (`channel`, `removeChannel`, `realtime.setAuth`, `realtime.disconnect`), and proves at least:
   - the guards: a valid message passes, a malformed one is ignored with the development line only;
   - start and stop: `setAuth` is awaited before `subscribe`, one private channel `user:{userId}` with the two events, idempotent; background, offline, sign-out, the mock data source and Force polling stop it (status `offline`), and the return of each condition starts it; `CHANNEL_ERROR` and `TIMED_OUT` retry with the step 24 backoff and `SUBSCRIBED` resets it; nothing lands after a stop;
   - the handler: an UPDATE not newer than the cache reads nothing; three quick messages for one id read once; a message during a read reads once more; the read keeps this phone's waiting prayer change on top; a DELETE of a cached entry calls `forgetEntry` and `forgetOnThisPhone` once, and a second one nothing; an entry the server no longer has is a DELETE; a finished non-crisis entry reads its affirmations, then plans the notifications; a crisis entry plans them without reading affirmations; an entry being sent by the engine is skipped; a queued outbox item whose entry finished is made due and the engine woken; `affirmations_changed` reads the affirmations and plans the notifications;
   - the screens: Reflection reads its entry again on an event, polls only while not live, and shows not-found after a delete; Journal merges an inserted, an updated and a no-longer-listed entry, adjusts the total, re-reads the affirmations, and shows the server's streak or the client count; Prayers reads again on an event; `resync` reloads all three;
   - sign-out stops Realtime before the database goes; a deletion stops it before its request and starts it again on a failure;
   - **one check on the real `@supabase/realtime-js`** with a fake `WebSocket`: the join frame for `realtime:user:{userId}` carries `private: true` and the account's token, and a new token from the callback is pushed as `access_token` after a heartbeat (read the frame format in `node_modules/@supabase/realtime-js/src/lib/serializer.ts`);
   - the development log holds no id, topic, token or payload.
5. **The older suites:** `account.ts` and the bridge import the new service, so the suites that load them (profile-sync, offline, account, journal-data, deletion, billing) fake `@/services/realtime` where they cannot load it, and keep their counts; journal-data and prayers keep theirs.
6. Red first: the new suite against the tree before the code, with its failures by kind.
7. **Breakages** in a scratch copy, never the repo (the user's dev server would send a broken file to the phone), each caught by a named check: no `setAuth` before `subscribe`; a public channel; no `updated_at` comparison; no coalescing; no follow-up read after a message during a read; `upsertEntry` without the waiting changes on top; a DELETE that always calls `forgetOnThisPhone`; no affirmations read before planning; the engine not woken for a queued item; polling while live; `stopRealtime` without `disconnect`; `signOutCleanup` stopping Realtime last; a payload logged in development.
8. `npx expo export` for Android and iOS (one at a time, outside the repo) exit 0, or, when memory is short, the dev bundles from the running server; grep for `realtime_broadcast` (absent: it is SQL), `user_broadcast` (absent), `"entry_changed"` (present) and the "Realtime (dev)" string (present only with `--dev`).
9. The release gate still prints 4 lines; the `TODO(33)` markers are gone (`git grep -n "TODO(33)"` finds none in `src`).

### Part B: the phone walk-through (iPhone, Expo Go)

Before B0: restart the dev server with `npx expo start -c` (new files), then force-quit and reopen Expo Go. The account is the test account on the phone now (signed in, the real data source, with at least one ready reflection that is not a prayer, and one prayer); a second test account (for example `gracehush29+clerk_test@example.com`, code 424242) is used in B11. It costs nothing new: every remote change is one SQL statement the implementer writes, each naming a row by the first 8 characters of its id (which the implementer reads from the app and gives you), and each is put back. Keep Expo Go open and in front for the whole run: iOS pauses the app when Expo Go is in the background or the phone is locked, and nothing can be read then (B8 leaves the app on purpose).

- **B0.** Do: open the app on Journal. Expect: signed in, data source `supabase`, online, the database open, at least one ready non-crisis reflection and one prayer. Read: the offline and dev stores and the repository's cached entries (counts and short ids).
- **B1.** Do: nothing (wait 5 seconds). Expect: Realtime `live`, 0 reconnects. Read: the realtime store.
- **B2.** Do: run `rls_selftest.sql` again with the summary line of C2. Expect: 64 checks, 64 passed, 0 failed, **0 skipped** (the phone's connection made today's message table). Read: your screenshot.
- **B3.** Do: open a ready reflection that is not a prayer (the implementer names it), then run `update public.journal_entries set is_active_prayer = true where id::text like '<id8>%';`. Expect: within about 2 seconds, without touching the phone, the **Mark as Prayer Request** switch is on, and one event more. Read: the realtime store's event count, the cached entry's prayer flag, the switch's value (the rendered tree, a boolean). Then run the same with `false`: the switch goes off.
- **B4.** Do: open **Prayers**, then run `update public.journal_entries set is_answered = true, answered_at = date_trunc('day', now(), 'UTC') + interval '12 hours' where id::text like '<prayer id8>%';`. Expect: the prayer moves to Answered within about 2 seconds (the Active and Answered counts change). Read: the counts in the rendered tree, the cached entry. Then put it back: `update public.journal_entries set is_answered = false, answered_at = null where id::text like '<prayer id8>%';`.
- **B5.** Do: open **Journal**, then run `insert into public.journal_entries (user_id, client_entry_id, input_type, processing_status) select user_id, gen_random_uuid(), 'text', 'processing' from public.journal_entries where id::text like '<id8>%' limit 1 returning left(id::text, 8) as test_id;` and send the `test_id`. Expect: a "Preparing your devotional…" card at the top within about 2 seconds, the count one higher. Read: the cached entry for the test id, the list in the rendered tree.
- **B6.** Do: on Profile, in the developer panel's "Realtime (dev)" group, tap **Open newest preparing (dev)** (it opens the test row's Reflection: "Your devotional is still being prepared."); go back to Profile, turn on **Force polling (dev)**, tap **Open newest preparing (dev)** again, and run `update public.journal_entries set processing_status = 'failed', error_code = 'AI_UNAVAILABLE' where id::text like '<test id>%';`. Expect: within 5 seconds "We couldn’t finish this reflection." shows (the step 25 polling), and Realtime is `offline` with no event received. Read: the realtime store, the Reflection state.
- **B7.** Do: turn **Force polling (dev)** off, run `update public.journal_entries set processing_status = 'processing', error_code = null where id::text like '<test id>%';`, wait for "Your devotional is still being prepared.", then run `delete from public.journal_entries where id::text like '<test id>%' and processing_status = 'processing' and devotional_script is null;`. Expect: within about 2 seconds "This reflection couldn’t be found." and, back on Journal, no test card and the count as before B5. Read: the Reflection state, the cache (no test entry), the list.
- **B8.** Do: press the Home button, wait 2 minutes, run the B3 update with `true` on another reflection, then reopen Expo Go and go to that reflection (or Journal). Expect: the change shows; Realtime was `offline` while away and is `live` again. Read: the realtime store, the cached entry. Put it back with `false`.
- **B9.** Do: leave the app open on Journal for 5 minutes without touching it, then run the B3 update (`true`, then `false`). Expect: both arrive within about 2 seconds, Realtime stayed `live` with 0 reconnects (the token was refreshed by the heartbeat; an expired token would have closed the channel). Read: the realtime store.
- **B10.** Do: nothing. Expect: the chip's number equals what the server function answers and, when the cache covers the run, the client count. Read: the app's own `getReflectionStreak(profile.timezone)` and `getReflectionDays` over the cache, and the chip's text in the rendered tree (numbers only).
- **B11.** Do: sign out, then sign in as the second test account; then run the B3 update (`true`, then `false`) on the **first** account's reflection. Expect: after sign-out Realtime is `offline`; signed in as the second account it is `live`, and no event arrives in 10 seconds. Read: the realtime store before and after. Then sign back in as the first account.
- **B12.** Do: run `select event, private, array(select jsonb_object_keys(payload) order by 1) as payload_keys, inserted_at from realtime.messages order by inserted_at desc limit 10;` and send a screenshot. Expect: only `entry_changed` and `affirmations_changed`, `private` true, keys `id, op, status, updated_at` or `entry_id`. Read: your screenshot.

**Not part of this walk-through, and why:** two physical phones (you have one; the SQL editor stands in for the other); Android; VoiceOver; Realtime with the app in the background (it is off by design); a reflection made by the model on another phone (it would cost a Gemini and Text-to-Speech call: B5 to B7 show the same insert, update and delete path at no cost).

---

## 7. AGENTS.md updates

- A new section **Realtime Rules (step 33)** after Journal Data Rules: Broadcast from the database, not Postgres Changes; one private channel `user:{userId}`; the two events and their payloads (ids, an operation, a status and a time only); the triggers never fail a write; the `realtime.messages` policy and no sending from the phone; "Allow public access to channels" off; connected only while signed in, on the real data source, with the database open, in front and online; `setAuth` before every subscribe, no token timer (the heartbeat refreshes it); the step 24 backoff for a dropped channel and `resync` after it; the reactions of decision 9 (skip what is not newer, one read per id, waiting changes on top, finished entries read their affirmations before the notifications are planned, a queued outbox item is made due); polling only while not live; stopped first at sign-out and before an account deletion; the logs.
- **Journal Data Rules:** the Reflection bullet's "(`TODO(33)`: Realtime)" becomes "only while Realtime is not live (Realtime Rules)"; the streak is the server's `reflection_streak_days` with the client count as the fallback.
- **Prayer Rules:** "Last change wins per field … (a known limit until Realtime, step 33)" says instead that Realtime shows the winner on the other phone within seconds and does not change the rule.
- **Database Rules:** the new migration in the list of migrations (the two triggers, the policy, the streak function, `notify pgrst`), the 64 checks, the 15 preflight rows and the new broken variants; and that `realtime.messages` is managed only through its policies (never `alter table`).
- **The tree:** `src/services/realtime.ts`, `src/services/realtimeHandlers.ts`, `src/store/realtimeStore.ts`, `supabase/tests/realtime/`, the migration; `entryDeletion.ts`'s line loses its `TODO(33)`; `SyncReason` has `"realtime"`; the outbox has `makeDue`.
- **The developer panel** line under Navigation Map gains the "Realtime (dev)" group.
- **Tech Stack:** the `@supabase/supabase-js` line says Realtime is used since step 33 (Broadcast, private channels).
- **Linting and Validation:** the new suite's command, with what it fakes.
- **Build Status & Decisions Log:** a "Step 33 — Realtime" entry in the form of the ones before it (decisions, files, differences from this prompt, measured results, breakages, the walk-through line by line, known limits). Then copy AGENTS.md to `prompts/AGENTS.md`.

Known limits to record: a change made while the app is in the background reaches the screen when the app returns (the screens reload then); messages sent before the day's first connection are not kept (nobody was connected to receive them, and the screens load from the server when they open); two phones changing one prayer still end with the later change per field (step 29).

---

## 8. Report

Lead with what changed and where, then how to test it. Include: the five `TODO(33)` markers and how each was closed; the supabase-js Realtime facts confirmed in the code (finding 3) and any that differed; the migration as applied and the hosted self-test's numbers (before and after the phone connected); the files created, changed and deleted; the test counts before and after, the red numbers and the breakages caught; the walk-through B0 to B12, one line each; what could not be checked and where it can be; and the notes for later steps:

- **34 (analytics):** no event for Realtime, and never an id, a topic or a status of a crisis entry.
- **35 (development builds):** nothing new for Realtime (it stays foreground-only). When the production Clerk instance is added as a Third-Party Auth provider (as in step 17), Realtime accepts its tokens through the same setting.

End with the one line from AGENTS.md, "Guided phone walk-through": "Automated checks pass. Shall I start the guided walk-through now (B0 to B12)? Keep Expo Go open on the iPhone, in front and connected to the dev server."
