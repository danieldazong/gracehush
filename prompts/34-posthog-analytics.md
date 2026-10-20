# 34-posthog-analytics.md

Read AGENTS.md first and follow it strictly.

Add privacy-first product analytics with PostHog. Analytics stay off until the user opts in. Events are anonymous, typed, and come from a fixed list; anything not on the list is dropped before sending. Close every `// TODO(34)` in the codebase. No session replay, no error tracking, no feature flags, no `identify()`. The only UI changes are the onboarding consent step and the Profile toggle in section 6. AGENTS.md requires approval before adding dependencies or making native changes.

Docs (source of truth; check exact option names against the installed version's types):

- https://posthog.com/docs/libraries/react-native
- https://posthog.com/docs/references/posthog-react-native
- https://posthog.com/docs/product-analytics/privacy
- https://docs.expo.dev/guides/using-posthog/ (manual setup section only; do NOT run `eas integrations:posthog:connect`)
- https://developer.apple.com/app-store/user-privacy-and-data-use/
- https://developer.apple.com/app-store/app-privacy-details/
- https://support.google.com/googleplay/android-developer/answer/10787469

## 1. Before code

- Run `grep -rn "TODO(34)" src supabase` and list every hit, with its file and the event it describes, in your report. Known ones include: devotional_played { duration_bucket, rate }, devotional_completed, ambient_changed { sound, source: 'now_playing' | 'profile' }, prayer_marked_answered, prayer_tracked_changed. Map every hit to an event in section 3. If a TODO asks for a property that breaks the rules in section 4, write down the safe version you chose.
- Read src/navigation/ (RootNavigator, navigationRef from step 28), App.tsx, src/screens/OnboardingScreen.tsx, src/screens/ProfileScreen.tsx, src/store/onboardingStore.ts, src/services/account.ts (signOutCleanup, deleteAccount), src/constants/env.ts, src/constants/copy.ts, devStore, package.json, app.json/app.config.ts.
- Check the @react-navigation/native version. If it is v7 or later, `captureScreens` must be false and screens are tracked through the navigation container's state change (section 5).
- Ask the user: "Create the PostHog project in the EU region (recommended; it can't be changed later) or the US region?" Wait for the answer.

## 2. Install (approval gate)

Ask: "Add posthog-react-native with `npx expo install posthog-react-native expo-file-system expo-application expo-device expo-localization`?" Some of these may already be installed; report which ones are new. Do not install @posthog/react-native-plugin, posthog-react-native-session-replay or react-native-device-info. If the installed version's docs require the `posthog-react-native/expo` config plugin for basic analytics, ask before adding it, then rebuild (step 05b): `npx expo prebuild --clean`, `npx expo run:android --port 8082`. The iPhone stays on Expo Go for now (AGENTS.md Instructional Memory).

Env: add `EXPO_PUBLIC_POSTHOG_API_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` (`https://eu.i.posthog.com` or `https://us.i.posthog.com`) to .env.local and .env.example, and read them in src/constants/env.ts. If the key is missing, analytics become a silent no-op and the app works normally. The project token (phc\_) is public by design. Never add a personal API key to the app.

## 3. Event catalog: src/analytics/events.ts

One typed union. Nothing else can be sent.

```ts
type LengthBucket = "under_1m" | "1_3m" | "3_5m"; // voice
type TextBucket = "short" | "medium" | "long"; // <200, 200–1000, >1000 chars
type ListenBucket = "under_25" | "25_50" | "50_75" | "75_100"; // percent heard

export type AnalyticsEvent =
  | { name: "onboarding_completed"; props: { reminders_enabled: boolean } }
  | {
      name: "entry_submitted";
      props: {
        mode: "voice" | "text";
        length: LengthBucket | TextBucket;
        offline: boolean;
      };
    }
  | {
      name: "reflection_ready";
      props: {
        mode: "voice" | "text";
        scripture_verified: boolean;
        has_audio: boolean;
      };
    }
  | {
      name: "entry_failed";
      props: {
        code:
          | "NETWORK"
          | "AI_UNAVAILABLE"
          | "NO_SPEECH"
          | "TOO_SHORT"
          | "UNKNOWN";
      };
    }
  | { name: "devotional_played"; props: { rate: 0.75 | 1 | 1.25 | 1.5 } }
  | { name: "devotional_completed"; props: { listened: ListenBucket } }
  | {
      name: "ambient_changed";
      props: { sound: AmbientSound; source: "now_playing" | "profile" };
    }
  | { name: "affirmation_favorited"; props: { favorited: boolean } }
  | {
      name: "affirmation_notification_opened";
      props: { slot: "morning" | "midday" | "evening" };
    }
  | { name: "prayer_tracked_changed"; props: { tracked: boolean } }
  | { name: "prayer_marked_answered"; props: { has_note: boolean } }
  | { name: "paywall_viewed"; props: { source: "profile" | "limit" } }
  | {
      name: "purchase_completed";
      props: { plan: "annual" | "monthly"; trial: boolean };
    }
  | { name: "purchase_failed"; props: { code: PurchaseErrorCode } }
  | { name: "restore_completed"; props: { found: boolean } }
  | { name: "data_export_requested"; props: Record<string, never> };
```

- Use the real step names for AmbientSound, PurchaseErrorCode and the reminder slots. Do not invent values. Adjust `rate` to the speeds step 26 actually offers.
- The catalog must contain no crisis events, no Support Resources events and no sign-in or sign-out events.
- Rejected purchases (CANCELLED) send `purchase_failed` with `code: 'CANCELLED'`. That is behavior data, not an error.

## 4. Client: src/analytics/client.ts

- One `new PostHog(key, options)` at module scope, passed to `<PostHogProvider client={posthog} autocapture={{ captureScreens: false, captureTouches: false }}>`, placed inside NavigationContainer as the docs require.
- Options: `host`, `defaultOptIn: false`, `disableGeoip: true`, `captureAppLifecycleEvents: true` (sent only after opt-in), `enableSessionReplay: false`, `preloadFeatureFlags: false`, `sendFeatureFlagEvent: false`, `disableRemoteFeatureFlags: true` (4.49.0+; if missing, report it), `personProfiles: 'never'` only if the installed types accept it (otherwise report it), no `errorTracking`, `flushAt: 20`, `flushInterval: 30000`, `disabled: __DEV__ && !devStore.analyticsInDev`.
- `before_send` (the last line of defense) does three things:
  - Drops any event whose name is not in the catalog or in the allowed system events ($screen, Application Opened, Application Became Active, Application Backgrounded, Application Installed, Application Updated, $opt_in).
  - Drops any property not listed for that event. Keep only $-prefixed SDK properties, minus $geoip\_\* and $ip.
  - For $screen, keeps only `$screen_name`.
    Write unit tests for all three.
- Export `track<E extends AnalyticsEvent>(name: E['name'], props: E['props'])`, `trackScreen(routeName)`, `setAnalyticsConsent(granted: boolean)`, `resetAnalytics()`. All of them must be safe no-ops when the key is missing or the user hasn't opted in.
- Super properties via `register()`: `tier: 'free' | 'trial' | 'pro'` (refreshed from useEntitlement, step 30) and `app_version`. Nothing else.
- Never call `identify`, `alias`, `group` or `setPersonProperties`.
- Never log event payloads, even in **DEV**, except through `posthog.debug(true)` behind a devStore toggle.

## 5. Wiring

- Screens: navigation container `onStateChange` → `trackScreen(currentRoute.name)`. Route name only, never params (they carry entryId). Skip SupportResources and the crisis state of Reflection.
- Crisis rule: if an entry is crisis, send nothing for it (no entry_submitted after the result is known, no reflection_ready, no entry_failed). Send entry_submitted only after the server result comes back, so a crisis entry never produces an event. Write a test that a crisis mock entry results in zero events.
- Close each TODO(34) with a `track()` call that matches the catalog, and remove the comments.
- Buckets: write `lengthBucket`, `textBucket` and `listenBucket` in src/analytics/buckets.ts, with unit tests at the edges.

## 6. Consent (the only UI change)

- Onboarding: one final step, built only from existing components and theme tokens. Title "Help improve Gracehush?" Body: "Share anonymous usage data, like which features you use. Never your words, prayers or recordings." Buttons: PrimaryButton "Share usage data" and a text button "Not now". Both finish onboarding. Save `analyticsConsent: 'granted' | 'declined'` in onboardingStore with a persist version bump and migration (existing users get `'unset'`).
- Existing users with `'unset'` see the same choice once, as a ConfirmDialog after their next app open on Journal Home. They never see it again, whatever they choose.
- Profile → Privacy & Data: a "Share usage data" switch with helper text "Anonymous. Never your words, prayers or recordings." It calls setAnalyticsConsent.
- `granted` → optIn(). `declined` → optOut().
- No dark patterns: both choices look equally weighted, and the app works the same either way.

## 7. Account lifecycle

- signOutCleanup: `resetAnalytics()` (calls `reset()`) so the next account on this device starts with a new anonymous ID, then re-apply that device's consent choice.
- deleteAccount success: reset(). Nothing in PostHog is tied to the person, so nothing else is needed. Add a line to the step 31 README/privacy notes.
- Update AGENTS.md with a new "Analytics Rules" section: the catalog is the only source of events, no identify, no crisis events, no free text, buckets only, consent required.

## 8. Store disclosures (report only; the user fills them in)

- Apple App Privacy: Usage Data → Product Interaction, used for Analytics, not linked to the user, not used for tracking. No NSUserTrackingUsageDescription and no ATT prompt (per Apple's definition of tracking). Check that the installed SDK and Expo's privacy manifest cover the collected data, and report gaps.
- Google Play Data safety: App activity → App interactions, collected, optional (the user can decline), processed for analytics. Check the current Play guidance on service providers before answering "shared", and report your reading.
- Privacy policy: name PostHog, the region, what is sent and the opt-in. Report that the text is needed; don't write legal copy.

## 9. Verify

`npx expo start -c`, `npm run lint`, `npm run typecheck`, then:
a. Fresh install, "Not now": zero network requests to the PostHog host (check with a proxy or debug logs).
b. Opt in: events arrive in PostHog Activity with only catalog properties.
c. $screen events contain no entryId or params.
d. Crisis mock entry: zero events.
e. An unknown event and an extra property are both dropped by before_send (unit test).
f. Toggle off in Profile: events stop right away.
g. Sign out, then sign in with a second account: a new distinct ID.
h. Offline: events queue and send on reconnect.
i. Missing API key: the app runs with no errors.
j. No /flags, replay or GeoIP data visible on events.
k. A grep for `identify(` and `captureException` in src returns nothing.
l. Every TODO(34) is closed.

Report: the region chosen, packages added, the full event list as wired, the TODO(34) mapping, test results, and the store disclosure text for the user to paste.
