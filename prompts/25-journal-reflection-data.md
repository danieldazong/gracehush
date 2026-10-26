# 25-journal-reflection-data.md

Read AGENTS.md first and follow it strictly.

Connect Journal Home, New Entry and Reflection to the real backend. The sync engine of step 24 now sends each saved reflection for real: a recording goes up to the private `journal_media` bucket, `process-entry` prepares the reflection, and the finished entry is written to the phone's read cache. Journal Home and Reflection read entries and affirmations from Supabase through that cache (what the phone has first, then the network), 30 entries at a time. A passage that was kept as a reference only is asked for again (`confirm-scripture`). The heart on an affirmation is saved. A reflection that a server is still preparing is read again while its screen is in front. And what the free limit held back is sent as soon as the phone learns that the plan is paid. Screens keep their look, except for a small spinner under the last card while older entries come, one calm line under the affirmation card when saving the heart fails, and three rows in the developer panel. Prayers stay mocked until step 29, real playback is step 26, notifications step 28, live status step 33.

**The code is written and proven.** The old text of this step was written before steps 17 to 24 were built. The review checked it against the installed packages and the repo and found it wrong or incomplete in several places (below). So this prompt carries the finished files word for word (sections 1 and 2) and the checks that prove them (section 3). They were proven in a copy of the repo outside the project: `tsc` and ESLint (with the React Compiler rules) clean, **86 Node checks** pass with the app's real TypeScript and the real `supabase-js` client running against a fake Supabase that answers like PostgREST and the two Edge Functions (real SQL through Node's own SQLite, the fakes of step 24 under it), and **100 deliberate breakages** of the code were each caught by a named check. The older checks still pass at their old numbers (offline 44, recording 68, profile-sync 88, parity 7 of 7). What the review could not do, because it has no phone: anything that needs the real network, the real database, the real functions or your iPhone. That part is yours, written out step by step in "What you do yourself".

**No new package, no migration, no policy change, no Edge Function change, no deploy and no secret.** The functions on the hosted project are the ones deployed on 2026-10-24 (nothing in `supabase/functions/` has changed since). If the code ever seems to need a column, a grant or a response field that is not there, stop and ask: steps 18 to 22 own those.

Sources, read in the review on 2026-10-25 (the installed packages themselves, not web pages, so they are the versions this app really runs):

- `@supabase/functions-js`, `@supabase/postgrest-js` and `@supabase/supabase-js` 2.118.0: `FunctionsClient.invoke` (the `timeout` option, the three error classes, how an answer is parsed), `PostgrestQueryBuilder.select` (`count`), `PostgrestTransformBuilder.maybeSingle`, and the client's `accessToken` wrapper
- the code of steps 05 to 24 (`src/`), `supabase/functions/process-entry/` (`contracts.ts`, `response.ts`, `validate.ts`, `handler.ts`, `fixtures/parity.json`) and `confirm-scripture/handler.ts` for the answers and the error codes, `supabase/functions/_shared/limits/weekly.ts` for the week, and `supabase/migrations/` for the grants and indexes
- the iPhone's own JavaScript runtime (Hermes), read-only through the dev server's inspector, for the `Intl` features `src/utils/week.ts` uses
- `AGENTS.md`, and prompts 26, 28, 29, 30, 31, 33 and 34 (they call what this step builds)

---

## What the review found (these changed the prompt)

1. **Wrong paths and names in the old text.** `src/lib/` does not exist: the Supabase client is `src/services/supabaseClient.ts` and the error mapper `src/utils/supabaseErrors.ts`. The Edge Function gateway goes in `src/api/` (AGENTS.md: "`api/` holds HTTP calls to Edge Functions"), as `src/api/journalApi.ts`, not `src/lib/edgeFunctions.ts`. `src/screens/ReflectionScreen.tsx` is `src/screens/journal/ReflectionScreen.tsx`, `src/screens/PaywallScreen.tsx` is `src/screens/paywall/PaywallScreen.tsx`, and `confirm-scripture/index.ts` only serves: the flow is `confirm-scripture/handler.ts`. `ScriptureCard` needs no change at all: it already draws nothing for no passage and "We’re confirming this passage." for an unverified one (step 20).
2. **`supabase.functions.invoke` does not throw for an HTTP failure.** It returns `{ data, error }`: a non-2xx answer is a `FunctionsHttpError` whose `context` is the `Response` (the function's own code is in its JSON body), an answer with the header `x-relay-error: true` is a `FunctionsRelayError`, and a rejected fetch (offline, or the call's own `timeout`) is a `FunctionsFetchError` whose `context` is the original error. The installed version has a `timeout` option, so the old text's "`Promise.race` with a timer" is not needed. The client's token callback runs before every request, so a token that cannot be had fails the call without a request: `NoSessionError` becomes UNAUTHORIZED, any other failure (Clerk cannot be reached) becomes NETWORK.
3. **120 seconds is too short.** `process-entry` can take about 145 seconds (the model calls end by 90 s, speech by 135 s, the platform stops a function at 150: step 22). The gateway gives it 155 seconds and `confirm-scripture` 15; the sync engine's own ceiling (200 s, step 24) stays above both. The function reports nothing while it works, so the overlay's steps follow the usual times (4 s and 12 s) and the answer decides what happens.
4. **No `fromProcessResponse` mapper.** The function answers with the app's own models, and `supabase/tests/process-entry/parity.cjs` already proves that they are what `toJournalEntry` makes of the saved row. The gateway checks the shape with small hand-written guards, and the harness feeds it all seven fixtures of that file.
5. **A failed entry is not listed.** The old text listed every status. A server entry that is `failed` is either one this phone is still retrying (the outbox card shows it) or one nobody can retry (the phone has no copy of its words), and a refused or deleted reflection is no reflection. A `processing` entry that nothing has touched for 10 minutes belongs to a request that died (the server's claim lapses after 3 minutes), and would be a card that never finishes: it is not listed either. The mock data keeps all its statuses.
6. **`getUsage()` cannot be a server count, and the app never opens the Paywall from a number.** The server's rule counts claims that are still in flight and decides in one place; only its 402 opens the Paywall. Profile's line ("2 of 3 audio devotionals used this week") is a number to show: the devotionals this phone has this week, counted from the read cache in the profile's time zone with the server's own week. `src/utils/week.ts` is a copy of `weekWindow` in `supabase/functions/_shared/limits/weekly.ts` (the old text only moved `weekStart`; the card also needs when the week ends), and the harness runs the two against each other for 14 zones and 15 instants across daylight-saving changes and week edges. It needs no network, so Profile opens offline.
7. **Pages are walked with a cursor, and the count comes from the first page.** The query asks for one row more than the page (to know whether there is another), the cursor is the `created_at` text of the last row (kept exactly as PostgREST wrote it, microseconds and `+00:00`, and URL-encoded by the library so the plus survives), and the first page also asks for `count=exact`, so "N entries" is the whole list and not what has loaded. Only the first page trims the cache to the newest 200. A filter works on the entries loaded so far (flagged under "Known limits").
8. **The column lists need the real names.** The old text described columns ("reflection title", "closing prayer", "answered note") where the generated types have `devotional_title`, `closing_prayer` and `answered_notes`, and listed `scheduled_for` and `created_at` of an affirmation, which the app never shows. The lists are checked against the generated `src/types/supabase.ts` by the harness: every column of the row except `audio_path` (where the raw recording is stored: the app wrote it and never shows it) and `user_id`; for an affirmation, only the six it shows. Never `select("*")`, never an embedding. Every query also filters by the signed-in user's id, as row level security does.
9. **Resume after an upgrade is already built, with one gap.** Step 24 gave the engine `resumeAfterUpgrade()`, `purchases.ts` calls it after a purchase or a restore, and a held reflection goes when `getKnownTier()` says the plan is paid. What was missing: nothing wakes the engine when the **profile sync** learns a paid plan, which is how a purchase made on another phone, the RevenueCat webhook of step 30 and a change made by the server itself all arrive. The engine alone would notice at its next start, foreground or retry, which can be a day away. `src/services/upgradeWatcher.ts` closes that (the auth bridge starts it). The old section 7 (find the outbox item by `server_entry_id` and set it queued) is not needed: the engine already does it.
10. **A recording is uploaded once.** The outbox gets a column, `uploaded` (schema version 2, a migration of the phone's own SQLite file, not of Supabase), set after a successful upload, so a retry after a failed `process-entry` goes straight to the function. An object that is already in the bucket counts as success (step 23), so a lost answer after the upload is also safe.
11. **A free-limit answer is kept whole.** The 402 carries the entry the server saved and when the week resets (step 22). The processor passes both on, the engine stores both on the held item, and the Paywall's banner "Your reflection is saved." shows from the first try.
12. **Every cache row is decrypted when it is read** (step 24: AES-256-GCM per row), so a screen reads the rows it shows and 20 more, not the whole cache of 200, and the "latest affirmations" look at the newest 20. The harness counts the decryptions.
13. **Reflection reads again while a server is preparing.** An entry the server calls `processing` (another phone made it, or this phone stopped waiting for it) is read again every 5 seconds while the screen is in front, for at most 2 minutes. A reflection that is only in this phone's outbox is never read from the server (it is not there yet), and nobody is asked for its affirmations. Realtime replaces the polling in step 33.
14. **The old Verify steps could not all be run.** "Seed with the dev panel or SQL" becomes the new "Page size (dev)" switch. "Force an unverified passage with the step 20 dev switch on the local function" becomes an edit of one row in the Table Editor (the table allows `scripture_verified` false with no text). "Expire the session on another device" cannot be done on one phone: the harness proves the pause. "Kill the app and reopen offline" is not possible in Expo Go (it needs Metro to start); the walk-through uses Airplane mode while Expo Go runs.
15. **Stale comments and markers.** Nine `TEMP(25)` and `TODO(25)` lines are closed (listed in section 0), and the comments that still said "step 25 will…" are updated. `PaywallScreen` has no `TODO(25)` any more (step 24 wired the resume).
16. **Three older checks needed a one-line fix each** (section 3): the offline checks expect schema version 2 and read `isProcessorMock()` as a function, and the profile-sync checks use the renamed `setDataSource` and fake the read cache that the repository now imports.
17. **A note of step 21 no longer applies.** It said the New Entry error view should link to Support Resources when the screening cannot run. Since step 24 an unavailable service never reaches that view: the reflection is saved, waits, and the engine retries. Whether the saved note on Journal should point to Support Resources is a crisis-handling change, so it is reported as a question, not built (see "Known limits and questions").

18. **Server times are kept in the form every engine reads.** PostgREST writes a timestamptz with microseconds and an offset (`2026-10-25T11:59:00.123456+00:00`). The date format an engine must read has exactly three fractional digits, and the iPhone's engine (Hermes) was not shown to read more, while every date in the app (order, "days of reflection", the week's count, the stale rule, the timestamps on the cards) is worked out from these texts. So the two places where a time enters the app, `entriesRemote.ts` (the rows) and `entryProcessor.ts` (the entry the function answers with), keep it as `2026-10-25T11:59:00.123Z` (`src/utils/timestamp.ts`: the milliseconds are cut, not rounded). The one text kept exactly as the server wrote it is the Journal's page cursor, because PostgREST compares microseconds. The mapper `toJournalEntry` is untouched, so it still equals what the function's `response.ts` makes of a row (the parity check).

---

## What you do yourself (read this first)

The implementer cannot do this part: it needs your iPhone and your Supabase dashboard. If you would rather be walked through it one instruction at a time, with a screenshot after each, say "guide me" (that is how steps 17 to 24 went).

### Keys and settings: nothing new (checked in the review, by names only)

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set. This step adds nothing to it. |
| `supabase/functions/.env.local` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `CLERK_ISSUER`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE` | all set, and already on the hosted project. Not touched by this step. |

Nothing to create in Supabase, Clerk, Google Cloud or RevenueCat, and nothing to deploy. The app reaches the functions with the Clerk session token it already sends (step 17), so no key travels in a request body.

### A. Before the phone tests

1. Say yes to implement.
2. When the implementer is done, **restart Metro** with `npx expo start -c` (new files add classes and modules), then force-quit and reopen Expo Go.
3. The account you are signed in with on the phone must have the plan `pro` for the walk-through, or the weekly limit stops the first new reflection (an account that made its 3 devotionals this week gets the Paywall instead). Profile shows which account that is (its email). Find its Clerk user id: Clerk dashboard, **Users**, click the account, copy the **User ID** (it starts with `user_`). Then in the Supabase dashboard: **Table Editor**, `users_profile`, the row whose `id` is that user id (step 22 did the same for the test account), set `subscription_tier` to `pro`, **Save**. Step B8 sets it to `free` for a minute and back.
4. What it costs: a reflection is about $0.002 of Gemini (a spoken one about $0.007), paid from the $20 of credit, and speech is free within Google's monthly allowance of one million characters (about 590 devotionals). The walk-through makes about five reflections, so about two cents. Each one stores about 5 MB of spoken audio in Storage (1 GB on the free plan), so delete the test files in **Storage**, `journal_media`, your folder, `devotionals/`, from time to time.

### B. Phone walk-through (iPhone, Expo Go)

Tell the implementer what you saw after each step. The Developer controls are at the bottom of the Profile tab. "Supabase check (dev)" is a button there: it prints a few lines, and the last two are the new ones, `last entries error` and `last function call`.

0. **Start.** Sign in. On Profile press "Supabase check (dev)". Expect `data source: supabase`, `signed in: yes`, `Clerk token: has role = authenticated`, `last entries error: none`, `last function call: none`. If it says `data source: mock`, press `supabase` under "Data source (dev)" (that chip, and the missing Supabase address in `.env.local`, are the two ways to get the sample data).
1. **Your real reflections.** Open Journal. The sample cards of the step 06 data are gone: you see your own reflections, and the number next to "Your Reflections" is the number of rows in **Table Editor**, `journal_entries`, with your `user_id` and `processing_status` `ready` (a `processing` one, if any, counts too). An account with no reflections shows "No reflections yet", which is right: do step 2 first.
2. **A written reflection, for real.** Tap the pen, write a sentence or two (at least 10 characters), **Submit Reflection**. The overlay shows "Reading" done, then "Reflecting" after about 4 seconds, then "Preparing your devotional" after about 12, and the whole thing takes 8 to 30 seconds. Reflection opens with a real devotional, a verse **with its text** (the Berean Standard Bible), three affirmations and a closing prayer. The mini player shows the real length (about 1:40 to 2:00); pressing play runs the mock timer, with no sound until step 26. Back on Journal the new card is first and the count went up by one. In the Table Editor the new row has `input_type` text, `processing_status` ready and a `devotional_audio_path`. On Profile, "Supabase check (dev)" now ends with `last function call: process-entry 200, <seconds> s`.
3. **A voice reflection.** Tap the mic, speak for 10 to 20 seconds, **Finish Reflection**. The same overlay, then a Reflection with "Your spoken prayer" and your words. In **Storage**, `journal_media`, your folder, `raw/`, the recording is there. On Profile, "Recordings (dev)" is back to the number it had before (the local file is deleted once the reflection is saved).
4. **Offline, with a cache.** On Journal, wait until the cards are there. Turn Airplane mode on (Expo Go keeps running). Pull down to refresh: the cards stay and no error card appears. Open a reflection you opened before: it opens with its verse and affirmations. Open one you never opened: it opens too (the devotional and verse come from the cache; its Affirmations tab may say there are none, because only the reflections you opened, and the newest one, keep theirs). Write a new reflection: "Saved. We’ll prepare your reflection when you’re back online." Turn Airplane mode off: within about 10 seconds the card becomes a real reflection, and nothing appears twice.
5. **Pages.** Profile, "Page size (dev)", **5**. On Journal pull down to refresh: five cards, and the number at the top is still the whole count. Scroll to the bottom: a small spinner, then five more; keep going to the end. No card repeats, and nothing loads after the last one. Put the page size back to **30**. (This needs at least 6 reflections. If you have fewer, make a few more first, short ones are enough.)
6. **A passage kept as a reference.** In the Table Editor open one of your finished reflections in `journal_entries` and set `scripture_text` to **NULL** and `scripture_verified` to **FALSE**, **Save**. On the phone open that reflection from Journal: its verse is back within a second or two (the card may say "We’re confirming this passage." for a moment first). In the Table Editor the row now has the text and `scripture_verified` TRUE again: the function read the passage from the Bible and saved it. "Supabase check (dev)" shows `last function call: confirm-scripture 200, <seconds> s`.
7. **The heart.** On Journal tap the heart on the affirmation card: it fills at once, and in the Table Editor (`daily_affirmations`, refresh the grid) that row has `is_favorite` TRUE. Leave Journal and come back: still filled. Turn Airplane mode on and tap it again: it goes back to empty and the line "We couldn’t save that. Please try again." appears under the card. Airplane mode off, tap again: it saves, and the line goes.
8. **The free limit.** In the Table Editor set your `users_profile` row's `subscription_tier` to **free**, **Save**. Wait 30 seconds, send Expo Go to the Home screen and open it again (the plan is read when the app comes to the front, at most every 30 seconds). Profile's plan card says "Gracehush Free" and, if you made 3 or more devotionals this week, "3 of 3 audio devotionals used this week". Submit a written reflection: the Paywall opens with "You’ve used your 3 free devotionals this week." and "Your reflection is saved." Close it with the X. Journal shows a card "Saved · Unlocks with Pro or on {weekday}" with **See plans**; the Table Editor has the row with `processing_status` failed and `error_code` LIMIT_REACHED (kept, not lost). Now set `subscription_tier` back to **pro**, wait 30 seconds, send the app to the Home screen and back: within a few seconds the card becomes "Preparing your reflection…" and then a normal card, and the **same** row is now ready (no second row).
9. **Optional: a crisis entry.** Only if you are comfortable typing it. Write a reflection with the made-up sentence in `src/components/dev/processEntryCheck.ts` (the constant `CRISIS`). The overlay is the same, then Reflection shows the calm support view (no player, no verse, no tabs), Journal's card says "A heavy moment. Tap to see support.", and `daily_affirmations` has no rows for it. It does not count toward the free limit.
10. **Optional: a second account.** Sign out (Profile, Sign Out) and sign in with another account: it sees only its own reflections. Sign back in: yours load again (the cache was deleted at sign-out, so the first Journal load shows the skeleton).
11. **The mock still works.** Profile, "Data source (dev)", **mock**: Journal shows the step 06 sample data, and the "Next submit" buttons work as before. Switch back to **supabase**.

Not testable on an iPhone in Expo Go, and said so in the report: that nothing is logged that should not be (the harness proves it on the log lines, and Metro's terminal is yours to glance at), a request that takes longer than about 64 seconds (the longest the phone has been seen to wait; the function normally answers in 8 to 30 and the engine retries safely if a wait is cut short), and the real RevenueCat purchase (step 30).

### C. Android (optional, and only with your yes)

The emulator window holds your own signed-in account, so opening the app there runs it against your real project. The implementer asks first. If you say no, Android is reported "not verified".

### If something goes wrong: what it means

| what you see | what it means |
| --- | --- |
| Journal shows the old sample cards | the data source is `mock`: press `supabase` under "Data source (dev)", or `.env.local` has no Supabase address |
| "We couldn’t load your reflections." and "Try again" does not help | open "Supabase check (dev)": `last entries error: journal_entries: PGRST301` or `401` means the token was refused (sign out and in again, then tell the implementer); `…: no answer` means no network; `…: 42501` is a missing grant (tell the implementer, it is a step 18 matter) |
| a new reflection opens the Paywall at once | the server says you are over the free limit: set `subscription_tier` to `pro` (step A3) |
| the card stays "Preparing your reflection…" for minutes | `last function call` says why: `process-entry 503 AI_UNAVAILABLE` is the model being busy (the phone retries by itself, 5 s, 15 s, 60 s…), `no answer` is the network, `401 UNAUTHORIZED` means the function does not accept your session (`CLERK_ISSUER`), and `process-entry 429 RATE_LIMITED` means more than 10 reflections in 10 minutes |
| the verse stays "We’re confirming this passage." | `last function call: confirm-scripture …` says why; the Bible service may be down, and the card tries again the next time you open the reflection (at most once a minute) |
| a reflection appears twice | it should not: tell the implementer (the Journal merges a waiting card with its server copy by the client entry id) |
| Profile says "0 of 3 used" right after signing in on a new phone | the number is counted from this phone's cache, which fills when Journal first loads (see "Known limits and questions"); the server still counts correctly |

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **Nothing is installed or changed natively.** No package, no `app.json` entry, no prebuild, no migration of Supabase, no policy, no function change, no deploy, no secret. `package.json` and the lockfile end up unchanged.
2. **Where the code goes** (finding 1): `src/api/journalApi.ts` (the only code that calls the two functions), `src/data/entriesRemote.ts` (the only code that queries `journal_entries` and `daily_affirmations`, as `profileRemote.ts` is for `users_profile`), `src/data/entriesLive.ts` (cache first, then the network, everything read written to the cache), `src/data/columns.ts`, `src/services/scriptureConfirm.ts`, `src/services/upgradeWatcher.ts`, `src/utils/week.ts`.
3. **One data source switch.** `devStore.profileSource` becomes `dataSource` (`"supabase"` or `"mock"`, default `"supabase"`), `getProfileSource()` becomes `getDataSource()`, and it now decides the profile (step 17), the entries, the affirmations, the usage and the processing of a reflection. A development build with no Supabase address in `.env.local` still falls back to the mock, and a release build is always `"supabase"`. With `"mock"` everything behaves exactly as before (the step 06 data, the scenarios, the "Next submit" outcomes), nothing reaches the server, and the engine writes nothing to the read cache.
4. **What the Journal reads.** The explicit column lists of finding 8; `limit + 1` rows per page of 30, newest first, cursor on `created_at`; the first page asks for the count and trims the cache to the newest 200; listed statuses are `ready` and `processing`; a failed entry and a stale `processing` one are not listed (finding 5). The page size is `getEntriesPageSize()`: 30, or the dev panel's choice (30 or 5) in development.
5. **Cache first.** A screen shows what the phone has at once (the cache, one page's worth plus 20 spare rows), then the first page from the server replaces it. A failed refresh keeps what is on screen; with nothing on screen it is the existing error state. When the screen is left and entered again, or the app comes back to the front, it reads the first page again and **keeps the older pages already on screen** (a pull-to-refresh starts again from the first page).
6. **The gateway** (`journalApi.ts`) answers `{ ok: true, data }` or `{ ok: false, status, code, body }` and never throws and never logs a body, a token, a text or an id. The code is the function's own (`error.code`), or `NETWORK` (no answer), `UNAUTHORIZED` (no session, 401 or 403), `RATE_LIMITED` (429), `INTERNAL` (5xx) or `UNKNOWN` from the status; `status` is 0 when nothing answered. It remembers the last call as a name, a status, a code and a time for the dev panel.
7. **The processor** sends exactly the contract (a written entry `{ clientEntryId, inputType, text }`, a recording `{ clientEntryId, inputType, audioPath, durationMs, mimeType }`), takes the user id from the session and never puts it in a body, uploads a recording once, and answers the step 24 `ProcessOutcome` (with the 402's `entryId` and `resetsAt`). An answer the app does not know is `UNKNOWN` and is retried, never dropped.
8. **Usage** (finding 6): the number is computed on the phone; the server's 402 is the only thing that opens the Paywall. A trial or Pro plan is `limit: null`.
9. **The passage** (`scriptureConfirm.ts`): asked again only when the entry is finished, not a crisis, its passage is not verified, the phone is online (or unknown) and the data source is the server; at most once a minute per entry, in memory; the answer (a verified passage, still unverified, or none) is shown and written to the cache; a failure changes nothing and shows nothing.
10. **The heart** is saved on the server (`daily_affirmations.is_favorite`, the one column the app may write, step 18) and in the cache; it shows at once and goes back with a calm line when the save fails. `AffirmationCard` becomes a controlled component.
11. **Resume after an upgrade** (finding 9): a new `upgradeWatcher.ts` started by the auth bridge. It acts only when the plan this phone knows goes from free (or unknown) to trial or Pro.
12. **Developer panel.** "Profile source" becomes "Data source (dev)"; a "Page size (dev)" row; the Supabase check also prints `last entries error` and `last function call`. Dev-panel strings stay inline (AGENTS.md).
13. **Priority inference** (step 21's open item) is not used: it costs 75 to 100% more, and the paid-tier timings (step 21's billing entry) showed no busy answers. Step 32 can revisit it with real traffic.
14. **Copy.** Two new strings (`journal.affirmation.saveError`, `journal.loadingMore`), and the failed-reflection body changes from "…You can try again from your journal." to "Your words are safe. Please record or write this reflection again.", because a failed server entry has no "Try again" (finding 5). Every string keeps typographic punctuation.
15. **Times from the server** (finding 18): `normalizeTimestamp` in a new `src/utils/timestamp.ts`, used at the two entry points only; the profile's `created_at` (step 17) is not touched.
16. **Known limits and questions** are reported, not decided: (a) the first-run Profile usage may read low until Journal has loaded; (b) a filter works on the entries loaded so far, and its count too; (c) the streak ("days of reflection") counts the loaded entries only (`TODO(33)`: a server count); (d) the pagination cursor skips an entry that has exactly the same `created_at` microsecond as the last row of a page (impossible for one person's reflections); (e) a reflection held by the free limit, or waiting, on a phone that is not the one that made it is not visible on the other phone until it is prepared; (f) a phone whose clock is more than 10 minutes wrong may hide a fresh `processing` entry or show a stale one; (g) the Journal pages carry the full text of each reflection (about 6 to 8 KB), so 30 entries are about 200 KB, in return for opening a reflection offline; (h) **a question for you:** since step 24 a reflection that cannot be screened because the model service is down waits and retries, and Journal says "Saved. We’ll finish your reflection as soon as we can." A person in distress could read that as "nobody answered". Adding a "Support resources" link to that line is a change to crisis handling, so it is yours to decide (AGENTS.md: if unsure, ask). Profile's "Support & Helpline Resources" row works offline today.

---

## 0. Before you write code

1. Read AGENTS.md (the new "Journal Data Rules (step 25)", the vendor note on supabase-js 2.118 and Hermes, "Local Cache & Offline Rules", "Backend / Edge Function Rules") and these files: `src/data/journalRepository.ts`, `src/data/mappers.ts`, `src/data/selectors.ts`, `src/db/cache.ts`, `outbox.ts`, `schema.ts`, `src/services/entryProcessor.ts`, `syncEngine.ts`, `mediaUpload.ts`, `profileSync.ts`, `src/components/SupabaseAuthBridge.tsx`, `src/hooks/useJournalHome.ts`, `useReflection.ts`, `src/components/AffirmationCard.tsx`, `src/screens/journal/JournalFeedScreen.tsx`, `ReflectionScreen.tsx`, `NewEntryScreen.tsx`, `src/store/devStore.ts`, `src/data/mock/scenario.ts`, `src/types/index.ts`, `supabase/functions/process-entry/contracts.ts` and `confirm-scripture/handler.ts`.
2. Baseline. `node --version` must be 22.5 or newer (the checks use `node:sqlite`; 24.15 here). `npm run typecheck` and `npm run lint` must pass. Then run the four older checks: `node --no-warnings supabase/tests/offline/run.cjs` (44 of 44), `node --no-warnings supabase/tests/recording/run.cjs` (68), `node --no-warnings supabase/tests/profile-sync/run.cjs` (88, about 35 seconds) and `node supabase/tests/process-entry/parity.cjs` (7 of 7). They must all pass before any change.
3. **Red first.** Apply section 3.1 (the three small edits to the older checks) and run them again: `offline` must fail 2 of 44 (the "version 2" check and "a mock processor's entries are not written to the cache"), `profile-sync` must fail 56 of 88 (the dev store has no `setDataSource` yet), `recording` and `parity` stay green. Then run one group of the new checks at a time: `ONLY="gateway:" node --no-warnings supabase/tests/journal-data/run.cjs` must fail with `cannot resolve @/api/journalApi`, `ONLY="selectors:"` with `selectors.mergeEntries is not a function`. (The whole new run is slow while it is red, because every check waits for its limit; `ONLY=<text>` runs the checks whose name holds that text.) That is the red.
4. Write down what you keep. `journalRepository.ts` keeps every name it exports and every argument order; `listEntries()` stays without arguments (Profile and the developer panel call it); `getEntry` still answers `HomeEntry | null`; `processMock` keeps its signature. The new exports are `readCachedEntries`, `readCachedEntry`, `readCachedAffirmations`, `readCachedLatestAffirmations`, `loadEntriesPage` and `setAffirmationFavorite`. `getProfileSource` and `profileSource` are renamed everywhere (`grep -rn "rofileSource" src supabase/tests` must find nothing afterwards).
5. **No install.** `package.json` and `package-lock.json` must be byte-identical at the end (`git diff --stat` shows neither). `app.json` too.
6. List every `TEMP(25)` and `TODO(25)` with file:line (`grep -rn "TEMP(25)\|TODO(25)" src supabase`). Nine today: `src/components/AffirmationCard.tsx` (the heart is not saved), `src/components/JournalCard.tsx` (retry of a failed entry), `src/constants/copy.ts` twice ("waiting in your Journal", "try again from your journal"), `src/data/journalRepository.ts` twice (the `processMock` header, the 402 body), `src/data/mock/db.ts` (`addMockEntry`), `src/screens/journal/ReflectionStateViews.tsx` ("Try again" on the preparing view) and `src/services/entryProcessor.ts` (the mock processor). Each one is closed by the edits below, and `grep` must find none at the end.

---

## 1. The files to create (verbatim)

All LF. They are the finished, proven files: do not reword them, and do not add what is not here.

### 1.1 `src/data/columns.ts`

The column lists the app reads, as literal types, so the compiler checks that a list still holds every column the mappers read (the mappers take `EntryRow` and `AffirmationRow`, section 2.7).

```ts
import type { DailyAffirmationRow, JournalEntryRow } from "@/types/database";

// The columns the app reads from journal_entries and daily_affirmations (step 25): always an explicit list, never `*`.
// Left out on purpose: audio_path (where the raw recording is stored: the app wrote it and never shows it) and user_id (the
// filter uses it, nothing displays it). The lists are literal types, so supabase-js gives each query the exact row type,
// and the two types below make the compiler check that a list still holds every column the mappers read.
export const ENTRY_COLUMNS =
  "id, client_entry_id, input_type, transcript, dominant_emotion, processing_status, error_code, is_crisis, scripture_reference, scripture_text, scripture_verified, devotional_title, devotional_script, closing_prayer, devotional_audio_path, devotional_duration_ms, is_active_prayer, is_answered, answered_at, answered_notes, prayer_title, prayer_category, prayer_summary, created_at, updated_at" as const;

export const AFFIRMATION_COLUMNS = "id, entry_id, time_slot, headline, affirmation_text, is_favorite" as const;

// What toJournalEntry and toAffirmation (src/data/mappers.ts) read. A full row of either table is one of these too.
export type EntryRow = Omit<JournalEntryRow, "audio_path" | "user_id">;
export type AffirmationRow = Pick<
  DailyAffirmationRow,
  "id" | "entry_id" | "time_slot" | "headline" | "affirmation_text" | "is_favorite"
>;
```

### 1.2 `src/utils/week.ts`

A copy of the server's week. The harness compares the two for 14 zones and 15 instants (daylight-saving changes and week edges included); if you change one, change the other.

```ts
import { WEEK_STARTS_ON } from "@/constants/app";

// The free tier's week, worked out the same way the server does it (step 22). KEEP IN SYNC with weekWindow in
// supabase/functions/_shared/limits/weekly.ts: that function decides when the limit resets and its 402 says so, so this copy
// must give the same two instants for the same time and zone (supabase/tests/journal-data checks the two against each other).
//
// The week runs from the start-of-week day at 00:00 on the clock of the person's time zone to the same moment a week later.
// Only Intl is used (Hermes has it, with time zones), and a time zone that Intl does not know is read as UTC, with a flag.
// The week is not always 168 hours long: a daylight-saving change inside it makes it 167 or 169.

export type WeekWindow = {
  start: Date; // the first instant of the week, inclusive
  end: Date; // the first instant of the next week: when the limit resets
  zone: string; // the zone that was used
  zoneFallback: boolean; // true when the zone was not valid and UTC was used instead
};

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

// Throws a RangeError for a time zone that does not exist. hourCycle h23 keeps midnight "00" (hour12: false says "24").
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, found);
  }
  return found;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// The clock and calendar of `zone` at this instant.
