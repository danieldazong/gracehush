# 15-profile-ui.md

Read AGENTS.md first and follow it strictly.

Build the Profile & Settings tab for Gracehush: the account header, the plan card with its Pro upsell, the settings groups (Preferences, Notifications & storage, Privacy & account, About), the export and delete-account dialogs, and sign out. It replaces the step 08 placeholder in `src/screens/profile/ProfileScreen.tsx` (remove `// TEMP: replaced in step 15` and the `TODO(15)` left by step 13). This step is UI plus mocked profile changes and mocked account actions only. Real profile sync comes in step 17, notification scheduling in step 28, RevenueCat in step 30 and real export and delete in step 31. Clerk sign out is already real (step 05). Keep it real.

Design: `prompt_material/07-profile.html` is the design source. It holds the settings view, the export dialog (`#modal-export`) and the delete dialog (`#modal-delete`), which the PNG does not show. `prompt_material/07-profile.png` shows only the settings view and is rendered at 1.25x, so never measure dp from it. (`Images/7._profile_settings.png` is the same file, byte for byte.) In the HTML 1 CSS px = 1dp.

Ignore the Stitch preview artifacts: the "Settings / Export View (Dialog) / Delete View (Dialog)" switcher at the top, the `Sanctuary` label and church icon on the third tab (it is Profile), the `spa` button in the header (the lotus, removed in step 09), the fixed header and tab bar, the quick-action pen and mic (step 08's dock, already built), and the "SJ", "Sarah Johnson", "sarah@email.com" and "Member since October 2026" placeholder content (everything comes from Clerk or the profile). Do not add colors, fonts, radii or shadows: use the tokens, the utilities in `global.css` and the existing components. If something needs a new token, stop and ask.

This prompt replaces an earlier draft that was written without the HTML. That draft's section order (Account, Plan, Daily Affirmations with three inline time rows, Ambient chips, Support, Privacy & Data, Legal, a ghost Sign out button), its "Get support now" row, its "Free, trained people ready to listen" line and its 24dp side padding are gone. Where this prompt differs from the old draft, the HTML copy and AGENTS.md "Screen Specifications, 7. Profile & Settings" win, and this prompt is the result.

---

## What you do yourself

Nothing blocks the build, and nothing needs to be installed, configured or signed up for: no package, no migration, no native change, no new key. `.env.local` holds only `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (set), which is all this step uses. (The three values below are public constants in code, not secrets, so they are not environment variables.)

Three values are placeholders until you provide the real ones. Each is a constant in `src/constants/app.ts`, marked `// TODO: real value before release`, and the report lists them. Apple and Google both require the first two to be reachable from inside the app, so they must be real before a build goes to a store, not before step 15 is done.

1. **Privacy Policy page** (`PRIVACY_POLICY_URL`). Publish one public web page and send me its address. It must describe what the app really does: voice recordings and written entries, the transcript, processing by Google's AI and text-to-speech services, storage in Supabase, sign-in through Clerk, purchases through RevenueCat, and opt-in anonymous usage data. Easy ways: a free policy generator that hosts the page for you (Termly or iubenda), or a public Notion page, or a page in your GitHub repo served by GitHub Pages. I can draft the text for you to review, but I am not a lawyer; have the final version checked if you can.
2. **Terms of Use page** (`TERMS_URL`). Same steps. For the iPhone build Apple accepts its standard EULA instead (`https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`, checked today: it loads), and step 16 can use it with your approval. Android needs your own page.
3. **Support email address** (`SUPPORT_EMAIL`). The address "Help & Feedback" writes to. Use one you read. A free address from your own domain is best; a Gmail address works while you are starting.

After you send me the three values, I change them in one place. Nothing else here needs you, except the iPhone checks at the end of "Verify".

After the code is pulled, restart Metro with a cleared cache: `npx expo start -c`, then reopen Expo Go (new files add class names, and a hot reload does not recompile the stylesheet for them).

---

## Decisions (made in the review; each one has its reason)

1. **The HTML is the design source, and AGENTS.md section 7 agrees with it.** The old draft contradicted both. Row titles are Title Case as in the HTML ("Daily Reminders", "Export Journal"), row subtitles and dialog buttons are sentence case, every string is in `copy.profile`, with curly apostrophes and quotes.
2. **The Pro upsell is nested in the plan card, as the HTML draws it** (a plum card with a "Premium" chip and a white "Start free trial" pill). It shows only for the free tier. A trial or Pro user sees the plan state and "Manage subscription" instead.
3. **"Devotional Voice" is not built.** Step 06 decision 5 already settled it: the voice is one server-side setting (`TTS_VOICE_NAME`, step 22), so there is nothing to choose and no column to save. The HTML row has no function in V1, and AGENTS.md says a control with no data or function is skipped and reported, not built as decoration. AGENTS.md section 7 is updated to say so.
4. **Daily Reminders and Ambient Soundscape expand in place** (an accordion inside the card, with a chevron that turns), not into a new screen, a new route or a nested sheet. The HTML draws both as chevron rows; V1 has 8 screens and no settings sub-screens, a picker opened from a `BottomSheet` is the fragile case on iOS (Modal inside a Modal), and the onboarding time picker is the one that is already verified on the user's iPhone. So the reminder times reuse onboarding's picker through a shared component (section 2), and the rows keep the HTML's collapsed look: a title, a one-line summary and a chevron.
5. **Reminder times stay editable when Daily Affirmations is off.** The old draft dimmed them. They also decide which affirmation the Journal shows for the current time of day (`getCurrentSlot` reads them), so they matter without notifications. The switch only controls notifications (step 28).
6. **Reminder times live in the onboarding store** (`useOnboardingStore.setReminder`, which already sets `remindersSyncedAt = null`), not in `updateProfile`. Step 17 syncs them. So that the rest of the app follows an edit now, the mock `getProfile()` returns the store's reminders (section 3.1); without that the Journal's current slot and Reflection's times would keep the mock row's 8:00, 1:00 and 8:00 until step 17.
7. **`updateProfile` takes `affirmationsEnabled`, `ambientSound` and `ambientVolume` only**, as step 17 expects (it keeps these device-only until step 18's columns exist). Switches and chips are optimistic with rollback (nothing typed can be lost here, unlike the Prayers sheet).
8. **One dev flag, not a third.** AGENTS.md already says step 15 reuses `nextPrayerMutationFails` for the profile. `takeMockPrayerMutationFailure()` also fails the next profile save, export and delete. The dev button is renamed "Fail next save (dev)".
9. **`getUsage()` stays as step 06 made it** (fixed "2 of 3" for free, `limit: null` for trial and Pro, `resetsAt` the next Monday 00:00 local). The old draft asked to count entries; step 06 decided against it because the mock entries are generated relative to "now" and would give a different number each weekday, and steps 22 and 25 replace it with the server count. Do not change it.
10. **Trial and Pro have `limit: null`** (step 06 decision 10), so the usage line and bar exist for the free tier only; the old draft showed "{used} of {limit}" for trial too.
11. **A dev control for the mock plan and for the notification status.** Without them the Pro and trial plan cards, the delete-subscription warning and the notification cards cannot be reached on the emulator (the mock tier is always `free`, and Expo Go on Android cannot import `expo-notifications`, so the status there is always `undetermined`). Both are `__DEV__` only (section 9).
12. **The ambient default really applies to the next devotional.** Step 12's store copies the profile's ambient choice only once per app start (or after `stop()`), so without a change a new default would be ignored until the app restarted. Section 3.4 adds one small store action, `reseedAmbient()`, that Profile calls after a successful save. It changes nothing that is playing. This corrects the old draft's "applies the next time a devotional is loaded", which the step 12 store did not do.
13. **The export and delete dialogs are one `ConfirmDialog` instance** whose content follows the step (sign out, export, delete 1, delete 2), with the visible flag separate from the content. Delete has two steps, and two `Modal`s swapped in one tick is the fragile case on iOS. Delete keeps two steps (steps 24 and 31 rely on "both steps") and takes the HTML's wording for the last one ("Delete forever").
14. **Failures stay inside the dialog.** An export or delete that fails keeps the dialog open with a calm line, and the confirm button is the retry. The old draft's separate inline "Try again" in the section is dropped. A success closes the dialog.
15. **The export copy does not promise what nothing builds.** The HTML says the journal is emailed as a PDF and shows a fake file card ("Encrypted • 14 Prayer Entries"). Step 31 builds a ZIP with a download link, and AGENTS.md makes no encryption claim before step 18, so both are dropped, and so is the old draft's "We'll let you know when it's ready" (no step sends that notification). The mock success line is a `TEMP(31)` that step 31 replaces with "Your export is ready." and a Download button.
16. **Legal links are required, so ABOUT gains two rows.** The HTML's ABOUT group has Support, Help & Feedback and Sign Out only. App Store and Google Play expect the Privacy Policy and the Terms of Use to be reachable in the app, so "Privacy Policy" and "Terms of Use" rows (external-link icon) sit between Help & Feedback and Sign Out. AGENTS.md section 7 lists them.
17. **The support row is "Support & Helpline Resources"** (AGENTS.md and the HTML), not the old draft's "Get support now", and it carries no claim about cost ("Free" is not said anywhere; step 13 rule). It opens `CrisisResources` with `{ source: "profile" }`, in plum, never crisis red.
18. **Crisis red appears on the delete row and in the two delete dialogs only** (the row's tile, icon, label and warning glyph; the dialog's icon tile and the "Continue" and "Delete forever" buttons). AGENTS.md allows it for destructive actions.
19. **Offline Reflections shows real counts from the mock entries** ("23 synced, 1 pending" in the default scenario, "23 synced, 3 pending" in `offline`, "0 synced, 0 pending" in `empty`), from a pure selector. Step 06 left "2 synced, 0 pending" for this step to replace. Step 24 replaces the source with the outbox.
20. **Haptics: `selection` for the Daily Affirmations switch and for a changed ambient chip.** AGENTS.md "Haptics" lists the only moments and calls the prayer-request switch and the Now Playing chips value pickers; these are the same kind of control. The rule is updated in this review. The accordion rows, the buttons and the dialogs make none.
21. **The name line is the full name** (first and last from Clerk, as the HTML's "Sarah Johnson"), falling back to the first name from the email and then to "Friend". Never "null", never the raw email in the name line. The email sits under it in small type (the HTML omits it; it tells a user which account they are in).
22. **Loading is a skeleton in the shape of the sections**, like the Journal, and the error state still shows everything that needs no profile data (the account header's name and email, the ABOUT group, the footer). A user can always sign out, even when the profile cannot load.
23. **No toasts.** The HTML shows a timed toast after each action. A switch and a chip show their own state; export and restore use a persistent inline line (no timers, as in step 14).

---

## 1. Before writing code

1. Read `src/screens/profile/ProfileScreen.tsx` (the placeholder; the path is NOT `src/screens/ProfileScreen.tsx`), `src/components/dev/DevToolsPanel.tsx`, `src/store/onboardingStore.ts`, `src/screens/onboarding/OnboardingScreen.tsx` (the Rhythm step and its time picker), `src/services/notifications.ts`, `src/services/crisisLinks.ts` (the link pattern to copy), `src/data/journalRepository.ts`, `src/data/selectors.ts`, `src/data/mappers.ts`, `src/data/mock/db.ts`, `src/data/mock/scenario.ts`, `src/types/index.ts`, `src/navigation/types.ts`, `src/constants/app.ts`, `src/constants/copy.ts` (`onboarding.rhythm`, `ambient`, `nowPlaying`), `src/utils/format.ts`, `src/store/devStore.ts`, `src/store/playerStore.ts`, `src/hooks/usePrayers.ts` (the hook pattern to copy), `src/hooks/useAnnounce.ts`, `src/components/ConfirmDialog.tsx`, `src/components/PrimaryButton.tsx`, `src/components/ProgressScrubber.tsx`, `src/components/Skeleton.tsx`, `src/screens/journal/NowPlayingScreen.tsx` (the ambient card and `ChoiceChip`), `src/screens/journal/ReflectionScreen.tsx` (`PrayerRequestRow`, the switch pattern) and `prompt_material/07-profile.html`.
2. The `UserProfile` model exists (step 06). Use these fields exactly: `id`, `createdAt`, `subscriptionTier` (`free | trial | pro`), `reminders` (`Record<TimeSlot, string>`, `"HH:mm"`), `timezone`, `ambientSound`, `ambientVolume` (0 to 1), `affirmationsEnabled`. There is no `email` on it (it comes from Clerk). `PlanUsage` has `tier`, `used`, `limit` (null when unlimited) and `resetsAt`. If a field you need is missing, stop and ask.
3. Installed and used here, nothing to install: `expo-constants` (the app version: `Constants.expoConfig?.version`; `expo-application` is NOT installed and stays that way, so there is no build number, and the version row shows the version only), `expo-web-browser` (the Privacy Policy and Terms pages), `expo-image` (the Clerk photo), `@clerk/expo` (`useUser`, `useAuth`), `@react-native-community/datetimepicker` and `@expo/ui` (the time picker). Never build a custom time wheel, and never render the community picker as a component.
4. Every icon goes through `Icon` with both names (checked against `sf-symbols-typescript` and `expo-symbols/build/android/symbols.json`; `anchor` has no SF Symbol, so the footer uses `hands.sparkles`):

| Use | iOS | Android |
| --- | --- | --- |
| Daily Reminders | `clock` | `schedule` |
| Ambient Soundscape | `waveform` | `graphic_eq` (the Now Playing icon) |
| Daily Affirmations | `bell` | `notifications` |
| Offline Reflections, all synced | `checkmark.circle.fill` | `check_circle` |
| Offline Reflections, some pending | `icloud.and.arrow.up` | `cloud_upload` |
| Export Journal | `square.and.arrow.down` | `download` |
| Delete Account, and its dialogs | `trash` | `delete` |
| Delete Account warning glyph, delete dialog icon | `exclamationmark.triangle` | `warning` |
| Export dialog icon | `doc.text` | `description` |
| Support & Helpline Resources | `heart` | `favorite` |
| Help & Feedback | `questionmark.circle` | `help` |
| Privacy Policy, Terms of Use | `arrow.up.right.square` | `open_in_new` |
| Sign Out | `rectangle.portrait.and.arrow.right` | `logout` |
| Pro card sparkle | `sparkles` | `auto_awesome` |
| row chevron, collapsed | `chevron.right` | `chevron_right` |
| row chevron, expanded | `chevron.down` | `keyboard_arrow_down` |
| time slot icons (as in onboarding) | `sun.max`, `cloud.sun`, `moon` | `wb_sunny`, `partly_cloudy_day`, `bedtime` |
| time chip clock, quieter, louder | `clock`, `speaker.fill`, `speaker.wave.3.fill` | `schedule`, `volume_down`, `volume_up` |
| footer blessing | `hands.sparkles` | `volunteer_activism` |
| "Export my journal first" link | `arrow.right` | `arrow_forward` |
| no-photo avatar | `person` | `person` |

Android's symbols are outline only, so the "all synced" check and the heart are outlines there.

---

## 2. Shared time picker: `src/components/ReminderTimePicker.tsx` (extraction)

The reminder time picker is now used in two places (the onboarding Rhythm step and Profile). Move it out of `OnboardingScreen.tsx` unchanged:

- `ReminderTimePicker({ slot, value, onChange, onClose })`, with `slot: TimeSlot | null`, `value: string` (`"HH:mm"` of that slot), `onChange(hhmm: string): void`, `onClose(): void`. On iOS it is the existing `Modal` (transparent, fade) with the bottom sheet, the Expo UI `DateTimePicker` (`mode="time"`, `display="spinner"`, `themeVariant="light"`) and the `Done` button, visible while `slot !== null`. On Android it renders `null`.
- `openAndroidTimeDialog(value, onChange)`: the existing `DateTimePickerAndroid.open({ value, mode: "time", is24Hour: false, onValueChange })`.
- `toDate` and `toTimeString` move into this file and stay private.
- `OnboardingScreen.tsx` imports both and keeps everything else (its `editingSlot` state, `openPicker`, the cards). **The onboarding look and behavior must not change at all**: same pixels, same Done button, cancel keeps the old value. Check the Rhythm step before and after.

The picker is reused as it is: the iOS sheet is a screen-level `Modal`, never opened from inside another `Modal`.

---

## 3. Data layer (mocked)

### 3.1 Repository, `src/data/journalRepository.ts`

- `getProfile()`: return `toUserProfile(row)` with `reminders` taken from `useOnboardingStore.getState().reminders` (decision 6). `// TEMP(17): step 17 syncs the store's reminders to users_profile and reads them back.`
- `updateProfile(patch)`, marked `// TEMP(17): replace internals with Supabase, keep signatures`:

```ts
export type ProfilePatch = Partial<
  Pick<UserProfile, "affirmationsEnabled" | "ambientSound" | "ambientVolume">
>;
updateProfile(patch: ProfilePatch): Promise<RepoResult<UserProfile>>
```

Export `ProfilePatch` from `src/types/index.ts`. The order is the same as the prayer writes: wait about 600ms (`PROFILE_CHANGE_MS = 600`; generalize `simulatePrayerChange` into a `simulateWrite(ms)` helper that the prayer writes and the profile and account functions share) → `takeMockPrayerMutationFailure()` fails with `NETWORK` → validate (`ambientSound` must be in `AMBIENT_SOUNDS`, `ambientVolume` must be a finite number, clamp it to 0..1; anything else is `INVALID`) → write `affirmations_enabled`, `ambient_sound`, `ambient_volume` and `updated_at` on `getMockDb().profile` → return the mapped profile. An empty patch answers ok and changes nothing. The failure message is `copy.profile.errors.save`. Nothing is logged.
- `setMockSubscriptionTier(tier: SubscriptionTier): void`, marked `// TEMP(30): the RevenueCat webhook sets the tier on the server; delete this`. It writes `getMockDb().profile.subscription_tier`. Only the dev panel calls it now; step 16's purchase mock reuses it (it said "update the in-memory mock profile's tier" without naming a function), so nothing outside `src/data/` ever imports `db.ts`.
- `getUsage()` is unchanged (decision 9). Do not touch it.

### 3.2 Selectors and formatters

- `src/data/selectors.ts`: `getSyncSummary(entries: JournalEntry[]): { synced: number; pending: number }`: `pending` is the number of entries with `isLocalOnly`, `synced` is the rest. Pure. (Proved against the real mock data: `default` gives 23 synced and 1 pending, `offline` 23 and 3, `empty` 0 and 0.)
- `src/utils/format.ts`: `formatWeekday(iso: string): string` → `new Date(iso).toLocaleDateString("en-US", { weekday: "long" })` ("Monday"; `resetsAt` is already a local midnight, so it prints the same weekday in every time zone; checked in 11 zones). Step 16 expects this function to exist. And `getFullName({ firstName, lastName, email }): string | null`: the trimmed first name plus the trimmed last name when both exist, the first name alone, else `getDisplayName({ email })`, else `null`. A last name without a first name is never used alone. `getInitials` and `formatMonthYear` already exist (step 06).

### 3.3 Account service, `src/services/account.ts` (new, marked `// TEMP(31): replace internals with Edge Function calls, keep signatures`)

```ts
requestDataExport(): Promise<RepoResult<{ requestedAt: string }>>
deleteAccount(): Promise<RepoResult<null>>
signOutCleanup(): Promise<void>
```

- `requestDataExport` and `deleteAccount` wait about 600ms, fail with `NETWORK` when `takeMockPrayerMutationFailure()` is true (decision 8), and otherwise succeed. The failure messages are `copy.profile.errors.export` and `copy.profile.errors.delete`. `deleteAccount` runs `signOutCleanup()` after a success and **never deletes the real Clerk user**. The screen calls Clerk's `signOut()` afterwards. `// TODO(31): the server deletes the Supabase rows, the storage files, the RevenueCat customer and the Clerk user.`
- `signOutCleanup()` runs before Clerk's `signOut()` for both sign out and delete. Now: `usePlayerStore.getState().stop()` (a full reset). There is no in-memory repository cache yet, so nothing else. It does **not** touch the onboarding store (device-level, AGENTS.md exception). Leave one line each: `// TODO(33): stopRealtime() first, before the database and the token go`, `// TODO(17): cancel the reminder sync debounce`, `// TODO(24): stop the sync engine and clear this user's SQLite cache`, `// TODO(26): clear the lock screen and release the player`, `// TODO(27): stop the ambient preview`, `// TODO(28): cancel the scheduled affirmation notifications`, `// TODO(30): Purchases.logOut()`, `// TODO(34): resetAnalytics()`. Steps 17, 24, 26, 27, 28, 30, 33 and 34 each add their line to this one function.
- The dev panel's "Sign out (dev)" and "Reset onboarding (dev)" call `signOutCleanup()` before Clerk's `signOut()` too (it closes the `TODO(31): full sign-out cleanup` there).

### 3.4 The ambient default (decision 12)

`src/store/playerStore.ts` gets one action, `reseedAmbient()`: `ambientSeeded = false` and nothing else (no state change). Profile calls it after a successful ambient save. A devotional that is playing keeps its sound and volume; the next `load` of a different devotional copies the new default. Reopening the loaded devotional (same id) is still a no-op. Profile never calls `setAmbient` or `setAmbientVolume` (step 27 relies on that: "Profile changes call updateProfile only").

### 3.5 Links, `src/services/externalLinks.ts` (new)

Copy the pattern of `crisisLinks.ts`: each function answers `{ ok: true }` or `{ ok: false }`, and logs nothing but one development warning.

- `openManageSubscription()`: `Linking.openURL` of the store URL (it must not open in the in-app browser, so the App Store or Play Store handles it).
- `openLegalPage(url)`: `WebBrowser.openBrowserAsync(url)`.
- `openSupportEmail()`: `Linking.openURL("mailto:{SUPPORT_EMAIL}?subject=Gracehush%20feedback")`. No device details, no user id, no body.

### 3.6 Constants, `src/constants/app.ts`

```ts
// Checked 2026-10-21: both addresses load (Apple's goes to the Apple ID sign-in, Google's to the Google sign-in).
export const MANAGE_SUBSCRIPTION_URL = {
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions",
} as const; // TODO(30): use RevenueCat's managementURL when available
export const PRIVACY_POLICY_URL = "https://example.com/TODO-privacy"; // TODO: real URL before release
export const TERMS_URL = "https://example.com/TODO-terms"; // TODO: real URL before release
export const SUPPORT_EMAIL = "support@example.com"; // TODO: real address before release
```

Apple documents the subscriptions address under "Handling Subscriptions Billing". `FREE_DEVOTIONALS_PER_WEEK` and `WEEK_STARTS_ON` already exist. Step 16 reads these three URL constants by name.

---

## 4. Hook: `src/hooks/useProfileSettings.ts`

Copy the structure of `usePrayers`. State:

```ts
type ProfileSettingsState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      profile: UserProfile;
      usage: PlanUsage;
      syncSummary: { synced: number; pending: number };
      notificationStatus: PermissionResult;
      refresh: () => Promise<void>;
      refreshing: boolean;
      save: (patch: ProfilePatch) => Promise<RepoResult<UserProfile>>;
    };
```

- One `Promise.all` of `getProfile()`, `getUsage()`, `listEntries()` (for `getSyncSummary`) and `getNotificationPermission()`.
- It loads like Journal Home and Prayers: through `useFocusEffect` (the first time too), again when the app returns to the foreground while the screen is focused (so coming back from Settings updates `notificationStatus` with no manual refresh), when the scenario changes, when `mockProfileVersion` changes (section 9), and on pull-to-refresh. A request counter in a ref makes only the latest request count; data loaded for another scenario or version is not shown (the key is `` `${scenario}:${mockProfileVersion}` ``). A failed refresh keeps the data on screen.
- `notificationStatus` is the dev override when `__DEV__` and `useDevStore` has one (section 9), else the real answer.
- `save(patch)` is optimistic: it merges the patch into the profile at once and calls `updateProfile`. A request counter makes only the latest save act on the result: success replaces the profile with the one returned; failure puts back **only the fields that patch touched**, to what they were before it. It returns the `RepoResult` so the screen can show its notice. A response of an older save is ignored. (Accepted limit: if two saves in a row both fail, the second one's rollback restores the first one's optimistic value; the next refresh corrects it.)
- A draft of this hook, the switch row, the single `ConfirmDialog` with its separate visible flag, a `useFocusEffect` cleanup that clears a notice, and the `scrollEnabled` guard passed `npx tsc` and `npx eslint` (the React Compiler rules) in the review, with a bad file proving the linter was live. Run lint again on the real files.

---

## 5. Screen: `src/screens/profile/ProfileScreen.tsx`

`SafeAreaView` (linen, `edges={["top"]}`), `ScreenHeader` with `avatar="static"`, then one `ScrollView` (`contentContainerStyle={{ paddingBottom: useTabScreenBottomPadding() }}`, 112: the tab bar is in flow below the scene, never add its height; `useScrollToTop`; `RefreshControl` with `tintColor={colors.plum}` and `colors={[colors.plum]}`). Side padding is `screen__content` (20, and 16 under 360dp wide), not 24. Sections are 24 apart. The screen takes `MainTabScreenProps<"Profile">` for `navigation`.

Order, as the HTML: account header, plan card, Restore purchases, Preferences, Notifications & storage, Privacy & account, About, footer, and (`__DEV__`) the developer panel. In every state (loading, error, ready) render what needs no profile data: the header's name, email and photo (from Clerk), the About group, the footer and the dev panel.

### 5.1 New components in `src/components/profile/`

- `SettingsGroup`: props `title`, `children`. The small label above (the `eyebrow` class, 8 of left padding, 4 above the card) and one card: an outer `View` with `rounded-card border border-petal bg-card` and `style={shadows.card}`, and an inner `View` with `overflow-hidden rounded-card` (the shadow and the clipping must be on different views or iOS clips the shadow). It puts a hairline (`divider mx-4`) between its non-empty children.
- `SettingsRow`: props `icon`, `iconTone: "default" | "destructive" | "bare"`, `title`, `subtitle?`, `titleTone?: "default" | "destructive" | "muted"`, `trailing?`, `onPress?`, `accessibilityLabel`, `accessibilityHint?`, `accessibilityRole?`, `accessibilityState?`. It is a `Pressable` when it has `onPress` (the row's whole width and `min-h-14` high is the touch target; pressed shows a `linen` background through the style function, not `className`) and a plain `View` otherwise (the sync status). Layout: the icon tile, a `flex-1` text column, the trailing element; `px-4 py-3`, 16 between the tile and the text. Tile: `size-9 items-center justify-center rounded-full bg-linen-deep` with a 20 `plum` icon; `destructive` is `bg-crisis/12` with a `crisis` icon (the step 13 tile, 4.62:1); `bare` has no tile (the About rows: a 20 `rosewood` icon on the row, as the HTML). Title `text-label-lg text-ink` (`destructive`: `text-crisis`; `muted`: `text-mauve`), subtitle `text-body-sm text-mauve`. **Both lines wrap, never `truncate`** (the HTML truncates the reminders summary, which would hide the evening time: measured with the font files it is 2 lines at 390dp and 3 lines at 360dp and 320dp with large text).
- `PlanCard`: props `usage: PlanUsage`, `onStartTrial`, `onManage` (section 5.3).

### 5.2 Account header

A row with 16 between: the avatar and a text column.

- Avatar: 64×64 round, `bg-blush` with a petal border. The Clerk photo (`expo-image`, `contentFit="cover"`, sized with `style`) when `user.hasImage` is true and it has not failed to load (`onError` falls back); otherwise the initials from `getInitials({ firstName, lastName, email })` in `text-headline text-plum-deep`; if there are none, a `person` icon (28, `plum`). Never a stock photo. The avatar is hidden from screen readers (the name beside it says it).
- Name: `getFullName(...)` or `copy.profile.account.friend` ("Friend"), `text-headline text-plum-deep`, wraps. Under it the email, `text-body-sm text-mauve` (wraps; never in the name line), and "Member since {formatMonthYear(profile.createdAt)}" in `text-body-sm text-mauve`. While the profile loads, "Member since" is a `Skeleton` line; in the error state it is left out.

### 5.3 Plan card (the HTML's, with the tiers)

A white card (`rounded-card border border-petal bg-card p-4`, `shadows.card`).

- Header row (`flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1`: "Gracehush Free" and "ACTIVE PLAN" need 261 of 254dp at 320dp with large text, so it wraps): the plan title `text-label-lg text-plum-deep` and the badge `eyebrow`.
- **Free**: title "Gracehush Free", badge "Active plan". The usage line "{used} of {limit} audio devotionals used this week" (`text-body-sm text-mauve`, from `usage`, never typed), a bar (`h-2 rounded-full bg-linen-deep`, fill `bg-plum`, width `min(used / limit, 1)` as an inline percentage; `accessibilityRole="progressbar"` with `accessibilityValue={{ min: 0, max: limit, now: used }}` and the usage sentence as its label), the line "Resets {formatWeekday(usage.resetsAt)}" (`text-body-sm text-mauve`), then the **Pro card**: `rounded-input bg-plum p-4` (the HTML's 12 is `rounded-input`), `sparkles` 22 in `colors.blush`, the title "Gracehush Pro" (`text-label-lg text-white`) with the chip "Premium" (`rounded-full bg-white/20 px-2 py-0.5`, label `eyebrow text-white`, 5.41:1) which wraps under the title when they do not fit (the pair needs 234 of 192dp at 320dp with large text), the body "Unlimited audio devotionals, whenever you need them." (`text-body-sm text-white/85`, 7.39:1) and a white pill (`self-start min-h-11 items-center justify-center rounded-full bg-card px-5`, label `eyebrow text-plum`, 9.50:1) "Start free trial", label "Start free trial", `onStartTrial` → `navigation.navigate("Paywall", { source: "profile" })`. The Pressable carries only the style function and the classes go on an inner `View`. The HTML's colored shadow on the Pro card and its pink `#ffd6fe` sparkle and chip are not tokens, so they are not built. `// TODO(30): "Upgrade to Pro" instead of "Start free trial" once the trial is used (isTrialEligible, step 16 section 8)`.
- **Trial**: title "Gracehush Pro", badge "Free trial", the line "Unlimited audio devotionals.", and a `PrimaryButton tone="ghost"` "Manage subscription" (`openManageSubscription`). No bar, no Pro card.
- **Pro**: the same with the badge "Active plan".
- A failed `openManageSubscription` shows the notice "We couldn’t open your subscription settings." under the card (a calm line in `text-rosewood`, announced).
- **Restore purchases** is a text button under the card for every tier (`min-h-11`, `btn-text__label btn-text__label--rosewood`). Mocked: it shows the inline line "No purchases to restore yet." (`text-body-sm text-mauve`, centered, announced) until the next action or refocus, never on a timer. `// TODO(30): Purchases.restorePurchases(); step 16 wires it`.

### 5.4 Preferences

`SettingsGroup` "Preferences" with two accordion rows. Open and closed state is local to the screen, both closed at first, not persisted. A row's `accessibilityState` carries `expanded`, its role is `button`, its label is "{title}, {summary}", its hint "Shows the times" or "Hides the times" (and the sound equivalent). No animation.

- **Daily Reminders** (`clock`): title "Daily Reminders", subtitle "Morning 8:00 AM • Afternoon 1:00 PM • Evening 8:00 PM" built with `formatTime12` from the store's reminders, chevron on the right. When open it shows three time rows under the row, indented to line up with the title text (`pl-[68px] pr-4`): the slot icon, the slot name (`copy.onboarding.rhythm.slots[key].name`) and the same time chip onboarding uses (`chip gap-1.5 border border-petal bg-linen py-1.5`, the time and a 14 `clock`), `min-h-14`, one `button` each with the label `copy.onboarding.rhythm.changeTime(name, time)` (reuse it, do not write a second one). Android opens `openAndroidTimeDialog`, iOS sets the slot and renders `ReminderTimePicker` once at the end of the screen. A change calls `useOnboardingStore.getState().setReminder(slot, hhmm)`. `// TODO(17): sync reminders to users_profile (the store sets remindersSyncedAt = null)`, `// TODO(28): reschedule the affirmation notifications`. Under the rows the helper "Times use your phone’s time zone ({profile.timezone with _ replaced by a space})." (`text-body-sm text-mauve`).
- **Ambient Soundscape** (`waveform`): subtitle `copy.ambient.labels[ambientSound]` plus ", {percent}% volume", and just "Off" when the sound is off. When open: the chips for every `AMBIENT_SOUNDS` value (`ChoiceChip`, below), wrapping, with the existing labels (`copy.ambient.labels`, "Off" included: the old draft's "None" is wrong) and the existing label `copy.nowPlaying.ambientChip(label)`; and the volume row copied from Now Playing: `volume_down` icon, `ProgressScrubber` (`max` 1, `step` 0.1, `color={colors.rosewood}`, `trackHeight` 6, `accessibilityLabel` `copy.nowPlaying.volume.label`, `formatValueText` `copy.nowPlaying.volume.text`), `volume_up` icon and the "Vol 50%" readout. The row is dimmed (`opacity-40`) with `needsOffscreenAlphaCompositing` and the scrubber `disabled` while the sound is off, so the card never changes height. **The screen's `ScrollView` gets `scrollEnabled={!isSeeking}`**, set by `onSeekStart` and cleared by `onSeekEnd`, or Android's `ScrollView` steals the drag after about 8dp of vertical drift (step 12 found it). A chip change and the end of a drag call `save({ ambientSound })` or `save({ ambientVolume })`, and on success `usePlayerStore.getState().reseedAmbient()` (section 3.4). `// TODO(27): a Preview button next to the chips`, `// TODO(34): ambient_changed { sound, source: 'profile' }`. Helper under the controls: "This is the sound your next devotional starts with." (it does not change one that is playing).
- `ChoiceChip` moves from `NowPlayingScreen.tsx` to `src/components/ChoiceChip.tsx` unchanged (props `label`, `accessibilityLabel`, `selected`, `wide?`, `onPress`; it already ticks `haptics.selection()` only for a changed choice), and Now Playing imports it. **Now Playing must look and behave exactly as before.**

### 5.5 Notifications & storage

`SettingsGroup` "Notifications & storage":

- **Daily Affirmations** (`bell`): title "Daily Affirmations", subtitle "A notification at each reminder time." The row is the touch target, and the native `Switch` is only a picture of the state, hidden from the touch system and screen readers, exactly like `PrayerRequestRow` in `ReflectionScreen.tsx` (`accessibilityRole="switch"`, `accessibilityState={{ checked }}`, `trackColor={{ false: colors.petal, true: colors.plum }}`, `thumbColor={colors.card}`, `ios_backgroundColor={colors.petal}`). A tap ticks `haptics.selection()`, and calls `save({ affirmationsEnabled: !current })`. `// TODO(28): reschedule or cancel the affirmation notifications`.
- **Offline Reflections** (`syncSummary`): not a button. Subtitle "{synced} synced, {pending} pending". Trailing icon: `checkmark.circle.fill` in `colors.sage` when `pending` is 0, else `icloud.and.arrow.up` in `colors.mauve`. (The sage check is 2.65:1 on white, below 3:1 for a graphic; the row's text carries the state, so the icon is decoration and is hidden from screen readers.) The row's label is "Offline Reflections, {synced} synced, {pending} pending". `// TODO(24): the outbox count`.
- Under the group, only while `affirmationsEnabled` is true: if `notificationStatus` is `denied`, a blush card (`card card--blush`): "Notifications are off for Gracehush." / "Turn them on in Settings to receive your affirmations." and a ghost `PrimaryButton` "Open Settings" (`Linking.openSettings()` in a `try/catch`); if `undetermined`, a blush card "Allow notifications to receive your affirmations." with a ghost "Allow notifications" button that calls `requestNotificationPermission()` and then reloads the status. (In Expo Go on Android the status is always `undetermined` and the button asks nothing: use the dev override, section 9, or the iPhone.) Step 28 shows this card in its checks.
- A failed save (the switch or an ambient change) shows the calm line "We couldn’t save that change." in `text-rosewood` under the group it came from, announced, until the next successful save or refocus. Never crisis red.

### 5.6 Privacy & account

`SettingsGroup` "Privacy & account":

- **Export Journal** (`square.and.arrow.down`): subtitle "Download a copy of your entries and prayers." (not "PDF": step 31 builds a ZIP) and a trailing `chevron.right` (the HTML's `open_in_new` means "leaves the app"; this opens a dialog). → the export dialog (section 6).
- **Delete Account** (`trash`, `destructive` tile, `titleTone="destructive"`, semibold): subtitle "Permanently remove your account and data." and the trailing `exclamationmark.triangle` in `colors.crisis`. → the delete dialog (section 6). It needs the plan tier for the subscription warning, so in the error state this group is left out.
- After a successful export request, a line under the group (`text-body-sm text-mauve`, announced) until the next refocus (a `useFocusEffect` cleanup clears it), never on a timer: "Export requested." `// TEMP(31): "Your export is ready." and a Download button`.
- `// TODO(34): data_export_requested {}` at the success path, and the "Share usage data" switch step 34 adds to this group.

### 5.7 About

`SettingsGroup` "About", `bare` icons in `rosewood`:

- "Support & Helpline Resources" (`heart`, chevron) → `navigation.navigate("CrisisResources", { source: "profile" })`. It is an ordinary row (the icon is `rosewood`, like the others in the group): not crisis red, and no subtitle. Remove the `TODO(15)` from step 13.
- "Help & Feedback" (`questionmark.circle`, chevron) → `openSupportEmail()`. If it cannot open (no mail app), the line "We couldn’t open your email app. You can write to us at {SUPPORT_EMAIL}." appears under the group, with the address `selectable`.
- "Privacy Policy" and "Terms of Use" (`arrow.up.right.square` trailing) → `openLegalPage(PRIVACY_POLICY_URL)` and `openLegalPage(TERMS_URL)`; a failure shows "We couldn’t open that page." under the group.
- "Sign Out" (`rectangle.portrait.and.arrow.right`, `titleTone="muted"`, no chevron) → the sign-out dialog.

### 5.8 Footer

Centered. The HTML's line is 11/16, which the type scale has no token for outside `eyebrow` (uppercase, bold), so it is `font-dm text-[11px] leading-[16px] text-mauve`: "Gracehush v{version} • Scripture quotes from Berean Standard Bible (BSB)." (AGENTS.md's wording; two lines at 390, 360 and 320dp at normal text, measured). `version` is `Constants.expoConfig?.version`; with none, drop "Gracehush v{version} • " and keep the rest. Under it a row with 6 between: `hands.sparkles` 15 in `rosewood` and "Peace be with your spirit." in `text-body-sm text-rosewood`.

---

## 6. Dialogs (one `ConfirmDialog`)

One `ConfirmDialog` instance at the end of the screen. State: `dialog: "signOut" | "export" | "delete1" | "delete2"` (kept after the dialog closes, so the fade-out never shows empty content) and `dialogOpen: boolean`, `busy`, `error`. Opening sets the kind, clears `error` and sets `dialogOpen`. `tone` is `destructive` for both delete steps. `loading` is `busy`. A failure puts the message in `children` and leaves the dialog open (decision 14); the confirm button is the retry.

`ConfirmDialog` gets one small change: with `tone="destructive"` **and** an `icon`, the icon tile is `bg-crisis/12` with a `crisis` icon (the HTML's red tile) instead of blush with plum-deep. No existing destructive dialog passes an icon (New Entry's two do not), so nothing else changes. The tile stays 44 (the HTML's 64 is not a token size).

| Step | Icon | Title | Body | Confirm | Cancel |
| --- | --- | --- | --- | --- | --- |
| signOut | none | Sign out of Gracehush? | Your journal stays safe in your account. | Sign out | Stay |
| export | `doc.text` | Export your journal? | We’ll prepare a copy of your entries, prayers and affirmations. You’ll get a link to download it. | Prepare export | Not now |
| delete1 | `exclamationmark.triangle` | Delete your account? | This permanently deletes your journal entries, recordings, devotionals, prayers and affirmations. This can’t be undone. | Continue | Keep my account |
| delete2 | `trash` | Are you sure? | Your sanctuary and everything in it will be removed. | Delete forever | Keep my account |

- **signOut**: `await signOutCleanup(); await signOut();` (Clerk's), in a `try/catch`. If it throws, the dialog stays with "We couldn’t sign you out. Please try again." The navigator then shows Sign In (onboarding is already complete on this device), never Welcome. `// TODO(24)`: the body becomes "{n} reflections on this phone haven’t been sent yet..." when the outbox has unsent items (step 24 section 10 edits this dialog's body, so build the body as a value, not a constant string in JSX).
- **export**: `requestDataExport()`. Success closes the dialog and shows the line from 5.6. Failure: "We couldn’t prepare your export. Please try again."
- **delete1** (in `children`, under the body): a text button "Export my journal first" with an `arrow.right` (`rosewood`, `min-h-11`) that switches the dialog to **export** (the same instance, so no second Modal), and, only for `trial` or `pro`, a calm paragraph "Deleting your account doesn’t cancel your subscription. Cancel it in your App Store or Google Play settings first." with a text button "Manage subscription" (`openManageSubscription`). "Continue" moves to **delete2** without closing anything.
- **delete2**: `deleteAccount()` with the spinner on the confirm button and both buttons off (`ConfirmDialog` already ignores the scrim and Android back while `loading`). Success: the service already ran `signOutCleanup()`; call Clerk's `signOut()`; the navigator sends the user to Sign In. Nothing sets state after the screen unmounted. Failure: "We couldn’t delete your account. Please try again." in `children`, nothing cleared, the dialog stays on step 2.
- Never log the email, the name or any journal content.

---

## 7. Copy (`src/constants/copy.ts`, under `profile`)

Every string above lives under `copy.profile` (`account`, `plan`, `groups`, `reminders`, `ambient`, `affirmations`, `notifications`, `sync`, `privacy`, `about`, `dialogs`, `footer`, `errors`), with builders for the plurals and the spoken labels (`usage(used, limit)`, `resets(weekday)`, `memberSince(date)`, `remindersSummary(reminders)`, `ambientSummary(sound, percent)`, `syncStatus(synced, pending)`, `timezoneHelper(zone)`, `footerLine(version)`), reusing `copy.onboarding.rhythm.slots` and `changeTime`, `copy.ambient.labels` and `copy.nowPlaying.volume` and `ambientChip`. Group labels are stored in sentence case (the `eyebrow` class uppercases them). The error keys: `load` ("We couldn’t load your profile."), `save` ("We couldn’t save that change."), `export`, `delete`, `signOut`, `link` ("We couldn’t open that page."), `email`, `subscription`. `copy.common` already has `close`.

---

## 8. Rules

- No new dependencies. No `any`. NativeWind classes first; `StyleSheet` only where AGENTS.md allows (Pressable style functions, shadows, dynamic widths). `Pressable` takes no `className` with a style function: the classes go on an inner `View`.
- New files: `src/components/ReminderTimePicker.tsx`, `src/components/ChoiceChip.tsx`, `src/components/profile/SettingsGroup.tsx`, `SettingsRow.tsx` and `PlanCard.tsx`, `src/hooks/useProfileSettings.ts`, `src/services/account.ts` and `src/services/externalLinks.ts`. Private to `ProfileScreen`: `AccountHeader`, `RemindersPanel`, `AmbientPanel`, `NotificationCards`, the loading and error views, `Footer`. If the screen file passes about 450 lines, move `RemindersPanel` and `AmbientPanel` next to the others in `src/components/profile/` and nothing else.
- Crisis red only where decision 18 says. Never log email, name, user id or journal content. `__DEV__` goes in backticks (markdown eats the underscores).
- Do not change the tab bar, the dock, the header, `getUsage`, or any screen other than the two extractions (onboarding's picker, Now Playing's `ChoiceChip`) and the one `ConfirmDialog` tile.
- Markers to leave: `TEMP(17)` (`getProfile`'s reminders and `updateProfile`), `TODO(17)`, `TODO(24)`, `TODO(27)`, `TODO(28)`, `TODO(30)` (trial label, restore, management URL, `setMockSubscriptionTier` is `TEMP(30)`), `TEMP(31)` and `TODO(31)`, `TODO(34)` (`ambient_changed`, `data_export_requested`, `resetAnalytics()`), and the three `// TODO: real value before release` constants.

---

## 9. Dev panel (`src/components/dev/DevToolsPanel.tsx`, `__DEV__` only)

- Rename "Fail next prayer change (dev)" to "Fail next save (dev)": it now fails the next prayer change, profile save, export and delete (decision 8). Same flag, same behavior.
- "Mock plan (dev)": three buttons, `free`, `trial`, `pro`, the current one selected. Each calls `setMockSubscriptionTier(tier)` and then `bumpMockProfileVersion()`. The panel's data effect also depends on `mockProfileVersion`, so the selected button and the "plan:" line follow.
- "Notifications (dev)": four buttons, `real`, `granted`, `denied`, `undetermined`, calling `setNotificationStatusOverride(null | PermissionResult)`; the current one is selected.
- `src/store/devStore.ts` gets `mockProfileVersion: number` with `bumpMockProfileVersion()` and `notificationStatusOverride: PermissionResult | null` with `setNotificationStatusOverride`. Not persisted; nothing outside `__DEV__` sets them. `useProfileSettings` reads both.
- "Sign out (dev)" and "Reset onboarding (dev)" call `signOutCleanup()` before `signOut()`.

---

## 10. AGENTS.md updates (do these in the same step, then copy the file to `prompts/AGENTS.md`)

- Add the "Step 15" entry to the Build Status log: the decisions above, files created and changed, the measured sizes, what was verified and what was not, and the open items.
- Architecture: `components/profile/` (`SettingsGroup`, `SettingsRow`, `PlanCard`), `ChoiceChip`, `ReminderTimePicker`, `useProfileSettings`, `services/account.ts` and `services/externalLinks.ts`; replace "Planned: SettingsRow, PlanCard"; the URL and email constants in `constants/app.ts`; `copy.profile`.
- Navigation Map's dev-tools bullet and the Dev store paragraph: "Fail next save (dev)", "Mock plan (dev)", "Notifications (dev)", `mockProfileVersion` and `notificationStatusOverride`.
- Audio rules: `reseedAmbient()`. Date & Time Pickers: the reminders in Profile reuse `ReminderTimePicker`.
- Record any vendor fact learned on a device (the iPhone time sheet from a tab screen, `ActionSheet`-free dialogs, the single-dialog swap on iOS) and say what was not verified on iOS.

---

## 11. Verify

Run `npx expo start -c` (Metro on 8082 for the emulator; never stop the user's 8081), `npm run lint` and `npm run typecheck` (read the real exit codes), and `npx expo export` once per platform (one platform at a time on this machine). Then, on the Android emulator (Expo Go 57), at 390dp (`wm size 1080x2340`, `wm density 443`), 411dp and 320dp with font scale 1.3:

1. The layout against `prompt_material/07-profile.html` (proportions only against the PNG): header row 64 with the avatar 64, the plan card, four groups, rows at least 56, hairlines inset 16, the footer clear of the dock (the last control ends at least 36dp above the dock's top). Nothing is clipped at 320dp with font scale 1.3: the reminders summary wraps, the plan header and the Pro card's title and chip wrap, every control is at least 44.
2. Onboarding's Rhythm step looks and works exactly as before the extraction (screenshots before and after, the Done button, cancel keeps the old value). Now Playing's chips and speed chips look and work as before.
3. Change a reminder time on Profile, force-stop and reopen the app: the new time is kept. The Journal's affirmation card footer and Reflection's Affirmations tab show it. The reminders rows stay enabled with Daily Affirmations off.
4. Daily Affirmations: the row toggles at once, the save takes about 600ms, "Fail next save (dev)" then a toggle rolls it back and shows "We couldn’t save that change." and the next toggle works; the `selection` haptic fires once per change (a temporary call-site log, reverted).
5. "Mock plan (dev)": free shows "Gracehush Free", "2 of 3 audio devotionals used this week", the bar at two thirds, "Resets Monday" and the Pro card; trial and Pro show the plan state, "Unlimited audio devotionals." and "Manage subscription" (which opens the store page on the iPhone, and on the emulator either opens the Play Store or shows the calm notice); "Restore purchases" shows its line on every tier.
6. "Notifications (dev)": `denied` shows the blush card with "Open Settings" (the app's settings open), `undetermined` shows "Allow notifications", `granted` shows neither; with Daily Affirmations off neither card shows. Returning from system Settings on the iPhone updates the card with no refresh.
7. Ambient: open the row, change the chip and the volume (a held drag with about 150dp of vertical drift keeps following the finger and the page does not scroll; a screenshot of the dimmed row while the sound is Off shows the thumb without the fill showing through), and the summary follows. Play a devotional from Reflection, change the default on Profile, go back: the playing devotional is unchanged. Load a different devotional: it starts with the new sound and volume.
8. "Support & Helpline Resources" opens Support Resources and the X returns to Profile. "Help & Feedback" opens the mail app (or shows the notice with the address). "Privacy Policy" and "Terms of Use" open the in-app browser.
9. Export: the dialog, "Prepare export" shows its spinner, the dialog closes and the line "Export requested." stays until you leave the tab and come back. With "Fail next save (dev)" the dialog stays open with "We couldn’t prepare your export. Please try again." and the next try works.
10. Delete: the two steps in one dialog (the fade does not flash empty); "Export my journal first" switches to the export dialog; with the plan set to Pro the subscription warning and "Manage subscription" show on step 1 and not on free; step 2 shows the spinner with both buttons off; with the flag armed it fails with the message and clears nothing; on success the app lands on Sign In, not Welcome, and nothing of the real Clerk user is deleted (sign in again works).
11. Sign out: audio stops (start a devotional first), Sign In shows, onboarding does not reappear. "Stay" keeps the session.
12. Loading and error: a temporary experiment (reverted, marked `TEMP-EXPERIMENT`) that makes `getProfile` throw shows "We couldn’t load your profile." with "Try again" while the About group, the footer and Sign Out still work; the skeleton shows while loading and is one labelled node.
13. Accessibility structure (`uiautomator dump --compressed`): every row is one labelled button with its state (`expanded`, the switch's `checked`), the sync row is not a button, the avatar and the decorative icons are absent, the dialog is modal, and no clickable sits inside another. With TalkBack: the rows, switch, chips, scrubber and dialog buttons are read with their labels.
14. A Node check (the approach of step 14's: compile the repo's TypeScript on require, set `process.env.TZ` inside the script, run it for 11 zones) of `getSyncSummary`, `formatWeekday`, `getFullName`, `getInitials`, `formatMonthYear` and the reminders summary; and of `updateProfile` (valid patch, bad sound, NaN and out-of-range volume, the one-shot failure flag).
15. The log holds no email, name, id or journal text from this screen.

Not verifiable here, so for the user's iPhone in Expo Go: the iOS time sheet opened from a tab screen, `Linking.openURL` to the App Store subscriptions page, `Linking.openSettings()` and the card refreshing after a real permission change, the single-dialog step swap, the shadow around the grouped cards (outer and inner views), VoiceOver on the rows and the switch, the Clerk photo, the haptic feel, and Apple or Google sign-in accounts (step 35). Say plainly that none of it was verified on iOS.

Report: files created and changed; the profile fields used; the version source used (`expo-constants`; no `expo-application`, so no build number); the placeholder constants (`PRIVACY_POLICY_URL`, `TERMS_URL`, `SUPPORT_EMAIL`); icons used; copy keys added; the measured sizes; what was verified and what was not; every `TEMP` and `TODO` left for steps 16, 17, 24, 27, 28, 30, 31, 33 and 34; and any difference from the HTML with its reason.
