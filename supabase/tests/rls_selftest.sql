-- Gracehush v1 schema self-test (step 18). Run it AFTER supabase/migrations/20261022120100_gracehush_v1_schema.sql, in the
-- same SQL editor (or offline with supabase/tests/run-in-pglite.mjs).
--
-- It pretends to be three signed-in users, a signed-out visitor and the server (service_role). For every rule it tries
-- what must work and what must be refused, and it undoes each attempt, so nothing is left behind except its own test
-- fixtures, which it deletes at the end. Every row of the result must say passed = true.
-- It is safe to run again, also when the tables hold real accounts: it touches only ids that start with "selftest_".

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

  insert into rls_results values (21, 'an entry cannot become a crisis entry while it holds a devotional',
    pg_temp.try_as('service_role', no_claims,
      $q$update public.journal_entries set devotional_script = 'a script'
         where id = 'a0000000-0000-4000-8000-000000000001'$q$,
      $q$update public.journal_entries set is_crisis = true
         where id = 'a0000000-0000-4000-8000-000000000001'$q$) = '23514');

  all_ok := true;
  foreach stmt in array array[
    $q$insert into public.journal_entries (user_id, input_type) values ('selftest_a', 'voice')$q$,
    $q$insert into public.journal_entries (user_id, input_type, processing_status) values ('selftest_a', 'text', 'done')$q$,
    $q$insert into public.journal_entries (user_id, input_type, prayer_category) values ('selftest_a', 'text', 'MONEY')$q$,
    $q$insert into public.journal_entries (user_id, input_type, prayer_summary)
       values ('selftest_a', 'text', repeat('x', 201))$q$,
    $q$insert into public.journal_entries (user_id, input_type, devotional_duration_ms) values ('selftest_a', 'text', -1)$q$,
    $q$insert into public.journal_entries (user_id, input_type, is_crisis, devotional_script)
       values ('selftest_a', 'text', true, 'a script')$q$]
  loop
    outcome := pg_temp.try_as('service_role', no_claims, null, stmt);
    all_ok := all_ok and outcome = '23514';
  end loop;
  insert into rls_results values (22, 'a bad input type, status, category, summary, duration or crisis row is refused', all_ok);

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

  insert into rls_results values (29, 'an entry has one affirmation per slot',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', 'morning', 'h', 't')$q$) = '23505');

  insert into rls_results values (30, 'an unknown time slot is refused',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-000000000001', 'night', 'h', 't')$q$) = '23514');

  insert into rls_results values (31, 'a crisis entry never gets affirmations',
    pg_temp.try_as('service_role', no_claims,
      $q$insert into public.journal_entries (id, user_id, input_type, is_crisis)
         values ('a0000000-0000-4000-8000-0000000000c1', 'selftest_a', 'text', true)$q$,
      $q$insert into public.daily_affirmations (user_id, entry_id, time_slot, headline, affirmation_text)
         values ('selftest_a', 'a0000000-0000-4000-8000-0000000000c1', 'evening', 'h', 't')$q$) = '23514');

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

  insert into rls_results values (44, 'a crisis entry is never a prayer',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, is_active_prayer)
         values ('selftest_a', 'text', true, true)$q$) = '23514'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.journal_entries (user_id, input_type, is_crisis, prayer_summary)
         values ('selftest_a', 'text', true, 'a summary')$q$) = '23514'
    and pg_temp.try_as('authenticated', claims_a,
      $q$insert into public.journal_entries (id, user_id, input_type, is_crisis)
         values ('a0000000-0000-4000-8000-0000000000c2', 'selftest_a', 'text', true)$q$,
      $q$update public.journal_entries set is_active_prayer = true
         where id = 'a0000000-0000-4000-8000-0000000000c2'$q$) = '23514');

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

  -- Leave nothing behind: the fixtures go, and with them (cascade) their entries and affirmations.
  delete from public.users_profile where id like 'selftest\_%';
end $$;

select position, check_name, passed from rls_results order by position;
