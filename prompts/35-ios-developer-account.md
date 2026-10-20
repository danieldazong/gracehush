# 35-ios-developer-account.md

Read AGENTS.md first and follow it strictly.

**This is the last step. Do not start it until I say the app is built and I ask for it** (AGENTS.md, "Instructional Memory"). Until then my iPhone stays on Expo Go.

Get the app onto my iPhone as a development build through EAS (there is no Mac, so `npx expo run:ios` can never work), then verify everything that only an iOS build can check. This step is tooling and verification only: no screen, copy or feature changes.

Docs (fetch each page before using it; use these, not memory):

- `eas.json`: https://docs.expo.dev/build/eas-json/
- Internal distribution (iPhone): https://docs.expo.dev/build/internal-distribution/
- EAS environment variables: https://docs.expo.dev/eas/environment-variables/
- Create a development build: https://docs.expo.dev/develop/development-builds/create-a-build/
- Sign in with Apple and Google: the two Clerk guides linked from step 05.

If a page contradicts this prompt on a command or option, the page wins: tell me.

## Before you start (mine)

Check that these are true. If any is not, stop and tell me which.

- A **paid Apple Developer Program** membership (Expo: ad hoc distribution requires it, with at most 100 iPhones a year; the only way around it is a local Mac build, which I do not have), an Expo account, and Developer Mode on the iPhone (Settings, Privacy & Security).
- Step 05b is done (`expo-dev-client` is installed).
- The iOS items of the step 05 checklist (part C) are done: the iOS app in Clerk, the Apple SSO connection, the Google iOS OAuth client, Sign in with Apple on the App ID, and the Apple Private Relay email source. All four `EXPO_PUBLIC_CLERK_GOOGLE_*` values, including the iOS client ID and URL scheme, are in `.env.local`. The iOS URL scheme is baked into the app at build time, so building before it exists means building twice.

## Decisions (made, do not ask me again)

1. **`eas.json`: one `development` profile only.** `{ "cli": { "appVersionSource": "remote" }, "build": { "development": { "developmentClient": true, "distribution": "internal", "environment": "development" } } }`. No secrets in it. Preview and production profiles belong to the release work. Run the EAS CLI as `npx eas-cli@latest ...`: never install it globally or as a dependency.
2. **Interactive commands are mine.** You never run `eas login`, `eas init`, `eas device:create`, `eas env:*` or the iOS `eas build`, because they need my logins. You prepare everything and print the exact commands for me.
3. **Build budget.** Expo's pricing docs currently say the free plan has about 15 iOS and 15 Android builds a month, in a low-priority queue. Build for iOS once, and again only when native config or a native package changes. Run `npx expo-doctor` and `npx expo export --platform ios` first, so a build never fails for a reason you could have caught.
4. **Commit first.** EAS packs the project from git (respecting `.gitignore`). Show me `git status --short` and ask me to approve a commit before the build. Never commit without my approval, and never commit `.env.local`, `/android`, `/ios` or `node_modules` (all gitignored).

## Steps

### 1. Prepare

Write `eas.json` (decision 1) and run `npx expo-doctor` and `npx expo export --platform ios --output-dir <a temp folder outside the repo>`. Check the real exit codes.

### 2. Print the commands for me

1. `.env.local` never reaches the EAS builder (gitignored files are not uploaded), and `app.config.ts` runs again there, so the Google values would be empty. Print the commands that put the four `EXPO_PUBLIC_CLERK_GOOGLE_*` values on EAS as **plaintext** variables in the `development` environment, filled in from those four keys in `.env.local` (they are public identifiers; read nothing else from that file): `eas env:set --name ... --value ... --environment development --visibility plaintext`, or the equivalent your installed CLI documents. The Clerk publishable key is not needed on EAS, because a dev build loads its JavaScript from Metro.
2. Print this, in order (PowerShell), with a one-line reason for each:
   ```powershell
   npx eas-cli@latest login
   npx eas-cli@latest init               # links the project and writes extra.eas.projectId into app.json
   npx eas-cli@latest device:create      # open the link or QR on the iPhone and install the profile
   npx eas-cli@latest build --profile development --platform ios
   ```
   Add the iPhone steps: open the finished build's page on the iPhone to install it, then on this PC run `npx expo start --dev-client` and open the app on the iPhone (same Wi-Fi as before).
3. Warn me about the two known delays: a newly added device can make the first build fail for up to 24 to 72 hours on a new Apple membership, and the free queue can be slow.
4. After `eas init`, check that `app.config.ts` still keeps `extra.eas.projectId` (it spreads `config.extra`).

### 3. Verify (mine, on the iPhone)

1. The dev client opens and connects to Metro, and the app reaches Sign In.
2. **Apple:** a new and a returning user both land on Home, cancelling shows nothing, and a "Hide My Email" address still receives the email code.
3. **Google:** completes natively with the iOS URL scheme (no browser), and cancelling shows nothing.
4. Every item that an earlier step logged as "not verified on iOS" in the Build Status & Decisions Log (for example track-player lock-screen playback and RevenueCat sandbox purchases and restore). List them first, then check each one.

Fix every error before finishing. When done, list each file created or changed, what I ran, and what is verified, with anything still failing.

## AGENTS.md updates

Record these, replacing the text they supersede. Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp`:

- Instructional Memory: mark the iOS developer account entry as done, with the date.
- Tech Stack: the iPhone now uses a development build as well.
- Architecture tree: `eas.json`.
- "Verifying on this machine": the EAS iPhone procedure (the interactive commands are the user's, commit first, plaintext EAS variables for build-time values).
- Build Status & Decisions Log: a Step 35 entry with the decisions above, the EAS and package versions, and what was verified on the iPhone.
