# 07-onboarding-state.md

Read AGENTS.md first and follow it strictly, including "Instructional Memory": the iOS developer account comes last, and my iPhone stays on Expo Go until then.

Persist onboarding with Zustand and AsyncStorage, hold the splash screen until the saved state has loaded, and wire the real microphone and notification permission requests on onboarding step 3. Preserve the existing UI exactly.

Where things stand after step 06: `OnboardingScreen` keeps the reminder times in local state (`defaultTimes`), "Allow & Continue" and "Maybe later" both just call `navigation.navigate("SignIn")`, and `RootNavigator` does not look at onboarding. `formatTime12` (step 06) is already used by the Rhythm step. None of `zustand`, `@react-native-async-storage/async-storage`, `expo-notifications` or an audio package is installed. There is no dev client (step 05b has not been done), so everything runs in Expo Go. `.env.local` holds the Clerk development key, which is all this step needs.

Design reference (read only, the UI must not change): `prompt_material/01-onboarding-welcome.png` and `prompt_material/01-onboarding-welcome.html` (the HTML holds all three steps). Before you change any code, take Android emulator screenshots of the three onboarding steps and of Sign In. Take them again at the end: they must look identical.

## Decisions (made, do not ask me again)

These settle everything this step would otherwise stop and ask about. If one turns out to be impossible, stop and tell me instead of picking another.

1. **Packages approved:** `zustand`, `@react-native-async-storage/async-storage`, `expo-notifications` and `expo-audio`. Install them in one command, with no version arguments: `npx expo install zustand @react-native-async-storage/async-storage expo-notifications expo-audio`, then run `npx expo install --check` and `npx expo-doctor`. Never `npm install` them directly: SDK 57 bundles AsyncStorage 2.2.0, and the registry's latest is 3.x, which Expo Go's native module is not guaranteed to match. Never use the deprecated `AsyncStorage` from `react-native`.
2. **Audio package: `expo-audio`.** `expo-av` is not part of SDK 57 and is not installed, and steps 23, 26 and 27 also build on `expo-audio`. Use its named exports `getRecordingPermissionsAsync` and `requestRecordingPermissionsAsync` (checked in 57.0.5). Do not use `expo-audio`'s own `requestNotificationPermissionsAsync`: notifications go through `expo-notifications` only.
3. **Expo Go stays the test target.** Right after the install, confirm on the Android emulator that the app still launches in Expo Go. If it does not, stop and ask me: guard the module, or move testing to the Android development build. Do not decide silently (AGENTS.md Instructional Memory). Remote push does not run in Expo Go on Android, but permission requests and channels do, so a LogBox error about remote push on Android is expected and not a defect. Tell me what you saw. The iPhone check is part of the final report (I confirm it myself).
4. **Never block the app.** Verified in zustand's source: if the storage read throws or the saved JSON is corrupt, `persist` never marks the store hydrated (`hasHydrated()` stays `false` and `onFinishHydration` never fires), so a splash gate would wait forever. That is why `safeStorage` and `merge` below exist.
5. **A permission that can still be asked counts as `undetermined`.** Verified in the expo-notifications 57.0.23 source: on Android 13+ a never-asked notification permission is reported as `{ status: 'denied', canAskAgain: true }`. A rule that only looks at `status === 'undetermined'` would never show the Android prompt.
6. **Sign-out keeps onboarding.** AGENTS.md already has the exception (Authentication Rules, "On sign-out"; added when this prompt was reviewed). Do not edit that line.
7. **`expo-audio` plugin:** both background flags are set to `false` explicitly. The plugin defaults `enableBackgroundPlayback` to `true`, which would add the iOS `audio` background mode and an Android media-playback foreground service that Google Play asks apps to justify. Step 23 decides background recording and step 26 decides playback.
8. **`expo-notifications` plugin:** `color` only. No `icon` yet: it needs a white 96x96 PNG (`assets/images/notification-icon.png`) that does not exist, and nothing is displayed before step 28. No `enableRemoteNotifications`: SDK 57's plugin has no such option (it is newer). The plugin always adds the iOS `aps-environment` entitlement, so say so in the report.

## What you do yourself (manual setup)

Nothing here blocks the implementation. Do each item when the report asks for it.

