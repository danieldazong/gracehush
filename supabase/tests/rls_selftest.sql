-- Gracehush v1 schema self-test (step 18). Run it AFTER supabase/migrations/20261022120100_gracehush_v1_schema.sql, in the
-- same SQL editor (or offline with supabase/tests/run-in-pglite.mjs).
--
-- It pretends to be three signed-in users, a signed-out visitor and the server (service_role). For every rule it tries
-- what must work and what must be refused, and it undoes each attempt, so nothing is left behind except its own test
-- fixtures, which it deletes at the end. Every row of the result must say passed = true.
-- It is safe to run again, also when the tables hold real accounts: it touches only ids that start with "selftest_".
--
-- Step 33: checks 60 to 62 write Realtime messages (and roll them back). Supabase makes the day's message table when a client
-- connects to Realtime, so on a day no client has connected yet they cannot run: they say passed = null (skipped), with the
-- reason in their name. Run the file again once the app has connected that day, and nothing is skipped. The test rows the file
-- makes and deletes fire the broadcast triggers too: their messages go to self-test topics that no account can join, and the
-- file deletes them at the end where the editor's role may (a hosted project keeps them until it drops the day's table).
--
-- 2026-11-08 (heavy moments, supabase/migrations/20261108120000_heavy_moments.sql): a crisis entry is a whole reflection since
-- process-entry gen-v2.4, so checks 21, 22, 31, 44, 64 and 65 now prove that the database lets it be one, and check 67 that the
-- server can save one whole and that the old rules are gone. Run it after that migration.
--
-- 2026-11-08 (step 37, supabase/migrations/20261108130000_affirmation_verses.sql): checks 68 and 69 prove an affirmation's verse
-- columns. Run it after that migration.
--
-- 2026-11-09 (more affirmations, supabase/migrations/20261109120000_more_affirmations.sql): check 29 also proves that an
-- affirmation without a slot is accepted, and checks 70 to 73 prove the position column, the slot move and who may call it. Run it
-- after that migration.
--
-- 2026-11-11 (step 38, supabase/migrations/20261111120000_scholar_conversations.sql): checks 74 to 85 prove Scholar's four tables,
-- their policies and grants, their cascades and the server's two counters. Run it after that migration.
--
-- 2026-11-11 (supabase/migrations/20261111130000_help_lines.sql): checks 86 to 88 prove a heavy moment's help line and the column
-- that closes Scholar for an account under 18. Run it after that migration.

drop table if exists pg_temp.rls_results;
create temp table rls_results (position integer, check_name text, passed boolean);

-- Runs one statement as a role, with the Clerk claims of a user, and always rolls it back (also the optional setup that
-- runs first, as the table owner). Answers 'ok:<rows touched>' or the SQLSTATE of the error: 42501 is "permission
-- denied" or "row-level security", 23514 a check or trigger refusal, 23505 a duplicate, 23503 a foreign key.
create or replace function pg_temp.try_as(who text, claims text, setup text, stmt text)
returns text
language plpgsql
as $$
declare
  n integer;
begin
  begin
    if setup is not null then
      execute setup;
    end if;
    execute format('set local role %I', who);
    perform set_config('request.jwt.claims', claims, true);
    execute stmt;
    get diagnostics n = row_count;
    raise exception 'rollback:%', n using errcode = 'P0001';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'rollback:%' then
      return 'ok:' || substr(sqlerrm, 10);
    end if;
    return sqlstate;
  end;
end
$$;

-- ---- Step 33: Realtime messages and the run of reflection days -------------------------------------------------------------

-- Whether a Realtime message can be written today: 'ok', or why not. It writes nothing.
create or replace function pg_temp.message_probe()
returns text
language plpgsql
as $$
begin
  begin
    insert into realtime.messages (id, topic, extension, event, payload, private)
      values (gen_random_uuid(), 'selftest:probe', 'broadcast', 'selftest', '{}'::jsonb, true);
    raise exception 'rollback' using errcode = 'P0001';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm = 'rollback' then
      return 'ok';
    elsif sqlstate = '23514' then
      return 'no message table today, run it again once the app has connected';
    elsif sqlstate = '42501' then
      return 'this role may not write realtime.messages';
    end if;
    return 'no probe message could be written, ' || sqlstate;
  end;
end
$$;

