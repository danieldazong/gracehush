# 34-posthog-analytics.md

Read AGENTS.md first and follow it strictly.

Add privacy-first product analytics with PostHog. Nothing is sent until the person says yes, on a new last step of onboarding or with a switch on Profile. Every event is anonymous, comes from a fixed list, and passes a filter that drops anything not on the list before it leaves the phone. The app never contacts PostHog for a person who has not said yes. No session replay, error tracking, feature flags, surveys or person profiles, and no `identify()`. The only UI changes are the onboarding consent step and the Profile switch (section 5), plus a developer-panel group. Close every `// TODO(34)` in the codebase.

**Status of this text.** Reviewed and rewritten on 2026-10-31 from the code of steps 03 to 33 (read file by file), the installed packages, and the source and type files of `posthog-react-native` 4.85.1 with `@posthog/core` 1.62.0 and `@posthog/types` 1.419.0 (downloaded from npm into a scratch folder and read, not installed). The two new service files are written out in full (sections 3 and 4): the review typechecked both against the app's real types and PostHog's real type files, ran 13 runtime checks of the filter, and broke the filter 8 ways and the types 7 ways, each caught. The wiring is specified closely enough to build, and the implementer proves it (section 7), as steps 29b to 33 did. Where this text gives a shape and the real code disagrees, follow the real code and say so in the report.

Sources read: `AGENTS.md`; `App.tsx`; `src/constants/env.ts`, `src/constants/copy.ts`, `src/constants/app.ts`; `src/store/onboardingStore.ts`, `src/store/entitlementStore.ts`, `src/store/playerStore.ts`, `src/store/devStore.ts`; `src/screens/onboarding/OnboardingScreen.tsx`, `src/screens/profile/ProfileScreen.tsx`, `src/screens/paywall/PaywallScreen.tsx`, `src/screens/journal/NowPlayingScreen.tsx`, `src/screens/journal/ReflectionScreen.tsx`, `src/screens/prayers/PrayersScreen.tsx`; `src/hooks/usePaywall.ts`, `src/hooks/useJournalHome.ts`, `src/hooks/useDeleteReflection.ts`; `src/services/syncEngine.ts`, `src/services/syncPolicy.ts`, `src/services/notificationRouting.ts`, `src/services/affirmationPlanner.ts`, `src/services/account.ts`; `src/navigation/types.ts`, `src/navigation/navigationRef.ts`; `src/types/index.ts`; `supabase/tests/notifications/run.cjs`; `docs/privacy-policy.md`, `docs/legal-brief.md`; the notes for step 34 left in prompts 25, 26, 27, 28, 29, 29b and 33; and these pages, the source of truth for anything this text does not settle:

- https://posthog.com/docs/libraries/react-native
- https://posthog.com/docs/references/posthog-react-native
- https://posthog.com/docs/privacy/data-collection (IP data capture, autocapture)
- https://posthog.com/docs/product-analytics/privacy
- https://developer.apple.com/app-store/app-privacy-details/ and https://developer.apple.com/app-store/user-privacy-and-data-use/
- https://support.google.com/googleplay/android-developer/answer/10787469 (Data safety)

---

## What was checked when this was written (these shaped the prompt)

1. **The old text named files and settings that do not exist.** `src/analytics/events.ts` and `src/analytics/client.ts` become `src/services/analyticsPolicy.ts` (pure, like `syncPolicy.ts` and `affirmationPlanner.ts`) and `src/services/analytics.ts` (the SDK wrapper: AGENTS.md puts SDK wrappers in `services/`). `src/screens/OnboardingScreen.tsx` is `src/screens/onboarding/OnboardingScreen.tsx`, and `src/screens/ProfileScreen.tsx` is `src/screens/profile/ProfileScreen.tsx`. Profile has no "Privacy & Data" group: it is "Privacy & account". "SupportResources" is the route `CrisisResources`. `EXPO_PUBLIC_POSTHOG_API_KEY` becomes `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN`: PostHog calls the `phc_` value the project token, and "API key" invites the personal key (`phx_`). The rebuild through step 05b (`npx expo prebuild --clean`, `npx expo run:android`) is not needed: the SDK is JavaScript only and runs in Expo Go. `expo-application` and `expo-localization` are not needed (decision 1).
2. **The markers to close are fifteen**, and one test reads one of them:
   - `src/hooks/usePaywall.ts:90` and `:97` (`purchase_failed`), `src/screens/paywall/PaywallScreen.tsx:258` (`paywall_viewed`) and `:344` (`purchase_completed` or `restore_completed`);
   - `src/screens/journal/NowPlayingScreen.tsx:306` and `src/screens/profile/ProfileScreen.tsx:453` (`ambient_changed`), `ProfileScreen.tsx:484` (`restore_completed`) and `:571` (`data_export_requested`);
   - `src/screens/journal/ReflectionScreen.tsx:130` (`prayer_tracked_changed`) and `:408` (`reflection_deleted`), `src/screens/prayers/PrayersScreen.tsx:315` (`prayer_marked_answered`), `:359` (`prayer_removed`) and `:373` (`reflection_deleted`);
   - `src/services/notificationRouting.ts:45` (`affirmation_notification_opened`) and `src/services/account.ts:130` (`resetAnalytics()`);
   - `supabase/tests/notifications/run.cjs:814` asserts that the `notificationRouting.ts` marker is still there, so it fails once the marker is closed: section 7 replaces it.
3. **A client contacts PostHog as soon as it exists, opted out or not.** `posthog-react-native` 4.85.1 calls `reloadRemoteConfigAsync()` when it finishes starting, unless the client is `disabled`; `optedOut` does not stop it, and `disableRemoteConfig` is marked deprecated and a no-op ("Remote config is now always loaded"). So a client made at launch with `defaultOptIn: false` would still send the project token and the phone's network address to PostHog on every launch of a person who said no, and the old Verify (a), "zero requests after Not now", could never pass. The client is made the first time consent is granted, never before (decision 4).
4. **What the filter must keep.** The SDK adds `$geoip_disable: true` in `prepareMessage` and the session-replay debug properties in `processBeforeEnqueue`, both before `before_send` runs, and sets `$process_person_profile` from `personProfiles` in `capture`. A filter that drops `$geoip_disable` turns the location lookup back on, and one that drops `$process_person_profile` lets PostHog build person profiles. So the filter sets both on every event itself (decision 5). Nothing is added to an event after `before_send`, and the batch carries the token as `api_key` beside the events, not inside them.
5. **Opt-out keeps the queue, and reset keeps it too.** `optOut()` only sets a stored flag; `flush()` does not check it, so events captured before the switch went off would still be sent. `reset()` gives a new anonymous id and clears every stored value but the queue, which includes the opt-in flag and the super properties. So turning sharing off also empties the queue (`setPersistedProperty(PostHogPersistedProperty.Queue, null)`, public in 4.85.1), and a reset is followed by applying the device's consent again (decisions 9 and 10).
6. **`screen(name)` registers `$screen_name` for the session**, so every later event carries the last screen's name. It is allowed only when it is a tracked screen (decision 7).
7. **Lifecycle events.** With `captureAppLifecycleEvents`, the SDK sends "Application Opened" (with `url`: the link that opened the app, which in Expo Go is the dev server's address on your network), "Application Became Active" and "Application Backgrounded". "Application Installed" and "Application Updated" need `$app_build` and `$app_version`, which the app does not give the SDK, so they never fire. The filter drops `url`.
8. **The old catalog did not match the app.** The speeds are `PlaybackRate` (0.8, 1 and 1.2, not 0.75 to 1.5); the middle slot is `"afternoon"` (`TimeSlot`), not `"midday"`; `AmbientSound`, `PurchaseErrorCode` and `PackageKind` are the real unions. `entry_submitted` is gone: a reflection is saved to the outbox first (step 24) and may be screened as a crisis later, so the event is `reflection_ready`, sent by the sync engine's `finished` event only for a non-crisis entry. Length buckets and "percent listened" are gone: they add nothing a product decision needs and describe a person's prayer. Steps 29b and 31 added `prayer_removed`, `reflection_deleted` and `data_export_requested`; `reflection_deleted` loses `had_audio`, which Prayers cannot know without another read. `entry_failed` carries only the codes `syncPolicy.ts` marks `needs_action`.
9. **Storage and device data.** The SDK keeps its state (the anonymous id, the opt-in flag, the super properties and the queue) in one storage key; the app passes `AsyncStorage` as `customStorage`, so nothing lands in the document folder. `expo-device` is installed, so the SDK adds the model name and maker; with the screen size, the locale and the time zone these are dropped by the filter. Kept: the OS, its version and the device type.
10. **What the stores will ask.** Apple counts the random install id as an identifier (Device ID) as well as Usage Data (Product Interaction); Google Play counts it under "Device or other IDs" beside "App activity, App interactions". PostHog processes the events for the app as a service provider, which Play's form does not count as sharing. The answers are in section 8.
11. **The privacy draft overclaims.** `docs/privacy-policy.md` section 1.4 promises "a rough length range" and "how much of a devotional you listened to" (neither is sent now), and says nothing of the operating system, the random id or PostHog receiving the network address. Section 5.10 replaces it.
12. **No question for people who are already set up.** The old text showed a one-time dialog on Journal to everyone whose consent was unset. V1 has no users yet, and the people who skip the consent step (a returning user who taps "I already have an account" on Welcome) simply stay off, with the Profile switch one tap away: the calm default (decision 11).
13. **No development-only gate.** The old `disabled: __DEV__ && !devStore.analyticsInDev` resets on every reload, so the walk-through's restart checks would pass for the wrong reason. Consent is the only gate, in development too, and every development event carries `build: "development"` so PostHog can filter them out (decision 13).
14. **The SDK runs in Expo Go.** It is plain JavaScript; its ids come from `Math.random` (no `crypto` global), it uses the global `fetch` at call time and React Native's `AppState`, `Dimensions` and `Linking`, and its optional native modules (`react-native-device-info`, `@posthog/react-native-plugin`, `react-native-svg`) are `require`s inside `try`, which Metro allows (`allowOptionalDependencies` is on in Expo's Metro config). Its logger prints nothing unless `debug()` is called, which the app never does.

