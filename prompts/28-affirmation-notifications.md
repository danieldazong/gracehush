# 28-affirmation-notifications.md

Read AGENTS.md first and follow it strictly.

Schedule the daily affirmation notifications. Three times a day, at the user's reminder times and in the phone's time zone, the phone shows a local notification whose title names the slot ("Morning affirmation") and whose body is that slot's affirmation headline from the newest reflection; a tap opens that reflection on its Affirmations tab. The phone keeps the next 7 days scheduled and plans again whenever something they depend on changes. Nothing is pushed from a server. Screens keep their look; the developer panel gets one small group.

**The code is written and proven.** The old text of this step was written before steps 07 to 27 were built: it names a function that never existed (`registerLocalAffirmationSchedule`), flat screen paths, a "meta" table in SQLite (schema version 2 is taken by step 25, and nothing needs a table), a plugin option that SDK 57 lacked, a slot title the app has nowhere else, a `prebuild` and an Android phone, and a cold-start tap test that Expo Go cannot pass. The review checked it against the installed `expo-notifications` 58.1.6 (its TypeScript, Swift and Kotlin), Expo Go's own notification modules (on the `sdk-58` branch of expo/expo) and the repo, so this prompt carries the finished files word for word (sections 1 and 2) and the checks that prove them (section 3). They were proven in a copy of the repo outside the project: `tsc` and ESLint (with the React Compiler rules) clean, **48 Node checks** (`supabase/tests/notifications/`) pass with the app's real planner, scheduler, tap routing, notifications service and stores running on a fake of `expo-notifications` 58 shaped like iOS and Android, and with the repository's two new reads running on the real SQLite cache of step 25, and **59 deliberate breakages** of the code were each caught by a named check. The older checks pass at their numbers (offline 44, recording 68, playback 133, ambient 64, profile-sync 88, journal-data 86, parity 7 of 7) once the small edits the review already made to three of them are counted (section 3.1), both platforms bundle, and `npx expo config --type introspect` shows the native change is exactly the intended one. What the review could not do, because it has no phone: see a notification arrive, read the lock screen and tap one. That is the walk-through in section 7.

**Nothing must come from you before the step is built.** No key, no package, no migration, no policy, no Edge Function deploy, no secret, no dashboard. The notification icon for Android (`assets/images/notification-icon.png`) was made in the review from the app's own logo mark and is already in the repo.

Sources, read in the review on 2026-10-28 (installed packages, not web pages, so they are the versions this app runs):

- `expo-notifications` 58.1.6: `build/*.d.ts` (the trigger inputs, `NotificationBehavior`, `NotificationResponse`, the deprecated `Async` forms), `plugin/build/` (the `enableRemoteNotifications` and `icon` options), the Swift sources (`TriggerRecords.swift`, `NotificationRecords.swift`, `SchedulerModule.swift`, `EmitterModule.swift`, `NotificationCenterManager.swift`), the Kotlin `ExpoSchedulingDelegate.kt`, and `CHANGELOG.md` from 57.0.8 to 58.1.6
- Expo Go's iOS notification modules on the `sdk-58` branch (`apps/expo-go/ios/Exponent/Versioned/Core/Modules/Notifications/`: the scoped scheduler, emitter, presentation and utils) and `EXKernel.m`
- the code of steps 07 to 27 (`src/`), `AGENTS.md`, the designs (none shows a notification), and prompts 29, 31, 33, 34 and 35 (they read what this step builds)

---

## What the review found (these changed the prompt)