1. **Environment keys: nothing to add.** `.env.local` already has `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (a `pk_test_` development key), which is all this step needs. The four Google values from `.env.example` (`EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME`) are not in `.env.local` at all (and are empty placeholders in `.env`). That is fine for now: they are only for native Google sign-in on a development build (Android in step 05b, iPhone in step 35, created in Part B and Part C of the step 05 checklist). Expo Go signs in with Google through Clerk's browser flow without them. Keep `.env` free of real values.
2. **Restart your own Metro after the install.** The implementer must never stop your Metro on 8081. When the report says the packages are installed, stop it yourself (`Ctrl+C` in its terminal), run `npx expo start -c`, and reload Expo Go on the iPhone.
3. **Re-test the permission prompts on the iPhone.** iOS shows each prompt once per install. To see them again, delete Expo Go from the iPhone and reinstall it from the App Store. "Reset onboarding (dev)" (section 8) restarts the flow but cannot reset permissions. In Expo Go the prompts show Expo Go's wording; Gracehush's own microphone text only appears in a development build (Android in step 05b, iPhone in step 35).
4. **Later, not now (step 28): the notification icon.** Android notifications need a small all-white icon: a 96x96 PNG with a transparent background, one pure white shape and no gradients. Make it from `assets/images/logo-mark.svg` in any SVG editor or converter, and save it as `assets/images/notification-icon.png`. Step 28 will ask for it.

## Before writing code

1. Read-only checks: `package.json` (none of the four packages is there), the Expo SDK (57), `.env.local` has the Clerk key (the app does not launch without it), and every `// TODO(07)`. There are exactly two, and both are resolved in this step: `src/navigation/RootNavigator.tsx` ("skip onboarding when completed") and `src/screens/onboarding/OnboardingScreen.tsx` ("request mic + notification permissions").
2. Take the "before" screenshots (see the design reference).
3. Install the packages (decision 1).
4. Start Metro on 8082 (never 8081, which is mine), open the app in Expo Go on the emulator as AGENTS.md "Verifying on this machine" describes, and confirm nothing broke (decision 3).

## 1. Store (`src/store/onboardingStore.ts`)

Create a typed Zustand store with the `persist` middleware. Use zustand 5's curried form, `create<OnboardingState>()(persist(...))`, with `createJSONStorage(() => safeStorage)`.

```ts
interface OnboardingState {
  hasCompletedOnboarding: boolean;
  completedAt: string | null; // ISO
  reminders: Record<TimeSlot, string>; // "HH:mm" 24h
  permissionsPromptedAt: string | null; // ISO, set once prompts were shown
  remindersSyncedAt: string | null; // set by step 17 after saving to users_profile
  setReminder: (slot: TimeSlot, hhmm: string) => void;
  completeOnboarding: () => void; // idempotent
  markPermissionsPrompted: () => void;
  resetOnboarding: () => void; // dev only
}

// What is saved: data only, never functions.
type OnboardingPersisted = Pick<
  OnboardingState,
  "hasCompletedOnboarding" | "completedAt" | "reminders" | "permissionsPromptedAt" | "remindersSyncedAt"
>;
```

