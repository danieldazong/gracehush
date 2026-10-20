# 05-clerk-auth.md

Read AGENTS.md first and follow it strictly.

Study the existing Sign In screen, the email sheet, and the mocked `src/services/auth.ts` from step 04. Then replace the mock with real Clerk authentication using a **custom flow**: our own UI, a passwordless email code, native Sign in with Apple (iOS only) and native Google (iOS + Android). Email uses Clerk's **sign-in-or-up** flow, so one entry point serves new and returning users. Follow the Clerk documentation linked below exactly.

Keep the existing UI, copy, and navigation flow intact. The only visible change is that "Continue with Apple" is hidden on Android. If anything else needs a design change, ask me before implementing. Design reference for the unchanged screen: `@prompt_material/02-sign-in.png` (exact sizes are in `prompt_material/02-sign-in.html`, and the PNG is 1.25x).

Docs (fetch each page before coding; use these, not memory). They are the Expo versions of the pages: the generic `/docs/guides/...` URLs serve Next.js code or only a list of links.

- Quickstart, Custom flow tab: https://clerk.com/docs/expo/getting-started/quickstart.md
- Sign-in-or-up, the email flow for this step: https://clerk.com/docs/expo/guides/development/custom-flows/authentication/sign-in-or-up.md
- Email code: https://clerk.com/docs/expo/guides/development/custom-flows/authentication/email-sms-otp.md
- Sign in with Apple: https://clerk.com/docs/expo/guides/configure/auth-strategies/sign-in-with-apple.md
- Sign in with Google: https://clerk.com/docs/expo/guides/configure/auth-strategies/sign-in-with-google.md
- Error handling: https://clerk.com/docs/expo/guides/development/custom-flows/error-handling.md, and the error codes: https://clerk.com/docs/guides/development/errors/frontend-api
- Session tasks: https://clerk.com/docs/expo/guides/development/custom-flows/authentication/session-tasks.md
- `useAuth`: https://clerk.com/docs/expo/reference/hooks/use-auth.md

If a Clerk page contradicts this prompt on an API name or parameter, the page wins: tell me. If it contradicts a product rule here, this prompt wins: tell me.

If Clerk skills are installed (`npx skills add clerk/skills`), use them as well. They are not installed today, so do not install them.

## Decisions (made, do not ask me again)

These are my choices and approvals. Follow them. If one turns out to be impossible, stop and tell me instead of picking another.