1. **Wrong names and paths.** There is no `registerLocalAffirmationSchedule` and no DAILY trigger anywhere: step 07 built only the channel and the permission functions in `src/services/notifications.ts`. `src/screens/ProfileScreen.tsx` is `src/screens/profile/ProfileScreen.tsx`, `src/screens/ReflectionScreen.tsx` is `src/screens/journal/ReflectionScreen.tsx`, and `ReflectionCarousel.tsx` is in `src/components/`.
2. **The `TODO(28)` list is six lines, and none needs the server.** `ProfileScreen.tsx` twice, `account.ts`, `profileSync.ts`, and two comments in `supabase/functions/process-entry/lifecycle.ts`. The step 26 note the old text closes does not exist (step 26 left none).
3. **iOS cannot say when a scheduled notification will fire.** A date trigger becomes a time interval counted from the moment it was scheduled (`TriggerRecords.swift`), and `getAllScheduledNotificationsAsync()` reports it back as `{ type: "timeInterval", seconds }`. The old text compares a stored "signature" with what is scheduled and keeps it in a SQLite "meta" table. Instead, **the identifier carries it**: `aff-{slot}-{local date}-{local time}-{hash}`, where the hash covers the instant, the title, the headline, the entry and the account. The same plan gives the same identifiers, so a run compares two lists of identifiers and changes only the difference: no table, no migration (schema version 2 is step 25's `outbox.uploaded`), nothing to keep in step.
4. **A run must never cancel what it cannot see.** If the database is not open, the profile was never read on this phone (the Daily Affirmations switch is unknown), or the cache cannot be read, the run changes nothing. The old text would have cancelled everything on a bad read. A reflection still being prepared (on another phone, minutes ago) has no affirmations yet and never counts as the newest (the review's breakage run found that gap).
5. **One that is about to fire is kept.** The old text skips anything within 60 seconds of now, which, with a full cancel-and-reschedule, would drop the 08:00 notification every time the app came to the front at 07:59. A notification that is already scheduled is never touched while it is still wanted; one that is not yet scheduled is added only if it is at least 10 seconds ahead (iOS refuses a time that has passed).
6. **The plugin option exists now.** `enableRemoteNotifications: false` arrived in `expo-notifications` 58.1.0 (step 07 noted SDK 57 had none). Set, the iOS `aps-environment` entitlement goes away, so the development build of step 35 needs no Push capability. `npx expo config --type introspect` before and after: that entitlement goes, Android gains the notification icon's meta-data, and permissions and background modes are unchanged.
7. **The Android notification icon.** Step 07 left it open ("a white 96×96 PNG, step 28 asks for it"). The review rendered `assets/images/logo-mark.svg` white on transparent at 96 by 96 (headless Chrome, chunks `IHDR`, `IDAT`, `IEND` only), and a check reads it. Only the alpha is used by Android; iOS shows the app's own icon.
8. **The title.** The old text invents "Morning Anchor", "Midday Peace" and "Bedtime Rest", which nothing else in the app says (and "Bedtime" is wrong for a 6 PM reminder). The title is the Journal card's own eyebrow words: "Morning affirmation", "Afternoon affirmation", "Evening affirmation". The body is the headline alone, never the affirmation's longer text, the person's words, the emotion or the verse.
9. **After a crisis entry nothing is sent.** AGENTS.md says never schedule affirmations for a crisis entry. The old text goes further, and the review keeps it: when the newest finished reflection is a crisis entry, no notification is sent at all, not even from an older reflection, until a newer reflection is ready. Cheerful lines three times a day built from an earlier prayer would be wrong right after someone wrote about wanting to die.
10. **Taps.** `getLastNotificationResponse()` is synchronous in 58. On iOS a tap that arrives before the JavaScript listens is held natively and handed over as the last response, so the tap that opened a closed app is read at start; the listener and the last response can both report one tap, so it is acted on once. The tap waits until the signed-in screens are mounted and the account is known, and a tap on another account's notification opens nothing. **Expo Go cannot show a cold-start tap**: Expo Go's kernel never opens a project from a notification when Expo Go itself was closed (`EXKernel.m`), so that case waits for the development build of step 35. The old text's "Wait until fonts loaded, Clerk loaded and signed in, dbReady and the navigator is ready" becomes: the navigator holds the signed-in screens and the account is known (the database is not needed to open Reflection).
11. **Expo Go scopes everything.** In Expo Go every identifier is stored as `scopeKey/identifier` and every notification's `data` gets `experienceId` and `scopeKey`; the scheduled list holds the other Expo Go projects' notifications too, with their scope taken off. So the identifiers use neither `/` nor `\`, the tap data is read field by field, and a run only ever cancels identifiers it planned.
12. **The old Verify list could not pass here.** It wanted a `prebuild`, an Android phone and a "dev build, physical iPhone". AGENTS.md: the iPhone runs Expo Go (local notifications work there), Android is the emulator only with your yes, and the iOS development build is last (step 35). Section 7's walk-through is written for your iPhone in Expo Go, and says what waits.
13. **Three older checks needed small edits, and they are already made** (section 3.1): `account.ts` and `useJournalHome.ts` now import the scheduler, which plain Node cannot load, so the offline, profile-sync and journal-data checks fake it, and two of them now also check that sign-out clears the notifications.
14. **Step 34's event.** The old text names `affirmation_opened`; prompt 34's catalog names `affirmation_notification_opened`. The `TODO(34)` uses 34's name (and 34's own `slot` values, `"midday"`, are reported in section 6: the app's slot is `"afternoon"`).

---

## What you do yourself (read this first)

### Keys and settings: nothing new (checked in the review, by names only)

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set. This step adds nothing to it. |
| `supabase/functions/.env.local` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `CLERK_ISSUER`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE` | all set. Not touched by this step. |

Local notifications need no key, no Apple account, no Firebase project and no server. Nothing to create in Supabase, Clerk, Google Cloud or RevenueCat, and nothing to deploy: the two Edge Function lines that change are comments, so the hosted function stays as it is.

### A. Before the walk-through (once, on your iPhone)

1. Notifications for Expo Go must be allowed: **Settings → Apps → Expo Go → Notifications → Allow Notifications** on, with **Lock Screen**, **Notification Center** and **Banners** on. (In Expo Go every notification of every project comes from Expo Go itself, so the banner shows Expo Go's name and icon, not Gracehush's.)
2. A **Focus** (Do Not Disturb, Sleep) silences banners: turn it off for the walk-through, or add Expo Go to its allowed apps.
3. The walk-through signs in as the test account (`gracehush17b+clerk_test@example.com`, code `424242`), which has real reflections and the Pro plan. Two checks make reflections (one made-up crisis sentence, one ordinary one): about 10 US cents of Gemini and speech in all.

### B. Phone walk-through (iPhone, Expo Go)

When the implementer has finished and its checks pass, it asks whether to start this walk-through (AGENTS.md, "Guided phone walk-through"). Before B0: **restart Metro** with `npx expo start -c` (new files, a new asset and an `app.json` change), then force-quit and reopen Expo Go. The account is the test account (`gracehush17b+clerk_test@example.com`, Pro, with real reflections; section A). It makes three reflections (two ordinary ones and one made-up crisis sentence): about 15 US cents of Gemini and speech. **Keep Expo Go open and in front between checks**, except where a check says to lock the phone: the implementer can read nothing while the app is in the background, and reads again when you bring it back. What a notification looks like is seen, not read, so those checks end with a screenshot or a one-word answer. B0 writes down your three reminder times; B11 puts them back.

**B0. Start**
- **Do:** sign in as the test account, open Profile, scroll to the developer panel and press **Show (dev)** under "Affirmation notifications (dev)".
- **Expect:** a line `affirmations scheduled: N, next: …`. N is up to 21; it is 0 when the newest finished reflection of this account is a crisis entry (the step 25 walk-through made two), which B1 fixes.
- **Read:** the data source and the session (inspector); the notification permission (`getNotificationPermission()`: `granted`); the three reminder times (written down for B11); `getAffirmationScheduleSummary()`; `readAffirmationSource()`'s `isCrisis` (true or false only, never the words).

**B1. An ordinary reflection**
- **Do:** tap the pen, write `Today I felt tired, but a quiet walk with my sister helped me breathe again.` and press **Submit Reflection**.
- **Expect:** the reflection opens; then `scheduled` is 19 to 21 (fewer when a reminder time has already passed today) and `next` is the next of your reminder times.
- **Read:** `getAffirmationScheduleSummary()`; `readAffirmationSource()`'s entry id equals the new reflection's (its first 8 characters); `isCrisis` false.

**B2. Three notifications at the times you set**
- **Do:** on Profile, open **Daily Reminders** and set Morning, Afternoon and Evening to three whole minutes in a row, the first at least 2 minutes from now (for example 3:41 PM, 3:42 PM, 3:43 PM). Then press the side button to lock the phone and wait.
- **Expect:** at each of the three minutes a notification on the lock screen, from Expo Go, titled **Morning affirmation**, **Afternoon affirmation**, **Evening affirmation**, each with one short affirmation line and nothing else: no prayer, no verse, no feeling. (Seen: send one screenshot of the lock screen with the three.)
- **Read:** before you lock, `getAffirmationScheduleSummary().next` is today at the first minute you chose; afterwards ask for the screenshot.

**B3. A tap opens the reflection on Affirmations**
- **Do:** unlock by tapping the newest of the three notifications.
- **Expect:** Gracehush opens on the reflection from B1, with its **Affirmations** tab selected.
- **Read:** the navigator's current route (`navigationRef.getCurrentRoute()`): `Reflection`, with `tab: "affirmations"` and the B1 entry id (first 8 characters). Ask for a screenshot if the tab is not clear.

**B4. While the app is open: a quiet banner**
- **Do:** go to Profile, press **Test in 10 s (dev)** and stay on Profile. When the banner comes, tap it.
- **Expect:** after about 10 seconds a banner at the top of the screen, with no sound; the tap opens the reflection on Affirmations. (Heard and seen: "banner, no sound" or what happened.)
- **Read:** the developer panel's line says `test: in 10 s`; the current route after the tap, as in B3.

**B5. The Daily Affirmations switch**
- **Do:** on Profile, turn **Daily Affirmations** off. Then, after the implementer has read, turn it on again.
- **Expect:** off: `scheduled` is 0. On: back to the number of B1.
- **Read:** `getAffirmationScheduleSummary()` after each.

**B6. Notifications turned off for Expo Go**
- **Do:** in the iPhone's **Settings → Apps → Expo Go → Notifications**, turn **Allow Notifications** off, then come back to Gracehush (Profile).
- **Expect:** `scheduled` is 0, and Profile shows the blush card "Turn them on in Settings to receive your affirmations." (Seen.) Then turn it on again in Settings and come back: the number of B1 again.
- **Read:** `getNotificationPermission()` (`denied`, then `granted`) and `getAffirmationScheduleSummary()` after each return.

**B7. After a crisis entry nothing is sent**
- **Do:** tap the pen and write this made-up test sentence (the same the developer checks use): `I do not want to be alive anymore. I have been thinking about ending my life and I cannot see a way out.` Then **Submit Reflection**.
- **Expect:** the calm crisis support view opens; `scheduled` is 0.
- **Read:** `getAffirmationScheduleSummary()`; `readAffirmationSource()`'s `isCrisis` true. Nothing about the entry is printed but that.

**B8. The next ordinary reflection brings them back**
- **Do:** tap the pen, write `I am thankful for a calm morning and a good talk with an old friend.` and **Submit Reflection**.
- **Expect:** `scheduled` back to 19 to 21, made from this new reflection.
- **Read:** `getAffirmationScheduleSummary()`; `readAffirmationSource()`'s entry id is the new one, `isCrisis` false.

**B9. Another time zone (optional)**
- **Do:** in **Settings → General → Date & Time**, turn **Set Automatically** off and choose another **Time Zone** (for example London), then come back to Gracehush. Afterwards turn **Set Automatically** back on and come back again.
- **Expect:** every scheduled notification is replaced (new identifiers) and `next` reads your reminder times in that zone; after **Set Automatically** is back, they are replaced again for your own zone.
- **Read:** the scheduled identifiers before and after each change (how many changed; the identifiers are not shown to you), and `getAffirmationScheduleSummary()`.

**B10. Sign out clears them**
- **Do:** on Profile, press **Sign Out**, then **Sign out** in the dialog.
- **Expect:** Sign In opens; no affirmation notification is scheduled and none is left in Notification Center.
- **Read:** the count of scheduled identifiers that start with `aff-` and of shown ones (`listScheduledIds()`, `listPresentedIds()`): both 0.

**B11. Back to how it was**
- **Do:** sign in again as the test account; on Profile set the three reminder times back to the ones B0 wrote down.
- **Expect:** `scheduled` comes back by itself once the profile has been read (19 to 21), at your own times.
- **Read:** the three reminder times equal B0's; `getAffirmationScheduleSummary()`.

Not part of this walk-through, because Expo Go cannot show it (section 7, "Not verified"): a tap on a notification when Expo Go itself was closed (swiped away), which waits for the development build of step 35; Android.

### C. Android (optional, and only with your yes)

The emulator's Expo Go is 57 and cannot open this SDK 58 project, and it holds your own account. Android is not part of this step's walk-through. What Android would show (the channel, the icon, minutes of delay without exact alarms) waits for an Android development build.

### If something goes wrong: what it means

| what you see | what it means |
| --- | --- |
| No banner at the time, the app was in the front | It shows as a quiet banner (no sound) while the app is open. Check Settings for Expo Go's banners, and any Focus. |
| No banner at the time, the phone was locked | Look in Notification Center. iOS can group them under Expo Go. A Focus hides banners but keeps them in the list. |
| The developer panel says `scheduled: 0` | The Daily Affirmations switch is off, notifications are not allowed for Expo Go, there is no finished reflection on this phone yet (open Journal once), or the newest one is a crisis entry. Each is by design. |
| A tap opens Expo Go's home screen | Expo Go had been closed (swiped away). Expo Go cannot open a project from a tap then; the development build of step 35 can. Open the project again and tap a new one. |
| The lock screen shows only "Expo Go" | iOS's **Show Previews** is "When Unlocked" or "Never" (Settings → Notifications). It is a privacy setting of the phone, not a fault. |

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **Local notifications only** (no push): `expo-notifications` with `enableRemoteNotifications: false`, the white `icon` and the plum `color` in `app.json` (finding 6). No new package, no exact-alarm permission on Android (an affirmation may arrive a few minutes late there), no migration.
2. **What is sent:** at each reminder time, the title "{Slot} affirmation" and the headline of that slot's affirmation from the newest finished reflection on this phone (finding 8); `data` carries `kind`, the entry id, the slot and the account's hash (the first 16 hex characters of SHA-256 of the Clerk user id, the same hash step 24's file names use). Sound on; no badge.
3. **When nothing is sent:** the Daily Affirmations switch is off; the phone will not show notifications (iOS provisional delivery counts as allowed); there is no finished reflection on this phone; the newest one is a crisis entry (finding 9); or it lacks one of the three headlines.
4. **The window:** today and the next 6 days at the reminder times, in the phone's current time zone (`AFFIRMATION_DAYS_AHEAD`, 21 notifications at most: iOS allows 64). A reminder time the spring clock change skips fires at the first minute after the jump; one the autumn change repeats fires the first time (`src/utils/zonedTime.ts`, Intl only).
5. **Identifiers carry the plan** (finding 3), and a run changes only the difference (finding 5). Nothing is stored about the schedule.
6. **When it plans again:** at sign-in (once the database is open and the profile has been read on this phone), whenever the app comes to the front (this refills the 7 days and follows a new time zone), a reminder time changing (from Profile, onboarding or another phone through the profile sync), the Daily Affirmations switch changing (the same), a reflection finishing (the sync engine's `finished` event, a crisis entry included), Journal's first page arriving from the server, and Profile's "Allow notifications". Requests within half a second are one run (`AFFIRMATION_RESCHEDULE_DEBOUNCE_MS`); one run at a time.
7. **A bad read changes nothing** (finding 4).
8. **Taps** open `Reflection` with `{ entryId, tab: "affirmations" }` (finding 10), through a `navigationRef` on the one `NavigationContainer`. Playback and the ambient sound never start. Reflection keys its view by the entry and the tab, so a tap for the reflection already open turns it to Affirmations.
9. **While the app is open** a notification shows as a banner and in the list, without sound or badge (`setNotificationHandler`).
10. **Sign-out and account deletion** (`signOutCleanup`) stop planning, wait for a run in the air, cancel every notification whose identifier starts with `aff-`, and remove those still in the notification center. When a session ends without a sign-out, what is scheduled stays until the next account's first plan replaces it.
11. **The server columns** `daily_affirmations.scheduled_for` and `is_delivered` stay unused (the phone schedules; the app has no grant on them). The two `TODO(28)` comments in `lifecycle.ts` become plain statements; a later migration may drop the columns.
12. **The developer panel** gets "Affirmation notifications (dev)": the count and the next local day and time (read from the identifiers, no text), "Reschedule now (dev)" and "Test in 10 s (dev)" (one notification with the next planned title, headline and tap; identifier `aff-test-{ms}`, which a reschedule never cancels and sign-out does).
13. **Known limits**, reported, not decided: (a) a reflection saved on the phone and not yet screened (offline) does not stop the notifications of the reflection before it; once it is screened, a crisis result stops them at the next run; (b) a tap from a closed Expo Go cannot open the reflection (finding 10): the development build of step 35 shows it; (c) the notifications stop by themselves if the app is not opened for 7 days (the window is refilled only when the app comes to the front); (d) Android delivery may be minutes late without the exact-alarm permission, and Android was not run.

---

## 0. Before you write code

1. Read AGENTS.md: "Notification Rules", the vendor note "expo-notifications 58", "Local Cache & Offline Rules" and "Journal Data Rules" (the read cache), "Guided phone walk-through" and "Linting and Validation". Read these files: `src/services/notifications.ts`, `src/services/permissions.ts`, `src/store/onboardingStore.ts`, `src/store/profilePrefsStore.ts`, `src/store/offlineStore.ts`, `src/services/profileSync.ts`, `src/services/syncEngine.ts` (its `finished` event), `src/services/account.ts`, `src/components/SupabaseAuthBridge.tsx`, `App.tsx`, `src/navigation/RootNavigator.tsx` and `types.ts`, `src/screens/journal/ReflectionScreen.tsx`, `src/components/ReflectionCarousel.tsx`, `src/screens/profile/ProfileScreen.tsx`, `src/hooks/useJournalHome.ts`, `src/data/journalRepository.ts` (`readLocalProfile`, `readMockProfile`, `readEntries`), `src/data/entriesLive.ts`, `src/db/database.ts` (`userHash`), and `supabase/tests/notifications/run.cjs` with its `world.cjs`.
2. **Baseline.** `node --version` must be 22.5 or newer. `npm run typecheck` and `npm run lint` must pass. These must already pass and are not touched by this step: `node --no-warnings supabase/tests/recording/run.cjs` (`68 passed, 0 failed`), `node --no-warnings supabase/tests/playback/run.cjs` (`133 checks passed`), `node --no-warnings supabase/tests/ambient/run.cjs` (`64 checks passed`), `node --no-warnings supabase/tests/journal-data/run.cjs` (`86 checks passed`) and `node supabase/tests/process-entry/parity.cjs` (`7 of 7`). Write down `git status --short`: `src/`, `App.tsx`, `app.json`, `package.json`, `package-lock.json` and `supabase/functions/` must be clean. The review's own files may show as modified or new until they are committed: `AGENTS.md` and its copy, this prompt, `docs/legal-brief.md`, `assets/images/notification-icon.png`, `supabase/tests/notifications/`, `supabase/tests/journal-data/world.cjs`, `supabase/tests/offline/run.cjs` and `supabase/tests/profile-sync/run.cjs`.
3. **Red first.** Run the new checks and the two edited older ones, and see exactly this (the code of this step is not in yet):
   - `node --no-warnings supabase/tests/notifications/run.cjs` prints `2 checks passed, 46 FAILED`: 23 failures say `cannot resolve @/services/affirmationScheduler`, 10 `cannot resolve @/services/affirmationPlanner`, 4 `cannot resolve @/utils/zonedTime`, 3 `cannot resolve @/services/notificationRouting`, 3 that `repo.readAffirmationSource` or `repo.getKnownAffirmationsEnabled` is not a function, and 3 assertions (Journal never asks for a plan, `app.json`'s plugin options, and a `TODO(28)` left in `ProfileScreen.tsx`). The two that pass are the contract checks that are already true: only `notifications.ts` imports `expo-notifications`, and the icon file;
   - `node --no-warnings supabase/tests/offline/run.cjs` prints `1 of 44 FAILED` (the sign-out check, which now also expects the notifications to be cleared);
   - `node --no-warnings supabase/tests/profile-sync/run.cjs` prints `87 passed, 1 failed` (the account check, for the same reason).
4. List every `TODO(28)` with file:line (`grep -rn "TODO(28)" src supabase/functions`). Six today: `src/screens/profile/ProfileScreen.tsx` twice (reschedule after a reminder or the switch changes), `src/services/account.ts` (cancel at sign-out), `src/services/profileSync.ts` (reschedule after the server's times), and `supabase/functions/process-entry/lifecycle.ts` twice (`scheduled_for`, and a crisis entry). The edits below close each one, and `grep` must find none at the end.
5. **No install.** `package.json` and `package-lock.json` must be byte-identical at the end; `app.json` changes in one block only (2.16).

---

## 1. The files to create (verbatim)

Write each file exactly as given, with LF line endings.

### 1.1 `src/utils/zonedTime.ts`

Calendar days and reminder times in a named time zone, with Intl only (the method of `utils/week.ts`, which stays a copy of the server's week and is not touched).

```ts
// Calendar days and wall-clock times in a named time zone, for the affirmation notifications (step 28). Only Intl is used
// (Hermes has it, with time zones), the same way as utils/week.ts, which is a copy of the server's week and is left alone.

export type CalendarDay = { year: number; month: number; day: number };

type Wall = CalendarDay & { hour: number; minute: number; second: number };

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

// Throws a RangeError for a time zone that does not exist. hourCycle h23 keeps midnight "00" (hour12: false says "24").
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
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
  };
}

// A wall clock written as milliseconds as if it were UTC, so two of them can be compared.
function wallMs(w: Wall): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

// Seconds are all Intl gives, so the instant is cut to a whole second first.
function offsetMs(instantMs: number, zone: string): number {
  return wallMs(wall(instantMs, zone)) - Math.floor(instantMs / 1000) * 1000;
}

export function isTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

// The calendar day the clock of `zone` shows at this instant.
export function calendarDayIn(instant: Date, zone: string): CalendarDay {
  const { year, month, day } = wall(instant.getTime(), zone);
  return { year, month, day };
}

// The calendar day that is `days` after this one (negative: before).
export function addDays(day: CalendarDay, days: number): CalendarDay {
  const moved = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

// The instant at which the clock of `zone` reads `hhmm` ("HH:mm", 24-hour) on this day. Every offset the zone uses within a
// day of that time is tried and the earliest instant that reads it wins, so a time the clocks pass twice (the autumn change)
// is its first occurrence. A time the clocks jump over (the spring change) does not exist: it becomes the first minute after
// the jump, found by stepping a minute at a time from just before it.
export function instantAt(day: CalendarDay, hhmm: string, zone: string): Date {
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(3, 5));
  const target = Date.UTC(day.year, day.month - 1, day.day, hour, minute, 0);
  const offsets = new Set([offsetMs(target - DAY_MS, zone), offsetMs(target, zone), offsetMs(target + DAY_MS, zone)]);
  const candidates = [...offsets].map((offset) => target - offset).sort((a, b) => a - b);
  const exact = candidates.find((at) => wallMs(wall(at, zone)) === target);
  if (exact !== undefined) return new Date(exact);
  let at = Math.floor(candidates[0] / 60_000) * 60_000;
  while (wallMs(wall(at, zone)) < target) at += 60_000;
  return new Date(at);
}
```

### 1.2 `src/services/affirmationPlanner.ts`

The plan, with no side effect: which notifications the phone should hold, their identifiers, titles, headlines and tap data, and how a tap's data is read back.

```ts
import { AFFIRMATION_DAYS_AHEAD } from "@/constants/app";
import { copy } from "@/constants/copy";
import type { AffirmationSource, PermissionResult, TimeSlot } from "@/types";
import { addDays, calendarDayIn, instantAt, isTimeZone } from "@/utils/zonedTime";

// Which affirmation notifications the phone should hold (step 28), worked out with no side effect: the scheduler compares
// this plan with what is scheduled and changes only the difference.
//
// An identifier names the slot, the local day and time, and a short hash of everything else the notification carries (its
// instant, title, body, entry and account). iOS reports a scheduled date trigger back as a time interval, so the phone cannot
// be asked when a notification will fire: the identifier says it instead, and any change (a reminder time, the time zone,
// a newer reflection, another account) is a new identifier. The same plan gives the same identifiers, so a run that finds
// nothing changed schedules and cancels nothing.

export const AFFIRMATION_ID_PREFIX = "aff-";
const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];
const PLANNED_ID = /^aff-(morning|afternoon|evening)-\d{8}-\d{4}-[0-9a-f]{8}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const USER_HASH = /^[0-9a-f]{16}$/;

// What a notification carries for its tap (notificationRouting.ts reads it back with readTapData).
export type AffirmationTapData = { kind: "affirmation"; entryId: string; slot: TimeSlot; userHash: string };

export type PlannedAffirmation = {
  identifier: string;
  fireAt: Date;
  title: string; // "Morning affirmation"
  body: string; // the affirmation's headline: never its text, the person's words, the emotion or the verse
  data: AffirmationTapData;
};

export type PlanInput = {
  now: Date;
  timeZone: string;
  reminders: Record<TimeSlot, string>;
  enabled: boolean; // Profile's Daily Affirmations switch
  permission: PermissionResult;
  source: AffirmationSource | null; // the newest finished reflection on the phone, and its affirmations
  userHash: string;
  days?: number;
};

// FNV-1a, 32 bits: short, stable and enough to tell two plans apart (a collision only means one notification is kept).
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const pad = (value: number, size: number) => String(value).padStart(size, "0");

// Nothing is planned while the switch is off, the phone will not show notifications, there is no finished reflection, or the
// newest one is a crisis entry: then nothing at all is sent until a newer reflection is ready, and an older reflection's
// affirmations are not used either. A reflection without all three headlines is skipped the same way.
export function planAffirmations(input: PlanInput): PlannedAffirmation[] {
  const { source } = input;
  if (!input.enabled || input.permission !== "granted" || source === null || source.isCrisis) return [];
  if (!USER_HASH.test(input.userHash)) return [];
  const headlines = new Map<TimeSlot, string>();
  for (const affirmation of source.affirmations) headlines.set(affirmation.slot, affirmation.headline.trim());
  if (SLOTS.some((slot) => !headlines.get(slot))) return [];

  const zone = isTimeZone(input.timeZone) ? input.timeZone : "UTC";
  const today = calendarDayIn(input.now, zone);
  const plan: PlannedAffirmation[] = [];
  for (let offset = 0; offset < (input.days ?? AFFIRMATION_DAYS_AHEAD); offset += 1) {
    const day = addDays(today, offset);
    for (const slot of SLOTS) {
      const time = input.reminders[slot];
      if (!TIME.test(time)) continue;
      const fireAt = instantAt(day, time, zone);
      if (fireAt.getTime() <= input.now.getTime()) continue;
      const title = copy.notifications.affirmationTitle(copy.onboarding.rhythm.slots[slot].name);
      const body = headlines.get(slot) ?? "";
      const hash = fnv1a([fireAt.getTime(), title, body, source.entryId, input.userHash].join("|"));
      const stamp = `${day.year}${pad(day.month, 2)}${pad(day.day, 2)}-${time.replace(":", "")}`;
      plan.push({
        identifier: `${AFFIRMATION_ID_PREFIX}${slot}-${stamp}-${hash}`,
        fireAt,
        title,
        body,
        data: { kind: "affirmation", entryId: source.entryId, slot, userHash: input.userHash },
      });
    }
  }
  return plan.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

// An identifier the planner made. The scheduler only ever cancels these (and, at sign-out, anything with the prefix), never a
// notification it did not make.
export function isPlannedAffirmationId(identifier: string): boolean {
  return PLANNED_ID.test(identifier);
}

// The developer panel's test notification: it has the prefix, so sign-out clears it, but it is not planned, so a reschedule
// never cancels it before it fires.
export function testAffirmationId(nowMs: number): string {
  return `${AFFIRMATION_ID_PREFIX}test-${nowMs}`;
}

// A tapped notification's data, or null when it is not one of ours. Expo Go adds keys of its own (experienceId, scopeKey),
// so only these four are read.
export function readTapData(data: unknown): AffirmationTapData | null {
  if (typeof data !== "object" || data === null) return null;
  const { kind, entryId, slot, userHash } = data as Record<string, unknown>;
  if (kind !== "affirmation" || typeof entryId !== "string" || entryId.length === 0) return null;
  if (slot !== "morning" && slot !== "afternoon" && slot !== "evening") return null;
  if (typeof userHash !== "string" || !USER_HASH.test(userHash)) return null;
  return { kind, entryId, slot, userHash };
}
```

### 1.3 `src/services/affirmationScheduler.ts`

When to plan again, one run at a time, the difference applied, sign-out, and the developer panel's three helpers.

```ts
import { AppState } from "react-native";

import { AFFIRMATION_MIN_LEAD_MS, AFFIRMATION_RESCHEDULE_DEBOUNCE_MS } from "@/constants/app";
import { getKnownAffirmationsEnabled, readAffirmationSource } from "@/data/journalRepository";
import { getDeviceTimezone } from "@/data/mappers";
import { userHash } from "@/db/database";
import {
  AFFIRMATION_ID_PREFIX,
  isPlannedAffirmationId,
  planAffirmations,
  testAffirmationId,
  type PlannedAffirmation,
} from "@/services/affirmationPlanner";
import { setTapUser } from "@/services/notificationRouting";
import {
  cancelScheduled,
  dismissPresented,
  ensureAffirmationChannel,
  getNotificationPermission,
  listPresentedIds,
  listScheduledIds,
  notificationsAvailable,
  scheduleAt,
} from "@/services/notifications";
import { subscribe as subscribeToSync } from "@/services/syncEngine";
import { useOfflineStore } from "@/store/offlineStore";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";

// The daily affirmation notifications (step 28): local notifications only, made on this phone from the newest reflection it
// holds, at the reminder times, in the phone's time zone, for the next 7 days. The auth bridge starts it when a user signs in;
// it then plans again whenever something the plan reads may have changed (the app comes to the front, a reminder time, the
// Daily Affirmations switch, the user's database opening, a reflection finishing, Journal's first page) and changes only the
// difference. Coming to the front also refills the 7 days.
//
// - One run at a time; a request during a run runs it once more after. Requests are gathered for half a second.
// - A run that cannot read something it needs (the database is not open, the profile was never read on this phone, the cache
//   cannot be read) changes nothing: a bad read never cancels anyone's notifications.
// - Nothing is logged but a step that failed. Never a title, a headline, an id or a time.

let userId: string | null = null;
let hash: string | null = null;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
let stopWatching: (() => void) | null = null;

function note(step: string) {
  if (__DEV__) {
    console.info(`[affirmations] ${step}_failed`);
  }
}

async function attempt(step: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch {
    note(step);
  }
}

type PrefsState = ReturnType<typeof useProfilePrefsStore.getState>;

function enabledFor(state: PrefsState, id: string): boolean | null {
  const entry = state.byUser[id];
  return entry?.unsent.affirmationsEnabled ?? entry?.snapshot?.affirmationsEnabled ?? null;
}

export function startAffirmationSchedule(signedInUserId: string): void {
  stopAffirmationSchedule();
  const mine = generation;
  userId = signedInUserId;
  userHash(signedInUserId).then(
    (value) => {
      if (mine !== generation) return;
      hash = value;
      setTapUser(value);
      requestAffirmationReschedule();
    },
    () => note("hash"),
  );
  const appState = AppState.addEventListener("change", (status) => {
    if (status === "active") requestAffirmationReschedule();
  });
  const unsubscribers = [
    () => appState.remove(),
    useOnboardingStore.subscribe((state, previous) => {
      if (state.reminders !== previous.reminders) requestAffirmationReschedule();
    }),
    useProfilePrefsStore.subscribe((state, previous) => {
      if (enabledFor(state, signedInUserId) !== enabledFor(previous, signedInUserId)) requestAffirmationReschedule();
    }),
    useOfflineStore.subscribe((state, previous) => {
      if (state.dbReady && !previous.dbReady) requestAffirmationReschedule();
    }),
    subscribeToSync((event) => {
      if (event.type === "finished") requestAffirmationReschedule();
    }),
  ];
  stopWatching = () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

// The session ended (sign-out, or another account signs in). Planning stops and nothing more is written; what is scheduled
// stays until clearAffirmations or the next account's first plan replaces it.
export function stopAffirmationSchedule(): void {
  generation += 1;
  stopWatching?.();
  stopWatching = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  userId = null;
  hash = null;
  setTapUser(null);
}

// Plans again shortly (the requests of the next half second are one run). Also called by Journal when its first page has
// come (the newest reflection may have changed on the server) and by Profile when notifications are allowed.
export function requestAffirmationReschedule(): void {
  if (userId === null) return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, AFFIRMATION_RESCHEDULE_DEBOUNCE_MS);
}

function run(): Promise<void> {
  if (running !== null) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again && userId !== null);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function currentPlan(): Promise<PlannedAffirmation[] | null> {
  const id = userId;
  const h = hash;
  if (id === null || h === null || !notificationsAvailable()) return null;
  if (!useOfflineStore.getState().dbReady) return null;
  const enabled = getKnownAffirmationsEnabled(id);
  if (enabled === null) return null;
  let source;
  try {
    source = await readAffirmationSource();
  } catch {
    note("read");
    return null;
  }
  const permission = await getNotificationPermission();
  return planAffirmations({
    now: new Date(Date.now()),
    timeZone: getDeviceTimezone(),
    reminders: useOnboardingStore.getState().reminders,
    enabled,
    permission,
    source,
    userHash: h,
  });
}

async function runOnce(): Promise<void> {
  const mine = generation;
  const plan = await currentPlan();
  if (plan === null || mine !== generation) return;
  let scheduled: string[];
  try {
    scheduled = (await listScheduledIds()).filter(isPlannedAffirmationId);
  } catch {
    note("list");
    return;
  }
  const wanted = new Set(plan.map((item) => item.identifier));
  const have = new Set(scheduled);
  for (const identifier of scheduled) {
    if (wanted.has(identifier)) continue;
    if (mine !== generation) return;
    await attempt("cancel", () => cancelScheduled(identifier));
  }
  // A notification about to fire that is not scheduled yet is left out: iOS refuses a time that has passed.
  const missing = plan.filter(
    (item) => !have.has(item.identifier) && item.fireAt.getTime() - Date.now() >= AFFIRMATION_MIN_LEAD_MS,
  );
  if (missing.length > 0) await ensureAffirmationChannel();
  for (const item of missing) {
    if (mine !== generation) return;
    await attempt("schedule", () => scheduleAt(item));
  }
}

// Sign-out and account deletion (signOutCleanup): planning stops, a run still in the air finishes, then every notification of
// ours is cancelled and the ones in the notification center are removed.
export async function clearAffirmations(): Promise<void> {
  stopAffirmationSchedule();
  if (running !== null) await running.catch(() => undefined);
  if (!notificationsAvailable()) return;
  try {
    for (const identifier of await listScheduledIds()) {
      if (identifier.startsWith(AFFIRMATION_ID_PREFIX)) await attempt("cancel", () => cancelScheduled(identifier));
    }
  } catch {
    note("list");
  }
  try {
    for (const identifier of await listPresentedIds()) {
      if (identifier.startsWith(AFFIRMATION_ID_PREFIX)) await attempt("dismiss", () => dismissPresented(identifier));
    }
  } catch {
    note("presented");
  }
}

// ---- for the developer panel -----------------------------------------------------------------------------------------------

// How many are scheduled and the earliest one's local day and time ("2026-10-29 08:00"), read from the identifiers
// ("aff-morning-20261029-0800-1a2b3c4d"). No text.
export async function getAffirmationScheduleSummary(): Promise<{ count: number; next: string | null }> {
  const stamps = (await listScheduledIds())
    .filter(isPlannedAffirmationId)
    .map((identifier) => identifier.slice(-22, -9))
    .sort();
  const first = stamps[0];
  if (first === undefined) return { count: 0, next: null };
  const date = `${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}`;
  return { count: stamps.length, next: `${date} ${first.slice(9, 11)}:${first.slice(11, 13)}` };
}

// Plans now, without waiting for the half second.
export function rescheduleAffirmationsNow(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  return run();
}

// One notification in `delayMs`, with the next planned one's title, headline and tap: false when there is nothing to plan.
export async function scheduleTestAffirmation(delayMs: number): Promise<boolean> {
  const plan = await currentPlan();
  const next = plan?.[0];
  if (next === undefined) return false;
  try {
    await scheduleAt({ ...next, identifier: testAffirmationId(Date.now()), fireAt: new Date(Date.now() + delayMs) });
    return true;
  } catch {
    note("test");
    return false;
  }
}
```

### 1.4 `src/services/notificationRouting.ts`

The foreground presentation, the tap listener, the tap that opened the app, and opening Reflection once the signed-in screens and the account are there.

```ts
import { navigationRef } from "@/navigation/navigationRef";
import { readTapData, type AffirmationTapData } from "@/services/affirmationPlanner";
import { addTapListener, showNotificationsQuietly, takeLastTap, type NotificationTap } from "@/services/notifications";

// A tapped affirmation notification opens its reflection on the Affirmations tab (step 28), and never starts the devotional or
// the ambient sound. A tap is held until the signed-in screens are up and the account is known: when the app was closed the
// tap arrives before the fonts, Clerk and the navigator have loaded. A tap from another account's notification opens nothing.

let tapUser: string | null = null; // the signed-in account's hash (database.ts userHash), set by the scheduler
let pending: AffirmationTapData | null = null;
const handled: string[] = []; // the listener and the last response can both report one tap: it is acted on once

// Once, when the app starts (App.tsx). The tap that opened the app is read here; later taps come through the listener.
export function startNotificationRouting(): () => void {
  showNotificationsQuietly();
  const stop = addTapListener(receive);
  const opening = takeLastTap();
  if (opening !== null) receive(opening);
  return stop;
}

function receive(tap: NotificationTap): void {
  if (handled.includes(tap.key)) return;
  handled.push(tap.key);
  if (handled.length > 20) handled.shift();
  const data = readTapData(tap.data);
  if (data === null) return;
  pending = data;
  openPendingTap();
}

// The scheduler sets the account when a user signs in and clears it when the session ends.
export function setTapUser(hash: string | null): void {
  tapUser = hash;
  openPendingTap();
}

// Also called by the NavigationContainer when it is ready and when its state changes (the signed-in screens mounting).
export function openPendingTap(): void {
  if (pending === null || tapUser === null || !navigationRef.isReady()) return;
  if (!navigationRef.getRootState()?.routeNames.includes("Reflection")) return;
  const tap = pending;
  pending = null;
  if (tap.userHash !== tapUser) return;
  // TODO(34): affirmation_notification_opened { slot }
  navigationRef.navigate("Reflection", { entryId: tap.entryId, tab: "affirmations" });
}
```

### 1.5 `src/navigation/navigationRef.ts`

```ts
import { createNavigationContainerRef } from "@react-navigation/native";

import type { RootStackParamList } from "./types";

// The app's one NavigationContainer, for code outside a screen: a tapped affirmation notification opens its reflection
// (step 28, services/notificationRouting.ts).
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
```

---

## 2. Edits to the existing files

Each edit is a "Find" block that occurs exactly once in the file and the "Replace with" block that takes its place. Keep each file's line endings: these use CRLF: `src/types/index.ts`, `src/constants/app.ts`, `src/constants/copy.ts`, `src/data/journalRepository.ts`, `src/navigation/types.ts`, `src/screens/journal/ReflectionScreen.tsx`, `src/components/SupabaseAuthBridge.tsx`, `src/services/account.ts`, `src/services/profileSync.ts`, `src/screens/profile/ProfileScreen.tsx`, `src/components/dev/DevToolsPanel.tsx` and `App.tsx`; these use LF: `src/services/notifications.ts`, `src/data/entriesLive.ts`, `src/components/ReflectionCarousel.tsx`, `src/hooks/useJournalHome.ts`, `app.json` and `supabase/functions/process-entry/lifecycle.ts`. A multi-line find in a CRLF file is easiest to apply with a small script that matches on the LF text and writes CRLF back (AGENTS.md, "Verifying on this machine", the note on line endings).

### 2.1 `src/types/index.ts`

a) Find:

```ts
export interface Affirmation {
  id: string;
  entryId: string;
  slot: TimeSlot;
  headline: string;
  text: string;
  isFavorite: boolean;
}
```

Replace with:

```ts
export interface Affirmation {
  id: string;
  entryId: string;
  slot: TimeSlot;
  headline: string;
  text: string;
  isFavorite: boolean;
}

// What the affirmation notifications are made from (step 28): the newest finished reflection on the phone and, when it is not
// a crisis entry, its affirmations (a crisis entry has none).
export type AffirmationSource = { entryId: string; isCrisis: boolean; affirmations: Affirmation[] };

// The tabs of Reflection's carousel. A notification opens Reflection on "affirmations" (step 28).
export type ReflectionTab = "devotional" | "affirmations" | "prayer";
```

### 2.2 `src/constants/app.ts`

a) Find:

```ts
// The Android notification channel for the three daily affirmations (step 28 reuses it).
export const AFFIRMATION_CHANNEL_ID = "affirmations";
```

Replace with:

```ts
// The Android notification channel for the three daily affirmations (step 28 reuses it).
export const AFFIRMATION_CHANNEL_ID = "affirmations";
// The affirmation notifications (step 28): the days the phone schedules ahead (refilled whenever the app comes to the front),
// the least time before a notification that one can still be scheduled (iOS refuses a time that has passed), and how long
// requests to plan again are gathered into one run.
export const AFFIRMATION_DAYS_AHEAD = 7;
export const AFFIRMATION_MIN_LEAD_MS = 10_000;
export const AFFIRMATION_RESCHEDULE_DEBOUNCE_MS = 500;
```

### 2.3 `src/constants/copy.ts`

a) Find:

```ts
  notifications: {
    // The Android channel name, shown in the system notification settings.
    channelName: "Daily affirmations",
  },
```

Replace with:

```ts
  notifications: {
    // The Android channel name, shown in the system notification settings.
    channelName: "Daily affirmations",
    // An affirmation notification's title, the same words as the Journal card's eyebrow: "Morning affirmation". Its body is
    // the affirmation's headline (step 28): the lock screen shows nothing else.
    affirmationTitle: (slotName: string) => `${slotName} affirmation`,
  },
```

### 2.4 `src/services/notifications.ts` (whole file)

The step 07 part is unchanged (the guard, the channel and the two permission functions). The new part is the small set of calls the scheduler and the routing need; this stays the only file that imports `expo-notifications`.

```ts
import { isRunningInExpoGo } from "expo";
import type { NotificationPermissionsStatus, NotificationResponse } from "expo-notifications";
import { Platform } from "react-native";

import { AFFIRMATION_CHANNEL_ID } from "@/constants/app";
import { copy } from "@/constants/copy";
import type { PermissionResult } from "@/types";

import { toPermissionResult } from "./permissions";

// Expo Go on Android does not register ExpoTopicSubscriptionModule, so importing expo-notifications
// there throws at startup (Expo Go 57.0.9, expo-notifications 57.0.23). Only that case is skipped, and
// every function below then answers "undetermined" without a prompt. A development build and iOS
// always load the module, so a real failure there is never hidden. Step 05b checks the Android prompt
// and channel on a development build. This file is the only one that imports expo-notifications.
const Notifications: typeof import("expo-notifications") | null =
  Platform.OS === "android" && isRunningInExpoGo()
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports -- a top-level import would crash Expo Go on Android
      require("expo-notifications");

function warn(message: string, error: unknown) {
  if (__DEV__) {
    console.warn(`[notifications] ${message}`, error);
  }
}

// iOS provisional (quiet) delivery counts as granted: step 28 relies on it.
function toNotificationResult(response: NotificationPermissionsStatus): PermissionResult {
  if (Notifications && response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return "granted";
  }
  return toPermissionResult(response);
}

// Android only. On Android 13+ the channel must exist before the permission request, otherwise the
// system prompt never appears.
export async function ensureAffirmationChannel(): Promise<void> {
  if (!Notifications || Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(AFFIRMATION_CHANNEL_ID, {
      name: copy.notifications.channelName,
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
  } catch (error) {
    warn("could not create the affirmation channel", error);
  }
}

export async function getNotificationPermission(): Promise<PermissionResult> {
  if (!Notifications) return "undetermined";
  try {
    return toNotificationResult(await Notifications.getPermissionsAsync());
  } catch (error) {
    warn("could not read the notification permission", error);
    return "undetermined";
  }
}

export async function requestNotificationPermission(): Promise<PermissionResult> {
  if (!Notifications) return "undetermined";
  try {
    await ensureAffirmationChannel();
    return toNotificationResult(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      }),
    );
  } catch (error) {
    warn("could not request the notification permission", error);
    return "undetermined";
  }
}

// ---- local notifications (step 28) ---------------------------------------------------------------------------------------
// What the affirmation scheduler and the tap routing need, and nothing more. Where the module is skipped each one does nothing
// or answers empty. The scheduling calls throw, so the scheduler can tell a failure from an empty answer.

export function notificationsAvailable(): boolean {
  return Notifications !== null;
}

// The identifiers of every notification waiting to be shown. In Expo Go this lists the other projects' too (Expo Go scopes each
// identifier, and hands it back without its scope), so callers only touch identifiers of their own.
export async function listScheduledIds(): Promise<string[]> {
  if (!Notifications) return [];
  const requests = await Notifications.getAllScheduledNotificationsAsync();
  return requests.map((request) => request.identifier);
}

export async function cancelScheduled(identifier: string): Promise<void> {
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

// One notification at an instant. On iOS a date trigger is a time interval counted from now, so the instant must still be ahead.
// On Android it goes to the affirmation channel, and arrives a few minutes late when the phone saves battery (no exact alarm).
export async function scheduleAt(request: {
  identifier: string;
  fireAt: Date;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<void> {
  if (!Notifications) return;
  await Notifications.scheduleNotificationAsync({
    identifier: request.identifier,
    content: { title: request.title, body: request.body, data: request.data, sound: "default" },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: request.fireAt,
      channelId: AFFIRMATION_CHANNEL_ID,
    },
  });
}

// The notifications in the notification center (shown, not yet opened or cleared).
export async function listPresentedIds(): Promise<string[]> {
  if (!Notifications) return [];
  const shown = await Notifications.getPresentedNotificationsAsync();
  return shown.map((notification) => notification.request.identifier);
}

export async function dismissPresented(identifier: string): Promise<void> {
  if (!Notifications) return;
  await Notifications.dismissNotificationAsync(identifier);
}

// While the app is open a notification still shows as a banner and in the list, but quietly: no sound and no badge.
export function showNotificationsQuietly(): void {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// A tap on a notification: its data and a key that names this delivery of it, because the listener and the last response
// can both report the same tap. Any other action (none exists) is ignored.
export type NotificationTap = { key: string; data: unknown };

function toTap(response: NotificationResponse): NotificationTap | null {
  if (!Notifications || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const { request, date } = response.notification;
  return { key: `${request.identifier}@${date}`, data: request.content.data };
}

export function addTapListener(listener: (tap: NotificationTap) => void): () => void {
  if (!Notifications) return () => undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const tap = toTap(response);
    if (tap !== null) listener(tap);
  });
  return () => subscription.remove();
}

// The tap that opened the app, if one did and nothing has taken it yet. It is cleared as it is taken, so it is acted on once.
export function takeLastTap(): NotificationTap | null {
  if (!Notifications) return null;
  try {
    const response = Notifications.getLastNotificationResponse();
    if (response === null) return null;
    Notifications.clearLastNotificationResponse();
    return toTap(response);
  } catch (error) {
    warn("could not read the last notification tap", error);
    return null;
  }
}
```

### 2.5 `src/data/entriesLive.ts`

a) Find:

```ts
import type { Affirmation, JournalEntry, RepoResult, TimeSlot } from "@/types";
```

Replace with:

```ts
import type { Affirmation, AffirmationSource, JournalEntry, RepoResult, TimeSlot } from "@/types";
```

b) Find:

```ts
// The affirmations of the newest finished, non-crisis entry the phone has.
export async function readCachedLatestAffirmations(): Promise<Affirmation[]> {
  const latest = await cachedNewestReady();
  return latest === null ? [] : readCachedAffirmations(latest.id);
}
```

Replace with:

```ts
// The affirmations of the newest finished, non-crisis entry the phone has.
export async function readCachedLatestAffirmations(): Promise<Affirmation[]> {
  const latest = await cachedNewestReady();
  return latest === null ? [] : readCachedAffirmations(latest.id);
}

// The newest finished entry the phone has, a crisis entry included, and its affirmations (step 28's notifications). Unlike the
// reads above it throws when the cache cannot be read (a closed database included): a bad read must not look like "no
// reflection", which would cancel the notifications. An entry still being prepared is not finished, so it never counts.
export async function readCachedAffirmationSource(): Promise<AffirmationSource | null> {
  const entries = await cache.listEntries(LATEST_LOOKBACK);
  const now = Date.now();
  const latest = entries.find((entry) => entry.status === "ready" && isListedEntry(entry, now));
  if (latest === undefined) return null;
  if (latest.isCrisis) return { entryId: latest.id, isCrisis: true, affirmations: [] };
  const affirmations = await cache.listAffirmationsForEntry(latest.id);
  return { entryId: latest.id, isCrisis: false, affirmations };
}
```

### 2.6 `src/data/journalRepository.ts`

a) Find:

```ts
import type {
  Affirmation,
  HomeEntry,
```

Replace with:

```ts
import type {
  Affirmation,
  AffirmationSource,
  HomeEntry,
```

b) Find:

