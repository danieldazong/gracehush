# 25-journal-reflection-data.md

Read AGENTS.md first and follow it strictly.

Connect Journal Home, New Entry and Reflection to the real backend.
Replace the mocked entry processor from step 24 with a real upload +
process-entry call, read entries, affirmations and usage from Supabase
through the step 24 SQLite cache, retry unconfirmed scripture through
confirm-scripture, save affirmation favorites, and resume an entry after
an upgrade. Screens keep their exact look. Prayers stay mocked until
step 29, real playback comes in step 26, notifications in step 28, live
status in step 33.

No new dependencies. No migrations, policy changes or Edge Function
changes. If the code needs a column, grant or response field that isn't
there, stop and ask (steps 18–22 own those).

Docs (source of truth, follow exactly):

- https://supabase.com/docs/reference/javascript/functions-invoke
  (FunctionsHttpError and reading error.context)
- https://supabase.com/docs/reference/javascript/select
- https://supabase.com/docs/reference/javascript/using-filters
- https://supabase.com/docs/reference/javascript/range

---

## 1. Before writing code

1. Read src/lib/supabase.ts, src/lib/supabaseErrors.ts,
   src/data/journalRepository.ts (every // TEMP(25)), src/data/mappers.ts,
   src/data/selectors.ts, src/db/cache.ts and outbox.ts,
   src/services/entryProcessor.ts (mock), src/services/syncEngine.ts,
   src/services/mediaUpload.ts, src/hooks/useJournalHome.ts,
   src/hooks/useReflection.ts, src/screens/ReflectionScreen.tsx,
   src/components/ScriptureCard.tsx, src/components/AffirmationCard.tsx,
   src/screens/PaywallScreen.tsx (success state // TODO(25)),
   src/store/devStore.ts, src/types/index.ts and
   supabase/functions/process-entry/contracts.ts and
   confirm-scripture/index.ts.
2. List every // TEMP(25) and // TODO(25) with file:line. Each one is
   closed in this step or explained in the report.
3. Compare src/types/index.ts with contracts.ts (request, response, 402
   body, error codes). They must match exactly. If they don't, stop and
   show the difference.
4. Check the generated src/types/supabase.ts for the column names used
   below. Use the generated names exactly.

---

## 2. Edge Function gateway: src/lib/edgeFunctions.ts

callFunction<TReq, TRes>(name: 'process-entry' | 'confirm-scripture',
body: TReq, opts?: { timeoutMs?: number }):
Promise<{ ok: true; data: TRes } |
{ ok: false; status: number; code: string; message: string;
body: unknown }>

- Use supabase.functions.invoke(name, { body }). The Clerk token comes
  from the step 17 accessToken option. Never add an Authorization header
  by hand and never call getToken here.
- Timeout: use the timeout or signal option if the installed
  supabase-js types show one; otherwise Promise.race with a timer.
  Defaults: process-entry 120 s, confirm-scripture 15 s. Timeout →
  { status: 0, code: 'NETWORK' }.
- Errors:
  FunctionsHttpError → status = error.context.status; parse
  `await error.context.json()` in try/catch; code and message from
  body.error; keep the whole body (the 402 body has entryId + usage).
  FunctionsRelayError / FunctionsFetchError / TypeError → NETWORK.
  No token (signed out, step 17 guard) → UNAUTHORIZED without a request.
- Validate success bodies with small hand-written type guards for the
  contract shapes. Invalid shape → { code: 'UNKNOWN' }.
- Never log bodies, tokens, text or ids. Allowed: function name, status,
  code, ms.

---

## 3. Real processor: src/services/entryProcessor.ts

Remove // TEMP(25). Keep the step 24 interface exactly.

process(item):

1. Audio: uploadRawRecording(item, userId) (step 23). Its errors map to
   outcomes: NETWORK → NETWORK; UNAUTHORIZED → UNAUTHORIZED; NOT_FOUND
   → AUDIO_NOT_FOUND; TOO_LARGE → PAYLOAD_TOO_LARGE.
   Skip the upload if the item already has an uploaded flag. Add
   `uploaded INTEGER NOT NULL DEFAULT 0` to outbox in SQLite schema
   version 2 (user_version migration, step 24 pattern) and set it after
   a successful upload.
2. Build ProcessEntryRequest exactly per contracts.ts:
   text → { clientEntryId, inputType: 'text', text }
   audio → { clientEntryId, inputType: 'audio', audioPath, durationMs,
   mimeType }
3. callFunction('process-entry', request).
4. Success → map with a new mapper fromProcessResponse(response) in
   mappers.ts to { entry: JournalEntry, affirmations: Affirmation[] }.
   It must produce the same JournalEntry shape as toJournalEntry(row)
   (crisis entries: all devotional fields null, dominantEmotion null).
5. Failure → { ok: false, code, entryId } with entryId from the 402
   body when present.
   userId: the processor gets it from the auth bridge (the same source as
   step 23). Never pass it in the request body.

Remove devStore.nextSubmitOutcome and nextNetworkFails from production
paths. They still work when devStore.dataSource is 'mock' (section 9).

---

## 4. Repository reads: src/data/journalRepository.ts

Remove each // TEMP(25) you replace. Keep every signature.

Column lists in src/data/columns.ts (constants, never select('\*')):
ENTRY_COLUMNS: id, client_entry_id, input_type, transcript,
dominant_emotion, reflection title, scripture_reference,
scripture_text, scripture_verified, devotional_script, closing
prayer, devotional_audio_path, devotional_duration_ms,
is_active_prayer, is_answered, answered_at, answered note,
prayer_summary, prayer_category, is_crisis, processing_status,
error_code, created_at, updated_at
AFFIRMATION_COLUMNS: id, entry_id, time_slot, headline,
affirmation_text, is_favorite, scheduled_for, created_at
Use the generated column names; never include embedding or audio_path.

listEntries({ cursor?: string; limit = 30 }):
Promise<RepoResult<{ entries: JournalEntry[]; nextCursor: string |
null }>>

- Read the cache first and return it immediately through the hook
  (section 6); then query Supabase:
  .from('journal_entries').select(ENTRY_COLUMNS)
  .eq('user_id', userId).order('created_at', { ascending: false })
  .lt('created_at', cursor) when cursor is set, .limit(limit + 1).
- Exclude nothing by status: ready, processing, failed and crisis rows
  all show (Journal Home already renders each state from step 09).
- Rows with processing_status 'failed' and error_code 'LIMIT_REACHED'
  that still have an outbox item are hidden (the pending card from step
  24 shows them instead). Dedupe by client_entry_id.
- Write results to cache.upsertEntry. Keep only the newest 200 entries
  in cache (delete older ones and their affirmations after each page-1
  refresh).

getEntry(id): cache first, then Supabase single row
(.eq('id', id).eq('user_id', userId).maybeSingle()). Not found online
→ remove it from cache and return NOT_FOUND. Offline and not cached →
NETWORK.

listAffirmationsForEntry(entryId) and getLatestAffirmations():
same cache-then-network pattern; latest = the 3 rows of the newest
ready, non-crisis entry, one per time slot.

getUsage(): Supabase count with the server rule (step 22):
free tier → count journal_entries where is_crisis = false and
created_at >= weekStart(now, profile.timezone, WEEK_STARTS_ON) and
(devotional_script is not null or processing_status = 'processing')
using { count: 'exact', head: true }. pro/trial → { used: 0, limit:
Infinity-safe value per the existing type }.
Move weekStart into src/utils/week.ts as an exact copy of the server
logic, with the "Keep in sync" comment and the same DST tests.
The app never opens the Paywall from this count. Only a 402 does.

toggleAffirmationFavorite(id, value): update is_favorite only (granted
in step 18), optimistic in the hook with rollback, then
cache.upsertAffirmations. Close the step 09 // TODO(25).

Errors use supabaseErrors.ts. UNAUTHORIZED pauses the sync engine
(step 24 paused_auth) and the screen shows its existing error state.

---

## 5. Scripture confirmation

src/services/scriptureConfirm.ts:
confirmScriptureIfNeeded(entry): Promise<JournalEntry>

- Call only when online, entry is ready, not crisis, scripture
  reference present and not verified, and this entry wasn't tried in the
  last 60 s (in-memory map).
- callFunction('confirm-scripture', { entryId }).
- Result verified → update cache and return the updated entry. Result
  null → set scripture null in cache (hide the card). Unchanged →
  return as is.
- useReflection runs it after the entry loads and on focus.
  ScriptureCard: scripture null → render nothing (close the step 20
  TODO). Unverified → the existing "We're confirming this passage." state.
  Verified → full text. No layout change.

---

## 6. Hooks

useJournalHome:

- On load: show cached entries + pending outbox items at once (no
  spinner if the cache has rows), then refresh page 1 from Supabase.
- Pull-to-refresh and focus refetch page 1; onEndReached loads the next
  cursor (ignore while loading or when nextCursor is null). Footer shows
  a small plum ActivityIndicator while loading more.
- Ignore late responses and updates after unmount (step 09 rule).
- Refresh when the sync engine emits a finished item.
- Reflection days count (step 09) is computed from the loaded entries
  with the existing selector; add // TODO(33): server-side count if the
  journal grows past one page.

useReflection:

- Cache first, then network (section 4).
- Pending outbox item for this entry → the existing processing state.
- Server row processing (another device, or the 90 s overlay timeout
  from step 24) → poll getEntry every 5 s while the screen is focused,
  stop after 2 minutes or when status changes. Show the existing
  processing state. // TODO(33): replace polling with Realtime.
- failed → the existing failed state; "Try again" re-enqueues the outbox
  item if it exists, otherwise shows "Please record or write this
  reflection again." (the original input is no longer on this phone).
- crisis → CrisisSupportPanel (step 13), never anything else.
- Mini player gets audio availability from devotionalAudioPath and
  durationMs; playback stays mocked. // TODO(26): signed URL from path.

---

## 7. Resume after upgrade

Paywall success (step 16) with source 'limit' and an entryId:

- Find the outbox item whose server_entry_id equals entryId (or whose
  clientEntryId matches the entry) and set it queued, attempts 0, then
  syncNow('upgrade'). Close the step 16 // TODO(25).
- The success "Continue" button keeps its step 16 behavior (back to
  Journal). The pending card there shows "Preparing your reflection…".
- No outbox item (the entry came from another phone) → no resume; the
  report notes it as a known limit.

---

## 8. New Entry

- The step 24 flow stays. With the real processor, check that each
  real outcome reaches the right screen: ready, crisis, 402, needs
  action (TOO_SHORT, NO_SPEECH, PAYLOAD_TOO_LARGE, AUDIO_NOT_FOUND,
  INVALID_REQUEST), retryable (NETWORK, AI_UNAVAILABLE, INTERNAL,
  RATE_LIMITED, ALREADY_PROCESSING).
- Remove remaining // TODO(25) markers from step 10.

---

## 9. Dev switch

- Rename devStore.profileSource to dataSource: 'supabase' | 'mock'
  (**DEV** only, default 'supabase', production always 'supabase').
- 'mock' → repository, processor and usage use the step 06 mocks and
  devStore outcomes exactly as before; SQLite is not written.
- Update DevToolsPanel labels. "Supabase check" also shows the last
  Edge Function status code and error code (no bodies).

---

## 10. AGENTS.md updates

- Data Rules: screens read through journalRepository only; cache first
  then network; explicit column lists; newest 200 entries cached; page
  size 30; Edge Functions only through src/lib/edgeFunctions.ts; parse
  error.context for non-2xx; the server owns the free limit.
- Remove closed TEMP/TODO notes from the Known Gaps list.

---

## 11. Rules

- No new dependencies, no `any`, no layout changes.
- Never log transcripts, verse text, bodies, tokens, paths or ids.
- Never select embedding or audio_path into the app.
- Never open the Paywall from a client count.

---

## 12. Verify (dev build, against the step 19–22 functions)

Run `npx expo start -c`, `npm run lint`, `npm run typecheck`, then:

1. Text entry online → Reflection with real devotional, verified
   scripture, 3 affirmations. The row is in Supabase and in SQLite.
2. Voice entry online → the file is in {userId}/raw/, the entry ready,
   the local recording deleted.
3. Airplane mode → both kinds queue; back online → both finish once.
4. Kill the app, reopen offline → Journal and the last Reflection open
   from cache.
5. Scroll past 30 entries (seed with the dev panel or SQL) → next page
   loads, no duplicates.
6. Free user, 4th entry → Paywall with "Your reflection is saved."; mock
   purchase → the entry finishes automatically.
7. Crisis entry → crisis panel; no affirmations in Supabase.
8. Force an unverified passage (step 20 dev switch on the local
   function) → "We're confirming this passage."; restore → the text
   appears after reopening Reflection (≥ 60 s).
9. Favorite an affirmation, kill and reopen → still favorited; turn
   off the network and favorite → it rolls back with the inline error.
10. Second account → sees only its own entries and cache.
11. Expire the session (sign out on another device or wait) → the queue
    pauses, no error loop; sign in → it resumes.
12. dataSource 'mock' → the step 09–16 scenarios still work.
13. Network inspector / logs show no select('\*') and no embedding.

Report: TEMP/TODO list with how each was closed; files created,
changed, deleted; SQLite schema version 2; column lists; how the 402
body is read; test results 1–13; known limits; and every TODO left for
steps 26, 28, 29 and 33.
