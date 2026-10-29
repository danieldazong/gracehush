# 29b-delete-reflection.md

Read AGENTS.md first and follow it strictly.

Let the person remove a prayer from the Prayers tab and delete a reflection for good. Every Active and every Answered prayer gets a ⋯ menu with two different actions: **Remove from Prayers** (the reflection stays in the Journal) and **Delete reflection…** (the reflection, its recording, its devotional audio and its affirmations are deleted for ever). The Reflection screen gets the same Delete. Deleting happens on the server, in a new Edge Function, because the app has no DELETE permission on purpose; a small server-only table keeps the free tier honest, so that deleting a devotional does not give back a free one.

**Status of this text.** It was written on 2026-10-28 from the code of steps 18 to 29 (read file by file, listed below). Nothing in it has been run: the SQL, the function and the app code are specified closely enough to build, and the implementer proves them (section 11), the way steps 21 and 22 were. Where this text gives code, it is the intended shape; where the real code disagrees, follow the real code and say so in the report.

Sources read when this was written: `AGENTS.md`; `supabase/functions/confirm-scripture/` (the pattern for a small service-role function), `_shared/` (`errors.ts`, `admin.ts`, `log.ts`, `limits/weekly.ts`, `limits/constants.ts`), `process-entry/` (`constants.ts`, `contracts.ts`, `lifecycle.ts`, `testing/fakes.ts`), `supabase/config.toml`; `supabase/migrations/20261022120100_gracehush_v1_schema.sql`, `supabase/tests/rls_selftest.sql` and `run-in-pglite.mjs`; in the app `PrayersScreen`, `PrayerCard`, `usePrayers`, `ReflectionScreen`, `useReflection`, `useJournalHome`, `journalRepository`, `entriesLive`, `db/cache`, `db/mutations`, `api/journalApi`, `playerStore`, `devotionalAudio`, `affirmationScheduler`, `syncEngine`, `ConfirmDialog`, `copy.ts`, the types and the test worlds in `supabase/tests/`.

---

## What was checked when this was written (these shaped the prompt)

1. **The app cannot delete, and must not.** Step 18 revoked everything and granted `journal_entries` SELECT plus UPDATE on five prayer columns, and `journal_media` has a select and an insert policy and no delete policy. Deleting needs the service role: a new Edge Function.
2. **A row delete does not remove files.** The recording (`{userId}/raw/{clientEntryId}.m4a`) and the devotional (`{userId}/devotionals/{entryId}.wav`, earlier test entries `.mp3`) live in Storage, and a SQL delete on a storage table is refused by the platform. The function removes them through the Storage API, first.
3. **Affirmations go with the entry** (`daily_affirmations_entry_user_fkey … on delete cascade`). The phone's cache needs one call for the same (`cache.removeEntry` already deletes both).
4. **Deleting would refund a free devotional.** `checkDevotionalLimit` (step 22) counts the reflections that exist. After a delete the count drops, so a free account could make three, delete them and make three more, at about 5 cents each. This is what the new table closes.
5. **Deploy order matters.** The new limit check reads the new table. A `process-entry` deployed before the migration makes every free account's reflection fail with a 500. A migration with nothing deployed is harmless. Section "What you do yourself" says the order.
6. **The Answered card's ⋯ is inside the card**, in the top-right corner (absolute, right 8, top 8, 44dp; the title has `pr-11`). It is not in the timeline row above the card. Active cards have no ⋯ yet, and their header row already holds the days chip beside the title.
7. **Step 14 ruled "crisis red is not used on this screen" and "no red option" in the overflow menu.** Nothing destructive existed then. This step needs an exception (decision 5).
8. **`mutations.removeMutation` needs a revision**, so it cannot drop "whatever is waiting for this entry". A new `dropMutation(entryId)` does.
9. **`useJournalHome` merges older pages by id**, so an entry deleted while older pages are loaded would stay on screen until a pull-to-refresh. Hooks need a "deleted" event (decision 9).
10. **The Deno test world knows three tables and no Storage delete** (`fakes.ts`). It needs the new table, a cascade, a delete that returns rows, a Storage `DELETE` and one-shot failures.
11. **The sync engine already copes with a change for a deleted entry** (step 29: an update that returns no row removes the entry from the cache), so a prayer change waiting on another phone is harmless.
12. **No new secret, package or native change.** `CLERK_ISSUER` is set; the platform provides the Supabase keys.

---

## What you do yourself (read this first)

### Keys and settings: nothing new (checked by names only)

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set. Nothing added. |
| `supabase/functions/.env.local` | `CLERK_ISSUER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE` | all set. `delete-entry` needs only `CLERK_ISSUER` (set) and the keys the platform provides. **Do not run `secrets set` for this step.** |

### A. The order of work

1. The implementer builds and proves everything offline (section 11, Part A). Creating the migration file is approved by your "Implement it." (decision 4).
2. **Step 1 below: you apply the migration** in the Supabase SQL editor and run the self-test. Only then:
3. **Step 2 below: you deploy** `process-entry` and then `delete-entry`. The implementer asks you first.
4. The implementer asks whether to start the phone walk-through (Part B).

### B. Step 1: apply the migration (you, in the browser)