function wall(instantMs: number, zone: string): Wall {
  const values: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(instantMs))) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS[values.weekday] ?? 0,
  };
}

// A wall clock written as milliseconds as if it were UTC, so two of them can be compared and subtracted.
function wallMs(w: Wall): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

// Seconds are all Intl gives, so the instant is cut to a whole second first.
function offsetMs(instantMs: number, zone: string): number {
  return wallMs(wall(instantMs, zone)) - Math.floor(instantMs / 1000) * 1000;
}

// The first instant at which the clock of `zone` reads this calendar day, 00:00. The first guess uses the offset at the
// wrong instant on a daylight-saving day and the second pass corrects it, which settles almost every day at once.
// Where the clocks jumped over midnight there is no such instant, and the day starts when they land: that is found by
// stepping a minute at a time from a few hours before (and is also what would settle any day the two passes missed).
// Where midnight happens twice (Cuba's clocks go back from 01:00 to 00:00), the first pass uses the offset from before
// the change, so the earlier midnight is the one that is found.
function startOfDay(year: number, month: number, day: number, zone: string): number {
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = target - offsetMs(target, zone);
  guess = target - offsetMs(guess, zone);
  if (wallMs(wall(guess, zone)) === target) return guess;
  let at = guess - 3 * 3_600_000;
  while (wallMs(wall(at, zone)) < target) at += 60_000;
  return at;
}

// The calendar day that is `days` after this one (negative: before), in the proleptic Gregorian calendar.
function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

export function weekWindow(now: Date, timeZone: string, weekStartsOn: number = WEEK_STARTS_ON): WeekWindow {
  let zone = timeZone;
  let zoneFallback = false;
  try {
    formatter(zone);
  } catch {
    zone = "UTC";
    zoneFallback = true;
  }
  const here = wall(now.getTime(), zone);
  const sinceStart = (here.weekday - weekStartsOn + 7) % 7;
  const first = addDays(here.year, here.month, here.day, -sinceStart);
  const next = addDays(first.year, first.month, first.day, 7);
  return {
    start: new Date(startOfDay(first.year, first.month, first.day, zone)),
    end: new Date(startOfDay(next.year, next.month, next.day, zone)),
    zone,
    zoneFallback,
  };
}
```

### 1.3 `src/api/journalApi.ts`

The only code that calls the two Edge Functions. It never throws and logs nothing but what the dev panel's Supabase check reads (a name, a status, a code and a time).

```ts
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

import { CONFIRM_SCRIPTURE_TIMEOUT_MS, PROCESS_ENTRY_TIMEOUT_MS } from "@/constants/app";
import { getSupabase } from "@/services/supabaseClient";
import type {
  Affirmation,
  ConfirmScriptureRequest,
  ConfirmScriptureResponse,
  Devotional,
  JournalEntry,
  Prayer,
  ProcessEntryRequest,
  ProcessEntryResponse,
  Scripture,
} from "@/types";
import { NO_SESSION_ERROR_NAME } from "@/utils/supabaseErrors";

// The only code that calls the two Edge Functions (step 25). supabase-js sends the Clerk session token as the bearer
// token by itself (the accessToken option of src/services/supabaseClient.ts), so nothing here builds an Authorization
// header or asks Clerk for a token. Every call answers with data or with a failure that carries the HTTP status and a
// code; it never throws.
//
// supabase.functions.invoke does not throw either: a non-2xx answer comes back as a FunctionsHttpError whose `context` is
// the Response, which is where the function's own error code (and, for a 402, the saved entry and the numbers) is read.
// Nothing here logs a body, a token, a text or an id: the dev panel's Supabase check reads getLastFunctionCall().

export type FunctionName = "process-entry" | "confirm-scripture";

export type FunctionResult<T> =
  | { ok: true; data: T }
  // `code` is the function's own error code, or one of NETWORK (no answer), UNAUTHORIZED, RATE_LIMITED, INTERNAL and UNKNOWN
  // worked out from the status. `body` is the parsed error body (null when there was none): a 402 carries the entry that
  // was saved and when the week resets.
  | { ok: false; status: number; code: string; body: unknown };

export type FunctionCall = { name: FunctionName; status: number; code: string | null; ms: number };

let lastCall: FunctionCall | null = null;

// For the developer panel: what the last call to a function came to. A name, a status, a code and a time, nothing else.
export function getLastFunctionCall(): FunctionCall | null {
  return lastCall;
}