---

## What you do yourself (read this first)

Nothing here costs money: PostHog's free plan includes 1 million events a month, far more than this app sends, and the walk-through makes no Gemini or Text-to-Speech call. When you do the dashboard steps the implementer guides you one instruction at a time and checks your screenshots. PostHog's labels may differ slightly from the names below: send a screenshot when one does not match.

### Keys and settings (checked by names only, on 2026-10-31)

| file | has now | this step adds |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY` | **`EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN`** and **`EXPO_PUBLIC_POSTHOG_HOST`** (section B) |
| `supabase/functions/.env.local` | (unchanged since step 31) | nothing |

The project token (`phc_…`) is made to ship inside an app, like the Supabase publishable key: it can only send events to your project. It still lives only in `.env.local` (git ignores it), never in a committed file or a chat. **A personal API key (`phx_…`) can read and change your whole PostHog account: never create one for the app, and never put one in any `.env` file.** The app refuses to start in development when it finds one.

### A. The order of work

1. **Before the implementation (you, about 10 minutes):** B below. The implementer checks the two new lines in `.env.local` by name and prefix only and never prints them.
2. The implementer installs the package, builds and proves the code (sections 1 to 7, Part A).
3. **After the build (you):** C below.
4. The implementer asks whether to start the phone walk-through (E).

### B. Create the PostHog project (you, in the browser)

1. Open **https://eu.posthog.com/signup**. This is PostHog's EU Cloud (Frankfurt). EU organizations discard visitors' network addresses by default, and **a project's region can never be changed later**: if you want the US instead, use https://us.posthog.com/signup and say so before the implementation starts (the host in step 7 changes).
2. Sign up with your email (or Google). When asked, name the organization **Gracehush** and the project **Gracehush**.
3. If PostHog asks which products you want, choose **Product analytics** only. If it offers to install a snippet or asks for your framework, skip that step ("I'll do this later", or close it): the app is wired in code.
4. Open **Settings** (the gear at the bottom left), then **Project**, then **General**. Find **IP data capture configuration** and make sure it is set to **discard** client IP data. Send a screenshot of it.
5. On the same page, find **Project token** (it starts with `phc_`) and press its copy button. Do not paste it into the chat.
6. Open `.env.local` in the **app's root folder** (not `supabase/functions/.env.local`) and add these two lines at the end, with your token after the first `=`:

   ```
   EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_your_token_here
   EXPO_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
   ```

   The host has an **`i.`** (`eu.i.posthog.com`): it is where events are sent, not the address you sign in at. Save the file (Ctrl+S) and **close its tab**: VS Code sends a highlighted selection with your next message, and this file holds keys.
7. Tell the implementer "done". It checks only that both names are there, that the token starts with `phc_` and that the host is one of the two allowed.
8. Leave everything else in PostHog as it is. Session replay, surveys, heatmaps and web autocapture are switched off in the app's code and need nothing in the dashboard.

### C. After the build (you)

1. Stop the dev server and start it again with `npx expo start -c` (a new package and new files), then force-quit Expo Go on the iPhone and open the project again.
2. No migration, no `secrets set` and no Edge Function deploy: this step changes nothing on the server.

### D. Before a store build (later, step 35 or the first store upload)

The App Store and Google Play privacy answers in section 8 go into App Store Connect and the Play Console. The implementer writes them out for you; nothing is filled in during this step.

### E. Phone walk-through (iPhone, Expo Go)

Section 7, Part B. You turn the switch on and off, open a few screens, and send two screenshots from PostHog; the implementer reads everything else from the running app.

### F. If something goes wrong: what it means

| what you see | what it means |
| --- | --- |
| A red screen in development: "EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN holds a personal API key" | A `phx_` key is in `.env.local`. Replace it with the project token (B5), then restart (C1). Delete that personal key in PostHog (Settings, your profile, Personal API keys). |
| A red screen: "EXPO_PUBLIC_POSTHOG_HOST must be…" | The host is wrong: it must be `https://eu.i.posthog.com` (or `https://us.i.posthog.com` for a US project), with the `i.`. |
| No "Share Usage Data" switch on Profile, and only 3 onboarding steps | `.env.local` has no token, or the dev server was not restarted with `-c` after the lines were added. |
| The switch is on but PostHog shows no events | Events go out in batches every 30 seconds, when 20 are waiting, or when the app goes to the background. The developer panel's **Flush (dev)** sends them at once. Check that the token belongs to the project you are looking at. |
| PostHog shows a person profile or a location | Should never happen: tell the implementer (the filter sets the flags that prevent both). |

---

## Decisions (approved with this prompt by your "Implement it.")

