# 30-revenuecat.md

Read AGENTS.md first and follow it strictly.

Connect real subscriptions. Replace the step 16 mock purchase service with RevenueCat (`react-native-purchases`), identify each RevenueCat customer by the Clerk user id, and keep `users_profile.subscription_tier` right on the server: a new `_shared/billing/revenuecat.ts` re-reads the customer from RevenueCat's REST API, and two new Edge Functions call it, `sync-subscription` (called by the app) and `revenuecat-webhook` (called by RevenueCat). The Paywall and Profile keep their exact look and copy.

**Status of this text.** Reviewed and rewritten on 2026-10-29 from the code of steps 16 to 29b (read file by file) and from RevenueCat's packages and current docs (listed below). Nothing in it has been run against RevenueCat: the functions, the migration and the app code are specified closely enough to build, and the implementer proves them (section 12), as steps 21, 22, 29 and 29b did. Where this text gives code, it is the intended shape; where the real code disagrees, follow the real code and say so in the report.

Sources read: `AGENTS.md`; `src/services/purchases.ts`, `src/data/mock/offerings.ts`, `src/utils/pricing.ts`, `src/hooks/usePaywall.ts`, `src/hooks/useProfileSettings.ts`, `src/screens/paywall/PaywallScreen.tsx`, `src/screens/profile/ProfileScreen.tsx`, `src/components/profile/PlanCard.tsx`, `src/services/account.ts`, `src/services/externalLinks.ts`, `src/services/upgradeWatcher.ts`, `src/services/syncEngine.ts`, `src/services/profileSync.ts`, `src/store/profilePrefsStore.ts`, `src/data/journalRepository.ts`, `src/data/mock/scenario.ts`, `src/api/journalApi.ts`, `src/constants/env.ts`, `src/constants/app.ts`, `src/components/SupabaseAuthBridge.tsx`, `src/components/dev/DevToolsPanel.tsx`; `supabase/functions/_shared/` (`errors.ts`, `log.ts`, `auth.ts`, `admin.ts`, `limits/weekly.ts`), `supabase/functions/process-entry/` (`handler.ts`, `lifecycle.ts`, `contracts.ts`, `testing/fakes.ts`), `supabase/config.toml`, `supabase/migrations/`; the npm packages `react-native-purchases` 10.16.0 and 11.0.0 and `@revenuecat/purchases-typescript-internal` 19.17.0 (their `dist/` and the SDK's `CHANGELOG.md`); and these pages, which are the source of truth for anything this text does not settle:

- https://www.revenuecat.com/docs/getting-started/installation/expo
- https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store
- https://www.revenuecat.com/docs/getting-started/configuring-sdk
- https://www.revenuecat.com/docs/customers/identifying-customers
- https://www.revenuecat.com/docs/getting-started/displaying-products
- https://www.revenuecat.com/docs/getting-started/making-purchases
- https://www.revenuecat.com/docs/test-and-launch/errors
- https://www.revenuecat.com/docs/integrations/webhooks
- https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
- https://www.revenuecat.com/docs/api-v1 (`GET /subscribers/{app_user_id}`)
- https://www.revenuecat.com/docs/projects/authentication (API keys)

---

## What was checked when this was written (these shaped the prompt)

1. **RevenueCat runs in Expo Go, so this step can be tested on the iPhone now.** `react-native-purchases` detects Expo Go (`globalThis.expo.modules.ExpoGo`) and switches to its Browser Mode, on RevenueCat's web SDK. There it accepts only a **Test Store** key (`test_…`) or a Web Billing key (`rcb_…`), and it throws on an App Store (`appl_…`) or Google (`goog_…`) key. With the Test Store key a purchase shows RevenueCat's own alert, "Test Store Purchase", with **Cancel**, **Test failed purchase** and **Test valid purchase**; a valid one is a real simulated purchase on RevenueCat's servers (customer, entitlement, sandbox webhook with `store: TEST_STORE`). The old text said RevenueCat needs a development build; that is true only for real App Store and Google Play purchases, which wait for step 35 (the Apple account comes last, AGENTS.md Instructional Memory) and for an Android development build.
2. **Browser Mode differs from a native build in four ways that matter here:** trial eligibility is always "unknown" (so no trial is ever advertised in Expo Go: AGENTS.md says never advertise a trial that cannot be confirmed); `restorePurchases` is only a re-read of the customer; no customer-info update event is ever sent, so `addCustomerInfoUpdateListener` never fires and the app must re-read the entitlement after a purchase, after a restore and when it comes to the front; and `syncPurchases` and `invalidateCustomerInfoCache` are not supported.
3. **Pin `react-native-purchases` 10.16.0, not 11.0.0.** 11.0.0 was published on 2026-10-28, and its changelog says the iOS pod it needs (`PurchasesHybridCommon` 20.1.0) cannot be installed through CocoaPods until after the trunk freeze of November 1 to 7. Expo's iOS builds use CocoaPods. 10.16.0 (2026-10-27) has the same Expo Go mode and Test Store support, peers React Native 0.73 or newer, and RevenueCat's own test app runs it on React Native 0.88. No config plugin is needed on SDK 58.
4. **A release build crashes on purpose with a Test Store key** (RevenueCat's docs; TestFlight and Play test tracks count as release builds). The key choice must refuse it outside development, and a store build must carry the platform keys.
5. **Webhooks are free on this project.** They need RevenueCat's Pro plan, which costs nothing up to $2,500 of monthly tracked revenue (then 1%). They are secured by an **Authorization header value** you set in the dashboard (RevenueCat's recommendation) and by optional **HMAC signing**: `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>`, an HMAC-SHA256 over `<t>.<raw body>`. The signing secret is shown once. RevenueCat counts only HTTP 200 (within 60 s) as delivered, and otherwise retries up to 5 times (about 2.5, 5, 10, 20 and 40 minutes). Delivery is at least once, and a retry keeps the event `id`. RevenueCat's own advice is to re-read the customer through the REST API after any event.
6. **Re-reading the customer makes every event harmless to repeat**, so the old text's `revenuecat_events` table and its 90-day cleanup are dropped: a duplicate, a retry or a late event re-reads the same current state. One migration still adds two columns (decision 9).
7. **REST API v1 is current.** `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` with a V1 secret key is the call the webhook docs recommend, and step 31 already plans `DELETE /v1/subscribers/{id}`. A V1 key does not work on API v2. Secret keys are project-wide and never go in the app.
8. **The SDK's field names match what the screens need** (`@revenuecat/purchases-typescript-internal` 19.17.0):
   - **The product:** `price`, `priceString`, `pricePerMonthString` (string or null), `currencyCode`, `subscriptionPeriod` (`P1Y`, `P1M`), `introPrice` (`price`, `periodUnit`, `periodNumberOfUnits`), and on Android `defaultOption.freePhase`.
   - **The package:** `identifier`, `packageType` (`PACKAGE_TYPE.ANNUAL`, `MONTHLY`) and `presentedOfferingContext`.
   - **The entitlement and the customer:** `entitlements.active["pro"].periodType` (`"TRIAL"`, `"NORMAL"`, `"INTRO"`, `"PREPAID"`) and `CustomerInfo.managementURL`.
   - **The error codes** are strings in `PURCHASES_ERROR_CODE`: `PURCHASE_CANCELLED_ERROR` "1", `STORE_PROBLEM_ERROR` "2", `PURCHASE_NOT_ALLOWED_ERROR` "3", `PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR` "5" (also what the Test Store's "failed purchase" answers), `PRODUCT_ALREADY_PURCHASED_ERROR` "6", `NETWORK_ERROR` "10", `PAYMENT_PENDING_ERROR` "20", `CONFIGURATION_ERROR` "23" and `OFFLINE_CONNECTION_ERROR` "35".
9. **The plan already reaches the phone through the profile sync** (`users_profile.subscription_tier`, written only by the server), and `upgradeWatcher.ts` resends what the free limit held as soon as that plan turns paid. So the app only has to make sure the server knows right after a purchase. The old text's extra "retry on LIMIT_REACHED" path in the sync engine is not needed and is dropped.
10. **`users_profile` has a table-wide SELECT for the app and per-column INSERT and UPDATE** (step 18), and the service role has table-wide grants. So two new columns are readable by the app on its own row and writable only by the server, with no grant change. The app's `select("*")` keeps working.
11. **The test account `gracehush17b+clerk_test@example.com` is Pro only because of a hand-made SQL change** (step 22). Once RevenueCat decides, its first sync turns it free unless RevenueCat grants it Pro (decision 20).
12. **The old text was out of date in other places.** It used flat screen paths, plus `npm run types:db`, `rls_test`, `npx supabase functions serve` and a dev-client rebuild, none of which exist here (no Docker, no development build; AGENTS.md). It cited a "step 22 TODO(30)" in `weekly.ts` that does not exist. It put the entitlement id in a secret, and its key setup would throw in Expo Go.

---

## What you do yourself (read this first)

Nothing here costs money. RevenueCat's plan is free at this size, and Test Store purchases are simulated. When you do the dashboard steps, the implementer guides you one instruction at a time and checks your screenshots. The dashboard's labels may differ slightly from the names below: send a screenshot when one does not match.

### Keys and settings (checked by names only, on 2026-10-29)

| file | has now | this step adds |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY` (now). `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` stay **empty** until the stores are set up (step 35, and the Android build). |
| `supabase/functions/.env.local` | `CLERK_ISSUER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE` | `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_WEBHOOK_SIGNING_SECRET` |

The three app keys are public SDK keys, but they still live only in `.env.local` (git ignores it). The three function values are **secrets**: never in the app, an `EXPO_PUBLIC_` name, a chat, a screenshot or a commit.

### A. The order of work

1. **Before the implementation (you, about 20 minutes):** set up RevenueCat (B below) and put two keys in the two `.env.local` files.
2. The implementer builds and proves everything offline (Part A of section 12). Your "Implement it." approves the package, the migration file and the decisions below.
3. **At the deploy gate (you):** apply the migrations and self-test (C), create the webhook and its two secrets (D), then set the secrets and deploy (E). The implementer asks first.
4. The implementer asks whether to start the phone walk-through (F).

### B. RevenueCat setup (before the implementation)

1. **Account and project.** Go to https://app.revenuecat.com and sign up (free). Create a project named **Gracehush**. The project's plan is "Pro", which is free at this size.
2. **The Test Store key.** In the project, open **Apps & providers**. Under **Test configuration** open the **Test Store** (every new project has one). Copy its **API key**: it starts with `test_`. In VS Code open `.env.local` and add a line:
   `EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY=` followed by the key, with no space and no quotes. Save.
3. **Two products in the Test Store.** Open **Product catalog**, **Products**, and add two subscription products to the **Test Store** app. Give them no free trial (decision 15).
   - Identifier `gracehush_pro_yearly`, display name "Gracehush Pro Yearly", duration **1 year**, price **59.99 USD**.
   - Identifier `gracehush_pro_monthly`, display name "Gracehush Pro Monthly", duration **1 month**, price **9.99 USD**.

   These are the launch prices AGENTS.md records under Subscription Rules. The app never types them: it shows what RevenueCat sends.
4. **The entitlement.** Open **Product catalog**, **Entitlements**, and add one with identifier **`pro`** (exactly this, lowercase) and display name "Gracehush Pro". Attach both products to it.
5. **The offering.** Open **Product catalog**, **Offerings**. Use the offering with identifier **`default`** (create it if it is not there) and make it the **current** offering. Add two packages:
   - **Annual** (`$rc_annual`), with `gracehush_pro_yearly`
   - **Monthly** (`$rc_monthly`), with `gracehush_pro_monthly`
6. **The server's key.** Open **Project settings**, **API keys**, and create a new **secret** API key named "Supabase functions". Choose version **V1**. Copy it: it starts with `sk_`. In VS Code open `supabase/functions/.env.local` and add a line:
   `REVENUECAT_SECRET_API_KEY=` followed by the key. Save. **Do not run `secrets set` yet** (E does).
7. Tell the implementer "done". It checks the names in both files without printing a value.

### C. At the deploy gate: the migrations and self-tests (you, in the browser)

Step 29b's migration has not been applied yet, and `process-entry` (deployed in E) reads its table. So the order is 29b first, then 30.

1. In VS Code open `supabase/migrations/20261028150000_deleted_devotionals.sql`. Press **Ctrl+A**, then **Ctrl+C**. In the Supabase dashboard open your `gracehush` project, **SQL Editor**, **New query**, paste and press **Run**. Expect **Success. No rows returned.** If it was already applied, running it again is harmless: it is written to be safe to repeat.
2. Do the same with the step 30 migration (`supabase/migrations/20261029120000_subscription_sync.sql`, created by the implementer).
3. Run the self-test. Open `supabase/tests/rls_selftest.sql` and copy it all into a **New query**. At the very end add a blank line and this line:
   `select count(*) as checks, count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from rls_results;`
   Press **Run**. If a dialog "Potential issues detected" appears, answer **Run without RLS**. Expect the count the implementer gives you (53) with 0 failed. Send a screenshot.
4. Run `supabase/selftest.sql` the same way, without the extra line: 11 of 11 passed.
5. Regenerate the types: **Integrations**, **Data API**, **Docs**, **Generate and download types**. Replace `src/types/supabase.ts` with the download and tell the implementer. The diff must show step 29b's table and the two new columns, nothing else.

### D. At the deploy gate: the webhook and its two secrets (you)

1. In a terminal run:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   It prints a 64-character value. In `supabase/functions/.env.local` add `REVENUECAT_WEBHOOK_AUTH=` followed by that value. Keep the terminal open: you paste the same value in step 2.
2. In RevenueCat open **Integrations**, **Webhooks** and add a webhook:
   - **Name:** "Supabase".
   - **URL:** your Supabase project URL followed by `/functions/v1/revenuecat-webhook`. The project URL is under Project Settings, API, "Project URL", and looks like `https://<project-ref>.supabase.co`.
   - **Authorization header value:** the 64-character value from step 1, exactly as printed.
   - **Environment:** **both production and sandbox**. Test Store purchases are sandbox events.
   - **App:** all apps.
   - **Events:** all.
   - **Signing:** turn on **HMAC signing**, and copy the signing secret it shows (shown once).
   - Save.
3. In `supabase/functions/.env.local` add `REVENUECAT_WEBHOOK_SIGNING_SECRET=` followed by the signing secret. Save. Every line of that file must now have a value (`secrets set --env-file` sends them all; AGENTS.md).

### E. At the deploy gate: secrets and deploy (you, in Git Bash, after the implementer asks)

Run these in this order, from the repo folder. `<project-ref>` is the one from your earlier deploys.

```bash
npx --yes supabase@2.121.0 secrets set --env-file supabase/functions/.env.local --project-ref <project-ref>
npx --yes supabase@2.121.0 functions deploy delete-entry --project-ref <project-ref> --use-api
npx --yes supabase@2.121.0 functions deploy sync-subscription --project-ref <project-ref> --use-api
npx --yes supabase@2.121.0 functions deploy revenuecat-webhook --project-ref <project-ref> --use-api
npx --yes supabase@2.121.0 functions deploy process-entry --project-ref <project-ref> --use-api
```

Never deploy `process-entry` before C: it reads step 29b's table and the new columns. Then:

1. The implementer sends requests with no sign-in and no secret and expects the functions' own answers:
   - `sync-subscription`: 401, 405 for a GET, 204 for OPTIONS.
   - `revenuecat-webhook`: 401 for a POST with no Authorization, 405 for a GET.
2. In RevenueCat, on the webhook's page, press **Send test event**. Expect **200**. A test event changes nothing.

To switch the webhook off: delete it in RevenueCat. To switch the app's own sync off: delete `sync-subscription` in the Supabase dashboard. Purchases keep working, and the server learns at the next webhook or sync.

### F. Phone walk-through (iPhone, Expo Go)

The checks are listed at the end of section 12 (Part B). Before B0, restart Metro with `npx expo start -c` (a new package and new files), then force-quit and reopen Expo Go.

### G. Later, not in this step

- **App Store Connect (step 35, after the Apple Developer account):**
  1. The Paid Apps agreement, tax and banking.
  2. A subscription group "Gracehush Pro" with a yearly and a monthly product, with a 7-day free trial on the yearly one only. You set the prices.
  3. An In-App Purchase key, given to RevenueCat.
  4. The App Store app in RevenueCat, with its products attached to `pro` and to the `default` offering.
  5. `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (`appl_…`) in the EAS environment.
  6. Sandbox testers.
- **Google Play (when an Android development build exists, which also needs a Play Console account):**
  1. A subscription with yearly and monthly base plans, and a free-trial offer on the yearly one.
  2. A service account with financial access, added to RevenueCat.
  3. The Play Store app in RevenueCat.
  4. `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (`goog_…`).
  5. License testers.
- **Before launch (AGENTS.md, "Before a store build"):**
  - the platform keys are set and the Test Store key is not in the production environment;
  - RevenueCat's **Sandbox Testing Access** is limited to your test accounts;
  - the secret key is rotated if anyone else ever saw it.

### H. If something goes wrong: what it means

- **Paywall says "Plans aren’t available right now."** The key is missing or refused (the developer panel's Supabase check prints which), or the offering `default` is not current or has no Annual and Monthly packages.
- **"Test Store Purchase" alert says "Error loading package details".** The package's product is not in the Test Store or not attached to the offering.
- **Purchase works, Profile still says Free.** `sync-subscription` is not deployed, the secret key is wrong (its log line says `billing: bad_config:REVENUECAT_SECRET_API_KEY` or `failed:http_401`), or the product is not attached to the `pro` entitlement.
- **Webhook deliveries show 401.** The Authorization value or the signing secret differs between RevenueCat and the hosted secrets: set them again (D), then `secrets set` (E). Secrets apply at once, with no redeploy.

---

## Decisions (approved with this prompt by your "Implement it.")

1. **Package:** `npx expo install react-native-purchases@10.16.0`, pinned to exactly that version (finding 3). No `react-native-purchases-ui`, since the Paywall is our own. No config plugin, no prebuild, no `expo-dev-client`, no `eas.json`. Moving to SDK 11 is a later, separate step, with RevenueCat's v11 migration guide.
2. **Where it is tested:** the RevenueCat Test Store, in Expo Go on the iPhone. Real App Store purchases wait for step 35, and Google Play for an Android development build.
3. **Keys, chosen at run time by a pure function** (`chooseRevenueCatKey`, section 2):
   - **In Expo Go:** the Test Store key only.
   - **In a development native build:** the platform key, otherwise the Test Store key.
   - **In a release build:** the platform key only. A `test_` key is refused there, and purchases are then unavailable, instead of RevenueCat's purpose-built crash.
   - **Anywhere:** a secret key (`sk_`) in the app is refused and never used.
   - Each key is read by its full name (`process.env.EXPO_PUBLIC_…`).
4. **Identity.** The RevenueCat app user id is the Clerk user id:
   - **When:** RevenueCat is configured only after sign-in, with `appUserID`; there are never anonymous customers.
   - **Account switch:** `logIn(userId)`.
   - **Sign-out:** `logOut()`, with errors ignored.
5. **One entitlement, `pro`** (AGENTS.md, Subscription Rules), as the constant `PRO_ENTITLEMENT_ID` in `src/constants/app.ts` and in `_shared/billing/revenuecat.ts`, not an environment variable. The app uses RevenueCat's **current** offering (`default`) and its Annual and Monthly packages. No product id is ever in code.
6. **RevenueCat is the source of truth.** `users_profile.subscription_tier` is written only by `syncSubscription` on the server, which re-reads the customer with `GET /v1/subscribers/{id}` and a V1 secret key. Three callers: the webhook, the app (`sync-subscription`), and process-entry's expiry guard (decision 10).
7. **Webhook security: both checks required.**
   - **The Authorization header** must equal `REVENUECAT_WEBHOOK_AUTH`, compared in constant time.
   - **The HMAC signature** must verify against `REVENUECAT_WEBHOOK_SIGNING_SECRET` over the raw body, with the timestamp within 300 seconds of now.
   - **Missing or wrong:** 401.
   - **The work:** done before answering (no `EdgeRuntime.waitUntil`). The function answers 200 only when every sync succeeded, so RevenueCat retries a failure.
8. **No events table** (finding 6).
9. **The migration** `supabase/migrations/20261029120000_subscription_sync.sql`:
   - **What it adds:** `users_profile.subscription_expires_at` and `subscription_synced_at`, both `timestamptz`, both written only by the service role.
   - **Grants:** none change (finding 10).
   - **Checks:** three new ones in `rls_selftest.sql` (53 in all), three broken variants in the PGlite runner, and one preflight row.
10. **The expiry guard in process-entry.**
    - **When it runs:** for a trial or Pro row whose `subscription_expires_at` has passed.
    - **What it does:** it re-reads RevenueCat once (one attempt, 6 seconds) before the free limit.
    - **RevenueCat unreachable, or billing not set up:** the stored plan stands. A paying person is never blocked by an outage.
    - **A null expiry** (rows from before this step, promotional or lifetime grants): the stored plan also stands.
11. **What the screens show as the plan:** what RevenueCat last reported for this user, otherwise the server's plan from the profile sync, otherwise free. The sync engine and the held reflections keep following **the server's plan only**, because the server decides the 402.
12. **After a purchase or a restore**, the app awaits `sync-subscription` (10 seconds) and then the profile sync before it answers. The Paywall's "Welcome" appears once the server knows, and `upgradeWatcher` resends the reflection the free limit held. A failed sync does not fail the purchase: decision 13 and the webhook catch up.
13. **When the app comes to the front:**
    - **First:** it re-reads the entitlement, since there are no update events in Expo Go.
    - **If RevenueCat's plan and the server's plan differ:** it calls `sync-subscription` once for that foreground, then the profile sync.
    - **Sign-in:** the same check runs once the first entitlement and the first profile sync have both answered.
14. **The mock data source keeps step 16.**
    - **With `mock`:** the mock purchases, the mock plan and the five dev purchase flags stay exactly as they are.
    - **With `supabase`:** purchases are always RevenueCat's, and the "Mock plan (dev)" controls are hidden.
15. **Trials are advertised only when confirmed.**
    - **iOS:** `checkTrialOrIntroductoryPriceEligibility` answers `ELIGIBLE`.
    - **Android:** the package's `defaultOption.freePhase` exists; Play returns it only to eligible people.
    - **Expo Go:** eligibility is always unknown, so no trial appears and the Test Store products have none.
16. **Purchase errors map to the step 16 codes:**

    | RevenueCat | app code |
    | --- | --- |
    | `userCancelled`, or `PURCHASE_CANCELLED_ERROR` | `CANCELLED` |
    | `PAYMENT_PENDING_ERROR` | `PENDING` |
    | `NETWORK_ERROR`, `OFFLINE_CONNECTION_ERROR` | `NETWORK` |
    | `PURCHASE_NOT_ALLOWED_ERROR` | `NOT_ALLOWED` |
    | `PRODUCT_ALREADY_PURCHASED_ERROR` | `ALREADY_OWNED` (usePaywall already restores) |
    | anything else, including `PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR` (the Test Store's failed purchase) and `STORE_PROBLEM_ERROR` | `UNKNOWN` |
17. **Logs.**
    - **The SDK:** log level **WARN** in every build; its DEBUG and INFO lines print the app user id.
    - **The app** never logs CustomerInfo, a receipt, a key, a user id or a price.
    - **The functions** never log a webhook body, a RevenueCat response, a key or a user id (only the 8-character hash). The log line gains `billing` (one word) and `billingMs`.
18. **Names:**
    - **Functions:** `sync-subscription` (the app's) and `revenuecat-webhook` (RevenueCat's), both `verify_jwt = false`.
    - **Server error:** `BILLING_UNAVAILABLE` (503).
    - **App error:** the gateway's `BILLING_UNAVAILABLE`.
19. **Before launch, RevenueCat's Sandbox Testing Access is limited to the test accounts** (a dashboard setting, added to AGENTS.md's "Before a store build"). The server counts sandbox purchases like real ones, because the Test Store and TestFlight need that.
20. **The hand-set Pro of the test account ends.** After this step, `gracehush17b` is Pro only if RevenueCat says so.
    - **A Test Store purchase:** lasts at most 5 hours (a yearly product renews hourly, five times).
    - **To keep it Pro for testing:** grant it a promotional `pro` entitlement in RevenueCat (Customers, find its Clerk id, **Grant entitlement**, lifetime).

## Out of scope

- App Store Connect, Google Play, their products and platform keys (section G).
- Real store purchases, trial eligibility in a native build, pending purchases and the update listener: these need step 35 or an Android build.
- `react-native-purchases-ui`, Web Billing (`rcb_`), promotional offers, plan changes (RevenueCat handles a switch between yearly and monthly; the server just re-reads), and SDK 11.
- Deleting the RevenueCat customer on account deletion: step 31 keeps `// TODO(31)`.
- Analytics events: step 34 keeps `// TODO(34)`.
- Realtime: step 33.
- Any change to the Paywall's or Profile's layout or copy, other than the developer panel.

---

## 0. Before you write code

1. **Baseline, written down before any change.** These were the numbers at the review (2026-10-29). Record what you actually see: other work, such as step 08b's tab bar, may have moved them.
   - `npm run typecheck` and `npm run lint` exit 0.
   - The app-side suites: offline 44 of 44, journal-data 87, notifications 48, prayers 33, deletion 32, profile-sync 88, recording 68, playback 133, ambient 64, parity 7 of 7.
   - Deno (the commands in AGENTS.md, Linting and Validation): 380 tests, lint 77 files, fmt 89 files.
   - PGlite: 50 of 50 and 24 broken variants caught.
2. **The ten markers of this step**, each closed here or explained in the report:
   - `src/constants/app.ts:82` `TODO(30)` (RevenueCat's managementURL)
   - `src/constants/copy.ts:970` `TODO(30)` (the pending note's promise)
   - `src/data/journalRepository.ts:282` and `:515` (`TEMP(30)`: the mock plan)
   - `src/data/mock/offerings.ts:3` `TEMP(30)`
   - `src/services/account.ts:74` `TODO(30)` (log out)
   - `src/services/externalLinks.ts:21` `TODO(30)`
   - `src/services/purchases.ts:1-2` `TEMP(30)` and `TODO(30)`
   - `src/utils/pricing.ts:19` `TODO(30)`

   There is no `TODO(30)` in `supabase/`.
3. **Keys:** check the key names in both `.env.local` files without printing a value (a small Node script that prints names and set or empty). If `EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY` or `REVENUECAT_SECRET_API_KEY` is missing, stop and ask for section B. Write no code before that.
4. **Red first:** write the new checks (section 12) before the code, run them against the tree as it is, and write down the red numbers.

---

## 1. The package

`npx expo install react-native-purchases@10.16.0`. `npx expo install` may exit 1 only because it cannot write a plugin into the dynamic `app.config.ts`: add nothing, because this package needs no plugin. Then:
- **Line endings:** restore CRLF in `package.json` and the lockfile if npm rewrote them with LF. Count `\r` before and after.
- **What changed:** `git diff --stat package.json package-lock.json` shows only the new package and its two RevenueCat dependencies (`@revenuecat/purchases-js-hybrid-mappings` and `@revenuecat/purchases-typescript-internal` 19.17.0).
- **Clean bill:** `npx expo install --check` and `npx expo-doctor` report nothing new.
- **Launch:** the app still opens in Expo Go. In development the SDK prints `[RevenueCat] Expo Go app detected. Using RevenueCat in Browser Mode.` once.

`src/services/revenuecat.ts` is the only file that imports `react-native-purchases` (as `notifications.ts` is for expo-notifications).

---

## 2. Keys: `src/constants/env.ts`

Add, each read by its full name:

```ts
export const REVENUECAT_TEST_STORE_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_KEY ?? "";
export const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";

export type RevenueCatKeyKind = "test_store" | "app_store" | "play_store";
export type RevenueCatKeyChoice =
  | { kind: RevenueCatKeyKind; apiKey: string }
  | { kind: "none"; reason: "missing" | "secret_key" | "test_key_in_release" };

// Pure: which key this build may use (decision 3). A secret key is never used; a release build never uses the Test Store
// key (RevenueCat crashes a release build that does, on purpose); Expo Go can use only the Test Store key.
export function chooseRevenueCatKey(input: {
  inExpoGo: boolean;
  isDev: boolean;
  platform: "ios" | "android" | "other";
  testKey: string;
  iosKey: string;
  androidKey: string;
}): RevenueCatKeyChoice;
```

The rules, in order:
1. Any of the three that starts with `sk_` → `none` (`secret_key`), whatever else is set.
2. **Expo Go:** the test key when it starts with `test_`, otherwise `none` (`missing`).
3. **A native build:**
   1. The platform's key when it is set and has its prefix (`appl_` for iOS, `goog_` for Android).
   2. Otherwise, only in development, the test key.
   3. Otherwise `none`: `test_key_in_release` when only a test key is set, `missing` when nothing is.

`.env.example` gets the three names with empty values and a comment: "public SDK keys; the Test Store key is for Expo Go and development builds only".

---

## 3. The migration, its checks and the offline runner

### 3.1 `supabase/migrations/20261029120000_subscription_sync.sql` (new)

Idempotent and additive:

```sql
-- Step 30: what the server keeps about a person's subscription, besides the plan itself (subscription_tier, step 17).
-- Both columns are written only by the service role (syncSubscription in _shared/billing/revenuecat.ts). The app can read
-- them on its own row through the table-wide SELECT of the baseline, and it has no INSERT or UPDATE grant on either.
alter table public.users_profile
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists subscription_synced_at timestamptz;

comment on column public.users_profile.subscription_expires_at is
  'When the pro entitlement ends, grace period included (null: no end, or never synced). Written by the server only.';
comment on column public.users_profile.subscription_synced_at is
  'When the server last read this person''s RevenueCat customer. Written by the server only.';
```

No grant and no policy changes. The app's column grants (step 18) do not include the new columns, so it cannot write them.

### 3.2 `supabase/tests/rls_selftest.sql`: checks 51 to 53

In the file's own style:
- **51:** `authenticated` cannot update `subscription_expires_at`, even on its own row.
- **52:** `authenticated` cannot update `subscription_synced_at`.
- **53:** `service_role` can update both.

### 3.3 `supabase/tests/run-in-pglite.mjs` and `preflight.sql`

- **Three broken variants, each caught by its check:**
  - a grant of UPDATE (`subscription_expires_at`) to `authenticated` (fails check 51);
  - a grant of UPDATE (`subscription_synced_at`) to `authenticated` (fails check 52);
  - the service role's grant revoked (fails check 53).
- **`preflight.sql`:** one row that lists the two columns.
- **The runner:** all migrations twice under both settings of "Automatically expose new tables", the self-tests twice, nothing left behind, and every variant caught.

---

## 4. The server's billing module: `supabase/functions/_shared/billing/revenuecat.ts` (new)

The only code that talks to RevenueCat. Step 31 imports it for the customer delete.

```ts
export const PRO_ENTITLEMENT_ID = "pro";
export const REVENUECAT_API = "https://api.revenuecat.com/v1";

export type PaidTier = "trial" | "pro";
export type Plan = { tier: "free" | PaidTier; expiresAt: string | null };

// From the environment: the V1 secret key. Anything else, or nothing, is bad_config (the caller logs the secret's NAME).
export function readBillingConfig(env: (name: string) => string | undefined):
  | { ok: true; apiKey: string }
  | { ok: false; reason: "bad_config:REVENUECAT_SECRET_API_KEY" };

// The fields this app reads from GET /v1/subscribers/{id}. Everything else in the answer is ignored and never logged.
export type Subscriber = {
  entitlements: Record<string, { expires_date: string | null; grace_period_expires_date: string | null; product_identifier: string }>;
  subscriptions: Record<string, { period_type: string; is_sandbox: boolean }>;
};

// One read. attempts 2 by default: one retry after about 1 s on 429, a 5xx, a timeout or a dropped connection, never on
// another 4xx. Each attempt has its own timeout (8 s by default). The body is checked by hand-written guards (no `any`).
export function fetchSubscriber(apiKey: string, userId: string, options?: {
  attempts?: number; timeoutMs?: number; fetch?: typeof fetch;
}): Promise<{ ok: true; subscriber: Subscriber } | { ok: false; reason: string }>;

// Pure (decision 6): `pro` is active when its expires_date is null (lifetime) or later than now, or its
// grace_period_expires_date is later than now. Active and its product's subscription has period_type "trial" → trial;
// active otherwise → pro; not active → free. expiresAt is the later of the two dates (null for lifetime; for free, the last
// expires_date or null). An unparsable date counts as absent.
export function planFromSubscriber(subscriber: Subscriber, now: Date): Plan;

// Reads RevenueCat and writes subscription_tier, subscription_expires_at and subscription_synced_at on this user's row
// (service role, .eq("id", userId), .select("id")). No row → updated false and nothing is created. It never throws.
export function syncSubscription(admin: SupabaseClient, apiKey: string, userId: string, now?: Date, options?: {
  attempts?: number; timeoutMs?: number; fetch?: typeof fetch;
}): Promise<{ ok: true; plan: Plan; updated: boolean } | { ok: false; reason: string }>;
```

- **The request:** `GET ${REVENUECAT_API}/subscribers/${encodeURIComponent(userId)}` with `Authorization: Bearer <apiKey>` and `Accept: application/json`.
- **Failure reasons** are words only: `http_401`, `http_404`, `http_429`, `http_5xx`, `timeout`, `network`, `bad_body`, `db:update`. Never a body or a message.
- **Before writing `planFromSubscriber`**, the implementer calls the real endpoint once with the key from section B, for a customer the Test Store bought for in Part B. Use a scratch script in the scratchpad that prints **only field names and value types**, never a value, and confirm the shape above. That is the prompt 22 lesson: probe the real endpoint first.

---

## 5. `sync-subscription` (new function, called by the app)

`supabase/functions/sync-subscription/`: `index.ts` (only `Deno.serve(handler)`), `handler.ts`, `deno.json` (the same two pinned imports as the others), `handler_test.ts`.

1. OPTIONS → 204 with the CORS headers the other functions send. A method other than POST → 405 `METHOD_NOT_ALLOWED`.
2. `verifyClerkRequest` (`_shared/auth.ts`). The user id comes only from the token, and the body is ignored. No token, or a bad one → 401.
3. **Configuration:** `readBillingConfig`. Bad config → 500 `INTERNAL`, logged as `billing: bad_config:REVENUECAT_SECRET_API_KEY`.
4. **Read the row** (`subscription_tier, subscription_expires_at, subscription_synced_at`, `.eq("id", userId)`). No row → 404 `NOT_FOUND`.
5. **Throttle:** `subscription_synced_at` under 10 seconds ago → 200 with the stored plan and no RevenueCat call (`billing: throttled`).
6. **Sync:** `syncSubscription` → 200 `{ tier, expiresAt }` (`billing: synced`). RevenueCat unreachable → 503 `BILLING_UNAVAILABLE` (`billing: failed:<reason>`).
7. **The log line:** one per request, through `blankLogLine` with `billing` and `billingMs`.

`supabase/config.toml` gets:

```toml
[functions.sync-subscription]
# The same Clerk session token, checked the same way (_shared/auth.ts), so the same setting.
verify_jwt = false
```

**The contract** goes in `process-entry/contracts.ts`, and the same types in `src/types/index.ts`, with two lines in `src/types/contractParity.ts`:

```ts
export type SyncSubscriptionResponse = { tier: SubscriptionTier; expiresAt: string | null };
export type SyncSubscriptionErrorCode = "UNAUTHORIZED" | "METHOD_NOT_ALLOWED" | "NOT_FOUND" | "BILLING_UNAVAILABLE" | "INTERNAL";
```

**`_shared/errors.ts`:** add `BILLING_UNAVAILABLE` to `ErrorCode`, `STATUS_BY_CODE` (503) and the message map: "We couldn’t check your subscription right now. Please try again in a moment." (It is never shown in the app, which treats this call as best effort.)

---

## 6. `revenuecat-webhook` (new function, called by RevenueCat)

`supabase/functions/revenuecat-webhook/`: `index.ts`, `handler.ts`, `signature.ts` (pure: parse and verify the header), `deno.json`, `handler_test.ts`, `signature_test.ts`.

1. **Method:** POST only, otherwise 405. No CORS: browsers never call it.
2. **Configuration:** `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_WEBHOOK_SIGNING_SECRET` and the billing key must all be set. If not → 500, logged as `billing: bad_config:<NAME>`.
3. **The raw body:** read with `await req.text()` **before** anything parses it (at most 256 KB, otherwise 413), and never re-stringify it.
4. **Authorization:** the header must equal `REVENUECAT_WEBHOOK_AUTH`, compared in constant time. Otherwise → 401, logged as `billing: bad_auth`.
5. **Signature:** `X-RevenueCat-Webhook-Signature` must parse as `t=<unix seconds>,v1=<64 hex>`.
   - **Check:** HMAC-SHA256 with `crypto.subtle`, keyed by the signing secret, over `` `${t}.${rawBody}` ``, compared in constant time, with `|now − t| ≤ 300` seconds.
   - **Missing, malformed, wrong or stale** → 401, logged as `billing: bad_signature`. Nothing about the body is logged.
6. **Parse:** `JSON.parse` the raw body. Not JSON, or no `event` object → 400.
7. **Test events:** `event.type === "TEST"` → 200 with no RevenueCat call (`billing: skipped`).
8. **The ids to sync:**
   - **For `TRANSFER`:** every string in `event.transferred_from` and `event.transferred_to`.
   - **Otherwise:** `event.app_user_id`.
   - **Dropped:** ids that start with `$RCAnonymousID:` (there should be none, decision 4), duplicates, and ids with no `users_profile` row (`billing: unknown_user`).
   - Unknown event types are still synced (RevenueCat adds types).
9. **Sync:** each id in turn with `syncSubscription`.
   - **Every sync succeeded** (or there was nothing to sync) → 200 (`billing: synced`).
   - **Any RevenueCat failure** → 500 (`billing: failed:<reason>`), so RevenueCat retries the whole event. Syncing again is harmless (finding 6).
   - **Time:** well under RevenueCat's 60 seconds (two attempts of 8 seconds per id).
10. **The log line:** only the event type (one word, from RevenueCat's list or `other`), the status, `billing`, `billingMs` and the hashed user id of the first id. Never the body, an id, a price or a store transaction.

`supabase/config.toml`:

```toml
[functions.revenuecat-webhook]
# RevenueCat sends no Clerk token. The function checks RevenueCat's Authorization header and HMAC signature instead.
verify_jwt = false
```

---

## 7. process-entry: the expiry guard (decision 10)

- **`lifecycle.ts` `readProfile`:** also select `subscription_expires_at`, and return it as `expiresAt` (string or null).
- **`handler.ts`:** just before `checkDevotionalLimit`, when the tier is trial or Pro and `expiresAt` is set and earlier than now:
  1. Call `syncSubscription(admin, apiKey, userId, now, { attempts: 1, timeoutMs: 6000 })`.
  2. Use its `plan.tier` for the limit.
  3. **Billing not set up, or a failed sync:** keep the stored tier and log `billing: off` or `billing: failed:<reason>`. Never throw from this step.

  In every other case nothing is called and `billing` is null.
- **`_shared/limits/weekly.ts` does not change.**
- **`fakes.ts`** answers RevenueCat's `GET /v1/subscribers/{id}` from a scripted map, and its `users_profile` keeps the two new columns.

---

## 8. The app: gateway, store and the RevenueCat service

### 8.1 `src/api/journalApi.ts`

- **The name:** `FunctionName` gains `"sync-subscription"`.
- **The call:** `syncSubscription(): Promise<FunctionResult<SyncSubscriptionResponse>>` calls `callFunction("sync-subscription", {}, SYNC_SUBSCRIPTION_TIMEOUT_MS, isSyncSubscriptionResponse)`.
- **The guard:** checks `tier` is one of the three words and `expiresAt` is a string or null.
- **`src/constants/app.ts`:** add `PRO_ENTITLEMENT_ID = "pro"` and `SYNC_SUBSCRIPTION_TIMEOUT_MS = 10_000`.

### 8.2 `src/store/entitlementStore.ts` (new, not persisted)

```ts
type EntitlementState = {
  userId: string | null;              // whose entitlement this is
  keyKind: RevenueCatKeyKind | "none" | null; // null before the service has started
  tier: SubscriptionTier | null;      // what RevenueCat last reported for userId; null before it answered
  managementUrl: string | null;
  checkedAt: number | null;
  lastSync: { at: number; ok: boolean; code: string | null } | null; // the app's last sync-subscription call
};
```

Written only by `services/revenuecat.ts` and `services/subscriptionSync.ts`. `clear()` runs at sign-out.

### 8.3 `src/services/revenuecat.ts` (new: the only importer of `react-native-purchases`)

- **`startRevenueCat(userId)`:**
  1. Choose the key (section 2, with `isRunningInExpoGo()` from `expo`, `__DEV__` and `Platform.OS`).
  2. **Key `none`:** store it and stop. Purchases are then unavailable.
  3. **The first time:** `Purchases.setLogLevel(LOG_LEVEL.WARN)`, then `Purchases.configure({ apiKey, appUserID: userId })`.
  4. **Later, for another user:** `Purchases.logIn(userId)`.
  5. **Then** `refreshEntitlement()`.
  6. **In a native build:** register one `addCustomerInfoUpdateListener`, which writes the store. In Expo Go it never fires: finding 2.
- **`refreshEntitlement(): Promise<SubscriptionTier | null>`:** `getCustomerInfo()` → `tierFromCustomerInfo` → the store (`tier`, `managementUrl`, `checkedAt`). A failure leaves the store as it was.
- **`tierFromCustomerInfo(info)` (exported, pure):** `entitlements.active[PRO_ENTITLEMENT_ID]` with `periodType === "TRIAL"` → `"trial"`; any other active one → `"pro"`; none → `"free"`.
- **The calls `purchases.ts` needs:** `loadCurrentOffering()`, `checkEligibility(productIds)`, `buyPackage(identifier)`, `restore()`. Each returns plain SDK objects, or throws the SDK's error unchanged.
- **`endRevenueCatSession()`:** if configured and `!(await Purchases.isAnonymous())`, then `Purchases.logOut()`; errors are ignored. Then clear the store.

### 8.4 `src/services/subscriptionSync.ts` (new)

- **`syncPlanNow(): Promise<boolean>`:**
  1. `syncSubscription()` from the gateway, then, when it succeeded, `await syncProfile()`.
  2. Record `lastSync` (time, ok, the gateway's code).
  3. Development only: one line `[billing] sync <code>`. Never an id, a tier or a time.
- **`startPlanWatch(userId)` and its stop function**, started by the auth bridge with the profile sync:
  1. On every AppState `active`: `refreshEntitlement()`.
  2. Then, when the store's tier and the profile prefs snapshot's `subscriptionTier` are both known for this user and differ: `syncPlanNow()`, once per foreground.
  3. **Sign-in:** the same check runs once the first entitlement and the first profile sync have both answered.

---

## 9. `src/services/purchases.ts` (same exports, signatures and return shapes)

Remove `// TEMP(30)` and `// TODO(30)`. When `getDataSource() === "mock"`, every function runs the step 16 mock exactly as it does now (decision 14). Otherwise:

- **`getCurrentOffering()`:**
  1. `loadCurrentOffering()`. None, an error, or no key → `null` (the Paywall's unavailable state).
  2. **Map** `availablePackages` with `packageType` `ANNUAL` → `annual` and `MONTHLY` → `monthly` to `PlanPackage`:

     | `PlanPackage` field | from the SDK |
     | --- | --- |
     | `id` | `identifier` |
     | `productId` | `product.identifier` |
     | `priceString`, `price`, `currencyCode` | the product's own |
     | `periodLabel` | from `subscriptionPeriod` (`P1Y` → `"year"`, `P1M` → `"month"`) |
     | `pricePerMonthString` | `product.pricePerMonthString` |
     | `introOffer` | below |

     Skip any other package, and any product with no period.
  3. **`introOffer`:**
     - **iOS:** `product.introPrice` with price 0 → `{ kind: "free_trial", periodDays }`, from `periodUnit` × `periodNumberOfUnits` (DAY 1, WEEK 7, MONTH 30, YEAR 365).
     - **Android:** `product.defaultOption?.freePhase` → the same, from its `billingPeriod`.
     - **Otherwise:** `null`.
  4. Keep the SDK package objects in a module map by identifier, for `purchasePackage`.
- **`isTrialEligible(packageId)`** (decision 15):
  - **Expo Go, or no key:** `false`.
  - **iOS:** `checkEligibility([productId])` is `INTRO_ELIGIBILITY_STATUS_ELIGIBLE`.
  - **Android:** the package's free phase exists.
  - **Unknown or an error:** `false`.
- **`purchasePackage(packageId)`:**
  1. **No key** → `NOT_ALLOWED`.
  2. `buyPackage`, then `tierFromCustomerInfo(customerInfo)`, then write the store.
  3. **Free after a purchase** (the product is not attached to `pro`) → `UNKNOWN`.
  4. **Otherwise:** `await syncPlanNow()` (its failure is ignored), then `{ ok: true, tier }`.
  5. **Errors:** decision 16.
- **`restorePurchases()`:**
  1. **No key** → `{ ok: false, code: "UNKNOWN", message }`.
  2. `restore()`, then the tier, the store and `await syncPlanNow()`.
  3. Answer `{ ok: true, restored: tier !== "free", tier }`.
  4. **Errors:** `NETWORK` or `UNKNOWN`.

`src/data/mock/offerings.ts` stays, for the mock data source: its `TEMP(30)` comment becomes "the mock data source's offering (step 16); the real one comes from RevenueCat". `src/utils/pricing.ts` loses its `TODO(30)`, because the mapping fills `pricePerMonthString`.

---

## 10. Wiring

- **`src/components/SupabaseAuthBridge.tsx`:** in the effect that starts `watchPlan`, also `startRevenueCat(userId)` and `startPlanWatch(userId)`, and stop both when the user changes or signs out.
- **`src/services/account.ts`:** replace `// TODO(30): Purchases.logOut()` with stopping the plan watch and `await endRevenueCatSession()`. Keep the cleanup's other order. The profile-sync and offline harnesses fake both modules (section 12).
- **`src/data/journalRepository.ts`:**
  - **`getKnownTier()` with the supabase source:** returns the server's plan only (the snapshot). The mock tier no longer counts there.
  - **`getUsage()`:** shows `useEntitlementStore` tier for the signed-in user when known, otherwise `getKnownTier()`, otherwise free (decision 11). The mock source is unchanged.
  - **`setMockSubscriptionTier` and `getMockSubscriptionTier`:** stay, for the mock source only. Their `TEMP(30)` comments become "the mock data source's plan (step 16)".
- **`src/hooks/useEntitlement.ts` (new):** `{ tier, isPaid, known, managementUrl, refresh }`, from the store. Step 34 reads it.
- **`src/hooks/useProfileSettings.ts`:** reloads the plan card when the store's tier changes while Profile is mounted.
- **Profile:**
  - **Manage subscription:** `openManageSubscription(managementUrl)`.
  - **Restore purchases:** calls the real `restorePurchases` (it already does through `purchases.ts`).
- **`src/services/externalLinks.ts`:** `openManageSubscription(url?: string | null)` opens `url` when it is an `https:` address, otherwise the step 15 store page. Remove both `TODO(30)` lines (here and in `app.ts`).
- **`src/constants/copy.ts:970`:** the comment's `TODO(30)` goes. In a native build the update listener and the plan watch make "We’ll unlock Pro as soon as it’s confirmed" true. Expo Go has no pending purchases.
- **The developer panel (`DevToolsPanel.tsx`):**
  - **"Supabase check (dev)" gains four lines:**
    - `revenuecat key: test store | app store | play store | none (<reason>)`
    - `entitlement: free | trial | pro | not known`
    - `server plan: free | trial | pro | not known`
    - `last plan sync: ok | <code> | none`
  - **A new button:** "Sync plan now (dev)".
  - **"Mock plan (dev)":** shown only with the mock source.

No other screen changes. The Paywall's states, copy and layout stay as step 16 and its follow-up left them.

---

## 11. Privacy and safety

- **Sent to RevenueCat:** the Clerk user id and purchase data only (the legal drafts already list RevenueCat, `docs/privacy-policy.md` line 69). Never journal content.
- **Logged:** no key or id, anywhere.
- **Crisis handling:** unaffected. The limit check, and the expiry guard before it, run after the screening, so a crisis entry still never reaches the limit.

---

## 12. Verification

### Part A: automated

1. **Deno.**
   - **`_shared/billing/revenuecat_test.ts`:**
     - `planFromSubscriber`: lifetime, active, trial, grace period, expired, no `pro`, an unparsable date.
     - `fetchSubscriber`: 200; 401 with no retry; 429 and 500 retried once; a timeout; a dropped connection; a body that is not the shape.
     - `syncSubscription`: it writes the three columns filtered by id, does nothing for no row, never inserts, and never throws.
   - **`signature_test.ts`:** valid; a wrong secret; a stale and a future timestamp; a re-stringified body fails; malformed headers.
   - **The webhook handler:**
     - Authorization: missing or wrong.
     - Requests: a GET; a body that is not JSON; a body over 256 KB.
     - Events: TEST with no RevenueCat call; INITIAL_PURCHASE syncs once; TRANSFER syncs both lists; an anonymous id is skipped; an unknown user is skipped.
     - Outcomes: a RevenueCat failure answers 500; the log line holds no body, id or price.
   - **`sync-subscription`:** 401; the throttle; success; 503; 404; bad config.
   - **process-entry:**
     - An expired Pro that RevenueCat calls free is limited.
     - RevenueCat down: still allowed.
     - A null expiry, or one not passed: no RevenueCat call.
   - **The suites:** the three folders join every Deno command in AGENTS.md (check, lint, test).
2. **App-side, `supabase/tests/billing/run.cjs` (new).**
   - **Setup:** on the journal-data world, which fakes `sync-subscription` like the real function, and a fake `react-native-purchases` shaped like 10.16.0. It has a Browser Mode profile (no listener events, eligibility unknown, the three-button alert outcomes) and a native profile.
   - **Checks:**
     - `chooseRevenueCatKey` for every rule.
     - Configure: once, logIn on a switch, never before sign-in, logOut at sign-out.
     - The tier mapping and the offering mapping (iOS intro price, Android free phase).
     - Eligibility per platform; every row of the error table.
     - A purchase awaits sync-subscription and then the profile sync; restore.
     - The foreground mismatch sync, once per foreground.
     - `getUsage` shows the entitlement first, while `getKnownTier` and the engine follow the server only.
     - The mock source is unchanged (the five dev flags).
     - The development log holds no id, key, price or tier word.
3. **Older harnesses.** `account.ts` and the auth bridge import the new services, so profile-sync, offline and journal-data fake `@/services/revenuecat` and `@/services/subscriptionSync` the way earlier steps faked `@/services/affirmationScheduler`. Each suite keeps its count.
4. **SQL:** PGlite as in 3.3.
5. **Parity:** `npm run typecheck` fails when the two contract copies differ (prove it once with an extra field, then restore).
6. **Exports:** `expo export` for both platforms, one at a time. Grep the unminified bundle for `Test Store`, `Browser Mode` (the SDK's own strings) and `sync-subscription`. No `TEMP(30)` or `TODO(30)` is left. The release gate (`grep -rnE "TEMP\(|TODO: real" src`) prints 5 lines: the two `TEMP(31)` and the three `TODO: real` constants. It was 9.
7. **Breakage smoke test**, in a scratch copy and never in the repo. At least these, each caught by a named check:
   - the auth check removed;
   - the signature check skipped when its header is missing;
   - the TEST short-cut removed;
   - a TRANSFER's `transferred_to` ignored;
   - the grace period ignored;
   - the trial mapping swapped;
   - the throttle removed;
   - the expiry guard blocking on an outage;
   - the release build allowed a test key;
   - a secret key accepted;
   - logOut not called;
   - the purchase not awaiting the sync;
   - `getKnownTier` reading the entitlement.

### Part B: the phone walk-through (iPhone, Expo Go, the Test Store)

**Before B0:**
- **Restart:** `npx expo start -c`, then force-quit and reopen Expo Go.
- **Accounts:** a **new** test account `gracehush30+clerk_test@example.com` (code `424242`), free.
- **Cost:** about 20 cents of Gemini and Text-to-Speech for B6's four reflections. RevenueCat costs nothing.
- **Keep Expo Go in front.** Where a **Do** line lists several taps, the implementer gives them one at a time.

- **B0.** Do: sign in as the new account. Expect: data source `supabase`; key `test store`; entitlement `free`; server plan `free`; nothing waiting. Read: the Supabase check's lines through the inspector.
- **B1.** Do: Profile, the Pro card's button. Expect:
  - the Paywall with the Test Store's **$59.99 / year** and **$9.99 / month**;
  - "Save 50%";
  - no trial line;
  - the button "Subscribe for $59.99/year".

  Read: a screenshot, and `getCurrentOffering()` (prices and package kinds only).
- **B2.** Do: tap the button, then **Cancel** in RevenueCat's alert. Expect: nothing shown, entitlement still `free`, no function call. Read: the store and `getLastFunctionCall()`.
- **B3.** Do: tap it again, then **Test failed purchase**. Expect: the calm error line under the button, and entitlement `free`. Read: a fiber walk for the notice, and the store.
- **B4.** Do: tap it again, then **Test valid purchase**. Expect:
  - "Welcome to Gracehush Pro.";
  - entitlement `pro`;
  - last function call `sync-subscription 200`;
  - the server row (the app's own query): `subscription_tier` `pro`, `subscription_expires_at` about an hour ahead (the Test Store renews a yearly product hourly), `subscription_synced_at` just now.

  Read: the store, the gateway, and the row through the app's query.
- **B5.** Do: Continue, then Profile. Expect: "Gracehush Pro", the usage line gone, "Manage subscription". Read: a screenshot and `getUsage()`.
- **B6.** Do:
  1. Sign out, then sign in as a **second new** free account, `gracehush30b+clerk_test@example.com`.
  2. Make three written reflections, then a fourth.

  Expect: the fourth opens the limit Paywall, with "Your reflection is saved.". Read: the outbox item `limit_reached` and the 402.
- **B7.** Do: in that Paywall, Subscribe, then **Test valid purchase**. Expect: "Welcome…"; the server tier `pro`; the held reflection prepared by itself within seconds, with no tap, and the item gone from the outbox. Read: the engine's lines, the outbox and the server row.
- **B8.** Do: Profile, **Restore purchases**. Expect: "Your purchase is restored." Read: the notice and the store.
- **B9.** Do: in RevenueCat open the webhook's delivery list, and send a screenshot. Expect: INITIAL_PURCHASE deliveries with **200**. The functions' log (the dashboard) shows `billing: synced` and nothing else about the event. Read: the user's screenshot and the exported log line (field names only).
- **B10.** Do: sign out, then sign in as the first account. Expect: its own plan (`pro` from B4, within the Test Store's 5 hours), and no leak from the second account. Read: the store and the row.
- **B11.** Do: Profile, "Data source (dev)" → `mock`, then the Paywall's dev outcomes (Next purchase cancelled, pending). Expect: the step 16 mock behaves as before. Then switch back to `supabase`. Read: the dev store and the notices.

**Optional, about 30 minutes:**
- **B12 (expiry by webhook).** Do: on the second account buy **monthly** (the Test Store renews it every 5 minutes and ends it after 25), then wait about 30 minutes. Expect: an EXPIRATION delivery with 200, the server tier `free`, and the app showing Free at its next foreground.
- **B13 (the expiry guard).** Do: for an account whose RevenueCat entitlement has ended but whose row still says `pro` (set `subscription_tier` to `pro` and `subscription_expires_at` an hour back in the Table Editor), make a reflection as the fourth of the week. Expect: process-entry re-reads RevenueCat and answers 402. Read: the outcome and the function's log line `billing: synced`.

**Not checked on this target** (Expo Go): App Store and Google Play purchases, trial eligibility and the trial button, pending purchases, the customer-info listener, and a store's management page. All of these wait for step 35 or an Android development build.

---

## 13. AGENTS.md updates

- **Tech Stack:** the `react-native-purchases` line names 10.16.0, the Test Store in Expo Go, and "no react-native-purchases-ui". The RevenueCat customer id is the Clerk user id.
- **Backend / Edge Function Rules:**
  - the server-only secrets list replaces `REVENUECAT_WEBHOOK_SECRET` with the three new names;
  - the functions list gains `sync-subscription` and `revenuecat-webhook` (with their codes and their log words);
  - a new "Billing" block holds decisions 6, 7, 10 and 12, and states that the entitlement id is a constant.
- **Subscription Rules:** replace the step 16 mock paragraph with the real flow (decisions 3, 4, 11 to 16 and 19), and keep the launch pricing paragraph. Remove "Do not ship a build that takes payments between step 16 and step 30". Keep "the tier is set only on the server", now done by `syncSubscription`, not only the webhook.
- **Database Rules:** the two columns, server-written, with their checks (53 in all).
- **Architecture tree:**
  - `_shared/billing/` and the two function folders;
  - `src/services/revenuecat.ts`, `subscriptionSync.ts`, `src/store/entitlementStore.ts` and `src/hooks/useEntitlement.ts`;
  - the gateway's `syncSubscription`;
  - `supabase/tests/billing/` and its count.
- **Before a store build:**
  - the platform keys are in the build's environment, and no Test Store key is;
  - Sandbox Testing Access is limited to test accounts;
  - the gate's new line count.
- **SDK and Vendor Version Notes:** the react-native-purchases note added by this review, updated with what Part B showed.
- **The log:** a "Step 30" entry, with the phone walk-through results.

## 14. Report

- The ten markers, and how each was closed.
- The plan and webhook availability seen in the dashboard.
- The ids confirmed (`pro`, `default`, the two packages).
- The probe of `GET /subscribers` (field names only).
- The migration's checks.
- The files created, changed and deleted.
- Part A's numbers, red and green, and Part B's results.
- What was deployed.
- Every TODO left for steps 31, 33, 34 and 35.