- Persist options: `name: "gracehush.onboarding"`, `version: 1`, `partialize` returning `OnboardingPersisted`, and `migrate: (persisted: unknown) => persisted as OnboardingPersisted` as a stub, with one comment saying version 1 is the only shape, `merge` validates every field, and steps 17 and 34 bump the version and extend it.
- `merge`, typed `(persisted: unknown, current: OnboardingState) => OnboardingState`, keeps only valid saved fields and falls back to the current value for the rest: `hasCompletedOnboarding` is `true` only when the saved value is exactly `true`; each of the three timestamps is kept only when it is a string that `Date.parse` accepts, otherwise `null`; each reminder slot is kept only when it matches the `HH:mm` pattern below, otherwise that slot gets its default. zustand's default `merge` is shallow and would replace the whole `reminders` object, so one bad slot would crash the Rhythm step.
- `onRehydrateStorage`: `() => (_state, error) => { if (error && __DEV__) console.warn(...) }`. With `safeStorage` this should never fire: it is the last line of defence. Never log the saved content.
- Add to `src/constants/app.ts`: `DEFAULT_REMINDERS: Record<TimeSlot, string> = { morning: "08:00", afternoon: "13:00", evening: "20:00" }` and `AFFIRMATION_CHANNEL_ID = "affirmations"` (step 28 reuses it). Use `DEFAULT_REMINDERS` for the initial state and the reset, copying it each time (`{ ...DEFAULT_REMINDERS }`) so nothing shares a reference. In `src/data/mappers.ts`, delete the private `DEFAULT_REMINDERS` from step 06 and import this one.
- `setReminder(slot, hhmm)`: validate `^([01]\d|2[0-3]):[0-5]\d$` (one `isHHmm` function in the store file, also used by `merge`). An invalid value is ignored with a `__DEV__` warning. A value equal to the current one does nothing (the iOS wheel can report the same value repeatedly). Otherwise it sets the time and sets `remindersSyncedAt` to `null`, so step 17 knows to sync again.
- `completeOnboarding()`: idempotent. It sets the flag and `completedAt` (now, ISO) only when the flag is not already set.
- `markPermissionsPrompted()`: sets `permissionsPromptedAt` (now, ISO) only when it is `null`.
- `resetOnboarding()`: dev only. Back to `hasCompletedOnboarding: false`, all three timestamps `null`, default reminders.
- Do not persist the current step index (relaunching mid-flow starts at Welcome with the saved times) or any permission status (the OS is always the source of truth).
- Nothing sensitive goes into AsyncStorage: this store holds only flags, times and timestamps.

`src/store/safeStorage.ts`: a zustand `StateStorage` around AsyncStorage's default export (`import AsyncStorage from "@react-native-async-storage/async-storage"`).
- `getItem`: read the value. When it is not `null`, run `JSON.parse` once to prove it is valid. On a failed read or invalid JSON, remove the key, warn in `__DEV__` (the error only, never the content) and return `null`. Returning `null` makes zustand hydrate with the defaults and report itself hydrated (decision 4).
- `setItem` and `removeItem`: catch failures and warn in `__DEV__`, so a failed write never becomes an unhandled rejection or blocks the user.
- Step 17's `profilePrefsStore` reuses it.

`src/hooks/useStoreHydrated.ts`: `useStoreHydrated(store)` returns `true` once a persisted store has loaded. Implement it with `useSyncExternalStore`: `subscribe` is `store.persist.onFinishHydration(callback)` (it returns the unsubscribe function) and the snapshot is `store.persist.hasHydrated()`. That unsubscribes on unmount by itself and avoids setting state inside an effect, which the React Compiler lint rules flag. Type the parameter as the small shape it needs, `{ persist: { hasHydrated(): boolean; onFinishHydration(callback: () => void): () => void } }`, so any persisted store fits.

## 2. Hydration gate (`App.tsx`, `AppShell`)

Hide the splash screen only when all three are ready: fonts, Clerk `isLoaded` and the onboarding store. In `AppShell`:

- call `const hydrated = useStoreHydrated(useOnboardingStore)` next to the other hooks, above the early return;
- add `hydrated` to the condition and to the dependency list of the existing `SplashScreen.hideAsync()` effect;
- change the early return to `if ((!loaded && !error) || !hydrated) return null;`.

Render nothing while waiting: no spinner, because the splash is still visible. `RootNavigator` keeps returning `null` until Clerk has loaded, so the navigator first renders with everything known. Update the comment above the effect.

## 3. Navigation (`RootNavigator`)

Keep the conditional-screens pattern from step 05:

```txt
!isSignedIn && !hasCompletedOnboarding → Onboarding (initial), SignIn
!isSignedIn &&  hasCompletedOnboarding → SignIn only
 isSignedIn                            → Home
```

In the signed-out branch render `Onboarding` only when `!hasCompletedOnboarding`, then `SignIn`.

