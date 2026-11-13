-- 2026-11-11: Scholar conversations (step 38). Scholar is GraceHush's Bible companion: a person asks about a verse or brings a
-- hard day, asks follow-up questions, and gets answers written by the server (the Edge Function scholar-turn). The phone keeps a
-- conversation in memory only; this is where it lives.
--
-- Additive: four new tables and two functions for the server. Nothing that exists is altered, and nothing here sends a Realtime
-- message.
--   scholar_conversations  one row per conversation, made with the id the phone gave it; optionally tied to one reflection
--                          (one conversation per reflection per person), and marked heavy for good once a message in it showed a
--                          risk to the person (the server reads that mark on every message).
--   scholar_messages       a person's message and Scholar's answer to it, as blocks of text, passages and a prayer.
--   scholar_usage          how many messages and listened answers a person had on a day (the server's limits; never the app's).
--   scholar_safety_daily   anonymous counts for a day: how many messages were screened, which layer flagged one, how many got the
--                          written fallback. No person, no conversation, no words.
-- The app may read its own conversations and messages and delete its own conversations (their messages go with them). It can
-- insert and update nothing, and it can touch neither the usage nor the safety table: only the server (service_role) writes.
-- Deleting a reflection deletes its conversation, and deleting a profile deletes everything of that person here.
--
-- It is safe to run again, and it deletes no data. Run it after 20261109120000_more_affirmations.sql, before scholar-turn and
-- scholar-speak are deployed.

-- 1. Conversations. The id is made on the phone (a retried message names the same conversation).
create table if not exists public.scholar_conversations (
  id              uuid        primary key,
  user_id         text        not null references public.users_profile (id) on delete cascade,
  entry_id        uuid,
  title           text,
  is_heavy        boolean     not null default false,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  -- The reflection it was opened from is the same person's, and it goes with that reflection.
  constraint scholar_conversations_entry_user_fkey foreign key (entry_id, user_id)
    references public.journal_entries (id, user_id) on delete cascade,
  -- What a message's composite key points at.
  constraint scholar_conversations_id_user_key unique (id, user_id),
  constraint scholar_conversations_title_length check (title is null or char_length(title) between 1 and 60)
);

-- One conversation per reflection per person.
create unique index if not exists scholar_conversations_user_entry_key
  on public.scholar_conversations (user_id, entry_id)
  where entry_id is not null;

-- The Scholar tab lists a person's conversations, the newest first.
create index if not exists scholar_conversations_user_last_idx
  on public.scholar_conversations (user_id, last_message_at desc);

-- 2. Messages. A person's message has the id the phone gave it; Scholar's answer points at that message (reply_to), and a
--    message has at most one answer. `content` is { "blocks": [ ... ] } (text, passage and prayer blocks), or null while a spoken
--    message has no words yet.
create table if not exists public.scholar_messages (
  id              uuid        primary key,
  conversation_id uuid        not null,
  user_id         text        not null references public.users_profile (id) on delete cascade,
  role            text        not null,
  reply_to        uuid        references public.scholar_messages (id) on delete cascade,
  input_type      text,
  status          text        not null default 'ready',
  error_code      text,
  content         jsonb,
  is_heavy        boolean     not null default false,
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  -- A message belongs to one conversation of the same person, and goes with it.
  constraint scholar_messages_conversation_user_fkey foreign key (conversation_id, user_id)
    references public.scholar_conversations (id, user_id) on delete cascade,
  constraint scholar_messages_role_check check (role in ('user', 'scholar')),
  constraint scholar_messages_status_check check (status in ('pending', 'ready', 'failed')),
  constraint scholar_messages_input_type_check check (input_type is null or input_type in ('text', 'audio')),
  -- An answer points at a question, and a question points at nothing.
  constraint scholar_messages_reply_shape check ((role = 'scholar') = (reply_to is not null)),
  constraint scholar_messages_content_size check (content is null or pg_column_size(content) <= 16384)
);

-- A question has at most one answer.
create unique index if not exists scholar_messages_reply_to_key
  on public.scholar_messages (reply_to)
  where reply_to is not null;

-- A conversation's messages in order.
create index if not exists scholar_messages_conversation_created_idx
  on public.scholar_messages (conversation_id, created_at);

