-- 2026-11-08 (step 37): a Bible verse under each affirmation. process-entry gen-v2.5 reads one verse of the Berean Standard
-- Bible for each affirmation (supabase/functions/process-entry/verses.ts) and saves where it is and its exact words beside the
-- headline; the app shows them on the lock screen, on the Journal's affirmation card and in Reflection's Affirmations tab.
-- Additive: two nullable columns (an affirmation saved before, or one whose verse could not be found, has neither) and two
-- rules. Only the server writes them; the app reads them through its table-wide select on daily_affirmations and still updates
-- is_favorite alone. Run it after 20261108120000_heavy_moments.sql, before process-entry gen-v2.5 is deployed.
alter table public.daily_affirmations add column if not exists verse_reference text;
alter table public.daily_affirmations add column if not exists verse_text text;

-- A verse is where it is and what it says, both or neither.
alter table public.daily_affirmations drop constraint if exists affirmation_verse_pair;
alter table public.daily_affirmations add constraint affirmation_verse_pair
  check ((verse_reference is null) = (verse_text is null));

-- The server keeps a verse of at most 140 characters read as one line (AFFIRMATION_VERSE_MAX_CHARS); its line breaks and the
-- reference's dash are counted here, so the bounds leave room. A longer value is never a verse a notification can show.
alter table public.daily_affirmations drop constraint if exists affirmation_verse_length;
alter table public.daily_affirmations add constraint affirmation_verse_length
  check (
    (verse_text is null or char_length(verse_text) between 1 and 200)
    and (verse_reference is null or char_length(verse_reference) between 1 and 60)
  );

notify pgrst, 'reload schema';