- Read the flag and the action with selectors: `useOnboardingStore((s) => s.hasCompletedOnboarding)` and `useOnboardingStore((s) => s.completeOnboarding)`.
- When `completeOnboarding()` runs, the navigator removes `Onboarding` and shows `SignIn` by itself. **Never call `navigate('SignIn')` after completing.**
- "I already have an account" still calls `navigate('SignIn')` without completing onboarding, so the back chevron returns to Welcome.
- **Returning users:** add an effect. When Clerk has loaded, the user is signed in and onboarding is not completed, call `completeOnboarding()`. Their reminders keep the defaults, and step 17 may override them from the server profile. Put every new hook above the existing `if (!isLoaded) return null`, because hooks cannot come after an early return.
- Remove the `// TODO(07): skip onboarding when completed` comment.

## 4. Rhythm step (step 2)

- Delete `defaultTimes` and the local `times` state. Read `reminders` and `setReminder` from the store with selectors, and make `updateTime(slot, date)` call `setReminder(slot, toTimeString(date))`. The chip updates immediately, and the value survives going back or relaunching. `toDate` and `toTimeString` stay.
- The display already uses `formatTime12` (step 06). No visual change.

## 5. Permissions (step 3)

Screens never call native APIs directly. Add `export type PermissionResult = "granted" | "denied" | "undetermined";` to `src/types/index.ts`, and these services.

`src/services/permissions.ts`: one shared mapper, with a comment that explains decision 5.

```ts
// PermissionResponse and PermissionStatus come from "expo".
export function toPermissionResult(response: PermissionResponse): PermissionResult {
  if (response.granted) return "granted";
  if (response.status === PermissionStatus.UNDETERMINED || response.canAskAgain) return "undetermined";
  return "denied";
}
```

`src/services/recorder.ts` (steps 10 and 23 extend it and keep these names):

```ts
getMicPermission(): Promise<PermissionResult>      // getRecordingPermissionsAsync
requestMicPermission(): Promise<PermissionResult>  // requestRecordingPermissionsAsync
```

`src/services/notifications.ts` (steps 15 and 28 extend it and keep these names):

```ts
ensureAffirmationChannel(): Promise<void>   // Android only, no-op on iOS
getNotificationPermission(): Promise<PermissionResult>
requestNotificationPermission(): Promise<PermissionResult>
```

- `ensureAffirmationChannel` calls `Notifications.setNotificationChannelAsync(AFFIRMATION_CHANNEL_ID, { name: "Daily affirmations", importance: Notifications.AndroidImportance.DEFAULT, sound: "default" })` on Android only. It **must run before** the request on Android 13+, otherwise the system prompt never appears, so `requestNotificationPermission` calls it first. Use the `AndroidImportance` enum, never a number.
- Request on iOS with `{ ios: { allowAlert: true, allowSound: true, allowBadge: false } }`.
- iOS provisional counts as granted (step 28 relies on it): when `response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL`, return `"granted"` before calling `toPermissionResult`.
- Wrap every native call in try/catch and return `"undetermined"` on error. Never throw to the UI. Never log anything beyond a `__DEV__` warning with the error.

**"Allow & Continue" behavior** (replace `allowAndContinue` in `OnboardingScreen`):

1. Ignore the tap while a request is already running (a ref). Set the button to `loading` (`PrimaryButton` already supports it) and put `disabled` on the "Maybe later" `Pressable`.
2. Microphone first, then notifications, one after the other. For each, read the status and call the request **only when the status is `undetermined`**. Already granted or permanently denied permissions are not requested again.
3. Call `markPermissionsPrompted()`, then `completeOnboarding()`.
4. Continue regardless of the results. A denial never blocks the user and never shows an error here (Profile, step 15, links to device settings later). Use `try/finally` so the loading state is always cleared, and do not touch state after `completeOnboarding()`: the navigator unmounts the screen.

**"Maybe later":** ignore the tap while a request is running, then call `completeOnboarding()` only. Do not request anything and do not set `permissionsPromptedAt`. Steps 10, 23 and 28 ask in context later.

Remove the `// TODO(07): request mic + notification permissions` comment.

Do **not** set a notification handler, schedule notifications, or register for push tokens. That is step 28.

## 6. Native config (`app.json`)

Add these two entries to `expo.plugins`, after the existing ones. Change nothing else and keep the Clerk plugins from step 05.

```json
["expo-audio", {
  "microphonePermission": "Gracehush uses the microphone so you can pray out loud. Your recording is used only to create your reflection.",
  "recordAudioAndroid": true,
  "enableBackgroundRecording": false,
  "enableBackgroundPlayback": false
}],
["expo-notifications", { "color": "#5B3A5E" }]
```