1. **Packages: approved.** Run `npx expo install @clerk/expo expo-secure-store expo-apple-authentication expo-crypto @clerk/expo-google-signin` (skip any that are already installed). I also approve using the already-installed `expo-constants` to detect Expo Go. Afterwards run `npx expo install --check` and `npx expo-doctor`, and report what they say. If npm reports a peer-dependency conflict, stop and show it to me. Never use `--force` or `--legacy-peer-deps`.
2. **Identifiers: `com.gracehush.app` for both** `ios.bundleIdentifier` and `android.package`, set in `app.json` (neither exists today). One ID on both platforms keeps the Clerk, Apple and Google setup simple.
3. **Config: keep `app.json` as the base and add an `app.config.ts` that extends it.** `app.config.ts` returns `{ ...config, extra: { ...config.extra, <the four Google values from process.env> } }`, typed with `ExpoConfig` and `ConfigContext` from `expo/config`. Plugins and permissions stay in `app.json`, which is where steps 07, 23, 24, 26, 28 and 30 expect to edit them. The Google IDs are never committed.
4. **Expo Go keeps working.** The app must still launch in Expo Go, so the UI steps keep using Expo Go on my iPhone (the iOS developer account comes last, see AGENTS.md "Instructional Memory") and on the emulator. Detect Expo Go with `Constants.executionEnvironment === ExecutionEnvironment.StoreClient` (`expo-constants`). In Expo Go, `continueWithApple` and `continueWithGoogle` return `NOT_SUPPORTED` with `copy.auth.errors.providerUnavailable` without starting a flow, and `@clerk/expo/google` is never loaded (see Google). Email, the token cache and the navigator work normally there.
5. **No development build in this step.** Do not install `expo-dev-client`, do not create `eas.json`, and do not run `expo prebuild` or `expo run:*`. Apple and Google cannot finish before the Clerk, Google Cloud and Apple setup exists, so a build now would only test an incomplete setup. The Android development build is step 05b (`prompts/05b-dev-builds.md`). The iPhone stays on Expo Go, and iOS builds wait for the last step (`prompts/35-ios-developer-account.md`). Apple and Google therefore stay unverified here: say so plainly in your report.
6. **Keys: check `.env.local` first.** If it contains `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, run the full email verification below. If it does not, finish the code, then lint, typecheck and export. Keep the missing-key error as written (do not weaken it), list every runtime check as unverified, and stop. I create the Clerk app and the key myself.

Do not run `npx clerk config patch` or change any Clerk Dashboard setting yourself. List the dashboard steps for me instead (see "Manual setup checklist").

## Environment and config

- Real values go in `.env.local`, which is already gitignored by `.env*.local`. `.env` stays committed and keeps only its tooling flag (AGENTS.md), so do not touch `.gitignore` for this. Create `.env.example` (committed) with the same key names and empty values:
  ```env
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=
  EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID=
  EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID=
  EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID=
  EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME=
  ```
- Never add a Clerk **secret** key to the app. The publishable key and the client IDs are public by design.
- In `app.json`: keep `expo-splash-screen` and `@react-native-community/datetimepicker`, add the plugins `expo-secure-store`, `@clerk/expo`, `expo-apple-authentication` and `@clerk/expo-google-signin`, and set `ios.usesAppleSignIn: true`, `ios.bundleIdentifier` and `android.package` (decision 2).
- In `app.config.ts`: put the Google client IDs and the iOS URL scheme into `expo.extra` under the names the Google guide shows, read from `process.env`. The iOS URL scheme is what makes Google native on iOS: without it, Google opens a browser.
- `/ios` and `/android` are gitignored prebuild output. Never edit them by hand.

## Provider

`useAuth()` only works inside `ClerkProvider`, so `App.tsx` gets two components:

- `App` (the default export) renders `<ClerkProvider publishableKey={...} tokenCache={tokenCache}>` (`ClerkProvider` from `@clerk/expo`, `tokenCache` from `@clerk/expo/token-cache`) around `AppShell`. If the publishable key is missing, throw a clear error that says to set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in `.env.local`.
- `AppShell` (same file) holds everything `App` holds today: `import "./global.css"` first, the font gate, `SafeAreaProvider`, `NavigationContainer`, `RootNavigator` and `StatusBar`. It also calls `useAuth()`. It returns `null` until the fonts are loaded, and hides the splash in an effect only when the fonts are loaded (or errored) **and** `isLoaded` is true. Clerk loads in parallel with the fonts, and a signed-in user never sees Onboarding flash.
- `SplashScreen.preventAutoHideAsync()` stays at module level. Providers and gates only, no screen UI.

## Replace the mock with a hook (same function signatures)

Clerk's API is hook-based, so move the logic from `src/services/auth.ts` into `src/hooks/useAuthActions.ts`, and delete the mock and its `000000` test path. The hook returns the same functions and `AuthResult` type that the screens already call:

```ts
continueWithApple(): Promise<AuthResult>
continueWithGoogle(): Promise<AuthResult>
sendEmailCode(email: string): Promise<AuthResult>
verifyEmailCode(code: string): Promise<AuthResult>
resendEmailCode(): Promise<AuthResult>
```

- `SignInScreen` (Apple, Google) and `EmailSheet` (email) call `useAuthActions()` instead of importing the service. Delete `goHome()` and the sheet's `onSignedIn` prop, because the navigator switches by itself when the session becomes active. Keep step 04's reset-on-close and late-response guard in the sheet. No visual changes beyond the Apple rule below.
- Keep `AuthResult` and `AuthErrorCode` in `src/types/index.ts`, and add `'RATE_LIMITED'` and `'NOT_SUPPORTED'` to `AuthErrorCode`. A `CANCELLED` result carries an empty `message`.
- Find every `// TEMP(05)` marker (the mock, `goHome`, `onSignedIn`) and resolve it. None may remain.
- Never log an email address or a token. In `__DEV__`, log Clerk error codes and statuses only.
- No `any`. Type caught errors as `unknown` and narrow them.

### Email code (Clerk's sign-in-or-up flow)

Follow the Expo sign-in-or-up guide. It is enumeration-safe: Clerk sends a code whether or not the account exists, and only after the code is verified does it say whether to sign in or to create the account. Do **not** try sign-in first and fall back to sign-up on `form_identifier_not_found`. That reveals which emails have accounts, and it stops working when strict user enumeration protection is on.