1. In VS Code open `supabase/migrations/20261028150000_deleted_devotionals.sql`. Press **Ctrl+A**, then **Ctrl+C**.
2. Open the Supabase dashboard, your `gracehush` project, the left menu **SQL Editor**, **New query**. Paste. Press **Run**.
3. Expect **Success. No rows returned.** This file has no `drop`, so no "destructive operations" warning should appear.
4. Run the self-test: open `supabase/tests/rls_selftest.sql`, **Ctrl+A**, **Ctrl+C**, then in the SQL editor **New query** and paste. Go to the very end of the pasted text, add a blank line and paste this line:
   `select count(*) as checks, count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from rls_results;`
   Press **Run**. A dialog "Potential issues detected" (it is the self-test's temporary table) is answered with **Run without RLS**. Expect **checks 50, passed 50, failed 0**. Send a screenshot.
5. Run `supabase/selftest.sql` the same way (without the extra line): it must still show 11 of 11 passed.
6. Optional but recommended (two minutes): regenerate the types (Integrations, Data API, Docs, **Generate and download types**), replace `src/types/supabase.ts` with the download and tell the implementer. The diff must show one new table and nothing else. The app never uses the table; this only keeps the file equal to the database (AGENTS.md, Database Rules).

### C. Step 2: deploy (you, in the terminal, after the implementer asks)

Run the two commands in this order, from the repo folder, in Git Bash:

```bash
npx --yes supabase@2.121.0 functions deploy process-entry --project-ref <project-ref> --use-api
npx --yes supabase@2.121.0 functions deploy delete-entry --project-ref <project-ref> --use-api
```

(`<project-ref>` is the one you used for the earlier deploys; it is also the first part of your Supabase URL.) Never deploy `process-entry` before Step 1: see finding 5. The implementer then sends four requests without a sign-in to `delete-entry` and expects 401, 401, 405 and 204, to prove `verify_jwt = false` was honoured.

To switch deleting off again without touching the app: Dashboard, **Edge Functions**, `delete-entry`, delete it. The app then shows its calm "We couldn’t delete this reflection" line. `process-entry` keeps working with the new table present.

### D. Phone walk-through (iPhone, Expo Go)

When the implementer has finished and its checks pass, it asks whether to start this walk-through (AGENTS.md, "Guided phone walk-through"). Before B0: **restart Metro** with `npx expo start -c` (new files and new strings), then force-quit and reopen Expo Go. **Keep Expo Go open and in front** for the whole run (the implementer can read nothing while it is in the background).

Where a **Do** line lists several taps, the implementer gives them to you one at a time and checks between them. Account and data: B0 to B13 use the test account `gracehush17b+clerk_test@example.com` (code `424242`, plan `pro`). B14 to B16 use a **second, new** test account `gracehush29b+clerk_test@example.com` (code `424242`, plan `free` by default). The walk-through makes **four disposable reflections** on the first account and **three** on the second, and one more that the free limit refuses: about 40 US cents of Gemini and speech in all. It deletes only what it made. Your SQL steps use your Clerk user id (the one in the Table Editor, `users_profile`, column `id`): write it as `<user id>` below.

**B0. Start**
- **Do:** sign in as the first test account, open Profile, scroll to the developer panel and press its Supabase check button.
- **Expect:** keys yes, data source supabase, signed in, role authenticated, profile row found, last error none.
- **Read:** the data source, `isDatabaseOpen()`, `selectCanSend(useOfflineStore.getState())` (true), the plan (`pro`; if it is `free`, say so and set it to `pro` in the Table Editor), `getAffirmationScheduleSummary()` and the first 8 characters of `readAffirmationSource()`'s entry id (the baseline for B13).

**B1. Four disposable reflections**
- **Do:** make four reflections one after another and wait for each to open, then go back: (1) pen, write `Disposable one. I felt tired today but a quiet walk helped me breathe.`; (2) pen, write `Disposable two. I am thankful for a calm morning and a good talk.`; (3) mic, speak for about 10 seconds: `Disposable three. I am hoping for good news about my family.`; (4) pen, write `Disposable four. I want to remember how peaceful this evening felt.`
- **Expect:** four new cards on Journal. In each reflection **Mark as Prayer Request** is on (the model usually turns it on; if one is off, turn it on). Prayers, Active lists all four.
- **Read:** `listPrayers()` holds the four ids (first 8 characters); `selectEntry(id)` for each: `processing_status` ready, `is_active_prayer` true; the third has an `audio_path`.

**B2. The menu on an Active prayer**
- **Do:** Prayers, Active, tap the ⋯ in the corner of the "Disposable one" card.
- **Expect (seen):** the app's own blush sheet (rounded top corners, a small handle) with the prayer's title in muted text above one white card that holds the rows: **Remove from Prayers** (plum icon in a soft circle) and, after a thin line, **Delete reflection…** (Crisis Red icon in a pink-tinted circle, Crisis Red text), each row's icon and label centered in the card as one group, the two icons exactly one above the other and the two labels starting at the same edge. No "Edit gratitude note", no "Move back to Active" and no Cancel row (a tap outside the sheet closes it). The only red on the screen is that row. It is not iOS's native action sheet: that one drew system blue and red, and was replaced in the follow-up of 2026-10-28. (Send a screenshot.)
- **Read:** ask for the screenshot.

**B3. Remove from Prayers (Active)**
- **Do:** choose **Remove from Prayers**.
- **Expect:** the card disappears at once; a banner "Removed from Prayers. It’s still in your Journal."; the Active count is one lower; Journal still lists the reflection.
- **Read:** `listPrayers()` no longer holds the id; `readCachedEntry(id)` exists with `prayer === null`; within 10 seconds `countPendingPrayerChanges()` is 0 and `selectEntry(id)` has `is_active_prayer` false and `is_answered` false.

**B4. Put it back**
- **Do:** Journal, open "Disposable one", turn **Mark as Prayer Request** on, go back.
- **Expect:** Prayers, Active has it again.
- **Read:** `listPrayers()` holds the id.

**B5. The menu on an Answered prayer**
- **Do:** Prayers, Active, tap **Mark Answered** on "Disposable two", keep today, type `Thank you.`, press **Save Answered Prayer**, tap **View in Answered**, then tap the ⋯ on that card.
- **Expect (seen):** the same blush sheet and white card with **Edit gratitude note**, **Move back to Active**, **Remove from Prayers** and, after the thin line, **Delete reflection…** (red). (Send a screenshot.) Then choose **Edit gratitude note**: the Mark Answered sheet must open right after the menu has closed (this is the iOS handoff from one Modal to the next; if nothing opens, say so), and close it with the X.
- **Read:** `selectEntry(id)`: `is_answered` true, `answered_notes` is the 10-character note (length only), the screenshot.

**B6. Remove an Answered prayer**
- **Do:** choose **Remove from Prayers**, then **Remove** in the dialog.
- **Expect (seen):** the dialog "Remove this from Prayers?" says the answered date and note will be removed and that the reflection stays in the Journal. After **Remove** the card is gone, Answered is one lower, and Journal still lists the reflection.
- **Read:** `listPrayers()`; within 10 seconds `selectEntry(id)`: `is_active_prayer` false, `is_answered` false, `answered_at` null, `answered_notes` null.

**B7. Delete asks first**
- **Do:** Active, ⋯ on "Disposable one", **Delete reflection…**, then **Keep**.
- **Expect (seen):** a dialog "Delete this reflection forever?" with a red **Delete forever** and **Keep**, which appears right after the menu has closed. Keep closes it and nothing changes. The only red on the screen is the button. (Send a screenshot of the dialog.)
- **Read:** `selectEntry(id)` still has the row; the screenshot.

**B8. Delete an Active prayer**
- **Do:** ⋯ on "Disposable one", **Delete reflection…**, **Delete forever**.
- **Expect:** a spinner in the dialog, then the card is gone; the banner "Reflection deleted."; Journal no longer lists it. Then run this in the SQL editor, with the first 8 characters of the id the implementer gives you, and send the result:
  `select (select count(*) from public.journal_entries where id::text like '<first 8>%') as entries, (select count(*) from public.daily_affirmations where entry_id::text like '<first 8>%') as affirmations, (select count(*) from storage.objects where bucket_id = 'journal_media' and name like '<user id>/%<first 8>%') as files, (select count(*) from public.deleted_devotionals where entry_id::text like '<first 8>%') as records;`
- **Expect:** `entries 0, affirmations 0, files 0, records 1`.
- **Read:** `selectEntry(id)` is null; `readCachedEntry(id)` is null; `readCachedAffirmations(id)` is empty; the SQL result.

**B9. Delete a reflection that is playing**
- **Do:** Journal, open "Disposable three" (the voice one), press play on its player card, go back to Prayers (the sound goes on), tap the ⋯ on its card, **Delete reflection…**, **Delete forever**. (Before pressing Delete forever, run `select name from storage.objects where bucket_id = 'journal_media' and name like '<user id>/%' order by created_at desc limit 4;` and send the result; run it again afterwards.)
- **Expect:** the sound stops at once; Control Center no longer shows the Gracehush tile (seen); the two files of that reflection (`raw/….m4a` and `devotionals/….wav`) are in the first list and not in the second.
- **Read:** `usePlayerStore.getState()`: `entryId` null and `status` `idle`; the list of the `devotionals` folder (names, first 8 characters) has no file for the id; `selectEntry(id)` null.

**B10. Deleting needs a connection**
- **Do:** turn on Airplane mode (Expo Go stays open), tap the ⋯ on the "Disposable four" card (make sure it is in Active: open its reflection and turn **Mark as Prayer Request** on first if it is not), **Delete reflection…**.
- **Expect:** no dialog; the banner "Connect to the internet to delete a reflection."; nothing changed.
- **Read:** no request to `delete-entry` was made (`getLastFunctionCall()` is still the earlier delete); `selectCanSend(...)` false.

**B11. Removing works offline and syncs**
- **Do:** still offline, tap the ⋯ on "Disposable four" and choose **Remove from Prayers**; then turn Airplane mode off.
- **Expect:** the card disappears; while offline the line "Changes will sync when you’re back online." shows, and it goes within about 10 seconds of reconnecting.
- **Read:** `countPendingPrayerChanges()` is 1 offline and 0 after reconnecting; `selectEntry(id)` then has `is_active_prayer` false.

**B12. Put it back from the Reflection screen**
- **Do:** Journal, open "Disposable four", turn **Mark as Prayer Request** on, scroll to the bottom and look at the end of the page.
- **Expect (seen):** a quiet **Delete reflection** link under the "Return to Journal" button, in the calm muted colour (not red). (Send a screenshot of the bottom of the page.)
- **Read:** `listPrayers()` holds the id; the screenshot.

**B13. Delete from the Reflection screen, and the notifications follow**
- **Do:** tap **Delete reflection** and then **Delete forever**.
- **Expect:** the screen closes to where you came from; Journal no longer lists it; the affirmation card now shows an earlier reflection’s affirmation.
- **Read:** before the tap, `readAffirmationSource()`'s entry id (8 characters) is "Disposable four"’s; a few seconds after, `getAffirmationScheduleSummary().count` is 1 or more and `readAffirmationSource()` is the newest earlier reflection (not "Disposable four"); `selectEntry(id)` null; the SQL of B8 (records 1).

**B14. Three reflections on a free account**
- **Do:** Profile, **Sign Out**, confirm. Sign in as `gracehush29b+clerk_test@example.com` (code `424242`). Write three reflections one after another: `Free test one: a quiet moment.`, `Free test two: a quiet moment.`, `Free test three: a quiet moment.`
- **Expect:** all three become reflections; Profile says "3 of 3 audio devotionals used this week".
- **Read:** the plan is `free`; `getUsage()` reads 3 of 3; three `ready` rows.

**B15. Delete one of them**
- **Do:** open "Free test one", scroll down, **Delete reflection**, **Delete forever**.
- **Expect:** it is deleted. Profile now reads "2 of 3 used" (the phone’s own count; see the known limit in section 11).
- **Read:** `selectEntry(id)` null; the SQL `select count(*) from public.deleted_devotionals where user_id = '<user id of the second account>';` returns 1.

**B16. The free limit is not refunded**
- **Do:** tap the pen, write `Free test four: another quiet moment.` and press **Submit Reflection**.
- **Expect:** the Paywall opens with "You’ve used your 3 free devotionals this week." and "Your reflection is saved." although Profile said 2 of 3 a moment ago.
- **Read:** `getLastFunctionCall()` is `process-entry`, status 402, code `LIMIT_REACHED`; no devotional was made (the server row is `failed` with `LIMIT_REACHED`).

**B17. The mock data (optional, development only)**
- **Do:** sign back in as the first account; Profile, developer panel, set **Data source (dev)** to mock; Prayers, ⋯ on a sample prayer, **Delete reflection…**, **Delete forever**; then press **Fail next save (dev)** and repeat on another.
- **Expect:** the first sample prayer disappears; the second attempt shows "We couldn’t delete this reflection. Please try again." inside the dialog, and the dialog’s button works the next time. Set the data source back to supabase.
- **Read:** `getMockDb().entries` count (down by one); the data source.

**Clean-up (optional, SQL in the editor):** to remove the second test account and everything of it: `delete from public.users_profile where id = '<user id of the second account>';` (its reflections, affirmations and records go with it; its files in Storage do not, so delete that folder in **Storage, journal_media** by hand). On the first account only "Disposable two" remains; delete it from its reflection if you like.

**Not part of this walk-through, and why:** another phone seeing the deletion (step 33, Realtime, and you have one iPhone); Android; VoiceOver; the lock-screen card (Expo Go shows the card only in Control Center, which B9 uses); a speech retry that finishes after a delete (known limit, section 11).

### E. If something goes wrong: what it means

| what you see | what it means |
| --- | --- |
| Every reflection of a free account fails with "Something went wrong" right after Step 2 | `process-entry` was deployed before the migration. Apply Step 1; nothing needs redeploying. |
| "We couldn’t delete this reflection. Please try again." | `delete-entry` is not deployed, or it failed. The implementer reads `getLastFunctionCall()` (a 404 with no code means "not deployed"; a 500 means a Storage or database failure). Trying again is safe. |
| The reflection is gone from the list but still plays | The phone kept the downloaded file: the cleanup failed. Force-quit and reopen Expo Go; the next sign-out deletes the folder. Tell the implementer. |
| Profile says 2 of 3, the Paywall says 3 | Intended (known limit): the phone counts the reflections it holds, the server also counts the deleted one. |
| The deleted reflection is still on another phone | Until step 33 (Realtime) it disappears there on the next refresh. |

---

## Decisions (approved with this prompt by your "Implement your professional recommendation", 2026-10-28: strike any you disagree with)

1. **Two actions, not one "Delete".** In this app a prayer is a flag on a reflection (`is_active_prayer`), so "delete this prayer" is ambiguous. **Remove from Prayers** clears the flags (an answered date and gratitude note go with them) and keeps the reflection; **Delete reflection…** deletes the reflection for good. Both are in the ⋯ menu of every Active and Answered prayer, and Delete is also on the Reflection screen. A separate prayers table is not built (it would mean migrating the change queue, the cache and the function contract for no visible gain).
2. **Delete runs on the server, in a new Edge Function `delete-entry`** (service role, `verify_jwt = false`, the Clerk token checked by `_shared/auth.ts`). The app keeps no DELETE grant and Storage keeps no delete policy.
3. **Online only in V1.** An irreversible delete is confirmed by the server before the card disappears; nothing is queued for later. Offline, Delete says so and does nothing; Remove from Prayers still works offline (the step 29 queue).
4. **A server-only table `deleted_devotionals` keeps the free week honest.** This refines the recommendation message, which had a ledger of every devotional written at creation: this table holds only devotionals that were **deleted**, written by `delete-entry` just before it deletes the reflection, and `checkDevotionalLimit` counts it with the reflections that exist. The effect for people is the same, there is no backfill and no deploy-order trap for existing data, and the verified creation path of `process-entry` is not touched. It holds an opaque id, the owner and two times; no app role can read it; it goes with the account; rows older than 14 days are removed by the next delete of that person. **The migration file is created by the implementer (approved here); you apply it (Step 1); deploying is separate and asked first.**
5. **Crisis red on the Prayers tab, for the destructive action only:** the Delete row in the menu (the app’s sheet draws its icon and label in Crisis Red on both platforms; the iPhone’s native action sheet was tried first and replaced because it draws system red and blue) and the dialog’s confirm button. This replaces the step 14 ruling "crisis red is not used on this screen / no red option". Nothing else on Prayers or Reflection is red.
6. **Scope:** Prayers (Active and Answered) and Reflection. Journal cards get no delete now, and a crisis entry cannot be deleted from the app (crisis handling: ask first).
7. **Remove from Prayers confirms only for an Answered prayer** (it destroys the gratitude note), with the wording Reflection already uses plus "The reflection stays in your Journal." For an Active prayer nothing is lost but a flag, so it acts at once. Delete always confirms.
8. **No swipe, no undo, no "Recently deleted".** Swipe needs gesture-handler (not approved), is invisible to screen readers and fought touches in iOS modals before; undo and a trash folder would keep private prayers after the person said delete. No haptic (AGENTS.md lists the only haptic moments).
9. **After a delete the phone forgets every copy, in this order:** the server answers first; then the cache entry and its affirmations and any waiting prayer change go (`forgetEntry`); the player stops if that devotional is loaded (sound, lock screen, ambient bed); its downloaded file is deleted; the lists on screen drop it through a new `deleted` event of the sync engine; the affirmation notifications are planned again (when it was the newest reflection they come from the one before, or stop). A failure of any local step never turns the server’s success into an error.
10. **Order on the server: files, then the record, then the row,** each step treating "already done" as done, so a request sent again after a failure continues. A reflection that is already gone answers `NOT_FOUND`, and the app counts that as deleted.
11. **No rate limit:** a delete is bounded by the person’s own reflections.
12. **Nothing is installed.** No package, no `app.json` entry, no secret.

## Out of scope

Delete on Journal cards; deleting crisis entries from the app; undo or a trash folder; deleting while offline (a queued tombstone); deleting many at once; a scheduled job that sweeps old records or orphan files (a speech retry that finishes after a delete can leave one orphan file: known limit); showing the server’s week count on Profile (known limit); Realtime (step 33); analytics (step 34, markers only).

---

## 0. Before you write code

1. Read AGENTS.md: Prayer Rules, Backend / Edge Function Rules (requirement 10 and the log rules), Database Rules, Journal Data Rules, Local Cache & Offline Rules, Audio Rules (Playback), Notification Rules, Crisis Safety Rules, the Prayers and Reflection specifications, the Standing Rulings and the Haptics paragraph. Read the files listed at the top.
2. Confirm from the real files and write down: the `daily_affirmations` foreign key cascades; `journal_media` has no delete policy and the app has no DELETE on `journal_entries`; `cache.removeEntry` deletes the entry and its affirmations; `ConfirmDialog` has `tone="destructive"`, `icon`, `loading` and `children`; `RepoResult` failure codes; the current `SyncEvent` union; `FunctionName` has two names.
3. **Baseline, before any change** (all must pass; write the numbers down): `npm run typecheck`, `npm run lint`; `node --no-warnings supabase/tests/{offline,journal-data,prayers,notifications,playback,ambient}/run.cjs` and `recording`, `profile-sync` (offline 44, journal-data 87, prayers 32, notifications 48, playback 133, ambient 64, recording 68, profile-sync 88); `node supabase/tests/process-entry/parity.cjs` (7 of 7); the Deno commands of AGENTS.md (348 tests).
4. **Line endings:** before editing a file count its carriage returns (`tr -cd '\r' < file | wc -c`) and keep them; the edit tool may not match multi-line blocks in a CRLF file (use a small Node script that matches LF text and writes CRLF back).
5. Do not edit files while the walk-through runs (Fast Refresh resets the app’s state).

---

## 1. The migration, its self-test and the offline runner

### 1.1 `supabase/migrations/20261028150000_deleted_devotionals.sql` (new)

```sql
-- Gracehush: the record of deleted devotionals (step 29b).
--
-- The free tier counts the devotionals a person made this week (step 22). It counted the reflections that exist, so deleting
-- one gave its slot back: a free account could make three, delete them and make three more, at about 5 cents of speech and
-- AI each. The delete-entry Edge Function writes one row here for a reflection that counted (a devotional that is not a
-- crisis entry) BEFORE it deletes the reflection, and the limit check counts these rows together with the reflections that
-- exist.
--
-- A row holds the reflection's id, its owner and the time it was made, and nothing the person wrote. No app role can touch
-- the table (no grant and no policy): only the Edge Functions (service_role) read and write it. There is deliberately no
-- foreign key to journal_entries, so a row outlives the reflection it came from; it follows the account instead (deleting a
-- profile removes its rows). A row older than 14 days can never fall inside a week, and delete-entry removes those.
--
-- It is safe to run again, and it deletes no data.
create table if not exists public.deleted_devotionals (
  entry_id   uuid        primary key,
  user_id    text        not null references public.users_profile (id) on delete cascade,
  made_at    timestamptz not null,
  deleted_at timestamptz not null default now()
);

create index if not exists deleted_devotionals_user_made_idx
  on public.deleted_devotionals (user_id, made_at desc);

alter table public.deleted_devotionals enable row level security;

-- Nobody signed in, and no signed-in user, can read or write it. service_role bypasses row level security but not grants.
revoke all on public.deleted_devotionals from anon, authenticated;
grant select, insert, update, delete on public.deleted_devotionals to service_role;

notify pgrst, 'reload schema';
```

The project was created with "Automatically expose new tables" OFF, so the `service_role` grant is explicit; the `revoke` makes the table end in the same safe state when the option is ON (the older default).

### 1.2 `supabase/tests/rls_selftest.sql`: checks 47 to 50

Add them after check 46 and before the clean-up line. They use the file’s own `pg_temp.try_as` and the fixtures `selftest_a`, `claims_a`, `no_claims`, `n1`, `n2`.

```sql
  -- ===== the record of deleted devotionals (step 29b) =====
  insert into rls_results values (47, 'the app cannot read or write the record of deleted devotionals',
    pg_temp.try_as('authenticated', claims_a, null, 'select * from public.deleted_devotionals') = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null,
      $q$update public.deleted_devotionals set made_at = now()$q$) = '42501'
    and pg_temp.try_as('authenticated', claims_a, null, 'delete from public.deleted_devotionals') = '42501'
    and pg_temp.try_as('anon', no_claims, null, 'select * from public.deleted_devotionals') = '42501'
    and pg_temp.try_as('anon', no_claims, null,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$) = '42501');

  insert into rls_results values (48, 'the server records a deleted devotional once, for a user that exists',
    pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$) = 'ok:1'
    and pg_temp.try_as('service_role', no_claims,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d1', 'selftest_a', now())$q$) = '23505'
    and pg_temp.try_as('service_role', no_claims, null,
      $q$insert into public.deleted_devotionals (entry_id, user_id, made_at)
         values ('a0000000-0000-4000-8000-0000000000d2', 'selftest_nobody', now())$q$) = '23503');

  -- A record outlives its reflection and goes with its account (the same pattern as check 32).
  insert into public.users_profile (id) values ('selftest_d');
  insert into public.journal_entries (id, user_id, client_entry_id, input_type, processing_status)
  values ('d0000000-0000-4000-8000-000000000001', 'selftest_d', 'cd000000-0000-4000-8000-000000000001', 'text', 'ready');
  insert into public.deleted_devotionals (entry_id, user_id, made_at)
  values ('d0000000-0000-4000-8000-000000000001', 'selftest_d', now());
  delete from public.journal_entries where id = 'd0000000-0000-4000-8000-000000000001';
  select count(*) into n1 from public.deleted_devotionals where entry_id = 'd0000000-0000-4000-8000-000000000001';
  delete from public.users_profile where id = 'selftest_d';
  select count(*) into n2 from public.deleted_devotionals where user_id = 'selftest_d';
  insert into rls_results values (49, 'a record outlives its reflection and goes with its account', n1 = 1 and n2 = 0);

  insert into rls_results values (50, 'the record is closed by row level security as well as by grants',
    exists (select 1 from pg_class where oid = 'public.deleted_devotionals'::regclass and relrowsecurity)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'deleted_devotionals'));
```

Adjust the fixture inserts to the columns the table really requires (the v1 migration has the list); the intent is fixed. The file makes 50 checks in all; nothing else in it counts them.

### 1.3 `supabase/tests/run-in-pglite.mjs`

- `const DELETED = migrations.find((name) => name.includes("deleted_devotionals"));`
- The "rows left behind" query gets `(select count(*) from public.deleted_devotionals)::int as deleted_devotionals`.
- Broken variants (the sixth element is the migration file, as the WAV variant does):

```js
["the app may read the record (grant and policy)", "off", (sql) => sql + "\ngrant select on public.deleted_devotionals to authenticated;\ncreate policy deleted_devotionals_read_all on public.deleted_devotionals for select to authenticated using (true);", [47, 50], DELETED],
["ON: the new table keeps the API roles' default grants", "on", dropLine("revoke all on public.deleted_devotionals from anon, authenticated;"), [47], DELETED],
["row level security off on the record", "off", (sql) => sql.replace("enable row level security", "disable row level security"), [50], DELETED],
["no primary key on entry_id", "off", (sql) => sql.replace("uuid        primary key,", "uuid        not null,"), [48], DELETED],
["the record is tied to the reflection (it would vanish with it)", "off", (sql) => sql + "\nalter table public.deleted_devotionals add constraint deleted_devotionals_entry_fkey foreign key (entry_id) references public.journal_entries (id) on delete cascade;", [48, 49], DELETED],
["the record does not follow the account", "off", (sql) => sql.replace("references public.users_profile (id) on delete cascade", "references public.users_profile (id)"), [49], DELETED],
```

`supabase/tests/preflight.sql` gets one read-only row: the table exists, row level security is on, and `anon` and `authenticated` hold no privilege on it.

---

## 2. The limit counts deleted devotionals (`supabase/functions/_shared/limits/weekly.ts`)

In `checkDevotionalLimit` add a third question to the `Promise.all` and add its count:

```ts
  // Asked together: one round trip to a database that is far from the function, not three.
  const [made, inFlight, deleted] = await Promise.all([
    /* the two existing queries, unchanged */,
    // Devotionals this person made this week and deleted afterwards (delete-entry writes the row before it deletes the
    // reflection). Server-only table: no app role can read it.
    admin.from("deleted_devotionals").select("entry_id", { count: "exact", head: true })
      .eq("user_id", userId).gte("made_at", since),
  ]);
  if (made.error) throw dbFailure("limit_made", made.error);
  if (inFlight.error) throw dbFailure("limit_in_flight", inFlight.error);
  if (deleted.error) throw dbFailure("limit_deleted", deleted.error);
  …
  const used = (made.count ?? 0) + (deleted.count ?? 0) + startedFirst;
```

Update the comment block above the function: add `deleted   this user's records of devotionals made from this week's start and deleted afterwards: a devotional counts for the week it was made in, whether or not the reflection still exists`. A trial or Pro account still makes no query (the early `exempt` return). Known limit to write in the comment: between the record being written and the reflection being deleted (a few milliseconds, or until a failed delete is retried and its rollback also failed) one devotional is counted twice; that can only make the limit stricter for a moment.

---

## 3. The `delete-entry` function (`supabase/functions/delete-entry/`)

Files: `index.ts` (the same four lines as `confirm-scripture/index.ts`), `deno.json` (the same two pins as `confirm-scripture/deno.json`), `handler.ts`, `lifecycle.ts`, `handler_test.ts`, `lifecycle_test.ts`. Add to `supabase/config.toml`:

```toml
[functions.delete-entry]
# The same Clerk session token, checked the same way (_shared/auth.ts), so the same setting.
verify_jwt = false
```

### 3.1 `_shared/log.ts`

Add `blankLogLine` (a third function now writes the allow-list, so a line with every field empty is shared; do not change `process-entry` or `confirm-scripture`):

```ts
// A log line with every field empty, for a function that has only a few to say. The LogLine type above is the allow-list: a
// field that is not in it cannot be logged.
export function blankLogLine(fields: Pick<LogLine, "requestId" | "status"> & Partial<LogLine>): LogLine {
  return {
    requestId: fields.requestId, status: fields.status, code: null, reason: null, inputType: null, user: null,
    authMs: 0, dbMs: 0, geminiMs: 0, totalMs: 0, attempts: 0, fallbackAttempts: 0, model: null, promptVersion: null,
    tokensIn: null, tokensOut: null, tokensThought: null, scripture: null, bibleMs: 0, screen: null, screenMs: 0,
    screenAttempts: 0, crisisSource: null, tts: null, ttsMs: 0, ttsAttempts: 0, ttsChars: 0, audioMs: null,
    limit: null, limitUsed: null, ...fields,
  };
}
```

Also update the comment at the top of `_shared/errors.ts`: `delete-entry` answers `NOT_FOUND` and `ALREADY_PROCESSING` as well. The messages in `MESSAGE_BY_CODE` already fit.

### 3.2 `lifecycle.ts`

Every query filters by the verified user id; the service role bypasses row level security.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../_shared/errors.ts";
import { dbFailure } from "../process-entry/lifecycle.ts";

const BUCKET = "journal_media";
// A record older than this can never fall inside a week (a week is at most 7 days, plus a day of daylight saving).
export const RECORD_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

export type EntryToDelete = {
  id: string;
  client_entry_id: string | null;
  created_at: string;
  updated_at: string;
  processing_status: string;
  audio_path: string | null;
  devotional_audio_path: string | null;
  // The free tier counted this one: not a crisis entry, and it holds a devotional (checkDevotionalLimit's own rule).
  counted: boolean;
};

export async function findEntryToDelete(admin: SupabaseClient, userId: string, entryId: string): Promise<EntryToDelete | null> {
  const { data, error } = await admin.from("journal_entries")
    .select("id, client_entry_id, created_at, updated_at, processing_status, is_crisis, audio_path, devotional_audio_path, devotional_script")
    .eq("user_id", userId).eq("id", entryId).maybeSingle();
  if (error) throw dbFailure("find_to_delete", error);
  if (data === null) return null;
  // devotional_script is read only to know whether it is there; it is never kept, logged or returned.
  const row = data as Omit<EntryToDelete, "counted"> & { is_crisis: boolean; devotional_script: string | null };
  const { is_crisis: isCrisis, devotional_script: script, ...rest } = row;
  return { ...rest, counted: !isCrisis && script !== null };
}

// What Storage holds for this reflection: what its columns say, plus the two names the functions give (so a file whose path
// was never saved is removed too). Only paths inside the person's own folder are ever removed, whatever a column holds.
export function deletableFiles(userId: string, entry: EntryToDelete): string[] {
  const own = `${userId}/`;
  const names = [
    entry.audio_path,
    entry.devotional_audio_path,
    entry.client_entry_id === null ? null : `${own}raw/${entry.client_entry_id}.m4a`,
    `${own}devotionals/${entry.id}.wav`,
  ];
  const safe = names.filter((name): name is string => typeof name === "string" && name.startsWith(own) && !name.includes(".."));
  return [...new Set(safe)];
}

// A path that is not there is not an error: Storage answers with the objects it removed. The reason is ours, never the provider's words.
export async function removeFiles(admin: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(BUCKET).remove(paths);
  if (error) throw new AppError("INTERNAL", "storage_remove_failed");
}

export async function recordDeletedDevotional(admin: SupabaseClient, userId: string, entry: EntryToDelete): Promise<void> {
  const { error } = await admin.from("deleted_devotionals").upsert(
    { entry_id: entry.id, user_id: userId, made_at: entry.created_at },
    { onConflict: "entry_id", ignoreDuplicates: true },
  );
  if (error) throw dbFailure("record_deleted", error);
}

// Best effort: the reflection is still there, so its devotional must not count twice while it waits for the retry.
export async function forgetDeletedDevotional(admin: SupabaseClient, userId: string, entryId: string): Promise<void> {
  try {
    await admin.from("deleted_devotionals").delete().eq("entry_id", entryId).eq("user_id", userId);
  } catch { /* the retry settles it */ }
}

// The affirmations go with the row (foreign key, on delete cascade). How many rows went: 0 means another request got there first.
export async function deleteEntryRow(admin: SupabaseClient, userId: string, entryId: string): Promise<number> {
  const { data, error } = await admin.from("journal_entries").delete().eq("id", entryId).eq("user_id", userId).select("id");
  if (error) throw dbFailure("delete_entry", error);
  return (data as { id: string }[]).length;
}

// Housekeeping: this person's records that can never matter again. Its failure changes nothing.
export async function pruneDeletedDevotionals(admin: SupabaseClient, userId: string, nowMs: number = Date.now()): Promise<void> {
  try {
    await admin.from("deleted_devotionals").delete().eq("user_id", userId)
      .lt("made_at", new Date(nowMs - RECORD_KEEP_MS).toISOString());
  } catch { /* housekeeping */ }
}
```

### 3.3 `handler.ts`

The same shape as `confirm-scripture/handler.ts` (copy its `UUID`, `readEntryId` and `timed`: this is the second use, so duplicate rather than extract; do not edit `confirm-scripture`). The flow:

```ts
async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  context.userHash = await shortHash(user.userId);
  const entryId = await readEntryId(req);

  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);
  const entry = await db(() => findEntryToDelete(admin, user.userId, entryId));
  // Another person's reflection looks exactly like one that does not exist.
  if (!entry) throw new AppError("NOT_FOUND", "entry_not_found");

  // A request that is still making this reflection will write to it: wait for it, or for its claim to lapse (CLAIM_LEASE_MS).
  const age = Date.now() - Date.parse(entry.updated_at);
  if (entry.processing_status === "processing" && age < CLAIM_LEASE_MS) throw new AppError("ALREADY_PROCESSING", "still_processing");

  // 1. the files, 2. the record that this devotional counted this week, 3. the reflection (its affirmations go with it).
  await db(() => removeFiles(admin, deletableFiles(user.userId, entry)));
  if (entry.counted) await db(() => recordDeletedDevotional(admin, user.userId, entry));
  try {
    await db(() => deleteEntryRow(admin, user.userId, entry.id));
  } catch (error) {
    if (entry.counted) await forgetDeletedDevotional(admin, user.userId, entry.id);
    throw error;
  }
  await pruneDeletedDevotionals(admin, user.userId);

  const body: DeleteEntryResponse = { deleted: true };
  return jsonResponse(200, body, corsHeaders);
}
```

`handle(req)` is `confirm-scripture`’s with a smaller context (`requestId`, `startedAt`, `userHash`, `authMs`, `dbMs`) and `writeLog(blankLogLine({ requestId, status, code, reason, user, authMs, dbMs, totalMs }))` in the `finally`. The log never holds the entry id, a path, a title or any content (a test checks).

### 3.4 The contract (`process-entry/contracts.ts`, and `src/types/index.ts` with `src/types/contractParity.ts`)

```ts
// delete-entry (step 29b): deletes one reflection for good: its recording, its devotional audio, its affirmations and the row.
// NOT_FOUND means it is already gone (or never was this person's): the app counts that as deleted.
export type DeleteEntryRequest = { entryId: string };
export type DeleteEntryResponse = { deleted: true };
export type DeleteEntryErrorCode =
  | "INVALID_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "ALREADY_PROCESSING" | "INTERNAL";
