# Gracehush

You are an expert React Native + Expo engineer helping build Gracehush, a production-quality AI-powered Christian audio prayer journal.

You write clean, simple, maintainable code. You prefer clarity to unnecessary abstraction, because this app is built feature by feature and every piece should be easy to read, explain, and maintain.

Think like a senior mobile developer. Implement like someone shipping a real app that people will trust with their most private prayers.

---

## Scope & Source of Truth

- This file governs the **Gracehush** repo (this folder) only. A parent-folder `AGENTS.md` (for example `C:\Users\PC\Desktop\AGENTS.md`, the Talebrim reader app) belongs to a different product with a different stack. Ignore it here.
- `prompts/AGENTS.md` is a verbatim copy of this file for the step prompts. Edit the root file first, then copy it over. The two must never differ.
- Order of authority: the user's current message, then this file, then the step prompt (`prompts/NN-*.md`) for the details of that step.
- A step prompt may change a decision on purpose. It then says so and updates this file (see "AGENTS.md updates" in `prompts/TEMPLATE.md`), replacing the rule it supersedes instead of adding a second one. If a prompt conflicts with a decision recorded here and does not say it is changing it, treat the prompt as stale: follow this file and flag the conflict in your report.

---

## Instructional Memory

Standing instructions from the user. They stay in force until the user changes them, and they outrank a step prompt that says otherwise. Add each new one here the moment the user gives it.

- **The iOS developer account comes last (2026-10-17).** The paid Apple Developer Program account is the last thing to set up, after the app is built, unless the user asks for it earlier. Until then the iPhone is tested in Expo Go.
  - Do not plan, prepare or run anything that needs that account: EAS iOS builds, `eas.json`, EAS environment variables, device registration, Apple credentials, the Sign in with Apple App ID capability, the Google iOS OAuth client, the Clerk iOS app entry and Apple SSO connection. The prepared steps wait in `prompts/35-ios-developer-account.md`.
  - Code for iOS-only features is still written when a step asks for it (for example the Apple button). What only an iOS development build can check is reported as "not verified on iOS" and waits for step 35. That includes Apple and Google sign-in on the iPhone, track-player lock-screen playback, RevenueCat purchases, and anything else a step logs that way. Android development builds are not affected.
  - Where a step prompt asks for an iPhone or EAS build, do the Android part and report the iPhone part as not verified. If a later step adds a native module that Expo Go does not include, the app may stop launching in Expo Go: say so at that step and ask whether to guard the module or move testing to the Android development build. Do not decide silently.

---

## Project Overview

Gracehush is a calm, private "audio sanctuary." Users speak or type a raw prayer or journal entry. The app then:

- transcribes the voice entry
- names and validates the user's emotion, with no toxic positivity
- selects one fitting, verified Bible passage (Berean Standard Bible)
- generates a ~60-second personalized spoken devotional with lock-screen playback
- creates three affirmations (morning, afternoon, evening) delivered as local notifications
- tracks active and answered prayers over time
- works offline first and syncs when the device reconnects

Primary audience: practicing Christians aged 25–45, likely female-leaning, who are busy and carrying emotional weight (anxiety, stress, grief, weariness). They often pray out loud in the car or on walks. The app must feel safe, warm, dignified, and private.

Brand mood: **"Warm Strength."** Grounded, mature, feminist-friendly. It should never feel childish, bubblegum pink, or clinical.

---

## Tech Stack

Use the following stack:

**Client**

- Expo SDK 57 with React Native 0.86 (New Architecture) and the React Compiler. The shipped app is a development build, because track-player and other native modules require it. No dev client exists yet (no `expo-dev-client`, no `eas.json`), so until a step needs one, UI work is verified in Expo Go SDK 57 and on the Android emulator (see Linting and Validation). From step 05, Apple and Google sign-in need a development build, while email sign-in and every other screen still run in Expo Go (the Clerk native modules are skipped there). In Expo Go, Google signs in through Clerk's browser flow instead (see Authentication Rules), and Apple shows the calm "isn't available" message.
- React Native + TypeScript
- React Navigation (`NavigationContainer`, native stack, bottom tabs) via `src/navigation/RootNavigator.tsx` and `MainTabs.tsx`. Installed: `@react-navigation/native` and `@react-navigation/native-stack`. Installed in step 08: `@react-navigation/bottom-tabs` 7.21.0. **Expo Router is not used**: never create an `app/` folder or `_layout.tsx`.
- NativeWind / Tailwind CSS for styling
- Zustand for global client state, with `@react-native-async-storage/async-storage` for persisted stores. Installed in step 07: `zustand` 5.0.15 and `@react-native-async-storage/async-storage` 2.2.0 (the SDK 57 pin). Install AsyncStorage with `npx expo install` only: the registry's latest (3.x) is not guaranteed to match Expo Go's native module. Never use the deprecated `AsyncStorage` from `react-native`.
- `@clerk/expo` (the current name of `@clerk/clerk-expo`) for authentication: our own UI on its custom-flow hooks, with `expo-secure-store` for the token cache, `expo-apple-authentication` and `expo-crypto` for Apple (iOS only), and `@clerk/expo-google-signin` for Google. Installed in step 05: `@clerk/expo` 4.13.0, `@clerk/expo-google-signin` 1.1.0, `expo-secure-store` 57.0.4, `expo-apple-authentication` 57.0.2, `expo-crypto` 57.0.4. `expo-auth-session` 57.0.16 was added after step 05, with approval, for the Expo Go Google fallback.
- `@supabase/supabase-js` with the Clerk session token injected per request
- `react-native-purchases` (RevenueCat) for subscriptions and paywall purchases
- `expo-audio` for AAC voice recording (`expo-av` is not part of SDK 57; see SDK note below). Installed in step 07: `expo-audio` 57.0.5, with its required peer `expo-asset` 57.0.20 as a direct dependency (native builds need it, and `expo-doctor` fails without it).
- `react-native-track-player` for devotional playback and lock-screen controls
- `expo-notifications` for local, on-device affirmation scheduling. Installed in step 07: `expo-notifications` 57.0.23. It cannot be imported in Expo Go on Android (see the SDK note below).
- `expo-haptics` for small taps through `src/services/haptics.ts` (see "Haptics" under UI Quality Bar). Installed in the step 11 follow-up, with the user's approval: `expo-haptics` 57.0.3 (`npx expo install`; Expo Go includes it, and it has no config plugin).
- Date and time pickers: `@expo/ui/community/datetime-picker` on iOS, `@react-native-community/datetimepicker` (imperative API) on Android. See Date & Time Pickers.
- Local SQLite cache (`expo-sqlite`, or WatermelonDB if it is already in `package.json`) for offline-first entries

**Backend**

- Supabase PostgreSQL 15 with Row Level Security and `pgvector`
- Supabase Storage for raw audio and TTS output
- Supabase Edge Functions (Deno), mainly `POST /process-entry`
- Clerk as the identity provider for Supabase RLS

**External services (server-side only)**

- Google Gemini Flash: multimodal transcription, emotion, scripture selection, devotional script, affirmations
- HelloAO Bible API: Berean Standard Bible text hydration
- Google Cloud Text-to-Speech: spoken devotional audio

Do not introduce new major libraries unless there is a strong reason.

### SDK and Vendor Version Notes

Before touching these areas, check `package.json`, `app.json`, and the current vendor docs:

