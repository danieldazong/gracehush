-- 2026-11-07 (prompt 36): the validation line, one sentence the model writes from the entry, shown as the Reflection's
-- headline. Additive. Only the server writes it; the app reads it through its table-wide select on journal_entries.
alter table public.journal_entries add column if not exists validation_line text;

alter table public.journal_entries drop constraint if exists validation_line_length;
alter table public.journal_entries add constraint validation_line_length
  check (validation_line is null or char_length(validation_line) <= 240);

alter table public.journal_entries drop constraint if exists validation_line_crisis;
alter table public.journal_entries add constraint validation_line_crisis
  check (not is_crisis or validation_line is null);

notify pgrst, 'reload schema';