export interface DeleteEntryError {
  error: { code: DeleteEntryErrorCode; message: string; requestId: string };
}
```

The same four in the app’s `src/types/index.ts`, and four more `Expect<Same<…>>` lines in `contractParity.ts`.

---

## 4. The app: gateway, repository, service

### 4.1 `src/constants/app.ts`

`export const DELETE_ENTRY_TIMEOUT_MS = 30_000;` (the function does a few Storage and database calls from a region far from the database: up to about 10 seconds; a timed-out request may have succeeded, and the retry answers `NOT_FOUND`, which counts as deleted).

### 4.2 `src/api/journalApi.ts`

`FunctionName` gets `"delete-entry"`; `callFunction`’s `body` type gets `DeleteEntryRequest`; add `isDeleteEntryResponse` (`isRecord(value) && value.deleted === true`) and

```ts
// delete-entry (step 29b): one reflection, deleted for good on the server.
export function deleteEntry(entryId: string): Promise<FunctionResult<DeleteEntryResponse>> {
  return callFunction("delete-entry", { entryId }, DELETE_ENTRY_TIMEOUT_MS, isDeleteEntryResponse);
}
```

### 4.3 Lower layers

- `src/db/mutations.ts`: `dropMutation(entryId): Promise<void>`: `DELETE FROM mutations WHERE entry_id = ?` (any revision; the entry is gone).
- `src/data/entriesLive.ts`: `forgetEntry(entryId)`: `cache.removeEntry` and `mutations.dropMutation`, each inside the file’s `safely(...)` (a closed database is "nothing cached").
- `src/data/mock/db.ts`: `removeMockEntry(id)`: removes the mock entry and its affirmations.
- `src/services/syncEngine.ts`: `SyncEvent` gains `{ type: "deleted"; entryId: string }`, and

```ts
// A reflection was deleted (step 29b): the lists that are on screen drop it at once.
export function announceEntryDeleted(entryId: string): void {
  emit({ type: "deleted", entryId });
}
```

### 4.4 `src/data/journalRepository.ts`

```ts
// Whether a delete can be tried now: the mock data always; otherwise only while NetInfo does not say there is no connection.
export function canDeleteNow(): boolean {
  return getDataSource() === "mock" || selectCanSend(useOfflineStore.getState());
}