1. **One package:** `posthog-react-native` **4.85.1**, pinned exactly (`npx expo install posthog-react-native@4.85.1 -- --save-exact`); its own dependencies `@posthog/core` and `@posthog/types` come with it. Nothing else is installed: `expo-file-system`, `expo-device`, `expo-constants` and `@react-native-async-storage/async-storage` are already there, and `expo-application`, `expo-localization`, `react-native-device-info`, `@posthog/react-native-plugin` and `posthog-react-native-session-replay` are not added. No config plugin and no native change: it runs in Expo Go, and `app.json` is untouched.
2. **PostHog EU Cloud**, host `https://eu.i.posthog.com` (section B1).
3. **Two client-safe variables,** `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN` and `EXPO_PUBLIC_POSTHOG_HOST`, read by their full names in `src/constants/env.ts` and checked by the pure `checkAnalyticsEnv` (section 2): both missing is "off" (no consent step, no switch, the app works as before); a `phx_` key, a token that is not `phc_…` or a host that is not one of the two PostHog ingestion hosts is "invalid", which stops the app in development with the message (like a wrong Supabase value) and leaves analytics off in a release build.
4. **The client is made only after consent** (finding 3), once, in `src/services/analytics.ts`, the only file that imports `posthog-react-native`: `defaultOptIn: false` (then `optIn()`), `customStorage: AsyncStorage`, `personProfiles: "never"`, `disableGeoip: true`, `before_send` (decision 5), `captureAppLifecycleEvents: true`, `enableSessionReplay: false`, `preloadFeatureFlags: false`, `disableRemoteFeatureFlags: true`, `sendFeatureFlagEvent: false`, `disableSurveys: true`, `setDefaultPersonProperties: false`, `errorTracking: { autocapture: false }`, `capturePushNotificationSubscriptions: false`, `capturePushNotificationOpened: false`, `flushAt: 20`, `flushInterval: 30_000`. No `PostHogProvider`: the app calls its own functions, and nothing uses the SDK's hooks or autocapture.
5. **The filter** is `sanitizeEvent` in `src/services/analyticsPolicy.ts`, the client's `before_send`: an event that is not in the catalog or the four system events is dropped; a catalog event (or a `$screen`) whose own properties are missing or not valid is dropped; every other property is dropped unless it is one of the common ones (`$lib`, `$lib_version`, `$os`, `$os_name`, `$os_version`, `$device_type`, `$session_id`, `$is_identified` when false, a tracked `$screen_name`, and the super properties `tier`, `app_version` and `build`, each with its own value check); `$set` and `$set_once` are removed; and `$process_person_profile: false` and `$geoip_disable: true` are set on every event (finding 4).
6. **The catalog: seventeen events,** typed in `analyticsPolicy.ts`, the only names `track()` accepts:

   | event | properties | sent when |
   | --- | --- | --- |
   | `onboarding_completed` | `permissions_prompted: boolean` | the person chooses "Share usage data" on the consent step (Allow & Continue was tapped before it, or not) |
   | `reflection_ready` | `input: "text" \| "voice"`, `scripture_verified: boolean`, `has_audio: boolean` | the sync engine's `finished`, for a non-crisis entry only |
   | `entry_failed` | `code: "TOO_SHORT" \| "NO_SPEECH" \| "PAYLOAD_TOO_LARGE" \| "AUDIO_NOT_FOUND" \| "UNREADABLE" \| "OTHER"` | the engine's `settled` with status `needs_action` |
   | `devotional_played` | `rate: PlaybackRate` | the player starts a devotional that was not the last one played (a replay after the end counts again) |
   | `devotional_completed` | `rate: PlaybackRate` | the player reaches the end |
   | `ambient_changed` | `sound: AmbientSound`, `source: "now_playing" \| "profile"` | a different sound is chosen on Now Playing, or saved on Profile |
   | `affirmation_favorited` | `favorited: boolean` | the heart on Journal is saved |
   | `affirmation_notification_opened` | `slot: TimeSlot` | a tapped affirmation notification opens Reflection |
   | `prayer_tracked_changed` | `tracked: boolean` | Reflection's Mark as Prayer Request change is saved |
   | `prayer_marked_answered` | `has_note: boolean` | Prayers saves Mark Answered |
   | `prayer_removed` | `was_answered: boolean` | Remove from Prayers is saved |
   | `reflection_deleted` | `source: "reflection" \| "prayers"` | the server has deleted the reflection |
   | `paywall_viewed` | `source: "profile" \| "limit"` | the Paywall first shows its plans or its "Plans aren’t available" state |
   | `purchase_completed` | `plan: PackageKind`, `trial: boolean` | a purchase gives the plan |
   | `purchase_failed` | `code: PurchaseErrorCode` | a purchase does not (a cancel is `CANCELLED`: behavior, not an error) |
   | `restore_completed` | `found: boolean` | a restore answers (from the Paywall or Profile) |
   | `data_export_requested` | none | the export link is ready |

   The system events are `$screen`, `Application Opened`, `Application Became Active` and `Application Backgrounded`, with no property of their own but `$screen`'s name. No event exists for a crisis entry, Support Resources, signing in or out, Realtime, a recording, the microphone or notifications permission, or the consent itself; and no event carries an id, a title, a verse, a note, a count of words, a time of day or free text.
7. **Screens:** `trackCurrentScreen()` runs on the NavigationContainer's `onReady` and `onStateChange` and sends `$screen` with the route's name only (never its params) for `Journal`, `Prayers`, `Profile`, `NewEntry`, `NowPlaying` and `Paywall`. `Reflection` is not tracked (the same route shows the crisis view, and the navigator cannot tell them apart), and neither are `CrisisResources`, `Onboarding`, `SignIn` and `MainTabs`. The filter drops any other `$screen` too.
8. **Super properties:** `tier` (the entitlement store's plan, when known), `app_version` (`Constants.expoConfig.version`) and `build` (`"development"` or `"release"`), registered after every opt-in and when the plan changes. Nothing else.
9. **Off means off:** turning sharing off calls `optOut()` and empties the SDK's queue, so nothing captured before leaves the phone either (finding 5). The client stays in memory, opted out; after a restart with sharing off no client is made at all.
10. **Sign-out and account deletion:** `signOutCleanup()` ends with `await resetAnalytics()`: `reset()` (a new anonymous id for the next account on the phone), then the device's consent is applied again. Consent belongs to the device, like the reminder times: it lives in the onboarding store, which sign-out keeps. Nothing in PostHog is tied to an account, so account deletion needs nothing more.
11. **Consent UI** (section 5): when `checkAnalyticsEnv` says ok, onboarding gains a fourth step after Permissions, with two buttons of equal weight (both ghost pills) that both finish onboarding, and Profile's "Privacy & account" group gains a "Share Usage Data" switch row first. Without a token neither exists. No dialog for people who never saw the step (finding 12).
12. **The stored answer:** `analyticsConsent: "unset" | "granted" | "declined"` in the onboarding store, persist version 3 (a version 2 save migrates to `"unset"`), with `setAnalyticsConsent(consent)`. Unset counts as no.
13. **No development-only gate** (finding 13).
14. **Crisis rule:** no event name, property or value is about a crisis entry or a support screen; `reflection_ready` skips a crisis entry; Reflection and Support Resources are never tracked; `paywall_viewed` is never sent for the crisis redirect (the Paywall shows nothing of itself for a crisis entry); nothing in the developer panel or a log says "crisis".
15. **Never** `identify`, `alias`, `group`, person properties, feature flags, surveys, session replay, error tracking, logs (`captureLog`), `debug()`, or an analytics log line. The developer panel shows the last events' names and property keys, never a value.
16. **Developer panel** (`__DEV__` only): an "Analytics (dev)" group with one status line (the env check, the consent, whether a client exists and whether it is opted out, how many events are waiting), the last events by name and keys, and **Flush (dev)** and **Reset consent (dev)**.
17. **Haptics:** the Share Usage Data switch ticks `selection`, like Daily Affirmations; the consent step's buttons make none.
18. **Store answers** (section 8) are written into AGENTS.md's "Before a store build" and the report; the privacy draft and the legal brief are updated (section 5.10).

---

## Out of scope

- Session replay, heatmaps, surveys, feature flags, experiments, error and crash tracking, logs, and push-notification analytics.
- Person profiles, `identify()`, and any link between an event and an account.
- Analytics on the server (Edge Functions send nothing to PostHog).
- A consent dialog for people who skipped the onboarding step (finding 12), and a consent banner on any other screen.
- Ad attribution, the iOS App Tracking Transparency prompt and `NSUserTrackingUsageDescription` (nothing here is tracking by Apple's definition).
- The iOS privacy manifest of a development or store build (step 35 checks it).

---

## 0. Before you write code

1. **Baseline, written down before any change** (the numbers after step 33, 2026-10-31; record what you see):
   - `npm run typecheck` and `npm run lint` exit 0; the app-side suites: account 10, billing 24, offline 44 of 44, journal-data 87, notifications 48, prayers 33, deletion 32, profile-sync 88, recording 68, playback 133, ambient 64, realtime 27, parity 7 of 7.
   - Deno and PGlite are not affected (no function, no SQL), so they are not re-run.
   - The release gate prints 4 lines.
2. **The fifteen markers** of finding 2 (`git grep -n "TODO(34)" -- src supabase`), each closed here or explained in the report.
3. **Section B is done:** without your "done" and the screenshot of B4, stop and ask. Then check `.env.local` **by names only**: a script that prints, for each of the two new names, whether it is present, whether the token starts with `phc_` and whether the host is one of the two allowed, and nothing else. **Never print a value, and never search a folder that holds a `.env.local` with a plain `grep`** (search `git ls-files`, or exclude the file).
4. **Red first:** write the new suite (section 7) before the code, run it against the tree as it is, and write down the red numbers.

---

## 1. Install

`npx expo install posthog-react-native@4.85.1 -- --save-exact`. Then `npx expo install --check` and `npx expo-doctor` (the patch drift Expo reports since step 27 is not this step's: report it, change nothing). `git diff --stat -- package.json package-lock.json` shows one line in `package.json` and the three packages in the lockfile; `app.json` is byte-identical. npm writes both manifests with LF: put their CRLF line endings back (as in steps 23, 24 and 30). If npm stops with ERESOLVE (the date picker's optional `react-native-windows` peer), stop and report it; do not reach for `--legacy-peer-deps` without asking.

---

## 2. Env: `src/constants/env.ts` and `.env.example`

Add at the end of `env.ts`, after the RevenueCat block, in its style (`FIX` already exists in the file):

```ts
// PostHog (step 34): the project token (phc_) is made to ship in an app, like the Supabase publishable key, and still lives
// only in .env.local. A personal API key (phx_) can read and change the whole PostHog account and is never used. The host is
// the region's ingestion address, with the i.
export const POSTHOG_PROJECT_TOKEN = process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN ?? "";
export const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "";
export const POSTHOG_HOSTS = ["https://eu.i.posthog.com", "https://us.i.posthog.com"] as const;

export type AnalyticsEnvCheck =
  | { status: "ok"; token: string; host: string }
  | { status: "missing" }
  | { status: "invalid"; message: string };

// Pure, so it can be tried with any value. Both missing is "missing": analytics stay off and the app works as before.
export function checkAnalyticsEnv(token: string, host: string): AnalyticsEnvCheck {
  const projectToken = token.trim();
  const ingestHost = host.trim().replace(/\/+$/, "");
  if (projectToken === "" && ingestHost === "") return { status: "missing" };
  if (projectToken.startsWith("phx_")) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN holds a personal API key (phx_...). Never put one in the app: use the project token (phc_...) from PostHog, Settings, Project, General. ${FIX}`,
    };
  }
  if (!/^phc_[A-Za-z0-9]{20,}$/.test(projectToken)) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN does not look like a PostHog project token (phc_...). ${FIX}`,
    };
  }
  if (!(POSTHOG_HOSTS as readonly string[]).includes(ingestHost)) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_POSTHOG_HOST must be https://eu.i.posthog.com or https://us.i.posthog.com, the region of the PostHog project. ${FIX}`,
    };
  }
  return { status: "ok", token: projectToken, host: ingestHost };
}

