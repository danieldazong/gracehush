# 31-account-actions.md

Read AGENTS.md first and follow it strictly.

Make Profile's two account actions real. **Export Journal** builds a ZIP of everything the person has in Gracehush (a README, the data as JSON, the journal as readable Markdown, and their audio) and gives them a short-lived download link. **Delete Account** removes their files, their database rows, their RevenueCat customer and their Clerk user, in an order that can be retried safely. Two new Edge Functions do the work, `export-data` and `delete-account`, and the step 15 mocks in `src/services/account.ts` are replaced. The Profile dialogs keep their step 15 look; only the export's success line changes (section 6.4).

**Status of this text.** Reviewed and rewritten on 2026-10-30 from the code of steps 15 to 30 (read file by file) and from the vendors' current pages (listed below), with one live measurement (the ZIP library, finding 4). Nothing in it has been deployed. The functions, the migration and the app code are specified closely enough to build, and the implementer proves them (section 8), as steps 29b and 30 did. Where this text gives a shape and the real code disagrees, follow the real code and say so in the report.

Sources read: `AGENTS.md`; `src/services/account.ts`, `src/screens/profile/ProfileScreen.tsx`, `src/constants/copy.ts` (`profile`), `src/constants/app.ts`, `src/api/journalApi.ts`, `src/services/externalLinks.ts`, `src/services/offlineSession.ts`, `src/services/syncEngine.ts`, `src/services/subscriptionSync.ts`, `src/services/profileSync.ts`, `src/store/profilePrefsStore.ts`, `src/types/index.ts`, `src/types/contractParity.ts`, `src/types/supabase.ts`, `src/data/mock/scenario.ts`; `supabase/functions/_shared/` (`auth.ts`, `admin.ts`, `errors.ts`, `log.ts`, `env.ts`, `cors.ts`, `billing/revenuecat.ts`), `supabase/functions/delete-entry/` (the closest pattern: `handler.ts`, `lifecycle.ts`), `supabase/functions/process-entry/` (`lifecycle.ts` `ensureProfile`, `contracts.ts`, `testing/fakes.ts`), `supabase/config.toml`, `supabase/migrations/` (the journal_media bucket and its two policies, the cascades), `supabase/tests/rls_selftest.sql`, `supabase/tests/run-in-pglite.mjs`; `assets/audio/ambient/LICENSES.md`; `docs/legal-brief.md`, `docs/privacy-policy.md`; the installed `@clerk/clerk-js` 6.39.1 (`signOut`); and these pages, which are the source of truth for anything this text does not settle:

- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://supabase.com/docs/reference/javascript/storage-from-list
- https://supabase.com/docs/reference/javascript/storage-from-remove
- https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
- https://clerk.com/docs/reference/backend/user/delete-user (Backend API `DELETE /v1/users/{user_id}`)
- https://www.revenuecat.com/docs/api-v1/customers#tag/customers/operation/delete-subscriber
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://github.com/101arrowz/fflate (version 0.8.3)

---

## What was checked when this was written (these shaped the prompt)

