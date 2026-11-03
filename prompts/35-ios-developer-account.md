# 35-ios-developer-account.md

Read AGENTS.md first and follow it strictly.

Get Gracehush onto my iPhone as its own app: a development build made by EAS (there is no Mac here, so `npx expo run:ios` can never work). Then check everything that only a real iOS build can show: Sign in with Apple, native Google sign-in, App Store sandbox purchases with a real free trial, background and lock-screen audio, the app's own notifications, its icon and its name. This step also finishes the one feature that waited for Apple: deleting an account ends Gracehush's access to the person's Sign in with Apple.

**Status of this text.** Reviewed and rewritten on 2026-11-02 from the repo as it stands, the installed packages, a real iOS prebuild in a scratch folder (finding 6), real `npm ci` dry runs (finding 5), harmless probes of Apple's two endpoints with made-up values (finding 8) and the vendors' current pages. Nothing in it has been built or installed yet: no `eas.json`, no `expo-dev-client`, no EAS project, no App Store Connect app. When an answer below differs from what a page says on the day, the page wins: say so in the report. **Implementation note (2026-11-02):** sections 0 to 4 and Part A are done, so the packages, `eas.json` and the revocation code are in the repo; the findings above describe the repo before them, and AGENTS.md's Step 35 log entry has the results.