export const analyticsEnv = checkAnalyticsEnv(POSTHOG_PROJECT_TOKEN, POSTHOG_HOST);
```

`.env.example` gains the two names with empty values, after the RevenueCat ones.

---

## 3. The policy: `src/services/analyticsPolicy.ts` (new, whole file)

Pure: no PostHog, no React Native. The review typechecked it against the app's real types and ran the checks of section 7 on it.

```ts
import { AMBIENT_SOUNDS, PLAYBACK_RATES } from "@/constants/app";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import type { AmbientSound, PackageKind, PlaybackRate, PurchaseErrorCode, TimeSlot } from "@/types";

// What the app may send to PostHog (step 34), and the filter every event passes on its way out. Pure: no PostHog, no
// React Native. services/analytics.ts is the only caller.

// The needs_action codes of syncPolicy.ts that an entry_failed event may carry; any other code is "OTHER".
export type EntryFailedCode = "TOO_SHORT" | "NO_SPEECH" | "PAYLOAD_TOO_LARGE" | "AUDIO_NOT_FOUND" | "UNREADABLE" | "OTHER";

// The catalog: the only events track() accepts. No event, property or value is about a crisis entry, Support Resources,
// signing in or out, or anything a person wrote; there are no ids, titles, verses, counts of words or free text.
export type AnalyticsEvent =
  | { name: "onboarding_completed"; props: { permissions_prompted: boolean } }
  | { name: "reflection_ready"; props: { input: "text" | "voice"; scripture_verified: boolean; has_audio: boolean } }
  | { name: "entry_failed"; props: { code: EntryFailedCode } }
  | { name: "devotional_played"; props: { rate: PlaybackRate } }
  | { name: "devotional_completed"; props: { rate: PlaybackRate } }
  | { name: "ambient_changed"; props: { sound: AmbientSound; source: "now_playing" | "profile" } }
  | { name: "affirmation_favorited"; props: { favorited: boolean } }
  | { name: "affirmation_notification_opened"; props: { slot: TimeSlot } }
  | { name: "prayer_tracked_changed"; props: { tracked: boolean } }
  | { name: "prayer_marked_answered"; props: { has_note: boolean } }
  | { name: "prayer_removed"; props: { was_answered: boolean } }
  | { name: "reflection_deleted"; props: { source: "reflection" | "prayers" } }
  | { name: "paywall_viewed"; props: { source: "profile" | "limit" } }
  | { name: "purchase_completed"; props: { plan: PackageKind; trial: boolean } }
  | { name: "purchase_failed"; props: { code: PurchaseErrorCode } }
  | { name: "restore_completed"; props: { found: boolean } }
  | { name: "data_export_requested"; props: Record<string, never> };

export type AnalyticsEventName = AnalyticsEvent["name"];
export type AnalyticsProps<N extends AnalyticsEventName> = Extract<AnalyticsEvent, { name: N }>["props"];

// The screens a $screen event may name (route names, never params). Reflection is not one: the same route shows the crisis
// view, and the navigator cannot tell them apart. Support Resources, Onboarding and Sign In are not either.
export const TRACKED_SCREENS = ["Journal", "Prayers", "Profile", "NewEntry", "NowPlaying", "Paywall"] as const satisfies readonly (
  | keyof RootStackParamList
  | keyof MainTabParamList
)[];
export type TrackedScreen = (typeof TRACKED_SCREENS)[number];

// The SDK's own events that may leave the phone, with no property of their own but $screen's name. Application Installed and
// Updated never fire (the build sets no $app_build), and Application Opened's `url` is dropped (in Expo Go it is the dev
// server's address).
export const SYSTEM_EVENTS = ["$screen", "Application Opened", "Application Became Active", "Application Backgrounded"] as const;

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];
// The shape PostHog hands to before_send (its CaptureEvent), written out so this file needs no PostHog import.
export type SendableEvent = {
  uuid?: string;
  event: string;
  properties?: { [key: string]: JsonValue };
  $set?: { [key: string]: JsonValue };
  $set_once?: { [key: string]: JsonValue };
  timestamp?: Date;
};

type Check = (value: unknown) => boolean;
const bool: Check = (value) => typeof value === "boolean";
const oneOf =
  (values: readonly unknown[]): Check =>
  (value) =>
    values.includes(value);
const shortText: Check = (value) => typeof value === "string" && value.length > 0 && value.length <= 64;
// Every value of the union, so a new member is a type error here until it is listed.
const everyKey = <K extends string>(record: Record<K, true>): readonly K[] => Object.keys(record) as K[];

const ENTRY_FAILED_CODES = everyKey<EntryFailedCode>({
  TOO_SHORT: true,
  NO_SPEECH: true,
  PAYLOAD_TOO_LARGE: true,
  AUDIO_NOT_FOUND: true,
  UNREADABLE: true,
  OTHER: true,
});
const PURCHASE_CODES = everyKey<PurchaseErrorCode>({
  CANCELLED: true,
  PENDING: true,
  NETWORK: true,
  NOT_ALLOWED: true,
  ALREADY_OWNED: true,
  UNKNOWN: true,
});
const SLOTS = everyKey<TimeSlot>({ morning: true, afternoon: true, evening: true });
const PLANS = everyKey<PackageKind>({ annual: true, monthly: true });

// Each event's own properties: all of them must be there and valid, or the event is dropped.
const EVENT_PROPS: { [N in AnalyticsEventName]: { [K in keyof AnalyticsProps<N>]-?: Check } } = {
  onboarding_completed: { permissions_prompted: bool },
  reflection_ready: { input: oneOf(["text", "voice"]), scripture_verified: bool, has_audio: bool },
  entry_failed: { code: oneOf(ENTRY_FAILED_CODES) },
  devotional_played: { rate: oneOf(PLAYBACK_RATES) },
  devotional_completed: { rate: oneOf(PLAYBACK_RATES) },
  ambient_changed: { sound: oneOf(AMBIENT_SOUNDS), source: oneOf(["now_playing", "profile"]) },
  affirmation_favorited: { favorited: bool },
  affirmation_notification_opened: { slot: oneOf(SLOTS) },
  prayer_tracked_changed: { tracked: bool },
  prayer_marked_answered: { has_note: bool },
  prayer_removed: { was_answered: bool },
  reflection_deleted: { source: oneOf(["reflection", "prayers"]) },
  paywall_viewed: { source: oneOf(["profile", "limit"]) },
  purchase_completed: { plan: oneOf(PLANS), trial: bool },
  purchase_failed: { code: oneOf(PURCHASE_CODES) },
  restore_completed: { found: bool },
  data_export_requested: {},
};

const SYSTEM_PROPS: Record<(typeof SYSTEM_EVENTS)[number], Record<string, Check>> = {
  $screen: { $screen_name: oneOf(TRACKED_SCREENS) },
  "Application Opened": {},
  "Application Became Active": {},
  "Application Backgrounded": {},
};

