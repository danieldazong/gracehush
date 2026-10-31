-- Gracehush: Realtime messages from the database, and the run of reflection days (step 33).
--
-- When a reflection, a prayer or an affirmation changes on the server (another phone, the server finishing a reflection, a change
-- made in the dashboard), the database sends a short message to its owner's private channel, topic user:{userId}, and the app
-- reads the row again through its own queries. A message holds ids, an operation, a status and a time: never anything a person
-- wrote or the app made from it. Broadcast from the database is used, not Postgres Changes, which would send whole rows.
--
-- realtime.send inserts the message into realtime.messages, which Supabase partitions by day; a client that connects makes the
-- day's table, so on a day nobody has connected the insert fails. realtime.send turns that into a warning, and each trigger below
-- catches any other error too, so a message that cannot be sent never fails the write that fired it. realtime.send also adds an
-- id to a payload that has none, so the affirmations message carries the affirmation's own id. The realtime schema is Supabase's:
-- this file adds one policy to realtime.messages and changes nothing else there (row level security is already on, and only the
-- table's owner may alter it).
--
-- reflection_streak_days(tz) is Journal Home's "days of reflection": the run of consecutive days, ending today or yesterday in the
-- time zone tz, with a finished reflection that is not a crisis entry. It reads only the caller's own entries.
--
-- It is safe to run again, and it deletes no data.

-- 1. A changed entry: one message to its owner, { id, op, status, updated_at }.
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
    -- A message that cannot be sent (no message table for today yet, Realtime off) never fails the write.
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

-- 2. A new or changed affirmation: one message to its owner, { id, entry_id } (the affirmation's id, and its entry's). An entry's
--    delete removes its affirmations from the phone already, so their own delete sends nothing.
create or replace function public.broadcast_affirmations_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      payload => jsonb_build_object('id', new.id, 'entry_id', new.entry_id),
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

-- 3. Who may receive: a signed-in user may join their own topic, for broadcast messages only. Realtime checks a private channel's
--    join against this policy (realtime.topic() is the channel's topic). There is no insert policy: the phone never sends.
drop policy if exists user_broadcast_select_own on realtime.messages;
create policy user_broadcast_select_own on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) = 'user:' || (select public.requesting_user_id())
    and realtime.messages.extension = 'broadcast'
  );

-- 4. The run of reflection days, as Journal Home counts it (getReflectionDays): consecutive local days in tz, ending today or
--    yesterday, each with a finished entry that is not a crisis entry. 0 when there is none today or yesterday. An unknown zone
--    raises 22023.
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