**Where this stands (2026-11-03).** Built and installed: the code and packages of sections 1 to 4, setup A to G and I, and two EAS builds (2 of the month's 15). The walk-through passed on the iPhone for everything that does not need App Store purchases: B0 to B4, B6 to B16 and B22 to B24 (B5 is optional and was not run). **Still waiting:** section H, because the Paid Apps Agreement needs Apple's tax form, which the user has not been able to submit (its locked first line holds the company's name), and with it B17 to B21, which include the delete dialog's subscription warning. `owner` is out of `app.json` (decision 12, on the user's word). AGENTS.md's Step 35 entry has each check's result and what the run found. Where a line below differs from what was done (`eas-cli@27.2.0` instead of `latest`, B1's launch screen), that entry and this file's later edits are right.

Sources read (fetch again before using a command or a setting, raw Markdown with `curl -sL`, because these pages change):

- https://docs.expo.dev/build/eas-json.md, https://docs.expo.dev/eas/json.md, https://docs.expo.dev/build-reference/app-versions.md
- https://docs.expo.dev/build/internal-distribution.md, https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices.md, https://docs.expo.dev/guides/ios-developer-mode.md
- https://docs.expo.dev/eas/environment-variables/usage.md, https://docs.expo.dev/eas/environment-variables/manage.md, https://docs.expo.dev/eas/environment-variables/faq.md
- https://docs.expo.dev/build-reference/project-upload.md, https://docs.expo.dev/build-reference/easignore.md
- https://docs.expo.dev/build-reference/infrastructure.md (the `sdk-58` image), https://docs.expo.dev/build-reference/ios-capabilities.md
- https://docs.expo.dev/versions/v58.0.0/sdk/dev-client.md, https://docs.expo.dev/develop/development-builds/use-development-builds.md, https://docs.expo.dev/guides/apple-privacy.md
- https://clerk.com/docs/expo/guides/configure/auth-strategies/sign-in-with-apple.md, https://clerk.com/docs/expo/guides/configure/auth-strategies/sign-in-with-google.md, https://clerk.com/docs/guides/configure/auth-strategies/social-connections/apple.md
- https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple, https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens, https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret, https://developer.apple.com/documentation/signinwithapple/communicating-using-the-private-email-relay-service
- https://www.revenuecat.com/docs/projects/connect-a-store.md, https://www.revenuecat.com/docs/getting-started/entitlements/ios-products.md, https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration.md, https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/app-store-connect-api-key-configuration.md, https://www.revenuecat.com/docs/test-and-launch/sandbox/apple-app-store.md, https://www.revenuecat.com/docs/offerings/troubleshooting-offerings.md, https://www.revenuecat.com/docs/platform-resources/server-notifications/apple-server-notifications.md

---

## What was checked when this was written (these shaped the prompt)

1. **The old text had gone stale.** It named `react-native-track-player` (playback is `expo-audio`, step 26) and "Home" (the first signed-in screen is Journal). It said step 05b is done, but 05b never ran, so `expo-dev-client` is not installed and this step installs it. It asked for "all four" Google values, but the iOS build needs three: the Android client needs an Android build's SHA-1. It called this step "tooling only", while AGENTS.md ("Account export and deletion", "Before a store build") and the `TODO(35)` at `supabase/functions/delete-account/handler.ts:103` say this step adds the Sign in with Apple revocation.
2. **Keys.** `.env.local` has no Google value and no App Store RevenueCat key (the table under "What you do yourself").
3. **EAS no longer needs a commit.** In its default workflow "the project archive includes uncommitted and untracked files, except the files that your ignore files exclude", so the old "commit first" rule goes. `.gitignore` decides what stays home. Checked with `git check-ignore`: `.env.local`, `supabase/functions/.env.local`, `*.p8`, `tone-eval/` and `tts-audition/` are excluded. A `.easignore` would replace `.gitignore` altogether, which is how a secret could slip into the upload, so this project has none. `eas build:inspect --stage archive` shows the archive without starting a build.
4. **18 packages are behind Expo's expected versions** (`npx expo install --check`, 2026-11-02), among them `expo` 58.0.19 (expected ~58.0.22), `react-native` 0.88.0 (0.88.1), `expo-audio` 58.0.10 (~58.0.11), `expo-notifications` 58.1.6 (~58.1.7) and `expo-router` 58.0.26 (~58.0.29). `expo-doctor` fails on this, and this is the first build that compiles those native versions, so they are aligned first (section 1).
5. **The first build would have failed at `npm ci`.** The `sdk-58` image (macOS Tahoe 26.6, Xcode 27.1 RC, CocoaPods 1.17.0) ships Node 22.23.3 and npm 10.9.9. Dry run with that npm on today's lockfile: `Missing: @emnapi/core@1.11.3 from lock file`, and the same for `@emnapi/runtime`. npm 11.12.1 refuses it too, so pinning a newer Node does not help; only this PC's npm 11.6.2 accepts it. `npx npm@10.9.9 install --package-lock-only` adds 8 optional wasm entries, removes none and changes no version, and then 10.9.9, 11.12.1 and 11.6.2 all accept the lockfile. The whole upgrade of section 1 was proven this way on a lockfile in a scratch folder: a plain upgrade fails the same dry run, and the heal fixes it.
6. **The native project can be read on this PC before a build is spent.** `expo prebuild` refuses iOS on Windows in one check only, and section 3's script passes that check in a scratch copy, which generated the real `ios/` project. It showed three things to fix before the build, each of which would otherwise cost a second build: the Home Screen name is lowercase (`CFBundleDisplayName` is `gracehush`, from `expo.name`); a `NSFaceIDUsageDescription` nobody uses (the `expo-secure-store` plugin's default); and the local-network keys the dev client needs to find Metro exist only when `expo-dev-client` is listed in `plugins`, which `npx expo install` cannot do because `app.config.ts` is dynamic. With section 2's config the generated project was right (the table in section 3). The same run confirmed: entitlements hold only Sign in with Apple, with no `aps-environment`; the only background mode is `audio`; the app is iPhone only (`TARGETED_DEVICE_FAMILY = 1`) from iOS 16.4; `ASSETCATALOG_COMPILER_APPICON_NAME = expo` with `assets/expo.icon` copied into the project; and the Google URL scheme lands in `CFBundleURLTypes` from the environment variable (`@clerk/expo-google-signin`'s plugin).
7. **`.env.local` and EAS each hold a part.** A development build loads its JavaScript and its manifest from Metro on this PC, so `.env.local` supplies every `EXPO_PUBLIC_*` value the app reads, the client IDs in `Constants.expoConfig.extra` included. Only the iOS URL scheme is baked into the binary, and "EAS CLI itself does not support loading .env files to set environment variables when resolving the app config", so it must be on EAS. The committed `.env` holds empty placeholders; a variable already set in the environment wins over them.
8. **Revocation cannot use a stored token.** Clerk's `useSignInWithApple` uses only `identityToken` and `fullName` (`node_modules/@clerk/expo/dist/hooks/useSignInWithApple.ios.js`) and keeps no Apple token. Apple's TN3194 says revocation needs a refresh token, an access token or an authorization code, and that without one the deletion must still go ahead and the person be directed to revoke by hand. So the app asks Apple for a fresh `authorizationCode` at deletion (`AppleAuthentication.signInAsync`), and the server exchanges it and revokes, signing with a Sign in with Apple key. Probed with made-up values: `/auth/token` answers 400 `{"error":"invalid_grant",...}`, and **`/auth/revoke` answers 200 with an empty body even for a fake token and a fake secret**. So a 200 from revoke proves nothing. The exchange is the only server-side evidence; iOS Settings is the real proof (B23).
9. **A real trial is the first real data for code that has only seen fakes.** Step 30's Test Store products had no trial, and Expo Go never confirms one. App Store Connect's "1 Week" should arrive as `periodUnit: "WEEK"`, `periodNumberOfUnits: 1`, which `services/purchases.ts` turns into 7 days; `tierFromCustomerInfo` and the server's `planFromSubscriber` have never read a real trial. Sandbox time (RevenueCat's table): 1 week is 3 minutes, 1 month 5, 1 year 1 hour, with at most 12 renewals a day.
10. **Apple's paperwork can delay purchases, and only purchases.** RevenueCat: "You will not be able to test in-app purchases until the latest version of this agreement is signed", with tax forms and a bank account whose status is Clear, and up to 24 hours to take effect. `chooseRevenueCatKey` falls back to the Test Store key in a development build that has no `appl_` key, so everything else goes ahead without it.
11. **Products need complete metadata to load in sandbox.** "With complete metadata, products in either state load in sandbox." That includes a review screenshot: "While testing, it's okay to upload an empty 640 x 920 image." The implementer makes that placeholder.
12. **The phone.** Step 34's PostHog event showed iOS 18.7.11, so this iPhone draws the tab bar's frosted blur and not Liquid Glass (the step 08b log guessed iOS 26), and iOS 26 stays unverified. Developer Mode appears only after a development build is installed and opened (Expo's page), so it comes after the install, not before. The sandbox account lives at Settings, Developer, Sandbox Apple Account on iOS 18.
13. **Dev-client defaults get in the way, and they are build-time.** A floating Tools button (Expo Go's covers the header avatar), the dev menu at each launch and an onboarding sheet. The plugin's options switch them off (section 2), and the dev menu stays one shake away.
14. **EAS is already logged in on this PC** (`eas whoami`, 2026-11-02) with two accounts, so `eas init` asks which one owns the project. Running two `npx eas-cli@latest` commands at once failed with `npm error code ECOMPROMISED`: run them one at a time. Latest EAS CLI: 27.2.0. Free plan (expo.dev/pricing): up to 15 iOS builds a month, in a low-priority queue.
15. **Privacy manifest (the note AGENTS.md left for this step).** The app needs no `ios.privacyManifests` for analytics: PostHog is JavaScript only and stores through AsyncStorage, whose package ships its own manifest, and the generated Podfile aggregates the pods' manifests at install (`privacy_file_aggregation_enabled`). The judge is Apple's check on the first TestFlight upload, which is release work.
16. **Image paths.** The old text named none. Every image this step looks at is listed with its real path in section 7, and all of them exist on disk (checked 2026-11-02). `assets/images/player-artwork.png` is gone since 2026-11-02: the lock screen uses the square scenes.

---

## What you do yourself (read this first)

The implementer walks you through these **one instruction per message**: you do it, reply "done" or send a screenshot, and get the next one. Nothing here is needed before the implementer starts: section A onward comes after the code work.

### Keys and settings (checked by names only, on 2026-11-02)

`.env.local`:

| Key | Now | What it is for | Where it comes from |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_`) | set | Sign-in | done |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | set | Data | done |
| `EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY` | set | Purchases in Expo Go | done |
| `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN`, `EXPO_PUBLIC_POSTHOG_HOST` | set | Analytics | done |
| `EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID` | **missing** | Google sign-in | section C |
| `EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID` | **missing** | Google sign-in on iPhone | section C |
| `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME` | **missing, needed before the build** | Baked into the app | section C |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (`appl_`) | **missing** | Real App Store purchases | section H (can come after the build) |
| `EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID` | missing, not needed here | An Android build (step 05b) | later |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | missing, not needed here | A Play Store build | later |

`supabase/functions/.env.local`: everything from earlier steps is set. Three new names come from section A: `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID` and `APPLE_SIWA_PRIVATE_KEY_B64`.

### The order of work

| | Who | What | How long |
| --- | --- | --- | --- |
| 1 | Implementer | Sections 0 to 4 and Part A. It asks you once to stop your dev server. | |
| 2 | You | A Apple Developer, B Clerk, C Google, D `.env.local` | about 45 minutes in one sitting |
| 3 | You, then implementer | E: you link the project, the implementer sets the EAS variables and checks the upload | 5 minutes |
| 4 | You | F: register the iPhone and start the build. This spends 1 of your 15 iOS builds this month. | 10 minutes, then a queue that can take an hour or more |
| 5 | You | G: install the app and connect it | 10 minutes |
| 6 | You | I: the Apple key on the server, and one deploy | 5 minutes |
| 7 | You | H: App Store Connect and RevenueCat. Start any time: banking can take a day, and nothing else waits for it. | about 45 minutes |
| 8 | Both | The walk-through (Part B): you do the physical actions, the implementer reads every result | about 2 hours |

**What it costs:** the build is free within the plan. Sandbox purchases are free and never charge a card. A few reflections cost cents of Gemini credit and fall inside Text-to-Speech's free characters.

### A. Apple Developer (https://developer.apple.com/account)

1. **Your Team ID.** Open **Membership details**. Copy **Team ID** (10 characters) into a private note. It is also called the **App ID Prefix**. Do not put it in any committed file.
2. **The App ID.** Open **Certificates, IDs & Profiles**, **Identifiers**, then the blue **+**. Choose **App IDs**, Continue, **App**, Continue. Description `Gracehush`. Bundle ID: **Explicit**, `com.gracehush.app`. Under **Capabilities** tick **Sign In with Apple**. Do not tick Push Notifications: the app uses local notifications only. In-App Purchase is on by default. Continue, then **Register**.
3. **The key that lets the server end Apple access.** Open **Keys**, then **+**. Key Name `Gracehush Sign in with Apple`. Tick **Sign in with Apple**, press **Configure**, choose `com.gracehush.app` as the **Primary App ID**, **Save**, **Continue**, **Register**. Press **Download**: Apple gives you this file only once. Copy the **Key ID** into your note. Leave the `AuthKey_….p8` file in Downloads and tell the implementer where it is. Never put it in the project, a chat or a screenshot.
4. The fourth Apple item (the email source) comes in section B, because it needs a value from Clerk.

### B. Clerk (https://dashboard.clerk.com, the Gracehush application, the **Development** instance your `pk_test_` key belongs to)

1. **Your iPhone app.** Open **Configure**, **Native applications**. Add an **iOS** application: **App ID Prefix** is your Team ID, **Bundle ID** is `com.gracehush.app`. Save.
2. **Apple.** Open **SSO connections**, **Add connection**, **For all users**, **Apple**. Turn on **Enable for sign-up and sign-in**. The native flow needs no Services ID and no key from you.
3. **The email source, so a "Hide My Email" address receives codes.** On that Apple connection, turn **Use custom credentials** on just to read **Email Source for Apple Private Email Relay**. Copy it, turn the switch off again, and save. Then in Apple Developer open **Services**, **Sign in with Apple for Email Communication**, **Configure**, the **+** next to **Email Sources**, paste the value under **Email Addresses**, **Next**, **Register**, **Done**. A green check means it is verified. If the Development instance shows no such value, tell the implementer: walk-through check B5 is then reported as not verified, and nothing else depends on it.
4. **Google, first half.** Still in **SSO connections**: **Add connection**, **For all users**, **Google**. Turn on both **Enable for sign-up and sign-in** and **Use custom credentials**. Copy the **Authorized Redirect URI** and keep this page open. Your existing account keeps working: Google identifies a person the same way, and Expo Go's browser sign-in moves to your own credentials.

### C. Google Cloud (https://console.cloud.google.com, the same project as the Text-to-Speech service account)

1. **The consent screen.** Open **APIs & Services**, **OAuth consent screen** (Google may call it **Google Auth Platform**). If it asks you to set it up: app name `Gracehush`, your support email, audience **External**, your contact email, Create. Under **Audience**, **Test users**, add the Google account you will test with. It stays in Testing: publishing it is release work.
2. **The Web client.** Open **APIs & Services**, **Credentials**, **Create Credentials**, **OAuth client ID**. Type **Web application**, name `Gracehush Clerk`. Under **Authorized redirect URIs** add the URI from Clerk. **Create**. Copy the **Client ID** and the **Client Secret**.
3. **Back in Clerk's Google page:** paste the Web **Client ID** and **Client Secret**, **Save**.
4. **The iOS client.** **Create Credentials**, **OAuth client ID** again. Type **iOS**, name `Gracehush iOS`, Bundle ID `com.gracehush.app`. **Create**. Copy the **Client ID**. Open the client again to read its **iOS URL scheme**.

Clerk's guide also mentions a Google+ API. If the API Library offers it, enabling it costs nothing. If it does not, skip it and say so.

### D. `.env.local`

Open `.env.local` in VS Code and add these three lines with your values, then press **Ctrl+S** (an unsaved tab looks like a missing file to every check):

```env
EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID=<the Web client ID, ends in .apps.googleusercontent.com>
EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID=<the iOS client ID, ends in .apps.googleusercontent.com>
EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME=<the iOS URL scheme, starts with com.googleusercontent.apps.>
```

The implementer then checks the three by name and shape, never printing a value.

### E. Link the project (PowerShell, in the project folder)

```powershell
npx eas-cli@latest whoami
npx eas-cli@latest init
```

`whoami` lists two accounts. When `init` asks which account owns the project, choose the one you use for your own apps; a project cannot easily move later. Answer **Y** to creating the project. Reply "done": the implementer does the rest of this section.

### F. Register the iPhone and build

```powershell
npx eas-cli@latest device:create
```

Answer **Y** to the account, sign in with your Apple ID when asked, and choose **Website**. Open the link it prints in **Safari on the iPhone** (or scan its QR with the Camera). Tap **Download Profile**, **Allow**, then open **Settings**: **Profile Downloaded** is at the top. Tap **Install**, enter your passcode, **Install**.

Then:

```powershell
npx eas-cli@latest build --profile development --platform ios
```

| It asks | You answer |
| --- | --- |
| Do you want to log in to your Apple account? | **Y**, then your Apple ID, password and the 6-digit code |
| Select a team (if you are on more than one) | Your own team |
| Generate a new Apple Distribution Certificate? | **Y** |
| Generate a new Apple Provisioning Profile? | **Y** |
| Select devices for the ad hoc build | Your iPhone: **Space**, then **Enter** |
| Would you like to set up Push Notifications? (if asked) | **No**: the app uses local notifications only |

Once it says the build is queued you may close the terminal: the build runs on Expo's servers, and the implementer watches it.

Two known delays. On a new or recently renewed Apple membership, Apple can take **up to 24 to 72 hours** to process a newly registered device, and the first build that includes it may fail: wait, then build once more. And the free queue can be slow.

### G. Install and connect

1. On the iPhone open the build's page (the link from the terminal, or the **Install** QR on expo.dev scanned with the Camera) and tap **Install**.
2. Tap the new **Gracehush** icon. An alert asks for **Developer Mode**: press **OK**.
3. **Settings**, **Privacy & Security**, **Developer Mode**, turn it on, **Restart**. After the restart tap **Turn On** and enter your passcode. This happens once per phone.
4. On the PC:
   ```powershell
   npx expo start -c --dev-client
   ```
5. Open Gracehush. When iOS asks about **Local Network**, tap **Allow**. Tap the server in the launcher, or scan the QR from the terminal with the Camera. Same Wi-Fi as before, and that Wi-Fi must be a **Private** network on the PC (AGENTS.md, "Verifying on this machine").

From now on `npx expo start` targets this app. Expo Go still works with `npx expo start -c --go`.

### H. App Store Connect and RevenueCat (https://appstoreconnect.apple.com, https://app.revenuecat.com)

**App Store Connect**

1. **The agreement.** Open **Business**. Accept the **Paid Apps** agreement and complete **Tax Forms** and **Bank Account** until the status is **Active** or **Clear**. This can take up to a day to take effect. If your country or bank blocks it, tell the implementer: purchases stay on the Test Store and walk-through checks B17 to B21 wait. Nothing else is affected.
2. **The app.** **Apps**, **+**, **New App**. Platform iOS. Name `Gracehush` (if taken, `Gracehush: Prayer Journal`). Primary language English (U.S.). Bundle ID `com.gracehush.app`. SKU `gracehush-ios`. Full Access. **Create**.
3. **The subscription group.** In the app: **Subscriptions** (under Monetization or Features), **+**, Reference Name `Gracehush Pro`, Create. Add an **App Store Localization** to the group: English (U.S.), display name `Gracehush Pro`.
4. **Yearly.** In the group, **+**. Reference Name `Gracehush Pro Yearly`. Product ID **`gracehush_pro_yearly`** (a Product ID can never be used again, even after deleting it, so type it carefully). Duration **1 Year**. **Subscription Prices**, **+**, United States, **$59.99**, and accept Apple's prices elsewhere. **Introductory Offers**, **+**: all countries, starting today, no end date, **Free**, duration **1 Week**. **App Store Localization**, **+**: English (U.S.), display name `Gracehush Pro Yearly`, description `Unlimited audio devotionals, billed yearly.` **Review Information**: upload the 640 by 920 placeholder the implementer gives you. **Save**.
5. **Monthly.** The same with Reference Name `Gracehush Pro Monthly`, Product ID **`gracehush_pro_monthly`**, Duration **1 Month**, price **$9.99**, **no** introductory offer, description `Unlimited audio devotionals, billed monthly.`, the same placeholder. **Save**.
6. **The shared secret.** In the app: **General**, **App Information**, **App-Specific Shared Secret**, **Manage**, **Generate**. Copy it for step 9.
7. **The In-App Purchase key.** **Users and Access**, **Integrations**, **In-App Purchase**, **Generate**, name `RevenueCat`. **Download** (once only). Copy the **Issuer ID** at the top of the page. If no Issuer ID shows, do step 8 first.
8. **The App Store Connect key.** **Integrations**, **App Store Connect API**, **Team Keys**, **+**, name `RevenueCat`, access **App Manager**. **Download** (once only). Copy your **Vendor number** from **Payments and Financial Reports**, top left.

**RevenueCat (the Gracehush project, not talebrim)**

9. **The App Store app.** **Apps & providers**, add **App Store**: App name `Gracehush`, Bundle ID `com.gracehush.app`, the shared secret. Upload the In-App Purchase `.p8` and enter the Issuer ID. On its **App Store Connect API** tab upload the other `.p8`, the Issuer ID and the Vendor number. **Save Changes**. Under **Apple Server to Server notification settings** press **Apply in App Store Connect**. Delete both downloaded `.p8` files from Downloads.
10. **The products.** **Product catalog**, **Products**, and import the two from App Store Connect. They show **Ready to Submit** when their metadata is complete.
11. **The entitlement and the offering.** **Entitlements**, `pro`, attach both new products beside the Test Store ones. **Offerings**, `default`: in **`$rc_annual`** add `gracehush_pro_yearly` for the App Store app, in **`$rc_monthly`** add `gracehush_pro_monthly`. The Test Store products stay: Expo Go still uses them.
12. **The key.** **Project settings**, **API keys**, copy the App Store app's public key (it starts with `appl_`). Add it to `.env.local`, Ctrl+S, and restart the dev server:
    ```env
    EXPO_PUBLIC_REVENUECAT_IOS_KEY=<the appl_ key>
    ```
13. **The tester.** In App Store Connect: **Users and Access**, **Sandbox**, **Test Accounts**, **+**. Use a real email address you can read and that is not already an Apple Account (a `+` address on your own mailbox works). Country United States. Then on the iPhone: **Settings**, **Developer**, **Sandbox Apple Account**, and sign in with it. If that row is not there, the first purchase asks for it instead.

### I. The Apple key on the server, and one deploy

Tell the implementer the `.p8` from section A, step 3 is in Downloads, and give it the Team ID and the Key ID in a message marked "for `.env.local` only". It writes the three lines into `supabase/functions/.env.local` by script, printing nothing, and checks them with a test signature. Then, in PowerShell, with your real project ref in place of `<project-ref>` (PowerShell refuses the angle brackets):

```powershell
npx --yes supabase@2.121.0 secrets set --env-file supabase/functions/.env.local --project-ref <project-ref>
npx --yes supabase@2.121.0 functions deploy delete-account --project-ref <project-ref> --use-api
```

Then delete `AuthKey_….p8` from Downloads. If you have not deployed `process-entry` since 2026-10-31, its hook prompt (gen-v2.2) is also waiting: `functions deploy process-entry`, the same way, is your call and this step does not depend on it.

### J. If something goes wrong: what it means

- **The app cannot find the server.** The Wi-Fi is Public on the PC (make it Private), Local Network is off (iPhone Settings, Gracehush, Local Network), or the phone and the PC are on different networks. In the launcher, **Enter URL manually** takes `http://<the PC's address>:8081`.
- **"Unable to install" or an install that never finishes.** The device was not in the build's profile, or Apple is still processing it (24 to 72 hours). `device:create` must come before the build.
- **Build fails at "Install dependencies".** The lockfile drifted again: section 1 step 5 has the fix.
- **Build fails compiling the app icon.** `assets/expo.icon` was refused: section 7 has the fallback.
- **Apple sign-in fails with an audience or client error.** The iOS app is missing from Clerk's Native applications (section B, step 1), or its Team ID or Bundle ID is mistyped.
- **Google: "Access blocked".** Your Google account is not under Test users (section C, step 1).
- **Google does nothing, or Sign In says it is not available.** A value in `.env.local` is missing or the tab is unsaved; the dev server was not restarted after the change. A changed URL scheme needs a new build.
- **The Paywall says plans are not available.** The Paid Apps agreement is not active yet (up to 24 hours), a product's metadata is incomplete, the shared secret or In-App Purchase key is missing in RevenueCat, or the product is not in the `default` offering. The implementer reads the dev panel's `revenuecat key` line first.
- **No trial on the Paywall.** The sandbox account has already used this subscription group: in App Store Connect's Sandbox list clear its purchase history, or make a new tester.

---

## Decisions (approved with this prompt by your "Implement it.")

1. **`eas.json`: one `development` profile.** `{ "cli": { "appVersionSource": "remote" }, "build": { "development": { "developmentClient": true, "distribution": "internal", "environment": "development" } } }`. No secret in it, no `image` (the default `auto` picks `sdk-58`), no `env` block (Clerk's page shows one; a committed file must not hold these values, and the EAS environment does the same job). Preview and production profiles belong to the release work. Run the CLI as `npx eas-cli@latest ...`, one command at a time, never installed globally or as a dependency.
2. **Who runs what.** The user runs `eas init` (it asks who owns the project), `eas device:create` and `eas build` (they ask for an Apple login). Once the user's login is on this PC the implementer may run the commands that need no Apple login and change nothing but this project's variables: `eas env:set`, `eas env:list`, `eas config`, `eas build:inspect` and `eas build:list` / `build:view`. It never reads `~/.expo/state.json`.
3. **Build budget.** One iOS build, and another only when native config or a native package changes. Nothing is built until Part A's checks pass on the final config. A build spends one of about 15 a month.
4. **No commit is needed for a build** (finding 3). Commit and push stay what they have always been: only when the user asks, with the audit under "Committing and publishing". The report says the build was made from an uncommitted tree when it was.
5. **The release gate is not for this build.** It installs only on the user's own iPhone, so it may carry the placeholder constants. A build anyone else can install (TestFlight, the App Store, a Play track) waits until `grep -rnE "TEMP\(|TODO: real" src` prints nothing (AGENTS.md, "Before a store build"). Do not start one, and do not add a profile for one.
6. **Packages.** Approved: `expo-dev-client` (named by this prompt), and aligning every package `npx expo install --check` names on the day (Expo's patch releases, 18 on 2026-11-02). `react-native` stays an exact version. `react-native-purchases` stays 10.16.0 exactly: 11.x waits for a decision of its own (AGENTS.md's vendor note). Nothing else is installed.
7. **App config, all before the first build** so that none costs a second one: `expo.name` becomes `Gracehush` (the slug, the scheme and the bundle ID stay); `ios.infoPlist.ITSAppUsesNonExemptEncryption` is `false` (the app's encryption is HTTPS and expo-crypto's AES over Apple's own CryptoKit, which is what this key means, and EAS would otherwise ask and rewrite the config); `expo-secure-store` gets `faceIDPermission: false` (nothing uses Face ID directly, and Sign in with Apple's own sheet needs no string); `expo-dev-client` is listed with `launchMode: "most-recent"`, `toolsButton: false`, `skipOnboarding: true` and `showMenuAtLaunch: false`. `ios.icon` stays `./assets/expo.icon`.
8. **Sign in with Apple revocation** (the design in section 4, and AGENTS.md's `TODO(35)`). It runs only for an account with an Apple external account, on iOS, in a real build. "Delete forever" brings up Apple's sheet. **Cancel keeps the dialog open and deletes nothing**: a cancelled system sheet in a destructive flow must mean nothing happened. Any other failure, or a different Apple Account on the phone, goes on without a code, because Apple says the deletion must still be fulfilled. The server exchanges the code and revokes, best effort: it never blocks or fails a deletion, and one word goes in the log. The code is never stored, logged or sent anywhere else. The final dialog says so first, and names Settings for the manual route.
9. **Products** (AGENTS.md, Launch pricing, already approved): `gracehush_pro_yearly` at $59.99 with a 1-week free trial, `gracehush_pro_monthly` at $9.99 with none, one subscription group, entitlement `pro`, offering `default` with `$rc_annual` and `$rc_monthly`. The same product ids as the Test Store's, which RevenueCat keeps per app. No price or id goes in code.
10. **Sandbox only.** No TestFlight and no real charge. The webhook already takes both environments.
11. **The walk-through is automated** (the `automated-walkthrough` skill): the implementer installs recorders, drives the screens and flags itself and reads every result; the user does the physical actions. Consent is asked once before B0. No check needs Siri.
12. **`extra.eas.projectId` in `app.json` may be committed** once this step is pushed. It is not on the list of identifying values, it opens nothing without a login (every Expo public project commits it), and moving it out would make `eas` unreliable. If `eas init` also writes `owner` (a username), the implementer flags it before any commit, and the user decides.
13. **Google: the Web and iOS clients now, Android later.** The Android client needs an Android build's SHA-1 (step 05b).
14. **Expo Go stays usable** for what it is good at (`npx expo start --go`), and the iPhone's tests move to the development build for good.

## Out of scope

- A preview or production profile, TestFlight, App Store review, the store listing, `eas submit`, the production Clerk instance, a production Google consent screen: release work ("Before a store build").
- Android builds (step 05b, and only with the user's yes: the emulator holds their account).
- Listening for Apple's `credentialRevokedNotification`. When a person removes Gracehush in iOS Settings, their account and session stay until they sign out. TN3194 asks apps to respond to it, and that is a release-review item for later: it needs the Apple user id checked at launch.
- The `TODO(V2)` items under "Account export and deletion". Any screen or copy change beyond section 4's. The 34b walk-through (it has not been run; B0 and B2 pass over the same screens and do not replace it).
- Keeping the recordings and the database out of iCloud backups (step 24's flagged limit): expo-file-system 58 exposes no attribute for it. Re-read this on the first release pass.

---

## 0. Before you write code

Read: `AGENTS.md` (Instructional Memory; the vendor notes "EAS development build for the iPhone", "Sign in with Apple at account deletion" and "App Store products through RevenueCat"; "Account export and deletion"; Subscription Rules; Audio Rules; Notification Rules; "Guided phone walk-through"; "Verifying on this machine"; "Committing and publishing"), `src/services/account.ts`, `src/api/journalApi.ts`, `src/screens/profile/ProfileScreen.tsx`, `supabase/functions/delete-account/handler.ts`, `supabase/functions/_shared/account/clerk.ts`, `supabase/functions/process-entry/testing/fakes.ts`, `supabase/tests/account/run.cjs`, `supabase/tests/journal-data/world.cjs`.

Run the baseline and write the numbers down: `npm run typecheck` and `npm run lint` exit 0; account 10, billing 24, offline 44 of 44, journal-data 89, notifications 48, prayers 33, deletion 35, profile-sync 91, recording 68, playback 135, ambient 64, realtime 27, analytics 34, parity 7 of 7; Deno main test run 512 and export-data's 23, `deno lint` 110 files, `deno fmt --check` 127; the release gate prints 4. One at a time: with the dev server up this host has about 2 GB free. If any number differs, find out why before going on.

## 1. Dependencies

1. **Ask the user to stop their dev server** (npm cannot replace files Metro holds on Windows), then wait for port 8081 to free. Never stop it yourself.
2. Run `npx expo install --check` and take its list as the day's truth.
3. Install exactly that list with npm, not `npx expo install` (which can try to write `expo-router`'s plugin back into the config):
   ```bash
   npm install --no-audit --no-fund <each package>@<expected range>
   npm install --no-audit --no-fund --save-exact react-native@<expected version>
   ```
   Then read the now-expected `expo-dev-client` from `node_modules/expo/bundledNativeModules.json` (~58.0.18 on 2026-11-02) and install it the same way.
4. If npm answers ERESOLVE (the date picker's optional `react-native-windows` peer): `--legacy-peer-deps` once, then a plain `npm install` to heal. A lockfile left in the legacy state fails `npm ci`.
5. **Heal the lockfile for the builder's npm.** Read the `sdk-58` image's npm from the infrastructure page (10.9.9 on 2026-11-02), then:
   ```bash
   npx --yes npm@10.9.9 install --package-lock-only --ignore-scripts --no-audit --no-fund
   ```
6. npm writes LF: put back CRLF in `package.json` and `package-lock.json`. `git diff --stat` must show only real changes.
7. Gates, in a scratch copy of the two files (`npm ci --dry-run` needs no `node_modules`):
   ```bash
   npx --yes npm@10.9.9 ci --dry-run --ignore-scripts --no-audit --no-fund    # the builder
   npx --yes npm@11.12.1 ci --dry-run --ignore-scripts --no-audit --no-fund
   npm ci --dry-run --ignore-scripts --no-audit --no-fund                     # this PC
   ```
   All three exit 0. Then `npx expo install --check` says up to date, and `npx expo-doctor` passes every check.
8. Read the `CHANGELOG.md` of `expo-audio` and `expo-notifications` across the versions you moved: anything that changes a fact in the vendor notes goes into AGENTS.md.

**Rollback:** `git checkout -- package.json package-lock.json`, then `npm ci`.

## 2. App config and `eas.json`

`app.json` (LF, keep it):

```json
"name": "Gracehush",
```
```json
"ios": {
  "icon": "./assets/expo.icon",
  "bundleIdentifier": "com.gracehush.app",
  "usesAppleSignIn": true,
  "infoPlist": { "ITSAppUsesNonExemptEncryption": false }
},
```

In `plugins`, `"expo-secure-store"` becomes `["expo-secure-store", { "faceIDPermission": false }]`, and add:

```json
[
  "expo-dev-client",
  {
    "launchMode": "most-recent",
    "toolsButton": false,
    "skipOnboarding": true,
    "showMenuAtLaunch": false
  }
]
```

`app.config.ts`: the fallback `name: config.name ?? "gracehush"` becomes `"Gracehush"`. The `slug` line stays. Nothing in `src` reads the config's name (checked).

New `eas.json` at the repo root, exactly decision 1's text, formatted. No `.easignore`.

## 3. Prove the native project before a build

Prebuild for iOS works on this PC in a scratch copy, once its one Windows check is passed. Never run this in the repo, and never against `.env.local`.

```powershell
# <scratch> is this session's scratchpad. A copy with no .env.local, no .git and a junction to node_modules.
$repo = (Get-Location).Path
$work = "<scratch>\prebuild"
if (Test-Path "$work\node_modules") { cmd /c rmdir "$work\node_modules" | Out-Null }
if (Test-Path $work) { Remove-Item -Recurse -Force $work -Confirm:$false }
New-Item -ItemType Directory -Force $work | Out-Null
foreach ($f in "app.json","app.config.ts","package.json","package-lock.json","tsconfig.json","metro.config.js","postcss.config.mjs","global.css","index.ts","App.tsx","nativewind-env.d.ts",".env") {
  if (Test-Path "$repo\$f") { Copy-Item "$repo\$f" "$work\$f" }
}
Copy-Item -Recurse "$repo\assets" "$work\assets"
New-Item -ItemType Junction -Path "$work\node_modules" -Target "$repo\node_modules" | Out-Null
```

`<scratch>/run-prebuild.cjs`, run with `node run-prebuild.cjs <work>`:

```js
// Runs Expo's own prebuild for iOS on Windows, in the scratch copy, to read the project it generates. The platform reads "linux"
// for the one function that refuses iOS on Windows, and nothing else sees it. The Google values are made up.
const path = require("node:path");
const work = process.argv[2];
process.chdir(work);
process.env.CI = "1";
process.env.EXPO_NO_TELEMETRY = "1";
process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID = "fake-web.apps.googleusercontent.com";
process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID = "fake-ios.apps.googleusercontent.com";
process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME = "com.googleusercontent.apps.fake-ios";
const { prebuildAsync } = require(path.join(path.dirname(require.resolve("@expo/cli/package.json", { paths: [path.join(work, "node_modules", "expo")] })), "build", "src", "prebuild", "prebuildAsync.js"));
const real = process.platform;
Object.defineProperty(process, "platform", {
  configurable: true,
  get() {
    return new Error().stack.includes("ensureValidPlatforms") ? "linux" : real;
  },
});
prebuildAsync(work, {
  platforms: ["ios"],
  clean: false,
  install: false,
  skipDependencyUpdate: Object.keys(require(path.join(work, "package.json")).dependencies),
})
  .then(() => console.log("prebuild finished"))
  .catch((e) => {
    console.log("prebuild failed:", String(e && e.message).slice(0, 800));
    process.exit(1);
  });
```

Then read `ios/Gracehush/Info.plist`, `ios/Gracehush/Gracehush.entitlements`, `ios/Gracehush.xcodeproj/project.pbxproj` and `ios/Podfile`. Write the `Info.plist` reader to a file (the Bash tool halves backslashes in inline scripts). Must hold, as they did on 2026-11-02:

| Where | Key | Value |
| --- | --- | --- |
| Info.plist | `CFBundleDisplayName` | `Gracehush` |
| | `ITSAppUsesNonExemptEncryption` | `false` |
| | `NSFaceIDUsageDescription` | absent |
| | `NSLocalNetworkUsageDescription` | present |
| | `NSBonjourServices` | `_expo._tcp` |
| | `EXDevMenuShowFloatingActionButton` | `false` |
| | `EXDevMenuIsOnboardingFinished` | `true` |
| | `EXDevMenuShowsAtLaunch` | `false` |
| | `CFBundleURLTypes` | `gracehush`, `com.gracehush.app`, `exp+gracehush` and the fake Google scheme |
| | `UIBackgroundModes` | `audio` only |
| | `NSMicrophoneUsageDescription` | the text in `app.json` |
| | `UIUserInterfaceStyle` | `Light` |
| | `NSAppTransportSecurity` | `NSAllowsArbitraryLoads` false, `NSAllowsLocalNetworking` true |
| entitlements | | only `com.apple.developer.applesignin`, no `aps-environment` |
| project.pbxproj | `PRODUCT_NAME` | `"Gracehush"` |
| | `PRODUCT_BUNDLE_IDENTIFIER` | `"com.gracehush.app"` |
| | `ASSETCATALOG_COMPILER_APPICON_NAME` | `expo`, with `Gracehush/expo.icon` holding `icon.json` and `Assets/logo-mark.png` |
| | `TARGETED_DEVICE_FAMILY` | `"1"` |
| | `IPHONEOS_DEPLOYMENT_TARGET` | `16.4` |
| | a script phase | `[Expo Dev Launcher] Strip Local Network Keys for Release` |

Then remove the junction with `cmd /c rmdir` before deleting the folder, never with a recursive delete.

## 4. Sign in with Apple revocation

### 4.1 `supabase/functions/_shared/account/apple.ts` (new, the only code that talks to Apple)

- `APPLE_CLIENT_ID = "com.gracehush.app"`, a constant. A bundle ID is public.
- `readAppleConfig(env)`: reads `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID` and `APPLE_SIWA_PRIVATE_KEY_B64`. None set: `{ kind: "off" }`. Some set, a Team ID or Key ID that is not 10 characters, or base64 that does not decode to a PKCS#8 PEM (`importPKCS8` with ES256): `{ kind: "bad", reason: "bad_config:<NAME>" }`, the name and never the value. All good: `{ kind: "ready", ... }`.
- `appleClientSecret(config, nowSeconds)`: a JWT made with `jose` (`SignJWT`, already pinned in `delete-account/deno.json`): header `{ alg: "ES256", kid }`; claims `iss` Team ID, `iat`, `exp` now plus 300 s, `aud` `https://appleid.apple.com`, `sub` `APPLE_CLIENT_ID`. Made per request and never stored.
- `revokeAppleSignIn(config, code, options)`: never throws, no retry, 8 seconds per call.
  1. `POST https://appleid.apple.com/auth/token`, form-encoded: `client_id`, `client_secret`, `code`, `grant_type=authorization_code`. A 200 with a `refresh_token` goes on. A 400's `error` is kept only when it is one of Apple's own words (`invalid_grant`, `invalid_client`, `invalid_request`, `unauthorized_client`, `unsupported_grant_type`, `invalid_scope`), as `token:<word>`; otherwise `token:http_<status>`, `token:timeout`, `token:network` or `token:no_refresh_token`.
  2. `POST https://appleid.apple.com/auth/revoke`, form-encoded: `client_id`, `client_secret`, `token`, `token_type_hint=refresh_token`. 200 is `revoked`; anything else `revoke:http_<status>`, `revoke:timeout` or `revoke:network`.
- Comment the fact from finding 8: a 200 from `/auth/revoke` proves nothing, and the token exchange is the only server-side evidence.

### 4.2 `supabase/functions/delete-account/handler.ts`

- `readConfirm` returns the optional code. The body may hold `confirm: "DELETE"` and, optionally, `appleAuthorizationCode`, a non-empty string of at most 4,096 characters. Any other key or shape stays `400 INVALID_REQUEST`, and nothing is asked or deleted.
- The `TODO(35)` line becomes the call: after RevenueCat, before Clerk. No code: `no_code`. Config off: `off`. Config bad: its reason. Otherwise `revokeAppleSignIn`'s answer. **It never fails or stops the deletion**, and it does not join the secrets check at the start. A retry after `DELETE_INCOMPLETE` brings a new code or none; both are fine.
- `context.accountApple` goes in the log as one word, a 39th field (`accountApple` in `_shared/log.ts`, `blankLogLine`, null elsewhere). The code, the tokens and the client secret never reach a log, a response or the database.

### 4.3 The contract

`DeleteAccountRequest = { confirm: "DELETE"; appleAuthorizationCode?: string }` in both `supabase/functions/process-entry/contracts.ts` and `src/types/index.ts`.

### 4.4 The app

- `src/services/appleReauth.ts` (new, LF): `confirmWithApple(appleUserId: string | null): Promise<AppleConfirmation>`, where `AppleConfirmation` is `{ kind: "code"; code: string } | { kind: "cancelled" } | { kind: "skipped" }`.
  - `skipped` with no Apple user id, on anything but iOS, in Expo Go (`isRunningInExpoGo()`: its bundle ID is not ours, so the code could never be exchanged), on the mock data source, or when `AppleAuthentication.isAvailableAsync()` says no.
  - Otherwise `AppleAuthentication.signInAsync({ requestedScopes: [] })`.
  - `credential.user !== appleUserId`, or no `authorizationCode`: `skipped`. Never send a code for another Apple Account: it could revoke someone else's sign-in on a shared phone.
  - A thrown `ERR_REQUEST_CANCELED`: `cancelled`. Any other throw: `skipped`.
- `src/api/journalApi.ts`: `deleteAccount(appleAuthorizationCode: string | null)` adds the key only when it is not null.
- `src/services/account.ts`: `deleteAccount(appleAuthorizationCode: string | null = null)`. It does not import Apple's package, so the older Node harnesses keep loading it.
- `src/screens/profile/ProfileScreen.tsx` (CRLF): `const appleUserId = user?.externalAccounts.find((account) => account.provider === "apple")?.providerUserId ?? null;` (clerk-js strips `oauth_` from `provider`). In the delete branch of the dialog's confirm, before `deleteAccount`:
  ```ts
  const apple = await confirmWithApple(appleUserId);
  if (apple.kind === "cancelled") {
    setBusy(false);
    setDialogError(text.errors.deleteAppleCancelled);
    return;
  }
  const result = await deleteAccount(apple.kind === "code" ? apple.code : null);
  ```
  This runs before the engine, the plan watch and Realtime stop, so a cancel changes nothing. The final dialog shows `deleteFinal.bodyApple` when `appleUserId` is not null.
- `src/constants/copy.ts` (CRLF), `profile.dialogs.deleteFinal.bodyApple`: `"Your sanctuary and everything in it will be removed. Apple will ask you to confirm, so Gracehush stops using your Apple sign-in. If it can’t, you can remove Gracehush in Settings, under your name, Sign-In & Security."`; and `profile.errors.deleteAppleCancelled`: `"Nothing was deleted. Apple’s confirmation was cancelled."`
- No analytics event, no haptic, no log line.

### 4.5 Secrets, fakes and docs

- `supabase/functions/.env.example`: the three names with a comment (never a value).
- `process-entry/testing/fakes.ts`: `appleid.apple.com`. The token endpoint verifies the client secret with a real ES256 public key (made in the test with `jose`), checks `sub`, `aud`, `iss` and `kid`, takes a code once and answers Apple's error shape otherwise. The revoke endpoint records the token and answers 200 **even for a bad token**, as the real one does.
- `supabase/tests/journal-data/world.cjs`: the fake `delete-account` accepts the optional key and records whether it came.
- `docs/privacy-policy.md` and `docs/legal-brief.md` (both CRLF), on deleting an account: if you signed in with Apple, Gracehush asks Apple to end its access, and otherwise you can remove it in Settings.

### 4.6 Tests

Deno: `apple_test.ts` (config off, bad and ready, naming the secret and never the value; the client secret's header and claims against a real key; the exchange then the revoke, in order; each failure word; a timeout; a 400 whose `error` is not one of Apple's words gives only the status; never throws). `delete-account/handler_test.ts`: the body rules; the order, RevenueCat then Apple then Clerk; a failed exchange or revoke still ends `200 { deleted: true }`; no code, config off and config bad each delete everything, with their word; a log line that holds no code, token or secret, across every case; the log-field tests move to 39.

Node (`supabase/tests/account/run.cjs`, with fakes for `expo-apple-authentication`, `expo` and `Platform`): `confirmWithApple` skips with no id, on Android, in Expo Go, on the mock data and when unavailable; asks with no scopes; answers the code for the same user; skips for another user or a null code; `cancelled` only for `ERR_REQUEST_CANCELED`; `skipped` for another error. `deleteAccount(code)` sends the code and stops the background work; `deleteAccount(null)` sends exactly `{ confirm: "DELETE" }`. A source check that the screen calls `confirmWithApple` before `deleteAccount` and returns on `cancelled`. The new copy has no straight apostrophe.

## 5. EAS, after the user's `eas init`

1. `git diff app.json`: only `extra.eas.projectId` (and `owner`, decision 12). Keep the file's line endings. `npx expo config --json` still shows it beside the four Google keys in `extra` (`app.config.ts` spreads `config.extra`). Print names, not values.
2. The three variables, from `.env.local` by name, with a Node script that passes them as arguments and prints no value:
   ```bash
   npx eas-cli@latest env:set --name <NAME> --value <value> --environment development --visibility plaintext --scope project --non-interactive
   ```
   Verify with `env:list`, keeping names only. `plaintext` because they are public identifiers. No Android value and no other key: the publishable keys are read from Metro in a development build.
3. `npx eas-cli@latest config --platform ios --profile development --json`: the resolved `extra` holds the URL scheme, in the expected shape (yes or no, never the value).
4. `npx eas-cli@latest build:inspect --platform ios --stage archive --profile development --output <scratch>/eas-archive --force`. It starts no build. In the output: no `.env.local` anywhere, no `supabase/functions/.env.local`, no `*.p8`, no `tone-eval/` and no `tts-audition/`; `assets/expo.icon` and `eas.json` are there. Print counts and the folder's size, then delete it.
5. After the user starts the build, watch it with `build:list --platform ios --limit 1 --json --non-interactive`, printing only its status and id. Tell the user when it ends. On a failure read the failing phase through `build:view`, say what it means, and propose one fix: a second build costs one of the 15. A failure compiling `expo.icon` has section 7's fallback.

## 6. The Apple key on the server

When the user says the `.p8` is in Downloads, a Node script reads it and appends the three lines to `supabase/functions/.env.local` (git-ignored: confirm with `git check-ignore`), printing only yes or no answers: the file exists, it decodes to a key `importPKCS8` accepts, and `appleClientSecret` signs and verifies with it. The old content stays byte for byte. Never `cat` the file, and never print a length. Then the user runs section I.

## 7. Assets this build ships, by exact path

| What the phone shows | File |
| --- | --- |
| Home Screen icon | `assets/expo.icon` (`icon.json`, `Assets/logo-mark.png`, 1024 by 1024) |
| Fallback icon | `assets/images/icon.png` (1024 by 1024, on linen) |
| Launch screen | `assets/images/splash-icon.png` on `#3E2741`, `imageWidth` 200 (changed 2026-11-03: see the "Launch screen" log entry in AGENTS.md) |
| Lock-screen and Control Center picture | `assets/images/player-scene-1-square.jpg` to `player-scene-4-square.jpg`, by the hour |
| Now Playing card | `assets/images/player-scene-1.jpg` to `player-scene-4.jpg` |
| Apple and Google button logos | `assets/images/apple-logo.svg`, `assets/images/google-g.svg` |
| Notification picture | none on iOS: it uses the app icon. `assets/images/notification-icon.png` is Android's |

**The icon's fallback.** Xcode 27.1 compiles `assets/expo.icon` on EAS, and nothing here can compile it first. If the build fails on it, or the Home Screen shows a blank icon on iOS 18.7, remove `ios.icon` from `app.json` (the top-level `icon` then applies, and iOS 26 draws its glass over a flat icon by itself) and build once more.

The 640 by 920 placeholder for App Store Connect is made in the scratchpad, plain linen with the logo mark, with no text and no metadata, and handed to the user at section H. A real paywall screenshot replaces it before review (release work).

## 8. Privacy and safety

- `.env.local`, `supabase/functions/.env.local` and every `.p8` stay out of the upload and of git. Checked in section 5.4.
- The Apple code goes to `delete-account` once, inside one request. It is never written to a store, the cache or a log, and the gateway keeps only a name, a status, a code word and a time.
- `delete-account` still takes the user only from the verified token. A code proves nothing about who is calling.
- Crisis handling is unchanged. Nothing here touches screening, the crisis view or its copy.
- This repository is public: no Team ID, Key ID, EAS username or project ref in a committed file. `app.json`'s `extra.eas.projectId` is decision 12's one exception.
- No analytics event is added.

## 9. Verification

### Part A: automated

1. Everything in section 0's list at the same numbers, plus the new tests: the Deno run rises by the new Apple and handler tests, account by its new checks. `npx expo-doctor` passes every check, `npx expo install --check` is up to date, and section 1.7's three dry runs exit 0.
2. `deno check` of every function entry point with its own `deno.json` (the commands under "Linting and Validation"), `deno lint`, `deno fmt --check --line-width=120 supabase/functions`.
3. One extra field on the server's `DeleteAccountRequest` alone fails `npm run typecheck` at `contractParity.ts`. Restore it byte for byte.
4. `git grep -n "TODO(35)"` finds nothing. The release gate still prints 4.
5. Section 3's table, on the final config.
6. `expo export` for iOS and for Android, one platform at a time, `--max-workers 1`, to a folder outside the repo, with the user's dev server stopped. The iOS bundle holds `confirmWithApple` and "Nothing was deleted". Delete the folder afterwards: it holds the public keys.
7. **Breakages**, in a scratch copy with a junction to `node_modules`, never the repo, a control run first. Each must fail a named check: the revocation called after Clerk; a failed exchange failing the deletion; the revoke's 200 treated as evidence with no exchange; a client secret with the wrong `sub`, `aud` or `kid`; no `kid`; an extra body key accepted; a code logged; a bad config blocking the deletion; `confirmWithApple` sending a code for another user; a cancel treated as `skipped` (a deletion nobody confirmed); `skipped` treated as a cancel (a deletion blocked by an Apple outage); Expo Go asked; the code sent when null; the screen deleting after a cancel.

Report: "Automated checks pass" and ask whether to go on to the user's sections (A to G). Do not spend the build before Part A is green.

### Part B: the phone walk-through (the Gracehush development build on the iPhone)

Before B0:

- **Restart:** a new install. `npx expo start -c --dev-client`, and after `.env.local` changes a restart of it. This app has its own storage, so onboarding and sign-in start fresh, and Expo Go's copy of anything is untouched.
- **Accounts:** the Apple Account on the phone (B3 makes a new Gracehush account from it, B23 deletes it), a Google account listed under Test users, `gracehush35+clerk_test@example.com` with code `424242` for email, and the sandbox tester.
- **Cost:** about three reflections of cents each. Sandbox purchases are free. No real charge anywhere.
- **The app stays in front** except in the checks that lock the phone. While a devotional plays iOS keeps the JavaScript running, so the recorders see those; other checks are read after the user is back.
- **Consent, asked once:** the implementer opens screens through the navigation ref, reads stores and the app's own queries, switches dev flags and sends a made-up reflection through the outbox where a check allows. It never reloads through the inspector, never signs in as an account, and never purchases. The user does those.
- **The target:** `/json/list` now names the app `com.gracehush.app (iPhone)`. Module ids come from a new dev bundle after every dev server restart.

Number by number. A result only the eye or ear can judge asks for a screenshot or one word.

- **B0, the first open.** Do: tap Gracehush, Allow Local Network, connect. Expect: the bundle loads and Welcome appears, in Fraunces and DM Sans. Read: the target's `appId` is `com.gracehush.app`; `Constants.executionEnvironment` is `bare`; `inExpoGo()` false; `ExpoFontLoader.getLoadedFonts()` holds the eight fonts (the SDK 58 regression; the `metro.config.js` bypass must survive the `expo-asset` bump); no `[fonts]` line in the console.
- **B1, the name, the icon, the launch.** Do: a screenshot of the Home Screen, then force-quit and reopen. Expect: the label reads **Gracehush** with a capital; the icon is the flame over open hands on linen (`assets/expo.icon`), not blank; the launch screen is deep plum with the mark over "GraceHush" (`assets/images/splash-icon.png`, since 2026-11-03; it needs a new build), and it fades into the first screen. Read: screenshot and one word. A blank icon takes section 7's fallback.
- **B2, the OS prompts.** Do: go through Onboarding and press **Allow & Continue**, allowing both. Expect: iOS names **Gracehush**, and the microphone prompt shows the `app.json` text. Read: a screenshot; the recorder and notification statuses are `granted`. The cover's sample, the scenes and the pills are 34b's own checks, not this one's.
- **B3, Apple, a new person.** Do: on the final Sign In tap **Continue with Apple** (the black button, first in the stack), choose **Hide My Email**, continue. Expect: Journal, with nothing in between. Read: signed in; `externalAccounts[0].provider` is `apple` (boolean only); the email is a relay address (boolean only); `selectProfileRow` finds the row; no Clerk error in the console. Keep the id hash for B4.
- **B4, Apple, cancel and return.** Do: Profile, Sign Out. Tap Continue with Apple, press **Cancel**. Then tap it again and finish. Expect: the cancel shows nothing at all, and the second try lands on Journal with the same account. Read: no text under the buttons after the cancel; the same id hash; no second Clerk user.
- **B5, the relay address (optional).** Do: Sign Out, Continue with email, type the relay address from Profile, read the mail in your real inbox. Expect: the 6-digit code arrives. Read: the user's word. Not verified if section B, step 3 had no email source to register.
- **B6, Google.** Do: Sign Out. Tap **Continue with Google**, cancel Google's sheet. Then again, and choose the test account. Expect: the cancel shows nothing. Otherwise iOS asks to use google.com, Google's own sheet opens in the app, and it ends on Journal (not Clerk's page and not Safari). Read: `externalAccounts[0].provider` is `google`; no "isn't available" text; a screenshot of the sheet.
- **B7, email.** Do: Sign Out, sign in with `gracehush35+clerk_test@example.com`, code `424242`. Expect: Journal. Read: signed in as a third id hash. Then sign out and back in with Apple for the rest of the run: the account from B3.
- **B8, a stay across a kill.** Do: swipe the app away and reopen it. Expect: straight to Journal. Read: the same hash (SecureStore in the app's own keychain).
- **B9, a real take with a lock in it.** Do: the microphone orb on the dock, Tap to begin, speak for about 8 seconds, press the **side button**, wait 5 seconds, unlock. Expect: while locked, the orange microphone dot is gone (no background recording). Back in the app: "Recording paused while you were away.", the timer held. Tap the orb to resume, speak 5 more seconds, **Finish Reflection**. It opens as a reflection with audio. Read: the recorder's status log with its times; `durationMs` about 13 s; `countRawUploads` up by one; `process-entry` 200. This is the native recorder for the first time (Expo Go carries an older copy).
- **B10, background and the lock screen.** Do: open Now Playing for that reflection, press play, then the **side button**. Expect: the voice keeps playing. The lock screen shows the devotional's title, "Gracehush • {reference}", the square scene of this hour (`assets/images/player-scene-N-square.jpg`: 2 from 5:00 to 8:59, 3 from 9:00 to 11:59, 4 from 12:00 to 16:59, 1 from 17:00 to 4:59, by `getPlayerSceneForHour`) and two skip buttons marked **15**. No words of the prayer, no emotion, no date. Read: a screenshot; the store's position log runs on through the lock; `status` stays `playing`.
- **B11, the lock screen's controls and the end.** Do: from the lock screen: pause, play, back 15, forward 15. Pause and wait a minute. Press play and let it end. Press play again. Expect: the sound obeys every press, the card stays while paused, and play after the end starts again from 0:00. Read: the recorder's status and position, within a second of each press; with Share Usage Data on, `devotional_played` and `devotional_completed` once each, sent while locked or at the next foreground.
- **B12, the ambient bed under the lock.** Do: on Now Playing choose Gentle Piano at about 50%, play, side button, wait a minute, pause from the lock screen, play. Expect: the piano stays under the voice with no click at its 75-second seam, and pause and play move both together. Read: the ear; `ambientGain` and the bed's state; the player's status log.
- **B13, an interruption.** Do: with a devotional playing and the phone locked, have a **Clock timer** ring, then stop it. Expect: voice and bed pause together, and iOS decides whether they come back (Audio Rules, "Interruptions follow the platform"). Read: the log, and the user's word. A real phone call only if the user can arrange one. No Siri.
- **B14, the app's own notification, from a closed app.** Do: on Profile, in the dev panel, **Test in 10 s (dev)**, then at once swipe Gracehush away from the app switcher. When the notification arrives, take a screenshot and tap it. Expect: it names **Gracehush** with the app's icon, the title "{Slot} affirmation" and one short line. The tap opens the app, it reconnects to Metro, and Reflection opens on the **Affirmations** tab. No sound plays. Read: `navigationRef.getCurrentRoute()` is `Reflection` with `tab: "affirmations"` and the planned entry; the player is `idle`. Expo Go could never show this.
- **B15, offline in the app's own binary.** Do: Airplane mode on (Wi-Fi off too), the pen, write a made-up sentence of a dozen words, Submit, then Airplane mode off. Expect: "Saved. We’ll prepare your reflection when you’re back online.", a card with no words on it, then the reflection by itself. Read: `countsByStatus`; `selectCanSend` false then true; `[sync]` lines; one new row. SQLite and NetInfo run from this build's native code for the first time.
- **B16, a tour of the native controls.** Do: Prayers, **Mark Answered** on a card (the outlined button at the card's bottom right, not the round pen), change the day with the wheel, then Not yet. Profile, Daily Reminders, a time, Done. A reflection's share button, then cancel. Expect: each opens and works, with the small tick on a tab change. Read: routes and no error in the console; the user's word on the wheel and the tick. Read `isLiquidGlassAvailable()` (false on iOS 18.7: the frosted blur is what should show).
- **B17, the Paywall with the real store.** Needs section H. Do: Profile, the plan card's white button. Expect: **Yearly Access**, $59.99, a per-month line, **Save 50%**, "7 days free", selected by default; **Monthly Access**, $9.99; the button **Start 7-day free trial**; Apple's renewal words under it (a sandbox price may read differently: RevenueCat warns of this, and Apple's sheet is the truth). Read: the dev panel's `revenuecat key` kind is `app_store`; offering `default`; `productId`, `price`, `currencyCode` and `introOffer.periodDays` 7 on the annual package, none on the monthly; `isTrialEligible` true for annual.
- **B18, cancel at Apple's sheet.** Do: press the button, then Cancel on Apple's sheet. Expect: nothing changes and no message shows. Read: entitlement `free`, no `sync-subscription` call.
- **B19, the trial.** Do: press it again, sign in with the sandbox tester if asked, and confirm. Expect: "Welcome to Gracehush Pro." and Continue; Profile says Gracehush Pro, free trial. Read: entitlement tier `trial`; `sync-subscription` 200; the server row (the app's own query) `subscription_tier` `trial`, ending about 3 minutes on. RevenueCat's webhook page: `INITIAL_PURCHASE`, `store` `APP_STORE`, `environment` `SANDBOX`, `period_type` `TRIAL`, response 200. This is the first real trial anywhere in this project (finding 9).
- **B20, the renewal.** Do: wait about 4 minutes with the app in front. Expect: the plan turns to Pro with no tap. Read: the entitlement `pro` through the customer-info listener, which Expo Go never fired; the row `pro`, ending about an hour on; webhook `RENEWAL`.
- **B21, restore and manage.** Do: Profile, **Restore purchases**; then **Manage subscription**. Expect: "Your purchase is restored."; Apple's subscription page opens. Read: `managementUrl` is not null; `sync-subscription` 200. Sandbox subscriptions show under Settings, Developer, not on that page: not a fault.
- **B22, the export still downloads (a smoke check of the system browser from this app).** Do: Profile, Export Journal, Prepare export, wait for the plum row, tap it. Expect: the browser downloads the ZIP. Read: `export-data` 200 and `reused` false; the one word.
- **B23, delete the Apple account: Apple is asked.** Do: Profile, Delete Account, Continue (the subscription warning shows), then **Delete forever**. On Apple's sheet press **Cancel**. Expect: the dialog stays, with "Nothing was deleted. Apple’s confirmation was cancelled." Read: the sync engine running; no `delete-account` call; rows unchanged. Do: **Delete forever** again, and confirm with Face ID. Expect: Sign In, "Welcome back". Read: `delete-account` 200; its log line has `account` `delete:done` and `accountApple` `revoked` (exported as CSV, every field checked against the 39, no code, no token); the user's SQL shows 0 rows for that id hash; RevenueCat's customer page says not found; Clerk no longer lists the user. Do: iPhone **Settings**, your name, **Sign-In & Security**, **Sign in with Apple**. Expect: **Gracehush is gone from the list**. This is the real proof (finding 8).
- **B24, Apple again from scratch.** Do: on Sign In tap Continue with Apple. Expect: Apple's **first-time** sheet again, with the name and the Share or Hide My Email choice, and a new, empty account on Journal. Read: a new id hash, 0 reflections. Then Profile, Delete Account once more, to leave nothing behind.

Not checked on this target, and where: Android (step 05b, only with the user's yes); iOS 26's Liquid Glass (this phone is on 18.7.11); Siri (does not work on this phone) and a real call unless arranged; an Ask-to-Buy pending purchase and a production purchase (release work); VoiceOver; the production Clerk instance; Apple's privacy manifest check on a first TestFlight upload.

## 10. AGENTS.md updates

Record these, replacing the text they supersede. Then `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp`.

- **Instructional Memory:** mark the iOS developer account entry as done, with the date, and shorten its bullets: the iPhone now tests on the development build, and the "not verified on iOS" list is replaced by what the walk-through showed. A new SDK no longer needs a new Expo Go, only a new build.
- **Tech Stack:** the client bullet ("No dev client exists yet …"): an iOS development client exists from step 35 (`expo-dev-client`); `npx expo start` targets it and Expo Go is `npx expo start --go`. Add `expo-dev-client` to the approved list with its version.
- **Architecture tree:** `eas.json`; `src/services/appleReauth.ts`; `_shared/account/apple.ts`. `/ios` and `/android` are gitignored prebuild output.
- **Navigation, screen specification 7:** the final delete dialog for an Apple account.
- **Backend:** `delete-account`'s body and the 39-field log line; server secrets `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY_B64`; "Account export and deletion": replace the Sign in with Apple bullet; remove `TODO(35)` from "Before a store build" and say what is true now.
- **Subscription Rules:** the App Store products exist in sandbox; what a real trial showed.
- **Audio Rules and Notification Rules:** what the phone showed in place of "waits for step 35". Vendor notes: replace "Seen on the iPhone" lines where a real build differs from Expo Go.
- **"Guided phone walk-through":** the target is the development build (its `appId`, and `--dev-client`); Expo Go's limits move to a note.
- **"Verifying on this machine":** the EAS iPhone procedure; the scratch prebuild (section 3); the `npm ci` dry run on the builder's npm; which commands are the user's.
- **Build Status & Decisions Log:** a Step 35 entry in the form of the ones before it: decisions, files, differences from this prompt, the versions (EAS CLI, `expo-dev-client`, the moved packages, the image), red numbers, breakages, the walk-through line by line, the build's id count (never a URL), known limits.

## 11. Report

Lead with what changed and where, then how to test it. Include: the upgraded packages; each file created or changed; the test counts before and after; the breakages caught; which commands the user ran; the build's outcome and how many of the month's builds it took; B0 to B24 one line each; and what could not be checked and where it can be. List the leftovers (test accounts, sandbox subscriptions, the empty RevenueCat customers). Say plainly if the build came from an uncommitted tree.

At the end of Part A: "Automated checks pass. Shall we go on to the setup sections (A to G) now?" At the end of the install: "Shall I start the guided walk-through now (B0 to B24)? Keep Gracehush open on the iPhone, in front and connected to the dev server."