// Kept on every event when present and valid. $screen_name is the last tracked screen (the SDK keeps it for the session);
// tier, app_version and build are the app's own super properties.
const COMMON_PROPS: Record<string, Check> = {
  $lib: shortText,
  $lib_version: shortText,
  $os: shortText,
  $os_name: shortText,
  $os_version: shortText,
  $device_type: shortText,
  $session_id: shortText,
  $is_identified: (value) => value === false,
  $screen_name: oneOf(TRACKED_SCREENS),
  tier: oneOf(["free", "trial", "pro"]),
  app_version: (value) => typeof value === "string" && /^\d{1,4}(\.\d{1,4}){0,3}$/.test(value),
  build: oneOf(["development", "release"]),
};

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function ownChecks(name: string): { checks: Record<string, Check>; required: boolean } | null {
  if (has(EVENT_PROPS, name)) {
    return { checks: EVENT_PROPS[name as AnalyticsEventName] as Record<string, Check>, required: true };
  }
  if (has(SYSTEM_PROPS, name)) {
    return { checks: SYSTEM_PROPS[name as keyof typeof SYSTEM_PROPS], required: name === "$screen" };
  }
  return null;
}

// PostHog's before_send. An event that is not in the catalog or the system list is dropped; so is a catalog event (or a
// $screen) whose own properties are missing or not valid. Every other property goes unless COMMON_PROPS keeps it, and the two
// flags PostHog reads to skip a person profile and the IP's location are set on every event, whatever came in.
export function sanitizeEvent(input: SendableEvent): SendableEvent | null {
  const own = ownChecks(input.event);
  if (own === null) return null;
  const source = input.properties ?? {};
  for (const key of Object.keys(own.checks)) {
    const ok = has(source, key) && own.checks[key](source[key]);
    if (!ok && own.required) return null;
  }
  const properties: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(source)) {
    const check = has(own.checks, key) ? own.checks[key] : has(COMMON_PROPS, key) ? COMMON_PROPS[key] : undefined;
    if (check !== undefined && check(source[key])) properties[key] = source[key];
  }
  properties.$process_person_profile = false;
  properties.$geoip_disable = true;
  return { ...input, properties, $set: undefined, $set_once: undefined };
}

// A tracked screen's name, or null for a route that is never sent.
export function screenToTrack(routeName: string | undefined): TrackedScreen | null {
  return (TRACKED_SCREENS as readonly string[]).includes(routeName ?? "") ? (routeName as TrackedScreen) : null;
}

// syncPolicy's needs_action codes as an entry_failed code.
export function toEntryFailedCode(code: string | null): EntryFailedCode {
  return (ENTRY_FAILED_CODES as readonly string[]).includes(code ?? "") && code !== "OTHER"
    ? (code as EntryFailedCode)
    : "OTHER";
}
```

---

## 4. The client: `src/services/analytics.ts` (new, whole file)

The only importer of `posthog-react-native`. The review typechecked it against PostHog 4.85.1's type files (a wrong option, method or enum name fails); the real installed package is the judge.

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { PostHog, PostHogPersistedProperty } from "posthog-react-native";

import { analyticsEnv } from "@/constants/env";
import { navigationRef } from "@/navigation/navigationRef";
import {
  sanitizeEvent,
  screenToTrack,
  toEntryFailedCode,
  type AnalyticsEventName,
  type AnalyticsProps,
  type JsonValue,
  type SendableEvent,
} from "@/services/analyticsPolicy";
import { subscribe as subscribeToSync } from "@/services/syncEngine";
import { useEntitlementStore } from "@/store/entitlementStore";
import { useOnboardingStore } from "@/store/onboardingStore";
import { usePlayerStore } from "@/store/playerStore";

// Product analytics (step 34): PostHog, only after the person said yes, and only events from the catalog in
// analyticsPolicy.ts. The client is made the first time consent is granted, never before: the SDK asks PostHog for its
// remote config as soon as a client exists, opted out or not, so a person who never said yes never reaches PostHog. This is
// the only file that imports posthog-react-native.

let client: PostHog | null = null;
let started = false;
// The route the last state change showed, tracked or not, so a return to the same tab after Reflection counts again.
let lastRoute: string | null = null;
// The devotional whose first play was sent; a replay after the end counts as a new play.
let playedEntryId: string | null = null;
// Development only: what the last events looked like when they left the filter, by name and property keys, never a value.
const recent: { name: string; keys: string[] }[] = [];

function consented(): boolean {
  return analyticsEnv.status === "ok" && useOnboardingStore.getState().analyticsConsent === "granted";
}

function beforeSend(event: SendableEvent): SendableEvent | null {
  const out = sanitizeEvent(event);
  if (__DEV__ && out !== null) {
    recent.unshift({ name: out.event, keys: Object.keys(out.properties ?? {}).sort() });
    recent.length = Math.min(recent.length, 20);
  }
  return out;
}

function makeClient(token: string, host: string): PostHog {
  return new PostHog(token, {
    host,
    // Off until optIn(): the line of defence if a client ever existed without consent.
    defaultOptIn: false,
    customStorage: AsyncStorage,
    personProfiles: "never",
    disableGeoip: true,
    before_send: beforeSend,
    captureAppLifecycleEvents: true,
    enableSessionReplay: false,
    preloadFeatureFlags: false,
    disableRemoteFeatureFlags: true,
    sendFeatureFlagEvent: false,
    disableSurveys: true,
    setDefaultPersonProperties: false,
    errorTracking: { autocapture: false },
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    flushAt: 20,
    flushInterval: 30_000,
  });
}

async function applySuperProperties(current: PostHog): Promise<void> {
  const tier = useEntitlementStore.getState().tier;
  await current.register({
    app_version: Constants.expoConfig?.version ?? "0",
    build: __DEV__ ? "development" : "release",
    ...(tier === null ? {} : { tier }),
  });
  if (tier === null) await current.unregister("tier");
}

// Follows the consent: yes makes the client (once) and opts in; no opts out and drops what was still waiting to be sent,
// so nothing leaves the phone after the switch goes off.
function applyConsent(): void {
  if (consented() && analyticsEnv.status === "ok") {
    client ??= makeClient(analyticsEnv.token, analyticsEnv.host);
    void client.optIn();
    void applySuperProperties(client);
    return;
  }
  if (client !== null) {
    void client.optOut();
    client.setPersistedProperty(PostHogPersistedProperty.Queue, null);
  }
}

// The one way an event is sent. A no-op without consent or a token.
export function track<N extends AnalyticsEventName>(name: N, props: AnalyticsProps<N>): void {
  if (client === null || !consented()) return;
  const properties: { [key: string]: JsonValue } = props;
  client.capture(name, properties);
}

// Called by the NavigationContainer on ready and on every state change. Route names only, never params, and only the
// screens analyticsPolicy.ts lists.
export function trackCurrentScreen(): void {
  if (!navigationRef.isReady()) return;
  const route = navigationRef.getCurrentRoute()?.name ?? null;
  if (route === lastRoute) return;
  lastRoute = route;
  const screen = screenToTrack(route ?? undefined);
  if (screen === null || client === null || !consented()) return;
  void client.screen(screen);
}

// Once, from App.tsx. Nothing happens until the onboarding store has loaded the saved consent.
export function startAnalytics(): void {
  if (started) return;
  started = true;
  useOnboardingStore.subscribe((state, previous) => {
    if (state.analyticsConsent !== previous.analyticsConsent) applyConsent();
  });
  useEntitlementStore.subscribe((state, previous) => {
    if (state.tier !== previous.tier && client !== null && consented()) void applySuperProperties(client);
  });
  subscribeToSync((event) => {
    if (event.type === "finished" && !event.isCrisis) {
      track("reflection_ready", {
        input: event.inputType === "audio" ? "voice" : "text",
        scripture_verified: event.scriptureVerified,
        has_audio: event.hasAudio,
      });
    } else if (event.type === "settled" && event.status === "needs_action") {
      track("entry_failed", { code: toEntryFailedCode(event.code) });
    }
  });
  usePlayerStore.subscribe((state, previous) => {
    if (state.status === "playing" && previous.status !== "playing" && state.entryId !== null && state.entryId !== playedEntryId) {
      playedEntryId = state.entryId;
      track("devotional_played", { rate: state.rate });
    } else if (state.status === "ended" && previous.status !== "ended") {
      playedEntryId = null;
      track("devotional_completed", { rate: state.rate });
    }
  });
  if (useOnboardingStore.persist.hasHydrated()) applyConsent();
  else useOnboardingStore.persist.onFinishHydration(() => applyConsent());
}

// Sign-out and account deletion (signOutCleanup, last): the next account on this phone gets a new anonymous id. reset()
// also clears the opt-in and the super properties, so the device's consent is applied again. What was already waiting to be
// sent stays, under the old id.
export async function resetAnalytics(): Promise<void> {
  lastRoute = null;
  playedEntryId = null;
  if (client === null) return;
  client.reset();
  applyConsent();
}

export type AnalyticsSummary = {
  env: string;
  consent: string;
  client: boolean;
  optedOut: boolean | null;
  queued: number;
  // The last 8 characters of the random id made on the phone (its first characters are a timestamp, the same for two ids
  // made close together), so a sign-out can be seen to change it. Nothing else of the id is shown.
  idTail: string | null;
  recent: string[];
};

// The developer panel's "Analytics (dev)" group: names, keys, counts and the id's tail, never a value.
export function getAnalyticsSummary(): AnalyticsSummary {
  return {
    env: analyticsEnv.status,
    consent: useOnboardingStore.getState().analyticsConsent,
    client: client !== null,
    optedOut: client === null ? null : client.optedOut,
    queued: client === null ? 0 : (client.getPersistedProperty<unknown[]>(PostHogPersistedProperty.Queue) ?? []).length,
    idTail: client === null ? null : client.getDistinctId().slice(-8),
    recent: recent.map((entry) => `${entry.name} [${entry.keys.join(", ")}]`),
  };
}

export async function flushAnalytics(): Promise<void> {
  await client?.flush();
}
```