```ts
export async function readCachedLatestAffirmations(): Promise<Affirmation[]> {
  return getDataSource() === "mock" ? [] : live.readCachedLatestAffirmations();
}
```

Replace with:

```ts
export async function readCachedLatestAffirmations(): Promise<Affirmation[]> {
  return getDataSource() === "mock" ? [] : live.readCachedLatestAffirmations();
}

// What the affirmation notifications are made from (step 28): the newest finished entry this phone has, a crisis entry
// included (so that nothing is scheduled after one), with its affirmations when it is not one. Null when there is none. It
// reads this phone only, never the network, and the real source throws when the cache cannot be read, so the scheduler then
// changes nothing. The mock data's own rows in development.
export async function readAffirmationSource(): Promise<AffirmationSource | null> {
  if (getDataSource() === "mock") {
    const latest = readEntries().find((entry) => entry.status === "ready");
    if (latest === undefined) return null;
    const affirmations = latest.isCrisis ? [] : readAffirmations(latest.id);
    return { entryId: latest.id, isCrisis: latest.isCrisis, affirmations };
  }
  return live.readCachedAffirmationSource();
}

// The Daily Affirmations switch as this phone knows it, with no waiting: null until the profile has been read on this phone
// (the scheduler plans nothing until then). The mock data's own row in development.
export function getKnownAffirmationsEnabled(userId: string): boolean | null {
  if (getDataSource() === "mock") return readMockProfile().affirmationsEnabled;
  return readLocalProfile(userId)?.affirmationsEnabled ?? null;
}
```

