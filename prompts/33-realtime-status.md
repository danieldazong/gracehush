# 33-realtime-status.md

Read AGENTS.md first and follow it strictly.

Replace the step 25 polling with Supabase Realtime. Database triggers
broadcast a tiny "entry changed" message to a private per-user channel;
the app reacts by refetching through journalRepository, so Reflection,
Journal Home and Prayers update immediately and across devices. Add a
server-side reflection-days count. Keep polling only as a fallback.
Screens keep their exact look.

AGENTS.md requires approval before migrations, RLS changes and
dependencies. No new dependencies (Realtime ships with
@supabase/supabase-js).

Docs (source of truth, follow exactly):

- https://supabase.com/docs/guides/realtime/broadcast
  (Broadcast from the database, realtime.send, realtime.broadcast_changes,
  private channels, daily partitions, the WarnSendingBroadcastMessage
  note)
- https://supabase.com/docs/guides/realtime/authorization
  (RLS on realtime.messages, realtime.topic(), extension)
- https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- https://supabase.com/docs/reference/javascript/subscribe
- https://supabase.com/docs/guides/realtime/postgres-changes
  (for the comparison only)

---

## 1. Before writing code

1. Read src/lib/supabase.ts and SupabaseAuthBridge.tsx (step 17),
   src/hooks/useReflection.ts (polling // TODO(33)),
   src/hooks/useJournalHome.ts (reflection days // TODO(33)),
   src/hooks/usePrayers.ts and src/db/mutations.ts (step 29 // TODO(33)),
   src/data/journalRepository.ts, src/db/cache.ts,
   src/services/syncEngine.ts, src/services/connectivity.ts,
   src/services/account.ts and supabase/migrations/.
2. List every // TODO(33) with file:line. Each is closed here or
   explained in the report.
3. Confirm in the installed supabase-js version: channel(name,
   { config: { private: true } }), on('broadcast', { event }, cb),
   subscribe(status cb) status values, removeChannel, and whether the
   accessToken option (step 17) also authorizes Realtime and refreshes
   it. Report what you find. If it doesn't refresh, use
   supabase.realtime.setAuth(token) as in section 4.
4. Confirm Realtime is enabled for the project (Dashboard → Realtime).
   Ask the user to check; never change project settings yourself.

---

## 2. Migration (approval gate)

Show the SQL and ask: "Add Realtime broadcast triggers, the
realtime.messages policy and the reflection-days function?" Only on yes
(step 18 process: local first, tests, second yes before pushing).

Broadcast trigger:
create or replace function public.broadcast_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
r record := coalesce(new, old);
begin
begin
perform realtime.send(
jsonb_build_object(
'id', r.id,
'op', tg_op,
'status', r.processing_status,
'updated_at', r.updated_at),
'entry_changed',
'user:' || r.user_id,
true); -- private
exception when others then
raise warning 'broadcast_entry_change failed';
end;
return null;
end;

$$
;

  create trigger journal_entries_broadcast
  after insert or update or delete on public.journal_entries
  for each row execute function public.broadcast_entry_change();

  -- affirmations: one message per change, same channel, event
-- 'affirmations_changed', payload { entry_id } only
(same pattern for public.daily_affirmations)

- Payloads carry ids, op, status and timestamps only. Never transcript,
titles, scripture, notes, summaries, emotions or is_crisis.
- Confirm the exact realtime.send argument order in the docs before
writing it.
- revoke execute on public.broadcast_entry_change from public, anon,
authenticated.

Realtime authorization:
create policy "user can receive own broadcasts"
  on realtime.messages for select to authenticated
  using (
    (select realtime.topic()) = 'user:' || (select public.requesting_user_id())
    and realtime.messages.extension in ('broadcast')
  );
- No insert policy: clients never send on this channel.

Reflection days:
create or replace function public.reflection_days_count(tz text)
returns integer
language sql
stable
security invoker
set search_path = ''
as
$$

    select count(distinct (created_at at time zone tz)::date)::int
    from public.journal_entries
    where user_id = (select public.requesting_user_id())
      and is_crisis = false
      and processing_status = 'ready';

$$
;
grant execute on function public.reflection_days_count(text)
  to authenticated;
- An invalid tz raises an error; the app passes the profile time zone
and falls back to the client count on error.

Tests (supabase/tests/rls_test.sql):
- user_a can't read realtime.messages for topic 'user:user_b'.
- reflection_days_count as user_a counts only user_a's rows; crisis
days excluded.
- An update to journal_entries still succeeds when realtime.send fails
(simulate by calling the trigger function with a bad topic in a test,
or document why the exception block covers it).
Regenerate types (`npm run types:db`).

---------------------------------------------------------------------
## 3. Message contract: src/types/index.ts

  type EntryChangedMessage = { id: string; op: 'INSERT' | 'UPDATE' |
  'DELETE'; status: ProcessingStatus | null; updated_at: string | null };
type AffirmationsChangedMessage = { entry_id: string };
Type guards in src/services/realtime.ts. Invalid payloads are ignored
(log "realtime_bad_payload" in __DEV__ only).

---------------------------------------------------------------------
## 4. Realtime service: src/services/realtime.ts

  startRealtime(userId: string): void   // idempotent
stopRealtime(): Promise<void>
subscribeEntryChanges(cb): unsubscribe
subscribeAffirmationChanges(cb): unsubscribe
getRealtimeStatus(): 'connecting' | 'live' | 'offline'

- One channel: supabase.channel(`user:${userId}`, { config: { private:
true } }), listening for 'entry_changed' and 'affirmations_changed'.
- Status: SUBSCRIBED → 'live'; CHANNEL_ERROR / TIMED_OUT / CLOSED →
'offline', retry with the step 24 backoff while the app is active.
- Auth: if section 1.3 found the accessToken option doesn't refresh
Realtime, call supabase.realtime.setAuth(await getToken()) before
subscribing and every 45 seconds while subscribed (Clerk tokens last
about 60 s). Clear the interval on stop.
- Lifecycle: start in SupabaseAuthBridge after sign-in and dbReady.
AppState background → stopRealtime. Foreground → startRealtime, then
a catch-up refresh (section 5). Online regained → same.
- A small non-persisted Zustand slice holds the status and a
monotonically increasing `lastEventAt` for hooks.
- Never log payloads, topics or user ids. Allowed: status changes,
event counts.

---------------------------------------------------------------------
## 5. Reactions (src/services/realtimeHandlers.ts)

entry_changed:
- DELETE → cache delete for the id (and its affirmations); notify
hooks.
- INSERT / UPDATE → if the cached entry's updated_at is the same or
newer, ignore. Otherwise journalRepository.getEntry(id) (network),
upsert cache, then re-apply pending mutations for that id (step 29
rule), then notify hooks.
- Coalesce: several messages for the same id within 300 ms → one fetch.
- If the id matches a pending outbox item's server_entry_id, let the
sync engine finish as usual; don't double-handle.

affirmations_changed:
- listAffirmationsForEntry(entry_id) from the network → cache → notify.
- Then rescheduleAffirmations('realtime') (step 28).

Catch-up refresh (foreground, reconnect): refetch Journal page 1 and
prayers once (existing repository calls). No replay.

---------------------------------------------------------------------
## 6. Hooks

useReflection:
- Subscribe to entry changes for this entryId; on a change, reload from
cache (the handler already fetched).
- Polling every 5 s (step 25) runs ONLY when realtime status isn't
'live'. Close the step 25 // TODO(33).
useJournalHome:
- Refresh from cache on any entry or affirmation change event.
- Reflection days: call supabase.rpc('reflection_days_count', { tz:
profile.timezone }) on load, pull-to-refresh and after an entry
becomes ready. Cache the number in SQLite meta
('stats.reflectionDays') for offline. Error → the existing client
selector count. Close the step 25 // TODO(33).
usePrayers:
- Refresh from cache on entry change events. Close the step 29
// TODO(33).

---------------------------------------------------------------------
## 7. Sign out

signOutCleanup: stopRealtime() first (before the database and token are
cleared).

---------------------------------------------------------------------
## 8. Dev tools (DevToolsPanel, __DEV__ only)

- "Realtime: live / connecting / offline" and the event count since
launch. No payloads.
- "Force polling" toggle (pretends realtime is offline) to test the
fallback.

---------------------------------------------------------------------
## 9. Rules

- No new dependencies, no `any`, no layout changes.
- Realtime payloads never contain content; data is always refetched
through journalRepository.
- Clients never send on user channels.
- Never log payloads, topics, tokens or ids.

---------------------------------------------------------------------
## 10. AGENTS.md updates

- Realtime Rules: Broadcast from the database (not Postgres Changes);
one private channel user:{userId}; RLS on realtime.messages; payloads
are ids, op, status and timestamps only; the app refetches through the
repository; connected only while the app is active; catch-up refresh
on foreground; polling fallback when not live; triggers never fail
the write.
- Stats: reflection days from reflection_days_count, cached for
offline.

---------------------------------------------------------------------
## 11. Verify (dev build, two physical phones signed into the same
## account, plus a second account)

Run `npx expo start -c`, `npm run lint`, `npm run typecheck`, then:
1. Submit an entry and close the Processing overlay early: Reflection
 switches to the ready devotional within about a second of the server
 finishing, with no polling (logs).
2. Phone B shows the new entry on Journal Home without a refresh.
3. Mark a prayer answered on phone A: phone B's Prayers updates.
4. Offline change waiting on phone B + a remote change to the same
 prayer: phone B keeps its waiting change until it syncs.
5. Delete the account's entry in SQL: it disappears from both phones.
6. The second account receives nothing (check the event count).
7. Background for 2 minutes, change an entry on the other phone, return:
 the catch-up refresh shows it.
8. Leave the app open for 5 minutes: still 'live' (token refresh works).
9. Force polling: Reflection still updates within 5 seconds.
10. Reflection days on Journal Home match a manual count in the user's
  time zone; crisis-only days aren't counted.
11. Inspect realtime.messages in the dashboard: no content, only ids,
  status and timestamps.
12. Sign out: the channel is removed (status offline).

Report: TODO(33) list and how each was closed; supabase-js Realtime auth
finding; migration decision; files created, changed and deleted; test
results 1–12; and any TODO for step 34.
$$