---

## 5. Wiring

Each file keeps its line endings (count `\r` before editing, as AGENTS.md says).

### 5.1 `App.tsx`

- `import { analyticsEnv } from "@/constants/env"` beside `supabaseEnv`, and `import { startAnalytics, trackCurrentScreen } from "@/services/analytics"`.
- Beside the Supabase check: `if (__DEV__ && analyticsEnv.status === "invalid") throw new Error(analyticsEnv.message);` (a release build keeps analytics off instead).
- `useEffect(() => startAnalytics(), [])` beside `startNotificationRouting()`.
- The NavigationContainer calls both on ready and on every state change: `onReady={onNavigationChange}` and `onStateChange={onNavigationChange}`, with a module-level `function onNavigationChange() { openPendingTap(); trackCurrentScreen(); }`.

### 5.2 `src/services/syncEngine.ts`: the `finished` event carries three facts

`{ type: "finished"; clientEntryId: string; entryId: string; isCrisis: boolean; inputType: InputType; scriptureVerified: boolean; hasAudio: boolean }`, emitted in `applySuccess` from `outcome.entry`: `inputType: outcome.entry.inputType`, `scriptureVerified: outcome.entry.scripture?.verified === true`, `hasAudio: outcome.entry.devotional?.audioPath != null`. The other listeners (`useJournalHome`, `affirmationScheduler`) read only the old fields.

### 5.3 `src/store/onboardingStore.ts`: version 3

- `analyticsConsent: "unset" | "granted" | "declined"` in the state, the persisted fields (`partialize`) and `getInitialData()` (`"unset"`), so the dev reset clears it.
- `setAnalyticsConsent: (consent: "granted" | "declined") => void`.
- `version: 3`; `migrate`: a version 2 save gets `analyticsConsent: "unset"` (the version 1 path stays as it is); `merge` keeps `"granted"` or `"declined"` and reads anything else as `"unset"`.
- Export the type `AnalyticsConsent`.

### 5.4 `src/screens/onboarding/OnboardingScreen.tsx`: the consent step

- `const STEP_COUNT = analyticsEnv.status === "ok" ? 4 : 3;` (the dots and "1 of 4" follow it).
- The Permissions step's two actions no longer finish onboarding themselves: after the requests (Allow & Continue) and on Maybe later they call `afterPermissions()`, which goes to step 3 when `STEP_COUNT === 4` and calls `completeOnboarding()` otherwise. Android back on step 3 returns to Permissions, which asks again only for a permission that is still undetermined.
- **Step 3**, built only from what the Permissions step already uses: the eyebrow, the `text-headline-lg` title, the `text-body text-mauve` subtitle, two cards in the permission-card pattern (an icon in a 48dp blush circle, a `text-label-lg` title and a `text-body text-mauve` body) and the blush privacy line, with the copy of 5.6. Icons: `{ ios: "chart.bar", android: "bar_chart" }` and `{ ios: "lock", android: "lock" }`.
- Its footer is two `PrimaryButton`s with `tone="ghost"`, the same size, 12dp apart: "Share usage data" and "Not now". Neither is plum: the two choices must look equal (no dark pattern). Both call `chooseAnalytics(consent)`: `setAnalyticsConsent(consent)`; for `"granted"`, `track("onboarding_completed", { permissions_prompted: useOnboardingStore.getState().permissionsPromptedAt !== null })`; then `completeOnboarding()` (the navigator removes the screen, so nothing comes after it). No haptic.
- At 320dp and font scale 1.3 the step scrolls, the two buttons stay pinned and whole, and every touch target is at least 44.

### 5.5 `src/screens/profile/ProfileScreen.tsx`: the switch

In the "Privacy & account" group, first, only when `analyticsEnv.status === "ok"`: a `SettingsRow` in the pattern of the Daily Affirmations row, with icon `{ ios: "chart.bar", android: "bar_chart" }`, the title and subtitle of 5.6, a display-only `Switch` (`trackColor`, `thumbColor`, `ios_backgroundColor` as there) whose value is `useOnboardingStore((state) => state.analyticsConsent === "granted")`, and `onPress`: `haptics.selection()` then `setAnalyticsConsent(sharing ? "declined" : "granted")`. `accessibilityRole="switch"`, the title as its label, the subtitle as its hint and `accessibilityState={{ checked: sharing }}`. It saves on the phone only, so it never fails and has no notice.

### 5.6 `src/constants/copy.ts`

Typographic punctuation (’), sentence case for strings that render uppercase:

- `copy.onboarding.analytics`: `eyebrow` "Your choice"; `title` "Help improve Gracehush?"; `subtitle` "Share anonymous usage data, like which features you use. The app works the same either way."; `sharedTitle` "What’s shared"; `sharedBody` "Which features you use, your plan and the app version. Not tied to your name or email."; `neverTitle` "Never shared"; `neverBody` "Your words, prayers, recordings, name or email."; `note` "You can change this anytime in Profile."; `share` "Share usage data"; `notNow` "Not now".
- `copy.profile.analytics`: `title` "Share Usage Data"; `subtitle` "Anonymous. Never your words, prayers or recordings."

### 5.7 The call sites (the fifteen markers)

Import `track` from `@/services/analytics`. Remove each `TODO(34)` comment as its call goes in.

- **`src/hooks/usePaywall.ts`** (two markers in `noticeForPurchase`, which stays pure: remove its two comments). In `purchase`, directly after `const result = await purchasePackage(selectedId);` and **before** the `mounted` check (a purchase that finishes after the screen closed still happened): `if (!result.ok) track("purchase_failed", { code: result.code }); else if (selectedKind !== undefined) track("purchase_completed", { plan: selectedKind, trial: result.tier === "trial" });`, where `selectedKind` is `selected?.kind`, read beside `selectedId` and added to the callback's dependencies (it is set whenever `selectedId` is, because both come from `selected`). The ALREADY_OWNED path and `restore` call `restorePurchases()` into a variable first, `if (restored.ok) track("restore_completed", { found: restored.restored })`, then pass it to `restoreOutcome`. The `catch` of `purchase` sends `purchase_failed` with `UNKNOWN`.
- **`src/screens/paywall/PaywallScreen.tsx`**: replace the marker at 258 with a ref and an effect: when `state.status` is first `"ready"` or `"unavailable"`, `track("paywall_viewed", { source })`, once per screen. Remove the marker at 344 (the purchase is sent from the hook).
- **`src/screens/journal/NowPlayingScreen.tsx:306`**: first in the chip's `onPress`, `if (sound !== ambientSound) track("ambient_changed", { sound, source: "now_playing" });`.
- **`src/screens/profile/ProfileScreen.tsx`**: in `changeAmbient`, read the profile's sound before `await state.save(patch)`, and after a successful save send `ambient_changed` with `source: "profile"` only when `patch.ambientSound` is set and differs from it (a volume change is not an event); in `restore`, `if (result.ok) track("restore_completed", { found: result.restored });` at the marker; after a successful export, `track("data_export_requested", {})` at the marker.
- **`src/screens/journal/ReflectionScreen.tsx`**: in `change(tracked)`, after the `await`, `if (result.ok) track("prayer_tracked_changed", { tracked });` (remove the marker before it); the deletion: `useDeleteReflection(() => { track("reflection_deleted", { source: "reflection" }); goBack(); })`, and remove the marker in `onDelete`.
- **`src/screens/prayers/PrayersScreen.tsx`**: after Mark Answered, `if (result.ok)` send `prayer_marked_answered` with `has_note: (values.note ?? "").trim() !== ""` beside `setNotice("marked")`; in `removeNow`, `if (result.ok) track("prayer_removed", { was_answered: prayer.isAnswered });`; the deletion: `useDeleteReflection(() => { track("reflection_deleted", { source: "prayers" }); setNotice("deleted"); })`, and remove the marker in `askDelete`.
- **`src/services/notificationRouting.ts:45`**: `track("affirmation_notification_opened", { slot: tap.slot });` before the `navigate`.
- **`src/hooks/useJournalHome.ts`** (no marker): in `toggleFavorite`, after the save, `if (saved.ok) track("affirmation_favorited", { favorited: next });`.