### 2.7 `src/navigation/types.ts`

a) Find:

```ts
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
```

Replace with:

```ts
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { ReflectionTab } from "@/types";
```

b) Find:

```ts
  Reflection: { entryId: string };
```

Replace with:

```ts
  // `tab` opens the carousel on that tab: a tapped affirmation notification passes "affirmations" (step 28).
  Reflection: { entryId: string; tab?: ReflectionTab };
```

### 2.8 `src/components/ReflectionCarousel.tsx`

a) Find:

```tsx
import type { Affirmation, Devotional, TimeSlot } from "@/types";
```

Replace with:

```tsx
import type { Affirmation, Devotional, ReflectionTab, TimeSlot } from "@/types";
```

b) Find:

```tsx
} satisfies Record<TimeSlot, SymbolViewProps["name"]>;

// Exactly these values: step 28 opens the carousel on one of them.
type Tab = "devotional" | "affirmations" | "prayer";
```

Replace with:

```tsx
} satisfies Record<TimeSlot, SymbolViewProps["name"]>;
```

c) Find:

```tsx
  currentSlot: TimeSlot;
};

// Devotional, Affirmations and Closing Prayer in one card. Only the selected pane is rendered, and it
// fades in when the tab changes. An entry without a closing prayer has two tabs.
export function ReflectionCarousel({
  devotional,
  affirmations,
  reminders,
  currentSlot,
}: ReflectionCarouselProps) {
  const [tab, setTab] = useState<Tab>("devotional");
```

