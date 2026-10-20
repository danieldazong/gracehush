# 31-account-actions.md

Read AGENTS.md first and follow it strictly.

Make the Profile → Privacy & Data actions real. Add two Edge Functions:
export-data builds a ZIP of the user's journal (machine-readable JSON,
readable Markdown and their audio) and returns a 24-hour signed download
link; delete-account removes storage files, database rows, the
RevenueCat customer and the Clerk user in a safe, retryable order.
Replace the step 15 mocks in src/services/account.ts and add the legal
credits to Profile. The dialogs keep their step 15 look; only the export
success copy changes (section 7).

AGENTS.md requires approval before migrations, storage changes,
dependencies, new secrets and deploys. Ask where this prompt says ask.

Docs (source of truth, follow exactly):

- https://supabase.com/docs/reference/javascript/file-buckets-list
  (limit defaults to 100; paginate with offset)
- https://supabase.com/docs/reference/javascript/storage-from-remove
- https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://supabase.com/docs/guides/functions/limits
- https://clerk.com/docs/reference/backend/user/delete-user
  (Backend API DELETE https://api.clerk.com/v1/users/{user_id})
- https://clerk.com/docs/guides/configure/auth-strategies/social-connections/apple
- https://www.revenuecat.com/docs/api-v1/customers
  (DELETE /subscribers/{app_user_id})
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://support.google.com/googleplay/android-developer/answer/13327111
  (Play account deletion requirements)

---

## 1. Before writing code

1. Read src/services/account.ts (requestDataExport, deleteAccount,
   signOutCleanup, all // TEMP(31)), src/screens/ProfileScreen.tsx
   (Export and Delete dialogs, Legal section), src/constants/copy.ts
   (profile), src/constants/app.ts (URLs), src/lib/edgeFunctions.ts,
   supabase/functions/\_shared/ (auth, admin, errors, log,
   billing/revenuecat.ts), supabase/migrations/,
   assets/audio/ambient/LICENSES.md and src/types/supabase.ts.
2. List every // TEMP(31) and // TODO(31) in app and supabase/ with
   file:line (expect steps 15, 20, 29 and 30). Each is closed here or
   explained in the report.
3. Find the project's global file upload limit (Dashboard → Storage →
   Settings; the Free plan allows 50 MB per file). Ask the user to
   confirm it. EXPORT_MAX_BYTES = that limit minus 2 MB.
4. Ask: "Add npm:fflate to the export-data Edge Function to build ZIP
   files?" On no, build a JSON-only export (section 4, last rule) and
   say so in the report.
5. Ask the user to add CLERK*SECRET_KEY to the function secrets (server
   only). Never ask for it in chat, never print it, never put it in the
   app or any EXPO_PUBLIC* variable.
6. Sign in with Apple: read the Clerk Apple docs and check whether
   deleting a Clerk user revokes the user's Apple tokens (Apple requires
   revocation on account deletion). Report what you find with a link.
   If Clerk doesn't, stop and ask before going on.

---

## 2. Migration (approval gate)

Show the SQL and ask: "Add a private exports bucket?" Only on yes (step
18 process: local first, rls_test, second yes before pushing):

insert into storage.buckets (id, name, public, file_size_limit,
allowed_mime_types)
values ('exports', 'exports', false, <EXPORT_MAX_BYTES>,
array['application/zip', 'application/json'])
on conflict (id) do update set public = false,
file_size_limit = excluded.file_size_limit,
allowed_mime_types = excluded.allowed_mime_types;

- No storage.objects policies for exports (service role only; users get
  signed URLs).
- rls_test: authenticated can't list, read or upload in exports.
- Path layout (add to AGENTS.md): exports/{userId}/{exportId}.zip.

---

## 3. Shared helpers: \_shared/account/

storageFiles.ts:
listAllFiles(admin, bucket, prefix): Promise<string[]>
// paginate list(prefix, { limit: 100, offset }) until fewer than
// 100 come back; return full paths
removeAll(admin, bucket, paths): Promise<void>
// remove in batches of 100; already-missing files are fine

collectUserData.ts:
collectUserData(admin, userId): Promise<UserExport>

- Service role, every query .eq('user_id', userId) (profile:
  .eq('id', userId)).
