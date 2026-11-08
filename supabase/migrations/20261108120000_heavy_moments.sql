-- GraceHush: a heavy moment is a whole reflection (2026-11-08, process-entry gen-v2.4).
--
-- Until now an entry that showed a risk of self-harm, abuse or danger (is_crisis) was saved as the person's own words and
-- nothing else, and the app showed support resources in place of a devotional. From gen-v2.4 such an entry, a heavy moment, is a
-- whole reflection: a devotional written under extra care, a comforting passage, a first line, a closing prayer, three
-- affirmations and the spoken devotional. The column keeps its name and now means "a heavy moment". The four rules that kept a
-- crisis entry empty go:
--   journal_entries_crisis_check  (no devotional, audio or passage),
--   crisis_not_prayer             (never a prayer: the server still never makes one a prayer by itself, and the person may mark
--                                  it as a prayer request like any other reflection),
--   validation_line_crisis        (no first line),
--   the trigger daily_affirmations_no_crisis with its function reject_affirmation_for_crisis_entry() (no affirmations).
-- The run of reflection days counts a finished entry that has its devotional: a heavy moment since gen-v2.4 counts, and one saved
-- before it (the words only) does not, as before.
--
-- What stays: a verified passage has its text, a prayer is answered on a date and only then, the note's and the first line's
-- lengths, one affirmation per slot that belongs to the entry's user, and the app still cannot write is_crisis or any column the
-- server writes.
--
-- It deletes no data and is safe to run again. Run it after 20261107120000_validation_line.sql, and never run an earlier file
-- again afterwards: they add back the rules this one removes, and adding them back would refuse the heavy moments saved since.

-- 1. The rules that kept a crisis entry empty.
alter table public.journal_entries drop constraint if exists journal_entries_crisis_check;
alter table public.journal_entries drop constraint if exists crisis_not_prayer;
alter table public.journal_entries drop constraint if exists validation_line_crisis;
drop trigger if exists daily_affirmations_no_crisis on public.daily_affirmations;
drop function if exists public.reject_affirmation_for_crisis_entry();

-- 2. The run of reflection days, as Journal Home counts it (getReflectionDays): consecutive local days in tz, ending today or
--    yesterday, each with a finished entry that has its devotional. 0 when there is none today or yesterday. An unknown zone
--    raises 22023. The same function as step 33's, but for the one line that chooses the days.
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
      and e.devotional_script is not null
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