function record<T>(name: FunctionName, started: number, result: FunctionResult<T>): FunctionResult<T> {
  lastCall = {
    name,
    status: result.ok ? 200 : result.status,
    code: result.ok ? null : result.code,
    ms: Date.now() - started,
  };
  return result;
}

// ---- shapes: small guards for what the functions promise (src/types/index.ts, kept equal to contracts.ts) -------------
const STATUSES: readonly string[] = ["pending", "uploading", "processing", "ready", "failed"];
const SLOTS: readonly string[] = ["morning", "afternoon", "evening"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isScripture(value: unknown): value is Scripture {
  return (
    isRecord(value) &&
    isString(value.reference) &&
    isNullableString(value.text) &&
    value.translation === "BSB" &&
    typeof value.verified === "boolean"
  );
}

function isDevotional(value: unknown): value is Devotional {
  return (
    isRecord(value) &&
    isString(value.title) &&
    isString(value.script) &&
    isNullableString(value.closingPrayer) &&
    isNullableString(value.audioPath) &&
    (value.durationMs === null || typeof value.durationMs === "number")
  );
}

function isPrayer(value: unknown): value is Prayer {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isNullableString(value.category) &&
    isString(value.summary) &&
    isNullableString(value.scriptureReference) &&
    isString(value.createdAt) &&
    typeof value.isAnswered === "boolean" &&
    isNullableString(value.answeredAt) &&
    isNullableString(value.answeredNote)
  );
}

function isEntry(value: unknown): value is JournalEntry {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isNullableString(value.clientEntryId) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    (value.inputType === "text" || value.inputType === "audio") &&
    isNullableString(value.transcript) &&
    isNullableString(value.dominantEmotion) &&
    isString(value.status) &&
    STATUSES.includes(value.status) &&
    typeof value.isCrisis === "boolean" &&
    (value.scripture === null || isScripture(value.scripture)) &&
    (value.devotional === null || isDevotional(value.devotional)) &&
    (value.prayer === null || isPrayer(value.prayer)) &&
    isNullableString(value.failureCode) &&
    typeof value.isLocalOnly === "boolean"
  );
}

function isAffirmation(value: unknown): value is Affirmation {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.entryId) &&
    isString(value.slot) &&
    SLOTS.includes(value.slot) &&
    isString(value.headline) &&
    isString(value.text) &&
    typeof value.isFavorite === "boolean"
  );
}

function isProcessEntryResponse(value: unknown): value is ProcessEntryResponse {
  return isRecord(value) && isEntry(value.entry) && Array.isArray(value.affirmations) && value.affirmations.every(isAffirmation);
}

function isConfirmScriptureResponse(value: unknown): value is ConfirmScriptureResponse {
  return isRecord(value) && "scripture" in value && (value.scripture === null || isScripture(value.scripture));
}

// ---- failures ------------------------------------------------------------------------------------------------------
// For an answer that has none of our codes in it: the platform's own 4xx and 5xx (a function that is not deployed, a
// worker that ran out of memory, a request that took too long).
function codeFromStatus(status: number): string {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL";
  return "UNKNOWN";
}

async function readFailure(error: unknown): Promise<{ status: number; code: string; body: unknown }> {
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const response = error.context as Response;
    const status = typeof response.status === "number" ? response.status : 0;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // An answer with no JSON in it (the platform's own page): the status says what it was.
    }
    const named = isRecord(body) && isRecord(body.error) && isString(body.error.code) ? body.error.code : null;
    return { status, code: named ?? codeFromStatus(status), body };
  }
  if (error instanceof FunctionsFetchError) {
    // No answer at all: offline, a dropped connection, our own timeout, or the token callback of the Supabase client
    // that threw. Only the last one is about the session: the Clerk token could not be had because nobody is signed in.
    const cause: unknown = error.context;
    const noSession = cause instanceof Error && cause.name === NO_SESSION_ERROR_NAME;
    return { status: 0, code: noSession ? "UNAUTHORIZED" : "NETWORK", body: null };
  }
  return { status: 0, code: "UNKNOWN", body: null };
}

async function callFunction<T>(
  name: FunctionName,
  body: ProcessEntryRequest | ConfirmScriptureRequest,
  timeout: number,
  isValid: (value: unknown) => value is T,
): Promise<FunctionResult<T>> {
  const started = Date.now();
  const supabase = getSupabase();
  // Signed out (or no Supabase address): nothing is sent.
  if (supabase === null) return record(name, started, { ok: false, status: 0, code: "UNAUTHORIZED", body: null });
  try {
    // `timeout` aborts the request itself, which comes back as a FunctionsFetchError: no answer, so NETWORK.
    const { data, error } = await supabase.functions.invoke<unknown>(name, { body, timeout });
    if (error !== null) return record(name, started, { ok: false, ...(await readFailure(error)) });
    if (isValid(data)) return record(name, started, { ok: true, data });
    // The function answered 200 with something that is not what it promises.
    return record(name, started, { ok: false, status: 200, code: "UNKNOWN", body: null });
  } catch {
    return record(name, started, { ok: false, status: 0, code: "UNKNOWN", body: null });
  }
}

// process-entry (steps 19 to 22). It takes up to about 145 seconds (the function stops itself at 150), so the call gives up
// at PROCESS_ENTRY_TIMEOUT_MS, and the sync engine's own ceiling is above that.
export function processEntry(request: ProcessEntryRequest): Promise<FunctionResult<ProcessEntryResponse>> {
  return callFunction("process-entry", request, PROCESS_ENTRY_TIMEOUT_MS, isProcessEntryResponse);
}

// confirm-scripture (step 20): the passage of one reflection, read again from the Bible.
export function confirmScripture(entryId: string): Promise<FunctionResult<ConfirmScriptureResponse>> {
  return callFunction("confirm-scripture", { entryId }, CONFIRM_SCRIPTURE_TIMEOUT_MS, isConfirmScriptureResponse);
}

// The 402 body (step 22): the entry the server saved and when the free week ends. Null for any other body.
export function readLimitBody(body: unknown): { entryId: string; resetsAt: string } | null {
  if (!isRecord(body) || !isString(body.entryId) || !isRecord(body.usage) || !isString(body.usage.resetsAt)) return null;
  return { entryId: body.entryId, resetsAt: body.usage.resetsAt };
}
```

### 1.4 `src/data/entriesRemote.ts`

The only code that sends a request about `journal_entries` and `daily_affirmations`.

```ts
import { copy } from "@/constants/copy";
import {
  AFFIRMATION_COLUMNS,
  ENTRY_COLUMNS,
  type AffirmationRow,
  type EntryRow,
} from "@/data/columns";
import { getSupabase, getSupabaseUserId } from "@/services/supabaseClient";
import type { RepoResult } from "@/types";
import { describeFailure, toFailureCode } from "@/utils/supabaseErrors";
import { normalizeTimestamp } from "@/utils/timestamp";

// The only code that sends a request about journal_entries and daily_affirmations (step 25), as profileRemote.ts is for
// users_profile. It reads with the explicit column lists of data/columns.ts and writes only what the migration grants the app:
// is_favorite. Every query filters by the user's id as well as relying on row level security. Nothing here logs more than a
// table and an error code.

// The statuses the Journal lists. A failed entry is not listed: the phone that made it keeps it as a card of its own until it
// is prepared, and a refused or deleted one is no reflection (step 25).
const LISTED_STATUSES = ["ready", "processing"];

let lastError: string | null = null;

// For the dev panel's Supabase check: the table and code of the last failure, or null after a success.
export function getLastEntriesError(): string | null {
  return lastError;
}

function unauthorized(message: string): RepoResult<never> {
  lastError = "no session";
  return { ok: false, code: "UNAUTHORIZED", message };
}

function fail(
  table: string,
  status: number,
  error: { message?: string | null; code?: string | null },
  message: string,
): RepoResult<never> {
  lastError = describeFailure(table, status, error);
  if (__DEV__) {
    // Only the table and the code, never a message, a row, a token or an id.
    console.warn(`[supabase] ${lastError}`);
  }
  return { ok: false, code: toFailureCode(status, error), message };
}

export type EntryRows = {
  // The page, with its times in the form the app keeps (utils/timestamp.ts).
  rows: EntryRow[];
  // The created_at to ask the next page from, exactly as the server wrote it (microseconds and all: PostgREST compares them), or
  // null when there is no row older than this page (the page was asked for one row more than it holds).
  nextCursor: string | null;
  // How many entries the Journal lists in all. Known for the first page only: a later page counts only what is older.
  total: number | null;
};

// The times of a row in the form the app keeps them. The rest of the row is untouched.
function withCanonicalTimes(row: EntryRow): EntryRow {
  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
    answered_at: row.answered_at === null ? null : normalizeTimestamp(row.answered_at),
  };
}

// One page of the Journal, newest first. `cursor` is the created_at of the last row of the page before, or null for the first.
export async function selectEntriesPage(cursor: string | null, limit: number): Promise<RepoResult<EntryRows>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.journal.error.message);
  let query = supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .in("processing_status", LISTED_STATUSES)
    .order("created_at", { ascending: false });
  if (cursor !== null) query = query.lt("created_at", cursor);
  const { data, error, status, count } = await query.limit(limit + 1);
  if (error !== null) return fail("journal_entries", status, error, copy.journal.error.message);
  lastError = null;
  const page = data.slice(0, limit);
  const last = page[page.length - 1];
  return {
    ok: true,
    data: {
      rows: page.map(withCanonicalTimes),
      nextCursor: data.length > limit && last !== undefined ? last.created_at : null,
      total: cursor === null ? count : null,
    },
  };
}

// One entry of any status, or null when there is none (or it is not this user's).
export async function selectEntry(id: string): Promise<RepoResult<EntryRow | null>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.journal.error.message);
  const { data, error, status } = await supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) return fail("journal_entries", status, error, copy.journal.error.message);
  lastError = null;
  return { ok: true, data: data === null ? null : withCanonicalTimes(data) };
}

// The affirmations of one entry (three for a finished reflection, none for any other).
export async function selectAffirmations(entryId: string): Promise<RepoResult<AffirmationRow[]>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.journal.error.message);
  const { data, error, status } = await supabase
    .from("daily_affirmations")
    .select(AFFIRMATION_COLUMNS)
    .eq("entry_id", entryId)
    .eq("user_id", userId);
  if (error !== null) return fail("daily_affirmations", status, error, copy.journal.error.message);
  lastError = null;
  return { ok: true, data };
}

// The one column of daily_affirmations the app may write. An update that changes no row means the affirmation is missing or
// not this user's.
export async function updateAffirmationFavorite(id: string, value: boolean): Promise<RepoResult<AffirmationRow>> {
  const message = copy.journal.affirmation.saveError;
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(message);
  const { data, error, status } = await supabase
    .from("daily_affirmations")
    .update({ is_favorite: value })
    .eq("id", id)
    .eq("user_id", userId)
    .select(AFFIRMATION_COLUMNS);
  if (error !== null) return fail("daily_affirmations", status, error, message);
  lastError = null;
  const row = data[0];
  return row === undefined ? { ok: false, code: "NOT_FOUND", message } : { ok: true, data: row };
}
```

### 1.5 `src/data/entriesLive.ts`

The real source behind the repository: what the phone has first, then the network, and everything read is written to the cache. The cache never breaks a screen.

```ts
import { ENTRY_CACHE_LIMIT } from "@/constants/app";
import {
  selectAffirmations,
  selectEntriesPage,
  selectEntry,
  updateAffirmationFavorite,
} from "@/data/entriesRemote";
import { toAffirmation, toJournalEntry } from "@/data/mappers";
import { getNewestReadyEntry, isListedEntry } from "@/data/selectors";
import * as cache from "@/db/cache";
import { isDatabaseOpen } from "@/db/database";
import type { Affirmation, JournalEntry, RepoResult, TimeSlot } from "@/types";

// The real source of the Journal's entries and affirmations (step 25), used by journalRepository.ts when the data source is
// Supabase: what this phone already has comes first (the read cache of step 24), then the network, and everything read from the
// network is written to the cache. The cache never breaks a screen: with the database closed, or a row that cannot be read, a
// read gives "nothing cached" and a write is skipped.

const SLOT_ORDER: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

// Every row read from the cache is decrypted, so a screen reads what it shows and a few rows more, not the whole cache: a failed
// entry or a stale one is read and then left out. The affirmations of the newest finished entry look at the newest few.
const SPARE_ROWS = 20;
const LATEST_LOOKBACK = 20;

async function safely<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  if (!isDatabaseOpen()) return fallback;
  try {
    return await task();
  } catch {
    return fallback;
  }
}

function bySlot(a: Affirmation, b: Affirmation): number {
  return SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);
}

// ---- what the phone already has ------------------------------------------------------------------------------------------
// The entries the Journal lists, newest first (a failed entry, or one still "processing" long after its request died, is kept
// but not listed).
export async function readCachedEntries(limit: number = ENTRY_CACHE_LIMIT): Promise<JournalEntry[]> {
  const entries = await safely(() => cache.listEntries(Math.min(ENTRY_CACHE_LIMIT, limit + SPARE_ROWS)), []);
  const now = Date.now();
  return entries.filter((entry) => isListedEntry(entry, now)).slice(0, limit);
}

export function readCachedEntry(id: string): Promise<JournalEntry | null> {
  return safely(() => cache.getEntry(id), null);
}

export async function readCachedAffirmations(entryId: string): Promise<Affirmation[]> {
  return safely(() => cache.listAffirmationsForEntry(entryId), []);
}

// The newest finished entry that is not a crisis, among the newest few the phone has.
async function cachedNewestReady(): Promise<JournalEntry | null> {
  const entries = await safely(() => cache.listEntries(LATEST_LOOKBACK), []);
  const now = Date.now();
  return getNewestReadyEntry(entries.filter((entry) => isListedEntry(entry, now)));
}

// The affirmations of the newest finished, non-crisis entry the phone has.
export async function readCachedLatestAffirmations(): Promise<Affirmation[]> {
  const latest = await cachedNewestReady();
  return latest === null ? [] : readCachedAffirmations(latest.id);
}

// The week's count of devotionals, from the entries this phone has: a finished entry that is not a crisis and holds a devotional
// (the server's rule, step 22). `since` is the start of the week. The query allows a margin, because created_at is compared as
// text, and the exact test is made on the dates.
export async function countDevotionalsSince(since: Date): Promise<number> {
  const bound = new Date(since.getTime() - 36 * 3_600_000).toISOString();
  const entries = await safely(() => cache.listEntriesSince(bound), []);
  return entries.filter(
    (entry) => !entry.isCrisis && entry.devotional !== null && Date.parse(entry.createdAt) >= since.getTime(),
  ).length;
}

// Remembers one entry (the passage of a reflection that was just confirmed).
export function rememberEntry(entry: JournalEntry): Promise<void> {
  return safely(() => cache.upsertEntry(entry), undefined);
}

// ---- from the network, written to the cache ------------------------------------------------------------------------------
export type EntriesPage = {
  entries: JournalEntry[];
  // The created_at to ask the next page from, or null when there is no older entry.
  nextCursor: string | null;
  // How many entries the Journal lists in all: known for the first page only.
  total: number | null;
};

// One page of the Journal. The first page also trims the cache to the newest ENTRY_CACHE_LIMIT entries.
export async function loadEntriesPage(cursor: string | null, limit: number): Promise<RepoResult<EntriesPage>> {
  const result = await selectEntriesPage(cursor, limit);
  if (!result.ok) return result;
  const { rows, nextCursor, total } = result.data;
  const entries = rows.map(toJournalEntry);
  await safely(async () => {
    for (const entry of entries) await cache.upsertEntry(entry);
    if (cursor === null) await cache.pruneEntries(ENTRY_CACHE_LIMIT);
  }, undefined);
  const now = Date.now();
  return {
    ok: true,
    data: {
      entries: entries.filter((entry) => isListedEntry(entry, now)),
      nextCursor,
      total,
    },
  };
}

// One entry of any status, or null when the server has none (it is then removed from the cache). With no answer from the server
// it is the cached copy; with none of those it throws, so the screen shows its error state.
export async function fetchEntry(id: string): Promise<JournalEntry | null> {
  const result = await selectEntry(id);
  if (result.ok) {
    if (result.data === null) {
      await safely(() => cache.removeEntry(id), undefined);
      return null;
    }
    const entry = toJournalEntry(result.data);
    await safely(() => cache.upsertEntry(entry), undefined);
    return entry;
  }
  const cached = await readCachedEntry(id);
  if (cached !== null) return cached;
  throw new Error(result.code);
}

// The affirmations of an entry, with the same fallbacks as fetchEntry.
export async function fetchAffirmations(entryId: string): Promise<Affirmation[]> {
  const result = await selectAffirmations(entryId);
  if (result.ok) {
    const list = result.data.map(toAffirmation).sort(bySlot);
    await safely(() => cache.upsertAffirmations(entryId, list), undefined);
    return list;
  }
  const cached = await readCachedAffirmations(entryId);
  if (cached.length > 0) return cached;
  throw new Error(result.code);
}

// The affirmations of the newest finished entry the phone has, which is the first page after a refresh.
export async function fetchLatestAffirmations(): Promise<Affirmation[]> {
  const latest = await cachedNewestReady();
  return latest === null ? [] : fetchAffirmations(latest.id);
}

// Saves a favorite. The cache follows only when the server accepted it.
export async function saveFavorite(id: string, value: boolean): Promise<RepoResult<Affirmation>> {
  const result = await updateAffirmationFavorite(id, value);
  if (!result.ok) return result;
  const saved = toAffirmation(result.data);
  await safely(() => cache.upsertAffirmations(saved.entryId, [saved]), undefined);
  return { ok: true, data: saved };
}
```

### 1.6 `src/services/scriptureConfirm.ts`

```ts
import { confirmScripture } from "@/api/journalApi";
import { SCRIPTURE_RETRY_MS } from "@/constants/app";
import { rememberEntry } from "@/data/entriesLive";
import { getDataSource } from "@/data/mock/scenario";
import { selectIsOnline, useOfflineStore } from "@/store/offlineStore";
import type { JournalEntry, Scripture } from "@/types";

// A reflection whose passage the Bible could not be read for when it was made keeps the reference only, and the card says "We’re
// confirming this passage." (step 20). When such a reflection is opened, this asks the server to read the passage again
// (confirm-scripture) and shows what it answers: the verified text, a passage that is still unverified, or none (the reference
// turned out not to exist). It never shows a passage the server did not verify, and it never throws.

// When each reflection was last asked about, so that opening it again and again does not ask again and again. In memory only.
const asked = new Map<string, number>();