- Profile: reminders, timezone, affirmation and ambient settings,
  subscription_tier, created_at. Never the email (it lives in Clerk;
  add it from the verified token's email claim only if present).
- Entries: every column except embedding, ordered by created_at.
  Replace audio_path and devotional_audio_path with the file names used
  in the ZIP (or null).
- Affirmations: every column, grouped under their entry.
- Paginate entries in pages of 500.

---

## 4. export-data Edge Function

supabase/functions/export-data/index.ts:

- POST, verifyClerkRequest; userId only from the token.
- Rate limit: list exports/{userId}/; if the newest file is under 10
  minutes old → 429 RATE_LIMITED.
- Build in memory with fflate (zipSync or the streaming Zip):
  README.txt what's included, the export date, the time zone, and
  which audio files were left out (if any)
  journal.json { exportedAt, schemaVersion: 1, profile, entries,
  affirmations }
  journal.md one section per entry, newest first: date (profile time
  zone), title, "What you shared" (transcript), scripture
  reference and verified text, devotional, closing prayer,
  prayer status, answered date and gratitude note,
  affirmations. Crisis entries show the date and
  transcript only, with no labels. Close the step 29
  // TODO(31).
  audio/recordings/{YYYY-MM-DD}-{entryId}.m4a (journal_media raw)
  audio/devotionals/{YYYY-MM-DD}-{entryId}.mp3 (journal_media
  devotionals)
- Size: add text files first, then audio newest first while the running
  total stays under EXPORT_MAX_BYTES. Anything left out is listed in
  README.txt and the response sets partial: true.
- Remove the user's older exports, then upload to
  exports/{userId}/{exportId}.zip (contentType application/zip,
  upsert false).
- createSignedUrl(path, 86400, { download: 'gracehush-journal.zip' }).
- Response 200: { url, expiresAt, partial, sizeBytes }.
- Time: check the Edge Function wall-clock and memory limits in the docs
  and report them. If total time reaches 80% of the limit, stop adding
  audio and finish as partial.
- Without fflate (section 1.4 = no): upload journal.json only
  (application/json), partial true, README text in a "readme" field.
- Errors: step 19 envelope. Storage failures → 500 INTERNAL.
- Logging: hashed user id, entry count, file count, bytes, partial, ms.
  Never content, paths or URLs.

---

## 5. delete-account Edge Function

supabase/functions/delete-account/index.ts:

- POST, verifyClerkRequest; userId only from the token.
- Body { confirm: 'DELETE' }. Anything else → 400 INVALID_REQUEST. (The
  two-step dialog sends it; this stops accidental calls.)
- Order (each step treats "not found" as done, so a retry continues
  safely):
  1. Storage: removeAll for journal_media {userId}/raw/,
     {userId}/devotionals/ and anything else under {userId}/; then
     exports/{userId}/.
  2. Database: delete users_profile where id = userId (step 18 cascades
     remove journal_entries and daily_affirmations). Confirm with a
     count query that none remain; if any do, delete them explicitly.
  3. RevenueCat: DELETE https://api.revenuecat.com/v1/subscribers/{id}
     with the secret API key (step 30). 404 → done. Close the step 30
     // TODO(31).
  4. Clerk: DELETE https://api.clerk.com/v1/users/{userId} with
     Authorization: Bearer CLERK_SECRET_KEY. 404 → done. This runs last
     so the user's token keeps working for retries until the end.
- Any step fails → stop and return 500 with code DELETE_INCOMPLETE (add
  it to the error map and client union, message "We couldn't finish
  deleting your account. Please try again."). Already finished steps
  stay done.
- Response 200: { deleted: true }.
- Logging: hashed user id and the outcome of each step. Never content.
- Never touch revenuecat_events (it has no user data).

config.toml for both functions: the same verify_jwt choice as
process-entry (step 19).

---

## 6. App wiring: src/services/account.ts

Remove // TEMP(31). Keep the step 15 signatures, extending the export
result type.

- requestDataExport() → callFunction('export-data', {}, { timeoutMs:
  150000 }) → { ok: true, data: { url, expiresAt, partial } }.
  RATE_LIMITED → "You can request another export in a few minutes."
- deleteAccount() → callFunction('delete-account', { confirm: 'DELETE'
  }, { timeoutMs: 60000 }).
  On success: signOutCleanup (steps 15, 24, 26, 27, 28, 30), then Clerk
  signOut() in try/catch (the user no longer exists; ignore errors).
  Then the step 15 navigation to SignIn.
  On failure: nothing is cleared; show the step 15 error.
- Add 'export-data' and 'delete-account' to the callFunction name
  union.

---

## 7. Profile changes (copy only, plus one button)

Export (step 15 dialog stays the same until confirm):

- While building: the confirm button shows a spinner; both buttons are
  disabled.
- Success inline state (replaces "Export requested. We'll let you know
  when it's ready."): "Your export is ready." plus a text button
  "Download" that opens the URL with Linking.openURL (the system browser
  saves the ZIP). If partial: an extra line "Some recordings didn't
  fit. The README in your download lists them." The link expires after
  24 hours; tapping Download after that requests a new export.
- Copy keys under profile.export in copy.ts.

Delete: no visual change. The pro/trial subscription warning from step
15 stays.

Legal section:

- Add "Scripture from the Berean Standard Bible (public domain),
  provided by the Free Use Bible API." (close the step 20 // TODO(31)).
- Show the ambient attribution lines from LICENSES.md if any license
  requires them (step 27). Plain DM Sans 12 mauve text.
- Add ACCOUNT_DELETION_URL to src/constants/app.ts. Use the user's real
  page; if unknown, 'https://example.com/TODO-delete-account' marked
  // TODO: real URL before release, and list it in the report. Not shown
  in the app; it goes in the Play Console Data safety form.

---

## 8. Release checklist (print it; the user does these)

- Play Console → Data safety: account deletion web URL
  (ACCOUNT_DELETION_URL), describing what is deleted.
- App Store Connect review notes: "Account deletion: Profile → Privacy
  & Data → Delete account."
- Apple token revocation: the outcome of section 1.6.
- The Privacy Policy describes the export and deletion.

---

## 9. Testing

Local (`npx supabase functions serve export-data delete-account`):

1. Export for a seeded user (5 text entries, 3 voice, 1 crisis, 2
   answered prayers): the ZIP has README, journal.json, journal.md and
   all audio; JSON has every column except embedding; Markdown reads
   well; the crisis entry shows only date and transcript.
2. Set EXPORT_MAX_BYTES to 1 MB locally: partial true, README lists the
   missing files, newest audio kept.
3. Second export within 10 minutes → 429. After that → the old ZIP is
   removed.
4. The signed URL downloads; an unsigned exports URL fails.
5. Delete: all storage under the user, profile, entries and
   affirmations gone; RevenueCat and Clerk calls made (use a test Clerk
   user and a sandbox RevenueCat customer).
6. Make step 3 fail (bad key, local only) → 500 DELETE_INCOMPLETE;
   storage and DB already gone; fix the key and retry with the same
   token → 200.
7. Another user's data is untouched after both functions.
   Device (dev build):
8. Export from Profile: spinner, "Your export is ready.", Download opens
   the ZIP.
9. Delete account (pro test user): the subscription warning, both
   steps, spinner, then SignIn. Signing in again with the same Apple or
   Google account creates a new empty account.
10. The step 15 failure path still clears nothing.

---

## 10. Deploy (approval gate)

Show test results, the Apple revocation finding and the size limit.
Ask: "Deploy export-data and delete-account?" Only on yes: the user sets
CLERK_SECRET_KEY, then `npx supabase functions deploy export-data` and
`npx supabase functions deploy delete-account`; re-run cases 1 and 5
against the hosted project with a test account.

---

## 11. AGENTS.md updates

- Account Rules: export = README + JSON + Markdown + audio, under
  EXPORT_MAX_BYTES, newest audio first, 24-hour signed link, one per 10
  minutes, older exports removed; deletion order storage → database →
  RevenueCat → Clerk, each step retryable; CLERK_SECRET_KEY server
  only; deleting doesn't cancel store subscriptions.
- Remove "storage file deletion on account delete" from Known Schema
  Gaps.
- // TODO(V2): scheduled cleanup of exports older than 7 days
  (pg_cron), and Clerk reverification before deletion.

---

## 12. Rules

- Only fflate is new (after approval). No `any`. No layout changes
  except the Download button and the copy above.
- Never log content, paths, URLs, keys or user ids.
- Never delete anything without the confirm body and a verified token.

Report: TEMP/TODO list and how each was closed; upload limit and
EXPORT_MAX_BYTES; fflate decision; Apple revocation finding; migration
decision; files created, changed, deleted; test results 1–10; whether
deployed; placeholder URLs; and every TODO left for steps 33 and 34.
