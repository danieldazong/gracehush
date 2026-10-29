-- Gracehush: the record of deleted devotionals (step 29b).
--
-- The free tier counts the devotionals a person made this week (step 22). It counted the reflections that exist, so deleting
-- one gave its slot back: a free account could make three, delete them and make three more, at about 5 cents of speech and
-- AI each. The delete-entry Edge Function writes one row here for a reflection that counted (a devotional that is not a
-- crisis entry) BEFORE it deletes the reflection, and the limit check counts these rows together with the reflections that
-- exist.
--
-- A row holds the reflection's id, its owner and the time it was made, and nothing the person wrote. No app role can touch
-- the table (no grant and no policy): only the Edge Functions (service_role) read and write it. There is deliberately no
-- foreign key to journal_entries, so a row outlives the reflection it came from; it follows the account instead (deleting a
-- profile removes its rows). A row older than 14 days can never fall inside a week, and delete-entry removes those.
--
-- It is safe to run again, and it deletes no data.
create table if not exists public.deleted_devotionals (
  entry_id   uuid        primary key,
  user_id    text        not null references public.users_profile (id) on delete cascade,
  made_at    timestamptz not null,
  deleted_at timestamptz not null default now()
);

create index if not exists deleted_devotionals_user_made_idx
  on public.deleted_devotionals (user_id, made_at desc);

alter table public.deleted_devotionals enable row level security;

-- Nobody signed in, and no signed-in user, can read or write it. service_role bypasses row level security but not grants.
revoke all on public.deleted_devotionals from anon, authenticated;
grant select, insert, update, delete on public.deleted_devotionals to service_role;

notify pgrst, 'reload schema';