1. `sendEmailCode(email)`: trim and lowercase the email. Call `signIn.create({ identifier: email, signUpIfMissing: true })`, then `signIn.emailCode.sendCode()`.
2. `verifyEmailCode(code)`: call `signIn.emailCode.verifyCode({ code })`.
   - Existing user: when `signIn.status` is `complete`, call `signIn.finalize(...)`.
   - New user: the call returns the error code `sign_up_if_missing_transfer` (check it the way the guide does, with `isClerkAPIResponseError` and `error.errors[0]?.code`). That is not an error to show. Call `signUp.create({ transfer: true })`, and when `signUp.status` is `complete`, call `signUp.finalize(...)`.
   - If `signUp.status` is `missing_requirements`, log `signUp.missingFields` in dev, return `UNKNOWN`, and tell me which fields the Clerk instance requires. Do not add fields to the UI and do not call `signUp.update`.
   - If `signIn.status` is `needs_second_factor` or `needs_client_trust`, return `{ ok: false, code: 'UNKNOWN', message: copy.auth.errors.extraVerification }` and log the status in dev. Do not build MFA or device trust.
3. `resendEmailCode()`: call `signIn.emailCode.sendCode()` again. The 30-second cooldown stays in the UI from step 04, and Clerk keeps a code valid for 10 minutes.
4. "Use a different email" needs no hook function, because the next `sendEmailCode` starts a new attempt. Call `signIn.reset()` first only if the guide says it is needed.
5. Read `signIn.status` and `signUp.status` straight after the awaited call, as the guides do. Use the returned `{ error }` and `errors` per the error-handling guide. Do not rely on thrown exceptions alone.

### Apple (iOS only)

- Use `useSignInWithApple()` from `@clerk/expo/apple` and call `startAppleAuthenticationFlow()`. If it returns `createdSessionId`, call `setActive({ session: createdSessionId })`. The hook handles the transfer between sign-in and sign-up, so one flow serves both.
- `ERR_REQUEST_CANCELED` maps to `CANCELLED` (the screen already resets silently).
- In Expo Go, return `NOT_SUPPORTED` before starting anything (decision 4).
- Render "Continue with Apple" only when `Platform.OS === "ios"`. The native flow is iOS-only, and App Store Guideline 4.8 applies only to iOS. On Android the stack shows Google and email only, and the spacing is unchanged with no gap. Do not add a browser-based Apple OAuth flow.
- Apple shares the user's name only on the very first authorization. The documented return value has no name data, so unless the SDK exposes the Apple credential, leave `firstName` empty. Later steps fall back to the email name. Do not add extra Apple calls to get it.

### Google (iOS + Android, native)

- Use `useSignInWithGoogle()` from `@clerk/expo/google` and call `startGoogleAuthenticationFlow()`. If it returns `createdSessionId`, call `setActive({ session: createdSessionId })`.
- `SIGN_IN_CANCELLED` or `'-5'` maps to `CANCELLED`.
- The native Google module does not exist in Expo Go, so never import `@clerk/expo/google` at the top of the file. Choose the hook once at module load: in Expo Go use a small no-op hook, otherwise load the real one with a typed `require("@clerk/expo/google")` (`as typeof import("@clerk/expo/google")`). Both are hooks picked at module load, so the rules of hooks hold. If ESLint objects to the `require`, one inline disable with a one-line justification is allowed here, and nowhere else.
- If the web client ID or the platform's own client ID is missing at runtime, return `NOT_SUPPORTED` with `copy.auth.errors.providerUnavailable` and warn in dev. Never crash.

### Session tasks

Rely on the default `treatPendingAsSignedOut: true`: a session with a pending task counts as signed out, so `isSignedIn` stays false and the user stays on Sign In. Detect a pending task the way the Expo session-tasks guide does. Pass a `navigate` callback to `finalize()` (and to `setActive()` for Apple and Google) that checks `session?.currentTask`. If it is set, log it in dev and return `{ ok: false, code: 'UNKNOWN', message: copy.auth.errors.extraVerification }`. The callback must not navigate, because React Navigation switches screens by itself. Do not build task UIs and do not set `taskUrls`.

### Error mapping

Map Clerk error codes to `AuthErrorCode`:

```txt
sign_up_if_missing_transfer                  → handled (new-user transfer, never shown)
form_param_format_invalid                    → INVALID_EMAIL
form_code_incorrect                          → INVALID_CODE
verification_expired                         → INVALID_CODE (message: copy.auth.errors.codeExpired)
verification_failed (too many failed attempts), too_many_requests,
verification_code_too_many_requests, verification_code_rate_limit_exceeded,
verification_code_too_many_attempts, any HTTP 429   → RATE_LIMITED
network failure (no response, gateway_timeout)      → NETWORK
sign_up_if_missing_not_allowed, sign_up_if_missing_strategy_not_supported,
strategy_for_user_invalid                    → UNKNOWN, and log "instance setting blocks the flow: <code>" in dev
captcha_invalid, session_exists, identifier_already_signed_in,
client_state_invalid, everything else        → UNKNOWN (log the code in __DEV__ only)
```

Confirm the real network error code by running once in airplane mode. Add these to `copy.auth.errors`, next to the existing keys, with exactly this calm text (never show raw Clerk messages to users):

```ts
extraVerification: "We couldn't finish signing you in. Please try another way to continue.",
providerUnavailable: "That sign-in option isn't available right now. Please try another way to continue.",
codeExpired: "That code has expired. Please request a new one.",
rateLimited: "Please wait a moment before trying again.",
```

## Navigation and route guards (React Navigation, not Expo Router)

