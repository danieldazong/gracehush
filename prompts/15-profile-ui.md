# 15-profile-ui.md

Read AGENTS.md first and follow it strictly.

Build the Profile & Settings screen for Gracehush. It replaces the step
08 placeholder in src/screens/ProfileScreen.tsx (remove
// TEMP: replaced in step 15). This step is UI plus mocked profile
changes and mocked account actions only. Real sync comes in step 17,
notification rescheduling in step 28, RevenueCat in step 30, and real
export/delete in step 31. Clerk sign out is already real (step 05). Keep
it real.

Design reference: @prompt_material/07-profile.png. Replicate it exactly:
layout, spacing, font sizes, colors, radii, shadows and alignment. Ignore
Google Stitch preview artifacts (state toggles, duplicate headers, device
frames). Use only the tokens in src/constants/theme.ts, the utilities in
global.css and existing components (ScreenHeader, PrimaryButton,
ConfirmDialog, ProgressScrubber, SegmentedControl). Do not add new
colors, fonts, radii or shadows. If the screenshot needs something the
tokens can't express, stop and ask. Text in this prompt overrides text in
the screenshot. Sections in this prompt that the screenshot doesn't show
(support row, notifications-off state, dialogs) are built as variations
of the screenshot's .list-row and card styles.

---

## 1. Before writing code

1. Read src/screens/ProfileScreen.tsx, src/components/dev/DevToolsPanel.tsx,
   src/store/onboardingStore.ts (or the step 07 store file),
   src/screens/onboarding/OnboardingScreen.tsx (the Rhythm step and its
   time picker), src/services/notifications.ts, src/data/journalRepository.ts,
   src/data/selectors.ts, src/types/index.ts, src/navigation/types.ts,
   src/constants/app.ts, src/constants/copy.ts, src/utils/format.ts and
   src/store/playerStore.ts.
2. Find in the UserProfile model (step 06): id, email, createdAt,
   subscriptionTier, reminder times, affirmationsEnabled, ambientSound,
   ambientVolume, timezone. Use them exactly. If createdAt or a
   free-usage source (devotionals used this week) is missing, stop and
   ask. Never hardcode "Member since 2026" or "2 of 3".
3. Find FREE_DEVOTIONALS_PER_WEEK in src/constants/app.ts. If it doesn't
   exist, add FREE_DEVOTIONALS_PER_WEEK = 3 (AGENTS.md free tier rule).
4. Check package.json for expo-constants and expo-application. Use
   whichever is installed for the app version. Do not install either.
   If neither is present, show nothing in the version row and report it.
5. Check that @react-native-community/datetimepicker is installed (step
   03). If not, stop and ask. Never build a custom time wheel.
6. Confirm the step 02 icon library has: user, bell, sunrise, sun, moon,
   waves, heart-handshake (or life-buoy), download, trash, log-out,
   file-text, shield, chevron-right, external-link. Do not install
   another icon set.

---

## 2. Shared time picker (extraction)

The reminder time row is now used in two places (onboarding Rhythm and
Profile). Extract it to src/components/ReminderTimeRow.tsx:
props: slot: TimeSlot; value: string /_ "HH:mm" _/; disabled?: boolean;
onChange(value: string): void

- Exactly the current onboarding visuals: .list-row, slot icon (sunrise /
  sun / moon), slot label, time chip showing formatTime12(value), row
  height ≥ 56.
- The chip opens DateTimePicker (mode time, the same platform behavior
  as onboarding). Cancel keeps the old value.
- Update OnboardingScreen to use it. The onboarding look and behavior
  must not change at all.

---

## 3. Data access (mocked)

Add to journalRepository.ts, each marked
// TEMP(17): replace internals with Supabase, keep signatures:

updateProfile(patch: Partial<Pick<UserProfile,
'affirmationsEnabled' | 'ambientSound' | 'ambientVolume'>>):
Promise<RepoResult<UserProfile>>

getUsage(): Promise<PlanUsage> already exists from step 06. Keep its
signature; only its internals follow the rules below.

Add mocked account actions to src/services/account.ts, marked
// TEMP(31): replace internals with Edge Function calls, keep signatures:

requestDataExport(): Promise<RepoResult<{ requestedAt: string }>>
deleteAccount(): Promise<RepoResult<null>>

Rules:

- About 600ms delay. Honor devStore.nextPrayerMutationFails (step 14) or
  add `nextProfileMutationFails: boolean` (default false, **DEV** only).
  Use one flag. Don't create a third.
- Reminder times are NOT saved through updateProfile in this step. They
  live in the onboarding store (step 07). Use its existing setter, which
  already sets remindersSyncedAt = null.
  // TODO(17): sync reminders to users_profile.
  // TODO(28): reschedule affirmation notifications on change.
- getUsage counts ready, non-crisis devotionals since the start of the
  current week in the profile's timezone. resetsAt is the next week
  start. Crisis entries never count against the limit.
- Mock deleteAccount succeeds after the delay and then runs the same
  cleanup as sign out (section 7). In the mock, never delete the real
  Clerk user. // TODO(31): server deletes Supabase rows, storage and
  the Clerk user.

Hook src/hooks/useProfileSettings.ts:

- State union: loading | error (with retry) | ready { profile, usage,
  notificationStatus, refresh }.
- Parallel Promise.all of getProfile(), getUsage() and the notification
  permission check from src/services/notifications.ts (step 07).
- Refetch on focus and when the app returns to the foreground (AppState),
  so coming back from Settings updates notificationStatus.
- Profile toggles are optimistic, with rollback and an inline error on
  failure.

---

## 4. Screen layout: src/screens/ProfileScreen.tsx

- SafeAreaView (linen, top edge), ScreenHeader "Profile" exactly as on
  the other tabs.
- One ScrollView. Horizontal padding 24 (20 when the width is under 360).
  paddingBottom = useTabScreenBottomPadding(). useScrollToTop.
  RefreshControl tint plum.
- Order of sections follows the screenshot. Sections the screenshot
  doesn't show go in this order: Account, Plan, Daily Affirmations,
  Ambient Sound, Support, Privacy & Data, Legal, Sign out, Version,
  Dev tools (**DEV**).

Account header:

- Avatar 64×64 round: Clerk user.imageUrl if it's a real uploaded image
  (user.hasImage), otherwise initials (getInitials from utils/format.ts,
  step 06) on blush in Fraunces SemiBold 22 plum. Never a stock photo.
- Name: getDisplayName({ firstName, email }) from utils/format.ts (step
  06, the same helper Journal Home uses), and "Friend" when it returns
  null. Never "null" or the raw email in the name line.
- Email in DM Sans 15 mauve.
- "Member since {Month YYYY}" from profile.createdAt, using
  formatMonthYear from utils/format.ts (step 06).

Plan card (white .card or the screenshot's style):

- Free / trial: title "Gracehush Free" (or "Pro trial"), the usage line
  "{used} of {limit} devotionals used this week", a petal progress bar
  with a plum fill, the reset line "Resets {weekday}", and a
  PrimaryButton "Start Free Trial" (or "Upgrade to Pro" if the trial has
  been used; // TODO(30): eligibility from RevenueCat) →
  navigate('Paywall', { source: 'profile' }).
- Pro: title "Gracehush Pro", "Unlimited devotionals", and a text button
  "Manage subscription" opening
  iOS https://apps.apple.com/account/subscriptions,
  Android https://play.google.com/store/account/subscriptions.
  Put both URLs in src/constants/app.ts. // TODO(30): use RevenueCat
  managementURL when available.
- Text button "Restore purchases" under the card, mocked to show the
  inline note "No purchases to restore yet."
  // TODO(30): Purchases.restorePurchases().

Daily Affirmations:

- Row with bell icon, "Daily affirmations", and an RN Switch bound to
  affirmationsEnabled (trackColor true plum).
- Three ReminderTimeRow components (morning, afternoon, evening). They
  are disabled and dimmed (opacity 0.5, not focusable) when the switch
  is off.
- Helper, DM Sans 13 mauve: "Times use your phone's time zone
  ({timezone})."
- If notificationStatus is 'denied': replace the helper with a blush
  card: "Notifications are off for Gracehush." / "Turn them on in
  Settings to receive your affirmations." and a ghost "Open Settings"
  button (Linking.openSettings()). If 'undetermined': a ghost
  "Allow notifications" button using the step 07 request function.

Ambient Sound default:

- Chips for every AmbientSound value, including 'off' shown as "None".
  Selected chip: plum fill, white text.
- Volume: ProgressScrubber (from step 12), max 1, increment/decrement
  ±0.1, formatValueText "{n} percent". Hidden when the sound is 'off'.
- Saving updates the profile only. It never changes a devotional that's
  already playing. The new default applies the next time a devotional
  is loaded (playerStore.load reads it, step 12).
  // TODO(27): preview the ambient sound.

Support:

- .list-row with heart-handshake icon, "Get support now", helper
  "Free, trained people ready to listen", chevron →
  navigate('CrisisResources', { source: 'profile' }). Remove the
  // TODO(15) left in step 13. Use plum, not crisis red, here.

Privacy & Data:

- "Export my data" row (download icon) → Export dialog (section 5).
- "Delete account" row (trash icon, crisis text color for the label
  only) → Delete dialog (section 6).
- Helper, DM Sans 13 mauve: "Your journal is private to your account."
  Make no claims about encryption here (that comes after step 18).

Legal:

- "Privacy Policy" and "Terms of Use" rows with an external-link icon,
  opened with expo-web-browser if installed, otherwise Linking.openURL.
- URLs are PRIVACY_POLICY_URL and TERMS_URL in src/constants/app.ts. If
  the real URLs aren't known, set them to
  'https://example.com/TODO-privacy' / 'https://example.com/TODO-terms',
  mark them // TODO: real URL before release, and list them in the
  report.

Sign out:

- Ghost button "Sign out" (log-out icon) → ConfirmDialog: title "Sign
  out of Gracehush?", body "Your journal stays safe in your account.",
  confirm "Sign out", cancel "Stay".

Version:

- Centered, DM Sans 12 mauve: "Gracehush {version} ({build})".

Dev tools:

- Keep DevToolsPanel from step 08 at the bottom, rendered only when
  **DEV**. Do not change what it does.

---

## 5. Export dialog

ConfirmDialog:

- Title: "Export your journal?"
- Body: "We'll prepare a copy of your entries, prayers and affirmations.
  You'll get a link to download it."
- Confirm "Prepare export", cancel "Not now".
- On success: an inline confirmation in the Privacy & Data section reads
  "Export requested. We'll let you know when it's ready." It stays
  visible until the next refocus, never on a timer.
- On error: an inline error with "Try again".
- // TODO(31): Edge Function builds the export and returns a signed URL.

---

## 6. Delete account dialog

Two steps, both using ConfirmDialog. Destructive buttons use the
.btn-critical style (crisis red), which is allowed only here on this
screen.

Step 1:

- Title: "Delete your account?"
- Body: "This permanently deletes your journal entries, recordings,
  devotionals, prayers and affirmations. This can't be undone."
- If the subscription tier is pro or trial, add this to the body:
  "Deleting your account doesn't cancel your subscription. Cancel it in
  your App Store or Google Play settings first." with a text button
  "Manage subscription" (the same URLs as the plan card).
- Confirm "Continue", cancel "Keep my account".

Step 2:

- Title: "Are you sure?"
- Body: "Your sanctuary and everything in it will be removed."
- Confirm "Delete account" (critical), cancel "Cancel".
- While deleting, the confirm button shows a spinner and both buttons
  are disabled.
- On success: run the section 7 cleanup, then Clerk signOut(). The
  navigator guard sends the user to SignIn (onboarding is already
  complete on this device).
- On error: "We couldn't delete your account. Please try again." Nothing
  is cleared.

---

## 7. Sign out cleanup

Create signOutCleanup() in src/services/account.ts. It runs before Clerk
signOut() for both sign out and delete:

- playerStore.stop() and reset its track state.
- Clear any in-memory repository caches for this user.
- Do NOT clear the onboarding store (device-level, AGENTS.md exception
  from step 07).
- // TODO(24): clear this user's SQLite cache.
- // TODO(28): cancel scheduled affirmation notifications.
- // TODO(30): Purchases.logOut().
- // TODO(34): posthog.reset().

---

## 8. Rules

- No new dependencies. No `any`. NativeWind classes first. StyleSheet
  only where AGENTS.md allows.
- New reusable components: ReminderTimeRow only. Keep the plan card,
  sections and dialogs inside the screen unless the file passes about
  300 lines. If it does, extract
  src/components/profile/PlanCard.tsx and
  src/components/profile/SettingsSection.tsx (a title + children
  wrapper) and nothing else.
- Put every new string in src/constants/copy.ts under `profile`. URLs
  and limits go in src/constants/app.ts.
- Crisis red is allowed only for the Delete account label and the
  destructive buttons in section 6.
- Never log email, name or any journal content.
- Do not change the tab bar, dock, header or any other screen except the
  onboarding extraction in section 2.

---

## 9. Verify

Run `npx expo start -c`, `npm run lint` and `npm run typecheck`. Then:

1. The layout matches 07-profile.png on a 390-wide iPhone and a small
   Android phone. The dock never covers the version line.
2. Onboarding Rhythm looks and works exactly as before (extraction
   check).
3. Change a reminder time, kill and reopen the app: the new time is
   kept. Turn affirmations off: the rows dim and aren't focusable.
4. Deny notifications in system Settings, then return to the app: the
   "Notifications are off" card appears without a manual refresh.
5. Switch the mock tier to free, trial and pro (devStore scenario): the
   plan card, usage line, Manage subscription and the delete warning
   change correctly.
6. Change the ambient default while a devotional plays: playback is
   unchanged, and the next devotional loads with the new default.
7. "Get support now" opens Support Resources.
8. Export: both success and failure (dev flag).
9. Delete: both steps, the subscription warning for pro, the spinner,
   and that failure clears nothing. Success signs out to SignIn, not
   Onboarding.
10. Sign out: audio stops and onboarding doesn't reappear.
11. VoiceOver/TalkBack: every row, switch, chip and dialog button is
    labelled. Disabled time rows aren't announced as buttons.

Report: files created and changed; the profile fields used; the version
source used; any placeholder URLs; icons used; copy keys added; and
every TODO left for steps 17, 24, 27, 28, 30, 31 and 34.
