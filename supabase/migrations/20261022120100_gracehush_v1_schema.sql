-- Gracehush v1 schema (step 18).
--
-- Creates journal_entries and daily_affirmations, extends users_profile, decides exactly what the signed-in app may
-- write, and creates the private journal_media bucket with one folder per user.
--
-- It is safe to run again (every statement is idempotent) and it never deletes data. Do not edit it after it has been
-- applied anywhere: add a new migration instead.
--
-- The hosted project was created with "Automatically expose new tables" OFF, so a new table is invisible to the Data
-- API until it is granted. Every grant below is therefore explicit, service_role included (the Edge Functions and the
-- RevenueCat webhook reach the tables through it). Postgres ignores a column-level REVOKE while a table-level GRANT
-- exists, so each table is revoked first and granted back column by column.
--
-- The signed-in app can write only: its own reminder times, time zone and three settings (users_profile), the prayer
-- columns of its own entries, and is_favorite on its own affirmations. It cannot insert or delete entries or
-- affirmations, and it can never write subscription_tier, is_crisis, processing_status or anything the server wrote.

-- 1. One trigger function keeps updated_at honest. The app never writes updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

-- 2. users_profile: the three settings Profile saves (they were kept on the phone until now), the time zone and
--    updated_at.
alter table public.users_profile
  add column if not exists affirmations_enabled boolean     not null default true,
  add column if not exists ambient_sound        text        not null default 'off',
  add column if not exists ambient_volume       real        not null default 0.5,
  add column if not exists timezone             text        not null default 'UTC',
  add column if not exists updated_at           timestamptz not null default now();

alter table public.users_profile
  drop constraint if exists users_profile_ambient_sound_check,
  add constraint users_profile_ambient_sound_check
    check (ambient_sound in ('off', 'soft-rain', 'gentle-piano', 'morning-birds'));

alter table public.users_profile
  drop constraint if exists users_profile_ambient_volume_check,
  add constraint users_profile_ambient_volume_check
    check (ambient_volume >= 0 and ambient_volume <= 1);

alter table public.users_profile
  drop constraint if exists users_profile_timezone_check,
  add constraint users_profile_timezone_check
    check (char_length(timezone) between 1 and 64);

comment on column public.users_profile.timezone is
  'An IANA zone such as Africa/Lagos, written by the app from the phone. The server uses it for the week boundary of the free limit.';

drop trigger if exists users_profile_set_updated_at on public.users_profile;
create trigger users_profile_set_updated_at
  before update on public.users_profile
  for each row execute function public.set_updated_at();

-- 3. journal_entries: one row per reflection. Only the Edge Function (service_role) creates rows and fills the
--    server columns; the app reads them and changes the prayer columns.
create table if not exists public.journal_entries (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                text        not null references public.users_profile (id) on delete cascade,
  client_entry_id        uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  input_type             text        not null,
  transcript             text,
  audio_path             text,
  processing_status      text        not null default 'pending',
  error_code             text,
  is_crisis              boolean     not null default false,
  dominant_emotion       text,
  scripture_reference    text,
  scripture_text         text,
  scripture_verified     boolean     not null default false,
  devotional_title       text,
  devotional_script      text,
  closing_prayer         text,
  devotional_audio_path  text,
  devotional_duration_ms integer,
  is_active_prayer       boolean     not null default false,
  is_answered            boolean     not null default false,
  answered_at            timestamptz,
  answered_notes         text,
  prayer_title           text,
  prayer_category        text,
  prayer_summary         text,
  -- A retried submit must never create a second row: the Edge Function inserts with ON CONFLICT DO NOTHING on this.
  constraint journal_entries_client_entry_key unique (user_id, client_entry_id),
  -- Lets daily_affirmations prove that an affirmation and its entry belong to the same user.
  constraint journal_entries_id_user_key unique (id, user_id),
  constraint journal_entries_input_type_check check (input_type in ('text', 'audio')),
  constraint journal_entries_status_check
    check (processing_status in ('pending', 'uploading', 'processing', 'ready', 'failed')),
  constraint journal_entries_duration_check
    check (devotional_duration_ms is null or devotional_duration_ms >= 0),
  constraint journal_entries_prayer_category_check
    check (prayer_category is null or prayer_category in
      ('FAMILY & HEALING', 'VOCATION & CALLING', 'INNER PEACE', 'RELATIONSHIPS', 'PROVISION', 'GUIDANCE')),
  constraint journal_entries_prayer_summary_check
    check (prayer_summary is null or char_length(prayer_summary) <= 200),
  -- Crisis safety: a crisis entry never carries a devotional, audio or scripture, whatever wrote the row.
  constraint journal_entries_crisis_check
    check (not is_crisis or (
      devotional_title is null and devotional_script is null and closing_prayer is null
      and devotional_audio_path is null and scripture_reference is null and scripture_text is null)),
  -- ... and is never a prayer (the prayer rules of step 29, here from the start while the table is empty).
  constraint crisis_not_prayer
    check (not is_crisis or (
      not is_active_prayer and not is_answered
      and prayer_title is null and prayer_category is null and prayer_summary is null)),
  -- A prayer is answered on a date and only then: marking and unmarking always move the two together.
  constraint answered_fields_match check (is_answered = (answered_at is not null)),
  constraint answered_note_length check (answered_notes is null or char_length(answered_notes) <= 1000),
  -- Verified scripture always has its reference and its text: a verified flag with no verse behind it is a bug.
  constraint scripture_verified_check
    check (not scripture_verified or (scripture_reference is not null and scripture_text is not null))
);

comment on column public.journal_entries.client_entry_id is
  'A UUID the phone makes for each reflection, so that retrying a submit is harmless.';