- Update `RootNavigator` to read `const { isLoaded, isSignedIn } = useAuth()` and render screens **conditionally** (React Navigation's auth-flow pattern). Do not use `navigation.reset` for auth anymore, and drop `initialRouteName`, because the first screen of the active branch is the initial one.
  - While `!isLoaded`, return `null` (the splash screen is still visible).
  - Signed out: `Onboarding` first, then `SignIn`.
  - Signed in: `Home` (still the step 04 placeholder).
- Remove the manual `navigation.reset({ routes: [{ name: 'Home' }] })` call and the `onSignedIn` wiring from Sign In and the email sheet. When the session becomes active, the navigator switches automatically.
- The sheet still calls its own `close()` after a successful verify. The navigator may unmount the screen first, which is fine on Android. I will check on my iPhone that the sheet does not stay on screen.
- Onboarding completion is not persisted until step 07, so every signed-out launch starts at Onboarding. Add `// TODO(07): skip onboarding when completed`.
- On the Home placeholder (it no longer needs the `navigation` prop), replace "Back to sign in (dev)" with a ghost button "Sign out (dev)" that calls Clerk `signOut()` from `useAuth()`. Keep it marked `// TEMP: replaced in 08`. Full sign-out cleanup (stores, SQLite, notifications, player) arrives in step 31. Add `// TODO(31): full sign-out cleanup`.
- Show the signed-in user's primary email in body-sm mauve under the placeholder text, so you can confirm which account is active.

## Manual setup checklist (print this for me, do not do it)

When finished, print this checklist, filled in with `com.gracehush.app` for the bundle ID and package name. Part A is all the email flow needs, so I can do it before you start. Part B is for Google on the Android development build (step 05b). Part C is for the iPhone and waits for the last step.

**A. Needed for email (Expo Go)**

0. Create the Gracehush Clerk application, a development instance. Not Talebrim's: it is a different product with its own users. Copy the publishable key into `.env.local`.
1. **Native applications**: enable the Native API. The iOS and Android app entries can wait for part B.
2. **User & authentication**: require the email address, set **Sign-in with email = Email verification code** and **Verify at sign-up = Email verification code**, and **disable Password**. Do not require username, phone, or name, and **turn off the legal-consent requirement**, because the Sign In screen has no terms checkbox (Terms and Privacy live on the Paywall in step 16). The instance must stay in **Open** access mode, which `signUpIfMissing` needs.
3. **Protect → Protections**: set **User enumeration protection** to Strict. It is recommended, and this flow is built to work with it. Leave bot protection at its default (native clients skip the browser CAPTCHA).

**B. Needed for Google on the Android development build (step 05b)**

4. **Native applications**: add the Android app (package name + the SHA-256 that step 05b prints for the template debug keystore, `android/app/debug.keystore`, which signs every Android build).
5. **SSO connections**: enable Google with custom credentials, using the Web client ID and secret.
6. Google Cloud Console: create the Web OAuth client (paste the Clerk redirect URI into it) and the Android client (package name + the SHA-1 that step 05b prints).
7. Put the Web and Android client IDs in `.env.local`, then I run step 05b (`prompts/05b-dev-builds.md`).

**C. Needed for the iPhone (waits for the last step, `prompts/35-ios-developer-account.md`)**

8. **Native applications**: add the iOS app (App ID Prefix + Bundle ID). **SSO connections**: enable Apple (sign-up + sign-in).
9. Google Cloud Console: create the iOS OAuth client, then put its client ID and the iOS URL scheme in `.env.local`.
10. Apple Developer: enable Sign in with Apple for the App ID, and configure Email Source for Apple Private Relay so Clerk email codes reach "Hide My Email" users.

## Rules

- Do not change any screen design, spacing, or copy except for the new error strings and hiding Apple on Android.
- No password fields, no separate Sign Up screen, no Clerk prebuilt or native components (`AuthView`), no hosted auth.
- Do not touch Supabase, the JWT template, or Third-Party Auth. That is step 17.
- Do not persist anything auth-related yourself. The Clerk `tokenCache` handles session storage in SecureStore.
- Do not install anything beyond decision 1, and no `expo-dev-client`, `eas.json` or Clerk skills (decision 5).

## Verify

```bash
npx expo start -c
npm run lint
npm run typecheck
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes (AGENTS.md, "Linting and Validation"). If `.env.local` has the publishable key (decision 6), also run the checks below in Expo Go on the Android emulator and, if it is on, my iPhone, as AGENTS.md "Verifying on this machine" describes.

1. Cold start while signed out: the splash stays until Clerk loads, then Onboarding appears. Nothing flashes, and `isLoaded` does not flicker during sign-in (if it does, latch it so the app does not remount).
2. **Email (new user):** use a Clerk test address such as `yourname+clerk_test@example.com` with code `424242` in a development instance. The code auto-submits, the transfer runs, and the app switches to Home showing that email.
3. **Email (returning user):** sign out, enter the same email, and verify. It signs in with no transfer and lands on Home.
4. A wrong code shows the rosewood error and clears the boxes. Resend respects the 30-second cooldown. Too many wrong codes show the calm rate-limit message. Airplane mode shows the calm network message.
5. **Apple and Google in Expo Go:** tapping either shows the calm "isn't available" message and nothing crashes. Android shows no Apple button, and the Google and email buttons keep their spacing with no gap.
6. Kill and relaunch while signed in: the app opens straight to Home. "Sign out (dev)" returns to Onboarding.
7. Double-tapping any provider never starts two flows.

Fix every error before finishing. When done, list each file created or changed, the installed Clerk and native package versions, the filled-in manual checklist, any Clerk instance settings that blocked the flow, and everything you could not verify. Say plainly that the real Apple and Google flows were not verified (Google on Android is step 05b, and Apple and iOS Google wait for step 35), and that I still have to check the sign-in sheet closing on my iPhone in Expo Go.

## AGENTS.md updates

Already recorded before this step, so do not duplicate them: the `@clerk/expo` Tech Stack line, the `.env.local` and `.env.example` convention, the sign-in-or-up rule, the iOS-only Apple rule (Authentication Rules and the Sign In spec), and Google client IDs as client-safe env vars.

Record these at the end of this step, replacing the text they supersede. Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp` (see "AGENTS.md updates" in `prompts/TEMPLATE.md`):

- Decision Making: add the Clerk packages and `expo-constants` to "Approved so far".
- Tech Stack: after the dev-client sentence, say that from step 05 Apple and Google need a development build, while email and every other screen still run in Expo Go (the Clerk native modules are skipped there). List the installed packages with versions.
- Architecture tree: `App.tsx` (ClerkProvider and AppShell), `app.config.ts` (extends `app.json`, injects the Google IDs), `hooks/` (`useAuthActions` built), `services/` without `auth.ts`, and the `HomePlaceholderScreen` description.
- Navigation Map "Current state": rewrite it for step 05 (the conditional auth flow, no `navigation.reset`, `goHome()` and `onSignedIn` gone, Home shows the email and "Sign out (dev)").
- Sign In spec: replace "Built in step 04 as UI over a mocked auth service. Clerk replaces the mock in step 05." with a line saying it runs on Clerk.
- "Verifying on this machine": Google on Android is verified on the development build (step 05b), Apple and iOS Google wait for step 35, and email runs in Expo Go.
- Build Status & Decisions Log: a Step 05 entry with the decisions above (including `com.gracehush.app`), package versions, the Clerk instance settings that shaped or blocked the flow, what was verified and what was not, and any open items.