Replace with:

```tsx
  currentSlot: TimeSlot;
  initialTab?: ReflectionTab;
};

// Devotional, Affirmations and Closing Prayer in one card. Only the selected pane is rendered, and it
// fades in when the tab changes. An entry without a closing prayer has two tabs. It opens on `initialTab`
// (a tapped affirmation notification, step 28), else on the devotional.
export function ReflectionCarousel({
  devotional,
  affirmations,
  reminders,
  currentSlot,
  initialTab,
}: ReflectionCarouselProps) {
  const [tab, setTab] = useState<ReflectionTab>(initialTab ?? "devotional");
```

d) Find:

```tsx
  const items: { value: Tab; label: string }[] = [
```

Replace with:

```tsx
  const items: { value: ReflectionTab; label: string }[] = [
```

### 2.9 `src/screens/journal/ReflectionScreen.tsx`

a) Find:

```tsx
import type { Affirmation, Devotional, JournalEntry, Scripture, TimeSlot, UserProfile } from "@/types";
```

Replace with:

```tsx
import type {
  Affirmation,
  Devotional,
  JournalEntry,
  ReflectionTab,
  Scripture,
  TimeSlot,
  UserProfile,
} from "@/types";
```

b) Find:

```tsx
  currentSlot: TimeSlot;
  onOpenPlayer: () => void;
  onReturn: () => void;
};

// A finished entry with a devotional. The screen gives it key={entry.id}, so another entry starts from
// its own prayer toggle, tab and expanded state.
function ReadyView({
  entry,
  devotional,
  affirmations,
  profile,
  currentSlot,
  onOpenPlayer,
  onReturn,
```