- The `expo-audio` plugin writes the iOS microphone text (`NSMicrophoneUsageDescription`) and adds `RECORD_AUDIO` on Android (the library's own manifest only has `MODIFY_AUDIO_SETTINGS`). It is the only place for that string: do not also set `ios.infoPlist.NSMicrophoneUsageDescription` (step 23 expects a single source).
- `expo-notifications` declares `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` in its own manifest (checked in 57.0.23), so there is nothing to add to `android.permissions`.
- Before using each option, confirm the name in the installed plugin (`node_modules/expo-audio/plugin/build/withAudio.js`, `node_modules/expo-notifications/plugin/build/withNotifications.d.ts`). If an option is not accepted, leave it out and tell me.
- Config plugins only change a native build, and there is no dev client yet (step 05b), so Expo Go ignores them. Check the result without building: `npx expo config --type introspect --json` must show `android.permissions` containing `android.permission.RECORD_AUDIO` and not containing `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `ios.infoPlist.NSMicrophoneUsageDescription` equal to the string above, no `audio` in `ios.infoPlist.UIBackgroundModes`, and `ios.entitlements["aps-environment"]` set to `development`. Put those four facts in the report.
- Seeing the real permission text and the notification channel needs a native build, and none exists yet: Android in step 05b (its first `prebuild` already includes these plugins; if 05b was done before this step, run `npx expo prebuild --clean`, then `npx expo run:android --port 8082`), iPhone in step 35. Do neither here, and say so in the report.

## 7. Sign-out rule

Onboarding is per device: signing out must **not** reset `hasCompletedOnboarding`. The AGENTS.md exception is already written (decision 6), so only confirm in the report that no sign-out code path touches the onboarding store. The only reset is the dev button below.

## 8. Dev reset

On the Home placeholder (`src/screens/HomePlaceholderScreen.tsx`), add a ghost button "Reset onboarding (dev)" below the existing "Sign out (dev)" button, in the same centered column. Render it only when `__DEV__` and mark it `// TEMP: replaced in 08`. It runs, in this order:

1. Clerk `signOut()` (awaited), so the session is gone first. If you reset first, the returning-user effect (section 3) sees a signed-in user with onboarding not completed and marks it completed again before the sign-out lands, and the navigator would open Sign In instead of Welcome.
2. `resetOnboarding()`, then `useOnboardingStore.persist.clearStorage()`. This removes **only** the `gracehush.onboarding` key and never `AsyncStorage.clear()`. The navigator then returns to Welcome by itself.

Under the button, add helper text (body-sm, mauve): "To re-test permission prompts, delete the app or reset permissions in device settings." Permissions cannot be reset in code.

## Rules

- No visual changes to onboarding, Sign In or the email sheet.
- No Supabase sync of reminders yet. That is step 17, which uses `remindersSyncedAt`.
- No library other than the four in decision 1. No `any`: type the persisted state, `merge` and `migrate`.
- Run your own Metro on 8082 and never stop mine on 8081.

## Verify

```bash
npm run lint
npm run typecheck
npx expo config --type introspect --json
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes. Then prove the store logic without a device, with a scratch harness outside the repo (compile the store, `safeStorage` and the hook with a scratch tsconfig, and fake `@react-native-async-storage/async-storage` and `__DEV__` the way the step 06 harness did):

- a read that throws, and invalid JSON in the key: the store hydrates with the defaults, `hasHydrated()` is `true`, and the bad key is removed;
- valid JSON with a bad reminder slot, a non-boolean flag and a bad timestamp: those fields fall back and the valid ones are kept;
- `setReminder` rejects `"24:00"`, `"8:00"` and `"ab"` and accepts `"07:05"`; the same value twice is a no-op that keeps `remindersSyncedAt`; a change sets `remindersSyncedAt` to `null`;
- `completeOnboarding` twice keeps the first `completedAt`; `markPermissionsPrompted` twice keeps the first timestamp;
- `resetOnboarding` plus `clearStorage` removes only the `gracehush.onboarding` key;
- `useStoreHydrated`'s subscribe and snapshot: finishing hydration notifies the subscriber, and the unsubscribe stops it.

Then check on the Android emulator in Expo Go (AGENTS.md "Verifying on this machine"; sign in with an address like `yourname+clerk_test@example.com` and the code `424242`). Reset to a fresh state with `adb shell pm clear host.exp.exponent`, then `adb shell pm revoke host.exp.exponent android.permission.RECORD_AUDIO` and the same for `android.permission.POST_NOTIFICATIONS`. If a prompt does not appear afterwards because Android remembers "don't ask again", run `adb shell pm reset-permissions`. `adb shell pm grant ...` gives the granted state for check 8.

1. Fresh state: the splash stays up until everything has loaded, then Welcome appears with nothing flashing.
2. Change the Rhythm times, go back and forward, then force-stop and reopen the app. The times are kept and the flow restarts at Welcome.
3. "Allow & Continue": the microphone prompt appears, then the notification prompt (the emulator is Android 13+). Denying either still lands on Sign In, with no error text.
4. Relaunch while signed out: Sign In opens directly, with no onboarding and no back chevron.
5. Fresh state → "I already have an account" → sign in. Relaunch (still signed in), then sign out: Sign In opens and onboarding is not shown again.
6. "Maybe later": no prompts appear, and the app lands on Sign In.
7. "Reset onboarding (dev)": signs out and shows Welcome. The saved times are back to the defaults and the Clerk session is gone.
8. With both permissions already granted, "Allow & Continue" shows no prompts and continues immediately.
9. The "after" screenshots of the three onboarding steps and Sign In look identical to the "before" ones.

Then ask me to confirm checks 1, 2, 3, 4, 6 and 7 on my iPhone in Expo Go (my own Metro hot-reloads your changes), and remind me of manual setup items 2 and 3. Say plainly what was not verified: the iPhone until I confirm, Gracehush's own microphone text and the notification channel on a real build (Android in step 05b, iPhone in step 35), and iOS provisional notification status.

Fix every error before finishing. Report: each file created or changed, the audio package used for permissions, the zustand, AsyncStorage, expo-audio and expo-notifications versions, the native config changes with the four introspection facts, whether Expo Go on Android logged anything from `expo-notifications`, and confirmation that both `TODO(07)` markers are gone. Do not report as defects the known later-step items: the notification icon (step 28) and the first real native build (steps 05b and 35).

## AGENTS.md updates

The sign-out exception and the SDK notes were already written when this prompt was reviewed. In this step, record the decisions and the new state, replacing the text they supersede:

- Tech Stack: replace the intent lines for Zustand/AsyncStorage, `expo-audio` and `expo-notifications` with "Installed in step 07:" and the exact versions. Decision Making & Clarifications, "Approved so far": add the four packages.
- Architecture tree: add `onboardingStore.ts` and `safeStorage.ts` under `store/`, `useStoreHydrated` under `hooks/`, `permissions.ts`, `recorder.ts` (permissions only) and `notifications.ts` (channel and permissions only) under `services/`, and `DEFAULT_REMINDERS` and `AFFIRMATION_CHANNEL_ID` in `constants/app.ts`.
- Navigation Map, "Current state": replace the sentence that onboarding completion is not persisted (and its `TODO(07)`) with the three-line branch table from section 3, and add: completing onboarding removes `Onboarding` from the branch, so never call `navigate('SignIn')` after `completeOnboarding()`. Update the "Home" bullet to include the "Reset onboarding (dev)" button.
- Screen Specifications, Onboarding step 2 and step 3: step 2 says the times are saved on the device in the onboarding store (step 17 syncs them to the profile); step 3 describes the real "Allow & Continue" and "Maybe later" behavior from section 5 instead of "Until step 07 both buttons only navigate to SignIn".
- State Management Rules: replace the "Until step 07..." paragraph with a short description of the persisted onboarding store (key `gracehush.onboarding`, version 1, reminders stay `"HH:mm"`), the rule that every persisted store uses `safeStorage` and is gated with `useStoreHydrated`, and that no journal text or sensitive value goes into AsyncStorage.
- Build Status & Decisions Log: a Step 07 entry with the decisions above, package versions, the files, the native config and the four introspection facts, what was verified and what was not, and any open items.

Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp`.