// Deletes a reflection for good (step 29b). The mock data waits a little, honours "Fail next save (dev)" and removes the mock
// row. Otherwise the server deletes it first (no connection: nothing is sent); an answer of NOT_FOUND means it is already
// gone, which is the same as deleted. Only then does the phone forget its copy. Nothing is queued: a delete is online only.
// Never throws.
export async function deleteEntry(entryId: string): Promise<RepoResult<null>> { … }
```

The repository imports the gateway’s function under another name (`import { deleteEntry as deleteEntryOnServer } from "@/api/journalApi"`), so the two never clash.

Failure codes: no connection or no answer is `NETWORK`; a refused session `UNAUTHORIZED`; anything else `UNKNOWN`; the message is `copy.deleteReflection.failed`. (`failure()` types four codes; add `"UNKNOWN"` to its parameter type or build that one inline, as the file already does.)

### 4.5 `src/services/entryDeletion.ts` (new)

```ts
// Deletes a reflection for good and makes this phone forget every copy of it (step 29b). Never throws.
export async function deleteReflection(entryId: string): Promise<RepoResult<null>> {
  const deleted = await deleteEntry(entryId);
  if (deleted.ok) forgetOnThisPhone(entryId);
  return deleted;
}

// Also what a Realtime DELETE does on this phone. TODO(33): step 33 calls this from its DELETE handler.
export function forgetOnThisPhone(entryId: string): void {
  // The sound, the lock screen and the ambient bed stop when that devotional is the loaded one.
  try {
    const player = usePlayerStore.getState();
    if (player.entryId === entryId) player.stop();
  } catch { /* the player has nothing more to give up */ }
  forgetDevotionalFile(entryId); // its downloaded file (never throws)
  announceEntryDeleted(entryId); // the lists on screen drop it
  requestAffirmationReschedule(); // the notifications come from the reflection before it, or stop
}
```

`repository.deleteEntry` has already removed the cache entry, its affirmations and any waiting change before this runs, so the re-plan reads the phone without it.

---

## 5. The app: hooks and screens

### 5.1 `src/utils/prayerMenu.ts` (new, pure) and a test

```ts
export type PrayerMenuAction = "editNote" | "moveBack" | "remove" | "delete";
export type PrayerMenuItem = { action: PrayerMenuAction; label: string; icon: SymbolViewProps["name"]; destructive: boolean };

