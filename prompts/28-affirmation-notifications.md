# 28-affirmation-notifications.md

Read AGENTS.md first and follow it strictly.

Schedule the real daily affirmation notifications for Gracehush. Use
local notifications only (no push). Build a rolling 7-day schedule from
the user's reminder times, in the phone's current time zone, using the
latest non-crisis entry. Reschedule whenever an input changes, and open
the right reflection when a notification is tapped. Replace the old
DAILY-trigger registerLocalAffirmationSchedule. Screens keep their exact
look.

AGENTS.md requires approval before native config changes, dependencies
and migrations. Ask where this prompt says ask. No new dependencies.

Docs (source of truth, follow exactly):

- https://docs.expo.dev/versions/latest/sdk/notifications/
  (scheduleNotificationAsync with a DATE trigger and channelId,
  getAllScheduledNotificationsAsync, cancelScheduledNotificationAsync,
  setNotificationHandler, addNotificationResponseReceivedListener,
  getLastNotificationResponse(Async) / clearLastNotificationResponse,
  the config plugin enableRemoteNotifications, getPermissionsAsync and
  ios.status, the Android exact alarm notes)

---

## 1. Before writing code

1. Read src/services/notifications.ts (steps 07 and 15: channel,
   permission functions, old registerLocalAffirmationSchedule),
   src/store/onboardingStore.ts (reminders, remindersDirty),
   src/services/profileSync.ts (// TODO(28)), src/services/syncEngine.ts,
   src/data/journalRepository.ts (getLatestAffirmations, getProfile),
   src/screens/ProfileScreen.tsx (affirmations switch, // TODO(28)),
   src/services/account.ts (// TODO(28)), src/navigation/ (types,
   RootNavigator, the navigation container), src/screens/ReflectionScreen.tsx
   and ReflectionCarousel.tsx (tabs), app.json / app.config.ts.
2. List every // TODO(28) in the repo (app and supabase/) with
   file:line. Each is closed here or explained in the report.
3. In the installed expo-notifications types, confirm: the DATE trigger
   input shape and SchedulableTriggerInputTypes, the
   setNotificationHandler behavior fields (shouldShowBanner,
   shouldShowList, shouldPlaySound, shouldSetBadge), and whether
   getLastNotificationResponse is sync or async. Use what exists.
4. daily_affirmations.scheduled_for and is_delivered: step 18 granted
   the client update on is_favorite only. Ask: "Keep the notification
   schedule on the phone only, and leave scheduled_for / is_delivered
   unused (recommended)?" On yes, write nothing to them and add both to
   AGENTS.md Known Schema Gaps as "unused; drop in a later migration".
   On no, stop and ask how to proceed (it needs a grant migration).

---

## 2. Native config (ask before changing)

- expo-notifications plugin: add "enableRemoteNotifications": false
  (local notifications only; no APNs entitlement). Keep the step 07
  icon and color.
- Do not add SCHEDULE_EXACT_ALARM or USE_EXACT_ALARM. Affirmations may
  arrive a few minutes late on Android 14+; that's accepted. Note it in
  AGENTS.md.
- Rebuild (step 05b): `npx expo prebuild --clean`, then `npx expo run:android
  --port 8082`. The iPhone stays on Expo Go for now (AGENTS.md Instructional
  Memory): say what it could not check.

---

## 3. Time helper: src/utils/zonedTime.ts

zonedDateTimeToUtc(dateISO: string /_ YYYY-MM-DD _/, time: string
/_ HH:mm _/, timeZone: string): Date
localDateISO(instant: Date, timeZone: string): string
addDaysISO(dateISO: string, days: number): string
currentTimeZone(): string // Intl resolvedOptions().timeZone

- Intl only, no library (same approach as src/utils/week.ts).
- A local time that doesn't exist (DST spring-forward gap) moves forward
  to the first valid minute. A repeated time (fall-back) uses the first
  occurrence.
- Unit tests: America/New_York on the spring-forward and fall-back
  days, Europe/London, Asia/Kolkata (+5:30), Pacific/Auckland, UTC.

---

## 4. Planner (pure): src/services/affirmationPlanner.ts

type PlannedNotification = { identifier: string; slot: TimeSlot;
fireAt: Date; title: string; body: string;
data: { kind: 'affirmation'; entryId: string; slot: TimeSlot;
userHash: string } };

planAffirmations(input: {
now: Date; timeZone: string;
reminders: Record<TimeSlot, string>;
enabled: boolean; permission: 'granted' | 'denied' | 'undetermined';
latestEntry: { id: string; isCrisis: boolean } | null;
affirmations: Affirmation[]; // for latestEntry
userHash: string;
days?: number; // default AFFIRMATION_DAYS_AHEAD = 7
}): PlannedNotification[]

Rules:

- Return [] when: not enabled, permission not granted, no latestEntry,
  latestEntry.isCrisis, or affirmations don't include all three slots.
- latestEntry = the newest entry by created_at that is ready (crisis or
  not). If it's crisis, return [] (older entries' affirmations are not
  used).
- For day 0..days-1 and each slot: fireAt = zonedDateTimeToUtc(today +
  day, reminders[slot], timeZone). Skip fireAt <= now + 60 s.
- identifier = `aff-${slot}-${dateISO}`.
- title = slot title from copy.ts ("Morning Anchor", "Midday Peace",
  "Bedtime Rest"); body = that slot's affirmation headline. Never the
  affirmation text, transcript, emotion or scripture.
- userHash = first 16 hex chars of SHA-256(userId) (step 24 helper).
- Max total 21; assert < 64 (iOS limit).
- Also export planSignature(plan): string (identifiers + fireAt + body,
  joined) for change detection.
- Unit tests: all empty-plan cases, crisis newest entry, slots already
  past today, DST day, 21 items for a fresh day, identifiers stable
  across calls.

---

## 5. Scheduler: src/services/affirmationScheduler.ts

rescheduleAffirmations(reason: string): Promise<void>
cancelAffirmations(): Promise<void>

- Single flight with a "run again" flag; debounce 500 ms.
- Inputs: onboarding store reminders, profile.affirmationsEnabled
  (journalRepository.getProfile, cache first), permission from
  getNotificationPermission (step 07; on iOS treat PROVISIONAL as
  granted per the docs), latest entry + its affirmations from the
  repository (cache first; offline uses cache only), currentTimeZone(),
  userHash.
- Skip when signed out or the database isn't ready.
- Compare planSignature with the last one stored in SQLite meta
  (key 'affirmations.signature') and with the identifiers from
  getAllScheduledNotificationsAsync. Same → do nothing.
- Otherwise: cancel every scheduled notification whose identifier starts
  with 'aff-' (never cancelAllScheduledNotificationsAsync), then
  schedule each planned item with a DATE trigger and channelId
  'affirmations' (step 07). content: title, body, data, sound default.
  Store the new signature.
- ensureAffirmationChannel (step 07) runs before scheduling on Android.
- Errors: log the category in **DEV** only; keep the old signature so
  the next run retries.
- Delete the old registerLocalAffirmationSchedule and its DAILY
  triggers. Report every caller you changed.

Triggers (call rescheduleAffirmations from each):

- App foreground (AppState 'active') and app start after sign-in +
  dbReady (this refills the 7-day window).
- Sync engine: an item finished ready (normal or crisis).
- Reminder edits (after the step 17 debounce) and applyServerReminders.
  Close the step 17 // TODO(28).
- Profile affirmations switch changes. Close the step 15 // TODO(28).
- Permission granted from onboarding (step 07) or Profile ("Allow
  notifications"). Returning from Settings is covered by foreground.
- Time zone change: compare currentTimeZone() with the last one stored
  in meta on foreground.
- Step 21 // TODO(28) (crisis): covered by the planner rule. Close it.
- Step 19 // TODO(28) (scheduled_for on the server): close it per
  section 1.4.

---

## 6. Foreground and taps: src/services/notificationRouting.ts

- setNotificationHandler once at app start: shouldShowBanner true,
  shouldShowList true, shouldPlaySound false, shouldSetBadge false.
- Navigation: use a navigationRef (createNavigationContainerRef) on the
  existing NavigationContainer. Add `tab?: 'devotional' |
'affirmations' | 'prayer'` to Reflection params in
  src/navigation/types.ts; ReflectionCarousel opens on that tab when
  given (default unchanged).
- addNotificationResponseReceivedListener and, on cold start,
  getLastNotificationResponse: only act when data.kind is 'affirmation'
  and the action is the default tap.
- Wait until fonts loaded, Clerk loaded and signed in, dbReady and the
  navigator is ready. Then:
  data.userHash ≠ current userHash → ignore (another account's
  notification).
  Otherwise navigate to Reflection { entryId, tab: 'affirmations' }
  on top of the Journal tab.
- clearLastNotificationResponse after handling so it doesn't repeat.
- Entry not found (deleted) → Reflection shows its existing not-found
  state.
- Close the step 26 // TODO(28) (opening a devotional from a
  notification): taps open Reflection; playback never auto-starts.

---

## 7. Sign out and delete

signOutCleanup: cancelAffirmations() (prefix 'aff-' only), clear the
meta signature (the database is deleted anyway), and dismiss delivered
affirmation notifications from the tray if the API supports it
(dismissAllNotificationsAsync is acceptable since the app has no other
notifications; confirm that first). Close the step 15 // TODO(28).

---

## 8. Dev tools (DevToolsPanel, **DEV** only)

- "Scheduled affirmations": count + next fire time (local), no text.
- "Fire test affirmation in 10 s": schedules one test notification with
  identifier 'aff-test' using the latest entry, to test tap routing.
- "Reschedule now".

---

## 9. Rules

- No new dependencies, no `any`, no layout changes.
- Notification text: slot title + headline only.
- Never log notification text, entry ids or user ids.
- // TODO(34): affirmation_opened { slot }.

---

## 10. AGENTS.md updates

- Notification Rules: local only; rolling 7-day window refilled on
  foreground; identifiers aff-{slot}-{date}; cancel by prefix only;
  phone's current time zone; newest entry crisis → no affirmations;
  headline only on the lock screen; approximate delivery on Android 14+
  accepted; no exact-alarm permissions.
- Remove the old 08:00/13:00/20:00 hardcoded schedule notes.

---

## 11. Verify (dev build, physical iPhone and Android phone)

Run `npx expo start -c`, `npm run lint`, `npm run typecheck`, then:

1. Set reminders to the next 3 minutes (morning/afternoon/evening 1
   minute apart): three notifications arrive with the right titles and
   headlines (Android may be a few minutes late).
2. Dev panel shows 21 or fewer scheduled; after the test day passes,
   foreground refills to 7 days.
3. Change a reminder in Profile: the schedule updates (dev panel next
   fire time).
4. Turn affirmations off: 0 scheduled. On: back.
5. Deny notifications in Settings, return: 0 scheduled, Profile shows
   the step 15 card.
6. New crisis entry: 0 scheduled. New normal entry after it: scheduled
   again with the new headlines.
7. Change the phone's time zone: next fire time follows local reminder
   times.
8. Tap a notification with the app open, in the background and fully
   closed: Reflection opens on Affirmations each time, once.
9. Sign in as another account, tap an old notification from the first
   account: nothing opens.
10. Sign out: 0 scheduled, tray cleared.
11. Lock screen preview never shows the affirmation text or transcript.

Report: TODO(28) list and how each was closed; the server-column
decision; native config diff; files created, changed, deleted; test
results 1–11; and every TODO left for step 34.