Replace with:

```tsx
  currentSlot: TimeSlot;
  initialTab: ReflectionTab | undefined;
  onOpenPlayer: () => void;
  onReturn: () => void;
};

// A finished entry with a devotional. The screen keys it by the entry and the tab it was opened on, so another
// entry starts from its own prayer toggle, tab and expanded state, and a tapped notification for the reflection
// that is already open turns it to Affirmations (step 28).
function ReadyView({
  entry,
  devotional,
  affirmations,
  profile,
  currentSlot,
  initialTab,
  onOpenPlayer,
  onReturn,
```

c) Find:

```tsx
          reminders={profile.reminders}
          currentSlot={currentSlot}
        />
```

Replace with:

```tsx
          reminders={profile.reminders}
          currentSlot={currentSlot}
          initialTab={initialTab}
        />
```

d) Find:

```tsx
        key={state.entry.id}
```

Replace with:

```tsx
        key={`${state.entry.id}:${route.params.tab ?? ""}`}
```

e) Find:

```tsx
        currentSlot={state.currentSlot}
```

Replace with:

```tsx
        currentSlot={state.currentSlot}
        initialTab={route.params.tab}
```

### 2.10 `App.tsx`

a) Find:

```tsx
import { RootNavigator } from "@/navigation/RootNavigator";
```

Replace with:

```tsx
import { RootNavigator } from "@/navigation/RootNavigator";
import { navigationRef } from "@/navigation/navigationRef";
import { openPendingTap, startNotificationRouting } from "@/services/notificationRouting";
```

b) Find:

```tsx
    if (__DEV__ && error) console.warn(`[fonts] ${error.message}`);
  }, [error]);
```

Replace with:

```tsx
    if (__DEV__ && error) console.warn(`[fonts] ${error.message}`);
  }, [error]);

  // From the very start, so the tap on a notification that opened the app is not lost: the reflection opens once the
  // signed-in screens are up (step 28).
  useEffect(() => startNotificationRouting(), []);
```

c) Find:

```tsx
      <NavigationContainer>
```

Replace with:

```tsx
      <NavigationContainer ref={navigationRef} onReady={openPendingTap} onStateChange={openPendingTap}>
```

### 2.11 `src/components/SupabaseAuthBridge.tsx`

a) Find:

```tsx
import { startConnectivity, stopConnectivity } from "@/services/connectivity";
```

Replace with:

```tsx
import { startAffirmationSchedule, stopAffirmationSchedule } from "@/services/affirmationScheduler";
import { startConnectivity, stopConnectivity } from "@/services/connectivity";
```

b) Find:

```tsx
    const stopWatchingPlan = watchPlan(signedInUserId);
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") syncProfileOnForeground();
    });
    return () => {
      subscription.remove();
      stopWatchingReminders();
      stopWatchingPlan();
    };
```

Replace with:

```tsx
    const stopWatchingPlan = watchPlan(signedInUserId);
    // The daily affirmation notifications follow this account until the session ends (step 28).
    startAffirmationSchedule(signedInUserId);
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") syncProfileOnForeground();
    });
    return () => {
      subscription.remove();
      stopWatchingReminders();
      stopWatchingPlan();
      stopAffirmationSchedule();
    };
```

### 2.12 `src/services/account.ts`

a) Find:

```ts
import { deleteAllDevotionalAudio } from "@/services/devotionalAudio";
```

Replace with:

```ts
import { clearAffirmations } from "@/services/affirmationScheduler";
import { deleteAllDevotionalAudio } from "@/services/devotionalAudio";
```

b) Find:

```ts
  // TODO(28): cancel the scheduled affirmation notifications
```

Replace with:

```ts
  // The affirmation notifications this account scheduled, and the ones still in the notification center (step 28): an
  // affirmation must not reach the phone, or open, after its account has gone.
  await clearAffirmations();
```

### 2.13 `src/services/profileSync.ts`

a) Find:

```ts
    onboarding.applyServerReminders(server.reminders);
    // TODO(28): reschedule the affirmation notifications for the new times
```

Replace with:

```ts
    // The affirmation notifications follow the onboarding store's times, so they move with these (step 28).
    onboarding.applyServerReminders(server.reminders);
```

### 2.14 `src/screens/profile/ProfileScreen.tsx`

a) Find:

```tsx
import { deleteAccount, requestDataExport, signOutCleanup } from "@/services/account";
```

Replace with:

```tsx
import { deleteAccount, requestDataExport, signOutCleanup } from "@/services/account";
import { requestAffirmationReschedule } from "@/services/affirmationScheduler";
```

b) Find:

```tsx
  // TODO(28): reschedule the affirmation notifications
  function changeReminder(hhmm: string) {
```

Replace with:

```tsx
  // The affirmation notifications follow the new time by themselves: the scheduler watches the reminder times (step 28).
  function changeReminder(hhmm: string) {
```

c) Find:

```tsx
      hideNotice("saveAffirmations", "saveAmbient");
      // TODO(28): reschedule or cancel the affirmation notifications
```

Replace with:

```tsx
      hideNotice("saveAffirmations", "saveAmbient");
      // Off cancels the affirmation notifications and on schedules them again (step 28).
      requestAffirmationReschedule();
```

d) Find:

```tsx
  async function allowNotifications() {
    await requestNotificationPermission();
```

Replace with:

```tsx
  async function allowNotifications() {
    await requestNotificationPermission();
    requestAffirmationReschedule();
```

### 2.15 `src/hooks/useJournalHome.ts`

a) Find:

```ts
import { startOfflineSession } from "@/services/offlineSession";
```

Replace with:

```ts
import { requestAffirmationReschedule } from "@/services/affirmationScheduler";
import { startOfflineSession } from "@/services/offlineSession";
```

b) Find:

```ts
        if (!page.ok) throw new Error(page.code);
        const affirmations = await getLatestAffirmations();
```

Replace with:

```ts
        if (!page.ok) throw new Error(page.code);
        // The newest reflection may be new to this phone (made on another phone, or a crisis entry): the affirmation
        // notifications are planned again from what the phone now holds (step 28).
        requestAffirmationReschedule();
        const affirmations = await getLatestAffirmations();
```

### 2.16 `app.json`

a) Find:

```text
      ["expo-notifications", { "color": "#5B3A5E" }]
```

Replace with:

```text
      [
        "expo-notifications",
        {
          "icon": "./assets/images/notification-icon.png",
          "color": "#5B3A5E",
          "enableRemoteNotifications": false
        }
      ]
```

### 2.17 `src/components/dev/DevToolsPanel.tsx`

a) Find:

```tsx
import { signOutCleanup } from "@/services/account";
```

Replace with:

```tsx
import { signOutCleanup } from "@/services/account";
import {
  getAffirmationScheduleSummary,
  rescheduleAffirmationsNow,
  scheduleTestAffirmation,
} from "@/services/affirmationScheduler";
```

b) Find:

```tsx
  const [recordingBusy, setRecordingBusy] = useState(false);
```

Replace with:

```tsx
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [affirmationLines, setAffirmationLines] = useState<string[]>(["affirmations: …"]);
  const [affirmationBusy, setAffirmationBusy] = useState(false);
```

c) Find:

```tsx
  // The session goes first, and the cleanup before it, as in Profile's own Sign out.
```

Replace with:

```tsx
  // Step 28: how many affirmation notifications are scheduled and the next one's local day and time. Never a title or a
  // headline. "Reschedule" plans now; "Test in 10 s" sends one with the next planned title, headline and tap.
  async function showAffirmations(result: string | null) {
    const summary = await getAffirmationScheduleSummary().catch(() => null);
    const line =
      summary === null
        ? "affirmations: could not read"
        : `affirmations scheduled: ${summary.count}, next: ${summary.next ?? "none"}`;
    setAffirmationLines(result === null ? [line] : [line, result]);
  }

  async function rescheduleAffirmations() {
    setAffirmationBusy(true);
    await rescheduleAffirmationsNow();
    await showAffirmations("rescheduled");
    setAffirmationBusy(false);
  }

  async function testAffirmation() {
    setAffirmationBusy(true);
    const sent = await scheduleTestAffirmation(10_000);
    await showAffirmations(sent ? "test: in 10 s" : "test: nothing to send (switch, permission or reflection)");
    setAffirmationBusy(false);
  }

  // The session goes first, and the cleanup before it, as in Profile's own Sign out.
```

d) Find:

```tsx
                onPress={() => setNotificationStatusOverride(name === "real" ? null : name)}
              />
            ))}
          </View>
        </View>
```

Replace with:

```tsx
                onPress={() => setNotificationStatusOverride(name === "real" ? null : name)}
              />
            ))}
          </View>
        </View>
        <View className="items-center gap-2">
          <Text className="text-center text-body-sm text-mauve">Affirmation notifications (dev)</Text>
          {affirmationLines.map((line) => (
            <Text key={line} className="text-center text-body-sm text-ink">
              {line}
            </Text>
          ))}
          <View className="flex-row flex-wrap justify-center gap-2">
            <DevButton label="Show (dev)" disabled={affirmationBusy} onPress={() => void showAffirmations(null)} />
            <DevButton label="Reschedule now (dev)" disabled={affirmationBusy} onPress={rescheduleAffirmations} />
            <DevButton label="Test in 10 s (dev)" disabled={affirmationBusy} onPress={testAffirmation} />
          </View>
        </View>
```

### 2.18 `supabase/functions/process-entry/lifecycle.ts`

Comments only: the hosted function is not redeployed.

a) Find:

```ts
  // TODO(28): scheduled_for and is_delivered stay unset, because the phone schedules the notifications; step 28
  // confirms that with the user and closes this note.
```

Replace with:

```ts
  // scheduled_for and is_delivered stay unset: the phone schedules the affirmation notifications itself (step 28), so the
  // two columns are unused.
```

b) Find:

```ts
// TODO(28): never schedule affirmations for a crisis entry (it has none, and the phone must not make any up).
```

Replace with:

```ts
// It gets no affirmations, so the phone schedules no notification for it, and none for an older reflection after it either
// (step 28): nothing is sent until a newer reflection is ready.
```

---

## 3. The checks the review created (`supabase/tests/notifications/`)

`world.cjs` fakes `expo-notifications` 58 as iOS and as Android behave (iOS refuses a date that has passed and reports a scheduled date trigger back without its date; in Expo Go the scheduled list holds other projects' notifications too; taps reach the listener and the last response; a call can be made slow, or fail), plus the navigation ref, the sync engine's events and a repository whose newest reflection a check sets. `run.cjs` runs the app's real `zonedTime`, planner, scheduler, routing, notifications service and stores on top, on the virtual clock of the recording checks, so a week takes no real time; its repository checks load the step 25 world, so `readAffirmationSource()` reads the real SQLite cache. The groups: `zone:` (4), `plan:` (9), `schedule` (21, two of them once per platform), `tap:` (6), `repository:` (4) and `contract:` (4), 48 in all. They are in the repo already: do not change them. `ONLY=<text>` runs the checks whose name holds that text, `FAILFAST=1` stops at the first failure, `TIMINGS=1` prints each check's time.

### 3.1 The older checks (already edited in the repo)

`account.ts` now imports the scheduler and `useJournalHome.ts` asks it to plan again, and plain Node cannot load `expo-notifications`. So: `supabase/tests/offline/run.cjs` fakes `@/services/affirmationScheduler` in its sign-out check and expects the notifications cleared once; `supabase/tests/profile-sync/run.cjs` fakes it in both of its environments and expects one clear at sign-out and a second at account deletion; `supabase/tests/journal-data/world.cjs` fakes it with a counter (`affirmationRequests()`) that the `repository:` checks read. None of their other checks changed, and their counts stay 44, 88 and 86.

### 3.2 The breakages

The review broke the code 59 ways, one line at a time, in a copy of the repo, and ran the checks each time: all 59 were caught by a named check (the review's runner is not part of the repo). They cover each rule of the time zones, every reason the plan is empty, the hash's five parts, the identifier pattern, each trigger of the scheduler, the half-second gathering and the run that runs again, the generation that stops a run at sign-out, the wait for a run in the air, the cancel-only-our-own rules, the 10-second lead, the channel and the sound, the tap's action, user and screens checks, the dedupe, the quiet banner, the repository's two reads, Journal's request, and the sign-out line in `account.ts`. Two first drafts of breakages were equivalent to the code (they changed nothing that can be observed) and were replaced; one showed a redundant guard, which the review deleted.

---

## 4. AGENTS.md updates

Make these, then copy AGENTS.md over `prompts/AGENTS.md` (`cmp` must print nothing). The vendor note "expo-notifications 58" was rewritten by the review already; leave it.

1. **Tech Stack**, the `expo-notifications` bullet: add that since step 28 it schedules the daily affirmations as local notifications only (`enableRemoteNotifications: false`, the white `icon` `./assets/images/notification-icon.png` and the plum `color` in `app.json`), and that `src/services/notifications.ts` stays the only file that imports it.
2. **Architecture tree**: `src/utils/zonedTime.ts`; `src/services/affirmationPlanner.ts`, `affirmationScheduler.ts` and `notificationRouting.ts` (one line each, what they do); `notifications.ts` gains the scheduling, list, cancel, presented, dismiss, quiet-banner and tap functions; `src/navigation/navigationRef.ts`; `AffirmationSource` and `ReflectionTab` in `types/index.ts`; `AFFIRMATION_DAYS_AHEAD`, `AFFIRMATION_MIN_LEAD_MS` and `AFFIRMATION_RESCHEDULE_DEBOUNCE_MS` in `constants/app.ts`; `copy.notifications.affirmationTitle`; `readAffirmationSource` and `getKnownAffirmationsEnabled` in the repository and `readCachedAffirmationSource` in `entriesLive.ts`; the auth bridge starts and stops the schedule; `App.tsx` starts the tap routing and gives the container its ref; the developer panel's "Affirmation notifications (dev)" group; `assets/images/notification-icon.png`; and `supabase/tests/notifications/` (48 checks) in the tests line.
3. **Navigation Map**: `Reflection` takes `{ entryId, tab? }` (`tab` opens the carousel on that tab; a tapped notification passes `"affirmations"`); the container has `navigationRef` and calls `openPendingTap` on ready and on every state change; a tap waits for the signed-in screens and the account, and another account's tap opens nothing. The note that a notification can open Reflection first (the chevron's `popTo` fallback) is now true.
4. **Screen Specifications**, Reflection: the carousel opens on Affirmations when the reflection was opened from a notification. Profile: Daily Affirmations off cancels the notifications and on schedules them again (it still controls only the notifications).
5. **Notification Rules**: replace the section's bullets with the built rules: local only (no push, no exact alarms: Android may be minutes late); the newest finished reflection on the phone, title "{Slot} affirmation" and the headline only (never the longer text, the person's words, the emotion or the verse); nothing while the switch is off, the permission is missing, there is no finished reflection, or the newest is a crisis entry (then nothing at all, not even from an older one, until a newer reflection is ready); 7 days ahead in the phone's current time zone, refilled when the app comes to the front; identifiers `aff-{slot}-{yyyymmdd}-{hhmm}-{hash}` that carry the plan, so a run changes only the difference, never cancels what it did not plan and never touches one that is still wanted; a run that cannot read something changes nothing; when it plans again (decision 6); taps open Reflection on Affirmations and never start playback; a quiet banner while the app is open; sign-out clears them all and the notification center's; `cancelAllScheduledNotificationsAsync()` and `dismissAllNotificationsAsync()` are never used. Keep the bullet about the "your reflection is ready" notification (still none in V1).
6. **Authentication Rules**, the sign-out paragraph: `signOutCleanup()` now also clears the affirmation notifications (`clearAffirmations()`), last.
7. **Database Rules**, "Schema: built in step 18": `daily_affirmations.scheduled_for` and `is_delivered` are unused since step 28 (the phone schedules); a later migration may drop them.
8. **Linting and Validation**: add `node --no-warnings supabase/tests/notifications/run.cjs` (48 checks, about 10 seconds, the same `ONLY`, `FAILFAST`, `TIMINGS` and `GRACEHUSH_REPO` switches; red with `cannot resolve @/services/affirmationScheduler` in a tree without this step) beside the other checks under "Verifying on this machine"; the "Before a store build" count stays 13 (this step adds and removes no `TEMP(` or `TODO: real` line).
9. **Build Status & Decisions Log**: a "Step 28" entry with the decisions, the files, the checks and their numbers, the native config diff, what was not verified, the known limits and the notes of section 6, and the line `phone walk-through: not run yet`, which the walk-through replaces with one line per check.