1. **The old text predated steps 17 to 30 and named things that do not exist.** `src/screens/ProfileScreen.tsx` is `src/screens/profile/ProfileScreen.tsx`; there is no `src/lib/edgeFunctions.ts` and no `callFunction`: every Edge Function call goes through `src/api/journalApi.ts` (AGENTS.md, Journal Data Rules); there is no `embedding` column (it is V2), no `revenuecat_events` table (step 30 dropped it), no "Known Schema Gaps" or "Account Rules" section and no Legal section on Profile; `npx supabase functions serve`, `rls_test` and "local first" do not exist here (no Docker: Deno tests with the fake world, PGlite, and the user's SQL editor). Devotional audio is a **WAV** since 2026-10-24, not an MP3.
2. **The markers to close are five, not "steps 15, 20, 29 and 30".** `git grep` finds `TEMP(31)` at `src/services/account.ts:1` and `src/constants/copy.ts:799`, and `TODO(31)` at `src/services/account.ts:24` (the prayers in the export, from step 29), `src/services/account.ts:39` (the server deletes everything, step 15; step 30 named the RevenueCat customer in it) and `src/constants/copy.ts:841` (the export dialog's promise of a download link). Step 20's scripture credit never became a marker: Profile's footer already says "Scripture quotes from Berean Standard Bible (BSB)", and neither the BSB, the Free Use Bible API nor the three ambient loops (Pixabay Content License, `assets/audio/ambient/LICENSES.md`) require a credit, so the old "legal credits" item is dropped.
3. **Edge Function limits decide the export's size** (Supabase docs, 2026-10-30): 256 MB of memory, 150 s of wall clock on the Free plan (400 s on paid plans), **2 s of CPU per request, not counting async I/O**, and a 150 s idle timeout. A Free project's **global upload limit can't exceed 50 MB** (Storage, Settings), and a bucket's own limit can't be higher than the global one. A devotional is a lossless WAV of about 48 KB a second (about 5.5 MB for two minutes) and a recording is AAC at 64 kbps (about 2.4 MB for five minutes), so a 48 MB export holds every word but not every audio file of an active user: audio is added while it fits, and what is left out is listed (decision 4).
4. **fflate builds such a ZIP well inside the budget.** Measured in the review with Deno 2.9.6 on this PC: `zipSync` of a 46 MB stored (uncompressed) audio entry plus 0.8 MB of deflated JSON took **0.3 s**, and Windows' own ZIP reader (.NET `ZipFile`, what Explorer uses) opened the result with the right entries and sizes. fflate 0.8.3 (2026-05-16) is MIT, has no dependencies and imports as `npm:fflate@0.8.3`. The probe held three copies of the data and peaked at 203 MB, so the function must drop the downloaded files once the ZIP is built (decision 5).
5. **storage-js `list(prefix, { limit, offset })`** returns 100 entries by default, and a sub-folder comes back as an entry with `id: null`, so a complete listing of `{userId}/` must page **and** recurse (`raw/`, `devotionals/`). `remove(paths)` takes a list of paths and answers with what it removed (a path that is not there is not an error). `createSignedUrl(path, seconds, { download })` makes a link whose download carries that file name. The existing storage policies all name `journal_media`, so a new bucket with no policy of its own is closed to the app by construction.
6. **Clerk:** `DELETE https://api.clerk.com/v1/users/{user_id}` with `Authorization: Bearer <secret key>` deletes the user, and a user that does not exist answers 404. The secret key is a **new server secret**, `CLERK_SECRET_KEY` (`sk_test_…` for the Development instance this project uses); it is not in `supabase/functions/.env.local` yet. A key from another Clerk instance would answer 404 for this user and look like "already deleted", so the function first reads the user (`GET /v1/users/{user_id}`), which must answer 200 because the token has just proved the user exists (decision 9).
7. **Clerk does not revoke Sign in with Apple when it deletes a user.** Its user-deletion and Apple pages say nothing about Apple tokens, and several projects report that Clerk's native Apple flow keeps no Apple token, so deleting the Clerk user leaves the Apple grant in place. Apple says apps with Sign in with Apple "should use the Sign in with Apple REST API to revoke user tokens"; its technical note TN3194 (2025-10-03) adds that when the app has no refresh token, access token or authorization code, "you must still fulfill the user's account deletion request" and then direct the person to stop using Sign in with Apple for the app. Sign in with Apple cannot run in Expo Go (AGENTS.md, Authentication Rules), so no account in this project has an Apple sign-in yet. Programmatic revocation (a fresh authorization code at deletion time, exchanged and revoked on the server with the Apple key) belongs with step 35's Apple setup (decision 10).
8. **RevenueCat (API v1):** `DELETE /subscribers/{app_user_id}` "permanently deletes a customer", is queued asynchronously, answers 200 `{ "app_user_id", "deleted": true }`, and answers 404 when the customer does not exist ("after a 200, treat as confirmation that the customer no longer exists"). It works with the V1 secret key step 30 already holds (`REVENUECAT_SECRET_API_KEY`), which step 30's walk-through proved belongs to the Gracehush project. Deleting the customer does **not** cancel an App Store or Google Play subscription; step 15's delete dialog already tells a trial or Pro user so, which is what Apple asks ("notify them that billing will continue through Apple and ask them to cancel their subscription before continuing").
9. **Store rules** (Apple's "Offering account deletion in your app", Google Play's account deletion page): the deletion must be in the app and remove the account record with its personal data (Profile, Delete Account does); Google Play also needs a **web page** where someone can request deletion without the app, entered in the Play Console's Data safety form. That page is yours to publish; the app only keeps its address as `ACCOUNT_DELETION_URL`, a placeholder the release gate catches (decision 13).
10. **A request that runs during the deletion can recreate data.** `process-entry` upserts the profile row (`ensureProfile`) before it saves an entry, the profile sync creates the row when it is missing, and RevenueCat's `GET /subscribers` creates a customer. So the app stops its own background work before it asks for the deletion (decision 11), and the function ends with a second pass over storage and the database (decision 8). A second signed-in device can still write for up to a minute (a Clerk session token lives 60 s and the functions verify it without asking Clerk): a known limit, written into AGENTS.md.
11. **After the server deletes the Clerk user, the app still reaches Sign In.** clerk-js 6.39.1's `signOut()` clears its session and user and notifies its listeners **before** it asks Clerk to end the session, and rethrows any error but a network one. So Profile's sign-out after a successful deletion must ignore that error instead of showing "We couldn't sign you out" (section 6.4).
12. **Profile's notices clear when the tab loses focus** (step 15), so a download link kept only on screen is lost when the person looks at another tab. Rather than a 429 that would then block a second export for 10 minutes, a second export within 10 minutes hands back the same ZIP with a fresh link (decision 6).
13. **The legal drafts already describe step 31** (`docs/privacy-policy.md` section 8, `docs/legal-brief.md`), with a 24-hour link and "one export every 10 minutes"; they change with decisions 6 and 7 (section 6.6).

---

## What you do yourself (read this first)

Nothing here costs money: no new plan, package price or API is billed. When you do the dashboard steps the implementer guides you one instruction at a time and checks your screenshots. The dashboards' labels may differ slightly from the names below: send a screenshot when one does not match.

### Keys and settings (checked by names only, on 2026-10-30)

| file | has now | this step adds |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY` | nothing |
| `supabase/functions/.env.local` | `CLERK_ISSUER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE`, `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_WEBHOOK_SIGNING_SECRET` | `CLERK_SECRET_KEY` |

`CLERK_SECRET_KEY` is a **secret**: it can delete any user of your Clerk instance. Never in the app, an `EXPO_PUBLIC_` name, a chat, a screenshot or a commit.

### A. The order of work

1. **Before the implementation (you, about 5 minutes):** B1 and B2 below.
2. The implementer builds and proves everything offline (Part A of section 8). Your "Implement it." approves the package (fflate), the migration file and the decisions below.
3. **At the deploy gate (you):** apply the migration and self-test (C), then set the secrets and deploy (D). The implementer asks first.
4. The implementer asks whether to start the phone walk-through (E).

### B. Before the implementation

1. **Storage's upload limit.** In the Supabase dashboard open your `gracehush` project, then **Storage**, then **Settings** (in Storage's left column). Find **Global file size limit** (on the Free plan it can't be more than 50 MB). Change nothing; tell the implementer the number and its unit. The export's size cap is that limit minus 2 MB (decision 4).
2. **The Clerk secret key.** Go to https://dashboard.clerk.com and open the **Gracehush** application. At the top, check that the instance switch says **Development** (the instance your app signs in with). Open **Configure**, then **API keys** (in some layouts **Developers**, then **API keys**). Under **Secret keys**, copy the key: it starts with `sk_test_`. In VS Code open `supabase/functions/.env.local` and add a line at the end:
   `CLERK_SECRET_KEY=` followed by the key, with no space and no quotes. Save. **Do not run `secrets set` yet** (D does).
3. Tell the implementer "done". It checks the name and the `sk_test_` prefix without printing the value.

### C. At the deploy gate: the migration and self-tests (you, in the browser)

1. In VS Code open `supabase/migrations/20261030120000_exports_bucket.sql` (written by the implementer). Press **Ctrl+A**, then **Ctrl+C**. In the Supabase dashboard open **SQL Editor**, press **+** for a new query, paste and press **Run**. Expect **Success. No rows returned.**
2. Open `supabase/tests/rls_selftest.sql`, copy it all into a **new** query, and at the very end add a blank line and:
   `select count(*) as checks, count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from rls_results;`
   Press **Run** (answer **Run without RLS** if a dialog appears). Expect the count the implementer gives you (56) with 0 failed. Send a screenshot.
3. Run `supabase/selftest.sql` the same way, with this line at the end instead: `select count(*) as checks, count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from selftest_results;` Expect 11, 11, 0.
4. No types download this time: a storage bucket does not change the generated types.

### D. At the deploy gate: secrets and deploy (you, in the terminal, after the implementer asks)

Run these in this order, from the repo folder. `<project-ref>` is the one from your earlier deploys.

```bash
npx --yes supabase@2.121.0 secrets set --env-file supabase/functions/.env.local --project-ref <project-ref>
npx --yes supabase@2.121.0 functions deploy export-data --project-ref <project-ref> --use-api
npx --yes supabase@2.121.0 functions deploy delete-account --project-ref <project-ref> --use-api
```

Never deploy before C: `export-data` writes to the new bucket. The other five functions do not need a redeploy (they gain the new log fields, empty, at their next deploy). Then the implementer sends requests with no sign-in and expects each function's own answers (401 for a POST with no token, 405 for a GET, 204 for the browser's preflight).

### E. Phone walk-through (iPhone, Expo Go)

The checks are at the end of section 8 (Part B). Before B0, restart the dev server with `npx expo start -c` (new files), then force-quit and reopen Expo Go.

### F. Before release (yours; the implementer only prints this list)

- **The account deletion web page** at a real address, next to your Privacy Policy and Terms pages. It says how to delete the account in the app (Profile, Delete Account) and how to ask for deletion without the app (an email to your support address, with the email address used to sign in). Its address replaces `ACCOUNT_DELETION_URL` in `src/constants/app.ts`, and goes in the Play Console's **Data safety** form.
- **App Store Connect review notes:** "Account deletion: Profile → Delete Account. Deleting removes the account, its journal, recordings, devotionals and the subscription record; it does not cancel an App Store subscription, and the app says so first."
- **Sign in with Apple token revocation** (step 35): built when the Apple sign-in is configured.
- **The Privacy Policy and Terms** drafts in `docs/` describe the export and the deletion as built (section 6.6); a lawyer reviews them before they are published.

### G. If something goes wrong: what it means

- **Export answers 500 and the log says `account: export:failed:storage_upload`.** The bucket is missing (C1 not run) or its size limit is lower than the ZIP: check C1 and B1.
- **The Download opens a page that says the object was not found or the signature expired.** The link lives one hour; tap Export Journal again (within 10 minutes it hands back the same file with a new link).
- **Delete answers 500 with `DELETE_INCOMPLETE`.** One step failed; everything before it is done, and trying again continues from there. The log's `account` word names the step (`delete:failed:clerk:http_401` means `CLERK_SECRET_KEY` is wrong or missing on the hosted project: fix the file, then `secrets set` again; secrets apply at once).
- **Delete answers 500 with `account: delete:failed:config:CLERK_SECRET_KEY` and nothing was deleted.** The key is missing, malformed, or belongs to another Clerk instance (the user read before deleting answered 404).

---

## Decisions (approved with this prompt by your "Implement it.")

1. **Package: `npm:fflate@0.8.3`, pinned in `supabase/functions/export-data/deno.json` only** (the app's `package.json` is untouched). If you strike it, the implementer writes a store-only ZIP writer instead (local headers, central directory, CRC-32: about 80 lines), with the same output and tests that read the archive back.
2. **No new app package.** The download opens in the system browser through `Linking.openURL` (Safari on the iPhone saves the ZIP to Files, Chrome on Android to Downloads).
3. **The export's contents:** `README.txt` (what is inside, the export time and time zone, the audio left out by name, and a line that the file holds private reflections); `journal.json` (`{ exportedAt, schemaVersion: 1, timeZone, profile, entries }`, every column of the profile, and every column of each entry with its affirmations nested under it, except `user_id`, with `audio_path` and `devotional_audio_path` replaced by `recording_file` and `devotional_audio_file`: the file's path inside the ZIP, or null when it is not in the ZIP); `journal.md` (section 3.4); `audio/recordings/{YYYY-MM-DD}-{entryId}.m4a` and `audio/devotionals/{YYYY-MM-DD}-{entryId}.wav`, the date in the profile's time zone. Nothing else of the database is exported (the `deleted_devotionals` record holds no content).
4. **Size: `EXPORT_MAX_BYTES` = the global upload limit from B1 minus 2 MB** (48 MB on the Free plan's 50). The text files go in first, then the person's own **recordings** newest first, then the **devotional audio** newest first, each only while the ZIP stays under the cap and the request is under 80% of the wall-clock limit (120 s of 150). Everything left out is listed in `README.txt`, and the answer says `partial: true`.
5. **Memory:** audio is downloaded one file at a time into the list of ZIP entries, the ZIP is built once with `zipSync` (text at level 6, audio stored at level 0), and the downloaded files are dropped before the upload, so the peak is about twice the cap.
6. **One export per person, reused for 10 minutes.** A request within 10 minutes of the newest export answers with a fresh link to that same ZIP (`reused: true`) and builds nothing; after 10 minutes, the older exports are removed and a new one is built. No 429.
7. **The link lives one hour** (was 24 hours): it is only ever opened from the app, right after the export is ready, and a link to someone's prayers should not stay usable for a day in a browser's history. The ZIP itself stays in the private `exports` bucket until the next export or the account's deletion (a scheduled clean-up is `TODO(V2)`).
8. **Deletion order: storage, then the database, then RevenueCat, then Clerk, then a final pass.** Every secret is read and checked **before anything is deleted**, and Clerk is asked once whether the user exists (finding 6). Then: every file under `{userId}/` in `journal_media` and in `exports`; the profile row (its entries, affirmations and deleted-devotional records go with it, `on delete cascade`), then a count that none remain; the RevenueCat customer (404 counts as done); the Clerk user (404 counts as done; last, so the token keeps working for a retry until the end); and a final pass over storage and the database that catches anything written during the run (best effort: logged, never a failure, because the account is gone by then). Any step before the final pass that fails stops with `500 DELETE_INCOMPLETE`; what is done stays done, and a retry continues.
9. **Secrets:** `CLERK_SECRET_KEY` must start with `sk_test_` or `sk_live_`; the RevenueCat key is step 30's `REVENUECAT_SECRET_API_KEY` (read with `readBillingConfig`). A missing or malformed one is a 500 before anything is touched (`account: delete:failed:config:<NAME>`).
10. **Sign in with Apple: no change in this step.** No account here can have an Apple sign-in until step 35. The delete function carries a `TODO(35)` at the place the revocation goes, and AGENTS.md's "Before a store build" gains the item.
11. **The app stops its own background work before it asks for the deletion:** the sync engine, the plan watch and the profile sync's pending send. If the deletion fails, it starts the engine and the plan watch again; if it succeeds, `signOutCleanup()` runs, the account's settings kept on the phone are forgotten (`forgetUser`), and Clerk's `signOut()` runs with its error ignored (finding 11). If the function answers `UNAUTHORIZED`, the account or its session is already gone: the app signs out the same way (signing out is always safe).
12. **Timeouts in the app:** `export-data` 155 s and `delete-account` 155 s (both above the function's own 150 s, so the app never gives up on a deletion that is still running).
13. **`ACCOUNT_DELETION_URL`** joins `src/constants/app.ts` as `"https://example.com/TODO-delete-account"` marked `// TODO: real URL before release`. It is not shown in the app. The release gate then prints 6 lines.
14. **The mock data source keeps the step 15 mocks** (with "Fail next save (dev)"), now answering the new export shape with a placeholder link; a release build never reaches them.
15. **Logs:** five new fields, all one word or a number: `account` (`export:built`, `export:reused`, `export:failed:<reason>`, `delete:done`, `delete:failed:<step>:<reason>`), `accountEntries`, `accountFiles`, `accountLeftOut` and `accountBytes`. The line goes from 33 to 38 fields. Never a path, a link, a file name, an id, a key or anything the person wrote.
16. **One new error code, `DELETE_INCOMPLETE`** (500, "We couldn’t finish deleting your account. Please try again."). Export failures are `INTERNAL`.

---

## Out of scope

- Emailing the export, a PDF, or a password on the ZIP.
- A scheduled clean-up of old exports, and Clerk reverification (a fresh sign-in) before deletion: `TODO(V2)` in AGENTS.md.
- Sign in with Apple token revocation (step 35).
- Stopping another signed-in device at once (finding 10, known limit).
- The account deletion web page itself (F; yours).

---

## 0. Before you write code

1. **Baseline, written down before any change** (the numbers at the review, 2026-10-30; record what you see):
   - `npm run typecheck` and `npm run lint` exit 0; the app-side suites: billing 24, offline 44 of 44, journal-data 87, notifications 48, prayers 33, deletion 32, profile-sync 88, recording 68, playback 133, ambient 64, parity 7 of 7.
   - Deno (the commands in AGENTS.md, Linting and Validation): 429 tests, lint 87 files, fmt 101 files.
   - PGlite: 53 of 53 and 27 broken variants caught.
   - The release gate prints 5 lines.
2. **The five markers** listed in finding 2, each closed here or explained in the report.
3. **Keys:** check `CLERK_SECRET_KEY` in `supabase/functions/.env.local` by name and `sk_test_` prefix only, never the value. Ask for B1's number. Without both, stop and ask for section B. Write no code before that. **Never search a folder that holds a `.env.local` with a plain `grep`** (search `git ls-files`, or exclude the file), so no secret ever reaches a log.
4. **Red first:** write the new checks (section 8) before the code, run them against the tree as it is, and write down the red numbers.

---

## 1. The migration: the exports bucket

`supabase/migrations/20261030120000_exports_bucket.sql` (new; additive, idempotent):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, <B1's limit in bytes>, array['application/zip'])
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

- No `storage.objects` policy names `exports`: only the service role reads and writes it, and people get signed links.
- `rls_selftest.sql` gains checks 54 to 56 (56 in all): the bucket is private with that limit and only `application/zip`; a signed-in user can neither upload into, read nor list `exports` (their own folder included); a signed-out visitor sees nothing there.
- `run-in-pglite.mjs` gains broken variants that must each fail their check: a public bucket, a select policy for `authenticated` on `exports`, an insert policy for `authenticated` on `exports`. `preflight.sql` gains a row for the bucket.
- Path layout (AGENTS.md): `exports/{userId}/{exportId}.zip`, or `exports/{userId}/{exportId}-partial.zip` when audio was left out, the export id a random UUID. The name carries `partial`, so a reused export answers it truthfully.

---

## 2. Shared code: `supabase/functions/_shared/account/`

- **`storageFiles.ts`**: `listAllFiles(admin, bucket, prefix): Promise<string[]>` pages `list(prefix, { limit: 100, offset })` until fewer than 100 come back, recurses into every entry whose `id` is null, and returns full paths; `removeAll(admin, bucket, paths)` removes in batches of 100, and a path that is not there is not an error. Throw `AppError("INTERNAL", "storage_list_failed" | "storage_remove_failed")` on a storage error.
- **`userData.ts`**: `collectUserData(admin, userId)` reads with the service role, every query filtered by the user (`users_profile` by `id`, the other tables by `user_id`): the profile row; every entry, oldest first, in pages of 500 (`range`); every affirmation, nested under its entry. It never reads the email (Clerk has it; the session token does not carry it).
- **`clerk.ts`**: `readClerkSecret()` (the `sk_test_` / `sk_live_` rule), `getClerkUser(secret, userId)` and `deleteClerkUser(secret, userId)` against `https://api.clerk.com/v1/users/{userId}` with `Authorization: Bearer`, one attempt of 8 s each, answering `{ ok: true }`, `{ ok: true, notFound: true }` or `{ ok: false, reason }` (reasons as words: `http_401`, `http_5xx`, `timeout`, `network`). Never throws, never logs.
- **`_shared/billing/revenuecat.ts`** gains `deleteSubscriber(apiKey, userId)`: `DELETE /subscribers/{id}`, one attempt of 8 s, 200 or 404 is done, anything else a reason word. It stays the only code that talks to RevenueCat.

---

## 3. `export-data` (new function, called by the app)

Files: `index.ts` (serves), `handler.ts` (the flow), `archive.ts` (pure: README, JSON, Markdown, the audio choice, the ZIP), `lifecycle.ts` (storage and database calls), `deno.json` (the two step 19 pins plus fflate), `handler_test.ts`, `archive_test.ts`. `config.toml`: `[functions.export-data] verify_jwt = false` (the Clerk token is checked by `_shared/auth.ts`, as for every function here).

### 3.1 The flow

1. OPTIONS 204; anything but POST 405; `verifyClerkRequest`; the user id comes only from the token, and the body is ignored.
2. List `exports/{userId}/`. If the newest export is under 10 minutes old, answer with a fresh link to it (`reused: true`, `partial` from its name, `sizeBytes` from the listing's `metadata.size`) and stop.
3. `collectUserData`; build the text files; choose and download the audio (decision 4), one file at a time, from `journal_media`. A file that cannot be downloaded is left out and listed, not a failure.
4. `zipSync`, drop the inputs, remove the user's older exports, upload `exports/{userId}/{exportId}.zip` (or `-partial.zip`; `contentType: "application/zip"`, `upsert: false`).
5. `createSignedUrl(path, 3600, { download: "gracehush-journal.zip" })`.
6. 200 `{ url, expiresAt, partial, reused, sizeBytes }`. Errors use the step 19 envelope: storage or database failures are `500 INTERNAL`.

### 3.2 Time and size

Track elapsed time from the request's start: no audio is added after 120 s, and the export finishes as partial. Never exceed `EXPORT_MAX_BYTES`, counting each entry's stored size plus its headers.

### 3.3 Dates

Entry dates use the profile's time zone (`Intl`; a zone `Intl` does not know is UTC, as in `_shared/limits/weekly.ts`). **An answered day is the UTC date of `answered_at`** (AGENTS.md, Prayer Rules: it is stored as 12:00 UTC on that calendar day), never a local date of it.

### 3.4 `journal.md`

One section per entry, newest first. A finished entry: the date, the title, "What you shared" (the transcript), the scripture reference with its text only when verified, the devotional, the closing prayer, the prayer status ("Prayer request", or "Answered on {day}" with the gratitude note), and the three affirmations (headline and text). An entry that never finished: the date and what was shared, if anything. **A crisis entry: the date and the person's words only, with no heading, label or word about crisis** (the JSON keeps `is_crisis`, which is the person's data). Plain Markdown with the three marks AGENTS.md allows elsewhere, typographic punctuation in the app's own words.

---

## 4. `delete-account` (new function, called by the app)

Files: `index.ts`, `handler.ts` (the flow of decision 8), `lifecycle.ts` (storage and database), `deno.json`, `handler_test.ts`, `lifecycle_test.ts`. `config.toml`: `[functions.delete-account] verify_jwt = false`.

1. OPTIONS 204; anything but POST 405; `verifyClerkRequest`; the body must be exactly `{ "confirm": "DELETE" }`, anything else `400 INVALID_REQUEST` (the two-step dialog sends it; it stops an accidental call).
2. Read and check every secret (decision 9), then `getClerkUser`: 200 continues, 404 is `config:CLERK_SECRET_KEY` (another instance's key), anything else `DELETE_INCOMPLETE` with the step `clerk`. Nothing has been deleted yet.
3. Storage: `listAllFiles` + `removeAll` for `journal_media` `{userId}/` and for `exports` `{userId}/`.
4. Database: delete `users_profile` where `id` = the user; then count the user's rows in `journal_entries`, `daily_affirmations` and `deleted_devotionals`, and delete any left explicitly (a cascade that did not happen is a bug to report, not to hide).
5. RevenueCat: `deleteSubscriber`. 404 is done.
6. Clerk: `deleteClerkUser`. 404 is done. `// TODO(35): revoke Sign in with Apple here, before this call (AGENTS.md, Before a store build).`
7. Final pass: steps 3 and 4 again, best effort.
8. 200 `{ deleted: true }`. A failure in 3 to 6 is `500 DELETE_INCOMPLETE`, its `account` word naming the step.

---

## 5. Shared changes

- `_shared/errors.ts`: `DELETE_INCOMPLETE` (500) with its message.
- `_shared/log.ts`: the five fields of decision 15, empty by default in `blankLogLine`; every function's "holds exactly these fields" test moves to 38.
- `process-entry/contracts.ts` (import-free) and `src/types/index.ts`: `ExportDataResponse` `{ url: string; expiresAt: string; partial: boolean; reused: boolean; sizeBytes: number }`, `ExportDataErrorCode` (`UNAUTHORIZED`, `METHOD_NOT_ALLOWED`, `INTERNAL`), `DeleteAccountRequest` `{ confirm: "DELETE" }`, `DeleteAccountResponse` `{ deleted: true }`, `DeleteAccountErrorCode` (`INVALID_REQUEST`, `UNAUTHORIZED`, `METHOD_NOT_ALLOWED`, `DELETE_INCOMPLETE`, `INTERNAL`); `src/types/contractParity.ts` gains their lines.
- `supabase/functions/.env.example`: `CLERK_SECRET_KEY=` with a comment (server only; the Development instance's `sk_test_` key).
- The fake world (`process-entry/testing/fakes.ts`): the `exports` bucket; storage `list` (`POST /storage/v1/object/list/{bucket}` with `prefix`, `limit`, `offset`, folders as `id: null`) and signing (`POST /storage/v1/object/sign/{bucket}/{path}`); `DELETE /v1/subscribers/{id}` on the RevenueCat host; and a Clerk Backend API host (`GET` and `DELETE /v1/users/{id}`), each refusing a request without the right bearer, with one-shot failures for the tests.
- AGENTS.md's Deno commands name the two new folders (`check` with each function's own `deno.json`, `lint`, `test`).

---

## 6. The app

### 6.1 `src/api/journalApi.ts`

`FunctionName` gains `"export-data"` and `"delete-account"`; `exportData()` (155 s) and `deleteAccount()` (155 s, body `{ confirm: "DELETE" }`), each with a hand-written guard for its answer, like the others. `src/constants/app.ts` gains `EXPORT_DATA_TIMEOUT_MS` and `DELETE_ACCOUNT_TIMEOUT_MS`.

### 6.2 `src/services/account.ts`

Remove `TEMP(31)` and both `TODO(31)`. Keep the names; the export's success data becomes `{ url: string; expiresAt: string; partial: boolean; reused: boolean }`.

- `requestDataExport()`: the mock data source keeps the step 15 mock (now with a placeholder link); otherwise `exportData()`, mapping a failure to `copy.profile.errors.export`.
- `deleteAccount()`: the mock data source keeps the step 15 mock; otherwise decision 11, then `deleteAccount()` from the gateway. Success (or `UNAUTHORIZED`): `signOutCleanup()`, then `forgetUser(userId)`, and the answer `{ ok: true }`; Profile then signs out of Clerk. Failure: start again what was stopped, and answer `copy.profile.errors.delete`. Nothing is cleared on a failure.
- `signOutCleanup()` is unchanged.

### 6.3 `src/services/externalLinks.ts`

`openExportDownload(url)`: only an `https://` link, through `Linking.openURL`, answering `{ ok: true }` or `{ ok: false }` like the others.

### 6.4 Profile (copy and one button)

- The export dialog: unchanged until confirm; while it builds, the confirm button shows its spinner and both buttons are disabled (as now). The body's `TODO(31)` goes (the promise of a link is true).
- The success line under the Privacy & Account group (it replaces "Export requested."): "Your export is ready." with a plum text button **Download** (44 dp tall) that calls `openExportDownload`; if `partial`, a second line: "Some audio didn’t fit. The README in your download lists it." If the link cannot be opened, the step 15 line `copy.profile.errors.link` ("We couldn’t open that page."). The line clears with the other notices when the tab loses focus.
- After a successful deletion, `endSession(false)` ignores an error from `signOut()` (finding 11) and shows nothing.
- Copy keys under `copy.profile.privacy` (`exportReady`, `download`, `downloadLabel`, `exportPartial`); no new strings elsewhere. No other layout change.

### 6.5 `src/constants/app.ts`

`ACCOUNT_DELETION_URL` (decision 13).

### 6.6 Docs

`docs/legal-brief.md` and `docs/privacy-policy.md`: the export as built (one hour, one ZIP per person reused for 10 minutes and kept until the next export or the account's deletion, recordings before devotional audio, what is left out is listed) and the deletion as built (the order, retry, the final pass, the minute another device may still write, and that the store subscription is not cancelled). Keep every existing `TODO` for the lawyer.

---

## 7. Privacy and safety

- Nothing is deleted without a verified token **and** the confirm body.
- Every query and every storage path is the token's user's; another user's files and rows are untouched (a test proves it for both functions).
- Logs: decision 15 only. The app logs nothing about an export or a deletion beyond the gateway's name, status, code and time.
- The ZIP and its link never pass through anything but the private bucket and the person's own browser.
- Crisis entries: the export never labels them (section 3.4); deletion treats them like any other entry.

---

## 8. Verification

### Part A: automated

1. **Deno.**
   - `_shared/account`: `listAllFiles` (paging past 100, recursion into folders, an empty folder), `removeAll` (batches, a missing path); `collectUserData` (paging past 500, the user filter, affirmations nested); `clerk.ts` and `deleteSubscriber` (200, 404, 401 not retried, timeout, network).
   - `export-data`: auth, method, body ignored; the archive's files and names; JSON (every column, no `user_id`, the two file fields); Markdown (newest first, a crisis entry with no label, an unverified passage without text, the answered day in UTC for a profile in `Pacific/Kiritimati` and in `Pacific/Honolulu`); the cap (a test seam sets a small cap: recordings before devotionals, newest first, the README lists the rest, `partial`); the 120 s budget; the reuse within 10 minutes; the older export removed; the link's 3600 s and download name; a storage failure is 500; another user's data untouched; the log line.
   - `delete-account`: the confirm body; secrets checked before anything; Clerk's 404 at the start is a config error with nothing deleted; the order; each step's failure is `DELETE_INCOMPLETE` and a retry continues; 404s count as done; the final pass; another user untouched; the log line.
   - Every Deno command in AGENTS.md (check, lint, fmt, test) with the new folders.
2. **App-side: `supabase/tests/account/run.cjs` (new)**, on the journal-data world with a fake `export-data` and `delete-account`: the gateway calls and guards; `requestDataExport` mapping; `deleteAccount` stops the engine, the plan watch and the profile sync first, starts them again on a failure, and on success (and on `UNAUTHORIZED`) runs the cleanup and forgets the account; the mock data source unchanged; the dev log holds no link, id or word.
3. **Older suites keep their counts**; fake the new imports where they break (as earlier steps did).
4. **SQL:** PGlite with the three new variants (56 of 56, 30 variants).
5. **Parity:** one extra field on a server contract alone fails `npm run typecheck`, then restore.
6. **Exports** (one platform at a time): the bundles hold "Your export is ready." and `delete-account`, and no `TEMP(31)` or `TODO(31)`. The release gate prints 6 lines.
7. **Breakage smoke test**, in a scratch copy and never in the repo. At least these, each caught by a named check: the confirm check removed; the user id taken from the body; Clerk deleted before storage; a 404 from Clerk at the start treated as fine; the final pass made a failure; the export's cap ignored; devotionals added before recordings; the answered day read in the profile's zone; a crisis entry labelled; the reuse window removed; the older export not removed; the link valid for 24 hours; the app not stopping the engine before the deletion; the cleanup run after a failed deletion.

### Part B: the phone walk-through (iPhone, Expo Go)

**Before B0:**
- **Restart:** `npx expo start -c`, then force-quit and reopen Expo Go.
- **Account:** a **new** test account `gracehush31+clerk_test@example.com` (code `424242`), free.
- **Cost:** about 10 cents of Gemini and speech for B0's three reflections. Exports and deletions cost nothing.
- **Keep Expo Go in front.** Where a **Do** line lists several taps, the implementer gives them one at a time.

- **B0.** Do: sign in as the new account; make a written reflection, a short spoken one, and the made-up crisis sentence the earlier walk-throughs used; mark the written one as a prayer and then answered, with a short gratitude note. Expect: three entries, one answered prayer. Read: the app's own queries.
- **B1.** Do: Profile, Export Journal, Prepare export. Expect: the spinner, then "Your export is ready." with Download. Read: the gateway's last call (`export-data` 200), the answer's `partial` and `reused` (false), the line drawn.
- **B2.** Do: Download, then save the file in Safari and open it in Files. Expect: `gracehush-journal.zip` holding `README.txt`, `journal.json`, `journal.md` and two audio files (the recording and a devotional). Read: your screenshots of the file list and of `journal.md`'s crisis section (the date and the words only).
- **B3.** Do: tap Export Journal again within 10 minutes. Expect: ready within a few seconds. Read: `reused: true`.
- **B4.** Do: nothing. Expect: the link expires one hour after it was made, and the object is not readable without a signature. Read: `expiresAt`, and the app's own request to the object's public address (status only).
- **B5.** Do: in the SQL editor run the count query the implementer gives you (rows in the three tables, no ids), then Profile, Delete Account, Continue, Delete forever. Expect: no subscription warning (a free account), the spinner, then Sign In; the counts drop by this account's rows; its Storage folders are gone; Clerk's dashboard no longer lists the user. Read: the counts, your screenshots, and the function's log line (`account: delete:done`).
- **B6.** Do: sign in again with `gracehush31+clerk_test@example.com`. Expect: a new, empty account (no reflections, Free). Read: the app's own queries.
- **B7.** Do: sign out, sign in as `gracehush30b+clerk_test@example.com` (Pro from step 30, sandbox), then Profile, Delete Account. Expect: step 1 shows the subscription warning and Manage subscription; after Delete forever, Sign In; RevenueCat's dashboard no longer finds the customer; later webhook deliveries for it answer 200 as an unknown user. Read: the log lines.
- **B8.** Do: Profile, Data source (dev) `mock`, Fail next save (dev), then Delete Account to the end. Expect: the calm error inside the dialog and nothing cleared (still signed in); then Data source back to `supabase`. Read: the dev store and the session.

**Not checked on this target:** Android, and what a real App Store subscriber sees (step 35); Sign in with Apple (step 35).

---

## 9. AGENTS.md updates

- **Backend / Edge Function Rules:** the functions list gains `export-data` and `delete-account` (their codes and their log words); the secrets list gains `CLERK_SECRET_KEY`; a new **Account export and deletion** block holds decisions 3 to 11 and the known limit of finding 10.
- **Database Rules:** the `exports` bucket and its path layout, the fifth migration's note, the self-test count (56); remove "storage file deletion on account delete (step 31)" from "Still open".
- **Architecture tree:** `_shared/account/`, the two function folders, the gateway's two calls, `openExportDownload`, `ACCOUNT_DELETION_URL`, `supabase/tests/account/` and its count.
- **Screen Specifications, 7. Profile:** the export's success line and Download; the deletion's real path.
- **Before a store build:** the gate's new count (6), the account deletion web page, and Sign in with Apple revocation (step 35).
- **`TODO(V2)`:** a scheduled clean-up of old exports, and Clerk reverification before deletion.
- **The log:** a "Step 31" entry, with the phone walk-through results.

---

## 10. Report

- The five markers, and how each was closed.
- B1's limit and `EXPORT_MAX_BYTES`; the fflate decision.
- The Apple finding (decision 10) and what step 35 must add.
- The migration's checks; the files created, changed and deleted.
- Part A's numbers, red and green, and Part B's results.
- What was deployed; the placeholder URLs (`ACCOUNT_DELETION_URL` and the three from step 15).
- Every TODO left for steps 33, 34 and 35.
