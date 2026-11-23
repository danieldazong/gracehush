-- 2026-11-20: one free conversation with Scholar. An account that is not Pro (the free plan and the free trial) may have one
-- conversation with Scholar, ever: up to eight answered messages, its answers read aloud and a few minutes of live talk in it.
-- The server decides the numbers (supabase/functions/_shared/scholar/constants.ts, SCHOLAR_FREE); this table remembers which
-- conversation claimed the free one and how many of its messages were answered, so that deleting the conversation does not give
-- it back. A heavy message is never counted and a heavy conversation never claims it.
--
-- Additive: one new table and two functions for the server. Nothing that exists is altered.
--   scholar_free_use       one row per person: the conversation that claimed the free conversation (no foreign key, on purpose:
--                          the row outlives the conversation) and how many of its messages were answered for free.
-- The app may read its own row (to know which conversation is the free one and how many messages are left) and nothing else;
-- only the server writes. Deleting a profile deletes its row.
--
-- It is safe to run again, and it deletes no data. Run it after 20261118120000_scholar_credits.sql, before scholar-turn,
-- scholar-speak and scholar-voice-start are deployed.

-- 1. A person's free conversation.
create table if not exists public.scholar_free_use (
  user_id         text        primary key references public.users_profile (id) on delete cascade,
  conversation_id uuid        not null,
  messages        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint scholar_free_use_messages check (messages >= 0)
);

-- 2. The server's writes. A free message answered: the first one claims the conversation, a later one in the same conversation
--    is added, and one in another conversation changes nothing (two first messages sent at once in two conversations: the first
--    to arrive is the free one). A live talk claims the conversation it starts in when nothing has (with no message counted), and
--    answers the conversation that holds the free one either way.
create or replace function public.use_scholar_free_message(p_user text, p_conversation uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user is null or p_conversation is null then
    raise exception 'user and conversation are required' using errcode = '22023';
  end if;
  insert into public.scholar_free_use as f (user_id, conversation_id, messages, updated_at)
  values (p_user, p_conversation, 1, now())
  on conflict (user_id) do update
    set messages = f.messages + 1,
        updated_at = now()
    where f.conversation_id = excluded.conversation_id;
end
$$;

create or replace function public.claim_scholar_free_conversation(p_user text, p_conversation uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed uuid;
begin
  if p_user is null or p_conversation is null then
    raise exception 'user and conversation are required' using errcode = '22023';
  end if;
  insert into public.scholar_free_use (user_id, conversation_id, messages)
  values (p_user, p_conversation, 0)
  on conflict (user_id) do nothing;
  select f.conversation_id into claimed from public.scholar_free_use f where f.user_id = p_user;
  return claimed;
end
$$;

revoke all on function public.use_scholar_free_message(text, uuid) from public, anon, authenticated;
grant execute on function public.use_scholar_free_message(text, uuid) to service_role;
revoke all on function public.claim_scholar_free_conversation(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_scholar_free_conversation(text, uuid) to service_role;

-- 3. Grants. Everything is revoked first (with "Automatically expose new tables" on, a new table starts granted to everyone).
--    The app reads its own row; nothing else.
revoke all on public.scholar_free_use from anon, authenticated;
grant select on public.scholar_free_use to authenticated;
grant select, insert, update, delete on public.scholar_free_use to service_role;

-- 4. Row level security: the app sees its own row only.
alter table public.scholar_free_use enable row level security;

drop policy if exists scholar_free_use_select_own on public.scholar_free_use;
create policy scholar_free_use_select_own on public.scholar_free_use
  for select to authenticated
  using (user_id = (select public.requesting_user_id()));

notify pgrst, 'reload schema';