---

## 5. Rules

- No new dependency, no migration, no policy change, no deploy, no secret, and no `any`. `app.json` changes in the one block of 2.16.
- `src/services/notifications.ts` stays the only file that imports `expo-notifications`. Never call `cancelAllScheduledNotificationsAsync()` or `dismissAllNotificationsAsync()`.
- A notification carries the slot's title and the headline only. Its `data` carries the entry id, the slot and the account's hash, never words.
- Never log a title, a headline, an identifier, an entry id, a user id or its hash, or a time. The only log lines are the scheduler's `[affirmations] {step}_failed` and the step 07 warnings, all behind `__DEV__`.
- A notification never starts playback or the ambient sound, and a crisis entry never gets a notification.
- Do not change the review's checks (`supabase/tests/notifications/`, and the edits of 3.1) to make them pass. If one fails, find out why; if the check is wrong, say so in the report.

---

## 6. Notes for later steps (reported, not edited: reconcile each at its own review)

- **29 (prayers data).** Nothing from this step: a prayer is not a notification.
- **31 (account actions).** Account deletion already clears the notifications (`signOutCleanup`). The export has nothing about them: they live only on the phone.
- **32 (pastoral tone).** A headline is a whole notification body on the lock screen: keep headlines short (iOS shows about two lines). A change to the prompt's wording does not need this step's code.
- **33 (realtime).** An entry that arrives through Realtime should call `requestAffirmationReschedule()`, as Journal's first page does, so a crisis entry or a newer reflection made on another phone takes effect without coming to the front.
- **34 (analytics).** The `TODO(34)` in `notificationRouting.ts` is `affirmation_notification_opened { slot }`. Prompt 34's catalog types its `slot` as `"morning" | "midday" | "evening"`; the app's slot is `TimeSlot` (`"afternoon"`, not `"midday"`): 34 should use `TimeSlot`. Never an event for a crisis entry (none can be sent: a crisis entry has no notification).
- **35 (development build).** Check there what Expo Go could not show: a tap when the app was closed (it must open the reflection once), the lock screen with Gracehush's own name and icon, and, on the Android development build, the white icon, the channel "Daily affirmations" and the delivery delay without exact alarms. With `enableRemoteNotifications: false` the iOS App ID needs no Push capability; if push is ever wanted, that option and the capability come back together.

---

## 7. Verify

### Part A: always (the implementer, no phone)

1. Red first (section 0.3), then apply sections 1 and 2.
2. `npm run typecheck` and `npm run lint` exit 0. Read the whole output; nothing is disabled with a comment.
3. `node --no-warnings supabase/tests/notifications/run.cjs` ends `48 checks passed`. Then the older ones: offline `44 of 44 passed`, profile-sync `88 passed, 0 failed` (about 35 seconds), journal-data `86 checks passed` (about a minute), recording `68 passed, 0 failed`, playback `133 checks passed`, ambient `64 checks passed` and parity `7 of 7`. Put the last line of each in the report.
4. The Edge Function file changed only in comments: `npx --yes deno@2.9.6 fmt --check --line-width=120 supabase/functions` and the lint and check commands of AGENTS.md ("Linting and Validation") pass, and `git diff supabase/functions` shows the two comments and nothing else. No deploy.
5. `git diff --stat -- package.json package-lock.json` prints nothing. `npx expo config --type introspect --json` shows no `aps-environment` in `ios.entitlements` (`com.apple.developer.applesignin` stays), the Android `default_notification_icon` meta-data, and the same Android permissions and iOS background modes as before (the review's diff: exactly those two changes).
6. Bundle both platforms, one at a time, to a folder outside the repo (host memory, AGENTS.md): `NODE_OPTIONS=--max-old-space-size=3072 npx expo export --platform ios --output-dir <a temp folder> --no-minify --no-bytecode --max-workers 2`, then `android`. Both exit 0, and each unminified bundle holds `openPendingTap`, `startAffirmationSchedule`, `readCachedAffirmationSource` and `initialTab`. (The review's bundles: iOS 10.86 MB and Android 10.83 MB of JavaScript.) The developer panel's strings are not in a release export (Metro drops `__DEV__` code): add `--dev` to search for one. Do not export while the emulator and Metro are both running.
7. Greps, each with its result named:
   - `grep -rn "TODO(28)" src supabase/functions` finds nothing;
   - `grep -rln "expo-notifications" src` finds only `src/services/notifications.ts`;
   - `grep -rn "cancelAllScheduledNotificationsAsync\|dismissAllNotificationsAsync" src` finds nothing;
   - `grep -rn "console\." src/services/affirmationScheduler.ts src/services/affirmationPlanner.ts src/services/notificationRouting.ts src/utils/zonedTime.ts` finds only the scheduler's `__DEV__` line;
   - `grep -rnE "TEMP\(|TODO: real" src | wc -l` prints 13, unchanged.
8. Line endings: the CRLF files of section 2 are still CRLF (`tr -cd '\r' < file | wc -c` equals the line count), the LF ones have no CR, the new files are LF, and `git diff --stat` shows only real changes (no whole-file rewrite; the whole-file `notifications.ts` keeps its endings).
9. **Breakage smoke test** (prove the checks are wired to *your* files). One at a time, make the break, run the group named, see that check fail by name, then restore the line (`git diff` shows nothing for it):
   - in `affirmationPlanner.ts`, replace `source === null || source.isCrisis) return [];` by `source === null) return [];` (`ONLY="plan: nothing while"`);
   - in `affirmationScheduler.ts`, delete the line `  if (enabled === null) return null;` (`ONLY="nothing happens until"`);
   - in `affirmationScheduler.ts`, delete the line `    if (wanted.has(identifier)) continue;` (`ONLY="nothing changed"`);
   - in `entriesLive.ts`, replace `entries.find((entry) => entry.status === "ready" && isListedEntry(entry, now))` by `entries.find((entry) => isListedEntry(entry, now))` (`ONLY="repository: the source"`);
   - in `notificationRouting.ts`, delete the line `  if (tap.userHash !== tapUser) return;` (`ONLY="another account"`);
   - in `account.ts`, delete the line `  await clearAffirmations();` (the offline checks fail their sign-out check and the profile-sync checks their account check; these two run whole, they have no `ONLY`).
10. With the user's yes only (section C): nothing on Android is part of this step. Do not boot the emulator for it.

### Part B: the phone walk-through (you, on the iPhone in Expo Go)

"What you do yourself", section B, checks B0 to B11. When Part A passes, the implementer asks whether to start it and waits for the answer (AGENTS.md); then it gives one action at a time, reads the app through the dev server's inspector (read-only), and writes the results into the log entry. B1 and B8 make the plan from a new reflection, B2 to B4 are the notifications themselves and their taps, B5 and B6 the two switches that stop them, B7 a crisis entry, B9 the time zone (optional), B10 sign-out, B11 the way back.

### Not verified, and said so

Say each of these in the report unless it was run: the iPhone entirely until Part B is done; a tap on a notification when Expo Go itself was closed (Expo Go cannot open a project from one: the development build of step 35); the lock screen with Gracehush's own name and icon (Expo Go shows its own: step 35); Android on a device or an emulator, its channel, the white icon and the delay without exact alarms; the window refilled on a later day (the checks run it; on the phone it would take a day); a tap on another account's notification after a session ended without a sign-out (the checks run it); VoiceOver reading a notification.

---

## 8. Report

Say, in this order and briefly: the files created and changed (one line each); that no package, migration, function deploy or secret changed, and the `app.json` block with the native config diff; the `TODO(28)` list with how each was closed; the checks (typecheck, lint, the 48, the older ones, Deno on the comment change, both bundles and what was found in them, the greps with their results, the breakages and which check named each); the phone walk-through results B0 to B11 (and any you did not get); the AGENTS.md changes of section 4 and that `prompts/AGENTS.md` equals it; what was not verified; the known limits of decision 13; and anything that differs from this prompt, with the reason. If you changed any of the code in sections 1 and 2, say which line and which check still proves it.