### 5.8 `src/services/account.ts`

The marker at 130 becomes `await resetAnalytics();`, the last line of `signOutCleanup()`, with a comment: "Analytics (step 34): a new anonymous id for the next account on this phone; the device's consent is applied again."

### 5.9 `src/components/dev/DevToolsPanel.tsx`

An "Analytics (dev)" group, after "Realtime (dev)": the line `analytics: env {ok|missing|invalid} | consent {…} | client {yes|no} | opted out {yes|no|-} | queued {n} | id …{idTail}`, the recent events (name and keys, one per line), **Flush (dev)** (`flushAnalytics()`) and **Reset consent (dev)** (`useOnboardingStore.setState({ analyticsConsent: "unset" })`). The line is read when the panel loads and after each of its buttons; it needs no live subscription.

### 5.10 Docs (drafts for the lawyer)

- **`docs/privacy-policy.md`, section 1.4**, replaced by: "If you choose "Share usage data" (at the end of setup, or later with the Share Usage Data switch in Profile), the app sends PostHog, our analytics provider, anonymous events from a fixed list: which of these screens you open: Journal, Prayers, Profile, New Entry, Now Playing and the plans screen (by name only); that a reflection finished (whether it was spoken or written, whether its passage was confirmed, and whether it has audio) or could not be prepared; that a devotional started or reached its end, and at what speed; that you changed the ambient sound, saved an affirmation, opened an affirmation notification, or tracked, answered or removed a prayer; that you deleted a reflection or asked for an export; that the plans screen opened; and whether a purchase or a restore went through. Each event carries a random ID made on your phone (a new one after you sign out), your plan type, the app version, the phone's operating system and its version, and a session ID. We never send your words, prayers, recordings, gratitude notes, name, email or account ID, or anything that identifies a reflection, and nothing is sent about an entry that shows support resources, or about the support screens. PostHog receives your phone's network address with each request and discards it; location lookup is turned off. PostHog stores the events in the European Union. If you do not choose to share, the app does not contact PostHog at all. You can turn sharing off at any time in Profile: whatever was still waiting on your phone is deleted, and nothing more is sent. **[TODO: PostHog's retention period for these events, and its data processing agreement.]**" The processors table's PostHog row reads "Anonymous usage analytics, stored in the EU", and the summary line at the top stays.
- **`docs/legal-brief.md`:** the analytics row is no longer "planned" (built in step 34, EU region, opt-in, the catalog of section 1.4); question 4 keeps only the Supabase items (the PostHog region is decided); the store-answers line points to AGENTS.md's "Before a store build".

---

## 6. Privacy and safety

- A person who never says yes never reaches PostHog: no client exists (finding 3).
- Every event passes `sanitizeEvent`: only the catalog and four system events, only their own valid properties and the common list, the person-profile and location flags forced, `$set` removed.
- No event exists for a crisis entry or a support screen (decision 14), and nothing in the developer panel or a log says "crisis".
- Turning sharing off stops events at once and deletes what was waiting; signing out gives the next account a new anonymous id.
- The token is public by design; a personal key stops the app in development; nothing logs a value.

---

## 7. Verification

### Part A: automated (offline)

1. `npm run typecheck` and `npm run lint` exit 0.
2. **A new suite, `supabase/tests/analytics/`** (`node --no-warnings supabase/tests/analytics/run.cjs`), with a fake `posthog-react-native` 4.85.1 (a `PostHog` class that records its constructor options and every `optIn`, `optOut`, `capture`, `screen`, `register`, `unregister`, `reset`, `setPersistedProperty`, `getPersistedProperty`, `getDistinctId` and `flush` call, runs `before_send` on what it captures and keeps a queue; `PostHogPersistedProperty` with `Queue: "queue"`), a fake `expo-constants`, a fake `AsyncStorage`, the real onboarding, entitlement and dev stores, a small stand-in for `@/store/playerStore` (a zustand store with `entryId`, `status` and `rate`), a fake `@/services/syncEngine` (`subscribe` and an `emit` for the test) and a fake `@/navigation/navigationRef`. It proves at least:
   - **the policy:** the review's thirteen checks of `sanitizeEvent` (a valid event keeps its props and the allowed SDK props and loses `$set`; unknown events, every SDK event outside the list, and the names `__proto__`, `constructor` and the empty string are dropped; ids, words and device details are dropped; a value outside its list, and a missing property, drop the event; `$screen` keeps only a tracked name and is dropped for `Reflection`, `CrisisResources`, `Onboarding`, `SignIn` and `MainTabs`; the session's `$screen_name` rides along only when tracked; Application Opened loses `url`; the two flags are forced; super properties keep only their own values; `screenToTrack` and `toEntryFailedCode`; the input is not changed);
   - **env:** `checkAnalyticsEnv` answers missing for two empty values, invalid for a `phx_` key, a token that is not `phc_…`, a host without `i.`, a US or EU host with a path, and ok (trimmed, trailing slash removed) for the two hosts;
   - **consent:** with no token, or consent unset or declined at start, **no `PostHog` is ever constructed** and `track` and `trackCurrentScreen` do nothing; consent granted at start (after the store hydrates) makes one client with exactly the options of decision 4, calls `optIn` and registers `app_version`, `build` and the known `tier`; granted later (the Profile switch) makes it then; declined after granted calls `optOut` and `setPersistedProperty("queue", null)`, sends nothing more and makes no second client; granted again opts the same client in;
   - **reset:** `resetAnalytics()` calls `reset()` and then, with consent, `optIn` and `register` again; with consent declined, `optOut` and an empty queue; without a client, nothing;
   - **the engine:** `finished` for a non-crisis entry sends `reflection_ready` with `input` voice or text and the two booleans; a crisis entry sends nothing; `settled` with `needs_action` sends `entry_failed` with the mapped code; any other `settled` status sends nothing;
   - **the player:** the first play sends `devotional_played` once; pause and play again send nothing; the end sends `devotional_completed`; a replay after the end sends `devotional_played` again; another devotional sends it again;
   - **screens:** a state change to Journal sends `screen("Journal")` with no second argument; Reflection and CrisisResources send nothing; the same route twice sends once; a return to Journal after Reflection sends again;
   - **tier:** a plan change registers the new tier; a plan that becomes unknown unregisters it;
   - **the developer summary** holds names, keys, counts and an 8-character id tail only, and `recent` holds no value.
