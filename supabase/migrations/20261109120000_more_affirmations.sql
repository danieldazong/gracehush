-- 2026-11-09: more affirmations. A reflection is made with three affirmations, one for each time of day, and since today a
-- person may add up to seven more from its Affirmations tab (the Edge Function add-affirmation), ten in all. Three keep the
-- lock-screen slots (morning, afternoon, evening) and carry the notifications; the rest have no slot, and a new affirmation
-- may take a slot over when it fits that time of day better (the server's feature_affirmation moves it in one step).
--
-- Additive: a position column (the order of the cards, 1 to 10, unique in its entry, filled in by a trigger when the server
-- gives none, so the three rows process-entry inserts and the self-test's fixtures need no change), time_slot made nullable
-- (one affirmation per slot stays, as a partial unique index), and one function for the server. Only the server writes any of
-- it; the app reads position and time_slot through its table-wide select and still updates is_favorite alone. Run it after
-- 20261108130000_affirmation_verses.sql, before add-affirmation is deployed.

-- 1. The order of the cards. Existing rows take their slot's order (morning 1, afternoon 2, evening 3).
alter table public.daily_affirmations add column if not exists position smallint;

update public.daily_affirmations
   set position = case time_slot when 'morning' then 1 when 'afternoon' then 2 when 'evening' then 3 else 1 end
 where position is null;

-- A row inserted with no position takes the next one of its entry. Volatile, so a multi-row insert sees the rows before it.
create or replace function public.set_affirmation_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.position is null then
    select coalesce(max(a.position), 0) + 1 into new.position
      from public.daily_affirmations a
     where a.entry_id = new.entry_id;
  end if;
  return new;
end
$$;

revoke all on function public.set_affirmation_position() from public, anon, authenticated;

drop trigger if exists daily_affirmations_position on public.daily_affirmations;
create trigger daily_affirmations_position
  before insert on public.daily_affirmations
  for each row execute function public.set_affirmation_position();

alter table public.daily_affirmations alter column position set not null;

-- Ten at most, and never two cards in one place.
alter table public.daily_affirmations drop constraint if exists affirmation_position_range;
alter table public.daily_affirmations add constraint affirmation_position_range
  check (position between 1 and 10);

alter table public.daily_affirmations drop constraint if exists daily_affirmations_entry_position_key;
alter table public.daily_affirmations add constraint daily_affirmations_entry_position_key unique (entry_id, position);

-- 2. The slot is optional: the three lock-screen affirmations have one, the others none. One affirmation per slot stays.
alter table public.daily_affirmations alter column time_slot drop not null;

alter table public.daily_affirmations drop constraint if exists daily_affirmations_entry_slot_key;
create unique index if not exists daily_affirmations_entry_slot_key
  on public.daily_affirmations (entry_id, time_slot)
  where time_slot is not null;

-- 3. The server moves a slot to another affirmation of the same entry in one transaction: the holder loses it, the other takes
--    it, and nothing in between can see two or none. Only the server may call it.
create or replace function public.feature_affirmation(p_entry uuid, p_affirmation uuid, p_slot text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  if p_slot not in ('morning', 'afternoon', 'evening') then
    raise exception 'unknown time slot' using errcode = '22023';
  end if;
  update public.daily_affirmations
     set time_slot = null
   where entry_id = p_entry and time_slot = p_slot and id <> p_affirmation;
  update public.daily_affirmations
     set time_slot = p_slot
   where entry_id = p_entry and id = p_affirmation;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'no such affirmation' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.feature_affirmation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.feature_affirmation(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