// What the ⋯ menu of a prayer offers, in order: the delete is always last. One list feeds the menu sheet.
export function getPrayerMenu(tab: "active" | "answered"): PrayerMenuItem[] {
  return tab === "answered" ? [items.editNote, items.moveBack, items.remove, items.delete] : [items.remove, items.delete];
}
```

Icons: edit `pencil`/`edit`; move back `arrow.uturn.backward`/`undo` (as today); remove `minus.circle`/`remove_circle`; delete `trash`/`delete`. Labels come from `copy.prayers.menu`.

### 5.2 `src/hooks/usePrayers.ts`

- In the `subscribe` handler: `if (event.type === "deleted") setResult(...)` removes that prayer from the list on screen.
- `removeFromPrayers(entryId): Promise<RepoResult<Prayer | null>>`: `setPrayerTracked(entryId, false)`; on `ok` it removes the prayer from the list, wakes the engine (`syncNow("mutation")`) and refreshes the pending count (as `applyChange` does); a failure returns the result and changes nothing.
- Both appear on the `ready` state.

### 5.3 `src/hooks/useJournalHome.ts`

In its `subscribe` handler: `else if (event.type === "deleted")` removes the entry from `result.entries`, the affirmations whose `entryId` is that id, and lowers `total` by one when it is not null. (Without it an entry deleted while older pages are loaded would stay until a pull-to-refresh, because pages merge by id.)

### 5.4 `src/hooks/useDeleteReflection.ts` (new) and `src/components/DeleteReflectionDialog.tsx` (new)

Used by Prayers and Reflection (and the Journal later), so the state is shared.

```ts
export type DeleteTarget = { entryId: string; answered: boolean };