export function needsScriptureConfirmation(entry: JournalEntry): boolean {
  return entry.status === "ready" && !entry.isCrisis && entry.scripture !== null && !entry.scripture.verified;
}

function same(a: Scripture | null, b: Scripture | null): boolean {
  return a === b || (a !== null && b !== null && a.reference === b.reference && a.verified === b.verified && a.text === b.text);
}

export async function confirmScriptureIfNeeded(entry: JournalEntry, now: number = Date.now()): Promise<JournalEntry> {
  if (!needsScriptureConfirmation(entry)) return entry;
  // The mock data has no server, and a phone with no connection cannot ask.
  if (getDataSource() === "mock" || selectIsOnline(useOfflineStore.getState()) === false) return entry;
  const last = asked.get(entry.id);
  if (last !== undefined && now - last < SCRIPTURE_RETRY_MS) return entry;
  asked.set(entry.id, now);
  const result = await confirmScripture(entry.id);
  if (!result.ok) return entry;
  const { scripture } = result.data;
  if (same(entry.scripture, scripture)) return entry;
  const confirmed: JournalEntry = { ...entry, scripture };
  await rememberEntry(confirmed);
  return confirmed;
}
```

### 1.7 `src/services/upgradeWatcher.ts`

```ts
import { resumeAfterUpgrade } from "@/services/syncEngine";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { SubscriptionTier } from "@/types";

// Sends what the free limit held back as soon as this phone learns that the plan is paid (step 25). The plan reaches the phone
// in the profile sync (users_profile.subscription_tier, which only the server writes), so this covers a purchase made on this
// phone or on another one, and a change the server made itself. The sync engine alone would notice only at its next start,
// foreground or retry, which can be a day away. The purchase mock of step 16 calls resumeAfterUpgrade() on its own.
//
// The auth bridge starts it for the signed-in user and stops it at sign-out. It acts when the plan goes from free (or unknown)
// to trial or Pro, never when it stays paid or goes back to free.
function isPaid(tier: SubscriptionTier | null): boolean {
  return tier === "trial" || tier === "pro";
}

export function watchPlan(userId: string): () => void {
  const tierOf = () => useProfilePrefsStore.getState().byUser[userId]?.snapshot?.subscriptionTier ?? null;
  let last = tierOf();
  return useProfilePrefsStore.subscribe(() => {
    const next = tierOf();
    const turnedPaid = !isPaid(last) && isPaid(next);
    last = next;
    if (turnedPaid) void resumeAfterUpgrade();
  });
}
```

### 1.8 `src/utils/timestamp.ts`

Used by `entriesRemote.ts` and `entryProcessor.ts` (finding 18).

```ts
// PostgREST writes a timestamptz as text with microseconds and a numeric offset: "2026-10-25T11:59:00.123456+00:00". The date format
// that every JavaScript engine must read has exactly three fractional digits (a "Z" or an offset after them), and the engine of the
// phone (Hermes) was not shown to read more, so the app keeps every time that comes from the server as "2026-10-25T11:59:00.123Z".
// The milliseconds are cut, not rounded. A text that is not a timestamp of this shape comes back as it is.
//
// The one place that must keep the server's own text is the cursor of the Journal's pages: it is sent back to PostgREST, which
// compares microseconds (data/entriesRemote.ts passes the last row's text on untouched).
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

export function normalizeTimestamp(text: string): string {
  const match = TIMESTAMP.exec(text);
  if (match === null) return text;
  const [, date, time, fraction = "", zone = "Z"] = match;
  const millis = `${fraction}000`.slice(0, 3);
  if (zone === "Z" || zone === "z") return `${date}T${time}.${millis}Z`;
  const sign = zone.slice(0, 1);
  const hours = zone.slice(1, 3);
  const minutes = zone.replace(":", "").slice(3, 5) || "00";
  return hours === "00" && minutes === "00" ? `${date}T${time}.${millis}Z` : `${date}T${time}.${millis}${sign}${hours}:${minutes}`;
}
```

---

## 2. Edits to the existing files

Each block gives the text to find (it occurs exactly once in its file, as LF text) and the text that replaces it. Four files are replaced whole (2.22 to 2.25). These files use CRLF line endings: `src/types/index.ts`, `src/constants/app.ts`, `src/constants/copy.ts`, `src/data/selectors.ts`, `src/data/mock/scenario.ts`, `src/store/devStore.ts`, `src/services/profileSync.ts`, `src/components/SupabaseAuthBridge.tsx`, `src/data/journalRepository.ts`, `src/screens/journal/ReflectionStateViews.tsx`, `src/screens/journal/NewEntryScreen.tsx`, `src/components/dev/DevToolsPanel.tsx` (count with `tr -cd '\r' < file | wc -c` before editing). These are LF: `src/db/schema.ts`, `src/db/outbox.ts`, `src/db/cache.ts`, `src/data/mappers.ts`, `src/data/mock/db.ts`, `src/services/syncEngine.ts`, `src/screens/journal/JournalFeedScreen.tsx`, `src/components/JournalCard.tsx`, `src/components/dev/processEntryCheck.ts`, `src/services/entryProcessor.ts`, `src/hooks/useJournalHome.ts`, `src/hooks/useReflection.ts`, `src/components/AffirmationCard.tsx`. The Edit tool matches single lines in a CRLF file but may fail on a multi-line block, so use a small Node script that matches the LF text and writes CRLF back, as steps 17 to 24 did: each file keeps its own endings and git shows only the real change. For a whole-file replacement keep the file's own endings too.

Anything not listed stays as it is: no layout, no token, no class and no other copy string changes. Dev-panel strings stay inline (AGENTS.md: dev-only UI is exempt from `copy.ts`). **Delete nothing else.**

### 2.1 `src/types/index.ts`

`OutboxItem` learns whether its recording is already uploaded (the SQLite migration is 2.4), and a comment says what happened to the submit.

a) Find:

```ts
  limitResetsAt: number | null; // epoch ms: when the week that holds it back ends
  createdAt: number; // epoch ms
};
```

Replace with:

```ts
  limitResetsAt: number | null; // epoch ms: when the week that holds it back ends
  createdAt: number; // epoch ms
  uploaded: boolean; // a recording is already in the journal_media bucket (step 25): it is not uploaded again
};
```

b) Find:

```ts
// New Entry (step 10). Step 23 swapped the mock recorder for the real one without changing these; step 25 swaps the mock submit.
```

Replace with:

```ts
// New Entry (step 10). Step 23 swapped the mock recorder for the real one without changing these; step 24 moved the submit to the
// sync engine, and step 25 gave the engine the real server.
```

### 2.2 `src/constants/app.ts`

The numbers of this step, in one place.

a) Find:

```ts
export const GRATITUDE_COUNTER_FROM = 900;
```

Replace with:

```ts
export const GRATITUDE_COUNTER_FROM = 900;

// Journal data (step 25). The Journal asks the server for ENTRIES_PAGE_SIZE entries at a time and keeps the newest
// ENTRY_CACHE_LIMIT on the phone (the read cache of step 24).
export const ENTRIES_PAGE_SIZE = 30;
export const ENTRY_CACHE_LIMIT = 200;
// An entry that the server still calls "processing" this long after it was last touched belongs to a request that died
// (the server's claim lapses after 3 minutes, step 19): the Journal does not list it, or it would be a card that never finishes.
export const STALE_PROCESSING_MS = 10 * 60_000;
// A reflection whose passage is not verified asks the server to read it again at most this often (confirm-scripture, step 20).
export const SCRIPTURE_RETRY_MS = 60_000;
// A reflection that a server is still preparing is read again this often, for at most REFLECTION_POLL_MAX_MS (step 25).
export const REFLECTION_POLL_MS = 5_000;
export const REFLECTION_POLL_MAX_MS = 120_000;
// How long a call to an Edge Function may take. process-entry stops itself at about 145 seconds (the platform stops a function at
// 150, step 22), and the sync engine's own ceiling (200 seconds, step 24) is above this one.
export const PROCESS_ENTRY_TIMEOUT_MS = 155_000;
export const CONFIRM_SCRIPTURE_TIMEOUT_MS = 15_000;
```

### 2.3 `src/constants/copy.ts`

Two new strings, the failed-reflection body (a failed server entry has no "Try again", finding 5), and the two `TODO(25)` markers go.

a) Find:

```ts
      unsave: "Remove from saved",
```

Replace with:

```ts
      unsave: "Remove from saved",
      // Shown under the card when saving the heart failed and the heart went back (step 25).
      saveError: "We couldn’t save that. Please try again.",
```

b) Find:

```ts
    loading: "Loading your reflections",
```

Replace with:

```ts
    loading: "Loading your reflections",
    // The small spinner under the last card while older reflections come.
    loadingMore: "Loading more reflections",
```

c) Find:

```ts
        // TODO(25): "waiting in your Journal" is true once processing continues after the screen closes
        body: "It will be waiting in your Journal when it’s ready.",
```

Replace with:

```ts
        body: "It will be waiting in your Journal when it’s ready.",
```

d) Find:

```ts
        // TODO(25): "try again from your journal" is true once a failed entry has a "Try again"
        body: "Your words are safe. You can try again from your journal.",
```

Replace with:

```ts
        // A failed entry is not listed in the real Journal, and the phone has no copy of its words to send again: the
        // person records or writes it again.
        body: "Your words are safe. Please record or write this reflection again.",
```

### 2.4 `src/db/schema.ts`

Migration 2 of the phone's own database. An existing install is at version 1: `migrate()` runs this one inside a transaction and keeps its rows and its key (a check proves it).

a) Find:

```ts
    "CREATE INDEX affirmations_cache_entry ON affirmations_cache (entry_id)",
  ],
];
```

Replace with:

```ts
    "CREATE INDEX affirmations_cache_entry ON affirmations_cache (entry_id)",
  ],
  // Version 2 (step 25): a recording that is already uploaded is not uploaded again when its reflection is sent again.
  ["ALTER TABLE outbox ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0"],
];
```

### 2.5 `src/db/outbox.ts`

a) Find:

```ts
  limit_resets_at: number | null;
  created_at: number;
};

const COLUMNS = `client_entry_id, input_type, text, duration_ms, mime_type, status, attempts, next_attempt_at,
  last_error_code, server_entry_id, limit_resets_at, created_at`;
```

Replace with:

```ts
  limit_resets_at: number | null;
  created_at: number;
  uploaded: number;
};

const COLUMNS = `client_entry_id, input_type, text, duration_ms, mime_type, status, attempts, next_attempt_at,
  last_error_code, server_entry_id, limit_resets_at, created_at, uploaded`;
