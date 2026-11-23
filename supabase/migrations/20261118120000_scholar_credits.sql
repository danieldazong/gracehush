-- 2026-11-18: Scholar's credits. Scholar is for paying Pro accounts (the free plan and the free trial do not include it, except
-- that a heavy conversation is answered for everyone and never counted), and a Pro account's messages and answers read aloud
-- spend credits from an allowance that renews 24 hours after its first use, the way Claude's own limit does. The server decides
-- the allowance and the costs (supabase/functions/_shared/scholar/constants.ts); this table only remembers what was spent.
--
-- Additive: one new table and one function for the server. Nothing that exists is altered.
--   scholar_credits        one row per person: how many credits were used in the current window, the allowance the server
--                          gave it, and when the window renews. A window starts at the first spend after the last one ended.
-- The app may read its own row (to show how much is left and when it renews) and nothing else; only the server writes.
-- Deleting a profile deletes its row.
--
-- It is safe to run again, and it deletes no data. Run it after 20261113120000_scholar_voice.sql, before scholar-turn and
-- scholar-speak are deployed.

-- 1. A person's credits for the current window.
create table if not exists public.scholar_credits (
  user_id    text        primary key references public.users_profile (id) on delete cascade,
  used       integer     not null default 0,
  allowance  integer     not null,
  renews_at  timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint scholar_credits_used check (used >= 0),
  constraint scholar_credits_allowance check (allowance > 0)
);

-- 2. The server's one write: spend credits. A window that has ended (or no row at all) starts again from this spend, renewing
--    p_window_seconds later; otherwise the cost is added to the window that runs. The allowance is the server's current one.
create or replace function public.spend_scholar_credits(p_user text, p_cost integer, p_allowance integer, p_window_seconds integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_cost is null or p_allowance is null or p_window_seconds is null
     or p_cost < 1 or p_allowance < 1 or p_window_seconds < 60 then
    raise exception 'cost, allowance and window are positive' using errcode = '22023';
  end if;
  insert into public.scholar_credits as c (user_id, used, allowance, renews_at, updated_at)
  values (p_user, p_cost, p_allowance, now() + make_interval(secs => p_window_seconds), now())
  on conflict (user_id) do update
    set used = case when c.renews_at <= now() then excluded.used else c.used + excluded.used end,
        allowance = excluded.allowance,
        renews_at = case when c.renews_at <= now() then excluded.renews_at else c.renews_at end,
        updated_at = now();
end
$$;

revoke all on function public.spend_scholar_credits(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.spend_scholar_credits(text, integer, integer, integer) to service_role;

-- 3. Grants. Everything is revoked first (with "Automatically expose new tables" on, a new table starts granted to everyone).
--    The app reads its own row; nothing else.
revoke all on public.scholar_credits from anon, authenticated;
grant select on public.scholar_credits to authenticated;
grant select, insert, update, delete on public.scholar_credits to service_role;

-- 4. Row level security: the app sees its own row only.
alter table public.scholar_credits enable row level security;

drop policy if exists scholar_credits_select_own on public.scholar_credits;
create policy scholar_credits_select_own on public.scholar_credits
  for select to authenticated
  using (user_id = (select public.requesting_user_id()));

notify pgrst, 'reload schema';
