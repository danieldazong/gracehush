-- Gracehush base schema (step 17).
-- Run it ONCE in the SQL editor of the Gracehush Supabase project, then run supabase/selftest.sql to check it.
-- It is safe to run again. From step 18 on, every database change goes in supabase/migrations/, and this file
-- stays as documentation of the starting point (step 18 creates the other tables and baselines this one).

-- 1. Who is asking: the Clerk user id, taken from the "sub" claim of the session token.
--    It is text ("user_2abc..."), never a uuid, so auth.uid() cannot be used with Clerk.
create or replace function public.requesting_user_id()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif((select auth.jwt()) ->> 'sub', '')
$$;

-- 2. One profile row per Clerk user. The app creates its own row the first time the user signs in.
create table if not exists public.users_profile (
  id                 text        primary key,
  created_at         timestamptz not null default now(),
  subscription_tier  text        not null default 'free'
                     check (subscription_tier in ('free', 'trial', 'pro')),
  reminder_morning   time        not null default '08:00',
  reminder_afternoon time        not null default '13:00',
  reminder_evening   time        not null default '20:00',
  last_active_at     timestamptz
);

comment on column public.users_profile.subscription_tier is
  'Written only by the server (service_role), from the RevenueCat webhook in step 30. The app has no INSERT or UPDATE grant on this column.';

-- 3. Row level security: a signed-in user can read and change only their own row.
--    There is no delete policy: the server deletes accounts (step 31).
alter table public.users_profile enable row level security;

drop policy if exists users_profile_select_own on public.users_profile;
create policy users_profile_select_own on public.users_profile
  for select to authenticated
  using (id = (select public.requesting_user_id()));

drop policy if exists users_profile_insert_own on public.users_profile;
create policy users_profile_insert_own on public.users_profile
  for insert to authenticated
  with check (id = (select public.requesting_user_id()));

drop policy if exists users_profile_update_own on public.users_profile;
create policy users_profile_update_own on public.users_profile
  for update to authenticated
  using (id = (select public.requesting_user_id()))
  with check (id = (select public.requesting_user_id()));

-- 4. What the app may write. Postgres ignores a column-level REVOKE while a table-wide GRANT exists, so take
--    everything away first and give back only what the app needs. The app can never write subscription_tier
--    or created_at, and nobody signed out (anon) can touch the table at all.
revoke all on public.users_profile from anon, authenticated;
grant select on public.users_profile to authenticated;
grant insert (id, reminder_morning, reminder_afternoon, reminder_evening)
  on public.users_profile to authenticated;
grant update (reminder_morning, reminder_afternoon, reminder_evening)
  on public.users_profile to authenticated;