```

b) Find:

```ts
    limitResetsAt: row.limit_resets_at,
    createdAt: row.created_at,
  };
}
```

Replace with:

```ts
    limitResetsAt: row.limit_resets_at,
    createdAt: row.created_at,
    uploaded: row.uploaded === 1,
  };
}
```

c) Find:

```ts
export async function markQueued(
```

Replace with:

```ts
// The recording of this item is in the bucket (step 25), so a later attempt goes straight to process-entry.
export async function markUploaded(clientEntryId: string): Promise<void> {
  await getDb().runAsync("UPDATE outbox SET uploaded = 1 WHERE client_entry_id = ?", clientEntryId);
}

export async function markQueued(
```

### 2.6 `src/db/cache.ts`

The week's count of devotionals reads the entries created since the start of the week.

a) Find:

```ts
// An entry and its affirmations leave the cache together.
```

Replace with:

```ts
// The entries created since `sinceIso` (compared as text with created_at, so a UTC time with a margin of a day or so is the
// right bound: the caller filters again on the dates), newest first. The week's count of devotionals reads them (step 25).
export async function listEntriesSince(sinceIso: string): Promise<JournalEntry[]> {
  const rows = await getDb().getAllAsync<EntryRow>(
    "SELECT id, row_json FROM entries_cache WHERE created_at >= ? ORDER BY created_at DESC, id DESC",
    sinceIso,
  );
  return readEntries(rows);
}

// An entry and its affirmations leave the cache together.
```

b) Find:

```ts
// Step 25 fills it from Supabase; until then nothing writes here, and it is tested on its own.
```

Replace with:

```ts
// Step 25 fills it: the pages of the Journal and the entries Reflection opens are written here (data/entriesLive.ts), and so is
// every reflection the sync engine has prepared.
```

### 2.7 `src/data/mappers.ts`

The mappers take the row types of the column lists, so a query that selects exactly those columns compiles, and a full table row still fits (it has more fields, which TypeScript allows).

a) Find:

```ts
import type { DailyAffirmationRow, JournalEntryRow, UserProfileRow } from "@/types/database";
```

Replace with:

```ts
import type { AffirmationRow, EntryRow } from "@/data/columns";
import type { UserProfileRow } from "@/types/database";
```

b) Find:

```ts
export function toAffirmation(row: DailyAffirmationRow): Affirmation {
```

Replace with:

```ts
export function toAffirmation(row: AffirmationRow): Affirmation {
```

c) Find:

```ts
function getStatus(row: JournalEntryRow): ProcessingStatus {
```

Replace with:

```ts
function getStatus(row: EntryRow): ProcessingStatus {
```

d) Find:

```ts
function isFinished(row: JournalEntryRow): boolean {
```

Replace with:

```ts
function isFinished(row: EntryRow): boolean {
```

e) Find:

```ts
function toScripture(row: JournalEntryRow): Scripture | null {
```

Replace with:

```ts
function toScripture(row: EntryRow): Scripture | null {
```

f) Find:

```ts
function toDevotional(row: JournalEntryRow): Devotional | null {
```

Replace with:

```ts
function toDevotional(row: EntryRow): Devotional | null {
```

g) Find:

```ts
export function toPrayer(row: JournalEntryRow): Prayer | null {
```

Replace with:

```ts
export function toPrayer(row: EntryRow): Prayer | null {
```

h) Find:

```ts
export function toJournalEntry(row: JournalEntryRow): JournalEntry {
```

Replace with:

```ts
export function toJournalEntry(row: EntryRow): JournalEntry {
```

### 2.8 `src/data/selectors.ts`

Three small pure functions: what the Journal lists, how pages merge, and which entry supplies the affirmations.

a) Find:

```ts
import { copy } from "@/constants/copy";
```

Replace with:

```ts
import { STALE_PROCESSING_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
```

b) Find:

```ts
// Whole local calendar days, never negative: a prayer started yesterday at 11 PM is 1 day old at 1 AM.
```

Replace with:

```ts
// Whether the Journal lists an entry that comes from the server (step 25): a finished one (a crisis entry included), or one that
// is still being prepared and was touched lately. A "processing" entry that nothing has touched for STALE_PROCESSING_MS belongs to
// a request that died, and would be a card that never finishes. A failed entry is not listed: the phone that made it shows it as a
// card of its own until it is prepared (step 24), and one that was refused or deleted is no reflection.
export function isListedEntry(entry: JournalEntry, nowMs: number): boolean {
  if (entry.status === "ready") return true;
  return entry.status === "processing" && nowMs - Date.parse(entry.updatedAt) < STALE_PROCESSING_MS;
}

// `incoming` joins `existing`, and newest first. An entry that is in both is the incoming one, which is the newer read.
export function mergeEntries(
  existing: readonly JournalEntry[],
  incoming: readonly JournalEntry[],
): JournalEntry[] {
  const byId = new Map<string, JournalEntry>();
  for (const entry of existing) byId.set(entry.id, entry);
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

// The newest finished entry that is not a crisis, from a list that is newest first: the one whose affirmations Journal Home shows.
export function getNewestReadyEntry(entries: readonly JournalEntry[]): JournalEntry | null {
  return entries.find((entry) => entry.status === "ready" && !entry.isCrisis) ?? null;
}

// Whole local calendar days, never negative: a prayer started yesterday at 11 PM is 1 day old at 1 AM.
```

### 2.9 `src/data/mock/scenario.ts`

`getProfileSource` becomes `getDataSource` and covers more; the page size.

a) Find:

```ts
import { supabaseEnv } from "@/constants/env";
import { useDevStore } from "@/store/devStore";

export type MockScenario = "default" | "empty" | "offline";

// Where the profile comes from (step 17). A release build always uses Supabase. In development the dev panel
// chooses, and a development build whose .env.local has no Supabase address falls back to the mock, so the app
// still runs before the Supabase project exists.
export type ProfileSource = "supabase" | "mock";

export function getProfileSource(): ProfileSource {
  if (!__DEV__) return "supabase";
  return supabaseEnv.status === "ok" ? useDevStore.getState().profileSource : "mock";
}
```

Replace with:

```ts
import { ENTRIES_PAGE_SIZE } from "@/constants/app";
import { supabaseEnv } from "@/constants/env";
import { useDevStore } from "@/store/devStore";

export type MockScenario = "default" | "empty" | "offline";

// Where the data comes from: the profile (step 17), and the entries, the affirmations and the processing of a reflection
// (step 25). A release build always uses Supabase. In development the dev panel chooses, and a development build whose
// .env.local has no Supabase address falls back to the mock, so the app still runs before the Supabase project exists. The
// mock is the step 06 data with its scenarios and the dev store's outcomes: it never reaches the server and never the cache.
export type DataSource = "supabase" | "mock";

export function getDataSource(): DataSource {
  if (!__DEV__) return "supabase";
  return supabaseEnv.status === "ok" ? useDevStore.getState().dataSource : "mock";
}

// How many entries one page of the Journal holds. The developer panel can make it small, so the second page can be reached
// with a few entries.
export function getEntriesPageSize(): number {
  return __DEV__ ? useDevStore.getState().pageSize : ENTRIES_PAGE_SIZE;
}
```

### 2.10 `src/data/mock/db.ts`

A comment only.

a) Find:

```ts
// TEMP(25): the server creates the entry. Here a finished (or crisis) fixture is cloned under a new id, so
// Journal and Reflection have something real to show after a submit. Like the server it is idempotent on
// client_entry_id: a retried submit never adds a second row.
```

Replace with:

```ts
// The mock data's stand-in for the server (data source "mock"): the server creates the entry. Here a finished (or crisis)
// fixture is cloned under a new id, so Journal and Reflection have something to show after a submit. Like the server it is
// idempotent on client_entry_id: a retried submit never adds a second row.
```

### 2.11 `src/store/devStore.ts`

`profileSource` becomes `dataSource`; the page size.

a) Find:

```ts
import type {
  MockPurchaseOutcome,
  MockScenario,
  MockSubmitOutcome,
  ProfileSource,
} from "@/data/mock/scenario";
```

Replace with:

```ts
import type {
  DataSource,
  MockPurchaseOutcome,
  MockScenario,
  MockSubmitOutcome,
} from "@/data/mock/scenario";
```

b) Find:

```ts
  // Where the profile comes from (step 17): the real Supabase row, or the step 06 mock with its plans and scenarios.
  // Read through getProfileSource(), which also falls back to the mock when .env.local has no Supabase address.
  profileSource: ProfileSource;
  setProfileSource: (source: ProfileSource) => void;
}
```

Replace with:

```ts
  // Where the data comes from (steps 17 and 25): the real Supabase (the profile, the entries, the affirmations and the
  // processing of a reflection), or the step 06 mock with its plans, scenarios and outcomes. Read through getDataSource(),
  // which also falls back to the mock when .env.local has no Supabase address.
  dataSource: DataSource;
  setDataSource: (source: DataSource) => void;
  // How many entries one page of the Journal holds (getEntriesPageSize), so the second page can be reached with a few entries.
  pageSize: number;
  setPageSize: (size: number) => void;
}
```

c) Find:

```ts
  profileSource: "supabase",
  setProfileSource: (profileSource) => set({ profileSource }),
}));
```

Replace with:

```ts
  dataSource: "supabase",
  setDataSource: (dataSource) => set({ dataSource }),
  pageSize: ENTRIES_PAGE_SIZE,
  setPageSize: (pageSize) => set({ pageSize }),
}));
```

d) Find:

```ts
import { create } from "zustand";
```

Replace with:

```ts
import { create } from "zustand";

import { ENTRIES_PAGE_SIZE } from "@/constants/app";
```

### 2.12 `src/services/profileSync.ts`

The rename.

a) Find:

```ts
import { getProfileSource } from "@/data/mock/scenario";
```

Replace with:

```ts
import { getDataSource } from "@/data/mock/scenario";
```

b) Find:

```ts
  if (getProfileSource() !== "supabase") return { ok: true, data: null };
```

Replace with:

```ts
  if (getDataSource() !== "supabase") return { ok: true, data: null };
```

### 2.13 `src/services/syncEngine.ts`

The engine asks the processor whether it is the mock, as a function.

a) Find:

```ts
import { processItem, processorIsMock } from "@/services/entryProcessor";
```

Replace with:

```ts
import { isProcessorMock, processItem } from "@/services/entryProcessor";
```

b) Find:

```ts
  if (!processorIsMock) {
```

Replace with:

```ts
  if (!isProcessorMock()) {
```

### 2.14 `src/components/SupabaseAuthBridge.tsx`

The plan watcher starts with the profile sync and stops at sign-out.

a) Find:

```tsx
import { setSupabaseSession } from "@/services/supabaseClient";
```

Replace with:

```tsx
import { setSupabaseSession } from "@/services/supabaseClient";
import { watchPlan } from "@/services/upgradeWatcher";
```

b) Find:

```tsx
    const stopWatchingReminders = watchReminderEdits();
```

Replace with:

```tsx
    const stopWatchingReminders = watchReminderEdits();
    // A plan that turns paid sends what the free limit held back (step 25).
    const stopWatchingPlan = watchPlan(signedInUserId);
```

c) Find:

```tsx
      stopWatchingReminders();
```

Replace with:

```tsx
      stopWatchingReminders();
      stopWatchingPlan();
```

### 2.15 `src/data/journalRepository.ts`

The real source, behind `getDataSource()`. Read the replaced blocks as a whole: `getUsage`, `listEntries`, the cached reads, `loadEntriesPage`, `getEntry`, `getLatestAffirmations` and `setAffirmationFavorite` each have a mock branch (the old code, unchanged) and a real one.

a) Find:

```ts
// TEMP(25/29): internals move to Supabase and the SQLite read cache (built in step 24, filled by step 25). Keep the names and argument order; those steps widen some return types to RepoResult. The profile is real since step 17.
```

Replace with:

```ts
// TEMP(29): the prayer writes are mocks until step 29 replaces them. The profile (step 17), and the entries, the affirmations and the usage (step 25), are real: they come from Supabase through the read cache of step 24, unless the data source is the mock (a development switch). Keep the names and argument order.
```

b) Find:

```ts
import { getDeviceTimezone, toAffirmation, toJournalEntry, toPrayer, toUserProfile } from "@/data/mappers";
import { addMockEntry, getMockDb } from "@/data/mock/db";
import {
  getProfileSource,
  takeMockNetworkFailure,
```

Replace with:

```ts
import * as live from "@/data/entriesLive";
import { getDeviceTimezone, toAffirmation, toJournalEntry, toPrayer, toUserProfile } from "@/data/mappers";
import { addMockEntry, getMockDb } from "@/data/mock/db";
import {
  getDataSource,
  getEntriesPageSize,
  takeMockNetworkFailure,
```

c) Find:

```ts
import { answeredDateToTimestamp, isValidAnsweredDate } from "@/utils/prayerDates";
```

Replace with:

```ts
import { answeredDateToTimestamp, isValidAnsweredDate } from "@/utils/prayerDates";
import { weekWindow } from "@/utils/week";
```

d) Find:

```ts
  if (getProfileSource() === "mock") {
    await simulateLatency();
    return readMockProfile();
  }
```

Replace with:

```ts
  if (getDataSource() === "mock") {
    await simulateLatency();
    return readMockProfile();
  }
```

e) Find:

```ts
export async function getUsage(): Promise<PlanUsage> {
  await simulateLatency();
  const { subscriptionTier: tier } = toUserProfile(getMockDb().profile);
  const resetsAt = nextWeekStart(new Date()).toISOString();
  // Fixed mock data (the Profile design's "2 of 3 audio devotionals used this week"), not counted
  // from the entries, which would give a different number on each weekday. Both paid tiers are unlimited.
  return tier === "free"
    ? { tier, used: 2, limit: FREE_DEVOTIONALS_PER_WEEK, resetsAt }
    : { tier, used: 0, limit: null, resetsAt };
}

// Newest first, every status included.
export async function listEntries(): Promise<JournalEntry[]> {
  await simulateLatency();
  return readEntries();
}

// A reflection that is still only on this phone has no server id: its id is its client entry id, and it is an entry
// that is not finished yet (Reflection shows "still being prepared"), never "not found" (step 24).
export async function getEntry(id: string): Promise<HomeEntry | null> {
  await simulateLatency();
  const found = readEntries().find((entry) => entry.id === id);
  if (found) return found;
  const item = await findPendingItem(id);
  return item === null ? null : toPendingEntry(item);
}
```

Replace with:

```ts
// What Profile and the Paywall show of the plan. The mock data says what the Profile design says ("2 of 3 audio devotionals
// used this week"). Otherwise the plan is the one this device knows (getKnownTier), and on the free plan the count is of the
// devotionals this phone has this week, in the time zone of the profile and with the week the server uses (utils/week.ts):
// it needs no network, so Profile opens offline. It is a number to show and nothing more. Only the server's 402 opens the
// Paywall, because only the server counts every device.
export async function getUsage(): Promise<PlanUsage> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    const { subscriptionTier: tier } = toUserProfile(getMockDb().profile);
    const resetsAt = nextWeekStart(new Date()).toISOString();
    // Fixed mock data, not counted from the entries, which would give a different number on each weekday. Both paid tiers are
    // unlimited.
    return tier === "free"
      ? { tier, used: 2, limit: FREE_DEVOTIONALS_PER_WEEK, resetsAt }
      : { tier, used: 0, limit: null, resetsAt };
  }
  const tier = getKnownTier() ?? "free";
  const zone = await getProfile().then(
    (profile) => profile.timezone,
    () => getDeviceTimezone(),
  );
  const week = weekWindow(new Date(), zone);
  const resetsAt = week.end.toISOString();
  if (tier !== "free") return { tier, used: 0, limit: null, resetsAt };
  // A person who was paying earlier in the week and lapsed can have made more than the limit: the card shows the limit.
  const made = await live.countDevotionalsSince(week.start);
  return { tier, used: Math.min(made, FREE_DEVOTIONALS_PER_WEEK), limit: FREE_DEVOTIONALS_PER_WEEK, resetsAt };
}

// What this phone has, newest first: Profile counts it and the developer panel reads it. The mock data: every entry, every
// status. The real source: the entries the Journal lists, from the read cache.
export async function listEntries(): Promise<JournalEntry[]> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    return readEntries();
  }
  return live.readCachedEntries();
}

// The first thing Journal Home and Reflection show is what the phone already has, so these read the read cache and nothing
// else (step 25). The mock data has no cache: they answer nothing, and the screens go straight to the mock reads below.
export async function readCachedEntries(): Promise<JournalEntry[]> {
  return getDataSource() === "mock" ? [] : live.readCachedEntries(getEntriesPageSize());
}

export async function readCachedEntry(id: string): Promise<JournalEntry | null> {
  return getDataSource() === "mock" ? null : live.readCachedEntry(id);
}

export async function readCachedAffirmations(entryId: string): Promise<Affirmation[]> {
  return getDataSource() === "mock" ? [] : live.readCachedAffirmations(entryId);
}

export async function readCachedLatestAffirmations(): Promise<Affirmation[]> {
  return getDataSource() === "mock" ? [] : live.readCachedLatestAffirmations();
}

// One page of the Journal (step 25): the entries it lists, newest first, the cursor of the next page (null when there is no
// older entry) and, for the first page, how many entries there are in all. A failed read is a RepoResult, so a screen keeps
// what it has. The real source writes what it read to the cache. The mock data is one page.
export async function loadEntriesPage(cursor: string | null): Promise<RepoResult<live.EntriesPage>> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    return { ok: true, data: { entries: readEntries(), nextCursor: null, total: null } };
  }
  return live.loadEntriesPage(cursor, getEntriesPageSize());
}

// A reflection that is still only on this phone has no server id: its id is its client entry id, and it is an entry
// that is not finished yet (Reflection shows "still being prepared"), never "not found" (step 24). Otherwise the real source
// asks the server (null when it has no such entry) and falls back to the cached copy when there is no answer; with neither,
// it throws, and the screen shows its error state.
export async function getEntry(id: string): Promise<HomeEntry | null> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    const found = readEntries().find((entry) => entry.id === id);
    if (found) return found;
    const waiting = await findPendingItem(id);
    return waiting === null ? null : toPendingEntry(waiting);
  }
  const waiting = await findPendingItem(id);
  if (waiting !== null) return toPendingEntry(waiting);
  return live.fetchEntry(id);
}
```

f) Find:

```ts
  if (mock !== "free" || getProfileSource() === "mock") return mock;
```

Replace with:

```ts
  if (mock !== "free" || getDataSource() === "mock") return mock;
```

g) Find:

```ts
  const isMock = getProfileSource() === "mock";
```

Replace with:

```ts
  const isMock = getDataSource() === "mock";
```

h) Find:

```ts
// Ordered morning, afternoon, evening.
export async function listAffirmationsForEntry(entryId: string): Promise<Affirmation[]> {
  await simulateLatency();
  return readAffirmations(entryId);
}

// From the newest ready, non-crisis entry.
export async function getLatestAffirmations(): Promise<Affirmation[]> {
  await simulateLatency();
  const latest = readEntries().find((entry) => entry.status === "ready" && !entry.isCrisis);
  return latest ? readAffirmations(latest.id) : [];
}
```

Replace with:

```ts
// Ordered morning, afternoon, evening. The real source asks the server and falls back to the cached copy; with neither it throws.
// A reflection that is only in this phone's outbox has no affirmations yet and no row on the server, so nobody is asked.
export async function listAffirmationsForEntry(entryId: string): Promise<Affirmation[]> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    return readAffirmations(entryId);
  }
  if ((await findPendingItem(entryId)) !== null) return [];
  return live.fetchAffirmations(entryId);
}

// From the newest ready, non-crisis entry. The real source never throws: with no answer it is the cached copy (fetchAffirmations
// falls back to it), or nothing when there is none, and Journal Home then shows no affirmation card.
export async function getLatestAffirmations(): Promise<Affirmation[]> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    const latest = readEntries().find((entry) => entry.status === "ready" && !entry.isCrisis);
    return latest ? readAffirmations(latest.id) : [];
  }
  try {
    return await live.fetchLatestAffirmations();
  } catch {
    return [];
  }
}

// Saves the heart on an affirmation: the one column of daily_affirmations the app may write (step 18). The mock data changes
// the mock row, and fails when the developer panel's "Fail next save" is armed, like the other mock writes.
export async function setAffirmationFavorite(id: string, value: boolean): Promise<RepoResult<Affirmation>> {
  if (getDataSource() !== "mock") return live.saveFavorite(id, value);
  await simulateLatency();
  if (takeMockPrayerMutationFailure()) return failure("NETWORK", copy.journal.affirmation.saveError);
  const row = getMockDb().affirmations.find((candidate) => candidate.id === id);
  if (row === undefined) return failure("NOT_FOUND", copy.journal.affirmation.saveError);
  row.is_favorite = value;
  return { ok: true, data: toAffirmation(row) };
}
```

i) Find:

```ts
// TEMP(25): the real processor uploads the recording and calls process-entry (services/entryProcessor.ts)
// A mock run for the sync engine: it reports each stage 1.2 s apart, then answers with what the dev store asked for (one
// shot, see takeMockSubmitOutcome), or with no answer at all when the dev panel failed the network. A finished or crisis
// outcome adds an entry to the mock database and answers with it, as the server does.
```

Replace with:

```ts
// A mock run for the sync engine, used while the data source is the mock (services/entryProcessor.ts): it reports each
// stage 1.2 s apart, then answers with what the dev store asked for (one shot, see takeMockSubmitOutcome), or with no answer at
// all when the dev panel failed the network. A finished or crisis outcome adds an entry to the mock database and answers with
// it, as the server does.
```

j) Find:

```ts
      // TODO(25): the 402 body carries the entry the server saved (entryId) and usage.resetsAt
      return { ok: false, code: "LIMIT_REACHED", resetsAt: nextWeekStart(new Date()).toISOString() };
```

Replace with:

```ts
      // The real 402 also names the entry the server saved; the mock data has no server entry.
      return { ok: false, code: "LIMIT_REACHED", resetsAt: nextWeekStart(new Date()).toISOString() };
```

### 2.16 `src/screens/journal/JournalFeedScreen.tsx`

A spinner under the last card, the next page on scroll, the whole count, and the heart wired to the hook.

a) Find:

```tsx
import {
  FlatList,
  Pressable,
  RefreshControl,
```

Replace with:

```tsx
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
```

b) Find:

```tsx
function ItemSeparator() {
  return <View className="h-3.5" />;
}
```

Replace with:

```tsx
function ItemSeparator() {
  return <View className="h-3.5" />;
}

// The small spinner under the last card while the next page of older entries comes (step 25).
function LoadingMore() {
  return (
    <View
      accessible
      accessibilityLabel={copy.journal.loadingMore}
      accessibilityState={{ busy: true }}
      className="items-center py-5"
    >
      <ActivityIndicator size="small" color={colors.plum} />
    </View>
  );
}
```

c) Find:

```tsx
          affirmation={affirmation}
          footer={copy.journal.affirmation.footer(
            formatTime12(ready.profile.reminders[affirmation.slot]),
            source ? getAffirmationSource(source.createdAt, ready.now) : null,
          )}
        />
```

Replace with:

```tsx
          affirmation={affirmation}
          footer={copy.journal.affirmation.footer(
            formatTime12(ready.profile.reminders[affirmation.slot]),
            source ? getAffirmationSource(source.createdAt, ready.now) : null,
          )}
          onToggleFavorite={() => ready.toggleFavorite(affirmation)}
          saveFailed={ready.favoriteFailed}
        />
```

d) Find:

```tsx
        <SectionRow
          count={visibleEntries.length}
```

Replace with:

```tsx
        <SectionRow
          count={filter === "all" ? ready.entryCount : visibleEntries.length}
```

e) Find:

```tsx
        ListEmptyComponent={emptyState ?? undefined}
```

Replace with:

```tsx
        ListEmptyComponent={emptyState ?? undefined}
        ListFooterComponent={ready?.loadingMore ? <LoadingMore /> : undefined}
        onEndReached={ready ? ready.loadMore : undefined}
        onEndReachedThreshold={0.5}
```

### 2.17 `src/components/JournalCard.tsx`

A comment and a marker.

a) Find:

```tsx
      // An entry the server marked failed, which has no copy of its words on this phone to send again. (A refused
      // reflection that is still on this phone has `pending`, and the Review button in PendingFooter.)
```

Replace with:

```tsx
      // An entry the server marked failed, which has no copy of its words on this phone to send again. Only the mock data
      // lists one: the real Journal does not list failed entries (step 25), and a refused or retrying reflection that is
      // still on this phone has `pending`, with the Review button in PendingFooter.
```

b) Find:

```tsx
          {/* TODO(25): retry a failed entry from the server copy of its words */}
          <Pressable
```

Replace with:

```tsx
          <Pressable
```

### 2.18 `src/screens/journal/ReflectionStateViews.tsx`

A comment and a marker.

a) Find:

```tsx
// Pending, uploading and processing entries. Nothing polls yet (step 25).
```

Replace with:

```tsx
// Pending, uploading and processing entries. Reflection reads an entry that a server is preparing again every few seconds
// while it is in front (useReflection, step 25), so this view turns into the reflection by itself.
```

b) Find:

```tsx
      {/* TODO(25): "Try again" on this view */}
      <PrimaryButton label={footer.returnToJournal} onPress={onReturn} />
```

Replace with:

```tsx
      <PrimaryButton label={footer.returnToJournal} onPress={onReturn} />
```

### 2.19 `src/screens/journal/NewEntryScreen.tsx`

A comment.

a) Find:

```tsx
        // The reflection is saved (here, and on the server once step 25 sends it): the Paywall says so.
```

Replace with:

```tsx
        // The reflection is saved (on this phone, and on the server: the 402 names the entry it saved): the Paywall says so.
```

### 2.20 `src/components/dev/DevToolsPanel.tsx`

"Profile source" becomes "Data source", a page-size row, and two more lines in the Supabase check.

a) Find:

```tsx
import {
  getLatestAffirmations,
  getProfile,
  getUsage,
  listEntries,
  listPrayers,
  setMockSubscriptionTier,
} from "@/data/journalRepository";
```

Replace with:

```tsx
import { getLastFunctionCall, type FunctionCall } from "@/api/journalApi";
import { ENTRIES_PAGE_SIZE } from "@/constants/app";
import {
  getLatestAffirmations,
  getProfile,
  getUsage,
  listEntries,
  listPrayers,
  setMockSubscriptionTier,
} from "@/data/journalRepository";
```

b) Find:

```tsx
import {
  countVisibleProfileRows,
  getLastProfileError,
  selectProfileRow,
} from "@/data/profileRemote";
import type {
  MockPurchaseOutcome,
  MockScenario,
  MockSubmitOutcome,
  ProfileSource,
} from "@/data/mock/scenario";
```

Replace with:

```tsx
import { getLastEntriesError } from "@/data/entriesRemote";
import {
  countVisibleProfileRows,
  getLastProfileError,
  selectProfileRow,
} from "@/data/profileRemote";
import type {
  DataSource,
  MockPurchaseOutcome,
  MockScenario,
  MockSubmitOutcome,
} from "@/data/mock/scenario";
```

c) Find:

```tsx
const PROFILE_SOURCES: ProfileSource[] = ["supabase", "mock"];
```

Replace with:

```tsx
const DATA_SOURCES: DataSource[] = ["supabase", "mock"];
// The Journal's page size: the real one, and a small one that reaches the second page with a few entries.
const PAGE_SIZES: number[] = [ENTRIES_PAGE_SIZE, 5];
```

d) Find:

```tsx
// What the Supabase check shows on screen: yes or no and a code, never an id, a token or a row.
async function runSupabaseCheck(source: ProfileSource): Promise<string[]> {
  const signedIn = getSupabaseUserId() !== null;
  const lines = [
    `Supabase keys in .env.local: ${supabaseEnv.status === "ok" ? "yes" : "no"}`,
    `profile source: ${source}`,
```

Replace with:

```tsx
// The last Edge Function call as one line: its name, what came back and how long it took. No body, no id.
function describeFunctionCall(call: FunctionCall | null): string {
  if (call === null) return "none";
  const answer = call.status === 0 ? "no answer" : String(call.status);
  return `${call.name} ${answer}${call.code === null ? "" : ` ${call.code}`}, ${Math.round(call.ms / 100) / 10} s`;
}

// What the Supabase check shows on screen: yes or no and a code, never an id, a token or a row.
async function runSupabaseCheck(source: DataSource): Promise<string[]> {
  const signedIn = getSupabaseUserId() !== null;
  const lines = [
    `Supabase keys in .env.local: ${supabaseEnv.status === "ok" ? "yes" : "no"}`,
    `data source: ${source}`,
```

e) Find:

```tsx
  lines.push(`last error: ${getLastProfileError() ?? "none"}`);
  return lines;
```

Replace with:

```tsx
  lines.push(`last error: ${getLastProfileError() ?? "none"}`);
  lines.push(`last entries error: ${getLastEntriesError() ?? "none"}`);
  lines.push(`last function call: ${describeFunctionCall(getLastFunctionCall())}`);
  return lines;
```

f) Find:

```tsx
  const chosenProfileSource = useDevStore((state) => state.profileSource);
  const setProfileSource = useDevStore((state) => state.setProfileSource);
  // Without a Supabase address in .env.local the mock is what the app really uses (getProfileSource).
  const profileSource: ProfileSource = supabaseEnv.status === "ok" ? chosenProfileSource : "mock";
```

Replace with:

```tsx
  const chosenDataSource = useDevStore((state) => state.dataSource);
  const setDataSource = useDevStore((state) => state.setDataSource);
  const pageSize = useDevStore((state) => state.pageSize);
  const setPageSize = useDevStore((state) => state.setPageSize);
  // Without a Supabase address in .env.local the mock is what the app really uses (getDataSource).
  const dataSource: DataSource = supabaseEnv.status === "ok" ? chosenDataSource : "mock";
```

g) Find:

```tsx
  // Profile and this panel reload through the mock profile version, as for a mock plan change.
  function changeProfileSource(next: ProfileSource) {
    setProfileSource(next);
    setSupabaseLines([]);
    bumpMockProfileVersion();
  }
```

Replace with:

```tsx
  // Profile and this panel reload through the mock profile version, as for a mock plan change. Journal Home follows the
  // data source itself.
  function changeDataSource(next: DataSource) {
    setDataSource(next);
    setSupabaseLines([]);
    bumpMockProfileVersion();
  }
```

h) Find:

```tsx
    setSupabaseLines(await runSupabaseCheck(profileSource));
```

Replace with:

```tsx
    setSupabaseLines(await runSupabaseCheck(dataSource));
```

i) Find:

```tsx
          <Text className="text-center text-body-sm text-mauve">Profile source (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {PROFILE_SOURCES.map((name) => (
              <DevButton
                key={name}
                label={name}
                accessibilityLabel={`Profile source ${name} (dev)`}
                selected={name === profileSource}
                onPress={() => changeProfileSource(name)}
              />
            ))}
          </View>
          {supabaseEnv.status !== "ok" ? (
            <Text className="text-center text-body-sm text-mauve">
              No Supabase address in .env.local, so the profile uses the mock.
            </Text>
          ) : null}
```

Replace with:

```tsx
          <Text className="text-center text-body-sm text-mauve">Data source (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {DATA_SOURCES.map((name) => (
              <DevButton
                key={name}
                label={name}
                accessibilityLabel={`Data source ${name} (dev)`}
                selected={name === dataSource}
                onPress={() => changeDataSource(name)}
              />
            ))}
          </View>
          <Text className="text-center text-body-sm text-mauve">
            supabase: the real profile, entries and processing. mock: the step 06 data and the outcomes above.
          </Text>
          {supabaseEnv.status !== "ok" ? (
            <Text className="text-center text-body-sm text-mauve">
              No Supabase address in .env.local, so the app uses the mock.
            </Text>
          ) : null}
          <Text className="text-center text-body-sm text-mauve">Page size (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {PAGE_SIZES.map((size) => (
              <DevButton
                key={size}
                label={String(size)}
                accessibilityLabel={`Page size ${size} (dev)`}
                selected={size === pageSize}
                onPress={() => setPageSize(size)}
              />
            ))}
          </View>
```

### 2.21 `src/components/dev/processEntryCheck.ts`

A comment.

a) Find:

```ts
// process-entry and confirm-scripture functions from this phone, through supabase.functions.invoke (the path step 25
// will use), with made-up text,
```

Replace with:

```ts
// process-entry and confirm-scripture functions from this phone, through supabase.functions.invoke (the path the app itself
// uses since step 25), with made-up text,
```

### 2.22 `src/services/entryProcessor.ts` (whole file)

Replace the whole file. The mock stays in the repository as `processMock`; this file sends the real thing.

```ts
import { processEntry, readLimitBody, type FunctionResult } from "@/api/journalApi";
import { processMock } from "@/data/journalRepository";
import { getDataSource } from "@/data/mock/scenario";
import * as outbox from "@/db/outbox";
import { rawRecordingPath, uploadRawRecording, type UploadFailureCode } from "@/services/mediaUpload";
import { recordingUri } from "@/services/recordingFiles";
import { getSupabaseUserId } from "@/services/supabaseClient";
import type {
  JournalEntry,
  OutboxItem,
  ProcessEntryErrorCode,
  ProcessEntryRequest,
  ProcessEntryResponse,
  ProcessingStage,
  ProcessOutcome,
} from "@/types";
import { normalizeTimestamp } from "@/utils/timestamp";

// The one place the sync engine hands an outbox item to be prepared (step 24; the real server since step 25). It answers with
// the finished entry, or with why not (a ProcessEntryErrorCode, or NETWORK when no answer came). It never throws and it reports
// its progress through `onStage`, which the New Entry overlay shows.
//
// A written reflection is sent as it is. A recording is uploaded first to {userId}/raw/{clientEntryId}.m4a in the private
// journal_media bucket (once: the outbox item remembers it), and then process-entry is asked to prepare it. The server keeps the
// reflection under the client entry id, so sending the same item again after a lost answer finds it finished or in progress
// and never makes a second one. The user id comes from the signed-in session and never travels in the body.
//
// While the data source is the mock (a development switch), the mock answers instead, and the engine does not write what it
// answers to the read cache: the mock's entries live in the in-memory mock database, and a persisted copy of them would outlive it.
export function isProcessorMock(): boolean {
  return getDataSource() === "mock";
}

const UPLOAD_CODES: Record<UploadFailureCode, ProcessEntryErrorCode | "NETWORK" | "UNKNOWN"> = {
  NETWORK: "NETWORK",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "AUDIO_NOT_FOUND",
  TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNKNOWN: "UNKNOWN",
};

const PROCESS_CODES: readonly ProcessEntryErrorCode[] = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "LIMIT_REACHED",
  "METHOD_NOT_ALLOWED",
  "ALREADY_PROCESSING",
  "PAYLOAD_TOO_LARGE",
  "TOO_SHORT",
  "AUDIO_NOT_FOUND",
  "NO_SPEECH",
  "RATE_LIMITED",
  "INTERNAL",
  "AI_UNAVAILABLE",
];

function toProcessCode(code: string): ProcessEntryErrorCode | "NETWORK" | "UNKNOWN" {
  if (code === "NETWORK") return "NETWORK";
  return PROCESS_CODES.find((candidate) => candidate === code) ?? "UNKNOWN";
}

// The function reports nothing while it works, so the overlay's steps follow the time a reflection usually takes (the hosted
// runs: a few seconds to read and screen it, then the reflection, then the passage and the spoken devotional). It is a
// progress indication and nothing more: the answer decides what happens.
const STAGE_TIMELINE: readonly (readonly [number, ProcessingStage])[] = [
  [4_000, "reflecting"],
  [12_000, "preparing"],
];

function followStages(onStage: (stage: ProcessingStage) => void): () => void {
  const timers = STAGE_TIMELINE.map(([after, stage]) => setTimeout(() => onStage(stage), after));
  return () => timers.forEach((timer) => clearTimeout(timer));
}

// The times of the entry the function answered with, in the form the app keeps them (utils/timestamp.ts), so a reflection that has
// just been prepared looks the same as the one read back from the server.
function withCanonicalTimes(entry: JournalEntry): JournalEntry {
  const { prayer } = entry;
  return {
    ...entry,
    createdAt: normalizeTimestamp(entry.createdAt),
    updatedAt: normalizeTimestamp(entry.updatedAt),
    prayer:
      prayer === null
        ? null
        : {
            ...prayer,
            createdAt: normalizeTimestamp(prayer.createdAt),
            answeredAt: prayer.answeredAt === null ? null : normalizeTimestamp(prayer.answeredAt),
          },
  };
}

function toOutcome(result: FunctionResult<ProcessEntryResponse>): ProcessOutcome {
  if (result.ok) return { ok: true, entry: withCanonicalTimes(result.data.entry), affirmations: result.data.affirmations };
  const code = toProcessCode(result.code);
  if (code === "LIMIT_REACHED") {
    // The 402 says which entry the server saved and when the week resets.
    const limit = readLimitBody(result.body);
    return limit === null ? { ok: false, code } : { ok: false, code, entryId: limit.entryId, resetsAt: limit.resetsAt };
  }
  return { ok: false, code };
}

async function rememberUpload(clientEntryId: string): Promise<void> {
  try {
    await outbox.markUploaded(clientEntryId);
  } catch {
    // The database closed (sign-out) or could not be written: the next attempt uploads again, and the server says "already there".
  }
}

async function processReal(
  item: OutboxItem,
  onStage: (stage: ProcessingStage) => void,
): Promise<ProcessOutcome> {
  const userId = getSupabaseUserId();
  if (userId === null) return { ok: false, code: "UNAUTHORIZED" };
  onStage("receiving");
  let request: ProcessEntryRequest;
  if (item.inputType === "text") {
    if (item.text === null) return { ok: false, code: "INVALID_REQUEST" };
    request = { clientEntryId: item.clientEntryId, inputType: "text", text: item.text };
  } else {
    if (item.durationMs === null || item.mimeType === null) return { ok: false, code: "INVALID_REQUEST" };
    if (!item.uploaded) {
      const sent = await uploadRawRecording({ clientEntryId: item.clientEntryId, uri: recordingUri(item.clientEntryId) }, userId);
      if (!sent.ok) return { ok: false, code: UPLOAD_CODES[sent.code] };
      await rememberUpload(item.clientEntryId);
    }
    request = {
      clientEntryId: item.clientEntryId,
      inputType: "audio",
      audioPath: rawRecordingPath(userId, item.clientEntryId),
      durationMs: item.durationMs,
      mimeType: item.mimeType,
    };
  }
  const stopFollowing = followStages(onStage);
  try {
    return toOutcome(await processEntry(request));
  } finally {
    stopFollowing();
  }
}

export function processItem(
  item: OutboxItem,
  onStage: (stage: ProcessingStage) => void,
): Promise<ProcessOutcome> {
  return isProcessorMock() ? processMock(item, onStage) : processReal(item, onStage);
}
```

### 2.23 `src/hooks/useJournalHome.ts` (whole file)

Replace the whole file.

```ts
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  getLatestAffirmations,
  getProfile,
  listPendingItems,
  loadEntriesPage,
  readCachedEntries,
  readCachedLatestAffirmations,
  setAffirmationFavorite,
} from "@/data/journalRepository";
import { mergePending, toPendingEntry } from "@/data/pendingEntries";
import { getCurrentSlot, getReflectionDays, mergeEntries } from "@/data/selectors";
import { startOfflineSession } from "@/services/offlineSession";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { subscribe } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import { selectIsOnline, useOfflineStore, type SavedNote } from "@/store/offlineStore";
import type {
  Affirmation,
  HomeEntry,
  JournalEntry,
  OutboxItem,
  TimeSlot,
  UserProfile,
} from "@/types";

export type HomeState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      now: Date;
      profile: UserProfile;
      // The reflections saved on this phone and not prepared yet come first (step 24), then the server's.
      entries: HomeEntry[];
      // How many entries the Journal has in all, the ones not loaded yet included.
      entryCount: number;
      affirmations: Affirmation[];
      reflectionDays: number;
      currentSlot: TimeSlot;
      isOffline: boolean;
      // false while NetInfo has not answered yet (no banner), true or false after.
      isOnline: boolean | null;
      // The calm line New Entry leaves behind when it saved something that has not been prepared yet.
      savedNote: SavedNote | null;
      dismissNote: () => void;
      refresh: () => Promise<void>;
      refreshing: boolean;
      // The next page of older entries (step 25). Does nothing while one is coming or when there is no older entry.
      loadMore: () => void;
      loadingMore: boolean;
      // Saves the heart on an affirmation: it shows at once and goes back, with `favoriteFailed`, when the save fails.
      toggleFavorite: (affirmation: Affirmation) => void;
      favoriteFailed: boolean;
    };

// What a load produced, with the key it was for (the mock scenario and the data source): data loaded for another key is
// not shown.
type LoadResult =
  | {
      key: string;
      status: "ready";
      profile: UserProfile;
      // The entries loaded so far, newest first: the first page, and the older pages the person scrolled to.
      entries: JournalEntry[];
      nextCursor: string | null;
      total: number | null;
      affirmations: Affirmation[];
    }
  | { key: string; status: "error" };

function withFavorite(result: LoadResult | null, key: string, id: string, value: boolean): LoadResult | null {
  if (result?.status !== "ready" || result.key !== key) return result;
  return {
    ...result,
    affirmations: result.affirmations.map((item) => (item.id === id ? { ...item, isFavorite: value } : item)),
  };
}

// Journal Home data. It loads when the screen takes focus (the first time too), when the app returns to the foreground while
// the screen is focused, when the data source or the scenario changes, and on pull-to-refresh. It waits for the signed-in user's
// database (the reflections saved on this phone, and the cache of the ones the server has, live in it). A load shows what the
// phone already has at once, then replaces it with the first page from the server; older pages come with `loadMore`. While the
// screen is in front it follows the sync engine: the list of unsent reflections refreshes after every change, and the whole
// list after a reflection has been prepared.
export function useJournalHome(): HomeState {
  const scenario = useDevStore((state) => state.scenario);
  const dbReady = useOfflineStore((state) => state.dbReady);
  const dbFailed = useOfflineStore((state) => state.dbFailed);
  const online = useOfflineStore(selectIsOnline);
  const savedNote = useOfflineStore((state) => state.savedNote);
  const dataSource = useDevStore((state) => state.dataSource);
  const key = `${scenario}:${dataSource}`;
  const [now, setNow] = useState(() => new Date());
  const [result, setResult] = useState<LoadResult | null>(null);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [favoriteFailed, setFavoriteFailed] = useState(false);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);
  const latestPending = useRef(0);
  // How many older pages the person has loaded since the last reset: while there are some, a refresh keeps them.
  const pagesLoaded = useRef(0);
  const loadingMoreNow = useRef(false);
  const savingFavorite = useRef(false);

  const refreshPending = useCallback(async () => {
    latestPending.current += 1;
    const request = latestPending.current;
    const items = await listPendingItems();
    if (request === latestPending.current) setPending(items);
  }, []);

  const load = useCallback(
    async (options: { reset?: boolean } = {}) => {
      if (!dbReady) return;
      latestRequest.current += 1;
      const request = latestRequest.current;
      latestPending.current += 1;
      const pendingRequest = latestPending.current;
      if (options.reset === true) pagesLoaded.current = 0;
      setNow(new Date());
      try {
        const dev = useDevStore.getState();
        if (dev.nextHomeLoadFails) {
          dev.setNextHomeLoadFails(false);
          throw new Error("Journal load failed on purpose (dev)");
        }
        // What the phone already has: shown at once, before the network is asked.
        const [profile, cached, cachedAffirmations, items] = await Promise.all([
          getProfile(),
          readCachedEntries(),
          readCachedLatestAffirmations(),
          listPendingItems(),
        ]);
        if (request !== latestRequest.current) return;
        if (pendingRequest === latestPending.current) setPending(items);
        if (cached.length > 0 && pagesLoaded.current === 0) {
          setResult((previous) =>
            previous?.status === "ready" && previous.key === key
              ? previous
              : {
                  key,
                  status: "ready",
                  profile,
                  entries: cached,
                  nextCursor: null,
                  total: null,
                  affirmations: cachedAffirmations,
                },
          );
        }
        // The first page from the server. Without an answer, what is on screen stays (or the error shows when nothing is).
        const page = await loadEntriesPage(null);
        if (request !== latestRequest.current) return;
        if (!page.ok) throw new Error(page.code);
        const affirmations = await getLatestAffirmations();
        if (request !== latestRequest.current) return;
        const paged = pagesLoaded.current > 0;
        setResult((previous) => {
          const same = previous?.status === "ready" && previous.key === key ? previous : null;
          return {
            key,
            status: "ready",
            profile,
            affirmations,
            // Older pages that are already on screen stay, and their cursor with them.
            entries: paged && same !== null ? mergeEntries(same.entries, page.data.entries) : page.data.entries,
            nextCursor: paged && same !== null ? same.nextCursor : page.data.nextCursor,
            total: page.data.total,
          };
        });
      } catch {
        if (request !== latestRequest.current) return;
        // A failed refresh keeps the data that is already on screen.
        setResult((previous) =>
          previous?.status === "ready" && previous.key === key ? previous : { key, status: "error" },
        );
      }
    },
    [key, dbReady],
  );

  // The callback changes with the key and with the database, so useFocusEffect reloads then if the screen is focused, and
  // otherwise on the next focus. Leaving the screen drops a response that is still on its way.
  useFocusEffect(
    useCallback(() => {
      load();
      const subscription = AppState.addEventListener("change", (status) => {
        if (status === "active") load();
      });
      const stopFollowing = subscribe((event) => {
        if (event.type === "finished") {
          // What New Entry left behind is no longer true once the reflection is ready.
          useOfflineStore.getState().setSavedNote(null);
          load();
        } else if (event.type === "changed") {
          refreshPending();
        }
      });
      return () => {
        subscription.remove();
        stopFollowing();
        latestRequest.current += 1;
      };
    }, [load, refreshPending]),
  );

  const retry = useCallback(() => {
    setResult(null);
    if (dbFailed) {
      // The database could not be opened: open it again, and the load follows once it is ready.
      const userId = getSupabaseUserId();
      if (userId !== null) void startOfflineSession(userId);
      return;
    }
    load({ reset: true });
  }, [load, dbFailed]);

  // Pull-to-refresh starts again from the first page.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    useOfflineStore.getState().setSavedNote(null);
    await load({ reset: true });
    setRefreshing(false);
  }, [load]);

  const dismissNote = useCallback(() => useOfflineStore.getState().setSavedNote(null), []);

  const current = dbReady && result?.key === key ? result : null;
  const nextCursor = current?.status === "ready" ? current.nextCursor : null;

  const loadMore = useCallback(async () => {
    if (nextCursor === null || loadingMoreNow.current) return;
    loadingMoreNow.current = true;
    setLoadingMore(true);
    const request = latestRequest.current;
    try {
      const page = await loadEntriesPage(nextCursor);
      // A load that started meanwhile has the newer say, and a page that did not come is asked for again on the next scroll.
      if (request !== latestRequest.current || !page.ok) return;
      pagesLoaded.current += 1;
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key
          ? { ...previous, entries: mergeEntries(previous.entries, page.data.entries), nextCursor: page.data.nextCursor }
          : previous,
      );
    } finally {
      loadingMoreNow.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, key]);

  const toggleFavorite = useCallback(
    async (affirmation: Affirmation) => {
      if (savingFavorite.current) return;
      savingFavorite.current = true;
      const next = !affirmation.isFavorite;
      setFavoriteFailed(false);
      setResult((previous) => withFavorite(previous, key, affirmation.id, next));
      try {
        const saved = await setAffirmationFavorite(affirmation.id, next);
        if (!saved.ok) {
          setResult((previous) => withFavorite(previous, key, affirmation.id, !next));
          setFavoriteFailed(true);
        }
      } finally {
        savingFavorite.current = false;
      }
    },
    [key],
  );

  if (dbFailed) {
    return { status: "error", retry };
  }
  if (current === null) {
    return { status: "loading" };
  }
  if (current.status === "error") {
    return { status: "error", retry };
  }
  const entries = mergePending(current.entries, pending.map(toPendingEntry));
  // The entries the server has that are not on screen yet, on top of the ones that are.
  const notLoaded = Math.max(0, (current.total ?? current.entries.length) - current.entries.length);
  return {
    status: "ready",
    now,
    profile: current.profile,
    entries,
    entryCount: entries.length + notLoaded,
    affirmations: current.affirmations,
    // TODO(33): the streak counts the entries loaded so far; a server-side count replaces it.
    reflectionDays: getReflectionDays(entries, now),
    currentSlot: getCurrentSlot(now, current.profile.reminders),
    // The dev scenario still forces the offline look in development.
    isOffline: scenario === "offline" || online === false,
    isOnline: online,
    savedNote,
    dismissNote,
    refresh,
    refreshing,
    loadMore,
    loadingMore,
    toggleFavorite,
    favoriteFailed,
  };
}
```

### 2.24 `src/hooks/useReflection.ts` (whole file)

Replace the whole file.

```ts
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";

import { REFLECTION_POLL_MAX_MS, REFLECTION_POLL_MS } from "@/constants/app";
import {
  getEntry,
  getProfile,
  listAffirmationsForEntry,
  readCachedAffirmations,
  readCachedEntry,
} from "@/data/journalRepository";
import { getCurrentSlot } from "@/data/selectors";
import { confirmScriptureIfNeeded } from "@/services/scriptureConfirm";
import { useDevStore } from "@/store/devStore";
import type { Affirmation, JournalEntry, TimeSlot, UserProfile } from "@/types";

export type ReflectionState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      entry: JournalEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
      currentSlot: TimeSlot;
    };

// What a load produced, with the entry it was for: another entry's data is never shown.
type LoadResult =
  | {
      entryId: string;
      status: "ready";
      now: Date;
      entry: JournalEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
    }
  | { entryId: string; status: "not-found" }
  | { entryId: string; status: "error" };

// Reflection data for one entry. It loads when the screen takes focus (the first time too) and when the entry changes, and:
// - it shows what the phone already has at once (the read cache), and then what the server says;
// - an entry that a server is still preparing (another phone made it, or this phone stopped waiting for it) is read again
//   every REFLECTION_POLL_MS while the screen is in front, for up to REFLECTION_POLL_MAX_MS (TODO(33): realtime instead);
// - a passage that was kept as a reference only is asked for again (confirm-scripture), and the screen shows the answer.
// A failed reload keeps the data that is already on screen.
export function useReflection(entryId: string): ReflectionState {
  const [result, setResult] = useState<LoadResult | null>(null);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);
  // True while the entry on screen is being prepared by a server: the interval below then reads it again.
  const preparing = useRef(false);

  const load = useCallback(async () => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    try {
      const dev = useDevStore.getState();
      if (dev.nextReflectionLoadFails) {
        dev.setNextReflectionLoadFails(false);
        throw new Error("Reflection load failed on purpose (dev)");
      }
      // What the phone already has.
      const [profile, cachedEntry, cachedAffirmations] = await Promise.all([
        getProfile(),
        readCachedEntry(entryId),
        readCachedAffirmations(entryId),
      ]);
      if (request !== latestRequest.current) return;
      if (cachedEntry !== null) {
        setResult((previous) =>
          previous?.entryId === entryId && previous.status === "ready"
            ? previous
            : { entryId, status: "ready", now: new Date(), entry: cachedEntry, affirmations: cachedAffirmations, profile },
        );
      }
      // What the server says.
      const [entry, affirmations] = await Promise.all([getEntry(entryId), listAffirmationsForEntry(entryId)]);
      if (request !== latestRequest.current) return;
      if (entry === null) {
        preparing.current = false;
        setResult({ entryId, status: "not-found" });
        return;
      }
      // An entry that is only in this phone's outbox is not read again here: the sync engine is preparing it.
      preparing.current = entry.status === "processing" && entry.pending === undefined;
      setResult({ entryId, status: "ready", now: new Date(), entry, affirmations, profile });
      const confirmed = await confirmScriptureIfNeeded(entry);
      if (request !== latestRequest.current || confirmed === entry) return;
      setResult({ entryId, status: "ready", now: new Date(), entry: confirmed, affirmations, profile });
    } catch {
      if (request !== latestRequest.current) return;
      setResult((previous) =>
        previous?.entryId === entryId && previous.status === "ready"
          ? previous
          : { entryId, status: "error" },
      );
    }
  }, [entryId]);

  // The callback changes with the entry, so useFocusEffect reloads then if the screen is focused. Leaving the screen drops a
  // response that is still on its way and stops the reading.
  useFocusEffect(
    useCallback(() => {
      load();
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - startedAt > REFLECTION_POLL_MAX_MS) {
          clearInterval(timer);
        } else if (preparing.current) {
          load();
        }
      }, REFLECTION_POLL_MS);
      return () => {
        clearInterval(timer);
        latestRequest.current += 1;
      };
    }, [load]),
  );

  const retry = useCallback(() => {
    setResult(null);
    load();
  }, [load]);

  const current = result?.entryId === entryId ? result : null;
  if (current === null) {
    return { status: "loading" };
  }
  if (current.status === "not-found") {
    return { status: "not-found" };
  }
  if (current.status === "error") {
    return { status: "error", retry };
  }
  return {
    status: "ready",
    entry: current.entry,
    affirmations: current.affirmations,
    profile: current.profile,
    currentSlot: getCurrentSlot(current.now, current.profile.reminders),
  };
}
```

### 2.25 `src/components/AffirmationCard.tsx` (whole file)

Replace the whole file. The card is controlled now: the hook owns the heart.

```tsx
import type { SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { copy } from "@/constants/copy";
import { colors, shadows } from "@/constants/theme";
import type { Affirmation } from "@/types";

// Android's symbols are outline only, so its saved heart is a different glyph (a heart with a check).
const icons = {
  heart: { android: "favorite", ios: "heart" },
  heartSaved: { android: "heart_check", ios: "heart.fill" },
  clock: { android: "schedule", ios: "clock" },
} satisfies Record<string, SymbolViewProps["name"]>;

type AffirmationCardProps = {
  affirmation: Affirmation;
  // "8:00 AM • Tied to yesterday's prayer", built by the screen.
  footer: string;
  // The heart was pressed. Journal Home's hook saves it (step 25): it shows the new state at once and puts the old one back
  // when the save fails, so the heart here is whatever `affirmation.isFavorite` says.
  onToggleFavorite: () => void;
  // The last save failed and was put back: a calm line says so until the next press.
  saveFailed: boolean;
};

export function AffirmationCard({ affirmation, footer, onToggleFavorite, saveFailed }: AffirmationCardProps) {
  const favorite = affirmation.isFavorite;
  const slotName = copy.onboarding.rhythm.slots[affirmation.slot].name;

  return (
    <View className="card gap-2.5 p-5" style={shadows.card}>
      <View className="flex-row items-center justify-between gap-2">
        <Text className="eyebrow flex-1">{copy.journal.affirmation.eyebrow(slotName)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            favorite ? copy.journal.affirmation.unsave : copy.journal.affirmation.save
          }
          // The icon is 18, so 13 on every side makes a 44 touch area.
          hitSlop={13}
          onPress={onToggleFavorite}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Icon
            name={favorite ? icons.heartSaved : icons.heart}
            size={18}
            color={favorite ? colors.plumDeep : colors.mauve}
          />
        </Pressable>
      </View>
      <Text className="text-section tracking-[-0.5px] text-ink">{affirmation.headline}</Text>
      <Text className="text-body text-ink/80">{affirmation.text}</Text>
      <View className="flex-row items-center gap-1.5 pt-1">
        <Icon name={icons.clock} size={14} color={colors.mauve} />
        <Text className="flex-1 text-body-sm text-mauve">{footer}</Text>
      </View>
      {saveFailed ? (
        <Text accessibilityLiveRegion="polite" className="text-body-sm text-rosewood">
          {copy.journal.affirmation.saveError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
```

---

## 3. The checks the review created (`supabase/tests/journal-data/`)

Two files, already in the repo: `world.cjs` (the fakes: a fake Supabase that answers like PostgREST and the two Edge Functions, the step 24 fakes under it, a virtual clock, and a small React for the hooks) and `run.cjs` (**86 checks**). They run the app's real TypeScript (the gateway, the queries, the cache, the repository, the processor, the sync engine, the plan watcher and both screen hooks) with the real `supabase-js` client; the fake server records everything the database or AGENTS.md would refuse (`select *`, `audio_path`, a missing user filter, a column the app has no grant on, the publishable key as a bearer token), and every check ends by asserting that nothing like that was sent and that the development log holds no word, id, token or verse. Do not edit them to make them pass; if one is wrong, say so in the report.

```
node --no-warnings supabase/tests/journal-data/run.cjs            # about a minute
ONLY="journal:" node --no-warnings supabase/tests/journal-data/run.cjs      # one group while you work
TIMINGS=1 node --no-warnings supabase/tests/journal-data/run.cjs           # milliseconds per check, on stderr
GRACEHUSH_REPO=<a copy of the repo> node --no-warnings supabase/tests/journal-data/run.cjs
```

The groups are `gateway:` (the two functions), `entries:` and `columns:` (the queries), `live:` (the cache-first source), `repository:`, `processor:`, `engine:`, `journal:` (Journal Home), `reflection:`, `timestamp:`, `selectors:` and `copy:`.

### 3.1 Edits to the older checks

Three of the older checks describe the code before this step. Edit them first; the new checks need the first two edits to load.

#### `supabase/tests/offline/world.cjs`

The new world reuses the fakes of the keychain, NetInfo and the recordings folder, and the processor fake is read as a function now.

a) Find:

```js
    get processorIsMock() {
      return processor.isMock;
    },
```

Replace with:

```js
    isProcessorMock: () => processor.isMock,
```

b) Find:

```js
module.exports = {
  makeWorld,
  makeSqlite,
  makeCrypto,
```

Replace with:

```js
module.exports = {
  makeWorld,
  makeSqlite,
  makeCrypto,
  makeSecureStore,
  makeNetInfo,
  makeRecordings,
```

#### `supabase/tests/offline/run.cjs`

The database is at version 2.

a) Find:

```js
  await test("the file is named after a hash of the user id, in WAL mode, migrated to version 1, with a key in the keychain", async (w) => {
```

Replace with:

```js
  await test("the file is named after a hash of the user id, in WAL mode, migrated to version 2, with a key in the keychain", async (w) => {
```

b) Find:

```js
    assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 1);
```

Replace with:

```js
    assert.equal((await db.getFirstAsync("PRAGMA user_version")).user_version, 2);
```

#### `supabase/tests/profile-sync/run.cjs`

The rename, and a fake for the read cache that the repository now imports (plain Node cannot load the native modules behind it).

a) Find:

```js
    env.use("@/store/devStore").useDevStore.getState().setProfileSource(source);
```

Replace with:

```js
    env.use("@/store/devStore").useDevStore.getState().setDataSource(source);
```

b) Find:

```js
    const remote = env.use("@/data/profileRemote");
    env.use("@/store/devStore").useDevStore.getState().setProfileSource("supabase");
    const warnings = [];
```

Replace with:

```js
    const remote = env.use("@/data/profileRemote");
    env.use("@/store/devStore").useDevStore.getState().setDataSource("supabase");
    const warnings = [];
```

c) Find:

```js
    await prefs.persist.rehydrate();
    env.use("@/store/devStore").useDevStore.getState().setProfileSource("supabase");
    const client = env.use("@/services/supabaseClient");
```

Replace with:

```js
    await prefs.persist.rehydrate();
    env.use("@/store/devStore").useDevStore.getState().setDataSource("supabase");
    const client = env.use("@/services/supabaseClient");
```

d) Find:

```js
    fakes["@/db/outbox"] = {};
```

Replace with:

```js
    fakes["@/db/outbox"] = {};
    // Step 25: journalRepository.ts also imports the read cache, which needs the same native modules.
    fakes["@/db/cache"] = {};
```

e) Find:

```js
        "@/db/outbox": {},
        "@/services/offlineSession": { endOfflineSession: async () => undefined },
```

Replace with:

```js
        "@/db/outbox": {},
        "@/db/cache": {},
        "@/services/offlineSession": { endOfflineSession: async () => undefined },
```

f) Find:

```js
        "@/db/database": { isDatabaseOpen: () => false },
        "@/db/outbox": {},
```

Replace with:

```js
        "@/db/database": { isDatabaseOpen: () => false },
        "@/db/outbox": {},
        "@/db/cache": {},
```

---

**The review's mutation run.** The code was broken 100 ways, one at a time, in a scratch copy of the repo, and each break had to turn the run red by a named check. A break was tried against the group of checks that should catch it, and against the whole run if that group did not: all 100 were caught by a named check on the final code (earlier passes found breaks that no check named: each was closed by a stronger check, or by simpler code where the break changed nothing, before this text was written). The breaks (grouped): the gateway (no timeout, answers not validated, 429 or a token failure mapped wrong, the function's own code ignored, the 402 body read wrong, the short timeout on `process-entry`, more than the entry id sent to `confirm-scripture`); the columns (`audio_path` selected, a column dropped); the queries (no user filter on a page, an entry or the affirmations, `failed` listed, the cursor row included, no extra row so no next page, the count on every page, oldest first, a second column sent with the heart, a missing affirmation not `NOT_FOUND`); the live source (a later page trims the cache, the cursor taken from the last listed row, an entry the server lacks left in the cache, no cached copy offline, the week's start excluded, a crisis entry counted, a saved heart or the affirmations not cached, failed entries in the cached list, affirmations not ordered, the whole cache opened to show one page or to find the latest affirmations); the pure rules (a stale `processing` entry listed, the older read winning a merge, a tie not broken, a crisis entry supplying the affirmations); the week (Sunday in the next week, a bad zone not flagged); the form of the server's times (the fraction not cut to three digits, `+00:00` kept as an offset, the minutes of an offset lost, a space between date and time refused; a page's rows, one entry's row, the processor's entry or its prayer not in the canonical form; the cursor losing its microseconds); the repository (usage not capped, a paid plan limited, the week in UTC, an outbox item asked of the server, the cached affirmations lost offline, the heart sent to the mock rows, the affirmations of an outbox item asked of the server, the mock answering from the cache, a fixed page size, the plan always free); the processor (the recording uploaded again, the user id in the body, a missing recording `UNKNOWN`, the steps at the wrong time, the step timers not cleared, the 402 losing the saved entry, `NO_SPEECH` unknown, the mock never used, a recording uploaded for nobody, `NETWORK` unknown); the passage (asked again at once, asked offline, asked for the mock data or a crisis entry, the answer not cached); Journal Home (two scrolls making two requests, a reload dropping the older pages or their cursor, the count only what is loaded, a failed heart staying, the data source not in the key, a finished reflection not reloading the list, the cache not showing first, Try again not opening the database, pull-to-refresh keeping the pages); Reflection (reading never stops, a finished entry read again, the confirmed passage not shown, reading every second, the cache not showing first, the reading not stopped on leaving); the database (`uploaded` never saved or never read or defaulting to yes, the week's entries the wrong side, the engine caching the mock's answer); the dev store (the data source always `supabase`, a fixed page size); the plan watcher (never resumes, cannot be stopped, a trial not counted as paid).

**The older checks were extended in the review** (section 3.1). `offline/world.cjs` now exports the factories the new world reuses and reads the processor's `isProcessorMock` as a function; `offline/run.cjs` expects schema version 2; `profile-sync/run.cjs` uses `setDataSource` and fakes `@/db/cache` where it already faked the rest of the database. The 44, the 88 and the 68 are unchanged in number.

**What the checks cannot show** is everything that needs the real services and a phone: the real PostgREST and Edge Functions (the fakes are shaped from the packages' sources and from the functions' own tests), the real network, the look of the spinner and the heart's error line, VoiceOver, and how long a real reflection takes on the phone. Those are your walk-through (B).

---

## 4. AGENTS.md updates

**Already made in the review (do not repeat):** a vendor note at the end of "SDK and Vendor Version Notes" (supabase-js 2.118 Edge Function calls and PostgREST reads, and Hermes dates); a new section "Journal Data Rules (step 25)" after "Local Cache & Offline Rules", with the last bullet of that section pointing to it; the `journal-data/` entry in the tree's `tests/` line and the command with its `ONLY` switch in "Linting and Validation"; and the `@/db/cache` fake added to the profile-sync note.

**You make these, once the code is in and the checks pass.** AGENTS.md is CRLF: use the same script as section 2, then `cp AGENTS.md prompts/AGENTS.md` and `cmp` them.

**4.1 Journal Data Rules.** Change "Decided in the step 25 review (2026-10-25)" to "Built in step 25" and correct any number or name that differs from what you built.

**4.2 Architecture tree.** Add each new file with its exported names: `src/api/journalApi.ts` (`processEntry`, `confirmScripture`, `getLastFunctionCall`, `readLimitBody`, the types `FunctionName`, `FunctionResult`, `FunctionCall`), `src/data/columns.ts` (`ENTRY_COLUMNS`, `AFFIRMATION_COLUMNS`, `EntryRow`, `AffirmationRow`), `src/data/entriesRemote.ts` (`selectEntriesPage`, `selectEntry`, `selectAffirmations`, `updateAffirmationFavorite`, `getLastEntriesError`), `src/data/entriesLive.ts` (`readCachedEntries`, `readCachedEntry`, `readCachedAffirmations`, `readCachedLatestAffirmations`, `countDevotionalsSince`, `rememberEntry`, `loadEntriesPage`, `fetchEntry`, `fetchAffirmations`, `fetchLatestAffirmations`, `saveFavorite`), `src/services/scriptureConfirm.ts` (`needsScriptureConfirmation`, `confirmScriptureIfNeeded`), `src/services/upgradeWatcher.ts` (`watchPlan`) and `src/utils/week.ts` (`weekWindow`) and `src/utils/timestamp.ts` (`normalizeTimestamp`). Update the lines that change: `journalRepository.ts` (real behind `getDataSource()`, the new exports), `entryProcessor.ts` (the real processor; `isProcessorMock()`), `useJournalHome.ts` (pages, the heart, the count), `useReflection.ts` (cache first, polling, the passage), `AffirmationCard.tsx` (controlled), `db/schema.ts` (version 2), `db/outbox.ts` (`uploaded`, `markUploaded`), `db/cache.ts` (`listEntriesSince`), `selectors.ts` (`isListedEntry`, `mergeEntries`, `getNewestReadyEntry`), `mappers.ts` (row types of the column lists), `mock/scenario.ts` (`getDataSource`, `getEntriesPageSize`), `devStore.ts` (`dataSource`, `pageSize`) and the dev panel paragraph ("Data source (dev)", "Page size (dev)", the two new Supabase check lines). Replace the `86` placeholder of the `journal-data/` tree entry by the number your run prints.

**4.3 Screen Specifications.** *3. Journal Home:* the list holds 30 reflections at a time (a small plum spinner under the last card while older ones come, and nothing after the last); the number beside "Your Reflections" is the whole count; the reflections are the server's (this phone's waiting ones first), the cached copy shows first and the server's replaces it; the affirmation card's heart is saved, and a failed save puts the heart back and shows "We couldn’t save that. Please try again." under the card until the next press. *5. Reflection:* a reflection that a server is still preparing turns into the reflection by itself (read again every 5 seconds while the screen is in front, for 2 minutes); a passage that was kept as a reference is asked for again when the reflection opens. *7. Profile:* the plan card's usage line is counted on the phone (the devotionals this week that the read cache holds).

**4.4 Paragraphs that name the old switch.** In "State Management Rules", the "Dev store (step 09)" paragraph: `profileSource` and `setProfileSource` become `dataSource` and `setDataSource`, `getProfileSource()` becomes `getDataSource()` (what it decides now is in "Journal Data Rules"), and add `pageSize`. In the "Data layer (step 06)" paragraph add: since step 25 the repository's reads are real behind `getDataSource()`, and the mock path (`readEntries`, `addMockEntry`) is the `"mock"` source.

**4.5 Release gate.** The count that `grep -rnE "TEMP\(|TODO: real" src` prints changes to 15 (12 `TEMP(` and 3 `TODO: real`; it was 18 after step 24). Write the number you get, and say which markers went (every `TEMP(25)` and `TODO(25)`) and which stay (`TEMP(26)`, `TEMP(29)`, `TEMP(30)`, `TEMP(31)`).

**4.6 Build Status & Decisions Log: a "Step 25 — Journal and Reflection data" entry**, in the form of the steps before it: the decisions (this prompt's list and any you struck), the files added and changed, the differences from this prompt, the measured results (the checks, the bundles, the breakages), what the phone walk-through showed (B0 to B11, one line each, in your words and the user's), what was not verified, and the open items and markers left (`TODO(33)` in `useJournalHome.ts` and `useReflection.ts`, `TEMP(29)` for the prayer writes).

---

## 5. Rules

- No new dependency, no `any`, no new token, no layout change beyond: the spinner under the last card, the heart's error line, and the dev panel rows.
- Never log a transcript, a verse, a body, a token, a path or an id; never log anything about a crisis entry. The gateway keeps only a name, a status, a code and a time; the one `__DEV__` warning in `entriesRemote.ts` prints a table and a code.
- Never `select("*")` on `journal_entries` or `daily_affirmations`, never `audio_path`, never an embedding; `user_id` is only a filter. Every query on those tables filters by the signed-in user's id.
- The two Edge Functions are called only through `src/api/journalApi.ts` (the developer check is the one exception), and the user id never travels in a body.
- The only thing that opens the Paywall is the server's 402. A number computed on the phone never does.
- Crisis support is never held back: a crisis answer is an ordinary answer, the Journal lists it, and it has no affirmations. The app writes nothing about it to a log.
- Do not edit `supabase/functions/`, `supabase/migrations/`, `package.json`, `package-lock.json` or `app.json`. If something seems to need it, stop and ask.
- Keep `src/utils/week.ts` equal to `weekWindow` in `supabase/functions/_shared/limits/weekly.ts`.
- A time from the server enters the app only through `entriesRemote.ts` and `entryProcessor.ts`, in the form of `normalizeTimestamp`; the page cursor is the one text kept exactly as the server wrote it.
- Keep each file's line endings (the list is in section 2; the files in section 1 are LF).

---

## 6. Notes for later steps (reported, not edited: reconcile each at its own review)

- **26 (devotional playback).** Real entries now carry `devotional.audioPath` and `durationMs` (step 22: a WAV at `{userId}/devotionals/{entryId}.wav`, about 48 KB a second), so `getPlaybackTrack` returns a track for them and the mini player and Now Playing show the real length; playing still runs the mock timer (`TEMP(26)`). The app mints its own signed link, `supabase.storage.from("journal_media").createSignedUrl(path, 3600)` through `getSupabase()` (the bucket's select policy covers the user's own folder), keeps it in memory and refreshes it before it expires. `audioPath` is null when speech was off or failed (`error_code` `TTS_FAILED` on a ready entry): `getPlaybackTrack` then returns null, which is the "audio isn’t ready yet" state. To ask the server for the missing audio, `process-entry` is sent again with the same `clientEntryId` (for a finished entry with no audio it runs speech only), but its body must still validate (text of 10 to 5,000 characters or a recording path) and the phone no longer holds the words: that needs a placeholder or a speech-only request in the function, so ask before building it. Prompt 26 section 5 shows `load({ entryId, title, subtitle, durationMs, audioPath })`: `playerStore.load(track, ambient)` takes a `PlaybackTrack` (no `audioPath` today) and a second argument; add `audioPath` to the track and keep the second argument.
- **28 (notifications).** The three affirmations arrive with the finished entry (`ProcessOutcome.affirmations`, the engine's `finished` event) and are cached. For scheduling use the cache-only `readCachedLatestAffirmations()`: `getLatestAffirmations()` asks the server first and falls back to the cache. A notification tap opens `Reflection` with the entry's server id, and `getEntry(id)` answers it (cache, then server). A crisis entry has no affirmations: nothing is ever scheduled for it.
- **29 (prayers).** `listPrayers`, `markPrayerAnswered`, `unmarkPrayerAnswered` and `updateAnsweredNote` are still the step 14 mocks (`TEMP(29)`) and read the mock database even with the `"supabase"` source. The prayer fields are already in `ENTRY_COLUMNS` and in the cached models (`entry.prayer`). The cache keeps the newest 200 entries (`pruneEntries`, first page only): a prayer older than that is not in it, which is the note in prompt 29 about keeping prayers in the trim. `columns.ts` holds `ENTRY_COLUMNS` and `AFFIRMATION_COLUMNS` only; step 29 adds its patch list there. The app may write `is_active_prayer`, `is_answered`, `answered_at`, `answered_notes` and `prayer_category` (step 18), not `prayer_title` or `prayer_summary`. `devStore.nextPrayerMutationFails` also fails the mock heart and works only with the `"mock"` source.
- **30 (billing).** `purchases.ts` calls `resumeAfterUpgrade()` after a mock purchase; with the real source the server's plan is still `free` until the webhook runs, so the server answers 402 again and the item is held again. The plan reaches the phone in the next profile sync, and `upgradeWatcher.ts` resumes what the limit held at that moment: after a real purchase step 30 only has to make sure a profile sync follows (`syncProfile()`), and no other resume code is needed. "On `LIMIT_REACHED` while `useEntitlement` says pro, call `sync-subscription` and retry once" belongs in the engine's `applyFailure` or the processor and must keep the 402's `entryId` and `resetsAt`. `getKnownTier()` reads the mock plan first (`TEMP(30)`).
- **31 (account).** Prompt 31 says `src/lib/edgeFunctions.ts` and `callFunction('export-data', {}, { timeoutMs })`. The gateway is `src/api/journalApi.ts`, its `callFunction` is private and typed for two names: add `exportData()` and `deleteAccount()` there (or in a sibling file that copies its error handling) and extend `FunctionName`. `signOutCleanup()` already deletes the database file, so the cache and the outbox go; deleting the account must also remove `{userId}/raw/` and `{userId}/devotionals/` in Storage (the app has no delete policy there).
- **33 (realtime).** Two markers wait for it: `TODO(33)` in `useReflection.ts` (replace the polling) and in `useJournalHome.ts` (the streak counts the entries loaded so far). Prompt 33 says to read `src/lib/supabase.ts`: it is `src/services/supabaseClient.ts`. A realtime handler refetches with `getEntry(id)` and writes the cache (`rememberEntry` in `entriesLive.ts`); an entry with an outbox item is hidden behind the waiting card by `mergePending`, so do not double-handle it.
- **34 (analytics).** The gateway keeps only the last call in memory. Events belong at the call sites (`NewEntryScreen`, the engine), never carry a transcript, an id or a verse, and never exist for a crisis entry.
- **32 and 35.** Nothing here. Step 32 may measure the length of a spoken devotional against "about 60 seconds" (two minutes today) and revisit priority inference with real traffic.

---

## 7. Verify

### Part A: always (the implementer, no phone)

1. Red first (section 0.3), then apply sections 3.1, 1 and 2.
2. `npm run typecheck` and `npm run lint` exit 0. Read the whole output; nothing is disabled with a comment.
3. `node --no-warnings supabase/tests/journal-data/run.cjs` ends `86 checks passed`. Then the older four: offline `44 of 44 passed`, recording `68 passed, 0 failed`, profile-sync `88 passed, 0 failed` (about 35 seconds) and parity `7 of 7`. Put the last line of each in the report.
4. `npx expo install --check` says "Dependencies are up to date" and `npx expo-doctor` passes. `git diff --stat -- package.json package-lock.json app.json` prints nothing.
5. Bundle both platforms, one at a time, to a folder outside the repo (host memory, AGENTS.md): `NODE_OPTIONS=--max-old-space-size=3072 npx expo export --platform android --output-dir <a temp folder> --no-minify --no-bytecode --max-workers 2`, then `ios`. Both exit 0 (the review's took 1 to 3 minutes each and made about 10.7 MB). In the unminified Android and iOS bundles, `Loading more reflections`, `process-entry`, `confirm-scripture` and `We couldn’t save that. Please try again.` each appear, and `You can try again from your journal` does not. **The developer panel is not in a release bundle** (Metro drops the code behind `__DEV__`, which is why no `(dev)` string of any step is found there): to see `Page size (dev)`, `Data source (dev)`, `last function call` and `last entries error`, export Android once more with `--dev` added (about 13.8 MB), or ask the dev server for its bundle. Do not export while the emulator and Metro are both running.
6. Greps, each with its result named:
   - `grep -rn "TEMP(25)\|TODO(25)" src supabase` finds nothing;
   - `grep -rn "rofileSource" src supabase/tests` finds nothing;
   - `grep -rn 'select("\*")' src` finds only `src/data/profileRemote.ts` (the profile row, step 17), never the Journal tables;
   - `grep -rn "audio_path" src/api src/data/entriesRemote.ts src/data/entriesLive.ts` finds nothing;
   - `grep -rn "functions.invoke" src` finds only `src/api/journalApi.ts` and `src/components/dev/processEntryCheck.ts`;
   - `grep -rn 'from("journal_entries")\|from("daily_affirmations")' src` finds only `src/data/entriesRemote.ts` and the developer check;
   - `grep -rnE "TEMP\(|TODO: real" src | wc -l` prints 15 (the number you write into AGENTS.md);
   - `grep -rn "console\." src/api src/data/entriesRemote.ts src/data/entriesLive.ts src/services/scriptureConfirm.ts src/services/upgradeWatcher.ts` finds only the `__DEV__`-guarded warning in `entriesRemote.ts`.
7. Line endings: the CRLF files of section 2 are still CRLF (`tr -cd '\r' < file | wc -c` equals the line count) and `git diff --stat` shows only real changes, no whole-file rewrites. The new files are LF.
8. **Breakage smoke test** (the review's run is in section 3; prove the checks are wired to *your* files). One at a time, make the break, run the group named, see that check fail by name, then restore the line (`git diff` shows nothing for it):
   - in `journalApi.ts`, call `supabase.functions.invoke<unknown>(name, { body })` with no `timeout` (`ONLY="gateway:"`);
   - in `journalApi.ts`, replace `if (isValid(data)) return record(name, started, { ok: true, data });` by a line that returns `{ ok: true, data: data as T }` (`ONLY="gateway:"`);
   - in `entriesRemote.ts`, drop `.eq("user_id", userId)` from `selectEntriesPage` (any group: the fake server records it);
   - in `entriesRemote.ts`, change `.limit(limit + 1)` to `.limit(limit)` (`ONLY="entries:"`);
   - in `entriesLive.ts`, prune on every page (`ONLY="live:"`);
   - in `entryProcessor.ts`, change `if (!item.uploaded) {` to `if (true) {` (`ONLY="processor:"`);
   - in `scriptureConfirm.ts`, delete the one-minute guard (`ONLY="reflection:"`);
   - in `useJournalHome.ts`, take `|| loadingMoreNow.current` out of `loadMore`'s guard (`ONLY="journal:"`);
   - in `useReflection.ts`, make the interval load whether or not `preparing.current` (`ONLY="reflection:"`);
   - in `journalRepository.ts`, change `used: Math.min(made, FREE_DEVOTIONALS_PER_WEEK)` to `used: made` (`ONLY="repository:"`);
   - in `week.ts`, change `(here.weekday - weekStartsOn + 7) % 7` to `(here.weekday - weekStartsOn) % 7` (`ONLY="repository:"`);
   - in `upgradeWatcher.ts`, delete `if (turnedPaid) void resumeAfterUpgrade();` (`ONLY="engine:"`);
   - in `entriesRemote.ts`, return `rows: page` instead of `rows: page.map(withCanonicalTimes)` (`ONLY="entries:"`);
   - in `selectors.ts`, make `mergeEntries` keep the existing entry when both have the id (`ONLY="selectors:"`).
9. With the user's yes only (see C): boot the emulator as AGENTS.md says (Metro first, then the emulator; never against the real project without asking) and open Journal once with the network off. Put every override back and shut the emulator down.

### Part B: the phone walk-through (you, on the iPhone in Expo Go)

"What you do yourself", B0 to B11. The implementer asks for the results one by one and writes them into the log entry. B2, B3 and B4 prove the real round trip, B5 the pages, B6 the passage, B7 the heart and B8 the free limit and the plan watcher.

### Not verified, and said so

Say each of these in the report unless it was run: the iPhone entirely until Part B is done; Android on a device; the real services (the checks use fakes shaped from the sources); a request that takes longer than about 64 seconds on iOS (the phone's `fetch` has been seen to wait that long, not 145); the look of the spinner and the heart's error line; VoiceOver and TalkBack on them; real audio (step 26) and a real purchase (step 30); a Journal with hundreds of entries on the free-tier database (the nano instance has a floor of about 450 ms per query, AGENTS.md).

---

## 8. Report

Say, in this order and briefly: the files created, changed and replaced (one line each); that no package, `app.json`, migration or function changed; the `TEMP(25)` and `TODO(25)` list with how each was closed; the checks (typecheck, lint, the 86, the four older ones, doctor, both bundles and what was found in them, the greps with their results, the breakages and which check named each); the phone walk-through results B0 to B11 (and any you did not get); the Android run if the user said yes; the AGENTS.md changes of section 4 and that `prompts/AGENTS.md` equals it; what was not verified; the known limits and the question about the saved note; and anything that differs from this prompt, with the reason. If you changed any of the code in sections 1 and 2, say which line and which check still proves it.
