-- Gracehush preflight (step 18). READ-ONLY: it changes nothing, so it is always safe to run.
--
-- Run it in the SQL editor of the Gracehush project BEFORE applying supabase/migrations/20261022120100_gracehush_v1_schema.sql
-- (to see what is there), and again AFTER (to see what the migration did). The expected answers are in prompts/18.

select position, item, found
from (
  values
    (1, 'Postgres version', current_setting('server_version')),
    (2, 'table users_profile',
        case when to_regclass('public.users_profile') is null then 'MISSING' else 'exists' end),
    (3, 'users_profile columns',
        coalesce((select string_agg(column_name, ', ' order by ordinal_position)
                  from information_schema.columns
                  where table_schema = 'public' and table_name = 'users_profile'), 'none')),
    (4, 'users_profile row level security',
        case (select relrowsecurity from pg_class where oid = to_regclass('public.users_profile'))
          when true then 'on' when false then 'OFF' else 'n/a' end),
    (5, 'function requesting_user_id()',
        case when to_regprocedure('public.requesting_user_id()') is null then 'MISSING' else 'exists' end),
    (6, 'table journal_entries',
        case when to_regclass('public.journal_entries') is null then 'absent' else 'exists' end),
    (7, 'table daily_affirmations',
        case when to_regclass('public.daily_affirmations') is null then 'absent' else 'exists' end),
    (8, 'signed-out visitors (anon) can touch',
        coalesce(nullif((select string_agg(t.name, ', ' order by t.name)
                         from (values ('users_profile'), ('journal_entries'), ('daily_affirmations')) as t (name)
                         where to_regclass('public.' || t.name) is not null
                           and has_table_privilege('anon', 'public.' || t.name,
                                                   'select, insert, update, delete')), ''), 'nothing')),
    (9, 'policies on the public tables',
        coalesce((select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
                  from pg_policies where schemaname = 'public'), 'none')),
    (10, 'policies on storage.objects',
        coalesce((select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname)
                  from pg_policies where schemaname = 'storage' and tablename = 'objects'), 'none')),
    (11, 'bucket journal_media',
        coalesce((select case when public then 'PUBLIC' else 'private' end
                         || ', ' || coalesce((file_size_limit / 1048576)::text || ' MB', 'no size limit')
                         || ', ' || coalesce(array_to_string(allowed_mime_types, ' '), 'any file type')
                  from storage.buckets where id = 'journal_media'), 'absent')),
    (12, 'record of deleted devotionals (step 29b)',
        case
          when to_regclass('public.deleted_devotionals') is null then 'absent'
          else 'exists, row level security '
               || case when (select relrowsecurity from pg_class where oid = to_regclass('public.deleted_devotionals'))
                       then 'on' else 'OFF' end
               || ', the app roles can touch: '
               || coalesce(nullif((select string_agg(r.name, ', ' order by r.name)
                                   from (values ('anon'), ('authenticated')) as r (name)
                                   where has_table_privilege(r.name, 'public.deleted_devotionals',
                                                             'select, insert, update, delete')), ''), 'nothing')
        end),
    (13, 'subscription columns (step 30)',
        coalesce((select string_agg(column_name, ', ' order by column_name)
                  from information_schema.columns
                  where table_schema = 'public' and table_name = 'users_profile'
                    and column_name in ('subscription_expires_at', 'subscription_synced_at')), 'absent')),
    (14, 'bucket exports (step 31)',
        coalesce((select case when public then 'PUBLIC' else 'private' end
                         || ', ' || coalesce((file_size_limit / 1048576)::text || ' MB', 'no size limit')
                         || ', ' || coalesce(array_to_string(allowed_mime_types, ' '), 'any file type')
                  from storage.buckets where id = 'exports'), 'absent')),
    (15, 'Realtime messages and the run of reflection days (step 33)',
        'triggers: '
        || coalesce(nullif((select string_agg(t.tgname::text, ', ' order by t.tgname)
                            from pg_trigger t
                            where t.tgname in ('journal_entries_broadcast', 'daily_affirmations_broadcast')
                              and t.tgrelid in (to_regclass('public.journal_entries')::oid,
                                                to_regclass('public.daily_affirmations')::oid)), ''), 'none')
        || '; policy: '
        || case when exists (select 1 from pg_policies
                             where schemaname = 'realtime' and tablename = 'messages'
                               and policyname = 'user_broadcast_select_own') then 'exists' else 'absent' end
        || '; streak function: '
        || case when to_regprocedure('public.reflection_streak_days(text)') is null then 'absent' else 'exists' end),
    (16, 'the validation line (step 36)',
        case
          when not exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'journal_entries'
                              and column_name = 'validation_line') then 'absent'
          else 'exists; checks: '
               || coalesce(nullif((select string_agg(c.conname::text, ', ' order by c.conname)
                                   from pg_constraint c
                                   where c.conrelid = to_regclass('public.journal_entries')
                                     and c.conname in ('validation_line_length', 'validation_line_crisis')), ''), 'none')
        end),
    (17, 'heavy moments (2026-11-08): the old crisis rules still in place',
        coalesce(nullif(concat_ws(', ',
          (select string_agg(c.conname::text, ', ' order by c.conname)
             from pg_constraint c
            where c.conrelid = to_regclass('public.journal_entries')
              and c.conname in ('journal_entries_crisis_check', 'crisis_not_prayer', 'validation_line_crisis')),
          (select string_agg(t.tgname::text, ', ')
             from pg_trigger t
            where t.tgname = 'daily_affirmations_no_crisis' and t.tgrelid = to_regclass('public.daily_affirmations')::oid),
          (select 'the run of reflection days skips crisis entries'
             from pg_proc p
            where p.oid = to_regprocedure('public.reflection_streak_days(text)') and p.prosrc like '%is_crisis%')), ''),
          'none')),
    (18, 'affirmation verses (step 37)',
        case
          when (select count(*) from information_schema.columns
                 where table_schema = 'public' and table_name = 'daily_affirmations'
                   and column_name in ('verse_reference', 'verse_text')) < 2 then 'absent'
          else 'exists; checks: '
               || coalesce(nullif((select string_agg(c.conname::text, ', ' order by c.conname)
                                   from pg_constraint c
                                   where c.conrelid = to_regclass('public.daily_affirmations')
                                     and c.conname in ('affirmation_verse_pair', 'affirmation_verse_length')), ''), 'none')
        end),
    (19, 'more affirmations (2026-11-09)',
        case
          when not exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'daily_affirmations'
                              and column_name = 'position') then 'absent'
          else 'exists; time_slot '
               || case (select is_nullable from information_schema.columns
                         where table_schema = 'public' and table_name = 'daily_affirmations' and column_name = 'time_slot')
                    when 'YES' then 'optional' else 'REQUIRED' end
               || '; trigger: '
               || case when exists (select 1 from pg_trigger t
                                    where t.tgname = 'daily_affirmations_position'
                                      and t.tgrelid = to_regclass('public.daily_affirmations')::oid) then 'exists' else 'absent' end
               || '; feature_affirmation: '
               || case when to_regprocedure('public.feature_affirmation(uuid, uuid, text)') is null then 'absent' else 'exists' end
        end),
    (20, 'Scholar conversations (step 38)',
        case
          when to_regclass('public.scholar_conversations') is null then 'absent'
          else 'exists; tables: '
               || ((to_regclass('public.scholar_conversations') is not null)::int
                   + (to_regclass('public.scholar_messages') is not null)::int
                   + (to_regclass('public.scholar_usage') is not null)::int
                   + (to_regclass('public.scholar_safety_daily') is not null)::int)::text
               || ' of 4; counters: '
               || case when to_regprocedure('public.bump_scholar_usage(text, date, integer, integer)') is not null
                        and to_regprocedure('public.bump_scholar_safety(date, text)') is not null
                       then 'exist' else 'MISSING' end
        end),
    (21, 'help lines and Scholar''s closing time (2026-11-11)',
        case
          when not exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'journal_entries'
                              and column_name = 'help_line') then 'absent'
          else 'exists; checks: '
               || coalesce(nullif((select string_agg(c.conname::text, ', ' order by c.conname)
                                   from pg_constraint c
                                   where c.conrelid = to_regclass('public.journal_entries')
                                     and c.conname in ('help_line_kind', 'help_line_crisis')), ''), 'none')
               || '; scholar_closed_at: '
               || case when exists (select 1 from information_schema.columns
                                    where table_schema = 'public' and table_name = 'users_profile'
                                      and column_name = 'scholar_closed_at') then 'exists' else 'absent' end
        end)
) as checks (position, item, found)
order by position;