3. **The older suites keep their counts.** `account.ts`, `notificationRouting.ts`, `useJournalHome`, `ReflectionScreen`'s and `PrayersScreen`'s hooks now import `@/services/analytics`, which plain Node cannot load (it imports PostHog and React Native): the journal-data world gets a stand-in for it (recording `track` calls), as it has for Realtime, and so do the offline, profile-sync and notifications worlds. The notifications check at `run.cjs:814` is replaced by one that `notificationRouting.ts` sends `affirmation_notification_opened` with the slot only (`track("affirmation_notification_opened", { slot: tap.slot })`), so that suite stays at 48. Two new checks on the journal-data world (counted in its total, which you report): the heart sends `affirmation_favorited` only after a save that succeeded, and a tapped notification sends its slot and nothing else.
4. **Red first:** the new suite against the tree before the code, with its failures by kind.
5. **Breakages** in a scratch copy, never the repo (the user's dev server would send a broken file to the phone), each caught by a named check: the client made at start whatever the consent; no queue cleared on opt-out; `$geoip_disable` not forced; `$process_person_profile` not forced; an unknown event kept; extra properties kept; Reflection tracked; a crisis `finished` tracked; `resetAnalytics` without applying the consent again; `register` without `tier`; the heart tracked before its save; the notification event carrying the entry id.
6. **Bundles:** `npx expo export` for Android and iOS (one at a time, outside the repo), or the dev bundles from the running server when memory is short. Grep for strings, because function names are minified: the catalog's `"reflection_ready"`, `"devotional_played"` and `"Application Backgrounded"` are present; the SDK's library id `"posthog-react-native"` is present (the package resolved); `"Analytics (dev)"` is present only in a `--dev` bundle. Delete the exports afterwards: they hold the public keys.
7. **Greps:** `posthog-react-native` is imported only by `src/services/analytics.ts`; `src` has no `identify(`, `.alias(`, `.group(`, `captureException`, `captureLog`, `.debug(` or `PostHogProvider`; `git grep -n "TODO(34)"` finds nothing in `src` or `supabase`; the release gate still prints 4 lines.

### Part B: the phone walk-through (iPhone, Expo Go)

Before B0: section C (`npx expo start -c`, a force-quit and a reopen of Expo Go). The account is the test account on the phone now; the walk-through needs one ready reflection with audio (any of the account's). It costs nothing new: PostHog's free plan, and B5 uses the mock data source, so no Gemini or Text-to-Speech call. Keep Expo Go open and in front for the whole run (iOS pauses the app's JavaScript otherwise, and nothing can be read). The implementer installs a **request recorder** in the running app first (it wraps the global `fetch` and counts requests to the PostHog host by method and the first part of the path, never the token, a body or a header), drives screens through the app's navigation ref where it can, and reads `getAnalyticsSummary()`.

- **B0.** Do: open the app on Journal. Expect: signed in, data source `supabase`, analytics env `ok`, consent `unset`, no client. Read: the stores and the summary.
- **B1.** Do: nothing (the implementer opens Journal, Prayers, Profile, a reflection, Now Playing and back). Expect: **0 requests** to the PostHog host and still no client. Read: the recorder, the summary.
- **B2.** Do: Profile, tap **Share Usage Data** (it turns on), then **Flush (dev)** in the developer panel. Expect: consent `granted`, a client, opted in; requests to the host (the remote config, then a batch). Read: the summary, the recorder (paths only).
- **B3.** Do: nothing (the implementer opens Journal, a reflection, Now Playing, Prayers, Support Resources from Profile, and back to Journal), then Flush (dev). Expect: `$screen` for Journal, Now Playing, Prayers and Profile; **none** for the reflection or Support Resources; every key in the list of decision 5. Read: the summary's recent events.
- **B4.** Do: play a devotional from Reflection's mini player; the implementer moves it to its last seconds. Expect: `devotional_played` once with the speed, then `devotional_completed`. Read: recent events.
- **B5.** Do: on Profile, Data source (dev) **mock** and Next submit (dev) **ready**; the implementer sends one made-up written reflection through the app's own outbox and engine (as in step 32), then sets Next submit **crisis** and sends the made-up crisis sentence of step 21's check. Expect: `reflection_ready` (`input: text`) for the first; **nothing** for the crisis entry (no `reflection_ready`, no `entry_failed`, no `$screen`). Then Data source back to **supabase**. Read: recent events, the engine's `finished` events.
- **B6.** Do: on Now Playing tap **Gentle Piano**, then on Profile choose **Soft Rain** in Ambient Soundscape; put both back. Expect: `ambient_changed` with `now_playing`, then with `profile`. Read: recent events.
- **B7.** Do: tap the heart on Journal's affirmation card, then tap it again. Expect: `affirmation_favorited` true, then false. Read: recent events.
- **B8.** Do: open the Paywall from Profile's plan card. Expect: `paywall_viewed` (`profile`) when the account is free; a Pro account shows "You’re already a Pro member" and sends nothing, by design (then the implementer switches to the mock data source with Mock plan **free** and Next purchase **cancelled**, and you tap the purchase button: `paywall_viewed`, then `purchase_failed` with `CANCELLED`; then back to supabase). Read: recent events.
- **B9.** Do: Profile, tap **Share Usage Data** (it turns off). Expect: consent `declined`, opted out, **0 queued**, and **0 requests** while the implementer opens a few screens for a minute. Then force-quit and reopen Expo Go: still no client. Read: the summary, the recorder (installed again after the restart).
- **B10.** Do: turn Share Usage Data on again, then **Sign Out** and sign in again as the test account (code 424242; the implementer asks first). Expect: the id tail changed, consent still `granted`, opted in. Read: the summary before and after.
- **B11.** Do: in PostHog, open **Activity** (the left menu) and send a screenshot of the newest events; then open one event and send a screenshot of its properties. Expect: only catalog and system events; only the keys of decision 5; no location fields; no person profile. Read: your screenshots.
- **B12.** Do: on Profile, **Reset onboarding (dev)** (it signs out), go through Welcome, Rhythm and Permissions to the new step, send a screenshot, tap **Not now**, then sign in again. Expect: "4 of 4", two buttons that look the same, consent `declined`, no client. Read: the screenshot, the stores, the summary.

**Not part of this walk-through, and why:** Android (the emulator holds your own account); VoiceOver; events while the phone is locked (Expo Go stops a devotional when the phone locks: step 35); a real App Store or Play purchase (step 35); the iOS privacy manifest (step 35); the store forms (section 8).

---

## 8. AGENTS.md updates

- **A new section "Analytics Rules (step 34)"** after Realtime Rules: consent is the only gate and unset is no; no client before consent and why (remote config); the catalog is the only source of events (the seventeen and the four system events, by name); the filter (`sanitizeEvent`) and the two forced flags; the tracked screens and why Reflection is not one; the super properties; off means off (the queue is emptied); sign-out resets the id and applies the device's consent again; consent belongs to the device (the onboarding store); no `identify`, person profiles, flags, surveys, replay, error tracking, logs or `debug()`; no event about a crisis entry or a support screen; the developer panel shows names and keys only.
- **Tech Stack:** a `posthog-react-native` 4.85.1 line (pinned, JavaScript only, runs in Expo Go, no config plugin; `services/analytics.ts` is the only importer). The approved-packages paragraph gains it.
- **Client-safe env vars:** `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN` and `EXPO_PUBLIC_POSTHOG_HOST`, with "a personal API key (`phx_`) never".
- **Screen Specifications:** Onboarding has four steps when a PostHog token is set (the consent step and its two equal buttons); Profile's "Privacy & account" group starts with the Share Usage Data switch.
- **Haptics:** the Share Usage Data switch ticks `selection`.
- **Crisis Safety Rules:** the "no analytics event" bullet points to Analytics Rules.
- **Authentication Rules:** `signOutCleanup()` ends with `resetAnalytics()`.
- **The tree:** `src/services/analytics.ts`, `src/services/analyticsPolicy.ts`, `supabase/tests/analytics/`; the onboarding store is version 3 with `analyticsConsent`; `env.ts` has `checkAnalyticsEnv`; the `finished` sync event carries `inputType`, `scriptureVerified` and `hasAudio`; the developer panel's "Analytics (dev)" group; `ConfirmDialog`'s line no longer says step 34 reuses it (it does not).
- **Before a store build:** the store answers below, and "the token in the build's environment is a `phc_` project token, never a `phx_` personal key".
  - **Apple, App Privacy:** Usage Data → **Product Interaction**, and Identifiers → **Device ID** (the random install id), each collected for **Analytics** only, **not linked** to the person's identity, **not used for tracking**; collected only when the person opts in. No App Tracking Transparency prompt.
  - **Google Play, Data safety:** App activity → **App interactions**, and Device or other IDs → **Device or other IDs**, each **collected**, **not shared** (PostHog is a service provider), **optional** (the person chooses), purpose **Analytics**, encrypted in transit.
- **Linting and Validation:** the new suite's command, with what it fakes.
- **The vendor note "posthog-react-native 4.85.1"** (added in this review) gains what the build confirmed or found different.
- **Build Status & Decisions Log:** a "Step 34 — Analytics" entry in the form of the ones before it (decisions, files, differences from this prompt, measured results, breakages, the walk-through line by line, known limits). Then copy AGENTS.md to `prompts/AGENTS.md`.

Known limits to record: a person who skipped the consent step stays off until they use the Profile switch; the first launch after consent can miss its "Application Opened" (the client is made then); events wait up to 30 seconds on the phone and are lost if the app is deleted first; in development every event carries `build: "development"` and goes to the same project.

---

## 9. Report

Lead with what changed and where, then how to test it. Include: the fifteen `TODO(34)` markers and how each was closed; the package versions installed and anything the installed SDK does differently from findings 3 to 9; the event list as wired; the files created and changed; the test counts before and after, the red numbers and the breakages caught; the walk-through B0 to B12, one line each; what could not be checked and where it can be; the store answers of section 8 for the user to paste; and the notes for later steps:

- **35 (development builds):** check that the iOS privacy manifest covers what this step sends (AsyncStorage's own manifest, the SDK's), and that a store build's environment carries the `phc_` token. Nothing in this step needs the Apple account.

End with the one line from AGENTS.md, "Guided phone walk-through": "Automated checks pass. Shall I start the guided walk-through now (B0 to B12)? Keep Expo Go open on the iPhone, in front and connected to the dev server."
