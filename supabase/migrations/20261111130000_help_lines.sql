-- 2026-11-11 (the readers' review of Scholar, after step 38's Part One). Two additive columns.
--
-- journal_entries.help_line: the help line a heavy moment shows, one of four words that the server's screening chooses
-- (supabase/functions/_shared/safety/helpKind.ts): crisis (the 988 line), abuse (the domestic violence line, with 911),
-- harm_others (988, with 911) and emergency (911 first). It is null on every other entry, and on a heavy moment saved before
-- this migration, which the app shows with the 988 line. No category, phrase or reason is stored anywhere: this word is all.
--
-- users_profile.scholar_closed_at: when Scholar was closed for an account that told it they are under 18 (GraceHush is made for
-- adults). Only the server writes it; the app reads it through its table-wide select on its own row.
--
-- Nothing is backfilled and nothing is deleted. The app's grants do not change: its column-level insert and update grants name
-- neither column, so only the service role writes them, and both are read through the table-wide selects the app already has.

alter table public.journal_entries add column if not exists help_line text;

alter table public.journal_entries drop constraint if exists help_line_kind;
alter table public.journal_entries add constraint help_line_kind
  check (help_line is null or help_line in ('crisis', 'abuse', 'harm_others', 'emergency'));

alter table public.journal_entries drop constraint if exists help_line_crisis;
alter table public.journal_entries add constraint help_line_crisis
  check (help_line is null or is_crisis);

alter table public.users_profile add column if not exists scholar_closed_at timestamptz;

notify pgrst, 'reload schema';