-- Runs one statement as a role, with the Clerk claims of a user, and answers the Realtime messages it wrote to the self-test
-- topics, as JSON (topic, event, private flag, extension, the payload's keys and the payload), or the SQLSTATE of the error. It
-- always rolls back, so no message is ever sent.
create or replace function pg_temp.broadcasts_of(who text, claims text, stmt text)
returns text
language plpgsql
as $$
declare
  seen uuid[];
  made jsonb;
begin
  begin
    select coalesce(array_agg(m.id), '{}') into seen from realtime.messages m where m.topic like 'user:selftest\_%';
    execute format('set local role %I', who);
    perform set_config('request.jwt.claims', claims, true);
    execute stmt;
    reset role;
    select coalesce(jsonb_agg(jsonb_build_object(
             'topic', m.topic, 'event', m.event, 'private', m.private, 'extension', m.extension,
             'keys', (select jsonb_agg(k order by k) from jsonb_object_keys(m.payload) as k),
             'payload', m.payload)), '[]'::jsonb)
      into made
      from realtime.messages m
     where m.topic like 'user:selftest\_%' and not (m.id = any (seen));
    raise exception 'rollback:%', made using errcode = 'P0001';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'rollback:%' then
      return substr(sqlerrm, 10);
    end if;
    return sqlstate;
  end;
end
$$;

-- True when `outcome` (from broadcasts_of) is exactly one private broadcast message on that topic, with that event, exactly
-- those payload keys, and a payload that holds `expected`.
create or replace function pg_temp.one_message(outcome text, topic_name text, event_name text, keys jsonb, expected jsonb)
returns boolean
language plpgsql
as $$
declare
  made jsonb;
begin
  if outcome is null or left(outcome, 1) <> '[' then
    return false;
  end if;
  made := outcome::jsonb;
  return coalesce(
    jsonb_array_length(made) = 1
    and made -> 0 ->> 'topic' = topic_name
    and made -> 0 ->> 'event' = event_name
    and made -> 0 ->> 'extension' = 'broadcast'
    and (made -> 0 ->> 'private')::boolean
    and made -> 0 -> 'keys' = keys
    and made -> 0 -> 'payload' @> expected, false);
end
$$;

-- Realtime decides whether a user may join a private channel the way this does: it writes a broadcast and a presence message on
-- the channel's topic, then reads them back as the user, with realtime.topic set to that topic. Answers the extensions the role
-- could read ('broadcast', 'presence', both or none), or the SQLSTATE of the error. It always rolls back.
create or replace function pg_temp.reads_as(who text, claims text, topic_name text)
returns text
language plpgsql
as $$
declare
  b uuid := gen_random_uuid();
  p uuid := gen_random_uuid();
  seen text;
begin
  begin
    insert into realtime.messages (id, topic, extension, event, payload, private)
      values (b, topic_name, 'broadcast', 'selftest', '{}'::jsonb, true),
             (p, topic_name, 'presence', 'selftest', '{}'::jsonb, true);
    execute format('set local role %I', who);
    perform set_config('request.jwt.claims', claims, true);
    perform set_config('realtime.topic', topic_name, true);
    select coalesce(string_agg(m.extension, ',' order by m.extension), '') into seen
      from realtime.messages m where m.id in (b, p);
    raise exception 'rollback:%', seen using errcode = 'P0001';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'rollback:%' then
      return substr(sqlerrm, 10);
    end if;
    return sqlstate;
  end;
end
$$;

-- Runs the setup statements as the table owner, then one query as a role with a user's claims, and answers 'ok:<its value>'
-- or the SQLSTATE of the error. It always rolls back.
create or replace function pg_temp.value_as(who text, claims text, setup text[], query text)
returns text
language plpgsql
as $$
declare
  stmt text;
  v text;
begin
  begin
    foreach stmt in array coalesce(setup, '{}'::text[]) loop
      execute stmt;
    end loop;
    execute format('set local role %I', who);
    perform set_config('request.jwt.claims', claims, true);
    execute query into v;
    raise exception 'rollback:%', coalesce(v, 'null') using errcode = 'P0001';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'rollback:%' then
      return 'ok:' || substr(sqlerrm, 10);
    end if;
    return sqlstate;
  end;
end
$$;

-- Noon on a day, `days_ago` days before today in the zone.
create or replace function pg_temp.noon(tz text, days_ago integer)
returns timestamptz
language sql
stable
as $$
  select (((now() at time zone tz)::date - days_ago) + time '12:00') at time zone tz
$$;

do $$
declare
  claims_a constant text := '{"sub":"selftest_a","role":"authenticated"}';
  claims_n constant text := '{"sub":"selftest_new","role":"authenticated"}';
  no_claims constant text := '{}';
  stmt text;
  outcome text;
  all_ok boolean;
  n1 integer;
  n2 integer;
  moved boolean;
  cascade_ok boolean := false;
  record_ok boolean := false;
  -- Step 33.
  claims_s constant text := '{"sub":"selftest_s","role":"authenticated"}';
  streak_zone constant text := 'Pacific/Kiritimati';
  streak constant text := $q$select public.reflection_streak_days('Pacific/Kiritimati')$q$;
  new_s constant text := $q$insert into public.users_profile (id) values ('selftest_s')$q$;
  entries_s constant text :=
    'insert into public.journal_entries (user_id, input_type, processing_status, is_crisis, devotional_script, created_at) values ';
  probe text;
  m1 text;
  m2 text;
  m3 text;
  static_ok boolean;
  live boolean;
  note text;
begin
  -- Fixtures, made as the table owner (which bypasses the app's grants and row level security): two users, one entry
  -- and one affirmation each.
  delete from public.users_profile where id like 'selftest\_%';
  insert into public.users_profile (id) values ('selftest_a'), ('selftest_b');
  insert into public.journal_entries
    (id, user_id, client_entry_id, input_type, transcript, processing_status, prayer_summary, updated_at)
  values
    ('a0000000-0000-4000-8000-000000000001', 'selftest_a', 'ca000000-0000-4000-8000-000000000001', 'text',
     'words from a', 'ready', 'a summary', '2020-01-01'),
    ('b0000000-0000-4000-8000-000000000001', 'selftest_b', 'cb000000-0000-4000-8000-000000000001', 'text',
     'words from b', 'ready', 'b summary', '2020-01-01');
  insert into public.daily_affirmations (id, user_id, entry_id, time_slot, headline, affirmation_text)
  values
    ('a0000000-0000-4000-8000-0000000000f1', 'selftest_a', 'a0000000-0000-4000-8000-000000000001', 'morning', 'h', 't'),
    ('b0000000-0000-4000-8000-0000000000f1', 'selftest_b', 'b0000000-0000-4000-8000-000000000001', 'morning', 'h', 't');

  -- ===== users_profile =====
  insert into rls_results values (1, 'a user sees only their own profile',
    pg_temp.try_as('authenticated', claims_a, null, 'select * from public.users_profile') = 'ok:1');

  insert into rls_results values (2, 'a user can change their reminder times, time zone and settings',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set reminder_morning = '06:45', reminder_afternoon = '12:30',
         reminder_evening = '21:15', timezone = 'Africa/Lagos', affirmations_enabled = false,
         ambient_sound = 'soft-rain', ambient_volume = 0.7 where id = 'selftest_a'$q$) = 'ok:1');

  insert into rls_results values (3, 'a user cannot change subscription_tier',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set subscription_tier = 'pro' where id = 'selftest_a'$q$) = '42501');

  insert into rls_results values (4, 'a user cannot change created_at',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set created_at = now() where id = 'selftest_a'$q$) = '42501');

  insert into rls_results values (5, 'a user cannot change another user''s profile',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set reminder_morning = '05:00' where id = 'selftest_b'$q$) = 'ok:0');

  insert into rls_results values (6, 'an unknown ambient sound is refused',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set ambient_sound = 'rain' where id = 'selftest_a'$q$) = '23514');

  insert into rls_results values (7, 'a volume outside 0 to 1 is refused',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set ambient_volume = 1.5 where id = 'selftest_a'$q$) = '23514');

  insert into rls_results values (8, 'an empty time zone is refused',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set timezone = '' where id = 'selftest_a'$q$) = '23514');

  insert into rls_results values (9, 'a user can create their own profile with a time zone and settings',
    pg_temp.try_as('authenticated', claims_n, null,
      $q$insert into public.users_profile (id, reminder_morning, timezone, affirmations_enabled, ambient_sound, ambient_volume)
         values ('selftest_new', '07:00', 'Africa/Lagos', true, 'off', 0.5)$q$) = 'ok:1');

  insert into rls_results values (10, 'a user cannot create a profile with a plan',
    pg_temp.try_as('authenticated', claims_n, null,
      $q$insert into public.users_profile (id, subscription_tier) values ('selftest_new', 'pro')$q$) = '42501');

  insert into rls_results values (11, 'a user cannot delete a profile',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$delete from public.users_profile where id = 'selftest_a'$q$) = '42501');

  -- ===== journal_entries =====
  insert into rls_results values (12, 'a user sees only their own entries',
    pg_temp.try_as('authenticated', claims_a, null, 'select * from public.journal_entries') = 'ok:1');

  insert into rls_results values (13, 'a user cannot insert an entry, not even their own',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into public.journal_entries (user_id, input_type) values ('selftest_a', 'text')$q$) = '42501');

  insert into rls_results values (14, 'a user can change the prayer columns of their own entry',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set is_active_prayer = true, is_answered = true, answered_at = now(),
         answered_notes = 'thank you', prayer_category = 'INNER PEACE'
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = 'ok:1');

  all_ok := true;
  foreach stmt in array array[
    $q$prayer_summary = 'changed'$q$, $q$prayer_title = 'changed'$q$, $q$transcript = 'changed'$q$,
    $q$is_crisis = true$q$, $q$processing_status = 'failed'$q$, $q$devotional_script = 'changed'$q$,
    $q$scripture_text = 'changed'$q$, $q$scripture_verified = true$q$, $q$user_id = 'selftest_b'$q$]
  loop
    outcome := pg_temp.try_as('authenticated', claims_a, null,
      'update public.journal_entries set ' || stmt || $q$ where id = 'a0000000-0000-4000-8000-000000000001'$q$);
    all_ok := all_ok and outcome = '42501';
  end loop;
  insert into rls_results values (15, 'a user cannot change anything the server wrote', all_ok);

  insert into rls_results values (16, 'a user cannot change another user''s entry',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set is_active_prayer = true
         where id = 'b0000000-0000-4000-8000-000000000001'$q$) = 'ok:0');

  insert into rls_results values (17, 'a user cannot delete an entry',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$delete from public.journal_entries where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '42501');

  update public.journal_entries set prayer_title = 'moved' where id = 'a0000000-0000-4000-8000-000000000001';
  select updated_at > '2020-01-01' into moved
    from public.journal_entries where id = 'a0000000-0000-4000-8000-000000000001';
  insert into rls_results values (18, 'updated_at moves when an entry changes', coalesce(moved, false));

  insert into rls_results values (19, 'the same client_entry_id cannot be used twice by one user',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, client_entry_id, input_type)
         values ('selftest_a', 'ca000000-0000-4000-8000-000000000001', 'text')$q$) = '23505');

  insert into rls_results values (20, 'a retried claim with ON CONFLICT DO NOTHING creates nothing',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, client_entry_id, input_type)
         values ('selftest_a', 'ca000000-0000-4000-8000-000000000001', 'text')
         on conflict (user_id, client_entry_id) do nothing$q$) = 'ok:0');

  insert into rls_results values (21, 'a heavy moment holds a whole reflection: a devotional, a prayer, a passage and audio',
    pg_temp.try_as('service_role', no_claims,
      $q$update public.journal_entries set devotional_title = 'a title', devotional_script = 'a script',
         closing_prayer = 'a prayer', devotional_audio_path = 'selftest_a/devotionals/one.wav',
         scripture_reference = 'Isaiah 41:10', scripture_text = 'Do not fear, for I am with you;', scripture_verified = true
         where id = 'a0000000-0000-4000-8000-000000000001'$q$,
      $q$update public.journal_entries set is_crisis = true
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = 'ok:1');

  all_ok := true;
  foreach stmt in array array[
    $q$insert into public.journal_entries (user_id, input_type) values ('selftest_a', 'voice')$q$,
    $q$insert into public.journal_entries (user_id, input_type, processing_status) values ('selftest_a', 'text', 'done')$q$,
    $q$insert into public.journal_entries (user_id, input_type, prayer_category) values ('selftest_a', 'text', 'MONEY')$q$,
    $q$insert into public.journal_entries (user_id, input_type, prayer_summary)
       values ('selftest_a', 'text', repeat('x', 201))$q$,
    $q$insert into public.journal_entries (user_id, input_type, devotional_duration_ms) values ('selftest_a', 'text', -1)$q$]
  loop
    outcome := pg_temp.try_as('service_role', no_claims, null, stmt);
    all_ok := all_ok and outcome = '23514';
  end loop;
  insert into rls_results values (22, 'a bad input type, status, category, summary or duration is refused', all_ok);

  -- ===== daily_affirmations =====
  insert into rls_results values (23, 'a user sees only their own affirmations',
    pg_temp.try_as('authenticated', claims_a, null, 'select * from public.daily_affirmations') = 'ok:1');

  insert into rls_results values (24, 'a user can favorite their own affirmation',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.daily_affirmations set is_favorite = true
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = 'ok:1');

  all_ok := true;
  foreach stmt in array array[
    $q$headline = 'changed'$q$, $q$affirmation_text = 'changed'$q$, $q$is_delivered = true$q$,
    $q$scheduled_for = now()$q$, $q$time_slot = 'evening'$q$]
  loop
    outcome := pg_temp.try_as('authenticated', claims_a, null,
      'update public.daily_affirmations set ' || stmt || $q$ where id = 'a0000000-0000-4000-8000-0000000000f1'$q$);
    all_ok := all_ok and outcome = '42501';
  end loop;
  insert into rls_results values (25, 'a user cannot change an affirmation''s text, slot, delivery or schedule', all_ok);

  insert into rls_results values (26, 'a user cannot change another user''s affirmation',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.daily_affirmations set is_favorite = true
         where id = 'b0000000-0000-4000-8000-0000000000f1'$q$) = 'ok:0');

  insert into rls_results values (27, 'a user cannot insert or delete affirmations',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', 'evening', 'h', 't')$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$delete from public.daily_affirmations where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '42501');

  insert into rls_results values (28, 'an affirmation must belong to the same user as its entry',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_b', 'a0000000-0000-4000-8000-000000000001', 'evening', 'h', 't')$q$) = '23503');

  -- 2026-11-09: one affirmation per slot, and any number (up to ten, check 70) without a slot.
  insert into rls_results values (29, 'an entry has one affirmation per slot, and more affirmations without a slot',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', 'morning', 'h', 't')$q$) = '23505'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', null, 'h', 't')$q$) = 'ok:1');

  insert into rls_results values (30, 'an unknown time slot is refused',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', 'night', 'h', 't')$q$) = '23514');

  insert into rls_results values (31, 'a heavy moment gets its affirmations like any reflection',
    pg_temp.try_as('service_role', no_claims,
      $q$insert into public.journal_entries (id, user_id, input_type, is_crisis)
         values ('a0000000-0000-4000-8000-0000000000c1', 'selftest_a', 'text', true)$q$,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-0000000000c1', 'evening', 'h', 't')$q$) = 'ok:1');

  -- ===== deleting a profile =====
  begin
    insert into public.users_profile (id) values ('selftest_c');
    insert into public.journal_entries (id, user_id, input_type)
      values ('c0000000-0000-4000-8000-000000000001', 'selftest_c', 'text');
    insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
      values ('selftest_c', 'c0000000-0000-4000-8000-000000000001', 'morning', 'h', 't');
    delete from public.users_profile where id = 'selftest_c';
    select count(*) into n1 from public.journal_entries where user_id = 'selftest_c';
    select count(*) into n2 from public.daily_affirmations where user_id = 'selftest_c';
    cascade_ok := n1 = 0 and n2 = 0;
    raise exception 'rollback' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    null;
  end;
  insert into rls_results values (32, 'deleting a profile removes its entries and affirmations', cascade_ok);

  -- ===== a signed-out visitor =====
  all_ok := true;
  foreach stmt in array array[
    'select * from public.users_profile', 'select * from public.journal_entries',
    'select * from public.daily_affirmations']
  loop
    outcome := pg_temp.try_as('anon', no_claims, null, stmt);
    all_ok := all_ok and outcome = '42501';
  end loop;
  insert into rls_results values (33, 'a signed-out visitor cannot read any table', all_ok);

  -- ===== the server (service_role): explicit grants, because the project does not expose new tables by default =====
  all_ok := true;
  foreach stmt in array array[
    'select * from public.users_profile', 'select * from public.journal_entries',
    'select * from public.daily_affirmations',
    $q$insert into public.users_profile (id) values ('selftest_s')$q$,
    $q$insert into public.journal_entries (user_id, input_type) values ('selftest_a', 'text')$q$,
    $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
       values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', 'afternoon', 'h', 't')$q$,
    $q$update public.users_profile set subscription_tier = 'pro' where id = 'selftest_a'$q$,
    $q$update public.journal_entries set transcript = 'server words' where id = 'a0000000-0000-4000-8000-000000000001'$q$,
    $q$update public.daily_affirmations set headline = 'server headline'
       where id = 'a0000000-0000-4000-8000-0000000000f1'$q$,
    $q$delete from public.daily_affirmations where id = 'a0000000-0000-4000-8000-0000000000f1'$q$,
    $q$delete from public.journal_entries where id = 'a0000000-0000-4000-8000-000000000001'$q$,
    $q$delete from public.users_profile where id = 'selftest_b'$q$]
  loop
    outcome := pg_temp.try_as('service_role', no_claims, null, stmt);
    all_ok := all_ok and outcome like 'ok:%';
  end loop;
  insert into rls_results values (34, 'the server (service_role) can read, create, change and delete on all three tables', all_ok);

  insert into rls_results values (35, 'only the server can change the plan',
    pg_temp.try_as('service_role', no_claims, null,
      $q$update public.users_profile set subscription_tier = 'pro' where id = 'selftest_a'$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set subscription_tier = 'pro' where id = 'selftest_a'$q$) = '42501');

  -- ===== storage =====
  insert into rls_results values (36, 'the journal_media bucket is private, limited to 25 MB and to audio types',
    exists (select 1 from storage.buckets
            where id = 'journal_media' and not public and file_size_limit = 26214400
              and allowed_mime_types @> array['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg']));

  insert into rls_results values (37, 'a user can upload into their own raw folder',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into storage.objects (bucket_id, name) values ('journal_media', 'selftest_a/raw/one.m4a')$q$) = 'ok:1');

  insert into rls_results values (38, 'a user cannot upload into someone else''s folder',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into storage.objects (bucket_id, name) values ('journal_media', 'selftest_b/raw/one.m4a')$q$) = '42501');

  insert into rls_results values (39, 'a user cannot upload outside raw/ or deeper than raw/',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into storage.objects (bucket_id, name) values ('journal_media', 'selftest_a/devotionals/one.mp3')$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into storage.objects (bucket_id, name) values ('journal_media', 'selftest_a/raw/deeper/one.m4a')$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into storage.objects (bucket_id, name) values ('journal_media', 'selftest_a/one.m4a')$q$) = '42501');

  insert into rls_results values (40, 'a user reads their own files and never someone else''s',
    pg_temp.try_as('authenticated', claims_a,
      $q$insert into storage.objects (bucket_id, name) values
         ('journal_media', 'selftest_a/raw/one.m4a'), ('journal_media', 'selftest_b/raw/one.m4a')$q$,
      $q$select * from storage.objects where bucket_id = 'journal_media'
         and name like 'selftest\_%'$q$) = 'ok:1');

  -- A hosted project refuses every SQL delete on a storage table with its own guard (any error code is a refusal);
  -- offline there is no guard, and the missing policy hides the row. Because that guard can hide a wrong policy, the
  -- last part reads the policies themselves: the app roles have a select and an insert policy on storage.objects and
  -- nothing else.
  insert into rls_results values (41, 'a user cannot overwrite or delete a file',
    pg_temp.try_as('authenticated', claims_a,
      $q$insert into storage.objects (bucket_id, name) values ('journal_media', 'selftest_a/raw/one.m4a')$q$,
      $q$update storage.objects set name = 'selftest_a/raw/two.m4a'
         where bucket_id = 'journal_media' and name = 'selftest_a/raw/one.m4a'$q$) in ('ok:0', '42501')
    and pg_temp.try_as('authenticated', claims_a,
      $q$insert into storage.objects (bucket_id, name) values ('journal_media', 'selftest_a/raw/one.m4a')$q$,
      $q$delete from storage.objects where bucket_id = 'journal_media'
         and name = 'selftest_a/raw/one.m4a'$q$) in ('ok:0', '42501', 'P0001')
    and not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd in ('UPDATE', 'DELETE', 'ALL')
        and roles && array['authenticated', 'anon', 'public']::name[]));

  insert into rls_results values (42, 'a signed-out visitor sees no files',
    pg_temp.try_as('anon', no_claims,
      $q$insert into storage.objects (bucket_id, name) values ('journal_media', 'selftest_a/raw/one.m4a')$q$,
      $q$select * from storage.objects where bucket_id = 'journal_media'$q$) in ('ok:0', '42501'));

  -- ===== the prayer and scripture rules =====
  insert into rls_results values (43, 'a prayer is answered on a date and only then, and a note stops at 1,000 characters',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set is_answered = true
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '23514'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set answered_at = now()
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '23514'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set is_answered = true, answered_at = now(), answered_notes = repeat('x', 1001)
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '23514'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set is_answered = true, answered_at = now(), answered_notes = repeat('x', 1000)
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = 'ok:1');

  -- Since 2026-11-08 a heavy moment is a reflection like any other: its person may mark it as a prayer request and mark it
  -- answered (the server never makes one a prayer by itself), and the app still cannot say whether an entry is heavy (check 15).
  insert into rls_results values (44, 'a heavy moment may become a prayer when its person marks it, and the app cannot mark an entry heavy',
    pg_temp.try_as('authenticated', claims_a,
      $q$insert into public.journal_entries (id, user_id, input_type, processing_status, is_crisis, devotional_script)
         values ('a0000000-0000-4000-8000-0000000000c2', 'selftest_a', 'text', 'ready', true, 'a script')$q$,
      $q$update public.journal_entries set is_active_prayer = true
         where id = 'a0000000-0000-4000-8000-0000000000c2'$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a,
      $q$insert into public.journal_entries (id, user_id, input_type, processing_status, is_crisis, devotional_script)
         values ('a0000000-0000-4000-8000-0000000000c2', 'selftest_a', 'text', 'ready', true, 'a script')$q$,
      $q$update public.journal_entries set is_active_prayer = true, is_answered = true, answered_at = now(),
         answered_notes = 'thank you' where id = 'a0000000-0000-4000-8000-0000000000c2'$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set is_crisis = true
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '42501');

  insert into rls_results values (45, 'verified scripture needs its reference and its text',
    pg_temp.try_as('service_role', no_claims, null,
      $q$update public.journal_entries set scripture_verified = true
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.journal_entries set scripture_verified = true, scripture_reference = 'Psalm 46:10'
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.journal_entries set scripture_verified = true, scripture_reference = 'Psalm 46:10',
         scripture_text = 'Be still, and know that I am God.'
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = 'ok:1');

  insert into rls_results values (46, 'the journal_media bucket also accepts WAV, the spoken devotional''s format',
    exists (select 1 from storage.buckets
            where id = 'journal_media' and 'audio/wav' = any (allowed_mime_types)));

  -- ===== the record of deleted devotionals (step 29b) =====
  insert into rls_results values (47, 'the app cannot read or write the record of deleted devotionals',
    pg_temp.try_as('authenticated', claims_a, null, 'select * from public.deleted_devotionals') = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.deleted_devotionals set made_at = now()$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null, 'delete from public.deleted_devotionals') = '42501'
    and pg_temp.try_as('anon', no_claims, null, 'select * from public.deleted_devotionals') = '42501'
    and pg_temp.try_as('anon', no_claims, null,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$) = '42501');

  insert into rls_results values (48, 'the server records a deleted devotional once, for a user that exists',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$) = 'ok:1'
    and pg_temp.try_as('service_role', no_claims,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$) = '23505'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d2', 'selftest_nobody', now())$q$) = '23503');

  -- A record outlives its reflection and goes with its account (the same pattern as check 32).
  begin
    insert into public.users_profile (id) values ('selftest_d');
    insert into public.journal_entries (id, user_id, input_type)
      values ('d0000000-0000-4000-8000-000000000001', 'selftest_d', 'text');
    insert into public.deleted_devotionals (entry_id, user_id, made_at)
      values ('d0000000-0000-4000-8000-000000000001', 'selftest_d', now());
    delete from public.journal_entries where id = 'd0000000-0000-4000-8000-000000000001';
    select count(*) into n1 from public.deleted_devotionals where entry_id = 'd0000000-0000-4000-8000-000000000001';
    delete from public.users_profile where id = 'selftest_d';
    select count(*) into n2 from public.deleted_devotionals where user_id = 'selftest_d';
    record_ok := n1 = 1 and n2 = 0;
    raise exception 'rollback' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    null;
  end;
  insert into rls_results values (49, 'a record outlives its reflection and goes with its account', record_ok);

  insert into rls_results values (50, 'the record is closed by row level security as well as by grants',
    exists (select 1 from pg_class where oid = 'public.deleted_devotionals'::regclass and relrowsecurity)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'deleted_devotionals'));

  -- ===== the subscription columns (step 30) =====
  -- Only the server writes when a plan ends and when it last read RevenueCat. A user inserting their own row (claims_n) is
  -- refused only because of the column, the same pattern as check 7.
  insert into rls_results values (51, 'a user cannot change when their subscription ends',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set subscription_expires_at = now() + interval '1 year'
         where id = 'selftest_a'$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_n, null,
      $q$insert into public.users_profile (id, subscription_expires_at) values ('selftest_new', now())$q$) = '42501');

  insert into rls_results values (52, 'a user cannot change when their subscription was last checked',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set subscription_synced_at = now() where id = 'selftest_a'$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_n, null,
      $q$insert into public.users_profile (id, subscription_synced_at) values ('selftest_new', now())$q$) = '42501');

  insert into rls_results values (53, 'the server writes the plan with its end and the time it checked; the app reads its own',
    pg_temp.try_as('service_role', no_claims, null,
      $q$update public.users_profile set subscription_tier = 'pro', subscription_expires_at = now() + interval '1 hour',
         subscription_synced_at = now() where id = 'selftest_a'$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$select subscription_expires_at, subscription_synced_at from public.users_profile$q$) = 'ok:1');

  -- ===== the exports bucket (step 31) =====
  -- export-data writes {userId}/{exportId}.zip as the server; people only ever get a signed link. No policy names the bucket, so
  -- the app can neither put a file there, read one nor list the folder, its own included.
  insert into rls_results values (54, 'the exports bucket is private, limited to 50 MB and to ZIP files',
    exists (select 1 from storage.buckets
            where id = 'exports' and not public and file_size_limit = 52428800
              and allowed_mime_types = array['application/zip']));

  insert into rls_results values (55, 'a signed-in user can neither upload into, read nor list the exports bucket',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into storage.objects (bucket_id, name) values ('exports', 'selftest_a/one.zip')$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a,
      $q$insert into storage.objects (bucket_id, name) values ('exports', 'selftest_a/one.zip')$q$,
      $q$select * from storage.objects where bucket_id = 'exports'$q$) in ('ok:0', '42501')
    and pg_temp.try_as('authenticated', claims_a,
      $q$insert into storage.objects (bucket_id, name) values ('exports', 'selftest_a/one.zip')$q$,
      $q$select * from storage.objects where bucket_id = 'exports' and name like 'selftest\_a/%'$q$) in ('ok:0', '42501'));

  insert into rls_results values (56, 'a signed-out visitor sees nothing in the exports bucket and cannot put a file there',
    pg_temp.try_as('anon', no_claims,
      $q$insert into storage.objects (bucket_id, name) values ('exports', 'selftest_a/one.zip')$q$,
      $q$select * from storage.objects where bucket_id = 'exports'$q$) in ('ok:0', '42501')
    and pg_temp.try_as('anon', no_claims, null,
      $q$insert into storage.objects (bucket_id, name) values ('exports', 'selftest_a/one.zip')$q$) = '42501');

  -- ===== Realtime messages (step 33) =====
  -- A change to an entry or an affirmation sends a short message to its owner's private topic, user:{userId}. Only the owner may
  -- receive it, and nobody may send on these topics from the app.
  insert into rls_results values (57, 'the broadcast triggers fire after each row: entries on insert, update and delete, affirmations on insert and update',
    exists (select 1 from pg_trigger t
             where t.tgrelid = 'public.journal_entries'::regclass and t.tgname = 'journal_entries_broadcast'
               and not t.tgisinternal and t.tgenabled <> 'D'
               and t.tgfoid = to_regprocedure('public.broadcast_entry_change()')
               and t.tgtype::int & 1 = 1 and t.tgtype::int & 2 = 0 and t.tgtype::int & 64 = 0
               and t.tgtype::int & 4 = 4 and t.tgtype::int & 16 = 16 and t.tgtype::int & 8 = 8)
    and exists (select 1 from pg_trigger t
             where t.tgrelid = 'public.daily_affirmations'::regclass and t.tgname = 'daily_affirmations_broadcast'
               and not t.tgisinternal and t.tgenabled <> 'D'
               and t.tgfoid = to_regprocedure('public.broadcast_affirmations_change()')
               and t.tgtype::int & 1 = 1 and t.tgtype::int & 2 = 0 and t.tgtype::int & 64 = 0
               and t.tgtype::int & 4 = 4 and t.tgtype::int & 16 = 16 and t.tgtype::int & 8 = 0));

  insert into rls_results values (58, 'the broadcast functions run as their owner with an empty search path, and the app cannot call them',
    (select count(*) = 2
            and bool_and(p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']
                         and not has_function_privilege('public', p.oid, 'execute')
                         and not has_function_privilege('anon', p.oid, 'execute')
                         and not has_function_privilege('authenticated', p.oid, 'execute'))
       from pg_proc p
      where p.oid in (to_regprocedure('public.broadcast_entry_change()'),
                      to_regprocedure('public.broadcast_affirmations_change()'))));

  -- Offline the stand-in realtime.send fails on purpose while test.realtime_send_fails is on (a hosted one ignores the setting).
  insert into rls_results values (59, 'a change is saved even when its Realtime message cannot be sent',
    pg_temp.try_as('authenticated', claims_a,
      $q$select set_config('test.realtime_send_fails', 'on', true)$q$,
      $q$update public.journal_entries set is_active_prayer = true
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a,
      $q$select set_config('test.realtime_send_fails', 'on', true)$q$,
      $q$update public.daily_affirmations set is_favorite = true
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = 'ok:1');

  probe := pg_temp.message_probe();
  note := case when probe = 'ok' then '' else ' (skipped: ' || probe || ')' end;

  -- An insert, an update by the owner and a delete each send one message, with the entry's id, the operation, its status and its
  -- time, and nothing else. The delete removes the entry's affirmation too, which sends nothing.
  if probe = 'ok' then
    m1 := pg_temp.broadcasts_of('service_role', no_claims,
      $q$insert into public.journal_entries (id, user_id, input_type, processing_status)
         values ('a0000000-0000-4000-8000-0000000000e1', 'selftest_a', 'text', 'processing')$q$);
    m2 := pg_temp.broadcasts_of('authenticated', claims_a,
      $q$update public.journal_entries set is_active_prayer = true
         where id = 'a0000000-0000-4000-8000-000000000001'$q$);
    m3 := pg_temp.broadcasts_of('service_role', no_claims,
      $q$delete from public.journal_entries where id = 'a0000000-0000-4000-8000-000000000001'$q$);
    all_ok := pg_temp.one_message(m1, 'user:selftest_a', 'entry_changed', '["id", "op", "status", "updated_at"]',
                '{"id": "a0000000-0000-4000-8000-0000000000e1", "op": "INSERT", "status": "processing"}')
      and pg_temp.one_message(m2, 'user:selftest_a', 'entry_changed', '["id", "op", "status", "updated_at"]',
                '{"id": "a0000000-0000-4000-8000-000000000001", "op": "UPDATE", "status": "ready"}')
      and pg_temp.one_message(m3, 'user:selftest_a', 'entry_changed', '["id", "op", "status", "updated_at"]',
                '{"id": "a0000000-0000-4000-8000-000000000001", "op": "DELETE", "status": "ready"}');
  end if;
  insert into rls_results values (60, 'a changed entry sends its owner one private message with ids, the operation, a status and a time only' || note,
    case when probe = 'ok' then all_ok end);

  -- A new affirmation and a changed one each send one message with the affirmation's id and its entry's id, and nothing else.
  if probe = 'ok' then
    m1 := pg_temp.broadcasts_of('authenticated', claims_a,
      $q$update public.daily_affirmations set is_favorite = true
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$);
    m2 := pg_temp.broadcasts_of('service_role', no_claims,
      $q$insert into public.daily_affirmations (id, user_id, entry_id, time_slot, headline, affirmation_text)
         values ('a0000000-0000-4000-8000-0000000000f2', 'selftest_a', 'a0000000-0000-4000-8000-000000000001',
                 'evening', 'h', 't')$q$);
    all_ok := pg_temp.one_message(m1, 'user:selftest_a', 'affirmations_changed', '["entry_id", "id"]',
                '{"id": "a0000000-0000-4000-8000-0000000000f1", "entry_id": "a0000000-0000-4000-8000-000000000001"}')
      and pg_temp.one_message(m2, 'user:selftest_a', 'affirmations_changed', '["entry_id", "id"]',
                '{"id": "a0000000-0000-4000-8000-0000000000f2", "entry_id": "a0000000-0000-4000-8000-000000000001"}');
  end if;
  insert into rls_results values (61, 'a new or changed affirmation sends its owner one private message with ids only' || note,
    case when probe = 'ok' then all_ok end);

  -- One select policy for signed-in users on realtime.messages, and it lets a user join only their own topic, for broadcast
  -- messages only. The live part reads as Realtime does when a private channel is joined.
  select count(*) into n1 from pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and cmd = 'SELECT' and 'authenticated' = any (roles);
  static_ok := n1 = 1 and exists (
    select 1 from pg_policies
     where schemaname = 'realtime' and tablename = 'messages' and policyname = 'user_broadcast_select_own'
       and cmd = 'SELECT' and roles = array['authenticated']::name[]
       and qual like '%realtime.topic()%' and qual like '%requesting_user_id()%' and qual like '%extension%');
  if not static_ok then
    live := false;
    note := '';
  elsif probe <> 'ok' then
    live := null;
    note := ' (live part skipped: ' || probe || ')';
  elsif not has_table_privilege('authenticated', 'realtime.messages', 'select') then
    live := null;
    note := ' (live part skipped: signed-in users may not read realtime.messages)';
  else
    live := pg_temp.reads_as('authenticated', claims_a, 'user:selftest_a') = 'broadcast'
      and pg_temp.reads_as('authenticated', claims_a, 'user:selftest_b') = ''
      and pg_temp.reads_as('anon', no_claims, 'user:selftest_a') in ('', '42501');
    note := '';
  end if;
  insert into rls_results values (62, 'only the owner may join their own topic, and only for broadcast messages' || note, live);

  insert into rls_results values (63, 'no policy lets the app or a visitor send, change or delete a Realtime message',
    not exists (select 1 from pg_policies
                 where schemaname = 'realtime' and tablename = 'messages'
                   and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
                   and roles && array['authenticated', 'anon', 'public']::name[])
    and (probe <> 'ok' or pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into realtime.messages (id, topic, extension, event, payload, private)
         values (gen_random_uuid(), 'user:selftest_a', 'broadcast', 'selftest', '{}'::jsonb, true)$q$) = '42501'));

  -- ===== the run of reflection days (step 33) =====
  -- A user of their own (selftest_s) with entries at noon on given days in a fixed zone, made as the table owner; then the
  -- function as that user. Kiritimati is UTC+14, so a count made in UTC would often land on another day.
  insert into rls_results values (64, 'the run of reflection days counts the caller''s own days with a finished reflection, a heavy moment''s included, up to today or yesterday',
    -- today, yesterday and three days ago: 2 (another user's entry two days ago changes nothing)
    pg_temp.value_as('authenticated', claims_s, array[new_s, entries_s || format(
      $q$('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 0)), ('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 1)),
         ('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 3)), ('selftest_b', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 2))$q$,
      streak_zone)], streak) = 'ok:2'
    -- a heavy moment with its reflection counts (yesterday); one saved before 2026-11-08, the words only, does not, and a day
    -- with only that breaks the run (two days ago)
    and pg_temp.value_as('authenticated', claims_s, array[new_s, entries_s || format(
      $q$('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 0)), ('selftest_s', 'text', 'ready', true, 'd', pg_temp.noon(%1$L, 1)),
         ('selftest_s', 'text', 'ready', true, null, pg_temp.noon(%1$L, 2)), ('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 3))$q$,
      streak_zone)], streak) = 'ok:2'
    -- a day with only a failed, or only a processing, entry breaks the run
    and pg_temp.value_as('authenticated', claims_s, array[new_s, entries_s || format(
      $q$('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 0)), ('selftest_s', 'text', 'failed', false, null, pg_temp.noon(%1$L, 1)),
         ('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 2))$q$,
      streak_zone)], streak) = 'ok:1'
    and pg_temp.value_as('authenticated', claims_s, array[new_s, entries_s || format(
      $q$('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 0)), ('selftest_s', 'text', 'processing', false, null, pg_temp.noon(%1$L, 1)),
         ('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 2))$q$,
      streak_zone)], streak) = 'ok:1'
    -- the run may end yesterday; with nothing today or yesterday it is 0
    and pg_temp.value_as('authenticated', claims_s, array[new_s, entries_s || format(
      $q$('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 1)), ('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 2))$q$,
      streak_zone)], streak) = 'ok:2'
    and pg_temp.value_as('authenticated', claims_s, array[new_s, entries_s || format(
      $q$('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 2)), ('selftest_s', 'text', 'ready', false, 'd', pg_temp.noon(%1$L, 3))$q$,
      streak_zone)], streak) = 'ok:0'
    -- an unknown zone is refused (22023), also with no entries
    and pg_temp.value_as('authenticated', claims_s, array[new_s],
      $q$select public.reflection_streak_days('Not/AZone')$q$) = '22023'
    -- only a signed-in user may call it (a visitor's call would be refused by the table too, so the grant itself is read)
    and has_function_privilege('authenticated', 'public.reflection_streak_days(text)', 'execute')
    and not has_function_privilege('anon', 'public.reflection_streak_days(text)', 'execute')
    and not has_function_privilege('public', 'public.reflection_streak_days(text)', 'execute')
    and pg_temp.value_as('anon', no_claims, null, $q$select public.reflection_streak_days('UTC')$q$) = '42501');

  -- ===== the validation line (step 36) =====
  insert into rls_results values (65, 'the validation line is optional text of at most 240 characters, a heavy moment''s included',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'journal_entries' and column_name = 'validation_line'
               and data_type = 'text' and is_nullable = 'YES')
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.journal_entries set validation_line = repeat('x', 240)
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = 'ok:1'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.journal_entries set validation_line = repeat('x', 241)
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, validation_line)
         values ('selftest_a', 'text', true, 'What you are carrying right now is real, and you matter to God.')$q$) = 'ok:1'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, validation_line)
         values ('selftest_a', 'text', true, repeat('x', 241))$q$) = '23514');

  -- The app reads every column of its own entries (a table-wide select), and writes only the five prayer columns it is granted.
  insert into rls_results values (66, 'the app reads the validation line on its own entry and can never write it',
    pg_temp.try_as('authenticated', claims_a,
      $q$update public.journal_entries set validation_line = 'Your week asked a lot of you, and you kept going.'
         where id = 'a0000000-0000-4000-8000-000000000001'$q$,
      $q$select validation_line from public.journal_entries where validation_line is not null$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set validation_line = 'a line of my own'
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '42501'
    and not exists (select 1 from information_schema.column_privileges
                     where table_schema = 'public' and table_name = 'journal_entries' and column_name = 'validation_line'
                       and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE')));

  -- ===== heavy moments (2026-11-08) =====
  -- The server saves a heavy moment as it saves any reflection (process-entry gen-v2.4): the entry with its whole reflection, then
  -- its three affirmations. The entry is made as the table owner, which the table's rules refuse as they would the server (the
  -- server's grants are check 34's); the affirmations are made as the server.
  insert into rls_results values (67, 'the server saves a heavy moment whole, and the rules that kept a crisis entry empty are gone',
    pg_temp.try_as('service_role', no_claims,
      $q$insert into public.journal_entries (id, user_id, client_entry_id, input_type, processing_status, is_crisis, transcript,
           dominant_emotion, devotional_title, devotional_script, closing_prayer, validation_line, scripture_reference,
           scripture_text, scripture_verified, devotional_audio_path, devotional_duration_ms)
         values ('a0000000-0000-4000-8000-0000000000c3', 'selftest_a', 'ca000000-0000-4000-8000-0000000000c3', 'text', 'ready',
           true, 'words', 'weary', 'You Are Not Alone', 'a script', 'a prayer', 'What you are carrying is real.',
           'Isaiah 41:10', 'Do not fear, for I am with you;', true, 'selftest_a/devotionals/c3.wav', 90000)$q$,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text) values
           ('selftest_a', 'a0000000-0000-4000-8000-0000000000c3', 'morning', 'h', 't'),
           ('selftest_a', 'a0000000-0000-4000-8000-0000000000c3', 'afternoon', 'h', 't'),
           ('selftest_a', 'a0000000-0000-4000-8000-0000000000c3', 'evening', 'h', 't')$q$) = 'ok:3'
    and not exists (select 1 from pg_constraint
                     where conrelid = 'public.journal_entries'::regclass
                       and conname in ('journal_entries_crisis_check', 'crisis_not_prayer', 'validation_line_crisis'))
    and not exists (select 1 from pg_trigger
                     where tgrelid = 'public.daily_affirmations'::regclass and tgname = 'daily_affirmations_no_crisis')
    and to_regprocedure('public.reject_affirmation_for_crisis_entry()') is null);

  -- ===== affirmation verses (step 37) =====
  -- The server saves a verse as its reference and its words, both or neither, and both short.
  insert into rls_results values (68, 'an affirmation''s verse is its reference and its words, both or neither, and short',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'daily_affirmations' and column_name = 'verse_reference'
               and data_type = 'text' and is_nullable = 'YES')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'daily_affirmations' and column_name = 'verse_text'
                   and data_type = 'text' and is_nullable = 'YES')
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.daily_affirmations set verse_reference = 'Psalm 46:1',
           verse_text = 'God is our refuge and strength, an ever-present help in times of trouble.'
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = 'ok:1'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.daily_affirmations set verse_reference = 'Psalm 46:1'
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.daily_affirmations set verse_text = 'God is our refuge.'
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.daily_affirmations set verse_reference = 'Psalm 46:1', verse_text = repeat('x', 201)
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.daily_affirmations set verse_reference = repeat('x', 61), verse_text = 'God is our refuge.'
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.daily_affirmations set verse_reference = '', verse_text = ''
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '23514');

  -- The app reads the verse of its own affirmation (a table-wide select) and still writes is_favorite alone.
  insert into rls_results values (69, 'the app reads the verse of its own affirmation, never another''s, and can never write it',
    pg_temp.try_as('authenticated', claims_a,
      $q$update public.daily_affirmations set verse_reference = 'Psalm 23:1', verse_text = 'The LORD is my shepherd.'
         where id in ('a0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1')$q$,
      $q$select verse_reference, verse_text from public.daily_affirmations where verse_reference is not null$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.daily_affirmations set verse_reference = 'Psalm 23:1', verse_text = 'The LORD is my shepherd.'
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '42501'
    and not exists (select 1 from information_schema.column_privileges
                     where table_schema = 'public' and table_name = 'daily_affirmations'
                       and column_name in ('verse_reference', 'verse_text')
                       and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE')));

  -- ===== more affirmations (2026-11-09) =====
  -- The order of the cards: 1 to 10, unique in its entry, filled in by the trigger when the server gives none (the fixture above
  -- took 1 that way, and a multi-row insert takes the next numbers in order).
  insert into rls_results values (70, 'an affirmation has a position from 1 to 10, unique in its entry, filled in when none is given',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'daily_affirmations' and column_name = 'position'
               and is_nullable = 'NO')
    and (select position from public.daily_affirmations where id = 'a0000000-0000-4000-8000-0000000000f1') = 1
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text, position)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', null, 'h', 't', 0)$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text, position)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', null, 'h', 't', 11)$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text, position)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', null, 'h', 't', 1)$q$) = '23505'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$do $d$
         declare p integer;
         begin
           insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
             values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', null, 'h', 't'),
                    ('selftest_a', 'a0000000-0000-4000-8000-000000000001', null, 'h', 't');
           select max(position) into p from public.daily_affirmations
            where entry_id = 'a0000000-0000-4000-8000-000000000001';
           if p <> 3 then
             raise exception 'positions were not filled in order: %', p using errcode = 'P0002';
           end if;
         end $d$ $q$) = 'ok:0');

  -- The server moves a lock-screen slot to another affirmation of the same entry in one step: the holder loses it, the other
  -- takes it, a slot that does not exist is refused, and an affirmation of another entry moves nothing (the holder keeps its slot).
  insert into rls_results values (71, 'the server moves a slot to another affirmation of the same entry in one step',
    pg_temp.try_as('service_role', no_claims, null,
      $q$do $d$
         declare new_id uuid;
         begin
           insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
             values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', null, 'h2', 't2') returning id into new_id;
           perform public.feature_affirmation('a0000000-0000-4000-8000-000000000001', new_id, 'morning');
           if (select time_slot from public.daily_affirmations where id = 'a0000000-0000-4000-8000-0000000000f1') is not null
              or (select time_slot from public.daily_affirmations where id = new_id) is distinct from 'morning' then
             raise exception 'the slot did not move' using errcode = 'P0002';
           end if;
         end $d$ $q$) = 'ok:0'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$select public.feature_affirmation('a0000000-0000-4000-8000-000000000001',
                                           'a0000000-0000-4000-8000-0000000000f1', 'night')$q$) = '22023'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$select public.feature_affirmation('a0000000-0000-4000-8000-000000000001',
                                           'b0000000-0000-4000-8000-0000000000f1', 'morning')$q$) = 'P0002');

  -- The app and visitors can neither move a slot nor add, reorder or unslot an affirmation: only the server does.
  insert into rls_results values (72, 'the app and visitors can neither move a slot nor add an affirmation',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$select public.feature_affirmation('a0000000-0000-4000-8000-000000000001',
                                           'a0000000-0000-4000-8000-0000000000f1', 'evening')$q$) = '42501'
    and pg_temp.try_as('anon', no_claims, null,
      $q$select public.feature_affirmation('a0000000-0000-4000-8000-000000000001',
                                           'a0000000-0000-4000-8000-0000000000f1', 'evening')$q$) = '42501'
    and not has_function_privilege('authenticated', 'public.feature_affirmation(uuid, uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.feature_affirmation(uuid, uuid, text)', 'execute')
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', null, 'h', 't')$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.daily_affirmations set position = 5
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.daily_affirmations set time_slot = null
         where id = 'a0000000-0000-4000-8000-0000000000f1'$q$) = '42501');

  -- What the migration made, as it made it: the slot index is partial (two affirmations without a slot are not a clash), the
  -- position trigger and both functions exist, and the slot column is optional.
  insert into rls_results values (73, 'one affirmation per slot is kept by a partial index, and a position is filled by a trigger',
    exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
             where c.relname = 'daily_affirmations_entry_slot_key' and i.indisunique and i.indpred is not null)
    and exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.daily_affirmations'::regclass and t.tgname = 'daily_affirmations_position')
    and to_regprocedure('public.set_affirmation_position()') is not null
    and to_regprocedure('public.feature_affirmation(uuid, uuid, text)') is not null
    and (select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'daily_affirmations' and column_name = 'time_slot') = 'YES');


  -- ===== Scholar conversations (step 38) =====
  -- Fixtures, made as the table owner: selftest_a has a conversation about its reflection (a question and its answer), and
  -- selftest_b one of its own. They go with their profiles at the end (cascade).
  insert into public.scholar_conversations (id, user_id, entry_id, title)
  values
    ('a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'a0000000-0000-4000-8000-000000000001', 'A Quiet Question'),
    ('b0000000-0000-4000-8000-0000000005c1', 'selftest_b', null, null);
  insert into public.scholar_messages (id, conversation_id, user_id, role, reply_to, input_type, status, content)
  values
    ('a0000000-0000-4000-8000-0000000005d1', 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'user', null, 'text',
     'ready', '{"blocks": [{"type": "text", "text": "a question"}]}'),
    ('a0000000-0000-4000-8000-0000000005d2', 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'scholar',
     'a0000000-0000-4000-8000-0000000005d1', null, 'ready', '{"blocks": [{"type": "text", "text": "an answer"}]}'),
    ('b0000000-0000-4000-8000-0000000005d1', 'b0000000-0000-4000-8000-0000000005c1', 'selftest_b', 'user', null, 'text',
     'ready', '{"blocks": [{"type": "text", "text": "b question"}]}'),
    ('b0000000-0000-4000-8000-0000000005d2', 'b0000000-0000-4000-8000-0000000005c1', 'selftest_b', 'scholar',
     'b0000000-0000-4000-8000-0000000005d1', null, 'ready', '{"blocks": [{"type": "text", "text": "b answer"}]}');

  -- The four tables, each with row level security on, and none a visitor can read or write.
  insert into rls_results values (74, 'the four Scholar tables exist with row level security on, and a visitor touches none',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and c.relname in ('scholar_conversations', 'scholar_messages', 'scholar_usage', 'scholar_safety_daily')) = 4
    and pg_temp.try_as('anon', no_claims, null, 'select * from public.scholar_conversations') = '42501'
    and pg_temp.try_as('anon', no_claims, null, 'select * from public.scholar_messages') = '42501'
    and pg_temp.try_as('anon', no_claims, null, 'select * from public.scholar_usage') = '42501'
    and pg_temp.try_as('anon', no_claims, null, 'select * from public.scholar_safety_daily') = '42501'
    and pg_temp.try_as('anon', no_claims, null,
      $q$insert into public.scholar_conversations (id, user_id) values (gen_random_uuid(), 'selftest_a')$q$) = '42501'
    and pg_temp.try_as('anon', no_claims, null,
      $q$delete from public.scholar_conversations where id = 'a0000000-0000-4000-8000-0000000005c1'$q$) = '42501');

  -- A person reads their own conversations and messages, and never another person's.
  insert into rls_results values (75, 'a person reads their own Scholar conversations and messages and nobody else''s',
    pg_temp.try_as('authenticated', claims_a, null, 'select * from public.scholar_conversations') = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null, 'select * from public.scholar_messages') = 'ok:2'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$select * from public.scholar_conversations where id = 'b0000000-0000-4000-8000-0000000005c1'$q$) = 'ok:0'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$select * from public.scholar_messages where conversation_id = 'b0000000-0000-4000-8000-0000000005c1'$q$) = 'ok:0');

  -- The title, the heavy mark and every message are the server's: the app inserts and updates nothing.
  insert into rls_results values (76, 'the app cannot insert or update a Scholar conversation or message',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into public.scholar_conversations (id, user_id) values (gen_random_uuid(), 'selftest_a')$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, content)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'user', null)$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.scholar_conversations set title = 'Mine' where id = 'a0000000-0000-4000-8000-0000000005c1'$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.scholar_conversations set is_heavy = false
         where id = 'a0000000-0000-4000-8000-0000000005c1'$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.scholar_messages set content = null where id = 'a0000000-0000-4000-8000-0000000005d2'$q$) = '42501'
    and not exists (select 1 from information_schema.column_privileges
                     where table_schema = 'public' and table_name in ('scholar_conversations', 'scholar_messages')
                       and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE')));

  -- The app deletes its own conversation, and the messages go with it; another person's stays, and a message cannot be deleted
  -- on its own. A delete with no filter shows what the delete policy alone allows (with a filter, the select policy hides another
  -- person's row anyway).
  insert into rls_results values (77, 'the app deletes its own Scholar conversation with its messages, and never another''s',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$delete from public.scholar_conversations where id = 'b0000000-0000-4000-8000-0000000005c1'$q$) = 'ok:0'
    and pg_temp.try_as('authenticated', claims_a, null, 'delete from public.scholar_conversations') = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$delete from public.scholar_messages where id = 'a0000000-0000-4000-8000-0000000005d2'$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$do $d$
         begin
           delete from public.scholar_conversations where id = 'a0000000-0000-4000-8000-0000000005c1';
           if not found then
             raise exception 'the conversation was not deleted' using errcode = 'P0002';
           end if;
           if exists (select 1 from public.scholar_messages
                       where conversation_id = 'a0000000-0000-4000-8000-0000000005c1') then
             raise exception 'the messages stayed' using errcode = 'P0002';
           end if;
         end $d$ $q$) = 'ok:0');

  -- One conversation per reflection per person; any number with no reflection.
  insert into rls_results values (78, 'one Scholar conversation per reflection per person (a second is refused)',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_conversations (id, user_id, entry_id)
         values (gen_random_uuid(), 'selftest_a', 'a0000000-0000-4000-8000-000000000001')$q$) = '23505'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_conversations (id, user_id, entry_id)
         values (gen_random_uuid(), 'selftest_a', null), (gen_random_uuid(), 'selftest_a', null)$q$) = 'ok:2'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_conversations (id, user_id, entry_id)
         values (gen_random_uuid(), 'selftest_b', 'a0000000-0000-4000-8000-000000000001')$q$) = '23503');

  -- An answer points at a question, a question points at nothing, and a question has one answer.
  insert into rls_results values (79, 'a Scholar answer points at a question, a question at nothing, and one answer each',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, reply_to)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'scholar', null)$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, reply_to)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'user',
                 'a0000000-0000-4000-8000-0000000005d1')$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, reply_to)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'scholar',
                 'a0000000-0000-4000-8000-0000000005d1')$q$) = '23505'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, reply_to)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'scholar', gen_random_uuid())$q$)
      = '23503'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role)
         values (gen_random_uuid(), 'b0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'user')$q$) = '23503');

  -- A message's role, status and input type come from their lists, and its content is at most 16 KB.
  insert into rls_results values (80, 'a Scholar message''s role, status and input type are from their lists, content at most 16 KB',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'admin')$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, status)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'user', 'done')$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, input_type)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'user', 'voice')$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, content)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'user',
                 jsonb_build_object('blocks', jsonb_build_array(
                   jsonb_build_object('type', 'text', 'text', repeat('x', 20000)))))$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.scholar_messages (id, conversation_id, user_id, role, input_type, status, content)
         values (gen_random_uuid(), 'a0000000-0000-4000-8000-0000000005c1', 'selftest_a', 'user', 'audio', 'pending', null)$q$)
      = 'ok:1');

  -- Deleting a reflection deletes its conversation and messages (delete-entry deletes the reflection as the server).
  insert into rls_results values (81, 'deleting a reflection removes its Scholar conversation and messages',
    pg_temp.try_as('service_role', no_claims, null,
      $q$do $d$
         begin
           delete from public.journal_entries where id = 'a0000000-0000-4000-8000-000000000001';
           if exists (select 1 from public.scholar_conversations where id = 'a0000000-0000-4000-8000-0000000005c1')
              or exists (select 1 from public.scholar_messages
                          where conversation_id = 'a0000000-0000-4000-8000-0000000005c1') then
             raise exception 'the conversation stayed' using errcode = 'P0002';
           end if;
         end $d$ $q$) = 'ok:0');

  -- Deleting the profile removes its conversations, messages and usage (account deletion deletes the profile).
  insert into rls_results values (82, 'deleting the profile removes its Scholar conversations, messages and usage',
    pg_temp.try_as('service_role', no_claims, null,
      $q$do $d$
         begin
           insert into public.users_profile (id) values ('selftest_e');
           insert into public.scholar_conversations (id, user_id)
             values ('e0000000-0000-4000-8000-0000000005c1', 'selftest_e');
           insert into public.scholar_messages (id, conversation_id, user_id, role)
             values ('e0000000-0000-4000-8000-0000000005d1', 'e0000000-0000-4000-8000-0000000005c1', 'selftest_e', 'user');
           insert into public.scholar_usage (user_id, day, messages) values ('selftest_e', current_date, 1);
           delete from public.users_profile where id = 'selftest_e';
           if exists (select 1 from public.scholar_conversations where user_id = 'selftest_e')
              or exists (select 1 from public.scholar_messages where user_id = 'selftest_e')
              or exists (select 1 from public.scholar_usage where user_id = 'selftest_e') then
             raise exception 'rows stayed' using errcode = 'P0002';
           end if;
         end $d$ $q$) = 'ok:0');

  -- The usage table is the server's alone, and its counter adds to a day's row (making it the first time).
  insert into rls_results values (83, 'the Scholar usage table is invisible to the app, and bump_scholar_usage adds to a day',
    pg_temp.try_as('authenticated', claims_a, null, 'select * from public.scholar_usage') = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into public.scholar_usage (user_id, day, messages) values ('selftest_a', current_date, 0)$q$) = '42501'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$do $d$
         begin
           perform public.bump_scholar_usage('selftest_a', date '2000-01-01', 1, 0);
           perform public.bump_scholar_usage('selftest_a', date '2000-01-01', 2, 1);
           if (select messages from public.scholar_usage where user_id = 'selftest_a' and day = date '2000-01-01') <> 3
              or (select listens from public.scholar_usage where user_id = 'selftest_a' and day = date '2000-01-01') <> 1 then
             raise exception 'the counts did not add up' using errcode = 'P0002';
           end if;
         end $d$ $q$) = 'ok:0'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$select public.bump_scholar_usage('selftest_a', date '2000-01-01', -1, 0)$q$) = '22023');

  -- The safety table is the server's alone, holds no person, and its counter takes only its nine names.
  insert into rls_results values (84, 'the Scholar safety table is invisible to the app, and its counter takes nine names only',
    pg_temp.try_as('authenticated', claims_a, null, 'select * from public.scholar_safety_daily') = '42501'
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'scholar_safety_daily'
                       and column_name in ('user_id', 'conversation_id', 'message_id'))
    and pg_temp.try_as('service_role', no_claims, null,
      $q$do $d$
         begin
           perform public.bump_scholar_safety(date '2000-01-01', 'screened');
           perform public.bump_scholar_safety(date '2000-01-01', 'screened');
           perform public.bump_scholar_safety(date '2000-01-01', 'free_answered');
           if (select screened from public.scholar_safety_daily where day = date '2000-01-01') <> 2
              or (select free_answered from public.scholar_safety_daily where day = date '2000-01-01') <> 1
              or (select flagged_phrase from public.scholar_safety_daily where day = date '2000-01-01') <> 0 then
             raise exception 'the counts are wrong' using errcode = 'P0002';
           end if;
         end $d$ $q$) = 'ok:0'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$select public.bump_scholar_safety(date '2000-01-01', 'day')$q$) = '22023'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$select public.bump_scholar_safety(date '2000-01-01', 'screened = 99, free_answered')$q$) = '22023');

  -- Only the server may run the two counters.
  insert into rls_results values (85, 'the two Scholar counters can be run by the server only',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$select public.bump_scholar_usage('selftest_a', current_date, 1, 0)$q$) = '42501'
    and pg_temp.try_as('anon', no_claims, null,
      $q$select public.bump_scholar_safety(current_date, 'screened')$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$select public.bump_scholar_safety(current_date, 'screened')$q$) = '42501'
    and not has_function_privilege('authenticated', 'public.bump_scholar_usage(text, date, integer, integer)', 'execute')
    and not has_function_privilege('anon', 'public.bump_scholar_usage(text, date, integer, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.bump_scholar_safety(date, text)', 'execute')
    and not has_function_privilege('anon', 'public.bump_scholar_safety(date, text)', 'execute')
    and has_function_privilege('service_role', 'public.bump_scholar_usage(text, date, integer, integer)', 'execute')
    and has_function_privilege('service_role', 'public.bump_scholar_safety(date, text)', 'execute'));

  -- ===== Help lines (supabase/migrations/20261111130000_help_lines.sql) =====
  -- The server saves a heavy moment's help line, one of four words, and no other entry may hold one.
  insert into rls_results values (86, 'a heavy moment holds one of four help lines, and no other entry holds one',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, help_line)
         values ('selftest_a', 'text', true, 'abuse')$q$) = 'ok:1'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, help_line)
         values ('selftest_a', 'text', true, 'emergency')$q$) = 'ok:1'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, help_line)
         values ('selftest_a', 'text', true, null)$q$) = 'ok:1'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, help_line)
         values ('selftest_a', 'text', true, 'shelter')$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, help_line)
         values ('selftest_a', 'text', false, 'crisis')$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.journal_entries set help_line = 'crisis'
         where id = 'a0000000-0000-4000-8000-000000000001' and not is_crisis$q$) = '23514');

  -- The app reads its own entries' help line and its own closing time, and writes neither; the server writes the closing time.
  insert into rls_results values (87, 'the app reads a help line and Scholar''s closing time, and only the server writes them',
    pg_temp.try_as('authenticated', claims_a, null,
      $q$select help_line from public.journal_entries where id = 'a0000000-0000-4000-8000-000000000001'$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$select scholar_closed_at from public.users_profile where id = 'selftest_a'$q$) = 'ok:1'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.journal_entries set help_line = null
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set scholar_closed_at = now() where id = 'selftest_a'$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.users_profile set scholar_closed_at = null where id = 'selftest_a'$q$) = '42501'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$update public.users_profile set scholar_closed_at = now() where id = 'selftest_a'$q$) = 'ok:1'
    and pg_temp.try_as('anon', no_claims, null,
      $q$select scholar_closed_at from public.users_profile$q$) = '42501');

  -- What the migration made, as it made it: two optional columns and the two rules.
  insert into rls_results values (88, 'the help line and Scholar''s closing time are optional columns with their two rules',
    (select data_type || ':' || is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'journal_entries' and column_name = 'help_line') = 'text:YES'
    and (select data_type || ':' || is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'users_profile' and column_name = 'scholar_closed_at')
        = 'timestamp with time zone:YES'
    and (select count(*) from pg_constraint
          where conrelid = 'public.journal_entries'::regclass and conname in ('help_line_kind', 'help_line_crisis')) = 2);

  -- Leave nothing behind: the fixtures go, and with them (cascade) their entries, affirmations and Scholar's rows.
  delete from public.users_profile where id like 'selftest\_%';
  -- The fixtures fired the broadcast triggers (step 33). Their messages went to self-test topics that no account can join; they go
  -- too where this role may delete them (a hosted project's editor may not: they stay until Supabase drops the day's table).
  begin
    delete from realtime.messages where topic like 'user:selftest\_%';
  exception when others then
    null;
  end;
end $$;

select position, check_name, passed from rls_results order by position;