export function useDeleteReflection(onDeleted: (entryId: string) => void) {
  // target, running, failed in state; a ref guards a second confirm. State is set in callbacks only.
  // ask(target): false (nothing opens) when canDeleteNow() is false; otherwise opens the dialog and returns true.
  // confirm(): deleteReflection(entryId); ok -> close, onDeleted(entryId); not ok -> failed = true, the dialog stays open.
  // cancel(): ignored while running.
  return { ask, dialog: { visible, answered, running, failed, onConfirm, onCancel } };
}
```

`DeleteReflectionDialog` takes `dialog`’s fields and renders `ConfirmDialog` with `tone="destructive"`, the trash `icon`, `copy.deleteReflection` title, body (`bodyAnswered` when `answered`), "Delete forever" / "Keep", `loading={running}` and, when `failed`, a calm live-region line (`copy.deleteReflection.failed`) in `children`, styled like Profile’s delete dialog failure line (read `ProfileScreen.tsx`).

### 5.5 `src/components/prayers/PrayerCard.tsx`

- The `active` variant gains `onOpenMenu: (prayer: Prayer) => void`.
- `ActiveCard` gets the same corner ⋯ as `AnsweredCard` (`styles.overflow`: absolute, right 8, top 8, a 44dp target, the `more` icon, label `copy.prayers.card.more(title)`).
- The header row (title column and days chip) gets `pr-9` so the chip never sits under the ⋯, and the title column’s `min-w-[170px]` becomes `min-w-[150px]`. **Measure at 390dp and 320dp (font scale 1.3 too) and report:** a one-line title and a "24 days" chip should still sit side by side at 390dp. If the chip drops under the title there for a normal title, lower the minimum (never below 130) until it does not. At narrow widths the chip dropping under the title is the existing, accepted behaviour.

### 5.6 `src/screens/prayers/PrayersScreen.tsx`

- `Notice` becomes `"marked" | "failed" | "removed" | "deleted" | "offline"`, with `copy.prayers.notice.removed`, `deleted` and `copy.deleteReflection.offline`. They are the same blush banner, announced, cleared by a tab change or a refresh (never on a timer).
- `openMenu(prayer, tab)` opens the app’s `BottomSheet` on both platforms (the native iPhone action sheet drew system blue and red and was replaced on 2026-10-28) with one row per item of `getPrayerMenu(tab)` (in one white card with hairlines between the rows, the delete row in Crisis Red, icon and label) and the prayer’s title as a muted caption. A choice that opens another Modal goes on from the sheet’s `onDismiss` on iOS (with a timer as a fallback) and at once on Android (AGENTS.md, Bottom Sheets). Active cards now call it too.
- Actions: `editNote` and `moveBack` as today; `remove`: an **Active** prayer calls `ready.removeFromPrayers(id)` at once (a failure sets `"failed"`, success `"removed"`); an **Answered** prayer first opens a `ConfirmDialog` ("Remove this from Prayers?", `copy.prayers.removeFromPrayers`) and calls it on confirm; `delete`: `const opened = deletion.ask({ entryId: prayer.id, answered: prayer.isAnswered })`; when `opened` is false set the `"offline"` notice.
- `const deletion = useDeleteReflection(() => setNotice("deleted"))` and `<DeleteReflectionDialog {...deletion.dialog} />` at the end.

### 5.7 `src/screens/journal/ReflectionScreen.tsx`

- Above the early returns: `const deletion = useDeleteReflection(() => goBack());` and `const [deleteOffline, setDeleteOffline] = useState(false);`.
- `ReadyView` gets `onDelete` and `deleteOffline`. Inside the existing `FadeIn arrive(5)` block, after the "Return to Journal" and share row, add a centered quiet button: trash icon (16, `mauve`) and the text `copy.deleteReflection.link` in `btn-text__label text-mauve` (5.37:1 on linen), `min-h-11`, role button, label and hint from the copy. When `deleteOffline` the calm line `copy.deleteReflection.offline` shows under it (live region). Tapping it calls `deletion.ask({ entryId, answered: entry.prayer?.isAnswered === true })` and `setDeleteOffline(!opened)`.
- `<DeleteReflectionDialog {...deletion.dialog} />` after the body. Only the ready view has the link: the crisis, preparing, failed, not-found and error views do not.

---

## 6. Copy (`src/constants/copy.ts`, every string typographic: ’ and …)

```ts
// copy.prayers.menu
menu: {
  editNote: "Edit gratitude note",
  moveBack: "Move back to Active",
  removeFromPrayers: "Remove from Prayers",
  deleteReflection: "Delete reflection…",
  cancel: "Cancel",
},
// copy.prayers.removeFromPrayers: asked for an answered prayer only
removeFromPrayers: {
  title: "Remove this from Prayers?",
  body: "Its answered date and gratitude note will be removed. The reflection stays in your Journal.",
  confirm: "Remove",
  cancel: "Keep",
},
// copy.prayers.notice gains
removed: "Removed from Prayers. It’s still in your Journal.",
deleted: "Reflection deleted.",

