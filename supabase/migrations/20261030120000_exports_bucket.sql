-- Gracehush: the private exports bucket (step 31).
--
-- export-data builds a ZIP of everything a person has (a README, their data as JSON, their journal as Markdown and their audio)
-- and keeps it at {userId}/{exportId}.zip, or {userId}/{exportId}-partial.zip when audio was left out, until the next export or
-- the account's deletion. The person gets a signed link that lives one hour.
--
-- No storage.objects policy names this bucket: only the server (service_role, which bypasses the policies) reads or writes it,
-- and the app can neither put a file there, read one nor list a folder, its own included. The size limit is the project's
-- global upload limit, 50 MB on the Free plan (the dashboard counts a megabyte as 1,048,576 bytes), which a bucket's own limit
-- may not exceed; the function keeps every ZIP 2 MB under it. Only ZIP files are accepted.
--
-- It is safe to run again, and it deletes nothing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 52428800, array['application/zip'])
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
