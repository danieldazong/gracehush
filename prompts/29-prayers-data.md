# 29-prayers-data.md

Read AGENTS.md first and follow it strictly.

Connect Prayers and the Reflection prayer toggle to real data. Replace
the step 14 mocked prayer functions with Supabase reads and writes,
cache prayers in the step 24 SQLite database, and queue prayer changes
made offline so they sync later. Optionally add database rules that keep
prayer fields consistent (approval gate). Prayers, the Mark Answered
sheet and Reflection keep their exact look.

AGENTS.md requires approval before migrations and dependencies. No new
dependencies. The only database change is the optional section 7
migration.

Docs (source of truth, follow exactly):

- https://supabase.com/docs/reference/javascript/update
- https://supabase.com/docs/reference/javascript/or
- https://supabase.com/docs/reference/javascript/select
- https://docs.expo.dev/versions/latest/sdk/sqlite/

---

## 1. Before writing code

1. Read src/data/journalRepository.ts (listPrayers, markPrayerAnswered,
   unmarkPrayerAnswered, updateAnsweredNote, all // TEMP(29)),
   src/data/mappers.ts (toPrayer), src/data/selectors.ts,
   src/data/columns.ts (step 25), src/hooks/usePrayers.ts,
   src/components/prayers/MarkAnsweredSheet.tsx and PrayerCard.tsx,
   src/screens/PrayersScreen.tsx, src/screens/ReflectionScreen.tsx and
   useReflection.ts (prayer toggle // TODO(29)), src/db/ (schema,
   cache, outbox), src/services/syncEngine.ts and syncPolicy.ts,
   src/utils/zonedTime.ts (step 28), src/store/devStore.ts,
   src/types/index.ts and src/types/supabase.ts.
2. List every // TEMP(29) and // TODO(29) with file:line. Each is
   closed here or explained in the report.
3. From the generated types, confirm the exact names of: is_active_prayer,
   is_answered, answered_at, the answered note column, prayer_summary,
   prayer_category, reflection title, is_crisis, processing_status,
   updated_at. Use them exactly.
4. Confirm step 18 granted client UPDATE on is_active_prayer,
   is_answered, answered_at, the note column and prayer_category, and
   NOT on prayer_summary. If any grant is missing, stop and ask.
5. Write down what "active" means in the step 14 selectors. This step
   uses: tracked prayer = is_active_prayer true; Active tab = tracked
   and not answered; Answered tab = is_answered true. If the step 14
   selectors use a different rule, stop and show the difference.

---

## 2. Prayer model and mapping

- toPrayer(entry) (mappers.ts) builds the Prayer from a JournalEntry,
  so prayers and entries never disagree. Prayer.summary =
  prayerSummary ?? reflectionTitle ?? copy "Prayer from {short date}".
  Never the transcript.
- Prayer.answeredDate (date only, "YYYY-MM-DD") comes from answered_at
  in the profile's time zone (localDateISO, step 28).
- Crisis entries never map to a Prayer (return null), whatever the
  flags say.

Answered date storage, in src/utils/prayerDates.ts:
answeredDateToTimestamp(dateISO, timeZone): string
// ISO of 12:00 local time on that date (zonedDateTimeToUtc)
isValidAnsweredDate(dateISO, createdAtISO, timeZone, now): boolean
// between the entry's local created date and today, inclusive
Unit tests: the date is the same when read back in UTC−10, UTC and
UTC+14; future dates and dates before creation are invalid.

---

## 3. Reads (repository)

listPrayers(): Promise<RepoResult<Prayer[]>>

- Cache first: map cached entries (entries_cache) to prayers and return
  them through the hook at once.
- Then Supabase:
  .from('journal_entries').select(ENTRY_COLUMNS)
  .eq('user_id', userId).eq('is_crisis', false)
  .eq('processing_status', 'ready')
  .or('is_active_prayer.eq.true,is_answered.eq.true')
  .order('created_at', { ascending: false }).limit(PRAYERS_LIMIT)
  PRAYERS_LIMIT = 300 in src/constants/app.ts.
  // TODO: paginate if a user passes 300 prayers.
- Write the rows to entries_cache (upsertEntry). Prayers are exempt
  from the step 25 newest-200 trim: change the trim to keep entries that
  are tracked or answered, plus the newest 200 others.
- Apply pending mutations (section 5) on top of the server rows before
  returning, so waiting changes never flicker back.
- Offline → cache only, no error.

---

## 4. Writes (repository)

Remove // TEMP(29) from each. Keep every signature from step 14.

setPrayerTracked(entryId, tracked: boolean): Promise<RepoResult<Prayer>>
(new; used by the Reflection toggle)

- tracked true → { is_active_prayer: true }.
- tracked false → { is_active_prayer: false, is_answered: false,
  answered_at: null, <note>: null }.
  markPrayerAnswered({ prayerId, answeredDate, note })
- Validate with isValidAnsweredDate and the 1000-char note limit
  (trimmed, empty → null). Invalid → { ok: false, code: 'INVALID' }.
- Patch { is_active_prayer: true, is_answered: true,
  answered_at: answeredDateToTimestamp(...), <note>: note }.
  Accept answeredDate (YYYY-MM-DD) from the sheet; update the step 14
  input type if it used a timestamp, and the sheet caller with it.
  unmarkPrayerAnswered(prayerId)
- Patch { is_answered: false, answered_at: null, <note>: null }.
  updateAnsweredNote(prayerId, note)
- Patch { <note>: note } (trimmed, empty → null, ≤ 1000).

All writes:

1. Read the entry from cache. Missing, crisis or not ready → NOT_FOUND
   / INVALID without writing.
2. Apply the patch to the cached entry (optimistic) and save it.
3. Enqueue the patch (section 5) and call syncNow('mutation').
4. Return the updated Prayer immediately. The hook's step 14 rollback
   now happens only when the mutation is rejected for good (section 6).
   Never send prayer_summary, transcript or any column outside the patch.

---

## 5. Mutation queue (SQLite schema version 3)

Migration (user_version 2 → 3, step 24 pattern):
mutations
entry_id TEXT PRIMARY KEY
patch_json TEXT NOT NULL -- merged column → value
attempts INTEGER NOT NULL DEFAULT 0
next_attempt_at INTEGER NOT NULL
last_error_code TEXT
updated_at INTEGER NOT NULL

src/db/mutations.ts:
enqueuePatch(entryId, patch) // merge into the existing row:
// later keys overwrite earlier ones
nextDueMutation(now), markRetry(entryId, nextAt, code),
removeMutation(entryId), listMutations(), countMutations()

- patch_json holds snake_case column names from an allow-list
  (PRAYER_PATCH_COLUMNS in columns.ts). Any other key → throw in
  **DEV**, drop in production.
- Merging tracked false + later mark answered keeps the final values
  only. Unit tests for merge order.

Sync engine (step 24):

- Process due mutations before outbox items, one at a time, same
  single-flight loop and triggers.
- Send: .from('journal_entries').update(patch).eq('id', entryId)
  .eq('user_id', userId).select(ENTRY_COLUMNS).maybeSingle().
- Success → upsertEntry(server row), removeMutation.
- Returned no row → the entry was deleted: removeMutation, remove it
  from cache.

---

## 6. Error policy (syncPolicy.ts, pure, unit-tested)

- NETWORK, 5xx, PGRST timeouts → retry with the step 24 backoff.
- UNAUTHORIZED (401 / PGRST301) → pause, same as step 24 paused_auth.
- Permanent (42501 RLS / permission denied, 23514 check violation,
  22P02 invalid input, 22001 too long) → removeMutation, refetch that
  row with getEntry and upsert it (the optimistic change is undone),
  and push a notice to a small non-persisted store
  (src/store/noticeStore.ts): "We couldn't save that change."
- Prayers and Reflection show the notice inline (the step 14 banner
  area) until the next refresh or tab change, never on a timer.
- Never retry a permanent error.

---

## 7. Database rules (approval gate)

Show the user these rules and ask: "Add these prayer consistency rules
to the database?" Only on yes:
npx supabase migration new prayer_consistency
-- before adding, count rows that break each rule; if any, stop and
-- report the counts (never edit data to make it pass)
alter table public.journal_entries
add constraint answered_fields_match
check (is_answered = (answered_at is not null)),
add constraint crisis_not_prayer
check (not (is_crisis and (is_active_prayer or is_answered))),
add constraint answered_note_length
check (<note column> is null or char_length(<note column>) <= 1000);

- Run `npx supabase db reset` twice locally, add three cases to
  supabase/tests/rls_test.sql (each rule rejects a bad update as the
  authenticated role), regenerate types (`npm run types:db`).
- Push to the hosted project only after a second yes (step 18 section 8
  steps).
- If no: skip, and add the three rules to AGENTS.md Known Schema Gaps.

---

## 8. Screens

Prayers (usePrayers, step 14):

- Use the real repository. Refetch on focus and pull-to-refresh; also
  refresh when the sync engine reports a mutation done.
- Offline with pending changes: below the header, a small mauve DM Sans
  13 line "Changes will sync when you're back online." (copy.ts under
  prayers). Hidden when online or none are pending.
- Mark Answered sheet: pass answeredDate (YYYY-MM-DD). Its validation
  uses isValidAnsweredDate with the profile time zone.

Reflection prayer toggle (step 11):

- Wire to setPrayerTracked. Close // TODO(29).
- Turning it off when the prayer is answered → ConfirmDialog
  "Remove this from Prayers?" / "Its answered date and gratitude note
  will be removed." / confirm "Remove" / cancel "Keep". Not answered →
  no dialog.
- Hidden for crisis entries (unchanged), and while the entry isn't
  ready.

Journal Home: prayer counts from step 09 update after changes (the
cache is the same source). Confirm.

---

## 9. Dev switch and cleanup

- devStore.nextPrayerMutationFails works only when dataSource is 'mock'
  (step 25). Profile mocks from step 15 keep using it.
- Dev panel: "Pending changes: {n}" (count only).
- signOutCleanup: nothing extra (the database file is deleted in step
  24). Confirm the mutations table goes with it.

---

## 10. Rules

- No new dependencies, no `any`, no layout changes except the offline
  line and the toggle dialog.
- Writes send only allow-listed prayer columns.
- Never log notes, summaries, transcripts or ids.
- // TODO(31): include prayers and notes in the data export.
- // TODO(33): Realtime updates across devices.
- // TODO(34): prayer_marked_answered { has_note, days_to_answer },
  prayer_tracked_changed { tracked }.

---

## 11. AGENTS.md updates

- Prayer Rules: tracked = is_active_prayer; answered = is_answered +
  answered_at at 12:00 local; crisis entries are never prayers; summary
  fallback is the title, never the transcript; offline changes go
  through the mutations queue, merged per entry; last change wins per
  field (known limit across devices); permanent errors are dropped
  and reloaded.

---

## 12. Verify (dev build, against Supabase)

Run `npx expo start -c`, `npm run lint`, `npm run typecheck`, then:

1. Turn the toggle on in Reflection: the prayer appears in Active; the
   row has is_active_prayer true.
2. Mark answered with Yesterday and a note: it moves to Answered, with
   the right date in the app and 12:00 local in Supabase.
3. Change the phone's time zone to Pacific/Kiritimati and to
   Pacific/Honolulu: the answered date stays the same.
4. Edit the note, then Move back to Active: the date and note are
   cleared in Supabase.
5. Airplane mode: mark, edit and unmark the same prayer; the offline
   line shows; reconnect → one update with the final state (logs show
   one request).
6. Kill the app while a change is pending, reopen online: it syncs.
7. Turn the toggle off on an answered prayer: the dialog shows; Remove
   clears everything.
8. With the section 7 rules on: force a bad patch in **DEV** (answered
   true with no date) → the notice shows, the prayer reloads, no retry
   loop.
9. A prayer without a summary shows the title, never the transcript.
10. A crisis entry never appears in Prayers and has no toggle.
11. Second account sees only its own prayers.
12. dataSource 'mock': the step 14 scenarios still work.

Report: TEMP/TODO list and how each was closed; column names used;
SQLite schema version 3; the section 7 decision; files created, changed
and deleted; test results 1–12; and every TODO left for steps 31, 33
and 34.