// copy.deleteReflection (new group, shared by Prayers and Reflection)
deleteReflection: {
  title: "Delete this reflection forever?",
  body: "This permanently deletes the reflection, its devotional audio, its affirmations and any recording. This can’t be undone.",
  bodyAnswered:
    "This permanently deletes the reflection, its devotional audio, its affirmations, any recording and your gratitude note. This can’t be undone.",
  confirm: "Delete forever",
  cancel: "Keep",
  failed: "We couldn’t delete this reflection. Please try again.",
  offline: "Connect to the internet to delete a reflection.",
  link: "Delete reflection",
  linkLabel: "Delete this reflection",
  linkHint: "Asks before deleting",
},
```

No prose inline in components. Haptics: none.

---

## 7. Tests

### 7.1 Deno

Extend the fake world (`process-entry/testing/fakes.ts`): `world.deletedDevotionals`, `COLUMNS.deleted_devotionals`, the table in `rest()` (insert with `ignore-duplicates`, a foreign key to the user and a primary key on `entry_id`), `DELETE` that returns the removed rows when `Prefer: return=representation` is sent and **cascades to the entry’s affirmations**, a route for `DELETE /storage/v1/object/journal_media` with `{ prefixes }` (removes from `world.storage`, answers the removed objects), one-shot failures (`world.fail = { storageRemove, recordDeleted, deleteEntry }` counters), `seedDeletedDevotional(world, userId, madeAt)`, and `unscopedRequests` also checks `deleted_devotionals`.

`delete-entry/handler_test.ts`:

- a) a finished reflection is deleted: row, affirmations, recording and devotional audio gone; 200 `{ deleted: true }`; one record with the entry id, the user id and `made_at` equal to the entry’s `created_at`.
- b) the order is files, then record, then row (from `world.requests`).
- c) a crisis entry and a failed entry (no devotional) are deleted and get no record.
- d) another person’s reflection answers the same 404 as a missing one; nothing is removed anywhere.
- e) a stored path outside the user’s folder is never removed.
- f) a `processing` entry touched just now: 409 and nothing removed; one whose claim lapsed (4 minutes) is deleted.
- g) Storage fails: 500, reason `storage_remove_failed`, row intact, no record; the same request again completes.
- h) the record cannot be written: 500, row intact; again completes with one record.
- i) the row delete fails: 500 and the record is rolled back; again completes.
- j) after success the same request answers 404 and writes no second record.
- k) bad requests: not POST 405; no token, a malformed token, an expired one 401; not JSON, an array, no id, not a UUID, a body over 64 KB: 400; `OPTIONS` 204.
- l) every request carries the user’s id (`unscopedRequests` is empty); no response holds the service key.
- m) the log is one line with exactly the 30 fields and no id, path, title or content.
- n) housekeeping: this person’s records older than 14 days go; newer ones and other people’s stay; a failing prune does not fail the request.
- o) two requests at once for the same reflection end with one record and the reflection gone.

`delete-entry/lifecycle_test.ts`: `deletableFiles` (own paths only, no `..`, a null client id, duplicates once), `findEntryToDelete`’s `counted` rule, `RECORD_KEEP_MS`.

`_shared/limits/checkLimit_test.ts` and `process-entry/handler_test.ts`: deleted records of this week count; records from before this week do not; another person’s do not; a failing records query throws `db:limit_deleted`; a trial or Pro account makes no records query; a free account with two devotionals and one deleted record this week gets `LIMIT_REACHED` with `usage.used` 3; the same account with the record from last week is allowed.

### 7.2 The app: `supabase/tests/deletion/run.cjs` (new, on the journal-data world)

Edit `journal-data/world.cjs`: `functions` gets `"delete-entry": []`; with no scripted answer it removes the caller’s entry and affirmations (404 `NOT_FOUND` when there is none) and records the call; fake `@/store/playerStore`, `@/services/devotionalAudio` and `@/services/affirmationScheduler` in the new suite (plain Node cannot load them).

Checks (each ends by asserting nothing the database or AGENTS.md would refuse was sent, and that the development log holds no id, title, word or token):

1. the gateway: a `deleted: true` answer is ok; 404 is `NOT_FOUND`; 401 `UNAUTHORIZED`; 409 and 500 failures; no answer is `NETWORK`; a 200 with another body is `UNKNOWN`; it never throws; the timeout is 30 seconds; `getLastFunctionCall()` holds a name, a status, a code and a time.
2. the repository: offline sends nothing and answers `NETWORK`; ok removes the cached entry, its affirmations and the waiting prayer change; `NOT_FOUND` does the same and is ok; a failure leaves the cache untouched; the mock data waits, honours `nextPrayerMutationFails` and removes the mock rows; `canDeleteNow()`.
3. the service: the player is stopped only when it holds that entry; the file is forgotten; `deleted` is announced once; the re-plan is requested once, after the cache removal; a throwing step does not change the result.
4. `usePrayers`: `removeFromPrayers` on an Active prayer removes it from the list and queues one patch (`is_active_prayer` false); on an Answered prayer the answered fields are cleared too; a failure changes nothing; a `deleted` event drops the prayer.
5. `useJournalHome`: a `deleted` event drops the entry (also from an older page), its affirmations and one from `total`.
6. `useDeleteReflection`: `ask` is false offline and nothing opens; confirm calls `onDeleted` once; a failure keeps the dialog open with `failed`; a second confirm while running is ignored; cancel while running is ignored.
7. `getPrayerMenu`: Active is [remove, delete]; Answered is [editNote, moveBack, remove, delete]; delete is last and the only destructive one; labels come from the copy.

Older suites: only edit one when a new import breaks it in plain Node, by faking the module for that environment (steps 23 to 28 did the same); say which in the report.

### 7.3 The developer check (`src/components/dev/processEntryCheck.ts`)

Add `"delete-entry"` to `call`’s function names and, at the end of the check: a malformed id answers 400; an unknown id 404; deleting the last reflection the check made answers 200 and again 404, its row is gone (the app’s own select) and the signed link for its devotional now fails. These need the function deployed; before that they report as failed with the reason.

---

## 8. AGENTS.md and docs updates

Edit `AGENTS.md`, then copy it to `prompts/AGENTS.md` (identical). Replace, do not add a second rule:

- **Prayers specification (screen 6):** the ⋯ on both card types and its items; the corner position; "Crisis red is not used on this screen" gains "except the Delete row and the delete dialog’s confirm button (step 29b)", and the "no red option" in the same specification’s description of the overflow menu likewise; the notices `Removed from Prayers…`/`Reflection deleted.`.
- **Reflection specification (screen 5):** the quiet Delete link at the end of the ready view and what it does.
- **Prayer Rules:** Remove from Prayers (clears the flags, an answered date and note with them, queued like any prayer change) versus Delete reflection.
- **Backend / Edge Function Rules:** a `delete-entry` bullet (what it does, the order, NOT_FOUND, ALREADY_PROCESSING, no secrets), the list of functions, `config.toml`, the Deno commands (add the `delete-entry` folder to `check`, `lint` and `test`), and requirement 10 (the count includes `deleted_devotionals`).
- **Database Rules:** the table, who may touch it, the 14 days, the migration file, "What the signed-in app may write" stays the same (no DELETE), the self-test count (50).
- **Journal Data Rules:** `deleteEntry` is the third function called only through `src/api/journalApi.ts`; a delete is online only.
- **Local Cache & Offline Rules:** deleting is the one write that needs a connection.
- **Audio Rules (Playback)** and **Notification Rules:** deleting releases the loaded player and the downloaded file, and plans the affirmation notifications again.
- **Architecture tree and Linting and Validation:** the new files and folders, and the new test command with its count.
- **Build Status & Decisions Log:** a "Step 29b" entry, in the usual form (decisions, added, changed, differences from this prompt, measured, verified, not verified, open items, markers), with the walk-through results line by line when it is run. The log must also say that the table records deleted devotionals only (decision 4) and that Profile’s "n of 3" can read lower than the server’s count after a delete.
- **`docs/legal-brief.md` and `docs/privacy-policy.md`:** deleting a reflection removes its text, recording, devotional audio and affirmations at once; a record (an opaque id, the owner and the time it was made) is kept for up to 14 days to count the devotional in the free week, and goes with the account. Add the retention question for the lawyer.

---

## 9. Rules

- No package, no `app.json` entry, no secret, no change to `process-entry`’s creation path, to `confirm-scripture`, or to the app’s grants and policies. The only SQL is the one new file and the self-test additions.
- Every service-role query filters by the verified user id. `userId` comes only from the token.
- Nothing logs an entry id, a path, a title, a word of a reflection, a token or a key (the app: a state or a code; the function: the allow-list).
- The delete is never retried by the app on its own and never queued; the person presses the button again.
- Crisis red only where decision 5 says. No haptic. No new animation.
- A crisis entry never gets a Delete in the app (decision 6). Do not touch the crisis view.
- Do not run `secrets set`. Do not deploy: the user does (Step 2), after you ask.
- A harness failure of a module plain Node cannot load is fixed by faking that module in that harness, not by changing the app.

---

## 10. Notes for later steps (reported, not edited)

- **31 (account actions):** `delete-account` removes `{userId}/` by listing; the new table needs no work there (it cascades with the profile). The export does not know the table. The two privacy pages describe both deletions.
- **33 (Realtime):** a `DELETE` event calls `forgetEntry(entryId)` and `forgetOnThisPhone(entryId)` from `entryDeletion.ts`; a delete made on this phone arrives back as an event and must be a no-op the second time.
- **34 (analytics):** `reflection_deleted { source: "prayers" | "reflection", had_audio }` and `prayer_removed { was_answered }`. Leave `TODO(34)` markers at the two success paths. Never for a crisis entry (none is deletable).
- **Profile’s usage line** reads the phone’s cache, so after a delete it can read one lower than the server’s count. The 402’s Paywall banner is the truth. A later step can return the week’s used count from the server (for example in the delete answer) and show that.
- **30, 32, 35:** nothing.

---

## 11. Verify

### Part A: always (the implementer, no phone)

1. **Red first:** after writing the new tests and before the code, the new suites fail for the right reasons (`cannot resolve @/services/entryDeletion`, a Deno import of `./handler.ts`, the limit tests expecting the third question); the baseline of section 0 is still green.
2. After the change: `npm run typecheck` and `npm run lint` exit 0 with no messages (check the React Compiler rules: no state set in an effect body); every older suite at its number (offline 44, journal-data 87, prayers 32, notifications 48, playback 133, ambient 64, recording 68, profile-sync 88, parity 7 of 7; the four new `Expect`s of `contractParity.ts` are checked by `npm run typecheck`, and a difference between the two copies of the contract must fail it: prove that once by changing one side and restoring it); the new `deletion` suite passes; the Deno commands of AGENTS.md pass with the `delete-entry` folder added (`check`, `lint`, `fmt --check`, `test`), the test count higher than 348.
3. **The SQL offline:** the runner needs PGlite, which is not a dependency. **Ask the user first** whether to install it in a scratch folder outside the repo (`npm install @electric-sql/pglite@0.5.11`); if they say no, skip this and say so: the hosted self-test (Step 1) is the judge. With PGlite: `node supabase/tests/run-in-pglite.mjs --negative` ends "ALL GOOD" with 50 of 50 checks, twice for each setting, and all broken variants caught.
4. **Exports:** `npx expo export` for Android and for iOS, one platform at a time (about 2 GB of memory is needed), exit 0; the iOS bundle holds the five new strings of section 6.
5. **Greps:** no `delete()` on `journal_entries` anywhere in `src`; `from("deleted_devotionals")` only under `supabase/functions`; `delete-entry` called only from `src/api/journalApi.ts` and the developer check; no `console` in the new app files except `__DEV__` lines that print a code; `grep -rnE "TEMP\(|TODO: real" src` still prints 9 (6 `TEMP(` and the 3 `TODO: real` constants: no marker of that kind is added or removed).
6. **Layout:** the Active card measured at 390dp, 320dp and 320dp at font scale 1.3 on the emulator **only if the user says yes** (it holds their account); otherwise report "not measured" and let walk-through B2/B5 show it.
7. **Breakages**, in a scratch copy (never in the repo, so the user’s running dev server never sees a broken file), each caught by a named check, with a control run first. Server: the row deleted before the files; no record for a counted entry; a record for a crisis or failed entry; a foreign path removed; a missing user filter on the find and on the delete; no rollback of the record when the row delete fails; no `ALREADY_PROCESSING` guard; `NOT_FOUND` answered with a different status for another person’s entry; the limit ignoring `deleted`; the limit counting other people’s or older records; a prune that is not scoped to the user; the entry id in the log line. App: the offline guard removed; the player not stopped; the file not forgotten; no re-plan; `NOT_FOUND` treated as a failure; the cache not cleared; the waiting change not dropped; the `deleted` event ignored by Journal or by Prayers; the delete not last or not destructive in the menu. Report how many were caught.

**Gate, then ask:** after Part A, tell the user to do Step 1 (the migration), then ask "Deploy process-entry and delete-entry?" and only on yes tell them to run Step 2’s commands; then send the four unauthenticated requests (expect 401, 401, 405, 204). Then ask: "Automated checks pass. Shall I start the guided walk-through now (B0 to B17)? Keep Expo Go open on the iPhone, in front and connected to the dev server."

### Part B: the phone walk-through (you, on the iPhone in Expo Go)

Section D above. The implementer reads every result itself (read-only inspector, the app’s own queries, and the SQL you run), reports PASS or FAIL with evidence, fixes a FAIL only after your yes and runs its check again, and lists what could not be checked.

### Not verified, and said so

Another phone seeing the deletion; Android; VoiceOver and TalkBack on the menu, the dialog and the link; Storage’s answer to removing a path that is not there (the fake and the docs say it succeeds; B8 and B9 show it for real); a speech retry that finishes after a delete (it can leave one orphan file); the hosted function under load.

---

## 12. Report

Lead with what changed and where (file paths), then how to test it. State what was verified and what could not be. Flag every deviation from this file with the reason, every difference between a design and a token, and each place the real code disagreed with this text. Include the measured Active-card layout (or "not measured"), the test counts before and after, the breakages caught, and the markers left (`TODO(33)`, `TODO(34)`). End with the one-line question about the guided phone walk-through (AGENTS.md).
