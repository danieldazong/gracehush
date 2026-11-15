-- 2026-11-13: Scholar's live talk (step 39). A trial or Pro member can talk with Scholar out loud: ElevenLabs hears and speaks,
-- and the server writes every answer. This table is the server's own record of each talk, and it is where the talk time of a
-- month is counted (30 minutes a calendar month, at most 10 minutes a talk; the numbers live on the server).
--
-- Additive: one new table. Nothing that exists is altered, and nothing here sends a Realtime message.
--   scholar_voice_sessions  one row per talk: whose it is, the conversation it belongs to, the voice, when it started, when its
--                           last turn was answered, when it ended, the cap it was given in seconds (null for a talk with no
--                           cap), how long it ran, how many turns it had, and whether its conversation is heavy (a heavy talk
--                           is never counted and never cut by the cap).
-- A row holds no word that was said or spoken: what a talk said is saved as the conversation's own messages.
--
-- No app role can touch the table (no grant and no policy): only the Edge Functions (service_role) read and write it, as with
-- deleted_devotionals. There is deliberately no foreign key to scholar_conversations, so a row outlives its conversation:
-- deleting a conversation must not give talk time back. It follows the account instead (deleting a profile removes its rows).
--
-- It is safe to run again, and it deletes no data. Run it after 20261111130000_help_lines.sql, before scholar-voice-start,
-- scholar-voice-llm and scholar-voice-end are deployed.
create table if not exists public.scholar_voice_sessions (
  id              uuid        primary key,
  user_id         text        not null references public.users_profile (id) on delete cascade,
  conversation_id uuid        not null,
  voice           text        not null,
  started_at      timestamptz not null default now(),
  last_turn_at    timestamptz,
  ended_at        timestamptz,
  cap_seconds     integer,
  seconds         integer     not null default 0,
  turns           integer     not null default 0,
  is_heavy        boolean     not null default false,
  -- A talk never runs past ElevenLabs' own limit of 30 minutes (1,800 seconds), with a little room for its closing line.
  constraint scholar_voice_sessions_seconds_range check (seconds between 0 and 1900),
  constraint scholar_voice_sessions_turns_min check (turns >= 0),
  constraint scholar_voice_sessions_cap_range check (cap_seconds is null or cap_seconds between 30 and 600),
  constraint scholar_voice_sessions_voice_length check (char_length(voice) between 1 and 24)
);

-- The month's talk time and the day's starts are read by person, newest first.
create index if not exists scholar_voice_sessions_user_started_idx
  on public.scholar_voice_sessions (user_id, started_at desc);

alter table public.scholar_voice_sessions enable row level security;

-- Nobody signed in, and no signed-in user, can read or write it. service_role bypasses row level security but not grants.
revoke all on public.scholar_voice_sessions from anon, authenticated;
grant select, insert, update, delete on public.scholar_voice_sessions to service_role;

notify pgrst, 'reload schema';