-- The rate limit counts a person's own messages of the last ten minutes.
create index if not exists scholar_messages_user_created_idx
  on public.scholar_messages (user_id, created_at desc)
  where role = 'user';

-- 3. A person's counts for a calendar day of their profile's time zone. Only the server reads and writes them.
create table if not exists public.scholar_usage (
  user_id  text    not null references public.users_profile (id) on delete cascade,
  day      date    not null,
  messages integer not null default 0,
  listens  integer not null default 0,
  primary key (user_id, day),
  constraint scholar_usage_counts check (messages >= 0 and listens >= 0)
);

-- 4. Anonymous counts for a UTC day. No person, no conversation, no words.
create table if not exists public.scholar_safety_daily (
  day               date    primary key,
  screened          integer not null default 0,
  flagged_phrase    integer not null default 0,
  flagged_model     integer not null default 0,
  flagged_uncertain integer not null default 0,
  flagged_blocked   integer not null default 0,
  flagged_writer    integer not null default 0,
  fallbacks         integer not null default 0,
  screen_failed     integer not null default 0,
  free_answered     integer not null default 0
);

-- 5. The server's two counters. A call adds to a day's row, making it when there is none.
create or replace function public.bump_scholar_usage(p_user text, p_day date, p_messages integer, p_listens integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_messages is null or p_listens is null or p_messages < 0 or p_listens < 0 then
    raise exception 'counts are 0 or more' using errcode = '22023';
  end if;
  insert into public.scholar_usage as u (user_id, day, messages, listens)
  values (p_user, p_day, p_messages, p_listens)
  on conflict (user_id, day) do update
    set messages = u.messages + excluded.messages,
        listens = u.listens + excluded.listens;
end
$$;

create or replace function public.bump_scholar_safety(p_day date, p_counter text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_counter is null or p_counter not in ('screened', 'flagged_phrase', 'flagged_model', 'flagged_uncertain',
                                            'flagged_blocked', 'flagged_writer', 'fallbacks', 'screen_failed',
                                            'free_answered') then
    raise exception 'unknown counter' using errcode = '22023';
  end if;
  insert into public.scholar_safety_daily (day) values (p_day) on conflict (day) do nothing;
  execute format('update public.scholar_safety_daily set %1$I = %1$I + 1 where day = $1', p_counter) using p_day;
end
$$;

revoke all on function public.bump_scholar_usage(text, date, integer, integer) from public, anon, authenticated;
revoke all on function public.bump_scholar_safety(date, text) from public, anon, authenticated;
grant execute on function public.bump_scholar_usage(text, date, integer, integer) to service_role;
grant execute on function public.bump_scholar_safety(date, text) to service_role;

-- 6. Grants. Everything is revoked first (with "Automatically expose new tables" on, a new table starts granted to everyone).
--    The app reads its own conversations and messages and deletes its own conversations; nothing else. The cascade to the
--    messages runs as the table owner, so the app needs no delete on them.
revoke all on public.scholar_conversations, public.scholar_messages, public.scholar_usage, public.scholar_safety_daily
  from anon, authenticated;
grant select, delete on public.scholar_conversations to authenticated;
grant select on public.scholar_messages to authenticated;
grant select, insert, update, delete
  on public.scholar_conversations, public.scholar_messages, public.scholar_usage, public.scholar_safety_daily
  to service_role;

-- 7. Row level security on all four. The usage and safety tables have no policy: no app role can see a row of them.
alter table public.scholar_conversations enable row level security;
alter table public.scholar_messages enable row level security;
alter table public.scholar_usage enable row level security;
alter table public.scholar_safety_daily enable row level security;

drop policy if exists scholar_conversations_select_own on public.scholar_conversations;
create policy scholar_conversations_select_own on public.scholar_conversations
  for select to authenticated
  using (user_id = (select public.requesting_user_id()));

drop policy if exists scholar_conversations_delete_own on public.scholar_conversations;
create policy scholar_conversations_delete_own on public.scholar_conversations
  for delete to authenticated
  using (user_id = (select public.requesting_user_id()));

drop policy if exists scholar_messages_select_own on public.scholar_messages;
create policy scholar_messages_select_own on public.scholar_messages
  for select to authenticated
  using (user_id = (select public.requesting_user_id()));

notify pgrst, 'reload schema';