- **expo-av** is not part of SDK 57 (it is missing from `bundledNativeModules.json`), so voice recording uses `expo-audio` (decided in the step 07 review). Its config plugin defaults to `enableBackgroundPlayback: true`, which adds the iOS `audio` background mode and an Android media-playback foreground service, so always set `enableBackgroundRecording` and `enableBackgroundPlayback` explicitly. Step 07 set both to `false` in `app.json`, so a build has no `audio` background mode and no media-playback foreground service. Step 23 decides background recording and step 26 decides playback.
- **expo-notifications** (57.0.x): its config plugin has no `enableRemoteNotifications` option (that is newer than SDK 57) and always adds the iOS `aps-environment` entitlement. Remote push does not run in Expo Go on Android, and the package cannot even be imported there: Expo Go 57.0.9 does not register `ExpoTopicSubscriptionModule`, so the import throws `Cannot find native module` at startup (found in step 07, with the user's approval to guard it). `src/services/notifications.ts` therefore skips the import in Expo Go on Android only (`Platform.OS === "android" && isRunningInExpoGo()`) and answers `"undetermined"` without a prompt. A development build and iOS always load it, so a real failure there is never hidden. The iPhone in Expo Go and the Android development build (step 05b) are where notification permission, channels and scheduling can be verified. On Android 13+ the channel must exist before the permission request, and a never-asked permission is reported as `denied` with `canAskAgain: true`, not `undetermined`, so decide from `canAskAgain` as well as `status`. Use the `AndroidImportance` enum, never numbers (its values changed).
- **Zustand `persist`** (5.x): when the storage read throws or the saved JSON is corrupt, the store never becomes hydrated (`hasHydrated()` stays false and `onFinishHydration` never fires), so a splash gate waits forever. Persisted stores use `src/store/safeStorage.ts`, which turns a failed read into "nothing saved".
- **Gemini model names** change over time, and `gemini-1.5-flash` is retired. Never hardcode a model name. Read it from the `GEMINI_MODEL` env var.
- **Google TTS voices**: Journey voices have limited SSML support. Verify that `<break>` and `<prosody>` work with the configured voice before relying on them. Read the voice name from the `TTS_VOICE_NAME` env var.
- **Clerk ↔ Supabase**: Clerk has moved from the "supabase" JWT template (signed with the Supabase JWT secret) to Supabase's native Third-Party Auth integration. Check which one the project uses. Do not migrate without asking.
- **Expo Router is installed but unused.** The app navigates with React Navigation. Since SDK 56 the Expo CLI refuses `@react-navigation/*` imports while `expo-router` is installed, so the root `.env` holds the non-secret flag `EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1`. Keep that file committed (only `.env*.local` is gitignored) and do not uninstall `expo-router` without asking. If it is ever removed, delete the flag.
- **Date and time pickers.** `@react-native-community/datetimepicker` 9.x deprecates `onChange` in favor of `onValueChange` / `onDismiss`. On the user's iPhone its iOS view never reported changes under the New Architecture (upstream issue #965), so iOS uses Expo UI's picker. Its Android _component_ re-opens the dialog on every value change, so Android uses the imperative `DateTimePickerAndroid.open`. See Date & Time Pickers.
- **expo-symbols on Android** scales the glyph with the system font size but not its box, which clips icons at large font sizes. Render icons through `src/components/Icon.tsx`.
- **@react-navigation/bottom-tabs** (7.21, read from its source in the step 08 review): a custom `tabBar` is rendered in normal flow below the scenes, so a scene already ends where the bar begins. Never add the bar's height to a screen's scroll padding. `useBottomTabBarHeight()` returns the default bar's estimate unless a custom bar reports its own height through `BottomTabBarHeightCallbackContext`, so this app does not use it. The scene background option is `sceneStyle`. A custom bar must emit `tabPress` (with `canPreventDefault`) before it navigates, as the default bar does, so `useScrollToTop` keeps working. On iOS under the New Architecture, React Native maps `accessibilityRole="tab"` to no trait and speaks no role (the legacy code that spoke it does not run on Fabric), so a tab's label has to say "tab" and its position (React Navigation's default bar does this on iOS only); on Android the role itself is announced, so the label is just the name.
- **A percentage offset on an absolutely positioned child resolves against the parent's content box** (React Native 0.86, found in step 08 on the Android emulator): the parent's padding and borders are not part of 100%. `FloatingInputDock` sits above the tab bar with `bottom: "100%"`, and while it was a child of the padded, bordered bar it ended at the bar's content height, so it overlapped the bar by the bottom inset plus the border (the mic ended 5dp below the bar's top instead of 20dp above it). It now sits in an outer view with no padding or border, beside the visible bar. Do the same for anything else that must follow a bar's real height (for example a mini player), or measure with `onLayout`.
- **`expo lint` runs the React Compiler rules as errors** (eslint-plugin-react-hooks 7.1.1, the `recommended` preset through eslint-config-expo; checked in the step 09 review by linting candidate code through stdin). These fail: `react-hooks/set-state-in-effect` (a `setState` directly in an effect body, or in a local function the effect calls before its first `await`) and `react-hooks/refs` (reading or writing `ref.current` during render, which includes the common `useRef(new Animated.Value(1)).current`: create an animated value with `useState(() => new Animated.Value(1))`, as `GracehushTabBar` does). These pass: `setState` inside a promise callback, an event-listener callback, an event handler or a `useFocusEffect` callback; a request counter in a ref used only in callbacks and effects; `useState(() => new Date())`; a previous value kept in state and compared during render; an effect that only sets state from a timer callback; `ListHeaderComponent` passed as an element; a `useRef` written and read only inside responder handlers (a scrubber's grab), a zustand action called from an effect, and a module-level `setInterval` and `AppState` listener in a store file (checked through stdin in the step 12 review, and by `npm run lint` on the built `playerStore.ts`, `ProgressScrubber.tsx` and `NowPlayingScreen.tsx`). `new Date()` in render also passes lint but is impure, and the compiler memoizes render, so keep a clock in state and refresh it on focus and on `AppState` `active`. Define components at module level (`react-hooks/static-components`).
- **`FlatList` clones `ListEmptyComponent` with a `style` prop and an `onLayout`, and wraps `ListHeaderComponent` in a plain `View`** (React Native 0.86.3 `VirtualizedList.render`, read in the step 09 review). An empty state that must center below the header is therefore an element whose root is a `View` that takes that `style`, with `flex: 1`, inside a content container with `flexGrow: 1`. A component used there has to forward `style` to its root, or the layout is silently ignored.
- **React Navigation 7 `navigate(name, params)` reuses the route that is already on top** (`StackRouter` NAVIGATE: "If the route matches the current one, then navigate to it") and replaces its params, so a double tap on a card opens one screen and needs no guard (checked in the step 09 review). A second tap on a different card swaps the params, which is why the dock keeps its `opening` ref guard: its `mode` must not change. **It does not go back to a route that is deeper in the stack: it pushes a second copy** (checked in the step 11 review by running the repo's own `StackRouter`, `@react-navigation/routers` 7.6.5: from `[MainTabs, Reflection]`, `navigate("MainTabs", { screen: "Journal" })` gives `[MainTabs, Reflection, MainTabs]`, and Android back then shows Reflection again). To return to a route that is already in the stack use `popTo(name, params)`, which gives `[MainTabs]` there (after New Entry's `replace` too); the tab navigator below consumes the new `screen` param when its route's params change (`useNavigationBuilder`, `@react-navigation/core` 7.24), and when no such route is below, `popTo` replaces the current one (a notification opening Reflection first, step 28). `navigate(name, params, { pop: true })` is the other way. Reflection's "Return to Journal" uses `popTo`.
- **A `Pressable` is accessible by default and groups its children into one accessibility element** (React Native's `accessible` prop), so a button inside a pressable card cannot be reached on its own with VoiceOver. Step 11's `MiniPlayerCard` makes the card `accessible={false}` (it still takes touches) and puts the labels on the play button and the "Open full player" link. Do the same for any tappable card that holds a control, and never put an accessible element inside another. (Step 11 emulator check, `uiautomator dump --compressed`: on Android that card is still listed as one clickable node with a label derived from its children's text, "Peace in the Midst, 1 min • Personalized devotional", and the play button, the spoken time and "Open full player" stay separate nodes. How iOS lists it was not verified.)
- **native-stack, `beforeRemove` and `usePreventRemove`** (`@react-navigation/native-stack` 7.21 and `@react-navigation/core`, read in the step 10 review). Every action that removes a route fires `beforeRemove` for it, `replace` included (`shouldPreventRemove` runs for each route that is missing from the next state), so a guard that blocks every removal also blocks the screen's own `navigation.replace(...)`. `usePreventRemove(prevent, callback)` (exported from `@react-navigation/native`) is the one that stops a native iOS dismissal such as swiping a modal down and still calls the screen back (`gestureEnabled: false` also stops the swipe, but silently): it registers the route in `PreventRemoveContext`, and native-stack then passes `preventNativeDismiss` to the screen. A bare `addListener("beforeRemove")` with `preventDefault()` only works for JS-driven back (Android): on iOS the screen is already gone natively and the library logs "removed natively but didn't get removed from JS state". The callback receives `data.action`, and dispatching it again passes the guard (it carries the routes already asked), so do that after the user confirms. To leave on purpose while the guard is on (a `replace` to the next screen, a Close button), set a ref first and re-dispatch `data.action` from the callback when the ref is set. `prevent` is a plain boolean prop, so it cannot be switched off and used in the same tick. The pattern passes the lint rules below.
- **Expo CLI rewrites `tsconfig.json` and deletes the generated, gitignored `expo-env.d.ts`** once typed routes are off, which drops the `*.css` module declaration from typecheck. Ambient declarations live in committed files under `src/types/`.
- **Expo Go** supports a limited set of SDKs at a time. Use the build that matches SDK 57 (on Android, the `Expo-Go-57.x` APK from the `expo/expo-go-releases` GitHub releases).
- **Expo Go on Android scopes permissions per project** (found in step 10 on the emulator, Expo Go 57.0.9). `getRecordingPermissionsAsync` keeps answering "not granted" (our `undetermined`) after the microphone is turned on in Android Settings or with `adb shell pm grant`, until Expo Go's own confirmation ("You've already granted permission to another Expo experience. Allow gracehush to also use it?") has been answered through a request. So in Expo Go the "turn it on in Settings and come back" re-check cannot be seen to succeed after an OS-level grant. The AppState re-check and the state change (card gone, orb back, no restart) were verified with a temporary relaxed condition (reverted); a development build reports the OS answer directly. After `adb shell pm revoke` Expo Go's process is killed, and the next orb tap goes straight to the denied card (Android treats the request as permanently denied).
- **`flex-none` does not reset `flexBasis` in react-native-css, and `basis-auto` compiles to nothing** (NativeWind 5.0.0-rc.0, read from the compiled bundle in step 10): `flex-none` becomes `flexGrow: 0, flexShrink: 0` only, so the `flexBasis: "0%"` that a `flex-1` component class sets survives, and there is no class that resets it. The compact `SegmentedControl` item (`segmented__item` plus `min-h-0 flex-none px-5 py-1`) still sizes to its content on the Android emulator (26dp visual height, 29.8 at font scale 1.3); why the 0% does not collapse it was not established, and iOS was not checked. Check a `flex-1` class overridden by `flex-none` on a device before relying on it.
- **An iOS `fullScreenModal` is `UIModalPresentationFullScreen`** (react-native-screens `RNSScreen.mm`), which UIKit never dismisses with a swipe; only `modal`, `pageSheet` and `formSheet` can be. NewEntry is a `fullScreenModal`, so only X, Cancel and Android back need the leave guard there.
- **A `View` with no visible styling is flattened away on Android, and when it later gains a background its re-created native view has lost its `borderRadius`** (React Native 0.86 Fabric, Expo Go 57.0.9, found in step 11 on the emulator and not seen on iOS, which was not checked). `SegmentedControl`'s items are transparent until selected: the item selected at mount is a pill, but every item selected afterwards was a square white or plum block that could poke out of the rounded track (the Reflection tabs and, since step 10, New Entry's Speak/Write toggle). Tested on the Reflection tabs, one workaround per tab: `collapsable={false}` and `overflow: "hidden"` on the item `View` each keep the pill round; an inline `borderRadius: 22` on the item, an explicit transparent background on the unselected items, and removing the pressed opacity from the `Pressable` do not. Filter chips are not affected because they always have a background. A control whose background or border appears on a state change needs `collapsable={false}` on that `View`. **Fixed for `SegmentedControl` in the step 11 follow-up (2026-10-20)**, with the user's approval (the step 11 prompt had forbidden touching it): its item `View` carries `collapsable={false}`, and the selected pill is round after every change (checked on the emulator on the Reflection tabs and on New Entry's toggle, in both directions, with the item bounds unchanged). Whether iOS ever had the bug was not checked.
- **`useReduceMotion` is one app-wide answer, asked for when its file loads** (step 11 follow-up, 2026-10-20, with the user's approval). Before, each component asked the OS after it mounted and started at `false`, so the answer came 40 to 500 ms late (measured in step 11: `FadeIn` logged `reduceMotion=false` and then `true` 43, 65, 209 and 486 ms apart on the emulator), and a component that animates on mount started its animation under Reduce Motion and stopped it a moment later: a 150 ms fade showed partway, and `Skeleton` and `usePulse` started briefly too. Now the file asks once at import and follows `reduceMotionChanged`, and the hook reads that answer with `useSyncExternalStore`, so a component sees the real value on its first render (the signature did not change, so no consumer was edited, and the OS is asked once for the whole app instead of once per mounted component). Checked on the emulator with temporary logs (reverted): after a cold start with Reduce Motion on, the OS answered 1.5 s after the file loaded and the first component subscribed 11 s after it, already seeing `true`; every new `FadeIn` logged `true` and never `false` first; turning the setting off and on again reached mounted components live; with animations on the fade ran to completion. A component that mounted before the OS answered would still start at `false`, which the splash gate (fonts, Clerk, the onboarding store) makes unlikely at start-up.
- **The app is light only, so `userInterfaceStyle` is `light`** (step 11 follow-up, 2026-10-20; found on the user's iPhone: with `automatic` and the phone in dark mode, the keyboard was dark under the cream UI, and switches and system alerts would be too). `app.json` says `"light"` (the merged config reads it), and the three text inputs also pass `keyboardAppearance="light"` (iOS only, and it works in Expo Go whatever the manifest does). The status bar is fixed `dark`. A night theme is a feature for after V1 ("Sweet Sleep" is a bedtime devotional). This resolves the step 08 open item about `userInterfaceStyle`. Not verified on the iPhone: whether Expo Go applies the project's `userInterfaceStyle`.
- **A layout that must follow the keyboard** (`WriteSection`, step 11 follow-up): on iOS `Keyboard` fires `keyboardWillShow` and `keyboardWillHide` before the keyboard moves, and `LayoutAnimation.configureNext({ duration, update: { duration, type: "keyboard" } })` with the event's duration moves the next layout change on the keyboard's own curve, as `KeyboardAvoidingView` does (read in React Native 0.86: it configures `LayoutAnimation` on iOS only, with that type). Android has only the `Did` events, so there the layout follows once the keyboard has moved, and `LayoutAnimation` is not used. `Keyboard.isVisible()` seeds the state when the view mounts with the keyboard already up, and Reduce Motion skips the animation. Verified on the Android emulator only (the heading collapses and returns and the card stays whole); the iOS animation was not verified.
- **A drag on a `View` inside a vertical `ScrollView` needs more than responder props on Android** (found in step 12 on the emulator, with the Now Playing scrubber and `ProgressScrubber`). The scrubber is a 44dp-tall `View` with `onStartShouldSetResponder`, `onMoveShouldSetResponder`, `onResponderGrant`, `onResponderMove`, `onResponderRelease` and `onResponderTerminate` (not a `PanResponder`, which is created once and holds stale callbacks), `onResponderTerminationRequest` returning false, and a 16dp thumb plus the 8dp track as `pointerEvents="none"` children, so `locationX` is relative to the 44dp view. `onResponderTerminationRequest` does not stop Android's `ScrollView`: once the finger drifts about 8dp vertically (the touch slop) the `ScrollView` takes the touch, React Native sends `onResponderTerminate` and the page scrolls. Measured at 320dp wide with font scale 1.3, a drag that drifted 53px (24dp) upward froze the thumb at 0:36 while the finger went on to about 0:48, and the page scrolled 44dp. So `NowPlayingScreen` sets `scrollEnabled={false}` on its `ScrollView` while a finger is on either scrubber (`onSeekStart` sets it, `onSeekEnd` clears it, and `onResponderTerminate` also calls `onSeekEnd`, so the state always ends): with it, a drag that drifted 406px (147dp) upward kept following the finger and the page did not move. A release or a terminate seeks to the last value, so a drag makes one `seekTo` (counted with a temporary log: one per tap, one per drag). The value follows the finger beyond the ends and clamps there (0:00 and 1:15 both held). Measured at 390dp: the view 350.3×43.7, the track 7.9 tall 18.1 from the top, the thumb 15.9×16.3 centered on the track and overhanging it by 8dp at each end (inside the 20dp screen padding), the elapsed and total labels 6.2dp under the track.
- **`opacity` on a group whose children overlap draws each child with the alpha on its own on Android** (React Native 0.86, found in step 12): the dimmed volume row (`opacity-40` while the ambient sound is Off) let the fill's end show through the thumb as a darker half-disc. `needsOffscreenAlphaCompositing` on the dimmed `View` composites the group first and fixes it (an Android-only prop, ignored on iOS). Use it on any dimmed group whose children overlap.
- **An Android `modal` stack screen without `animation` does not slide up** (react-native-screens 4.26, read from `FragmentTransactionKt.kt` and the resource `rns_default_enter_in`, then recorded on the API 37 emulator): on API 33+ the default is a fade with a 10% slide in from the right. `animation: "slide_from_bottom"` slides it up like a sheet (the resource is `rns_slide_in_from_bottom`, and the screen below stays still). Both were recorded with `screenrecord` and read frame by frame (see "Verifying on this machine"). iOS swipes a `modal` down by itself, so the option only matters on Android there; it was not verified on iOS.

---

## Development Philosophy

Build feature by feature.

For every feature:

1. Understand the user request.
2. Check this file before coding.
3. Keep the implementation simple.
4. Avoid overengineering.
5. Prefer readable code to clever code.
6. Build the smallest useful version first.
7. Refactor only when repetition or complexity appears.
8. Never trade user privacy, scripture accuracy, or crisis safety for speed.

---

## Decision Making & Clarifications

If something is unclear or could be improved:

- Proactively suggest better approaches.
- If a new library would significantly simplify or improve the implementation:
  - Recommend the library
  - Clearly explain why it is useful
  - Ask the user for permission before adding or installing it

Example:

> "The ambient soundscape needs a second audio channel that plays alongside track-player. `expo-audio` can loop it cleanly. Do you want me to add it?"

Do not install or use new libraries without user approval. That includes packages already in `package.json` that the stack above does not mention (for example `@expo/ui`): name the package and the reason before first use. Approved so far: the Expo UI date-time picker for iOS (step 03), and in step 05 `@clerk/expo`, `@clerk/expo-google-signin`, `expo-secure-store`, `expo-apple-authentication`, `expo-crypto` and `expo-constants` (to detect Expo Go), then `expo-auth-session` (the Expo Go Google fallback), and in step 07 `zustand`, `@react-native-async-storage/async-storage`, `expo-notifications`, `expo-audio` and its required peer `expo-asset`, and in step 08 `@react-navigation/bottom-tabs`, and in the step 11 follow-up `expo-haptics`.

Always ask before:

- installing, upgrading, or removing any dependency (including `expo-router`)
- creating or changing a database migration
- changing RLS or storage policies
- deploying an Edge Function
- changing the auth integration (JWT template vs. Third-Party Auth)
- changing RevenueCat products, entitlements, or pricing copy

---

## Architecture Guidelines

Use this structure unless there is a strong reason to change it:

```txt
gracehush/
├── App.tsx                     # App = ClerkProvider (SecureStore tokenCache). AppShell = splash gate (fonts, Clerk isLoaded and the onboarding store's hydration), SafeAreaProvider, NavigationContainer, StatusBar. Providers only, no screen UI
├── index.ts                    # registerRootComponent(App)
├── app.json                    # Base config: bundle ID / package, background audio modes, plugins, permissions copy
├── app.config.ts               # Extends app.json: puts the Google client IDs and iOS URL scheme from process.env into expo.extra
├── .env                        # Non-secret tooling flag EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1 (keep committed). Never put real keys here
├── .env.local                  # Real EXPO_PUBLIC_* keys (Clerk, Google client IDs), added in step 05. Gitignored by `.env*.local`
├── .env.example                # The same key names with empty values. Committed
├── global.css                  # @theme tokens, type scale, BEM utilities (NativeWind v5, no tailwind.config.js)
├── assets/
│   ├── fonts/
│   ├── images/
│   └── audio/                  # Ambient loops (soft-rain.mp3, gentle-piano.mp3 …)
├── src/
│   ├── api/                    # journalApi.ts — calls Edge Functions
│   ├── components/             # Reusable UI. Built: Icon, PrimaryButton, BottomSheet, PrivacyNoteCard, GracehushTabBar (the custom bottom tab bar, which renders FloatingInputDock once), FloatingInputDock, ScreenHeader (shared by the three tabs), and from step 09 AffirmationCard, JournalCard (one card for every processing status), EmotionBadge, OfflineBanner, Toast, Skeleton, and from step 10 SegmentedControl (compact or full width, plum or light), ConfirmDialog (the one centered confirmation) and Waveform (the nine recording bars), and from step 11 MiniPlayerCard (`devotional`, `track`, `ambientDefault`, `onOpen`: the audio card on the shared player store, or the no-audio card when `track` is null), ScriptureCard, ReflectionCarousel (the Devotional, Affirmations and Closing Prayer panes), TranscriptRow (the collapsible words row; step 13 reuses it with another title) and FadeIn (a 150ms fade-in that a new `key` replays; optional `delay`, `rise` and `duration` for the Reflection arrival), and from step 12 ProgressScrubber (the draggable track: the player's scrubber and the ambient volume; step 15 reuses it). Planned: PrayerCard, …
│   │   └── dev/                # DevToolsPanel.tsx: the developer controls, rendered only when __DEV__ and never shown to users
│   ├── constants/              # Built: images.ts, theme.ts (`layout` also holds the tab bar and dock numbers: tabBarHeight, dockOffset, dockPen, dockOrb, dockClearance, and the New Entry orb: recordOrb 84, recordHalo 124), copy.ts (`journal` holds every Journal Home string and the card summary labels, `newEntry` every New Entry string, `reflection` every Reflection string, `nowPlaying` every Now Playing string and `ambient.labels` the one label map for the ambient choices: Off, Soft Rain, Gentle Piano, Morning Birds), app.ts (FREE_DEVOTIONALS_PER_WEEK, WEEK_STARTS_ON, DEFAULT_REMINDERS, AFFIRMATION_CHANNEL_ID, MAX_RECORDING_MS, MIN_RECORDING_MS, RECORDING_WARNING_MS, MAX_TEXT_LENGTH, MIN_TEXT_LENGTH, TEXT_COUNTER_FROM, WAVEFORM_BAR_COUNT, and from step 12 SKIP_MS, PLAYBACK_RATES and AMBIENT_SOUNDS; later steps add more). Planned: crisisResources.ts, sounds.ts
│   ├── data/                   # Built in step 06
│   │   ├── mock/               # Typed mock rows (DB shape), the mutable mockDb (db.ts also has addMockEntry), dates.ts, scenario.ts (reads the dev store; MockSubmitOutcome and takeMockSubmitOutcome), scripture.ts. Dev/preview only
│   │   ├── mappers.ts          # DB row (snake_case) → app model (camelCase)
│   │   ├── journalRepository.ts  # Async data access used by screens (mock now, real later), including the mock submitEntry
│   │   └── selectors.ts        # Pure derived values (counts, reflection days, current slot, JournalFilter and filterEntries, and getPlaybackTrack: the track an entry can play, or null)
│   ├── db/                     # Local SQLite cache + sync queue
│   ├── hooks/                  # Built: useAnnounce, useAuthActions, useStoreHydrated (true once a persisted store has loaded), useTabScreenBottomPadding (the space a tab screen leaves for the dock), useJournalHome (everything Journal Home loads, as one HomeState), useReduceMotion (one app-wide answer, asked for when the app loads; steps 11, 12, 14 and 23 reuse it), and from step 10 useRecorder (the recording state machine and its levels, on the mock recorder service) and usePulse (a 2s opacity or scale pulse that rests at 1 while inactive or under Reduce Motion), and from step 11 useReflection (everything Reflection loads, as one ReflectionState), and from step 12 usePlayback (the whole player store; only MiniPlayerCard's AudioCard and NowPlayingScreen call it, because it re-renders on every tick; it replaced step 11's useMockPlayback, which was deleted). Planned: useSupabase, useJournalEntries, useEntitlement, …
│   ├── navigation/             # Built: RootNavigator.tsx, MainTabs.tsx (the three tabs with the custom bar), types.ts (RootStackParamList, MainTabParamList, RootStackScreenProps, MainTabScreenProps)
│   ├── screens/
│   │   ├── onboarding/         # OnboardingScreen (Welcome → Rhythm → Permissions) — built
│   │   ├── auth/               # SignInScreen + EmailSheet — built, on Clerk
│   │   ├── journal/            # JournalFeedScreen and JournalFilterSheet — built in step 09; NewEntryScreen with SpeakSection, WriteSection and ProcessingOverlay — built in step 10; ReflectionScreen and ReflectionStateViews (the loading, temporary crisis, still-preparing, failed, not-found and error views; `MessageView` is exported for Now Playing) — built in step 11; NowPlayingScreen — built in step 12
│   │   ├── prayers/            # PrayersScreen (TEMP placeholder until step 14)
│   │   ├── profile/            # ProfileScreen (TEMP placeholder until step 15; it hosts DevToolsPanel)
│   │   └── paywall/            # PaywallScreen (TEMP placeholder until step 16)
│   ├── services/               # Built in step 07: permissions.ts (the shared status mapper), recorder.ts (the microphone permission, and from step 10 a mock recorder: `startRecording`, `stopRecording` and `cancelRecording`, `TEMP(23)`) and notifications.ts (affirmation channel and notification permission only), and from the step 11 follow-up haptics.ts (`haptics.selection`, `light`, `medium` and `success`). Planned: audioPlayer.ts, supabaseClient.ts, purchases.ts (the step 04 mock auth.ts was deleted in step 05)
│   ├── store/                  # Zustand stores. Built in step 07: onboardingStore.ts, safeStorage.ts (the storage every persisted store uses). Built in step 09: devStore.ts (non-persisted, development only). Built in step 12: playerStore.ts (non-persisted: what the mini player and Now Playing show; a mock until step 26, `TEMP(26)`)
│   ├── types/                  # index.ts (app models and Edge Function contracts, plus AuthErrorCode and AuthResult) and database.ts (row types, hand-written until step 18). Also assets.d.ts (*.svg), expo.d.ts (expo/types)
│   └── utils/                  # format.ts — pure date, time, duration (formatDuration, formatDurationSpoken, formatTimer, formatEntryDate), countWords, getValidationHeadline, quoteVerse (a verse in curly quotes that keeps its own marks), affirmation-source and name formatters
└── supabase/
    ├── functions/
    │   ├── process-entry/      # Main AI orchestration
    │   └── _shared/            # auth.ts, bibleBooks.ts, cors.ts, errors.ts
    └── migrations/             # All schema + policy changes, timestamped
```

`src/app/` (the Expo Router template) was deleted in step 03. Do not recreate it. Screens are plain components registered in `RootNavigator`.

### src/screens/

Use this for screens only.

Screens compose components and call hooks, stores, and services. They should not contain large reusable UI blocks, network calls, or business logic.

### src/components/

Create a component only when:

- it is reused in multiple places
- it makes a screen easier to read
- it represents a clear UI concept

Built so far: `Icon` (every icon), `PrimaryButton` (every primary action; `iconLeft` and `iconRight` are both optional, 18 and white), `BottomSheet` (every sheet, see Bottom Sheets), `PrivacyNoteCard`, `GracehushTabBar` (the custom bottom tab bar: it renders `FloatingInputDock` once, so the dock stays mounted across tabs) and `ScreenHeader` (the header of the three tabs). Step 09 added `AffirmationCard`, `JournalCard`, `EmotionBadge` (takes only `emotion`; steps 12, 13 and 14 reuse it), `OfflineBanner`, `Toast` (only `message` and `visible`) and `Skeleton` (`height`, `width`, `radius`; step 11 reuses it). Step 10 added `SegmentedControl` (`items`, `value`, `onChange`, `variant` "light" or "plum", `compact`, `disabled`; the container is a `tablist` and each item a `tab`; steps 11 and 14 reuse it full width), `ConfirmDialog` (`visible`, `title`, `body`, `confirmLabel`, `cancelLabel`, `tone`, `icon`, `loading`, `children`; steps 14, 15, 29, 31 and 34 reuse it) and `Waveform` (`levels`, `active`; step 23 reads it). Step 11 added `MiniPlayerCard` (since step 12: `devotional`, `track` from `getPlaybackTrack(entry)` (null renders the no-audio card), `ambientDefault` (the profile) and `onOpen`; its `AudioCard` reads the player store through `usePlayback` and loads its track only when the user plays or opens it), `ScriptureCard` (`scripture`), `ReflectionCarousel` (`devotional`, `affirmations`, `reminders`, `currentSlot`; its tab values are `devotional`, `affirmations` and `prayer`, which step 28 opens it on), `TranscriptRow` (`title`, `transcript`; step 13 reuses it) and `FadeIn` (children, and optional `delay`, `rise` and `duration`; a new `key` replays the fade). Step 12 added `ProgressScrubber` (`value`, `max`, `step`, `color`, `trackHeight`, `disabled`, `accessibilityLabel`, `formatValueText`, `onSeekStart`, `onSeekChange`, `onSeekEnd`; controlled, an `adjustable` element; the player's scrubber and the ambient volume, and step 15's volume reuses it). `components/dev/DevToolsPanel.tsx` holds the developer controls: it renders only when `__DEV__`, and later steps add their controls to it as new sections.

Expected components for V1 (create each one only when it is first needed):

`PrimaryButton`, `SegmentedControl`, `EmotionBadge`, `JournalCard`, `AffirmationCard`, `ScriptureCard`, `MiniPlayerCard`, `ReflectionCarousel`, `FloatingInputDock`, `PrayerCard`, `SettingsRow`, `PlanCard`, `BottomSheet`, `ConfirmDialog`, `PrivacyNoteCard`, `OfflineBanner`, `Skeleton`, `Toast`.

Do not create tiny one-off components too early.

When unsure, ask:

> Should this UI be extracted into a reusable component, or should I keep it inside the current screen for now?

### src/api/ and src/services/

- `api/` holds HTTP calls to Edge Functions. Each call returns typed data or a typed error.
- `services/` holds device and SDK wrappers (audio, notifications, purchases, Supabase client).
- Screens never call `fetch` directly.

---

## Navigation Map

```txt
RootNavigator
├── OnboardingStack        (shown until onboarding is completed)
│   └── Onboarding         (3 steps: Welcome → Rhythm → Permissions)
├── AuthStack              (signed out)
│   └── SignIn
└── AppStack               (signed in)
    ├── Tabs
    │   ├── Journal        → JournalFeedScreen
    │   ├── Prayers        → PrayersScreen
    │   └── Profile        → ProfileScreen
    ├── NewEntry           (full-screen modal)
    ├── Reflection         (push)
    ├── NowPlaying         (modal sheet)
    └── Paywall            (full-screen modal)
```

- The tab bar is hidden on Onboarding, SignIn, NewEntry, NowPlaying, and Paywall.
- The floating input dock (a small pen button beside a larger mic orb) is anchored bottom-right, above the tab bar, on all three tabs, as shown in the designs. It is not a centered pill.
- The Paywall opens from the Profile upgrade card, or when the free limit is reached.

**Current state (step 08).** `RootNavigator` is a native stack (`headerShown: false`, linen `contentStyle`) that reads `useAuth()` from Clerk and `hasCompletedOnboarding` from the onboarding store, and renders its screens conditionally (React Navigation's auth flow), with no `initialRouteName`: the first screen of the active branch is the initial one. While `!isLoaded` it returns `null` (the splash is still visible, and `AppShell` also holds it until the onboarding store has loaded). `RootStackParamList` and `MainTabParamList` live in `src/navigation/types.ts`, with `RootStackScreenProps` and `MainTabScreenProps`: always type `useNavigation` (for example `useNavigation<MainTabScreenProps<"Journal">["navigation"]>()`) and add no global `ReactNavigation.RootParamList`. The signed-in group is `MainTabs` (first, so it is the initial route), `NewEntry` (`fullScreenModal`), `Reflection` (push), `NowPlaying` (step 12: `presentation: "modal"` with `animation: "slide_from_bottom"`, after `Reflection`) and `Paywall` (`modal`). The four screens above the tabs hide the tab bar and the dock by covering them: there is no manual hide logic. `MainTabs` (`src/navigation/MainTabs.tsx`) is a bottom-tab navigator (`initialRouteName="Journal"`, `lazy`, linen `sceneStyle`, the default back behavior, so back from Prayers or Profile returns to Journal) with the custom `GracehushTabBar`. The remaining guards above arrive in later steps.

```txt
!isSignedIn && !hasCompletedOnboarding → Onboarding (initial), SignIn
!isSignedIn &&  hasCompletedOnboarding → SignIn only
 isSignedIn                            → MainTabs (initial), NewEntry, Reflection, NowPlaying, Paywall
```

- `NowPlaying` takes `{ entryId }` and is opened by `navigation.navigate("NowPlaying", { entryId })` from `Reflection`'s mini player (and from the dev panel's "Open player (dev)" row). **It loads on the user's action, not on view.** The mini player's play button and its card or "Open full player" link call `load(track, profile)` first when their entry is not the loaded one, so the sheet opens with the track already in the store and never flashes a skeleton (checked with a temporary render log: zero skeleton renders). Opened by route with an entry that is not loaded (the dev row, and later a notification), the screen runs `useReflection` and loads the track from an effect: a skeleton shows meanwhile. Once the store holds the entry the screen draws from the store alone, so a slow or failed `useReflection` never hides a player that is running. A crisis entry never has a track (`getPlaybackTrack` is null), and its route shows the same "We couldn’t find this devotional." as a missing one. **Leaving Now Playing or Reflection does not pause**: playback stops only when another devotional is loaded, `stop()` runs, or the app leaves the foreground (`TEMP(26)`, the mock only). Android back from the sheet returns to Reflection; three quick taps on the card open one sheet (`navigate` to the route on top reuses it).

- Nothing navigates after sign-in. When the session becomes active the navigator swaps the signed-out branch for the signed-in group (`MainTabs` first), so back cannot return to auth. `navigation.reset`, `SignInScreen.goHome()` and the sheet's `onSignedIn` are gone. The email sheet still calls its own `close()` after a successful verify, and the navigator may unmount the screen first.
- A session with a pending task counts as signed out (Clerk's default `treatPendingAsSignedOut`), so the user stays on Sign In.
- Completing onboarding removes `Onboarding` from the branch, so the navigator shows `SignIn` by itself: **never call `navigate('SignIn')` after `completeOnboarding()`**. "I already have an account" still calls `navigate('SignIn')` without completing, so its back chevron returns to Welcome.
- Returning users: an effect in `RootNavigator` calls `completeOnboarding()` when Clerk has loaded, the user is signed in and onboarding is not completed, so signing out later opens Sign In and not Welcome. Every hook in `RootNavigator` sits above the `!isLoaded` early return.
- A screen that is only added to the branch never becomes the focused one (`StackRouter.getStateForRouteNamesChange` keeps the existing routes). So `SignIn` carries `navigationKey={hasCompletedOnboarding ? "onboarded" : "onboarding"}`: when onboarding is reset the key changes, SignIn's route is dropped and the navigator falls back to the first screen, `Onboarding`. Without it the dev reset left the user on Sign In. (Added in step 07: the prompt expected the navigator to return to Welcome by itself, and it does not.)
- The developer controls live in `src/components/dev/DevToolsPanel.tsx`, at the bottom of the Profile placeholder, and render only when `__DEV__`: the signed-in primary email, the step 06 data check with its three scenario buttons (they go through the dev store, `useDevStore`, which Journal Home subscribes to), the "Next submit (dev)" selector (`ready`, `crisis`, `failed`, `limit`: what the next New Entry submit answers, `nextSubmitOutcome`, which goes back to `ready` as soon as a submit takes it), "Fail next Journal load (dev)" (arms `nextHomeLoadFails`, so the next Journal Home load fails once and the error state can be reached; the button shows as selected while armed), "Fail next Reflection load (dev)" (arms `nextReflectionLoadFails`, the same for Reflection), the "Open reflection (dev)" row (Ready, No audio, Typed, Processing, Pending, Failed, Crisis and Not found: the first entry of each kind in the current scenario, taken from `listEntries()` and disabled when the scenario has none, each calling `navigate("Reflection", { entryId })`, which is how the views that no Journal card opens are reached; Not found uses an id no entry has), "Open paywall (dev)", "Sign out (dev)" (Clerk `signOut()` only; `TODO(31)`: full sign-out cleanup) and "Reset onboarding (dev)" with its helper text. The reset awaits `signOut()` first, then calls `resetOnboarding()` and `useOnboardingStore.persist.clearStorage()` (which removes only the `gracehush.onboarding` key). The session goes first because, while it is live, the returning-user effect marks onboarding completed again. No other sign-out path touches the onboarding store: onboarding is per device.
- `NewEntry` guards leaving with `usePreventRemove(phase !== "editing" || hasContent, …)`. While sending nothing may leave (Android back does nothing). In the editing phase with content, and in the error phase, it shows the "Discard this reflection?" dialog and keeps the stopped action until the dialog is answered: confirming re-dispatches it, and it passes because the action carries the routes the guard has already asked. Every deliberate exit (`replace("Reflection")`, `replace("Paywall", …)`, "Close" while sending, "Save and close") sets a `leaving` ref just before, and the guard then passes the action straight on. A `fullScreenModal` is `UIModalPresentationFullScreen` on iOS (react-native-screens source), which iOS never dismisses by swiping, so the guard covers X, Cancel and Android back.
- `Reflection` leaves with `navigation.goBack()` (the chevron, which returns to wherever the user came from) or with `navigation.popTo("MainTabs", { screen: "Journal" })` ("Return to Journal" on every view, and the chevron when `canGoBack()` is false, which a notification opening Reflection first can cause, step 28). Never `navigate("MainTabs", …)` from there: it pushes a second `MainTabs` and Android back reopens Reflection (see the `popTo` vendor note).
- The Sign In back chevron renders only when `navigation.canGoBack()` is true. An empty 44×44 spacer keeps "Step 1 of 1" centered when it is hidden.
- Tab screens share one layout (steps 09, 14 and 15 keep it): a top-edge `SafeAreaView` (linen), `ScreenHeader` above the `ScrollView` (the header does not apply the top inset), and the `ScrollView` takes `contentContainerStyle={{ paddingBottom: useTabScreenBottomPadding() }}` (112, the dock clearance: the bar is in flow below the scenes, so never add its height) and `useScrollToTop(ref)`. A `FlatList` (the Journal feed) follows the same layout through its own content container and ref; its side padding is numeric, from `useWindowDimensions` (`layout.screenPaddingNarrow` below `layout.narrowBreakpoint`, else `layout.screenPadding`), the rule `.screen__content` applies to views. The Journal feed (step 09) is built on this layout, on one `FlatList` that stays mounted in every state: loading, error, empty and filtered-empty are its `ListEmptyComponent`, and the greeting, banner, affirmation card and section row are its `ListHeaderComponent`. `useJournalHome` loads through `useFocusEffect` (on focus, on a scenario change while focused, when the app returns to the foreground, and on pull-to-refresh), so a tab that is not in front never loads: a scenario changed on Profile loads when the Journal tab is next opened, which is why "Fail next Journal load (dev)" followed by a scenario switch shows the error card.
- `GracehushTabBar` follows React Navigation's custom bar contract (`tabPress` with `canPreventDefault`, then `CommonActions.navigate` with the state's key; `tabLongPress`), so `useScrollToTop` works: tapping the active tab scrolls to the top. The event carries no `data.behavior`: `useScrollToTop` and native-stack both read a missing value as "allowed". Each item stacks two colored layers (inactive `mauve` Medium, active `plum` SemiBold, the filled symbol on iOS) that cross-fade in 150ms, and is the only accessibility element (`tab` role and `selected` state; on iOS the label also says "tab" and its position through `copy.tabs.a11yLabel`).
- `FloatingInputDock` (pen: `NewEntry` with `{ mode: "write" }`, mic: `{ mode: "speak" }`) is bottom-right: 20 from the right edge, its bottom edge 20 above the bar. A ref guard blocks a second open until the tabs are focused again (`useIsFocused`); without that reset the dock stops working after its first use.
- The header avatar shows on all three tabs: a button to the Profile tab on Journal and Prayers (`avatar="link"`), a plain circle on Profile (`avatar="static"`). It is the only thing on the right of the header: the lotus the Stitch designs show beside it was removed on 2026-10-20 (the step 09 follow-up). It had no function (the HTML labels it "Serene sanctuary" and gives it no behavior, and no prompt assigns one), a bare 44×44 icon beside a real button reads as tappable, iOS has no lotus symbol (it showed a leaf there, so the platforms differed), and a lotus signals spa or Eastern meditation to an explicitly Christian audience. Do not add a header action without a defined feature; the strongest later candidate is "Support & Helpline Resources", which needs its own icon and sign-off on any crisis-handling change.

- Onboarding is **one screen** (`OnboardingScreen`) with a local `step` state (0–2), never three routes. Steps cross-fade in about 200ms with the React Native `Animated` API (opacity out, then in).
- Android back (hardware key and system gesture) returns to the previous step. The handler is registered with `useFocusEffect`, so it is active only while Onboarding is focused. On step 0 the default back behavior applies.

---

## UI Implementation Rules (VERY IMPORTANT)

For any UI-related task:

- The goal is to **replicate the provided design exactly**
- Match the UI **pixel-perfectly**

When the user provides a design image, you MUST:

- match layout exactly
- match spacing and padding
- match font sizes and hierarchy
- match colors precisely
- match border radius and shadows
- match alignment and positioning
- match proportions of elements
- replicate all visible UI elements that belong to the real app

Do not approximate. Do not simplify unless explicitly asked.

### Design references

- `prompts/DESIGN.md` is the design system (Warm Sanctuary). Colors come from the table in the Design System section. Ignore the Material palette in its front-matter.
- Each screen has a screenshot `prompt_material/NN-name.png` and the Stitch HTML `prompt_material/NN-name.html`. Identical copies of the screenshots are in `Images/` (`N._name.png`), and some prompts point there, but only `prompt_material/` has the HTML. The HTML holds the exact values, where 1 CSS px = 1dp. The PNGs are rendered at 1.25x (a 390dp screen is 487px wide), so never measure dp from a PNG.
- If the HTML uses a color, radius, or size that is not a token, keep the token and report the difference.

### Standing Rulings (decided in steps 03, 04, 09, 10 and 11, apply to every screen)

- Tokens win over the HTML: `ink` / `mauve` for text (the HTML uses its own charcoals), `petal` for borders and dividers, the 2-stop `gradients.brand` for gradient hero cards (the HTML adds a deeper middle stop), `.btn-primary` (48 min height, 15 SemiBold label) instead of the HTML's 52-tall 16px button, and the type scale for body text (`text-body-lg` 17, `text-body` 15) instead of the HTML's 16 and 13.
- Skip decorative extras the HTML adds, such as blurred glow circles and inner shadows, unless a prompt asks for them.
- When the HTML copy differs from the step prompt or the Screen Specifications below, use the prompt and the specifications.
- Sizes come from the HTML. If a step prompt lists sizes that disagree with its HTML, they were probably measured from the 1.25x PNG: build from the HTML and the tokens, and report the difference, unless the prompt says it is overriding the HTML on purpose.
- A Stitch state view (offline, empty) swaps out whole sections of the screen to show one state. Build the real screen from the normal view, and add only what the state view adds, in the HTML's order and with its spacing. For example, the offline banner goes directly under the greeting, and the affirmation card and the section row stay (step 09).
- A Stitch HTML can hold views its PNG does not show (New Entry's Write and Processing views, step 10): read the whole HTML, and take sizes from it. PNG scales differ per file (about 1.25x for most, about 1.8x for `04-new-entry.png`), so never measure a PNG.
- Controls the HTML shows that the app has no data or function for are skipped and reported, not built as decoration. Step 10 skips the Write view's mood chips (the request contract has no field for them, and the AI names the emotion), its "Auto-saved" tag (nothing is saved while typing) and its clear button (the discard dialog covers it). A color the HTML uses that is not a token maps to the nearest token (the waveform's brown bar is `rosewood`), never to a new token.
- `rose` is a fill, never text (colour table). Where the HTML sets small text in `dusty-rose` on a plum surface (Reflection's player card subtitle and times, 3.88:1), build it white at 70% (5.61:1) and keep `rose` for circles, progress fills and icons (step 11).
- A heading size that has no type-scale token and whose line count matters is a one-off class, measured from the font files, with the reason in the step log: Reflection's headline is `font-fraunces text-[27px] leading-[34px] tracking-[-0.675px]` because `text-headline-lg` (30/38) and `text-title` (28 SemiBold) both make three lines at 390dp where the HTML has two (step 11).

### Design Tool Artifacts — DO NOT IMPLEMENT

The reference screenshots were generated in Google Stitch and contain preview-only controls that switch between design states. These are **not** part of the real UI:

| Screen     | Artifact to ignore                                                   | Real behavior                                                           |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Onboarding | Pill tabs "1: Welcome / 2: Rhythm / 3: Permissions"                  | Keep only the progress dots + "1 OF 3" counter                          |
| Sign In    | Inline email field revealed by the HTML's `toggleEmailInput()` script, and the "By continuing you agree…" footer that the screenshot omits | "Continue with email" opens a bottom sheet (email, then a 6-digit code). No Terms or Privacy text on this screen |
| Journal    | Toggle "Feed (Normal) / Offline Sync / Empty State"                  | States are driven by real data and network status                       |
| New Entry  | Outer toggle "Speak / Write / Processing State" and duplicate header | One header ("New Reflection" + "Saved locally"), one Speak/Write toggle; the Processing view is the full-screen overlay shown while submitting |
| Reflection | Toggle "Devotional View / Now Playing Sheet / Crisis Support", and the header's bookmark and share icons | Now Playing opens from the mini player; Crisis is a data state; share lives in the footer (there is no bookmark feature) |
| Prayers    | Link "Preview Mark Answered Sheet"                                   | The sheet opens from each card's "Mark Answered" button                 |
| Profile    | Toggle "Settings / Export View (Dialog) / Delete View (Dialog)"      | Dialogs open from the Export / Delete rows                              |

Also do not replicate rendering glitches in the references. Examples: the scripture reference overlapping the verse text on Reflection, placeholder dashes where icons failed to render, and truncated or wrapped labels. Implement the clear intent of the design. If the intent is ambiguous, ask.

Third tab is labeled **Profile**, with a person icon (resolved in step 08): the "Sanctuary" label and church icon on the Prayers and Profile screenshots are a design inconsistency.

---

## Screen Specifications (V1 — 8 Screens)

Use these as the source of truth together with the screenshots.

### 1. Onboarding (3 steps)

Built in step 03 as a single `OnboardingScreen` (see Navigation Map). Its copy lives in `copy.onboarding`.

- Header: progress indicator on the left (the active step is a plum pill 28×8, the others are 8×8 petal dots) and the counter on the right ("1 OF 3", accessibility label "Step 1 of 3"), then an edge-to-edge petal divider. The content scrolls. The footer (primary button plus a text link) is pinned above the safe-area inset.
- Step 1 — Welcome: plum-to-rose gradient hero card (radius 24) with a frosted icon tile (candle-in-hands mark, `images.logoMark`), "Gracehush" wordmark in Fraunces, "AUDIO SANCTUARY" label. Title "A quiet place for your heart." Subtitle about speaking or writing. Primary "Get Started", link "I already have an account" (opens SignIn).
- Step 2 — Rhythm: three separate cards (Morning 8:00 AM, Afternoon 1:00 PM, Evening 8:00 PM). Each card is one touch target that opens the time picker for its slot (see Date & Time Pickers). Times are `"HH:mm"` 24-hour strings saved on the device in the onboarding store (`reminders`, persisted), shown as `h:mm AM/PM`. Step 17 syncs them to the user's profile: `remindersSyncedAt` stays `null` until then, and any change sets it back to `null`. Primary "Continue", link "Back".
- Step 3 — Permissions primer: explain the microphone and notifications **before** the OS prompts appear. "Allow & Continue" shows its loading state (and "Maybe later" is disabled) while it reads the microphone status, then the notification status, and requests each one **only when it is `undetermined`**. A permission that can still be asked counts as `undetermined` (see `services/permissions.ts`), and one that is already granted or permanently denied is not requested again. It then calls `markPermissionsPrompted()` and `completeOnboarding()`, and the navigator shows Sign In. A denial never blocks the user and shows no error. "Maybe later" calls `completeOnboarding()` only: nothing is requested and `permissionsPromptedAt` stays `null`, so steps 10, 23 and 28 ask in context later. Neither button navigates.

### 2. Sign In

Built in step 04 and running on Clerk since step 05 (`useAuthActions`). One screen serves new and returning users: there is no separate Sign Up screen, and no password field anywhere.

- Header: a back chevron (shown only when there is a screen to go back to, with an empty spacer otherwise) and "Step 1 of 1".
- Soft blush icon tile with the logo mark, title "Your sanctuary is waiting.", and a subtitle about keeping reflections safe and synced.
- Stacked pill buttons, each 48 tall like `.btn-ghost`: "Continue with Apple" (black, white Apple logo, always first and at least as prominent as Google, per App Store Guideline 4.8), "Continue with Google" (white, Petal border, the official multicolor G), an "or" divider, then "Continue with email" (white, rosewood mail icon).
- From step 05, "Continue with Apple" renders on iOS only (the native flow is iOS-only, and Guideline 4.8 applies to iOS). On Android the stack shows Google and email with no gap.
- "Continue with email" opens a blush bottom sheet: the email address first, then a 6-digit one-time code that auto-submits, with a 30-second resend cooldown and "Use a different email".
- Privacy note card (Soft Blush, Petal border, lock icon): "Your entries are private…"
- Any other error shows as calm rosewood text under the buttons, never in Crisis Red. A cancelled Apple or Google prompt shows nothing.

### 3. Journal Home (Feed)

- Header: the shared `ScreenHeader` (step 08): "GRACEHUSH" eyebrow + "Journal" title, avatar button (no lotus, see the Navigation Map).
- Greeting "Good morning, Sarah" + the long date. The period comes from the clock (5 to 11 morning, 12 to 16 afternoon, otherwise evening). The name is the Clerk first name, else the start of the email's local part, else none ("Good morning"), and never an email address. Consistency chip "5 days of reflection" (Terracotta tint, hidden at 0 days), driven by real data and never shaming. The chip sits on the date's line, not beside the greeting (the Stitch design has it beside the greeting, which squeezed "Good afternoon, Ayoko" onto three lines): the greeting keeps the full width, and the chip wraps under the date when the two do not fit (step 11 follow-up).
- Affirmation card for the current slot (the slot follows the user's reminder times, so it can differ from the greeting): slot label ("MORNING AFFIRMATION"), headline, body, heart (favorite) toggle, footer "8:00 AM • Tied to yesterday's prayer". Hidden when there is none.
- "Your Reflections" + entry count + "Filter" control (a single-select sheet: All, the five emotions, Prayer requests).
- Journal cards: timestamp, emotion badge, 2-line quoted transcript, scripture ref in Rosewood italic Fraunces, dark plum duration pill with play icon. Every status has a card: processing, uploading, pending ("Waiting to sync"), failed, text only (no audio) and crisis (no transcript, "Support resources"). Only ready and crisis cards open Reflection.
- States: loading skeleton, error ("We couldn't load your reflections."), Empty ("No reflections yet" with a "Record your first prayer" button), filtered-empty, Offline (Soft Blush banner directly under the greeting, as in the design's offline view, with a title and the count of unsynced reflections, plus a "Waiting to sync" chip on unsynced cards), Synced toast (Sage, announced to screen readers because it disappears).

### 4. New Entry

Built in step 10 as one `NewEntryScreen` (a `fullScreenModal`) with three phases (editing, sending, error). Its copy lives in `copy.newEntry`. Sizes come from the HTML (`prompt_material/04-new-entry.html`), which also holds the Write and Processing views.

- Header: close (X), "New Reflection", a "Saved locally" line (shown only while there is a recording or text; a mock until step 24 makes it true) and the "Private" lock chip, over an inset petal divider.
- Speak / Write segmented toggle (compact, plum when active), the first item of the scrolling content. Disabled while recording and while the microphone permission is being asked. Each mode keeps its own content, and Finish submits only the active one.
- Speak: eyebrow "Sanctuary of voice", title "What’s on your heart today?", helper copy, a white card with 9 waveform bars (rose, plum, plum-deep, rosewood) that follow the last 9 audio levels, a timer chip "01:42 / 05:00" with a dot (Crisis Red while recording), an 84dp mic orb (plum; Crisis Red with a breathing halo and a stop icon while recording) and a caption that follows the state ("Tap to begin", "Tap to stop", then "Recorded 01:42"). **Tap to start/stop, not hold-to-record**, and it never starts by itself. Max length 5:00 (a warning at 4:30, an automatic stop at 5:00), minimum 3 seconds. When the microphone is off, a blush card with "Open Settings" and "Write instead" replaces the recorder card, and it clears itself when the app returns with the permission granted.
- Info card: "Whisper or speak aloud" with a listening-ear icon (the design's lotus is not used, see the header note in the Navigation Map) and corrected copy ("tomorrow's personal psalm" was inaccurate: the devotional is created now).
- Write: title "Pour out your heart", a white card with the text area (at least 10 and at most 5,000 characters, never persisted, scrolls inside itself), a word count, and a character counter from 4,500. The placeholder is "Type freely. Share your worries, praises or questions, without judgment." (it must not repeat the title above it). While the keyboard is up the title and helper step aside and the card shrinks to the space above the footer, so its rounded bottom and the word count are never behind the footer (on iOS the layout moves on the keyboard's curve; the input keeps three lines, so a very short screen scrolls the page instead: at 320dp wide with font scale 1.3 the field still shows only about a line and a half, as before). The text area asks for the light keyboard (`keyboardAppearance="light"`), as do the email sheet's inputs.
- Footer (pinned): "Cancel" text button + "Finish Reflection →" (Speak) or "Submit Reflection →" (Write), enabled at a 3-second recording or 10 characters. Finish also works while recording: it stops, then submits.
- Leaving with content (X, Cancel, Android back) asks "Discard this reflection?" (`ConfirmDialog`, destructive). A `fullScreenModal` has no iOS swipe-down, so there is nothing to guard there. Leaving is blocked while processing. After a recording, the orb and "Record again" both ask "Discard this recording?" before anything is thrown away.
- Processing state: a full-screen calm overlay: a pulsing logo mark, "Listening, praying, and finding scripture…" (text entries: "Reading, …"), three step cards (Listening or Reading ✓ → Reflecting → Preparing your devotional) and "You can close the app. Your reflection will be waiting in your Journal." (the design said "We'll notify you when it's ready", but no step sends that notification). Outcomes: ready and crisis open Reflection (crisis is checked before the limit); the free-limit error opens the Paywall with source `limit`; any other error shows "We couldn't finish this reflection." with "Try again" (the same `clientEntryId`) and "Save and close".

### 5. Reflection

Built in step 11 as `ReflectionScreen` (a push above the tabs: no tab bar, no dock). Its copy lives in `copy.reflection`. Sizes come from the HTML (`prompt_material/05-reflection.html`), which also holds the Affirmations and Closing Prayer panes and the expanded transcript that the PNG does not show.

- Header: a back chevron and the entry date (Rosewood, with a calendar icon), over a petal divider. The HTML's bookmark and share icons are not built (there is no bookmark feature, and share is in the footer).
- Validation headline in Fraunces, by emotion: "It sounds like you’re feeling anxious, and that’s okay." (weary, grieving, grateful, hopeful and an unknown emotion each have their own line; the raw AI string is never shown). Subline "A sanctuary moment curated from your voice journal." ("written journal" for a typed entry).
- Mini player card (Plum): rose play circle, title, "1 min • Personalized devotional", progress bar, elapsed/total, "Tap to open player →". The card and the link open NowPlaying (built in step 12), and the play button plays in place: both go through the shared `playerStore`, so another entry's card shows 0:00 and paused until the user plays or opens it. Playback is mocked until step 26. Without audio the circle is a book icon and the card says "Your devotional is ready to read below.".
- Scripture card (Soft Blush): reference in Rosewood Fraunces, "BEREAN STANDARD BIBLE" pill (it drops under the reference when they do not fit), verse in Fraunces italic. The reference must sit above the verse, never overlapping it. Unverified scripture shows the reference and "We're confirming this passage." and never the text; no scripture, no card. The verse is wrapped in curly quotes by `quoteVerse` (`utils/format.ts`), for the card and the share message alike, and it never changes a character of the verse: a verse with no double quote marks is wrapped; one that ends a speech begun in an earlier verse gets only the opening mark it lacks (Matthew 11:28–30 ends with `”`); one that starts a speech that goes on gets only the closing mark; one whose marks already pair up, such as Psalm 46:10, shows as stored. The user's own words (the transcript) use `copy.reflection.quote`, not this.
- Carousel card with internal tabs: Devotional • Affirmations • Closing Prayer (shortened from the design's "Devotional Text" and "Today's Affirmations" so they do not wrap). Affirmations show the user's reminder times and mark the current slot; the closing prayer ends with "Amen." inside its quote. The devotional text is `text-body-lg` (17/26, the size of the verse above it; the HTML has 14 and the body token is 15), because it is the product and is read slowly.
- Collapsible "Your spoken prayer" row ("Your written prayer" for a typed entry) with "Private to you" chip, collapsed by default (shortened from "Your spoken prayer snippet", which the design truncates).
- "Mark as Prayer Request" toggle row (on when the entry is already a prayer). Footer: primary "Return to Journal" (the design's "Save to Journal" was wrong: the entry is already saved) + a secondary circular share action that shares only the verse and its reference, shown only for verified scripture.
- NowPlaying sheet (built in step 12; the design is `#view-nowplaying` in `prompt_material/05-reflection.html`, which the PNG does not show): a `modal` above Reflection, opened from the mini player. A Close row (a chevron and "Close", 44dp touch area; on iOS also a grab handle, because only iOS swipes a modal down), a full-width 4:3 artwork card (`gradients.brand` with the logo mark in a frosted tile, built in code with no image file and no text on it: white text fails AA on that gradient; the lock-screen artwork `images.playerArtwork` is step 26's), the devotional title (two lines at most) and "Gracehush • {reference}" centered, a scrubber (8dp track, 16dp thumb, 44dp touch area, elapsed on the left and the total on the right), back 15, a 64dp plum play/pause (a replay arrow at the end, labelled "Play again") and forward 15 (iOS draws `gobackward.15` and `goforward.15`; Android has no 15-second glyph, so it draws the plain `replay` arrow with a 10px "15" inside, mirrored for forward), three speed chips (0.8x / 1x / 1.2x), and an "Ambient Soundscape" card: a chip row (Off, Soft Rain, Gentle Piano, Morning Birds; it wraps) and a volume slider (dimmed and disabled while Off), with a development-only footer line (`TODO(26)`). The sheet scrolls, and the page does not scroll while a finger is on a scrubber. States: a skeleton in the shape of the player, a load error with "Try again", "We couldn’t find this devotional." (not found, and a crisis entry), and "This devotional’s audio isn’t ready yet." (no audio, or still processing). The mini player and this sheet share one store (`playerStore`, read through `usePlayback`). It loads a devotional only when the user acts on a player (the mini player's play, or opening the sheet), never because a reflection was merely viewed, and playback does not pause when either screen closes.
- Crisis Support state: replaces devotional content. See Crisis Safety Rules. Step 11 shows a temporary view with only the message and a return button (no resources until step 13).
- Other states: loading skeleton, "still being prepared" (pending, uploading and processing entries), failed, not found and a load error with "Try again". "Return to Journal" always lands on the Journal tab.
- Arrival: the ready view's sections arrive one after another (headline, player card, scripture card, carousel, words row, then the prayer row and footer): each fades in over 240 ms while rising 10dp, 60 ms after the one above it (`FadeIn` with `delay`, `rise` and `duration`). Under Reduce Motion they simply appear. The calm views (loading, still preparing, failed, not found, error and the crisis view) never animate in.

### 6. Prayers

- Header: "GRACEHUSH" eyebrow + "Prayers". Title "Sanctuary Prayers" + "17 PETITIONS RECORDED".
- Segmented tabs with count badges: Active (5) | Answered (12).
- Prayer card: category eyebrow (e.g. "FAMILY & HEALING"), hourglass "24 days" chip, Fraunces title, body, scripture ref with book icon, outlined "Mark Answered" button.
- Answered tab: timeline with Terracotta dots and gratitude notes.
- Mark Answered bottom sheet: date (default today), gratitude note, "Save Answered Prayer", "Not yet".

### 7. Profile & Settings

- Avatar with initials "SJ", name, "Member since October 2026".
- Plan card: "Gracehush Free", "ACTIVE PLAN", usage bar "2 of 3 audio devotionals used this week", nested Deep Plum Pro upsell with "PREMIUM" chip and "START FREE TRIAL" (opens Paywall).
- Sections with uppercase labels: PREFERENCES (Daily Reminders, Devotional Voice, Ambient Soundscape), NOTIFICATIONS & STORAGE (Daily Affirmations Push toggle, Offline Reflections sync status), PRIVACY & ACCOUNT (Export Journal, Delete Account in Crisis Red), ABOUT (Support & Helpline Resources, Help & Feedback, Sign Out).
- Footer: "Gracehush v1.0 • Scripture quotes from Berean Standard Bible (BSB)." + "Peace be with your spirit."
- Export dialog and Delete Account dialog (Delete Forever in Crisis Red fill, "Export my journal first" link).

### 8. Paywall

- Close (X) left, "Restore Purchases" right.
- Circular icon, title "Go deeper with Gracehush Pro", subtitle.
- Benefits card with Sage check circles (5 items).
- Plan cards: Yearly Access $59.99/year ($5.00/month) with Terracotta "SAVE 50%" badge, selected by default with a Deep Plum border. Monthly Access $9.99/month.
- Trial terms text, primary "Start My 7-Day Free Trial →", shield note "No commitments. Cancel with one tap.", footer links Terms of Use • Privacy Policy.
- **Prices must come from RevenueCat offerings at runtime.** Never hardcode prices in production logic. The design values are only for previews and fallback display.

---

## Design System

### Colors (`@theme` in `global.css` + `src/constants/theme.ts`)

| Token        | Hex       | Use                                                 |
| ------------ | --------- | --------------------------------------------------- |
| `plum`       | `#5B3A5E` | Primary buttons, mic, active tab, player card       |
| `plum-deep`  | `#3E2741` | Duration pills, titles on light surfaces            |
| `rose`       | `#D4A5A5` | Badge fills, waveform accents (never text)          |
| `rosewood`   | `#96555D` | Scripture refs, links, eyebrows                     |
| `terracotta` | `#C4704F` | Consistency chip, "Save 50%", answered prayers      |
| `sage`       | `#8FA58A` | Checks, success, synced                             |
| `linen`      | `#FBF7F2` | App background                                      |
| `linen-deep` | `#F1EDE8` | Chip and segmented-control track backgrounds        |
| `blush`      | `#F5ECE8` | Scripture card, privacy card, sheets                |
| `card`       | `#FFFFFF` | Cards                                               |
| `ink`        | `#2E2A33` | Primary text                                        |
| `mauve`      | `#6E636D` | Muted text, inactive tabs, placeholders             |
| `petal`      | `#EADFDB` | Borders, dividers                                   |
| `crisis`     | `#B4443A` | Recording, crisis support, destructive actions ONLY |

Emotion badges (bg / text): Anxious `#F3E6EE / #5B3A5E`, Weary `#F0EAE6 / #6B5D57`, Grateful `#E8EFE6 / #4F6B4A`, Grieving `#ECE6F0 / #4A3B5C`, Hopeful `#F7E9DF / #9A4F31`. Unknown emotions fall back to Weary styling.

Sample hex values from the screenshots when they differ slightly from this table, then confirm with the user before changing tokens.

**`mauve` is `#6E636D`, not the design's `#8A7F88`** (decided with the user on 2026-10-20, the step 09 follow-up). The design value measures 3.84:1 on white, 3.60 on linen and 3.29 on linen-deep (the chips), below AA for the 13px text it carries. `#6E636D` is 5.72, 5.37 and 4.91, and still reads as secondary (ink is 14:1 on white). The designer's own muted colour in the HTML (`#7E747C`) also fails on linen and chips, so do not re-derive mauve from the screenshots. `prompts/DESIGN.md` and prompt 02 still say `#8A7F88`: this table wins. **`rosewood` is `#96555D`, not the design's `#9E5A62`** (decided with the user on 2026-10-20, the step 11 follow-up). The design value measures 4.41:1 on blush and 4.40 on linen-deep, below AA for the 17px scripture reference and the 15px email-sheet errors that sit on blush. `#96555D` is 4.81 on blush, 4.80 on linen-deep, 5.24 on linen, 5.59 on white and 5.34 on the scripture pill (white at 70% over blush): about 5% darker with the same hue, and 0.3 of headroom (the bare minimum, `#9B5860`, clears blush by only 0.06, the margin turned down for `mauve`). `prompts/DESIGN.md` and prompt 02 still say `#9E5A62`: this table wins. **Text links on a blush surface (the sheets and the microphone card) stay `plum`** (8.16:1 against rosewood's 4.81): they were built that way and the decision stands.

### Typography

- **Fraunces** for display, titles, scripture, and the wordmark
  - Page title 28 SemiBold · Section 20 Medium · Scripture 17 Italic / 26 line height · Headline-lg 30 / 38 Regular (`text-headline-lg`, the three onboarding step titles)
- **DM Sans** for UI and body
  - Body 15 / 22 · Buttons 15 SemiBold · Labels 11 Bold uppercase, tracking 0.8
  - Eyebrows, taglines, and counters render uppercase through the `uppercase` style. Store their strings in sentence case ("Your rhythm", "1 of 3") so screen readers read words.
- The recording timer uses a monospaced style in the design. Ask before adding a mono font. Until then, use DM Sans with `fontVariant: ['tabular-nums']`.
- Load fonts through `@expo-google-fonts/fraunces` and `@expo-google-fonts/dm-sans` (check whether they are installed first).

### Shape & Elevation

- Cards 16 radius · Hero cards 24 · Inputs 12 · Buttons and chips full pill · Sheets 24 top corners
- Soft, low-opacity shadows only. Rely on Petal borders. Shadows come from `shadows.card` / `shadows.sheet` / `shadows.orb` in `theme.ts` and are applied with `style` (for example `.card` plus `style={shadows.card}`).
- 8px spacing grid. Screen horizontal padding 20 (16 on narrow screens, under 360 wide).
- Touch targets ≥ 44px. Body text ≥ 15px (legal footers may be 12px).

### Icons & Imagery

- Icons: render every icon through `src/components/Icon.tsx`, for example `<Icon name={{ ios: "mic", android: "mic" }} size={22} color={colors.plum} />`. It wraps `SymbolView` from `expo-symbols` (SF Symbols on iOS, Material Symbols on Android) and counter-scales the glyph on Android so it is not clipped at large font sizes. Always pass both names. Do not use `SymbolView` directly in screens or components, and do not add another icon library.
- Icon names in step prompts that look like Lucide or Feather names (`check-circle`, `chevron-right`, …) are conceptual: pick the matching `{ ios, android }` pair and render it through `Icon`.
- The one exception is brand logos. SF Symbols and Material Symbols have no multicolor Google G (or, on Android, an Apple logo), so the Apple and Google logos are SVG files in `assets/images/` (`apple-logo.svg`, `google-g.svg`), exported from `images.ts` and rendered with `expo-image`. Never use a monochrome Google icon, and do not add `react-native-svg` for them.
- Android's Material Symbols are outline only: `SymbolView` has no fill option, and aliases such as `favorite` and `favorite_border` draw the same outline glyph (checked on the emulator in the step 09 review). Where a design needs filled against outline (a saved heart, a selected tab), iOS uses the `.fill` symbol, and Android keeps the glyph and changes the color, or uses a different glyph where one fits (`heart_check` for a saved heart).
- **No emojis in the UI.** Replace any emoji from older code (🎙️, 📖, 🔥) with icons.
- No stock photos. Replace the Unsplash track-player artwork with a local branded asset.

---

## Image Generation Rules

If the user enables image generation:

- Generate images that are **visually identical or extremely close** to the provided UI reference
- Do not change style, colors, or composition
- Keep consistency with the design system (plum-to-rose gradients, minimal line art)

After generating images:

- Place them inside the `assets/` folder
- Use clear and organized naming:

```txt
assets/images/
  logo-mark.svg
  onboarding-hero-gradient.png
  player-artwork.png
  empty-journal.png
```

Use these assets properly in the UI.

---

## Image Rule

Use centralized image imports.

Before using any image asset:

1. Check if `src/constants/images.ts` exists.
2. If it does not exist, create it.
3. Import and export all app images from `src/constants/images.ts`.
4. Use images through the centralized object.

```ts
import logoMark from "@/assets/images/logo-mark.svg";
import playerArtwork from "@/assets/images/player-artwork.png";

export const images = {
  logoMark,
  playerArtwork,
};
```

```tsx
<Image source={images.logoMark} />
```

Do not require or import image assets directly inside screens or components unless there is a strong reason. Ambient audio files follow the same pattern in `src/constants/sounds.ts`. Use `Image` from `expo-image`, which also renders the SVG logo mark. `src/constants/images.ts` exists and exports `logoMark`, `googleG` and `appleLogo`, and `*.svg` imports are typed in `src/types/assets.d.ts`. Size `expo-image` images with `style`, not `className`.

---

## Styling Rules

Use NativeWind Tailwind classes for styling. Do not use `StyleSheet` unless something cannot be styled with Tailwind class names.

Prioritize clean, readable mobile UI.

When building from an attached design image:

- match spacing closely
- match typography hierarchy
- match border radius and shadows
- match layout structure
- use consistent reusable styles
- make the UI responsive for different screen sizes (the references range from ~320 to ~490pt wide)

Prefer the reusable classes that already exist in `global.css` (step 02): `.screen`, `.screen__content`, `.card` (`--blush`, `--hero`), `.btn-primary` / `.btn-ghost` / `.btn-critical` (each with `__label`), `.btn-text__label` (`--rosewood`), `.chip` (`--terracotta`), `.segmented` (`__item`, `__label`, `--active`, `--active-plum`), `.input`, `.icon-tile`, `.divider`, `.list-row`, `.eyebrow`, and the type scale `text-display` through `text-timer` plus `text-headline-lg` (step 03). One-off utility classes in a component are fine. Add to `global.css` only when a pattern repeats, using the BEM method, and follow these NativeWind v5 rules:

- Anything another class must `@apply` (the type scale, `eyebrow`) is declared with `@utility`. Structure classes go in `@layer components`.
- Variants are modifiers on each part (`chip__label--terracotta`). Do not rely on descendant selectors. `.chip__label--terracotta` is `text-hopeful-fg` (`#9A4F31`), not `text-terracotta` (changed in step 09 for contrast): terracotta on the chip's 12% tint is 3.0:1, `hopeful-fg` on the same tint is 4.9:1.
- Keep `:root { font-size: 16px }` (native rem is 14 otherwise) and keep the `utilities.css` import last, so utilities such as `bg-black` override component classes.
- Tokens come from `@theme`. Never put raw hex in a component.
- `className` works on core React Native components. Third-party components (`expo-image`, `LinearGradient`, `Icon`, the date-time pickers) take `style` instead. So does `Animated.View` (react-native-css has no wrapper for it): give it `style`, and put the classes on an inner `View`, as `Toast`, `Skeleton`, `Waveform`, `SpeakSection` and `ProcessingOverlay` do.
- A `Pressable` cannot take `className` together with a `style` function: NativeWind merges them into an array that Pressable ignores. Give the Pressable only the `style` function (pressed and disabled states) and put the classes on an inner `View`, as `PrimaryButton` does. A static `style` object such as `shadows.card` merges with `className` fine.
- `max-[360px]` compiles to a width strictly below 360, which is how `.screen__content` switches from 20 to 16.

Avoid large inline styles unless required.

---

## NativeWind Rule

Use the NativeWind version already installed in this app.

Before implementing styling or NativeWind-related code:

- Check the current NativeWind version in `package.json`
- Follow the syntax, setup, and patterns supported by that exact version
- Do not use APIs, config patterns, or examples from a different NativeWind version
- Do not upgrade NativeWind unless the user explicitly approves it
- If NativeWind is not installed yet, ask before installing it

Refer to this for more info: https://www.nativewind.dev/v5/llms-full.txt

---

## Style Exception Rules

Use `StyleSheet` or inline styles for these React Native components and scenarios instead of NativeWind classes:

| Component / Scenario           | Why                                                        | Use Instead                           |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------- |
| **SafeAreaView**               | className not supported reliably                           | Inline styles or `StyleSheet`         |
| **Button**                     | Only supports `title` and `onPress`                        | `TouchableOpacity` with custom styles |
| **KeyboardAvoidingView**       | Behavior props not supported by className                  | Inline styles or `StyleSheet`         |
| **Modal**                      | `visible`, `transparent` props                             | Inline styles                         |
| **ScrollView / FlatList**      | `contentContainerStyle`, `indicatorStyle`                  | `StyleSheet`                          |
| **TextInput**                  | Input-specific props like `underlineColorAndroid`          | Inline styles                         |
| **Animated.View**              | Animated values (mic pulse, waveform, processing circle)   | `StyleSheet` with animated values     |
| **Dynamic styles**             | Runtime values (progress bars, usage bar, scrubber)        | `StyleSheet.create()` or inline       |
| **Platform-specific**          | iOS-only or Android-only props                             | Conditional inline styles             |
| **Pressable/TouchableOpacity** | Pressed-state `style` function, not with `className`       | `StyleSheet`, classes on inner `View` |
| **Shadow (iOS/Android)**       | Different shadow syntax per platform                       | `StyleSheet` with platform checks     |
| **LinearGradient**             | Gradient colors/locations are props                        | Props + `StyleSheet`                  |
| **Third-party components**     | No `className` on `expo-image`, `Icon`, pickers            | `style` (StyleSheet or inline)        |
| **Transform arrays**           | Complex transform combinations                             | `StyleSheet`                          |
| **Z-index**                    | Floating dock and overlays sometimes need explicit z-index | `StyleSheet`                          |

### When to Use StyleSheet

Use `StyleSheet` or inline styles when:

- The prop is React Native-specific (not web-equivalent)
- The value is dynamic or calculated at runtime
- Platform-specific behavior is needed
- NativeWind doesn't map the property to a style

### SafeAreaView Example

```tsx
// ✅ CORRECT
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/constants/theme";

function JournalFeedScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.linen }}>
      {/* content */}
    </SafeAreaView>
  );
}

// ❌ INCORRECT
<SafeAreaView className="flex-1 bg-linen">{/* content */}</SafeAreaView>;
```

The same applies to the other exception components above. Otherwise, always use NativeWind utilities.

---

## UI Quality Bar

The app should feel:

- calm
- warm and dignified
- private and safe
- polished and modern
- visually identical to the provided design references

Use:

- rounded cards with Petal borders
- soft, subtle shadows
- generous white space
- one clear primary action per screen
- gentle, slow animations (mic pulse, waveform, processing circle), never bouncy or playful
- friendly empty states
- large touch targets
- a few small haptic taps (below), and nothing louder

**Haptics** (decided in the step 11 follow-up, 2026-10-20; `src/services/haptics.ts` over `expo-haptics`). Exactly these moments, and no others: `selection` when a tab or a toggle changes to a different value (the bottom tabs, the `SegmentedControl` items, the prayer-request switch, and from step 12 the speed chips and the ambient chips on Now Playing, decided in the step 12 review on 2026-10-20 because they are value pickers like the segmented control; pressing the one that is already selected does nothing); `light` when a recording starts and `medium` when it stops, fired from the recorder's state change in `SpeakSection`, so the automatic five-minute stop counts and a denied microphone does not; `success` when a submit comes back `ready`. Play, pause, skip and scrubbing on Now Playing make no haptic (checked in step 12 with a temporary call-site log: one tick per changed chip, none for the selected chip, play, pause, skip or scrubbing). Never on the crisis outcome or the crisis view (prompt 13: no urgency, sounds or haptics), and never for an error. They are fire-and-forget: a device without a haptic engine, or a failure, is ignored. Where a native control would have given its own tap and the app hides it (the prayer row hides its `Switch` and takes the whole row as the touch target), the app gives the tap itself.

Accessibility and responsiveness (check before calling a screen done):

- Every interactive element has an `accessibilityRole` and a label that includes its state, for example "Morning reminder, 8:00 AM, change time". Step counters read "Step 1 of 3".
- The screen holds up at 320dp wide and at font scale 1.3: content scrolls, footers stay pinned, nothing is clipped (icons included), and every touch target is at least 44.
- React Native's default `flexShrink` is 0, so text beside a chip, badge, pill, icon or button must be `flex-1` or `shrink`, or it pushes that element out. A row that cannot fit on one line at 320dp or font scale 1.3 wraps (`flex-wrap`, with a `minWidth` on the text block that is the longest word at the current `fontScale`) instead of squeezing a word into a mid-word break. Yoga breaks lines using the flex basis clamped by min/max size, so `flex-1` plus `minWidth` does trigger the wrap (read in the step 09 review). To know whether a row fits, measure its strings with the real font files (the advance widths in the `.ttf`), for example the Journal greeting row in step 09: its chip is 166dp wide and "afternoon," at 28dp is 136dp.

---

## Date & Time Pickers

Decided in step 03 and reused by every later picker (Profile reminders, the Prayers answered date).

- **iOS:** a bottom sheet (React Native `Modal`, 24 top radius) holding `{ DateTimePicker }` from `@expo/ui/community/datetime-picker` with `display="spinner"` and `themeVariant="light"`, plus a primary `Done` button. Use the named export, because the default export trips `import/no-named-as-default`. Changes apply live through `onValueChange`, so the chip behind the sheet updates as the wheel settles.
- **Android:** the native dialog through the imperative `DateTimePickerAndroid.open({ value, mode, is24Hour: false, onValueChange })` from `@react-native-community/datetimepicker`.
- Never render the community picker as a component on either platform: on iOS its change events do not arrive, and on Android it re-opens the dialog whenever `value` changes.
- Keep each time as one `"HH:mm"` 24-hour string in state, derive the picker's `Date` from it (a fixed date, only the time of day matters), and display it as `h:mm AM/PM`.
- Never build a custom wheel.

---

## Bottom Sheets

Decided in step 04. Every sheet (the email sheet, Mark Answered, Filter) is a `BottomSheet`: build new ones on it instead of a new `Modal`. The Rhythm time sheet keeps its own `Modal` because its picker is verified on the iPhone, and only shares the blush background.

- **Look:** blush surface, `radii.sheet` top corners, a 1px petal top border, `shadows.sheet`, a centered 48×6 petal handle, padding 24 plus the bottom safe-area inset. The scrim is `ink` at 40%, closes the sheet, and is labelled "Close" (`copy.common.close`). Android back closes it too.
- **Behavior:** React Native `Modal` (`transparent`, `slide`) with `statusBarTranslucent` and `navigationBarTranslucent`, so the scrim covers the system bars on Android. `KeyboardAvoidingView` uses `padding` on both platforms (checked on the Android emulator, which is edge-to-edge). The sheet reserves the top safe-area inset, so it never climbs under the status bar. Children sit in a `ScrollView` with `keyboardShouldPersistTaps="handled"`, so content taller than the space above the keyboard scrolls.
- **Inputs inside a sheet:** do not use `autoFocus`. On Android it focuses the field before the dialog window has focus, so the keyboard stays closed, and React Native then ignores a second `focus()` on that field. Call `ref.current?.focus()` about 300 ms after the sheet opens or its step changes (see `EmailSheet`).
- **Flows inside a sheet:** closing resets everything (step, typed values, timers), and a request that finishes after the sheet closed is ignored.
- **Code boxes:** one TextInput laid over the boxes at `opacity: 0.01`. Never 0, because Android hides a fully transparent view from screen readers, and never a transparent text color, because Android ignores it.

---

## Copy & Tone Rules

- Gentle, validating, and never preachy. Validate feelings before offering scripture.
- No toxic positivity ("Just trust God and be happy!").
- No guilt or shame around streaks, missed days, or upgrading. Use "5 days of reflection," never "You broke your streak."
- No pressure tactics on the Paywall: no fake countdowns, no fake scarcity.
- All user-facing strings live in `src/constants/copy.ts`, grouped by screen (`copy.onboarding`, …), including accessibility labels built by functions (for example `changeTime(slot, time)`). No prose inline in components. A `// TEMP` placeholder is the only exception, together with dev-only UI (the `DevToolsPanel`, step 08), which is never shown to users and keeps its strings inline.
- Strings that render uppercase (eyebrows, taglines, counters) are stored in sentence case. The `uppercase` style does the casing.
- Every string uses typographic punctuation: curly apostrophes (’) and curly double quotes, never the straight ones (decided in the step 11 follow-up, 2026-10-20, from the serif headlines "you’re" and "that’s" on the user's iPhone: 39 straight apostrophes in `copy.ts` and 18 in the mock data became ’). Text the app does not write is left as it comes: the user's own words, and scripture, which keeps the BSB's own marks (`quoteVerse`). AI-written text should arrive with curly apostrophes as well, so step 32's Gemini prompt asks for them; the client does not rewrite it.
- Copy says only what the app does today, or what a named step will make true. Do not promise a notification, a save or a sync that no step builds. The design's "We'll notify you when it's ready" became "Your reflection will be waiting in your Journal" in step 10, because no step sends a "ready" notification. "Saved locally" and "Your words are safe" are mock until steps 24 and 25 make them true, so they carry `// TODO(24)` markers.

---

## Authentication Rules (Clerk ↔ Supabase)

Use Clerk for authentication. Do not build home-grown auth (our own passwords, tokens, or sessions).

- Sign-in methods: Apple, Google, and email through Clerk. Email is passwordless: a 6-digit one-time code, with no password field anywhere.
- One Sign In screen serves new and returning users. There is no separate Sign Up screen. Email uses Clerk's sign-in-or-up custom flow (step 05): `signIn.create({ identifier, signUpIfMissing: true })` sends a code whether or not the account exists, and a new user is transferred to sign-up (`signUp.create({ transfer: true })`) only after the code is verified. Never try sign-in and fall back to sign-up on `form_identifier_not_found`: it reveals which emails have accounts and fails when strict user enumeration protection is on.
- Sign in with Apple is iOS-only (native flow), so the Apple button is hidden on Android. Google is native on both platforms in a development build. Neither native flow works in Expo Go (Clerk's Apple and Google guides), so in Expo Go only, `continueWithGoogle` signs in through Clerk's browser flow (`useSSO` with `oauth_google`, which uses Clerk's own Google credentials on a development instance) and `continueWithApple` returns `NOT_SUPPORTED`. Do not add a browser-based Apple flow.
- `ClerkProvider` wraps the app in `App.tsx` with the SecureStore `tokenCache` from `@clerk/expo/token-cache`. Never cache a token yourself. Real keys live in `.env.local`, never in `.env`.
- The UI is ours, driven by Clerk's custom-flow hooks. Do not use Clerk's prebuilt components or hosted pages.
- The Supabase client is created through `createClerkSupabaseClient(getToken)` in `src/services/supabaseClient.ts`, which injects the Clerk token on every request.
- Use the integration the project is currently configured for:
  - **JWT template:** `getToken({ template: 'supabase' })`
  - **Native Third-Party Auth (recommended by Clerk/Supabase):** `getToken()` and the Supabase `accessToken` option
  - Ask before switching between them.
- RLS uses `requesting_user_id()` (the JWT `sub` claim). Every user-owned table must have RLS enabled with both `USING` and `WITH CHECK`.
- On sign-out: clear Zustand stores, wipe the local SQLite cache, cancel Gracehush notifications, and reset track-player. Exception: the onboarding store (`gracehush.onboarding`, device-level) is kept, so a signed-out user never sees Welcome again.

---

## Backend / Edge Function Rules

Use Supabase Edge Functions for:

- all AI calls (Gemini)
- Bible text hydration (HelloAO)
- TTS generation
- writes that need the service role
- subscription status sync (RevenueCat webhook)

Never expose secrets in the mobile app.

**Client-safe env vars (EXPO*PUBLIC* only):** Supabase URL, Supabase anon key, Clerk publishable key, Google OAuth client IDs and iOS URL scheme, RevenueCat public SDK keys.
**Server-only secrets (Edge Function env):** `GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_TTS_API_KEY`, `TTS_VOICE_NAME`, `SUPABASE_SERVICE_ROLE_KEY`, `REVENUECAT_WEBHOOK_SECRET`.

### Mandatory Fixes to the Current `process-entry` Function

The current orchestrator is a working draft. Apply these fixes whenever the function is touched, and tell the user when you do:

1. **Verify the JWT signature.** The draft base64-decodes the token and trusts `sub` without verification, so anyone can forge a user ID. Verify against Clerk's JWKS (or the Supabase JWT secret if the legacy template is used) before reading claims. Put this in `supabase/functions/_shared/auth.ts`.
2. **Scope every service-role query.** The service role bypasses RLS. Always filter by the verified `userId`, and never accept a `user_id` from the request body.
3. **Validate input.** Check `inputType`, limit audio size and duration (5:00 max), limit text length, and pass user text as clearly delimited data so it can't override the system prompt.
4. **Enforce structured output.** Use Gemini `responseSchema`, check `res.ok`, handle blocked or empty candidates, and validate the parsed JSON before using it.
5. **Run crisis screening first.** See Crisis Safety Rules. Crisis entries skip devotional, TTS, and affirmations.
6. **Hydrate scripture exactly.** Map book names to HelloAO book IDs (`_shared/bibleBooks.ts`), parse chapter and verse range, and return only the requested verses. **Never fall back to a hardcoded verse under a different reference.** If verification fails, retry once, then return a clear error state. Ask the user how the UI should handle it.
7. **Keep storage private.** The draft schema makes `journal_media` a **public** bucket and stores public URLs. Devotionals repeat users' private struggles, so ask before migrating to a private bucket. After migrating, store object paths and serve short-lived signed URLs.
8. **Save the raw audio first.** Upload it before AI processing so a failed run never loses the user's prayer.
9. **Use the user's reminder times.** Read `reminder_morning/afternoon/evening` from `users_profile` instead of hardcoding 08:00, 13:00, 20:00.
10. **Enforce the free tier server-side.** Free users get 3 audio devotionals per week (per the Profile design). Check the limit before calling Gemini or TTS and return a typed `LIMIT_REACHED` error that opens the Paywall.
11. **Return consistent errors:** `{ error: { code, message } }` with correct HTTP status codes (401, 402, 413, 422, 500). Never leak stack traces or provider errors to the client.
12. **Move long work to async processing when needed.** If processing nears the function's time limits, propose a status column (`processing_status`) plus a push or local notification when the entry is ready. Ask before restructuring.

---

## Crisis Safety Rules (NON-NEGOTIABLE)

Gracehush will receive entries about self-harm, abuse, and despair.

- The Edge Function must flag entries showing risk of self-harm, suicide, abuse, or immediate danger, and return `is_crisis: true`.
- For crisis entries:
  - Show the Reflection **Crisis Support state** instead of the devotional.
  - Do not generate or schedule affirmations.
  - Do not autoplay audio.
  - Use the copy from the design: "It sounds like you're going through something really heavy. You don't have to carry this alone."
  - Show resources from `src/constants/crisisResources.ts` (988 Suicide & Crisis Lifeline, Crisis Text Line, 911, and a link to international helplines), with tap-to-call and tap-to-text actions.
- Never make claims about confidentiality or what a hotline will do.
- Hotline data must be easy to update and should be reviewed before every release.
- If you are unsure whether a change affects crisis handling, stop and ask.

---

## Local Cache & Offline Rules

- Every new entry is saved locally **first** (status `pending`), then synced.
- Sync queue states: `pending` → `uploading` → `processing` → `ready` | `failed`.
- Show the Offline banner and "Waiting to sync" chips from the Journal design while offline.
- Retry failed syncs with backoff when connectivity returns. Never silently drop an entry.
- The local cache holds sensitive text. Recommend encryption (for example SQLCipher via expo-sqlite) and ask before enabling it. Always wipe it on sign-out.
- The server is the source of truth once an entry is `ready`.

---

## Audio Rules

**Recording**

- Tap to start, tap to stop. 5:00 maximum with a visible timer.
- AAC / `.m4a`. Request the microphone permission only after the Permissions primer.
- Handle interruptions (calls, app backgrounding) without losing the recording.

**Playback (react-native-track-player)**

- Set up the player once at app start. Register the playback service and background audio modes in `app.json`.
- Use the real track duration, not a hardcoded `60` or `90`.
- Artwork comes from `images.playerArtwork`, not a remote Unsplash URL.
- Signed URLs expire, so refresh the URL before playing if needed.
- Capabilities: play, pause, seek, jump ±15s, playback rate (0.8x / 1x / 1.2x).
- The player UI reads one Zustand store, `src/store/playerStore.ts` through `usePlayback` (step 12). Step 26 swaps its mock internals for the real player and keeps the state and action names. A devotional is loaded only when the user acts on a player, never because its reflection was viewed (that would stop the one playing and, with real audio, fetch a signed URL for every entry looked at). `stop()` is a full reset that sign-out calls. `load(track, ambient)` is synchronous and the store never fetches: the caller passes the profile, the same entry does nothing (so reopening a reflection never resets its position), and another entry stops the one playing and starts at 0, paused, keeping the session's speed and ambient choice (the first load after the app starts, or after `stop()`, copies the profile's ambient sound and volume). The clock is wall time times the rate, so a late JS timer does not make it lag. A track comes from `getPlaybackTrack(entry)` (`data/selectors.ts`), which is null for a crisis entry, an unfinished one, and a devotional with no audio or no measured length: a crisis entry never reaches a player.

**Ambient soundscape**

- Google TTS does not produce ambient sound. Play ambient loops on the client, in parallel with the devotional, from `assets/audio/`.
- track-player plays one queue, so ambient needs a second audio channel. Propose the approach and ask before adding a library.

---

## Notification Rules (expo-notifications)

- Schedule affirmations locally, using the user's saved reminder times and the device time zone.
- Give each notification a stable identifier (`gracehush-morning`, `gracehush-afternoon`, `gracehush-evening`). Cancel only those IDs. **Do not use `cancelAllScheduledNotificationsAsync()`**, because it wipes unrelated notifications.
- Reschedule after each new `ready` entry, after reminder times change, and on app launch.
- Respect the "Daily Affirmations Push" toggle in Profile.
- Never schedule affirmations for crisis entries.
- Tapping a notification opens the related Reflection.
- There is no "your reflection is ready" notification in V1 (decided in the step 11 follow-up, 2026-10-20; it answers manual setup item 4 of prompt 11). A local notification cannot know when the server finishes, so it would need a server push, which needs the Apple developer account (last, see Instructional Memory) and does not run in Expo Go on Android. The processing copy only promises that the reflection will be "waiting in your Journal". Revisit if step 19 makes processing asynchronous (Backend / Edge Function Rules, item 12).
- Notification content must never include sensitive transcript text. Use only the affirmation headline and body.

---

## Subscription Rules (RevenueCat)

- RevenueCat is the source of truth for entitlements. Use one entitlement: `pro`.
- Read offerings and prices at runtime. Show trial terms exactly as configured.
- The Paywall must include Restore Purchases, the trial and renewal terms, Terms of Use, and Privacy Policy (App Store and Play requirements).
- Sync `subscription_tier` to `users_profile` server-side via a RevenueCat webhook, never from the client.
- Gate Pro features in the UI with a `useEntitlement()` hook, but always enforce limits on the server too.

---

## Database Rules

The database is managed in Supabase. As of step 06 (2026-10-17) no Supabase project exists for Gracehush yet, so there is no live schema and no `supabase/schema.sql`. Steps 17 and 18 read that file, so create the project and the base tables before step 17 (see the Step 06 log entry).

- All schema, RLS, and storage policy changes go in `supabase/migrations/` as timestamped SQL files.
- Never edit production schema by hand. Never disable RLS.
- Ask before creating any migration.

### Known Schema Gaps vs. the Designs

The designs need data the current schema does not store. Propose migrations for these one feature at a time, and ask first:

Step 18 settles the exact names against the real schema.

- `journal_entries`: `client_entry_id` (unique with `user_id`, so a retried submit never creates a second row), `processing_status`, `error_code`, `is_crisis`, `audio_path` (the raw recording), `devotional_audio_path` and `devotional_duration_ms` (the old public `devotional_audio_url` is deprecated), `scripture_verified`, `devotional_title`, `closing_prayer`, `answered_notes`, `updated_at`
- prayer fields on `journal_entries`: `prayer_title`, `prayer_category` (e.g. "FAMILY & HEALING"), `prayer_summary`
- `users_profile`: `timezone`, `ambient_sound`, `ambient_volume`, `affirmations_enabled`, `updated_at`. Onboarding completion stays on the device and the devotional voice is one server-side setting, so neither is a column.
- `daily_affirmations`: `is_favorite` (heart icon on the affirmation card), `scheduled_for` (step 28)
- the `embedding VECTOR(768)` column and spiritual memory are **V2**. Do not build them unless asked.

---

## State Management Rules

Use Zustand for global client state:

- onboarding progress and reminder times
- current playback state (track, position, speed, ambient)
- sync queue status and connectivity
- entitlement snapshot for UI gating
- app settings

Use local component state for temporary UI state (segmented tabs, sheet visibility, form inputs).

Do not mirror server data in Zustand if it already lives in the local SQLite cache. Read it through hooks.

Persist settings with AsyncStorage only when they don't belong in the profile table. Never persist journal text in AsyncStorage.

**Onboarding store (step 07).** `src/store/onboardingStore.ts` persists `hasCompletedOnboarding`, `completedAt`, `reminders` (`"HH:mm"`, 24-hour, keep that format), `permissionsPromptedAt` and `remindersSyncedAt` under the key `gracehush.onboarding` (version 1). The current step index and any permission status are not persisted: the OS is always the source of truth for permissions, and relaunching mid-flow starts at Welcome with the saved times. Every persisted store uses `src/store/safeStorage.ts`, validates every field in its own `merge` (zustand's default merge is shallow), and is gated with `useStoreHydrated` wherever the first render depends on it (`AppShell` holds the splash until it is true). No journal text or other sensitive value goes into AsyncStorage: this store holds only flags, times and timestamps. Step 17 syncs `reminders` to the profile and sets `remindersSyncedAt`.

**Data layer (step 06).** Screens read data only through `src/data/journalRepository.ts` (directly or through a hook), never from `src/data/mock/`. The mock scenario lives in the dev store (step 09): `getMockScenario()` reads `useDevStore.getState().scenario`, `setMockScenario` is gone, and the scenario buttons in `DevToolsPanel` call `setScenario`. `db.ts` rebuilds the fixtures when the scenario changes, and screens subscribe with `useDevStore((state) => state.scenario)`. Mock rows are DB-shaped, live in `mockDb` (profile, entries, affirmations) and go through the mappers in `src/data/mappers.ts`. `getMockScenario()` returns `'default'` outside `__DEV__`. Models are plain JSON (ISO strings, `null` rather than `undefined`) because step 24 caches them as JSON. A `pending` or `uploading` row is local-only, and a crisis entry never carries an emotion, devotional, scripture or prayer. Formatting lives in `src/utils/format.ts`. `Scripture.text` is `null` unless the verse is verified. **Submit (step 10).** `submitEntry(req, onStage)` in the repository is a mock (`TEMP(25)`): it takes the one-shot outcome from `takeMockSubmitOutcome()`, reports the stages 1.2s apart (`ready`: receiving, reflecting, preparing; `crisis` and `failed`: receiving, reflecting; `limit`: receiving), and answers `ready` or `crisis` with the id of a new entry, `failed` with `AI_UNAVAILABLE`, `limit` with `LIMIT_REACHED`. `addMockEntry(kind, req)` in `db.ts` (`TEMP(25)`) is what makes the mock database grow: it clones the anxious (ready) or crisis fixture under `entry-new-{clientEntryId}`, is idempotent on `client_entry_id` like the real server, quotes typed text as the transcript, adds no prayer, and for `ready` also clones the three affirmations, so Journal, its affirmation card and Reflection all work after a submit in every scenario (a scenario switch rebuilds the fixtures and drops the clones). Only stage names and outcome codes are logged, never an id, a path or text.

**Dev store (step 09).** `src/store/devStore.ts` is a non-persisted, flat Zustand store for development only: `scenario` with `setScenario`, `nextHomeLoadFails` with `setNextHomeLoadFails`, the one-shot flag that makes the next Journal Home load fail once (the hook clears it as it fails), and (step 10) `nextSubmitOutcome` with `setNextSubmitOutcome` (`MockSubmitOutcome`, default `"ready"`), which `takeMockSubmitOutcome()` reads and resets in the same call, and (step 11) `nextReflectionLoadFails` with `setNextReflectionLoadFails`, the same one-shot flag for the Reflection load (`useReflection` clears it as it fails). Nothing in a release build sets it and `getMockScenario()` ignores it there. Later steps (10, 14, 16, 17, 24, 25) add their own `next…` flags and fields to it, and their controls to `DevToolsPanel`. `scenario.ts` imports the store at runtime, and the store imports only the `MockScenario` type from `scenario.ts` (`import type`), so there is no runtime cycle.

---

## TypeScript Rules

Use TypeScript strictly.

Avoid `any`, including in Edge Functions. Type Gemini, HelloAO, and TTS responses explicitly.

Keep app models and the process-entry contracts (`TimeSlot`, `JournalEntry`, `ProcessEntryRequest`, `ProcessEntryResponse`, `ProcessEntryErrorCode`) in `src/types/index.ts`, and mirror the contracts in `supabase/functions/process-entry/contracts.ts` (step 19). Database row types live in `src/types/database.ts`: hand-written in step 06, then re-exported from the generated `src/types/supabase.ts` (step 18). Gemini output types are server-only and live with the Edge Function.

Keep types simple and readable.

Type navigation with `RootStackParamList` (`src/navigation/types.ts`) and screen props with `NativeStackScreenProps<RootStackParamList, "Name">`. No `any`.

Ambient declarations (`*.svg`, `expo/types`) live in committed files under `src/types/`. Do not rely on the generated `expo-env.d.ts`: Expo CLI deletes it, and typecheck then fails on `import "./global.css"`.

---

## Feature Implementation Rules

When the user asks to build a feature:

1. Read this file first.
2. Identify the files to change.
3. Keep changes focused.
4. Do not rewrite unrelated code.
5. Follow existing patterns.
6. Ensure the feature works end-to-end (client → Edge Function → DB → client).
7. Check that loading, empty, error, and offline states are handled.
8. Fix errors before finishing.

---

## Code Simplicity Rules

Avoid overengineering.

Refactor only when needed.

No premature abstractions, generic "manager" classes, or custom frameworks.

---

## Component Creation Rule

Only create reusable components when necessary.

Ask if unsure.

---

## Linting and Validation

Run:

```bash
npm run lint
npm run typecheck
```

Check the real exit codes and read the full output. Never pipe these commands through `tail` or `head`, which hides failures. Lint warnings count: fix the cause instead of disabling the rule.

Typecheck and lint cannot catch Metro, NativeWind, or import-resolution problems, so also bundle the app:

```bash
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

To confirm that new classes compile, add `--no-bytecode --no-minify` and search the bundle for the class name.

For Edge Function changes, also run:

```bash
supabase functions serve process-entry
```

Test with both a text entry and a short audio entry. Fix all errors before finishing.

Test on an Android development build when the change touches audio, notifications, purchases, or native modules. The iOS development build waits for the iOS developer account (see Instructional Memory). UI-only changes can be verified in Expo Go SDK 57.

### Verifying on this machine (Windows)

- An Android emulator can run from the installed SDK (`%LOCALAPPDATA%\Android\Sdk`, API 37 x86_64 image, WHPX acceleration). `avdmanager` is not installed, so the AVD `gracehush_test` was written by hand. Install Expo Go 57.x on it and drive it with `adb` (`uiautomator dump` for accessibility labels, `input tap`, `exec-out screencap`). Test at 320dp, 430dp, and font scale 1.3.
- iOS cannot be run or built here (no Mac), so `npx expo run:ios` never works and no prompt or reply should tell the user to run it. iPhone development builds will go through EAS in the last step (`prompts/35-ios-developer-account.md`, see Instructional Memory), where the interactive commands (`eas login`, `eas device:create`, the first `eas build`) are the user's to run. Say plainly that iOS was not verified, and ask the user to confirm on their iPhone in Expo Go.
- Sign-in needs the Clerk publishable key in `.env.local`: without it the app throws on launch by design, so nothing can be run on the emulator or the iPhone until it exists. Email sign-in runs in Expo Go. Google on Android is verified on the Android development build (step 05b). Apple, and Google on iOS, wait for step 35 and are reported as not verified on iOS. In Expo Go, Apple shows the calm "isn't available" message by design, and Google opens Clerk's browser flow. That flow can be driven on the emulator up to Google's own login page (Chrome shows its first-run screen on a fresh emulator: "Stay signed out"); never enter a real Google account there, so the sign-in itself is the user's check.
- The user often has their own `expo start` on port 8081. Run yours on 8082, check a process's command line before stopping it, and never stop theirs.
- Keep one-off scripts, screenshots, and exports in a temp folder outside the repo. Shut the emulator down (`adb emu kill`) and stop your own Metro when done.
- Their Metro hot-reloads your edits onto their device. Keep any temporary experiment behavior-neutral for iOS, mark it `TEMP-EXPERIMENT`, and revert it before finishing.
- Permissions on the emulator: `adb shell pm clear host.exp.exponent` resets Expo Go (it then shows its first-run developer-menu hint again: tap Continue, then close the menu), then `pm revoke` or `pm grant` `android.permission.RECORD_AUDIO` and `android.permission.POST_NOTIFICATIONS` for the state to test, and read the result with `dumpsys package host.exp.exponent`. The OS microphone prompt can be driven through `uiautomator dump` (its buttons are "While using the app", "Only this time" and "Don’t allow", with a typographic apostrophe). Expo Go on Android also asks its own per-project confirmation ("… You've already granted permission to another Expo experience. Allow gracehush to also use it?", DENY or ALLOW) the first time a project uses a permission that is already granted to Expo Go, so a granted permission can still show a dialog there. It is not an OS prompt and a development build never shows it. Notification prompts cannot be tested in Expo Go on Android at all (see the `expo-notifications` SDK note).
- uiautomator dumps XML-escape labels (`Allow &amp; Continue`), and `adb shell input text` can double the first character typed into a freshly focused field: check the field, then fix it with Home (`input keyevent 122`) and Forward-Delete (`input keyevent 112`).
- Android navigation modes (step 08): `adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton` switches to 3-button navigation, and `--category com.android.internal.systemui.navbar.gestural` switches back. `adb shell cmd overlay list --user 0` shows which navbar overlay is `[x]`. The `navigation_mode` setting does not update on this emulator image (it keeps reading 2), so confirm the mode with a screenshot or the overlay list. The bar's bottom inset is 24dp in gestural mode and 48dp in 3-button mode.
- Dark mode (step 08): `adb shell cmd uimode night yes` and `night no` switch the system theme (`cmd uimode night` prints the current one). The app restarts on each change, and on this machine it can take a minute to come back.
- Expo Go's floating "Tools" button sits at the top-right and covers whatever is under it (the header avatar), so taps there miss. `input swipe` and `draganddrop` do not move it. Press, hold and drag with raw events in one shell call: `adb shell "input motionevent DOWN 971 239; sleep 1; input motionevent MOVE 975 500; input motionevent MOVE 980 900; input motionevent MOVE 985 1300; input motionevent MOVE 990 1500; input motionevent UP 990 1500"` (1080x2400 screen). It returns to the top-right after a cold start, and it belongs to Expo Go, not the app.
- `uiautomator dump` also lists views TalkBack ignores (opacity-0 layers and `no-hide-descendants` children), so to see what an accessibility service sees, use `uiautomator dump --compressed`. Android reports `uppercase` text already uppercased (`DEVELOPER`), so match labels case-insensitively. A screenshot can take 7 to 10 seconds while Metro and the emulator are busy: to catch a short animation mid-way, slow it down with a temporary `TEMP-EXPERIMENT` change that is Android-only, then compare pixel colors across frames with `pngjs`, instead of trying to time the capture.
- Setting the clock (step 09 review): to test anything that depends on the time of day, set the emulator's clock, not its time zone. A running Hermes process ignores a zone change (`cmd alarm set-timezone` changes `date`, but the app keeps its old zone until it restarts), while a clock change reaches `Date.now()` at once. Run `adb shell settings put global auto_time 0`, then `adb shell cmd alarm set-time <epoch ms>` (compute it in Node, for example `Date.UTC(y, m, d, 7, 5, 0)` for 08:05 in UTC+1), send the app to the background (`input keyevent 3`) and bring it back (`am start -a android.intent.action.VIEW -d exp://127.0.0.1:8082 host.exp.exponent`): the `AppState` listener fires. Restore afterwards with `adb shell cmd alarm set-time $(node -e "console.log(Date.now())")` and `settings put global auto_time 1`, and confirm with `adb shell date`. If you changed the zone, put it back with `cmd alarm set-timezone <Olson id>` and `cmd time_zone_detector set_auto_detection_enabled true` (the shell user is denied `suggest_manual_time_zone`). The zone and the auto-detection setting persist in the AVD image, so a forgotten change survives an emulator restart.
- Reduce Motion (step 09 review): `adb shell settings put global transition_animation_scale 0` turns it on (React Native on Android reads exactly that setting, not `animator_duration_scale`) and `1.0` turns it off. `AccessibilityInfo.isReduceMotionEnabled()` and the `reduceMotionChanged` event follow it live, without a restart.
- **`uiautomator dump` fails with "ERROR: could not get idle state." while the screen never goes idle** (step 10: New Entry while recording, where the timer and bars update every 100 ms, and the processing overlay, whose pulses loop). Read such states from screenshots, from pixel samples with `pngjs` (the halo and dot of a pulse differ between frames, and are identical under Reduce Motion), or from a temporary log read with `adb logcat -d -s ReactNativeJS:V`. With Reduce Motion on the overlay dumps, the recording state still does not. Step 11: Reflection while the mock playback ticks (every 250 ms) is the same, a dump returns nothing, so pause with a tap on the play button's coordinates (it does not move) and dump after; a temporary `console.log` also reaches the Metro output within a second, which is how the `useReduceMotion` timing (see the vendor notes) was measured. The plain dump also lists nodes hidden from accessibility, so a `tap "Close"` by label can hit the editing view's X under the overlay: use `--compressed` or coordinates there.
- **Fast Refresh re-runs the effects of every component it refreshes.** Editing a file in the middle of a recording ran the screen's cleanup, which cancelled the mock recorder while React state stayed `recording`, so Finish then showed "We couldn't save that recording" (a dev-only artifact; it also proved that error path). Do not edit files during a flow. A session relaunched after Expo Go was killed (`pm revoke` kills it) may not hot-reload at all: `am force-stop host.exp.exponent`, then relaunch.
- Sizes (step 10): the design's 390dp frame is `wm size 1080x2340` with `wm density 443`, and 320dp is `wm size 720x1280` with `wm density 360` (each restarts Expo Go; reset with `wm size reset` and `wm density reset`). The soft keyboard does not always show in `screencap`: read its frame from `adb shell dumpsys window | grep "type=ime"` (`InsetsSource id=3 type=ime frame=[l,t][r,b]`) and compare it with the footer's bounds. The Clerk development-keys LogBox toast comes back after every restart and covers the bottom of the screen: tap its x.
- **Reload and recording recipes (step 12).** (1) Fast Refresh did not apply edits in the step 12 session (a fix was on disk and in the served bundle, and the app still drew the old UI), so after an edit open the developer menu with `adb shell input keyevent 82`, tap "Reload" and wait about a minute; a size, density or font-scale change restarts Expo Go and re-fetches the bundle too. A bundle that fails to download ("Failed to download remote update") only means Metro was still compiling: relaunch once it has finished. (2) The Clerk toast covers the tab bar at the bottom, and a tap on its body opens LogBox's full-screen "Console Warning" (Back closes it): tap its x first (990,2139 at 390dp). (3) `uiautomator dump` fails with "could not get idle state" while Now Playing is playing (the clock ticks every 250 ms): tap the play button by coordinates to pause, then dump. (4) A held touch lasts across `adb` calls: `adb shell "input motionevent DOWN x y; input motionevent MOVE x y"`, then a screenshot, more `MOVE`s and `UP x y` in later calls, which is how a drag was inspected mid-way. (5) A transition cannot be caught with `screencap` (about 5 s each here): record it with `adb shell "screenrecord --time-limit 8 --size 360x640 /sdcard/t.mp4 & sleep 2; input tap X Y; sleep 7; wait"`, pull the file and read it with ffmpeg (the WinGet package `Gyan.FFmpeg` is installed: `ffmpeg -i t.mp4 -fps_mode passthrough -vf scale=180:-1 t%03d.png`, `-vsync` no longer exists), then make a contact sheet; the frames carry real timestamps. (6) Timers measured with a device-side `sleep` between two `input tap`s are within about 0.3 s: 10 s at 0.8x, 1x and 1.2x moved the clock 8, 10 and 12 s.

---

## Communication Style

Be concise.

After each feature, explain:

- what changed (files touched)
- how to test it (steps on device)
- any open questions, assumptions, or follow-ups

Also:

- Lead with what changed and where, then how to test it.
- State what was verified and what could not be (for example iOS on this machine). Never claim a fix works on a platform you could not run.
- Flag every deviation from this file, and every place a design differs from a token, with the reason.

---

## Important Constraints

- V1 is 8 screens: Onboarding, Sign In, Journal, New Entry, Reflection, Prayers, Profile, Paywall.
- Do not build Spiritual Memory / Insights (V2).
- English (en-US) only for V1.
- Scripture is Berean Standard Bible only, and must always be verified text.
- Never expose secrets. Never trust unverified tokens.
- Never show misquoted or unverified scripture.
- Never skip crisis handling.
- Do not add, upgrade, or remove dependencies without asking. Expo Router is not used.

---

## Build Status & Decisions Log

Each step records its decisions here in the same step (see "AGENTS.md updates" in `prompts/TEMPLATE.md`), then copies this file to `prompts/AGENTS.md`. Newest last.

**Step 01 — NativeWind v5 setup.** `metro.config.js` (`withNativewind`), `postcss.config.mjs`, `nativewind-env.d.ts`, and `global.css` (imported once; since step 03 that import lives in `App.tsx`).

**Step 02 — Design system.** Tokens in `@theme` (`global.css`) and `src/constants/theme.ts`, type scale and BEM utilities, fonts through `@expo-google-fonts`, shadow and gradient tokens in `theme.ts`.

**Step 03 — Onboarding UI and navigation shell (2026-10-17).**

- Entry converted from the Expo Router template: `index.ts` → `App.tsx`, `package.json` `main` is `index.ts`, `src/app/` deleted, the `expo-router` plugin and `typedRoutes` removed from `app.json`, `web.output` set to `single`. `expo-router` stays installed but unused.
- Installed with approval: `@react-navigation/native` 7.5.1, `@react-navigation/native-stack` 7.21.0, `@react-native-community/datetimepicker` 9.1.0 (its config plugin is in `app.json`). `@expo/ui` was already installed and now powers the iOS picker.
- Added: `Icon`, `PrimaryButton`, `copy.onboarding`, `images.logoMark`, `RootNavigator`, `RootStackParamList`, `OnboardingScreen`, the TEMP `SignInScreen`, `text-headline-lg`, `src/types/assets.d.ts`, `src/types/expo.d.ts`.
- Verified on the Android emulator (Expo Go 57.0.9): the step 03 checks, 320dp, 430dp, and font scale 1.3. On iOS the time chip stayed at its default before the picker fix. The Expo UI picker is the fix, and the user confirmed on their iPhone (2026-10-17) that the chip now updates.
- Open items: the Android time dialog uses the system accent (blue), not plum. At 320dp with the largest font the slot names wrap mid-word because the time chip leaves too little room. The sheet's scrim and its Done button share the accessibility label "Done". `mauve` on `linen` is about 3.6:1, below AA for body text (the token is kept as specified; decision pending). Resolved on 2026-10-20: `mauve` is now `#6E636D` (see the step 09 follow-up).

**Step 04 — Sign In UI and mock auth (2026-10-17).**

- Added: the real `SignInScreen` (the three auth buttons are a local `AuthButton`), `EmailSheet` (email step, then a 6-digit code step), `BottomSheet`, `PrivacyNoteCard`, `HomePlaceholderScreen` and the `Home` route (TEMP until step 08), `src/services/auth.ts` (TEMP mock until step 05), `src/types/index.ts`, `useAnnounce`, `copy.auth` and `copy.common`, `images.googleG` and `images.appleLogo`. The logos are `assets/images/google-g.svg` and `apple-logo.svg`, copied from the inline `<svg>` blocks in `prompt_material/02-sign-in.html` with `xmlns` and `viewBox="0 0 24 24"`; the G keeps its four brand fills and the Apple path is filled white. The only change to `OnboardingScreen` is its time sheet background (`blush`).
- Mock auth (`// TEMP(05)`, step 05 keeps the signatures): about 800 ms per call. Apple, Google and resend always succeed. `sendEmailCode` fails with `INVALID_EMAIL` unless the address matches a simple regex. `verifyEmailCode` fails with `INVALID_CODE` for `000000` and succeeds otherwise. Every failure carries its `message` from `copy.auth.errors`, and screens render `result.message` without building error text.
- Decisions: "Send code" is enabled once the address contains `@`, a loose check on purpose, because the service decides validity (so `INVALID_EMAIL` stays reachable). Closing the sheet clears everything including the typed email, while "Use a different email" keeps it. The sheet follows the Bottom Sheets section: no `autoFocus`, a delayed `focus()`, translucent system bars on Android, and the top inset reserved.
- Token and HTML differences (tokens kept): screen margin 20 (`.screen__content`) against the HTML's 24. Title `text-title` 28/34 with `tracking-[-0.7px]` against the HTML's 26/34 `tracking-tight`. Button labels `.btn-ghost__label` 15 SemiBold against 15 Medium. Privacy title `text-label-lg` 15 against 14. The sheet handle and top border use `petal` (the HTML has `#D7C7BF` and `#E8DDD8`), the shadow is `shadows.sheet`, and the scrim has no blur. The HTML's `shadow-sm` on the buttons and the privacy card is not added: only the icon tile takes `shadows.card`, as the step prompt says.
- Verified on the Android emulator (Expo Go 57.0.9) at 320dp, 390dp and 411dp wide, and at font scale 1.3 (411dp and 320dp): Apple and Google pending states, the Home reset, the hidden chevron after a reset, the invalid and valid email paths, the code step (auto-submit, `000000` error, success), the resend cooldown, "Use a different email", close and reopen, hardware back, and the keyboard opening on its own. `tintColor` recolors the logo mark rosewood on Android.
- Not verified (no iOS here): `tintColor` on the SVG, the iOS keyboard and `oneTimeCode` suggestion, pasting "123 456" (only the digit-stripping logic is checked, because the Android number pad filters spaces), `announceForAccessibility`, VoiceOver and TalkBack, and the sheet closing before the navigation reset on iOS.
- Open items: on Android, the keyboard's Send key hides the keyboard, and after `INVALID_EMAIL` the user taps the field again. The code input's own text is drawn at 1% opacity beside the first box, which is imperceptible on screen.

**Step 05 — Clerk authentication (2026-10-17).**

- Decisions: packages approved (versions in Tech Stack) plus `expo-constants` for Expo Go detection. `com.gracehush.app` is both `ios.bundleIdentifier` and `android.package`, with `ios.usesAppleSignIn: true` (the `expo-apple-authentication` plugin adds the entitlement itself). `app.json` stays the base config and `app.config.ts` only injects the four Google values from `process.env` into `expo.extra`, under the names in `.env.example`. No `expo-dev-client`, no `eas.json`, no prebuild: Apple and Google wait for the Clerk, Google Cloud and Apple setup.
- Added: `src/hooks/useAuthActions.ts` (the five functions, `AuthResult` unchanged, `RATE_LIMITED` and `NOT_SUPPORTED` added to `AuthErrorCode`), `app.config.ts`, `.env.example`, four strings in `copy.auth.errors`. `App.tsx` is now `App` (`ClerkProvider`, SecureStore `tokenCache`, throws a clear error when `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is missing) around `AppShell` (the fonts and Clerk's `isLoaded` gate the splash). `RootNavigator` switches on `isSignedIn`. `src/services/auth.ts`, `goHome()`, `onSignedIn` and every `TEMP(05)` marker are gone. The Apple button renders on iOS only.
- Email is Clerk's sign-in-or-up flow: `signIn.create({ identifier, signUpIfMissing: true })`, `emailCode.sendCode()`, `emailCode.verifyCode()`. The `sign_up_if_missing_transfer` error means a new user, so `signUp.create({ transfer: true })` and `finalize()` follow. No `signIn.reset()` is needed, because the next `create()` starts a new attempt. `signUp.missingFields` and unexpected sign-in statuses are logged in `__DEV__` only, and the user sees a calm message.
- Facts taken from the installed SDK (`@clerk/expo` 4.13.0) rather than the docs pages: the Apple and Google hooks swallow a cancelled prompt and return `createdSessionId: null`, so a null id maps to `CANCELLED` (thrown cancel codes are mapped too). The Apple hook forwards `fullName` to `signUp.create` itself, so no extra Apple call is needed for the name. The Google hook reads its IDs from `Constants.expoConfig.extra` or `process.env` and needs only the web client ID (plus the iOS one on iOS), but our guard also requires the Android client ID on Android, as the step prompt says. Network failures surface as `network_error` or `clerk_offline` (from the installed clerk-js) or as React Native's `TypeError("Network request failed")`; all three map to `NETWORK`.
- Session tasks: `finalize()` and `setActive()` get a `navigate` callback that only records `session.currentTask`. A pending task returns `extraVerification` and the user stays on Sign In. No task UI, no `taskUrls`.
- Verified: `npm run lint`, `npm run typecheck`, `expo export` for Android and iOS, `expo install --check` (up to date), `expo-doctor` (21/21), and the merged config (`extra`, identifiers, plugins).
- Not verified: everything that runs. `.env.local` did not exist, so the app was never launched with Clerk: cold start and splash, email for a new and a returning user, a wrong code, resend, rate limit and airplane mode (the real network code is unconfirmed), Apple and Google in Expo Go, relaunch while signed in, sign-out, double taps, whether `isLoaded` flickers during sign-in (if it does, latch it so the navigator is not unmounted), the sheet closing on the iPhone, and the real Apple and Google flows.
- Open items: the Clerk instance settings are in the manual checklist and none could be checked from here. An instance that requires more than the email address would end a new user's sign-up at `missing_requirements`.

**Step 05 follow-up — Google in Expo Go (2026-10-17).**

- Why: the user tests on an iPhone in Expo Go, where the native Google module does not exist, so "Continue with Google" showed the "isn't available" message. They asked for it to work and approved `expo-auth-session` (57.0.16).
- What: in `useAuthActions`, `continueWithGoogle` branches on `inExpoGo` and calls Clerk's `useSSO().startSSOFlow({ strategy: "oauth_google" })`, then the same `activateSession` as the native flows. The redirect URL is Clerk's default (`AuthSession.makeRedirectUri`, `exp://…/--/sso-callback`). The native flow and its guards are unchanged for development builds. Apple is unchanged (`NOT_SUPPORTED` in Expo Go). The dev instance's own Google credentials mean no Google Cloud setup is needed for this path; a production instance would need custom credentials anyway.
- Verified on the Android emulator (Expo Go 57): Sign In shows Google and email (no Apple), tapping Google opens a Chrome custom tab on Google's "Sign in to continue to Clerk" page, so Clerk accepted the redirect URL. Closing the tab leaves the Sign In screen with no error text, and tapping Google again works. `npm run lint`, `typecheck` and `expo export` for both platforms pass.
- Not verified: completing a Google login (no credentials are entered here), the return redirect into the app and the switch to Home, and anything on the iPhone (`ASWebAuthenticationSession`). On the emulator, closing the Chrome tab returned to Expo Go's launcher list instead of the app (the app kept running and was still on Sign In); this looks like Chrome's first-run task on a fresh emulator, not an app defect, and was not checked on a device.
- Open items: if the iPhone login finishes but the app does not come back, add the redirect URL it used to "Allowlist for mobile SSO redirect" on Clerk's Native applications page.

**Step 06 — Types and mock data (2026-10-17).**

- Decisions (from the step prompt): contracts match step 19 (`text`, `mimeType`, `durationMs`, step 19's error codes); durations are milliseconds everywhere; audio is a storage path (`audioPath`), never a URL; Gemini output types stay server-only; `onboarding_completed_at` and `devotional_voice` are not columns; active prayers are listed oldest first (step 14's selectors sort them, `listPrayers()` returns newest first); `Scripture.text` is `null` unless `verified`; `mockDb` holds the profile too (steps 15 and 16 mutate it); a `pending` or `uploading` row is local-only (step 24 may replace that rule); `PlanUsage.limit` is `FREE_DEVOTIONALS_PER_WEEK` for `free` and `null` for `trial` and `pro`; models are plain JSON; `JournalEntry` carries `updatedAt`.
- No Supabase project exists yet (the user, 2026-10-17), so step 0 of the prompt could not be done: there was no live schema to copy and no `supabase/schema.sql`. `src/types/database.ts` follows the column lists in the prompt (base columns), AGENTS.md "Known Schema Gaps" (planned columns) and step 18 instead, with anything unsure typed nullable. Where the prompt allowed two names it uses `entry_id` (not `journal_id`) and `answered_notes` (not `answered_note`), and it mirrors `is_delivered` as an existing `daily_affirmations` column. Step 18 must check all of it against the real database. Steps 17 and 18 read `supabase/schema.sql`, so the project and the base tables have to exist before step 17.
- Added: `src/constants/app.ts`; `src/types/database.ts`; the models and contracts in `src/types/index.ts` (`EmotionKey` now lives there, and `theme.ts` imports it instead of declaring a second copy); `src/data/mappers.ts`, `selectors.ts`, `journalRepository.ts`; `src/data/mock/` (`dates.ts`, `scenario.ts`, `users.ts`, `entries.ts`, `affirmations.ts`, `db.ts`, `scripture.ts`); `src/utils/format.ts`; `copy.common.today`, `yesterday` and `defaultDevotionalTitle`. Changed: `OnboardingScreen` uses `formatTime12` (no visual change), and `HomePlaceholderScreen` is a scrollable TEMP data check with three scenario buttons.
- Differences from the prompt text: `daysAgo` and `minutesAgo` take an optional trailing `now` (default `new Date()`), so `buildFixtures` builds every date from one `now`, and `buildFixtures(now, scenario = getMockScenario())` takes the scenario as an optional second argument. `mock/scripture.ts` (verse text with source URLs) is an extra file. The entry mappers share one gate (`ready` and not a crisis): `toPrayer` returns `null` outside it, and `dominantEmotion` is `null` for every unfinished entry, not only a crisis. The repository returns no affirmations for a crisis entry even if rows exist. `getDisplayName` returns `null` for a string without `@`.
- Mock data: 24 entries in the default scenario (20 finished: 4 featured cards, 4 active and 12 answered prayers; plus one each that is processing, pending, failed and a crisis), 3 affirmations, user `user_mock_sarah`. Every date is generated from `now`; the profile's `created_at` (`2026-10-01T12:00:00.000Z`) is the one fixed date. Copy that comes from the designs: the Journal, Reflection and Prayers strings in the prompt (title, scripts, closing prayer, three prayers and three answered prayers, affirmation headlines and morning text). The other prayers, transcripts, devotionals and closing prayers were written for the mocks.
- Scripture (BSB, fetched from `https://bible.helloao.org/api/BSB/{BOOK}/{chapter}.json`; all 20 verified, none unverified): Philippians 4:6–7, Matthew 11:28–30, Psalm 103:1–5, Romans 15:13, Psalm 91:4, Colossians 3:12, Proverbs 3:24, Romans 12:18, Philippians 4:19, Isaiah 26:3, Psalm 23:2, Matthew 6:26, Proverbs 3:5–6, Proverbs 15:1, Isaiah 41:10, 1 Peter 5:7, James 1:5, 2 Corinthians 9:8, Psalm 32:8, Proverbs 17:17. Philippians 4:6–7 ends "surpasses all understanding" (the Reflection design says "comprehension", which is placeholder).
- Verified: `npm run lint`, `npm run typecheck` and `expo export` for Android and iOS, all exit 0. A scratch harness outside the repo compiled the data layer and ran 3,709 checks in each of 12 time zones (both daylight-saving directions included) over 10 different `now` values, plus 22 repository checks and a character-for-character comparison of 38 design strings. On the Android emulator (Expo Go 57.0.9) the dev check shows the expected numbers for `default`, `empty` and `offline`, at 411dp and at 320dp with font scale 1.3 (the card wraps, the scenario buttons wrap to two rows, the screen scrolls). Signing in with `gracehush06+clerk_test@example.com` and code `424242` reached Home, and a relaunch while signed in returned straight to Home.
- Not verified: the iPhone (waiting for the user to confirm in Expo Go), and the table layout in a real database.
- Open items: no Supabase project or base schema yet (see above). Step 18's "Expected columns" omits `devotional_title`, `closing_prayer` and `prayer_title`, and nothing upstream produces a prayer title (step 19's Gemini schema only has `prayer.summary`). Step 13 calls `formatLongDate` with a string, but it takes a `Date` and prints no year.

**Step 07 — Onboarding state and permissions (2026-10-18).**

- Decisions (from the step prompt): the audio package is `expo-audio` (`getRecordingPermissionsAsync` and `requestRecordingPermissionsAsync`, never its own notification helper); a permission that can still be asked counts as `undetermined` (Android 13+ reports a never-asked notification permission as `denied` with `canAskAgain: true`); `safeStorage` and a field-by-field `merge` keep an unreadable or corrupt store from holding the splash; sign-out keeps onboarding (it is per device); both `expo-audio` background flags are `false`; the `expo-notifications` plugin gets `color` only (no `icon` until step 28 has the 96×96 white PNG, and no `enableRemoteNotifications`, which SDK 57 does not have).
- Installed with `npx expo install`: `zustand` 5.0.15, `@react-native-async-storage/async-storage` 2.2.0, `expo-audio` 57.0.5, `expo-notifications` 57.0.23. Then `expo-asset` 57.0.20, approved by the user mid-step: `expo-doctor` failed 20 of 21 checks because `expo-audio` lists it as a required peer that must be a direct dependency (it was already in `node_modules` through `expo`). `expo install --check` is up to date and `expo-doctor` is 21/21. `npx expo install` exits 1 for `expo-audio` and `expo-asset` only because it cannot write a plugin into the dynamic `app.config.ts`; the plugins are added to `app.json` by hand, and no `expo-asset` plugin entry was added (the prompt allows just the two).
- **Expo Go on Android cannot import `expo-notifications`.** Found by launching the app after the first wiring: a red screen `Cannot find native module 'ExpoTopicSubscriptionModule'` (plus the expected remote-push warning from `DevicePushTokenAutoRegistration`). The Kotlin class is inside the Expo Go 57.0.9 APK but is not registered, `TopicSubscriptionModule.android.js` requires it at import time, and the package index re-exports it. 57.0.9 is the newest Expo Go for both platforms. On iOS that module is a JS stub, so the iPhone is not affected (not verified). Asked as the step required, the user chose to guard the module instead of moving Android testing to a development build: `services/notifications.ts` skips the import in Expo Go on Android only (`Platform.OS === "android" && isRunningInExpoGo()`), and its functions then answer `"undetermined"` without a prompt. iOS and development builds import it unguarded, so a real failure there is not hidden.
- Added: `src/store/onboardingStore.ts`, `src/store/safeStorage.ts`, `src/hooks/useStoreHydrated.ts`, `src/services/permissions.ts`, `recorder.ts` and `notifications.ts`, `DEFAULT_REMINDERS` and `AFFIRMATION_CHANNEL_ID` in `src/constants/app.ts`, `PermissionResult` in `src/types/index.ts`, and `copy.notifications.channelName` (the channel name is user-visible, so it lives in `copy.ts` and not inline as the prompt's snippet had it). Changed: `App.tsx` (the splash also waits for `useStoreHydrated(useOnboardingStore)`), `RootNavigator` (the three branches, the returning-user effect, `navigationKey` on SignIn), `OnboardingScreen` (reminders come from the store, `defaultTimes` and the local state are gone; "Allow & Continue" requests only `undetermined` permissions, with a ref guard and `loading` and `disabled` while it runs; "Maybe later" only completes onboarding), `HomePlaceholderScreen` (the dev reset button and helper text), `src/data/mappers.ts` (imports `DEFAULT_REMINDERS`, its private copy is deleted) and the `app.json` plugins. Both `TODO(07)` markers are gone, and nothing in `OnboardingScreen`'s markup changed.
- Differences from the prompt: (1) the Expo Go guard above. (2) `SignIn` carries a `navigationKey`. The prompt expected the navigator to return to Welcome by itself after the dev reset, and it did not: sign-out leaves the stack at `[SignIn]`, and `getStateForRouteNamesChange` keeps existing routes, so the reset only added `Onboarding` to the branch while Sign In stayed focused (a relaunch showed Welcome, so the reset itself had worked). Changing SignIn's key with the flag drops its route and the navigator falls back to `Onboarding`. (3) `useStoreHydrated` passes zustand's `onFinishHydration` and `hasHydrated` to `useSyncExternalStore` unbound, with no wrappers: the installed persist functions are closures that never use `this`. (4) `safeStorage.getItem` logs a JSON syntax error as "invalid JSON" only, because an engine's error text can quote the text it choked on.
- Native config (`app.json` plugins `expo-audio` with the microphone text, `recordAudioAndroid: true` and both background flags `false`, and `expo-notifications` with `color: "#5B3A5E"`). `npx expo config --type introspect --json` shows: `android.permissions` has `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` and not `FOREGROUND_SERVICE_MEDIA_PLAYBACK`; `ios.infoPlist.NSMicrophoneUsageDescription` equals the step's string (the only place it is set); `ios.infoPlist.UIBackgroundModes` has no `audio`; `ios.entitlements["aps-environment"]` is `development` (the plugin always adds it). Config plugins only change a native build, so Expo Go ignores all of this.
- Verified: `npm run lint`, `npm run typecheck` and `expo export` for Android and iOS, all exit 0, again after the last code change. A scratch harness outside the repo compiled the store, `safeStorage` and the hook and passed 75 checks: bare zustand never hydrates when a read throws, but with `safeStorage` a throwing read and invalid JSON both hydrate with the defaults and remove the bad key without logging its content; bad fields fall back while valid ones are kept; odd JSON shapes and other saved versions hydrate; `setReminder` rejects `"24:00"`, `"8:00"`, `"ab"` and more, and the same value is a no-op that keeps `remindersSyncedAt`; `completeOnboarding` and `markPermissionsPrompted` keep their first timestamp; `resetOnboarding` plus `clearStorage` removes only its own key; only the five data fields are saved; `useStoreHydrated` notifies once and stops after unsubscribing; failed writes never throw.
- Verified on the Android emulator (Expo Go 57.0.9, the prompt's checks 1 to 9, with the notification prompt out of reach there): a fresh start shows Welcome with no Sign In or Home at any sampled moment; Morning 9:30 AM survives back and forward and a force-stop, and the flow restarts at Welcome; "Allow & Continue" shows the spinner and the OS microphone prompt, and denying it lands on Sign In with no error text; a relaunch while signed out opens Sign In directly with no chevron; "I already have an account" plus email sign-in, a relaunch straight to Home, and sign-out opens Sign In without onboarding; "Maybe later" asks for nothing (neither permission carries a user-decision flag in `dumpsys`) and lands on Sign In; "Reset onboarding (dev)" shows Welcome at once, restores the defaults (Evening 8:00 PM after a saved 9:15 PM) and a relaunch still shows Welcome, so the session is gone; with both permissions granted, Expo Go showed its own per-project confirmation once, and on a second run "Allow & Continue" went straight to Sign In with no dialog. The three onboarding steps and Sign In are pixel-identical to the "before" screenshots below the status bar (re-taken on the final code).
- Not verified: the iPhone (the user confirms checks 1, 2, 3, 4, 6 and 7 in Expo Go), Gracehush's own microphone text and the notification channel on a real build (Android in step 05b, iPhone in step 35), the Android notification prompt (Expo Go cannot show it), and iOS provisional notification status.
- Open items: the manual notification icon (a white 96×96 PNG, step 28 asks for it). Step 28 and later notification steps cannot be exercised in Expo Go on Android, so they need the iPhone in Expo Go or the Android development build.

**Step 08 — Tabs, header and input dock (2026-10-19).**

- Decisions (from the step prompt): `@react-navigation/bottom-tabs` was approved and installed with `npx expo install` (7.21.0, `^7.21.0` in `package.json`; `expo install --check` is up to date, `expo-doctor` is 21/21, and nothing else was installed). The third tab is "Profile" with a person icon (the "Sanctuary" label and church icon on 06 and 07 are a design inconsistency). The dock is bottom-right, not a centered pill. The avatar shows on all three tabs: a button to Profile on Journal and Prayers, a plain circle on Profile. Tokens win over the HTML: active tab and mic orb `plum`, title, avatar and pen icon `plum-deep`, eyebrow `rosewood`, lotus and emblem `plum`, inactive tab `mauve`. Skipped on purpose: haptics (`expo-haptics` is not installed), `expo-navigation-bar`, and the Stitch preview toggles. Expo Go stays the test target and no native module was added.
- Added: `src/navigation/MainTabs.tsx`; `src/components/GracehushTabBar.tsx`, `FloatingInputDock.tsx`, `ScreenHeader.tsx` and `dev/DevToolsPanel.tsx`; `src/hooks/useTabScreenBottomPadding.ts`; the placeholder screens `journal/JournalFeedScreen.tsx` (with a `__DEV__` "Open sample reflection" button), `journal/NewEntryScreen.tsx`, `journal/ReflectionScreen.tsx`, `prayers/PrayersScreen.tsx`, `profile/ProfileScreen.tsx` and `paywall/PaywallScreen.tsx`, each marked `// TEMP: replaced in step NN`; `copy.tabs`, `copy.header` and `copy.dock`; and five numbers in `layout` (`tabBarHeight` 64, `dockOffset` 20, `dockPen` 44, `dockOrb` 56, `dockClearance` 112). Changed: `src/navigation/types.ts` (the `Home` route is gone; `MainTabParamList`, `RootStackScreenProps` and `MainTabScreenProps` are new), `RootNavigator` (only the signed-in group; the signed-out branch, the returning-user effect and the `navigationKey` are untouched), and one comment in `EmailSheet.tsx` that named the removed `Home` route. Deleted: `HomePlaceholderScreen.tsx`; its controls moved into `DevToolsPanel` with the same behavior and the same order in "Reset onboarding (dev)".
- Icons (every one through `Icon`, both names): Journal tab `book` and `book.fill` (iOS), `menu_book` (Android); Prayers `hands.sparkles` and `hands.sparkles.fill`, `volunteer_activism`; Profile `person` and `person.fill`, `person`; lotus `leaf`, `spa`; avatar glyph `person`, `person`; pen `square.and.pencil`, `edit_note`; mic `mic.fill`, `mic`. No name differs from the prompt. Android has no fill option, so the selected Android icon is the same glyph in `plum`. The TEMP screens use `xmark` / `close` and `chevron.left` / `chevron_left`.
- **Deviation from the prompt, found on the emulator:** the dock's `bottom: "100%"` resolves against the parent's content box, not its border box (see the vendor note on percentage offsets), so as a child of the padded, bordered bar it overlapped the bar by the bottom inset plus the border (the mic's bottom edge was 5dp below the bar's top instead of 20dp above it). The prompt allowed `onLayout` as the fallback; a simpler fix needs no state and no height constant: `GracehushTabBar` renders an outer view with no padding or border, with the dock as its last child beside the visible bar (the inner view that carries the border, the linen background and `paddingBottom: insets.bottom`). The dock now ends 19.8dp above the bar.
- Other small differences: the header and the bar are a 64dp row plus a 1dp border (65dp), as in the HTML, where the border sits outside the `h-16` row. `tabPress` carries no `data.behavior` (see the Navigation Map). The tab items stretch to the row's full 64dp height and are 56dp wide as specified; with `justify-around` the gaps between the items are not touch targets. The dock keeps its 20dp right margin under 360dp wide, where the content margin becomes 16. The fade drives both layers from one animated value (inactive 1 to 0, active 0 to 1), so at the midpoint the glyph is a little lighter than either color (about 143,123,142, against mauve 138,127,136); at 150ms this is not visible.
- Differences between the three designs, and what was built. Header from 03: 1px bottom border (06 and 07 use a soft shadow, the border is kept because AGENTS.md says to rely on Petal borders), a 21 Medium title (06 and 07: 22 Regular), eyebrow tracking 2.4 (06 and 07: 1.1), the lotus in `plum` (03: rosewood, 06 and 07: charcoal). Tab bar from 03: 1px top border (06 has none, 07 has a border and a shadow), icon 22, label 11 with line height 11, inactive labels Medium where the HTML is Regular, inactive color `mauve` (03: `#7E747C`). Dock from 06 and 07, which agree: pen 44 with a Petal border, gap 8, bottom-aligned, orb `#5B3A5E` = `plum` (03: pen 40, gap 10, centered, orb `#432446`). Not built, as decorative: the HTML's translucent blur on the header and bar and its shadow on the avatar. `#432446` (the HTML's `deepplum`) maps to `plum-deep`.
- Measured on the Android emulator (Expo Go 57.0.9, 1080x2400 at 420dpi, so dp = px / 2.625; gestural navigation, inset 24.1dp): header row 64 (65 with its border), emblem 32, the text block 11 + 26.3 tall and centered in the row, lotus box 44 with its 22 icon, avatar 32 (touch area 44 with `hitSlop`) with its right edge 19.8 from the screen edge and 8 from the lotus box; tab bar 1 + 64 + 24.1 = 89.1, items 56 × 64 centered at 79.4, 205.9 and 332.4; mic 56 × 56 with a 19.8 right margin, pen 44.2 × 44.2, 8 between them, both bottom edges 19.8 above the bar's top. At 320dp wide and font scale 1.3 (360dpi, 2.25 px per dp) the same elements are 56 × 64, 32, 44 and 56, with 20 between the dock and the bar. In 3-button navigation the bar's inset is 48dp.
- Verified: `npm run lint`, `npm run typecheck`, `npx expo install --check`, `npx expo-doctor` and `expo export` for Android and iOS all exit 0, again after the last edit. On the Android emulator (Expo Go 57.0.9), the prompt's checks 1 to 9: (1) signing in lands on Journal with the numbers above. (2) The selected state moves with each tab and the dock's bounds are identical on all three; the avatar opens Profile from Journal and Prayers and does nothing on Profile. The color cross-fade was caught by slowing the fade to 60s on Android only (a `TEMP-EXPERIMENT`, reverted): the darkest pixel of the Profile icon and label went from mauve (138,127,136) through (141,130,139), (145,131,142) and (109,79,111) to plum (91,58,94) while Prayers went the other way, and the labels never moved. (3) The pen and the mic open `NewEntry` full-screen (write and speak) with no bar or dock, X closes it, three quick taps on the pen open one `NewEntry` (one X returns to Journal), pen then mic quickly keeps `write`, and the dock works after closing. The taps reach the dock although it is outside the bar's bounds, so no `overflow` change was needed. (4) "Open sample reflection" pushes `Reflection` with `entry-anxious-yesterday` and back returns; in the `empty` scenario it does nothing. (5) At the end of Profile's scroll the dev card's bottom edge is 36 to 37dp above the dock (36.4 at 320dp and font scale 1.3); tapping the active Profile tab scrolls to the top; hardware back from Prayers and from Profile returns to Journal. (6) The scenario switch works, "Open paywall (dev)" opens the modal over the tabs and X closes it, "Sign out (dev)" shows Sign In (no chevron, no Welcome), and after signing in again "Reset onboarding (dev)" shows Welcome at once and it stays. (7) `uiautomator dump --compressed` shows each tab as a clickable, focusable item named Journal, Prayers or Profile with `selected` on the active one, the dock buttons labelled "Write a reflection" and "Speak a reflection", "Open profile" as a button, and nothing for the lotus, the tab layers or the icon glyphs. React Native's Android source sets the role descriptions "tab" and "tablist" (`rn_tab_description`, `tablist_description`), so TalkBack announces the role. (8) At 320dp wide and font scale 1.3 the header does not clip or wrap, each tab label stays on one line, and the dock clears the bar. (9) Report only, nothing changed: in 3-button navigation the bar clears the system buttons (white with dark buttons in light mode, gray with white buttons in dark mode) and the pen, the mic and the tabs tap correctly; in dark mode the status icons stay dark on linen because `StatusBar style="dark"` is fixed, and the gesture pill stays visible. `app.json` has `userInterfaceStyle: "automatic"` but the UI is light only, so the system chrome goes dark around a linen app: readable, but it needs a decision (set it to `light`, or build a dark theme).
- Not verified: the iPhone until the user confirms (checks 1 to 6 of manual setup item 3), TalkBack and VoiceOver, iOS safe areas and the filled iOS symbols, and the release build (check 10 was not run: the Android development build of step 05b does not exist, so there is no `android/` folder, no `eas.json` and no `expo-dev-client`).
- Open items: what the lotus icon should do (`TODO: lotus action undefined — confirm with product`; resolved on 2026-10-20: removed, see the step 09 follow-up); whether to approve `expo-haptics` for a light tap on tab changes and on the mic (approved and built in the step 11 follow-up, 2026-10-20); whether each tab should fill a third of the row so the gaps between the items are touchable (the spec says `justify-around` with 56dp items); `userInterfaceStyle` against a light-only UI (above; resolved in the step 11 follow-up: it is `light`); in Expo Go the floating "Tools" button covers the header avatar (it is Expo Go's, drag it aside).

**Step 09 — Journal Home UI (2026-10-19).**

- Decisions (from the step prompt, none asked again): nothing was installed (`package.json` and the lockfile are untouched since step 08; `expo install --check` is up to date). The greeting follows the clock (`getGreeting`) and the affirmation card follows the reminder times (`getCurrentSlot`), so between 17:00 and the evening reminder it says "Good evening" over the afternoon card, and between 05:00 and the morning reminder it says "Good morning" over the previous evening's card. The empty state keeps the "Record your first prayer" button, so `PrimaryButton` gained the optional `iconLeft` (18, white, before the label). `.chip__label--terracotta` is now `text-hopeful-fg` (contrast, see Styling Rules). `Toast` takes only `message` and `visible`. The dev store, `useReduceMotion`, `Skeleton`, `EmotionBadge` and `OfflineBanner` are shared with steps 10 to 14 and 23. An `uploading` card has its own line ("Saving your reflection…"), and a null transcript reads "Voice reflection" in mauve. No pagination (step 25 adds `onEndReached`). Mauve stayed as specified when this step was built (resolved the next day: see the step 09 follow-up).
- Added: `src/store/devStore.ts`; `src/hooks/useJournalHome.ts` and `useReduceMotion.ts`; `src/components/AffirmationCard.tsx`, `JournalCard.tsx`, `EmotionBadge.tsx`, `OfflineBanner.tsx`, `Toast.tsx` and `Skeleton.tsx`; `src/screens/journal/JournalFilterSheet.tsx`; `copy.journal`; `formatDurationSpoken` and `getAffirmationSource` in `format.ts`; `JournalFilter` and `filterEntries` in `selectors.ts`. Changed: `JournalFeedScreen.tsx` (rewritten; the placeholder and its "Open sample reflection" button are gone), `scenario.ts` (reads the dev store; `setMockScenario` and `TEMP(09)` are gone), `DevToolsPanel.tsx` (scenario through the dev store, plus "Fail next Journal load (dev)"), `PrimaryButton.tsx` and `global.css` (the two shared-file edits).
- Icons (iOS / Android, all through `Icon`): sun `sun.max.fill` / `wb_sunny`; heart `heart` / `favorite`, saved `heart.fill` / `heart_check`; clock `clock` / `schedule`; filter `slider.horizontal.3` / `tune`; play `play.fill` / `play_arrow`; cloud off `icloud.slash` / `cloud_off`; hourglass `hourglass` / `hourglass_top`; refresh `arrow.clockwise` / `refresh`; check `checkmark` / `check`; Support chip `heart` / `favorite`; empty-state button `mic.fill` / `mic`. No name differs from the prompt.
- **Behavior beyond the prompt's text:** `useJournalHome` loads through one `useFocusEffect` whose callback depends on the scenario, and the same callback holds the `AppState` listener. So a tab that is not in front never loads, a scenario changed on Profile loads when Journal is next opened (data loaded for another scenario counts as not loaded, so the skeleton shows), the one-shot `nextHomeLoadFails` flag is spent by the load you can see, and leaving the screen drops a response that is still on its way. A load that fails with data of the same scenario on screen keeps the data and spends the flag silently (verified).
- Small decisions: the failed card's "Try again" pill is a disabled `Pressable` shown at 50% opacity (the app's disabled look), because a full-strength pill that does nothing reads as broken. The duration pill has `min-h-[26px]` so the icon-only pill (no measured duration) keeps its height. The Toast pill is `accessible` with the message as its label, inside an anchor with `pointerEvents="none"`. The heart is optimistic local state and resets when the data reloads through the loading state (persistence is `TODO(25)`). A transcript is trimmed, wrapped in curly quotes and clamped to two lines; a crisis card never reads it.
- Differences from the design, all kept: section title `text-section` (Medium, the token) against the HTML's semibold; scripture reference in the 400 italic (the only italic loaded) against the HTML's medium italic; empty title `text-section` 20 against 22 semibold; the HTML empty copy ("Even half-formed prayers…") replaced by the prompt's, and its illustration replaced by the logo mark without the small lotus badge; `shadow-sm` on the chip, pill and banner left out; small labels (chip, count, timestamp, affirmation footer) at the scale's 13 against the HTML's 12 and 11, and body (transcript, affirmation body) at 15 against 14.5 and 14; "Offline mode" against "Offline Mode"; the banner's icon circle and border use `petal` (HTML `#EBD8D1` and `#E8DAD4`) and the chip border is `terracotta/25` (HTML `#F4DDD2`); the offline order is greeting, banner, affirmation card, section row (the HTML's offline view swaps the last two out); the synced pill floats above the dock without the HTML's "Refresh" action, where the HTML shows it inline under the banner; the Stitch toggle is not built and its 20dp gap stays. The Android saved heart is `heart_check` (Android symbols are outline only).
- Measured on the Android emulator (Expo Go 57.0.9; dp = px / 2.625 at 1080x2400, 2.76875 at the 390dp setting, 2.25 at 320dp): side padding 20.2 (19.9 at 390.1dp wide, 16.0 at 320dp); gap between cards 14.2 (13.6 at 390dp, pixel rounding); card padding 16 plus the 1dp border (text starts 17 from the card edge); consistency chip 28.2 tall (the HTML's 12px label inherits a 1.5 line height, so it is 28 there too); duration pill 63.2 × 26.3; 24.7 above "Your Reflections" (20 + 4); heart icon 17.9 (touch 44 with `hitSlop` 13); Filter label 18.3 tall (touch 44.3); filter chips 29.3 tall with 8 between them (touch 45.3 with `hitSlop` 8), then 24 to the 48-tall "Show n reflections" button, then the 43.8-tall Reset row 8 below it; greeting block 177.0 wide at 390.1dp, which breaks "Good / evening, / Sarah" in three lines beside the chip like the design's "Good / morning, / Sarah" (102.9 tall), and 288 wide at 320dp with font scale 1.3 (chip under the date); the toast's bottom edge 88 above the bar and 12.2 above the mic orb, centered; at the end of the scroll the last card ends 36.2 above the orb's top; skeleton bars 28 and 14, card 180, three cards 130; the empty state's title, body and button sit at y 443.0, 487.2 and 547.8 (button 48 tall) and the error card's message and button at 380.6 and 419.0.
- Verified: `npm run lint`, `npm run typecheck`, `npx expo install --check` and `expo export` for Android and iOS all exit 0, again after the last edit. A scratch harness outside the repo (the repo's TypeScript transpiled on require, `@/` mapped to `src/`, `process.env.TZ` set first) ran 85 checks in each of eight zones (UTC, New York, Los Angeles, London, Kolkata, Auckland, Kiritimati, Pago Pago): the greeting at 00:00, 04:59, 05:00, 11:59, 12:00, 16:59, 17:00 and 23:59; greeting against slot at 07:59, 08:05, 13:05, 19:05 and 20:05; `filterEntries` for all seven filters through the real mappers (anxious 8, prayers 17 = 5 active + 12 answered, crisis and unfinished entries never match, empty results on trimmed lists, case-insensitive); `getAffirmationSource` just after and before midnight, a month back, in the future and across two daylight-saving weekends; `formatDurationSpoken` (75 s, 58 s, 120 s, 61 s, 59.5 s, 0, negative, NaN, Infinity); every plural helper. Bundle: the new classes (`border-terracotta/25`, `text-ink/80`, `border-sage/30`, `gap-x-2`, `size-24`, `min-h-[26px]`, `border-[1.5px]` and the rest) compile with the right values, and `.chip__label--terracotta` compiles to `#9a4f31`.
- Verified on the Android emulator (Expo Go 57.0.9), the prompt's checks 1 to 11: (1) the default scenario shows the greeting with the email-derived name ("Gracehush" from `gracehush08+clerk_test@example.com`, never the address), the date, "5 days of reflection", the current slot's affirmation, "24 entries" and the cards; compared with the design at 390.1dp (1080x2340 at density 443) in proportions, and with the name forced to "Sarah" (a `TEMP-EXPERIMENT`, reverted) the greeting broke into the same three lines as the design ("Good / evening, / Sarah" at night, the design has "morning,"). (2) Every card label is the prompt's string; ready, text-only and crisis cards are buttons that open `Reflection` with their id, and back returns to the same scroll position (the tapped card is where it was); pending, processing and failed are one labelled element and not buttons; the `uploading` card ("Saving your reflection…") was seen with one `pending` mock row changed (a `TEMP-EXPERIMENT`, reverted). (3) `empty`: greeting only, "No reflections yet", and its button opens New Entry in speak mode (X returns); `offline`: the banner directly under the greeting with "3 reflections", and the "Waiting to sync" chips; back to `default`: "All reflections synced" appeared above the dock. (4) Filter: Anxious (8, "Filter · 1", "Filter reflections, showing Anxious"), Prayer requests (17, no unfinished or crisis card), Reset (All, 24); the filtered-empty state with "0 entries" and "Clear filter" was seen with the only `grieving` row changed (a `TEMP-EXPERIMENT`, reverted). (5) Loading: with `simulateLatency` at 30s on Android only (a `TEMP-EXPERIMENT`, reverted) the skeleton is one "Loading your reflections, busy" element with its children hidden and its colour pulses between the petal colour and its 50% blend, and with Reduce Motion on (`transition_animation_scale 0`, restored to 1.0) seven samples were identical; error: "Fail next Journal load (dev)" plus a scenario switch shows the error card alone, and "Try again" loads the new scenario. (6) Pull-to-refresh shows the plum spinner; tapping the active Journal tab while scrolled returns to the top. (7) The heart goes from `favorite` in mauve to `heart_check` in plum-deep and its label from "Save affirmation" to "Remove from saved". (8) With the clock at 08:05, 13:05, 19:05 and 20:05 (local, WAT) the greeting and the card were morning and "Morning affirmation", afternoon and "Afternoon affirmation", evening and "Afternoon affirmation", evening and "Evening affirmation", after the app went to the background and returned; the footer also changed to "your Oct 18 prayer" on the next day. The clock, auto time and the zone were restored and confirmed (`adb shell date` matched the host). (9) The name is derived from the email, never the address. (10) At 390dp and font scale 1.3 the chip drops under the date; at 320dp and 1.3 the greeting wraps in two lines, the section count wraps under the title, the footer of the affirmation card wraps, and the badges, pills, chips and the failed card fit; the filter sheet fits (three rows of chips). (11) `uiautomator dump --compressed` shows each pressable card as a button with its summary, the heart and Filter as buttons, and the skeleton as one element.
- Emulator findings worth keeping: Android appends ", busy" to the content description of an element with `accessibilityState={{ busy: true }}`, so match "Loading your reflections" as a prefix. On this machine JS timers run late while the emulator is busy (the 2.5s toast timer fired after 4.1s with no polling, and after 8.7s while `uiautomator dump` was polling), so the toast's on-screen time was not measured at 2.5s; the effect runs once and the timer is `setTimeout(…, 2500)`. An `adb input swipe` that starts on a card can arrive as a tap when the emulator lags, so start swipes on an inert spot and verify with a dump.
- Not verified: the iPhone until the user confirms (manual setup item 3), TalkBack and VoiceOver, `announceForAccessibility` on iOS and the Android live regions (the toast and the offline banner), the toast's real 2.5s on a device, and `tintColor` on the logo mark on iOS.
- Text and background pairs below 4.5:1 that ship (no token changed): `mauve` on white 3.84 (timestamps, "Voice reflection", "Preparing…" and "Saving…", the affirmation footer); `mauve` on linen 3.60 (the date, the entry count, the empty and filtered-empty copy); `mauve` on linen-deep 3.29 ("Waiting to sync", "Text only", "Support resources", the unselected filter chips); `rosewood` on blush 4.41 (Reset in the filter sheet, 15 semibold); the terracotta sun icon on its tint 3.00 (a graphic, not text; the label beside it is now 4.90). Above 4.5: rosewood on white 5.13, rosewood on linen 4.81, `ink/80` on white 7.32, the toast 5.07.
- Open items (the first two were resolved on 2026-10-20, see the step 09 follow-up): the `mauve` contrast decision (the pairs above); what the lotus icon should do; the unselected filter chips are barely visible against the blush sheet (`.chip` is linen-deep on blush), so a border or a white fill may be wanted; `TODO(24): NetInfo` and `TODO(24): retry sync` (the failed card's pill), `TODO(25): persist is_favorite` and `TODO(26): play in place` (the duration pill becoming its own `Pressable`). Prompts 24 to 26 never pick up the last two retry and play markers (see the open conflicts), and prompt 24 forbids transcripts on pending cards while this screen shows them.

**Step 09 follow-up — mauve, links on blush and the header lotus (2026-10-20).**

- Decisions (the user approved the recommendations): `mauve` is `#6E636D` (not the bare minimum `#736872`, which clears AA on chips by only 0.06); the header lotus is removed; text links on a blush surface are `plum`. Reasons are in the colour table note and the Navigation Map avatar bullet. The Step 03 and Step 09 open items about `mauve` and the lotus are closed.
- Changed: `global.css` (`--color-mauve`), `src/constants/theme.ts` (`colors.mauve`), `ScreenHeader.tsx` (the lotus, its 44×44 wrapper, the `lotus` icon pair and its TODO are gone; the avatar is the only item on the right, in the same place), `JournalFilterSheet.tsx` (Reset is `text-plum`), `EmailSheet.tsx` ("Resend code" is `text-plum`; the cooldown label stays mauve), and AGENTS.md (the colour table and its note, the Navigation Map avatar bullet, the Journal Home header line, three "resolved" pointers in the old log). No other file changed and nothing was installed.
- Contrast now: `mauve` on white 5.72, linen 5.37, linen-deep 4.91, blush 4.92 (was 3.84, 3.60, 3.29, 3.30); `plum` on blush 8.16 (was `rosewood` 4.41). Computed with a script, not estimated.
- Verified: `npm run lint`, `npm run typecheck` and `expo export` for Android and iOS exit 0, and `text-mauve` compiles to `#6e636d` (the old hex appears once, in a code comment). On the Android emulator (Expo Go 57.0.9): the Journal header has no lotus and the avatar is where it was (x 359.6, 32 wide, its right edge 20 from the screen edge); Prayers and Profile show the same header (Profile's avatar is still a plain circle, not a button); the rendered text colour sampled from screenshots is exactly 110,99,109 on the date, an inactive tab label and an unselected filter chip; Reset and "Resend code" render 91,58,94 (plum); Onboarding (Welcome, Rhythm, Permissions) and Sign In show no layout change; the email sheet shows the mauve "Resend in 0:17" cooldown and then the plum "Resend code"; signing back in with the test address and code works.
- Not verified: the iPhone, TalkBack and VoiceOver.
- Open items: the two error messages in the email sheet were rosewood on blush (4.41:1); resolved on 2026-10-20 by darkening the rosewood token to `#96555D` (see the step 11 follow-up). The unselected filter chips (`.chip`, linen-deep) are barely visible on the blush sheet. **Prompt 10 still calls for a lotus icon in the New Entry info card** (a 40 rose circle with a `plum-deep` lotus 18): the reasons for removing the header lotus (iOS has no lotus symbol, so it shows a leaf there; the brand association) apply to it too, so decide at the prompt 10 review whether to keep it or pick another icon.

**Step 10 — New Entry UI (2026-10-20).**

- Decisions (from the step prompt, none asked again): nothing was installed (`package.json` and the lockfile are untouched; `expo-crypto`'s `randomUUID` gives the `clientEntryId`), and `expo-keep-awake` and `expo-haptics` were skipped (step 23 decides). The HTML is the design source for all three views. Skipped from the HTML on purpose: the Write view's mood chips, "Auto-saved" tag and clear button, and the Processing view's spinning sparkle, rings, ping, blur and "Keep Editing Reflection" button. The info card's lotus is a listening ear (`ear` / `hearing`). No new tokens (the waveform's brown bar is `rosewood`, and `layout.micOrb` became `recordOrb` 84 and `recordHalo` 124). Copy says only what the app does ("Your reflection will be waiting in your Journal"). Leaving uses `usePreventRemove` (see the Navigation Map). Finish is enabled at 3 seconds, while recording too, where it stops first. The mock submit is one-shot and grows the mock database. One `clientEntryId` per screen. The waveform shows the last 9 levels. Crisis is checked before the limit. The microphone is re-read when the app returns while the card is showing.
- Added: `src/components/SegmentedControl.tsx`, `ConfirmDialog.tsx`, `Waveform.tsx`; `src/hooks/useRecorder.ts` and `usePulse.ts`; `src/screens/journal/SpeakSection.tsx`, `WriteSection.tsx` and `ProcessingOverlay.tsx`; `copy.newEntry`; the seven constants in `app.ts`; `RecorderStatus`, `RecordingResult`, `ProcessingStage` and `SubmitResult` in `types/index.ts`; `formatTimer` and `countWords`; `MockSubmitOutcome` and `takeMockSubmitOutcome` in `scenario.ts`; `CRISIS_ENTRY_ID` in `entries.ts`; `addMockEntry` in `db.ts`; `submitEntry` in the repository; `nextSubmitOutcome` in the dev store and its selector in `DevToolsPanel`. Changed: `NewEntryScreen.tsx` (rewritten; the placeholder and its `TEMP` marker are gone), `services/recorder.ts` (the mock recorder, `TEMP(23)`; the permission functions are unchanged) and `theme.ts`.
- Icons (iOS / Android, all through `Icon`): close `xmark` / `close`; lock `lock.fill` / `lock`; mic `mic.fill` / `mic`; stop `stop.fill` / `stop`; footer arrow `arrow.right` / `arrow_forward`; record again `arrow.clockwise` / `refresh`; ear `ear` / `hearing`; word count `square.and.pencil` / `edit_note`; done `checkmark` / `check`; note `book` / `menu_book`. No name differs from the prompt.
- Added beyond the prompt's text: `usePulse` (one hook for the four 2s pulses: the recording halo, the timer dot, the processing halo and the active step's dot; the prompt listed no such file, four uses justify it). After a recording the orb asks "Discard this recording?" like "Record again" does (the prompt did not say what the orb does then; its label is "Record again", so a tap cannot throw a recording away). The timer chip has a spoken label ("1 minute 42 seconds of 5 minutes"). "Recording started" and "stopped" and the overlay's stage text reach Android through hidden 1×1 live regions (opacity 0.01, Android only; iOS hears `useAnnounce`), and the error view announces its title. The overlay's "Close" is full width, like the HTML's button. Two honesty markers in `copy.ts`: `TODO(24)` on "Your words are safe" and `TODO(25)` on "waiting in your Journal".
- Differences from the design, all kept: title 20/28 Medium (HTML 18) and the Speak and Write titles 24/32 Medium (HTML 24 regular); small labels at the scale's 13 (HTML 11 and 12); the timer in DM Sans tabular figures (HTML mono); cards keep the Petal border and `shadows.card` (HTML `shadow-sm`, no border on the white cards); the halo sits inside a 124 box behind the orb, so it never overlaps the chip (the HTML lets it bleed), which puts the orb 20dp lower than in the HTML; the idle orb has the static rose halo and a rose dot (the HTML's second state; its first state is the recording one); a stop icon while recording; "Tap to start/stop" while recording (the HTML's "tap to pause"); "Saved locally" only with content; the ear for the lotus; the stage cards have no 70% fade on the upcoming card (it dropped its text below 4.5:1); the Processing content is a full-screen overlay and not a card; the note has a book icon and says "will be waiting in your Journal"; the step descriptions are written for this prompt.
- Measured on the Android emulator (Expo Go 57.0.9; the design's 390dp is `wm size 1080x2340` with `wm density 443`, 2.76875 px/dp): side padding 19.9; close button 44.1×43.7; toggle 158.9×34.0 (Speak 77.7×26.0, Write 73.3×26.0); timer chip 149.5×28.2; orb 83.8×83.8 with its top at 446.0, caption at 562.0 and the info card's title at 636.4, all within 0.3dp of the spec's arithmetic (card top 284.8, padding 24, chip 8 below the waveform's 4 margin, box 124 with 8 margins); Cancel 91.0×44.1 and the footer button 243.4×48.0. In Write with the keyboard open, the Submit button's bottom edge plus its 12dp padding is exactly the keyboard's top (1486 px + 31.5 = 1517 at 420 dpi, the IME frame from `dumpsys window`). At 320dp wide and font scale 1.3: the header title wraps to two lines (57.8 tall) and "Private" stays whole (56.4×21.8), the footer button is 288.0×48.0 under Cancel (105.8×44.0), the dialog's two buttons are 240×48.0 stacked, the step cards wrap and the overlay scrolls.
- Verified: `npm run lint`, `npm run typecheck`, `npx expo install --check` and `expo export` for Android and iOS all exit 0 on the final code. The new classes compile in the Android bundle with the right values (`bg-crisis/20` is `#b4443a33`, `border-plum/30` is `#5b3a5e4d`, `size-[116px]`) and the utilities come after the component classes (`min-h-0` after `segmented__item`). A scratch harness outside the repo ran 86 Node checks (`formatTimer` for 14 values, `countWords`, the one-shot outcome and its release-build behavior, `addMockEntry` in `default`, `empty` and `offline` (24 to 25 entries, three affirmations, the prayer counts unchanged at 5 and 12, none for a crisis entry, the same `clientEntryId` twice adds nothing, typed text becomes the transcript), `submitEntry` for all four outcomes with the stages 1.2s apart and the retry after `failed` succeeding, logs that carry only stage and outcome words, and the mock recorder) and 8 string builders; Hermes on the emulator groups thousands ("4,512"). On the Android emulator (Expo Go 57.0.9), at 411dp, 390dp and 320dp with font scale 1.3: the dock mic opens Speak with no outer header or Stitch toggle, and the pen opens Write with the field focused. The OS prompt, "Don’t allow" and the card, "Open Settings" and "Write instead". Recording turns the orb crisis red with a stop icon and a halo, the timer and bars run, "Saved locally" appears, the toggle dims; an early Finish tap does nothing, Finish while recording stops and submits; "Recorded 00:08", "Record again" and both answers of its dialog; Home while recording keeps the recording. With the limit set to 20s for the test: "30 seconds left", then the automatic stop with the five-minute message; with the counter at 30 and the maximum at 40, typing stops at 40 and the counter shows from 30. Each mode keeps its own content. X, Cancel and Android back ask with content ("Keep editing" stays, "Discard" leaves) and close at once without; Back does nothing while sending, and in the error view it asks; "Close" while sending returns to Journal and the late result is ignored. Outcomes: `ready` (Reflection opens with the new id, back returns to Journal, 25 entries, the new card on top, the affirmation card kept, also in `empty`), `crisis` (Journal shows the "Support resources" card), `failed` (the error view, and a temporary log proved "Try again" reuses the same `clientEntryId`), `limit` (the Paywall placeholder with source `limit`), and the Profile chips go back to `ready`. Reduce Motion: the halo and dot are pixel-identical across frames (they differ with animations on), the processing pulse and the active step's dot are static. The accessibility tree of the overlay and of the error view (`uiautomator dump --compressed`) holds only the overlay: one labelled node per step ("Listening, done. …"), no header, toggle or footer, and the stage live-region text.
- Not verified: the iPhone entirely (the discard dialog above a `fullScreenModal`, `replace` out of a modal, the keyboard, the OS prompt); TalkBack and VoiceOver; the real 5:00 limit (shortened to 20s for the test, then reverted); the OS-level microphone re-check in Expo Go (its per-project permission scoping hides an `adb pm grant`, see the vendor note: the transition was verified with a temporary relaxed condition, reverted); the orb's "Stop recording, N seconds recorded" label in a live dump (`uiautomator` cannot dump while the timer ticks; the string is Node-checked). Every temporary change was reverted and compared byte for byte (`cmp`).
- Open items: markers left for later steps: `TODO(22)` (the server returns `entryId` with `LIMIT_REACHED`; step 16 passes it to the Paywall), `TEMP(23)` and `TODO(23)` (the real recorder, and interruption handling), `TODO(24)` ("Saved locally", "Your words are safe", "queue for retry"), `TEMP(25)` (`submitEntry` and `addMockEntry`) and `TODO(25)` ("waiting in your Journal", and keep processing after the screen closes: the mock finishes after "Close" but its result is dropped). `expo-haptics` was approved and installed in the step 11 follow-up (only `expo-keep-awake` waits for step 23), and a "your reflection is ready" notification for step 28. Step 12 wants `formatTimer` for scrub labels ("00:42"); step 23 says 11 waveform values where there are 9 bars, reads the flat path `src/screens/NewEntryScreen.tsx` and calls the button "Done" (it is "Finish Reflection"). Observations to decide: at 320dp wide with font scale 1.3 the orb starts below the fold (the page scrolls) and with the keyboard open about one line of the text area stays visible, because the wrapped, pinned footer and the two-line header take most of a 569dp-tall viewport (hide the footer or let it scroll while the keyboard is open?); a recording under 3 seconds leaves Finish dimmed with no message (no copy was specified); on a tall phone with the keyboard open in Write, the page scrolls about 40dp and hides the toggle until the user scrolls up. The waveform animates nine heights with the JS driver every 100ms (the native driver cannot animate a height): fine on the emulator, worth a look on a low-end phone. Editing a file during a recording cancels the mock recorder (Fast Refresh, dev only).

**Step 11 — Reflection UI (2026-10-20).**

- Decisions (from the step prompt, none asked again): nothing was installed (`package.json` and the lockfile are untouched; `expo install --check` is up to date). The HTML is the design source for sizes and tokens win over it. Playback is mocked (`useMockPlayback`, `TEMP(26)`), the prayer toggle is local state (`TODO(29)`), crisis is a data state checked first, and its view is temporary (`TEMP(13)`: a message and a way back, no resources, **not shippable**: do not ship a build between this step and step 13). "Return to Journal" and the chevron's fallback use `popTo`, never `navigate`. Copy says only what the app does (`TODO(24)` on "Your words are safe", `TODO(25)` on "waiting in your Journal" and on "try again from your journal"). `rose` is never text (the player card's subtitle and time are white at 70%, "Tap to open player" white at 90%). Skipped from the HTML on purpose: the pill switcher, the header's bookmark and share icons, the Now Playing and Crisis views, the `shadow-xs` on the white and blush cards, the header blur and the custom 44×24 toggle (the native `Switch` instead).
- Added: `src/components/MiniPlayerCard.tsx` (props `devotional` and `onOpen`; a private `AudioCard` calls `useMockPlayback`, a private `NoAudioCard` serves an entry without audio or without a measured length), `ScriptureCard.tsx`, `ReflectionCarousel.tsx`, `TranscriptRow.tsx` and `FadeIn.tsx`; `src/hooks/useReflection.ts` (`ReflectionState`; the `useJournalHome` shape, keyed by entry id, a failed refetch keeps the data on screen, the one-shot `nextReflectionLoadFails`) and `useMockPlayback.ts`; `src/screens/journal/ReflectionStateViews.tsx` (`ReflectionLoading`, `ReflectionCrisis`, `ReflectionPreparing`, `ReflectionFailed`, `ReflectionNotFound`, `ReflectionError`, over a private `CenteredScroll` and `MessageView`); `copy.reflection`; `formatEntryDate` and `getValidationHeadline` in `format.ts`; `nextReflectionLoadFails` in the dev store. Changed: `ReflectionScreen.tsx` (rewritten: `ReflectionHeader`, `PrayerRequestRow`, `ReadyView` and `shareScripture` are private to it) and `DevToolsPanel.tsx` (the "Open reflection (dev)" row, "Fail next Reflection load (dev)", `DevButton` takes `disabled`, and `loadDataCheck` returns `{ lines, targets }`).
- Icons (iOS / Android, all through `Icon`): back `chevron.left` / `chevron_left`; date `calendar` / `calendar_today`; play `play.fill` / `play_arrow`; pause `pause.fill` / `pause`; open player `chevron.up` / `keyboard_arrow_up`; link arrow `arrow.right` / `arrow_forward`; no audio `book` / `menu_book`; morning `sunrise.fill` / `wb_twilight`; afternoon `sun.max.fill` / `wb_sunny`; evening `moon.fill` / `bedtime`; words lock `lock.fill` / `lock`; words chevron `chevron.down` / `keyboard_arrow_down`; prayer request `hands.sparkles` / `volunteer_activism`; share `square.and.arrow.up` / `share`. No name differs from the prompt. Android's play and pause are outlines.
- Small differences from the prompt text: the devotional script is split with `/\n\s*\n/` (a superset of `/\n{2,}/` that also splits CRLF and blank lines with spaces); "Tap to open player" is `text-white/90` (the table said `text-white`, decision 4 says white at 90%); `CenteredScroll` puts the side padding on an inner `screen__content` `View` instead of numeric padding in the ScrollView (the same 20 and 16); the header's date text has `shrink`; `useReflection` logs nothing (no id or state was worth a line); the dev buttons are labelled "Open reflection {Kind} (dev)".
- Differences from the design, all kept (decision 13 lists the expected ones): the headline is `plum-deep` and a 27/34 Regular one-off (HTML `plum`); the player title is 20/28 (HTML 18) and small labels are 13 (HTML 11 and 12); the scripture reference is 17 SemiBold and the verse 17/26 (HTML 18 Medium and 16/26); devotional text 15/22 (HTML 14); the tab control keeps `SegmentedControl`'s 44dp pill items and shorter labels (HTML 26dp rounded-lg tabs); each affirmation row shows the affirmation text under its headline (the HTML shows the headline only, in italic); the closing prayer and the transcript are 17/26 (HTML 15 and 12); the words row's title is shortened and its chip is `linen-deep` with `mauve` (HTML blush and rosewood); `shadows.card` on the plum card (HTML `shadow-md`); a chevron for `arrow_back`; no bookmark icon on the footer button; the native `Switch`; and the PNG's three glitches (the reference over the verse, the wrapped time, the wrapped "Save to Journal") do not exist.
- Measured on the Android emulator (Expo Go 57.0.9; the design's 390dp is `wm size 1080x2340` with `wm density 443`, 2.76875 px/dp): side padding 19.9; header row 56 plus its 1dp divider (back button 44.1×43.7, calendar 18); headline 68.6 tall (two lines) at 390dp and 102 (three) at 360dp and 320dp; mini player 350.3×126.0 with the circle 48.0×48.0, the track 6.1 tall (its fill 154.9 of 317.8dp at 0:37 of 1:15, full at the end) and a corner inset of 15.2dp (radius 16); scripture card 350.3×280.6 at 390dp (the pill under the reference), 225.5 tall at 411dp (beside it), text starting 36.8 from the screen edge (20 + 1 + 16); tabs 102.6×44.1 in a 52.0 track (92.7 wide at 360dp); words row 348.2×54.2 collapsed with the chip beside the title (title 140.5 + chip 104), 318×78 at 360dp with the chip under it, 286.2×85.8 at 320dp and font scale 1.3; prayer row 350.3×78.0 (the Android `Switch` is 48 tall); footer button 294.4×48.0 and the share circle 48.0×48.0, 7.6 apart. At 320dp and font scale 1.3: the player title wraps to two lines (card 206.7 tall), the time and the link stack (the link under the time, both whole), the pill drops under the reference, the prayer row is 148 tall, the footer button is 232×48 beside the share circle, and nothing clips.
- Verified: `npm run lint`, `npm run typecheck`, `npx expo install --check` and `expo export` for Android and iOS (once unminified, to search the bundle, and once plain on the final code) all exit 0. All new classes compile with the right values in the Android bundle (`text-[27px]`, `tracking-[-0.675px]` is `letterSpacing -0.675`, `bg-linen/80` is `#fbf7f2cc`, `text-white/70` `#ffffffb3`, `bg-plum-deep/60` `#3e274199`, `bg-card/70`, `bg-blush/60`, `w-[3px]`, `rounded-xl` 12, `size-9` 36). A scratch harness outside the repo ran 76 Node checks in each of two time zones (`America/Los_Angeles` and `Pacific/Auckland`): `formatEntryDate` at noon, 23:30 and 00:30 on 31 December and 1 January, `getValidationHeadline` for the five emotions, "Anxious", " WEARY ", null, "", "overwhelmed", "constructor" and "__proto__" (the raw string is never echoed), every copy builder, the paragraph split, the mock database through the repository (every entry kind, the three ordered affirmations for the anxious entry and none for the weary and crisis entries, a `ready` clone with three and a `crisis` clone with none) and `getCurrentSlot` at 07:30, 08:30, 13:30 and 20:30. On the emulator, at 390dp, about 411dp, 360dp and 320dp with font scale 1.3: the ready view against the design PNG in a side-by-side (proportions, since the PNG is 1.25x); mock playback (the bar and "0:48 / 1:15" from the real 75 seconds, pause holds, the end stops at "1:15 / 1:15" and play restarts from "0:00", Home pauses, opening the Paywall over Reflection pauses it, the card body and "Tap to open player" log the step 12 line once each and the play button logs nothing); the tabs (Affirmations with the three times and a plum bar on the current slot, and with the emulator clock at 08:30, 13:30, 20:30 and 07:30 the bar was on Morning, Afternoon, Evening and Evening, clock restored; the weary entry shows the empty message; Closing Prayer ends with "Amen." inside the quote); the pane fade and the chevron turn (slowed to 20s and 8s in a reverted experiment, intermediate opacities and angles caught, and jumps to the end state with Reduce Motion); the words row ("Your spoken prayer" and "Your written prayer", the quoted transcript, a typed entry's new text after a New Entry submit); the prayer row (on for the anxious entry, off for the weary one, a tap on the icon, the text, the switch or the padding flips it, one `Switch` node in `--compressed`); the share sheet (Android's, with the verse, "— Matthew 11:28–30 (BSB)" and "Shared from Gracehush", cancel shows nothing); reverted experiments with an unverified passage (reference, pill and "We're confirming this passage.", no verse, no share circle), no passage (no card, no share circle) and no closing prayer (two tabs); the calm views through the dev row (processing and pending, failed, not found, and crisis with no player, verse, tabs, share, toggle or transcript in a `--compressed` dump, also from New Entry with "Next submit" set to `crisis`); the error view with "Fail next Reflection load (dev)" and "Try again"; the loading skeleton (one "Loading your reflection, busy" element, pulsing with animations on, five identical frames with Reduce Motion); navigation (from Profile, "Return to Journal" lands on Journal and Android back then leaves the app, so there is one `MainTabs`; the chevron returns to the same Journal scroll position; after a New Entry `ready` submit the new card is on top, 25 entries). Contrast for every text pair was computed: nothing is below 4.5:1 except the two decision 12 lists.
- Not verified: the iPhone entirely (the share sheet, the native `Switch`, `popTo` into the tab navigator, filled play and pause, VoiceOver on the nested controls, whether iOS has the segmented-pill bug below); TalkBack and VoiceOver; the chevron's `canGoBack() === false` fallback (it needs a notification to open Reflection first, step 28); the `expanded` state of the words row (`uiautomator` does not expose it); the real devotional audio. Every temporary change was reverted and compared byte for byte (`cmp`), and each one was Android-only so a connected iPhone saw none of them.
- Open items (needing your yes or a decision; (1), (2), (3) and the `rosewood` part of (5) were approved and done on 2026-10-20 and (4) was decided, see the step 11 follow-up): (1) **`SegmentedControl` draws every item selected after mount as a square block on Android** (see the vendor note): the Reflection tabs and New Entry's toggle. The fix is `collapsable={false}` on its item `View`, tested on the emulator; the prompt forbids changing the component, so it is not applied. (2) **A verse that already carries its own quotation marks is quoted twice**: the stored BSB text of Matthew 11:28–30 ends with `”` (the close of a speech that starts at verse 25), so the card and the share message end `light.””`, and a verse like Psalm 46:10 would show `““…””`. The prompt asks for curly quotes and scripture text must stay exact, so nothing was changed; the proposal is to add only the mark a verse lacks (never remove or alter one). (3) **`useReduceMotion` starts at `false` and answers 43 to 486 ms after a mount**, so under Reduce Motion a pane's 150 ms fade shows briefly before it is cancelled (see the vendor note); a module-level cache in the hook fixes it for `FadeIn`, `Skeleton` and `usePulse`. (4) At font scale 1.3 "Affirmations" breaks inside the word at 360dp and all three tab labels break at 320dp (`SegmentedControl` again, step 14 reuses it). (5) `rosewood` on blush is 4.41:1 for the scripture reference (joins the email sheet's two error messages; `#9B5860` would pass and waits for approval); the `Switch`'s off track is 1.31:1 as a graphic (the HTML's own; the thumb and the label carry the state). Markers left: `TODO(12)` (open the player), `TEMP(13)` (the crisis view, and step 13 reuses `TranscriptRow`), `TODO(24)` and `TODO(25)` (the two strings in `copy.ts`, and `TODO(25)` "Try again" on the failed view), `TODO(29)` (persist the prayer toggle) and `TEMP(26)` (step 12 deletes `useMockPlayback`). Step 28 opens the carousel on `devotional`, `affirmations` or `prayer`; decide there whether a "your reflection is ready" notification exists.

**Step 11 follow-up — four fixes and three decisions (2026-10-20).**

- Decisions (the user approved all the professional recommendations made after the step 11 report): (1) `SegmentedControl`'s item `View` gets `collapsable={false}`: one prop, a bug fix in a component the step 11 prompt said not to touch (see the vendor note). (2) Scripture is quoted by `quoteVerse`, which balances the verse's own curly double quotes and never edits the verse (Screen Specifications, 5). The first idea, adding only the mark a verse lacks at each end, was dropped: a verse that ends with its own inner quote would still end `””`. The rule counts the marks with a depth scan instead. (3) `useReduceMotion` is one app-wide answer (vendor note). (4) `rosewood` is `#96555D` (colour table). The first proposal, `#9B5860`, was replaced for headroom (4.56 on blush against 4.81). Decided without code: (5) the large-text wrap of the tab labels ("Affirmations" at 360dp and all three labels at 320dp, both at font scale 1.3) waits for step 14, which reuses `SegmentedControl` with count badges: one adaptive layout there (stack the tabs at large text) fixes both, and nothing is clipped or lost meanwhile; (6) the temporary crisis view needs no action: no build leaves the user's machines before step 13 (the iOS account is last), so keep step 13 right after step 12 and do not reorder; (7) no "your reflection is ready" notification in V1 (Notification Rules).
- Changed: `src/components/SegmentedControl.tsx` (the prop, with a comment), `src/hooks/useReduceMotion.ts` (rewritten, same signature), `src/utils/format.ts` (`quoteVerse`), `src/components/ScriptureCard.tsx` (uses it), `src/screens/journal/ReflectionScreen.tsx` (the share message uses it), `src/constants/copy.ts` (`share.message` now takes the quoted verse, and a comment on `quote`), `global.css` and `src/constants/theme.ts` (`rosewood`), the three comments that cited "rosewood on blush is 4.41:1" (`EmailSheet.tsx`, `JournalFilterSheet.tsx`, `SpeakSection.tsx`) and AGENTS.md. Nothing was installed (`package.json` and the lockfile are untouched).
- Verified: `npm run lint`, `npm run typecheck`, `npx expo install --check` (up to date) and `expo export` for Android and iOS (once unminified with `-c`, once plain on the final code) exit 0. The bundle compiles `text-rosewood`, `border-rosewood`, `eyebrow` and `text-scripture-ref` to `#96555d` and holds `#9e5a62` only in a comment. A Node harness outside the repo ran 5,038 `quoteVerse` checks: hand-made cases, the 20 mock verses (only Matthew 11:28–30 carries its own marks, and it becomes one pair) and 14 real BSB chapters from the HelloAO API (Genesis 3, Psalm 46 and 91, Isaiah 41, Matthew 5, 6 and 11, Luke 15, John 3, 11 and 14, Romans 8, Philippians 4, 1 Peter 5: 424 verses and 1,230 verses and runs of two or three). Of those, 208 got a missing mark, 186 already paired up and the rest were wrapped; every result contains the verse unchanged, adds only curly quotes at its ends and is balanced, and running the helper twice changes nothing. On the Android emulator (Expo Go 57.0.9, 390dp, Metro on 8082): the Reflection tabs show a round pill after Affirmations, after Closing Prayer and back on Devotional, and New Entry's toggle after Write and back on Speak (item bounds unchanged: 102.6×44.1 in a 52.0 track, and 77.7×26.0 and 73.3×26.0); Matthew 11:28–30 shows one pair and its share text (read from Android's share sheet) ends `light.”` then "— Matthew 11:28–30 (BSB)" then "Shared from Gracehush"; Philippians 4:6–7 is unchanged; the rendered text of the date (on linen), the scripture reference (on blush) and the pill label (on the translucent pill) is exactly 150,85,93, which is `#96555D`; `useReduceMotion` was measured with temporary logs in `FadeIn` and in the hook (details in the vendor note), all reverted and compared with `cmp` (a search finds no `TEMP-EXPERIMENT` left). The emulator's display overrides were reset and it was shut down, and my Metro on 8082 was stopped; the user's on 8081 was never touched.
- Not verified: the iPhone (the user checks that the selected tab and toggle are round pills, which also tells whether iOS ever had the bug, the new colour, one pair of quote marks on Matthew 11:28–30 and in its share sheet, and Reduce Motion), TalkBack and VoiceOver, the email sheet's error text on the emulator (it is the same compiled class as the three samples), and a component that mounts before the OS answers the Reduce Motion question (see the vendor note).
- Open items: none new. The large-text tab wrap stays open for step 14. **Restart Metro after pulling this** (`global.css` changed; `npx expo start -c` if the colour still looks like the old one): a hot reload carries the TypeScript changes and may not carry a CSS change.

**Step 11 follow-up 2 — premium polish (2026-10-20).**

- Decisions (the user tested the follow-up on the iPhone, said every check works, sent eight screenshots and asked for whatever would make the UI look modern and premium; I recommended nine items and they answered "Implement it"): (1) Write with the keyboard up: the title and helper step aside and the card shrinks to the space above the footer, so it stays whole (the card ran behind the footer, hiding its rounded bottom and the word count). (2) The text inputs ask for the light keyboard and `app.json` locks `userInterfaceStyle` to `light` (the iPhone was in dark mode: dark keyboard under the cream UI). (3) The Write placeholder no longer repeats the title. (4) Curly apostrophes everywhere the app writes text. (5) The devotional is `text-body-lg` (17/26). (6) The Journal greeting keeps the full width and the streak chip moves onto the date's line. (7) The Reflection sections arrive one after another. (8) The Speak caption follows the state. (9) `expo-haptics`, for exactly the moments listed under "Haptics". Left for later, not decided here: a night theme (after V1), and the greeting against the affirmation card's slot (at 12:39 PM the greeting says afternoon over the Morning card, by the step 09 rule that the card follows the reminder times; by 1:16 PM they agree).
- Installed with `npx expo install` and the user's approval: `expo-haptics` 57.0.3 (one line in `package.json`, 11 in the lockfile; `expo install --check` is up to date and `expo-doctor` is 21/21). Nothing else.
- Changed: `src/services/haptics.ts` (new); `FadeIn.tsx` (optional `delay`, `rise` and `duration`; it starts visible under Reduce Motion); `SegmentedControl.tsx` and `GracehushTabBar.tsx` (the selection tap); `ReflectionScreen.tsx` (the arrival and the prayer row's tap), `ReflectionCarousel.tsx` (devotional at `text-body-lg`, paragraph gap 12); `NewEntryScreen.tsx` (the success tap), `SpeakSection.tsx` (the recording taps from its state change, and the caption), `WriteSection.tsx` (rewritten: keyboard-aware, light keyboard), `EmailSheet.tsx` (light keyboard), `JournalFeedScreen.tsx` (`GreetingBlock`; the `LONGEST_GREETING_WORD` constant is gone); `copy.ts` (placeholder, `captionIdle` and `captionRecording` instead of `caption`, and the apostrophes); `src/data/mock/entries.ts` and `affirmations.ts` (apostrophes, dev data only: `scripture.ts` is untouched); `app.json`; `package.json` and the lockfile; AGENTS.md.
- Differences from the design, all kept on purpose (the user asked for premium over an exact copy): the chip on the date's line (the HTML has it beside the greeting); the devotional at 17/26 (HTML 14); the Write placeholder and the Speak captions (HTML copy); no title while typing; the arrival animation; the haptics; curly apostrophes (the HTML has straight ones).
- Verified: `npm run lint`, `npm run typecheck`, `npx expo install --check`, `npx expo-doctor` and `expo export` for Android and iOS (once unminified, once plain on the final code) exit 0. The bundles hold `keyboardAppearance: "light"` three times, the haptics calls, the new strings and the curly headline, and `LayoutAnimation.configureNext` only in the iOS bundle. A Node harness outside the repo checked 211 `copy` strings and 138 builder results for straight apostrophes (none), 99 mock texts (none) and that the 20 BSB verses are unchanged. On the Android emulator (Expo Go 57.0.9, Metro on 8082): at 390dp the greeting block is 68.6dp tall (two lines; it was 102.9 with three) with the date and the chip on one row, and at 320dp with font scale 1.3 it wraps without breaking a word; Write with the keyboard up (the IME starts at y 1501 of 2340) has no title, the field is 300.5×189.3dp (about seven lines) and the word count and the card's rounded bottom sit above the footer, and when the keyboard hides the title returns and the field is 404.9dp again; the placeholder reads "Type freely. Share your worries, praises or questions, without judgment."; the Speak caption reads TAP TO BEGIN, then TAP TO STOP while recording, then RECORDED 01:07; a temporary Android-only log in `haptics.ts` showed `light` once at the start, `medium` once at the stop, `selection` for Write and for Speak but not for a second press on the selected Write, `success` once for a `ready` submit and nothing for a `crisis` one, `selection` for the prayer switch and for each of three tab changes but not for the focused tab; the arrival mounts six sections with delays 0, 60, 120, 180, 240 and 300 ms and every animation finishes, and a 40x slow-motion run (Android-only, reverted) showed the headline, then the player card, then the scripture card and the carousel appearing one after another with a slight rise; under Reduce Motion every section is there at once with unchanged sizes (headline 68.6, player 350.3×126.0, scripture 350.3×280.6); the devotional paragraphs are 316.4×130.0 (five lines of 26) with curly apostrophes; the tab panes still show their content with round pills. Every temporary change was reverted and compared with `cmp` (no `TEMP-EXPERIMENT` is left), the emulator's display overrides were reset and it was shut down, and my Metro on 8082 was stopped; the user's on 8081 was never touched.
- Not verified: the iPhone entirely (the keyboard-synced collapse through `LayoutAnimation`, how the haptics feel, `keyboardAppearance`, whether Expo Go applies `userInterfaceStyle`, the smoothness of the arrival), TalkBack and VoiceOver. The emulator keeps no vibration history, so the haptics were checked at their call sites, not by feel.
- Known limit: at 320dp wide with font scale 1.3 the keyboard-up Write view still shows about a line and a half of text, because the header wraps to two lines, the footer stacks and the screen is only 569dp tall (the same as step 10; typing stays visible, with the caret in view). The recommendation text said this change would also fix it: it does not. A compact typing mode (hide the toggle too, smaller card padding) would, and it changes the interaction, so it waits for a yes.
- Open items: **restart Metro** after pulling this (`npx expo start -c`): `app.json` and a new package changed, which a hot reload does not carry. Step 32's Gemini prompt must ask for curly apostrophes. Step 14 reuses `SegmentedControl`, which now ticks on change, and the large-text tab wrap is still open for it.

**Step 12 — Now Playing sheet and the shared player store (2026-10-20).**

- Decisions (from the step prompt, none asked again): nothing was installed (`package.json` and the lockfile are untouched; `expo install --check` is up to date). `#view-nowplaying` in `prompt_material/05-reflection.html` is the design source, and tokens win over it. Speed is three chips (0.8x, 1x, 1.2x) and ambient is a chip row that starts with "Off". **Load on action, not on view**: nothing loads until the user plays on the mini player or opens Now Playing. `load(track, ambient)` is synchronous with the profile passed in, `stop()` is a full reset, speed and ambient survive another track, and the clock is wall time times the rate. Haptics: `selection` for a changed speed or ambient chip only. The scrubber has a thumb. The artwork has no text. There is no mini player outside Reflection in V1 (a global one is a new feature: ask first). The footer line is development-only. Nothing on the screen animates by itself. Duration field: `Devotional.durationMs` everywhere, never a hardcoded length.
- Added: `src/store/playerStore.ts`, `src/hooks/usePlayback.ts`, `src/components/ProgressScrubber.tsx`, `src/screens/journal/NowPlayingScreen.tsx` (private to it: `CloseRow`, `Artwork`, `SkipGlyph`, `ChoiceChip`, `PlayerView`, `NowPlayingLoading`); `PlaybackStatus`, `PlaybackRate`, `PlaybackTrack` and `AmbientDefault` in `types/index.ts`; `SKIP_MS`, `PLAYBACK_RATES` and `AMBIENT_SOUNDS` in `constants/app.ts`; `copy.nowPlaying` and `copy.ambient.labels`; `getPlaybackTrack` in `selectors.ts`; the `NowPlaying: { entryId }` route, registered after `Reflection` with `presentation: "modal"` and `animation: "slide_from_bottom"`; the "Open player (dev)" row in `DevToolsPanel`. Changed: `MiniPlayerCard.tsx` (props `devotional`, `track`, `ambientDefault`, `onOpen`; it reads the store), `ReflectionScreen.tsx` (`ReadyView` takes `onOpenPlayer`; the `openPlayer` stub, its `console.info` and `TODO(12)` are gone, and the screen does not call `usePlayback`), `ReflectionStateViews.tsx` (`MessageView` is exported, nothing else), `mappers.ts` (imports `AMBIENT_SOUNDS`), `RootNavigator.tsx` and `navigation/types.ts`. Deleted: `src/hooks/useMockPlayback.ts`. The step 11 entries that say "step 12 deletes `useMockPlayback`" and "Tap to open player logs a line" are history: the hook is gone and the card now opens the sheet.
- Icons (iOS / Android, all through `Icon`): close `chevron.down` / `keyboard_arrow_down`; play `play.fill` / `play_arrow`; pause `pause.fill` / `pause`; replay `arrow.counterclockwise` / `replay`; back 15 `gobackward.15` / `replay` and forward 15 `goforward.15` / `replay` mirrored (Android draws the 15 as a 10px `Text` inside the arrow, with `allowFontScaling={false}`); ambient `waveform` / `graphic_eq`; quieter `speaker.fill` / `volume_down`; louder `speaker.wave.3.fill` / `volume_up`. No name differs from the prompt, and `satisfies SymbolViewProps["name"]` type-checks them.
- **Beyond the prompt's text (each found while building or on the emulator):** (1) the page does not scroll while a finger is on a scrubber (`scrollEnabled`, see the vendor note): the responder props alone let Android's `ScrollView` take a drag that drifts about 8dp vertically. (2) `needsOffscreenAlphaCompositing` on the dimmed volume row (see the vendor note): the thumb showed the fill's end through it. (3) The draft store was hardened: `play()` is a no-op while playing (a redundant play restarted the interval and lost up to 250 ms), `seekTo` ignores an idle player and a non-finite value (the draft turned an idle player into "ended"), and a seek while playing resets the tick reference (the time before the seek was counted twice). (4) The ambient chips are labelled "Ambient sound, Soft Rain" for screen readers (the prompt said only "labelled from `copy.ambient.labels`", and "Off" alone is ambiguous). (5) `getPlaybackTrack` also rejects a non-finite duration. (6) The error view's message ("We couldn’t load this devotional.") and the "Close" text link under "Try again" were not in the prompt's strings.
- Differences from the HTML, all kept: no blurred circles, white 95% circle or "Gracehush Sanctuary" label (white on the gradient is 3.36:1 there), and the 2-stop `gradients.brand`; the logo sits in the Onboarding frosted tile scaled to 96; the title is 24 Medium `plum-deep` (HTML regular `plum`) with "Gracehush • reference" under it (HTML: the reference only); the scrubber has a 16dp thumb and a 44dp touch area (HTML: an 8dp bar with no thumb); the skip icons are the plain 15 glyphs (the HTML's `replay_10` with a "15" under it shows two numbers); the unselected chips are `mauve` on white with a petal border (HTML `muted`, and a linen fill for the ambient ones); the ambient chips wrap (HTML scrolls them sideways); the Close row says "Close" (HTML "Close sheet") and its handle is iOS-only and centered (HTML: between the button and a spacer); `shadow-xs` on the card is skipped; times use `formatDuration` ("0:34", not `formatTimer`'s "00:34").
- Measured on the Android emulator (Expo Go 57.0.9; 390dp is `wm size 1080x2340` + `wm density 443`, 2.76875 px/dp; the top inset is 45.1dp and the bottom 23.8): side padding 19.9; Close button 73.0×44.1 at y 45.1; artwork 350.3×262.6 (the spec's 350×262.5) with the tile 96.1×95.7 and the logo 56.3×56.0 centered in it; title View 208.4×32.1 (one line) at y 383.6 and the subtitle 182.0×18.1; scrubber view 350.3×43.7 at y 450.0 with the track 7.9 tall and the thumb 15.9×16.3, the time labels 6.2 under the track; skip buttons 48.0×48.0 and the orb 64.3×64.3, 23.9 apart; speed chips 32.1 tall and 60.3, 45.1 and 55.6 wide with 8 between; ambient card 350.3×194.5 at y 632.1 (computed from the measured positions: a dump clips it at the viewport), its chips 32.1 tall (49.8, 84.5, 108.0, then 114.5 on a second row), the volume view 264.4×44.1 between two 16.3 icons; the content is 813dp tall in a release build (845 with the development footer) in a 776.2dp viewport, so it scrolls by about 37dp (68 in development): the second row of ambient chips (40dp) is more than the whole overflow (the HTML scrolls that row sideways), and nothing was shrunk to fit. At 320dp wide with font scale 1.3 (`720x1280` at 360 dpi, top inset 30.2, viewport 514.7): artwork 288.0×216.0; Close 84.4×44.0; a long title (a temporary experiment) is 288.0×64.0, exactly two lines with an ellipsis; scrubber 288.0×44.0; skip 48 and orb 64 with the same gaps; speed chips 36.0 tall (69.3, 48.9, 63.1 wide); ambient card 288.0×273.3 with "Ambient Soundscape" on two lines (151.6×48.0), "Vol 50%" at the right (66.7×21.8), the chips in three rows (56.0, 102.7 | 134.2 | 142.7 wide, 35.6 to 36.0 tall) and the volume view 201.8×44.0; the content is about 857dp in release (914 in development) and everything is reachable by scrolling, nothing clips.
- Verified: `npm run lint`, `npm run typecheck`, `npx expo install --check` and `expo export` for Android and iOS (once unminified with `--no-bytecode --no-minify` to search the bundle, once plain on the final code) exit 0. The new classes compile with the right values (`size-24` 96, `size-16` 64, `size-7` 28, `-mt-3` -12, `opacity-40` 0.4, `w-10` 40, `px-3.5` 14, `pr-3` 12, `border-white/20` `#fff3`, `bg-white/15` `#ffffff26`, `inset-0`). Two Node harnesses outside the repo: the real `playerStore.ts` with a fake clock, a fake interval registry and a fake `AppState` (95 checks, 0 failures: load, the same id is a no-op, one interval after a second play, 1 s at 1x, 1.2x and 0.8x moves 1000, 1200 and 800, one late tick of 8 s moves 8 s, a seek while playing, skip clamps at both ends, skipping past the end gives "ended" and clears the timer, skipping back from the end gives "paused", playing out, play from the end restarts at 0, toggle, another entry clears the old timer and keeps speed and ambient, backgrounding pauses, `stop()` resets and the next load re-seeds the ambient values), and the real mock data through `getPlaybackTrack` in the three scenarios (228 checks, 0 failures: 19 of the 24 default entries can play, a crisis entry and an unfinished one never can, and null, zero, negative, NaN and infinite durations give null). On the emulator, the prompt's checks: (2) play on the mini player, open from the link and from the card body: the clock kept counting and a temporary render log counted zero skeleton renders; Android back returns to Reflection, whose mini player shows the same time with the play icon; the mini player's play button does not open the sheet. (3) A tap at 25% and 75% of the track gave 19 s and 56 s; a held drag followed the finger with the player running underneath (0:42 held while the clock ran), clamped at 0:00 and 1:15 past both ends, survived a drift 147dp above the track with the page staying put, and seeked on release; a temporary log counted one `seekTo` per tap and one per drag. (4) Skip back at 0 stays at 0, forward moves 15 s and clamps at 1:15, the orb becomes the replay arrow labelled "Play again", and a tap restarts from 0:00. (5) Ten seconds of wall clock moved the clock 8, 10 and 12 s at 0.8x, 1x and 1.2x. (6) With A playing, another reflection's mini player said 0:00 and paused, A kept counting, pressing the new play button replaced A (A then showed 0:00 and the play icon), and A's Now Playing opened at 0:00 with the session's ambient choice kept. (7) Every ambient chip, "Off" dims the volume row and its `SeekBar` reports `enabled=false` (and the readout leaves the accessibility tree), "Vol 30%" after a tap at 30%, and the choice and volume held after closing and reopening; a temporary log counted `selection` once per changed chip and never for the selected chip, play, pause or skip. (8) Through "Open player (dev)": No audio, Processing, Pending and Failed show "This devotional’s audio isn’t ready yet.", Crisis and Not found show "We couldn’t find this devotional.", each with a working Close (the header row and the big button); an unloaded entry opened by route shows the skeleton and then the player; "Fail next Reflection load (dev)" then "Open player (dev)" shows "We couldn’t load this devotional." and "Try again" loads it; with a temporary 40 s latency the skeleton is one node, "Loading the player, busy", with its children hidden. (9) 320dp and font scale 1.3 (above). (10) With Reduce Motion on (`transition_animation_scale 0`) the skeleton is static and dumps. (11) `uiautomator dump --compressed` (paused): each scrubber is one `SeekBar` with its label and spoken value, the skip buttons, the orb and every chip are labelled buttons (the chips with their selected state), and the artwork and the time labels are absent. (12) No tab bar and no dock show; three quick taps on the card opened one sheet and one back returned to Reflection; `navigate("MainTabs")` is not used. A screen recording shows the sheet sliding up from the bottom with the explicit option, and, with the option removed, a fade with a slight slide from the right, so the option stays. (13) Every temporary change (render, seek and haptic logs, a 40 s latency, a long title, the scroll guard off, and the navigator without the animation) was reverted and compared byte for byte (`cmp`) with the final files; no `TEMP-EXPERIMENT` is left in `src/`; the emulator's display overrides were reset and it was shut down, and only my own Metro was stopped.
- Not verified: the iPhone entirely (the grab handle and swipe down, the top inset inside the iOS modal, `gobackward.15` and `goforward.15`, filled play and pause, the slide of a `modal` with `animation: "slide_from_bottom"`, VoiceOver on the adjustable scrubbers and the chip states, how the haptics feel, and whether a drag survives a vertical drift on iOS without the scroll guard); TalkBack; the real audio (nothing plays: step 26). A drag was driven with raw `adb` motion events, not a finger.
- Open items: markers left: `TEMP(26)` (the store's internals, and its `AppState` pause: real audio keeps playing in the background), `TODO(26)` (the development-only footer line in `NowPlayingScreen`: show it to everyone once background playback works) and `TODO(27)` (`setAmbient` and `setAmbientVolume`: persist the choice to `users_profile`, and play the ambient bed). For the later prompts, still true of them: **15, 26 and 27** read the flat path `src/screens/NowPlayingScreen.tsx` (it is `src/screens/journal/NowPlayingScreen.tsx`), and 15 says "ProgressScrubber (from step 12)" without its path (`src/components/ProgressScrubber.tsx`); **15 and 27** call the off chip "None" (Now Playing says "Off", from the HTML and `copy.ambient.labels`, the one label map: reuse it); **26** section 5 shows `load({ entryId, title, subtitle, durationMs, audioPath })`, but `load` takes `(track, ambient)`, so add `audioPath` to the track and keep the second argument, and its "update the callers" means `MiniPlayerCard` and `NowPlayingScreen`; **27** says "the switch, chips and volume `ProgressScrubber`" but there is no switch, and its `AMBIENT_LABELS` should reuse `copy.ambient.labels`; **15** says a changed Profile default applies the next time a devotional is loaded, but the store copies the profile's ambient choice once per app start (or after `stop()`), so a change takes effect after the next launch unless 15 or 27 decides otherwise. A global mini player outside Reflection is a new feature (ask first). The iPhone checks wait for the user (the list is in the step 12 report).

---

## Final Reminder

Before every feature implementation:

- Read this file
- Follow it strictly
- Build clean, simple, maintainable code
- Replicate the UI exactly when designs are provided, but ignore Stitch preview artifacts
- Protect the user's privacy, the accuracy of scripture, and the safety of people in crisis
- Record any decision you add or change in this file, then copy it to `prompts/AGENTS.md`
