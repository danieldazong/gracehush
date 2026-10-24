-- Gracehush: the journal_media bucket accepts WAV, the spoken devotional's format since 2026-10-24.
--
-- Step 22 first stored the devotional as the MP3 that Cloud Text-to-Speech writes. That MP3 is fixed at 32 kbps (the API
-- refuses a higher rate for these voices) and was heard as faintly robotic, so the lossless LINEAR16 (WAV) was chosen after
-- listening. The Edge Function now writes {userId}/devotionals/{entryId}.wav as audio/wav, and the bucket's list of accepted
-- types gains that one type. Nothing else changes: the bucket stays private, its 25 MB limit stays (a devotional is about
-- 48 KB a second, so about 9 minutes would fit, and a script is capped far below that), and the policies are untouched.
--
-- It is safe to run again (the type is added only while it is missing) and it never deletes data. Run it after the v1
-- schema migration: that one sets the bucket's whole list whenever it is run, so this one must come after it.
update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'audio/wav')
 where id = 'journal_media'
   and not ('audio/wav' = any (coalesce(allowed_mime_types, array[]::text[])));