comment on column public.journal_entries.audio_path is
  'Storage path of the raw recording in journal_media: {userId}/raw/{clientEntryId}.m4a. Never a URL.';
comment on column public.journal_entries.devotional_audio_path is
  'Storage path of the spoken devotional in journal_media: {userId}/devotionals/{entryId}.mp3. Never a URL.';
comment on column public.journal_entries.error_code is
  'The last processing failure code. The set of codes lives in the Edge Function, so it is not constrained here.';

create index if not exists journal_entries_user_created_idx
  on public.journal_entries (user_id, created_at desc);
create index if not exists journal_entries_user_prayers_idx
  on public.journal_entries (user_id, created_at desc) where is_active_prayer or is_answered;

drop trigger if exists journal_entries_set_updated_at on public.journal_entries;
create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- 4. daily_affirmations: three rows per finished, non-crisis entry. The Edge Function creates them.
create table if not exists public.daily_affirmations (
  id               uuid        primary key default gen_random_uuid(),
  user_id          text        not null references public.users_profile (id) on delete cascade,
  entry_id         uuid        not null,
  time_slot        text        not null,
  headline         text        not null,
  affirmation_text text        not null,
  is_delivered     boolean     not null default false,
  is_favorite      boolean     not null default false,
  scheduled_for    timestamptz,
  created_at       timestamptz not null default now(),
  constraint daily_affirmations_time_slot_check check (time_slot in ('morning', 'afternoon', 'evening')),
  -- One affirmation per slot, so a retried run cannot leave duplicates behind.
  constraint daily_affirmations_entry_slot_key unique (entry_id, time_slot),
  -- The affirmation and its entry must belong to the same user, even if a server bug mixes ids up.
  constraint daily_affirmations_entry_user_fkey foreign key (entry_id, user_id)
    references public.journal_entries (id, user_id) on delete cascade
);

create index if not exists daily_affirmations_user_created_idx
  on public.daily_affirmations (user_id, created_at desc);

-- A crisis entry never has affirmations (Crisis Safety Rules). The Edge Function already skips them; this is the net.
create or replace function public.reject_affirmation_for_crisis_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.journal_entries e where e.id = new.entry_id and e.is_crisis) then
    raise exception 'a crisis entry never has affirmations' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function public.reject_affirmation_for_crisis_entry() from public, anon, authenticated;

drop trigger if exists daily_affirmations_no_crisis on public.daily_affirmations;
create trigger daily_affirmations_no_crisis
  before insert on public.daily_affirmations
  for each row execute function public.reject_affirmation_for_crisis_entry();

-- 5. Row level security. users_profile keeps the three policies from the baseline. The two new tables get a select and
--    an update policy for the signed-in user; there is no insert or delete policy, because the app never does either.
alter table public.journal_entries enable row level security;
alter table public.daily_affirmations enable row level security;

drop policy if exists journal_entries_select_own on public.journal_entries;
create policy journal_entries_select_own on public.journal_entries
  for select to authenticated
  using (user_id = (select public.requesting_user_id()));

drop policy if exists journal_entries_update_own on public.journal_entries;
create policy journal_entries_update_own on public.journal_entries
  for update to authenticated
  using (user_id = (select public.requesting_user_id()))
  with check (user_id = (select public.requesting_user_id()));

drop policy if exists daily_affirmations_select_own on public.daily_affirmations;
create policy daily_affirmations_select_own on public.daily_affirmations
  for select to authenticated
  using (user_id = (select public.requesting_user_id()));

drop policy if exists daily_affirmations_update_own on public.daily_affirmations;
create policy daily_affirmations_update_own on public.daily_affirmations
  for update to authenticated
  using (user_id = (select public.requesting_user_id()))
  with check (user_id = (select public.requesting_user_id()));

-- 6. What each role may do. Nobody signed out (anon) touches any of the three tables.
revoke all on public.users_profile, public.journal_entries, public.daily_affirmations from anon;
revoke all on public.journal_entries, public.daily_affirmations from authenticated;
revoke insert, update on public.users_profile from authenticated;

grant select on public.journal_entries, public.daily_affirmations to authenticated;

grant insert (id, reminder_morning, reminder_afternoon, reminder_evening, timezone,
              affirmations_enabled, ambient_sound, ambient_volume)
  on public.users_profile to authenticated;
grant update (reminder_morning, reminder_afternoon, reminder_evening, timezone,
              affirmations_enabled, ambient_sound, ambient_volume)
  on public.users_profile to authenticated;

grant update (is_active_prayer, is_answered, answered_at, answered_notes, prayer_category)
  on public.journal_entries to authenticated;
grant update (is_favorite)
  on public.daily_affirmations to authenticated;

-- The Edge Functions and the RevenueCat webhook. service_role bypasses row level security but not grants.
grant select, insert, update, delete
  on public.users_profile, public.journal_entries, public.daily_affirmations to service_role;

-- 7. Private media storage. {userId}/raw/{clientEntryId}.m4a is uploaded by the app; {userId}/devotionals/{entryId}.mp3 is
--    written by the Edge Function (service_role, which bypasses these policies). The app can read its own folder and
--    upload into its own raw/ folder, and nothing else: no overwrite and no delete from the phone.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal_media', 'journal_media', false, 26214400,
        array['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg'])
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists journal_media_select_own on storage.objects;
create policy journal_media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'journal_media'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

drop policy if exists journal_media_insert_own_raw on storage.objects;
create policy journal_media_insert_own_raw on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'journal_media'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
    and (storage.foldername(name))[2] = 'raw'
    and array_length(storage.foldername(name), 1) = 2
  );

-- 8. Tell the Data API to look at the new tables now.
notify pgrst, 'reload schema';
