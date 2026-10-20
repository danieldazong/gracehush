# 05b-dev-builds.md

Read AGENTS.md first and follow it strictly, including "Instructional Memory": the iOS developer account comes last, and my iPhone stays on Expo Go until then.

Set up a **local Android development build** on this Windows PC, so the native modules from step 05 (and the ones later steps add) run in a real app on the emulator instead of Expo Go. Then use it to verify Google sign-in on Android from step 05. This step is tooling only: no screen, copy or feature changes. The iPhone, EAS and the Apple developer account are not part of it: they are the last step (`prompts/35-ios-developer-account.md`). There is no Mac here, so `npx expo run:ios` can never work, and no prompt or reply may tell me to run it.

Docs (fetch each page before using it; use these, not memory):

- Create a development build: https://docs.expo.dev/develop/development-builds/create-a-build/
- `expo-dev-client`: https://docs.expo.dev/versions/latest/sdk/dev-client/
- Android environment on Windows (choose Development build, Local): https://docs.expo.dev/get-started/set-up-your-environment/?platform=android&device=simulated&mode=development-build&buildEnv=local

If a page contradicts this prompt on a command or option, the page wins: tell me.

## What this machine has (checked 2026-10-17)

- Android SDK with platform 36, build-tools 35 and 36, NDK 27.1, CMake 3.22.1, the emulator and accepted licenses. `ANDROID_HOME` is set, Windows long paths are enabled, and about 59 GB of disk is free.
- Only JDK **21** (Temurin). Expo's Windows guide says to use JDK **17**. No Android Studio, no Mac.

## Decisions (made, do not ask me again)

1. **`expo-dev-client`: approved.** Run `npx expo install expo-dev-client`, then `npx expo install --check` and `npx expo-doctor`. List it in the `app.json` plugins only if the dev-client doc's CNG instructions say so. Do not create `eas.json` and do not install or run the EAS CLI: that is the last step.
2. **JDK 17 for the Android build, portable and per command.** Get the latest Temurin 17 Windows x64 zip from the Adoptium API (`https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows` lists the download link and SHA-256). Download into a new empty folder in your scratchpad, verify the checksum, and extract to `C:\Users\PC\.jdks\`. Do not change PATH or the system `JAVA_HOME`: set `JAVA_HOME` only on the build command. If the download fails, tell me, and I will run `choco install -y microsoft-openjdk17` in an elevated PowerShell.
3. **Ports.** Metro for the dev client runs on **8082**, with `adb reverse tcp:8082 tcp:8082`. Never use 8081: that is mine.
4. **My iPhone keeps using Expo Go.** Installing `expo-dev-client` makes `npx expo start` target the dev client by default. Find how to start Expo Go on purpose (`npx expo start --help`, and the key in the Metro terminal). If a `--go` flag exists, add the script `"go": "expo start --go"` to `package.json`, so `npm run go` is my one-command Expo Go start. Put the exact command in your report and in AGENTS.md.

## Steps

### 1. Preflight (read only)

Re-check `java -version`, `ANDROID_HOME`, `adb version`, the AVD `gracehush_test`, free disk (at least 15 GB), and whether `.env.local` has `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (the app will not launch without it). Report anything that differs from the list above.

### 2. Dev client and Android build

1. Install `expo-dev-client` (decision 1), then handle decision 4.
2. Install the JDK 17 (decision 2) and confirm that `java -version` reports 17 under that `JAVA_HOME`.
3. Run `npx expo prebuild --platform android`. It creates the gitignored `/android`. Never edit it by hand: change `app.json` or a plugin, then run `npx expo prebuild --clean`.
4. Print the SHA-1 and SHA-256 of `android/app/debug.keystore`: `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android`, using the JDK 17. I need them for the Google Cloud Android client and the Clerk Android app (step 05 checklist, part B). Android builds are always local, so this is the only Android signing key. Then continue with the build: I can finish part B while it runs.
5. Start the emulator as AGENTS.md "Verifying on this machine" describes, then run `JAVA_HOME=<jdk17> npx expo run:android --port 8082` in the background. Confirm the flags with `--help`. The first Gradle build downloads Gradle and every dependency and compiles C++ on a slow machine, so expect 20 to 40 minutes. Do not stream it: read the log only for `BUILD SUCCESSFUL` or `FAILURE`.
6. If it fails, show me the first real error. Long paths are enabled, so a path-length error is unlikely, and a JDK or toolchain error means the JDK 17 was not picked up. Do not use workarounds such as `--no-daemon` without telling me.
7. On success, the dev client opens on the emulator and connects to Metro on 8082. For later sessions: `npx expo start --dev-client --port 8082`, `adb reverse tcp:8082 tcp:8082`, then open the app. The launcher remembers the last server, or use "Enter URL manually" with `http://127.0.0.1:8082`.

### 3. Verify

```bash
npm run lint
npm run typecheck
npx expo-doctor
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes. Then, with the Android dev client on the emulator:

1. The app loads from Metro on 8082, shows Onboarding, and reaches Sign In. Without the Clerk key it shows the missing-key error: say so.
2. Email sign-in still works (step 05 checks 2 to 4).
3. If part B of the step 05 checklist is done and I added a Google account to the emulator, "Continue with Google" opens the native account picker and signs in. If not, it shows the calm "isn't available" message. Apple is hidden on Android.
4. `adb logcat` shows no native crash at launch.
5. Expo Go still works for my iPhone with the command from decision 4.

When finished, stop your own Metro, the Gradle daemon (`android/gradlew --stop`) and the emulator (`adb emu kill`). Fix every error before finishing. Then list each file created or changed, the package version, the JDK 17 location, the SHA-1 and SHA-256, how long the build took, the Expo Go command, what is verified, and what is waiting on me. Say plainly that nothing was checked on the iPhone.

## AGENTS.md updates

Record these, replacing the text they supersede. Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp` (see "AGENTS.md updates" in `prompts/TEMPLATE.md`):

- Decision Making: add `expo-dev-client` to "Approved so far".
- Tech Stack: replace "No dev client exists yet ..." with: an Android development client exists from step 05b (`expo-dev-client`), and anything that touches a native module is checked on it. The iPhone stays on Expo Go until the last step. Plain UI work still runs in Expo Go (step 05 skips the Clerk native modules there), but `npx expo start` now targets the dev client, so give the Expo Go command from decision 4.
- Architecture tree: a note that `/android` and `/ios` are gitignored prebuild output.
- "Linting and Validation": the line about Expo Go for UI-only changes gets the same `npx expo start` note.
- "Verifying on this machine": the Android local build recipe (JDK 17 per command, `ANDROID_HOME`, `expo run:android --port 8082`, how the dev client reconnects).
- Build Status & Decisions Log: a Step 05b entry with the decisions above, the versions, the build time, what was verified, and what is still open.
