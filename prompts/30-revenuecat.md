# 30-revenuecat.md

Read AGENTS.md first and follow it strictly.

Connect real subscriptions. Replace the step 16 mocked purchase service
with react-native-purchases (RevenueCat), add a useEntitlement hook,
identify RevenueCat customers by Clerk user id, and keep
users_profile.subscription_tier correct on the server through a signed
RevenueCat webhook and a client-triggered sync function that both read
RevenueCat's customer record. Paywall and Profile keep their exact look
and copy.

AGENTS.md requires approval before dependencies, native config,
migrations, Edge Function deploys and pricing changes. Ask where this
prompt says ask. Never change prices, products or dashboard settings.

Docs (source of truth, follow exactly):

- https://www.revenuecat.com/docs/getting-started/installation/expo
- https://www.revenuecat.com/docs/getting-started/configuring-sdk
- https://www.revenuecat.com/docs/customers/identifying-customers
- https://www.revenuecat.com/docs/customers/customer-info
- https://www.revenuecat.com/docs/getting-started/displaying-products
- https://www.revenuecat.com/docs/getting-started/making-purchases
- https://www.revenuecat.com/docs/subscription-guidance/subscription-offers/ios-subscription-offers
  (trial eligibility on iOS)
- https://www.revenuecat.com/docs/test-and-launch/errors
- https://www.revenuecat.com/docs/integrations/webhooks
- https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
- https://www.revenuecat.com/docs/api-v1 (GET /subscribers)
- https://supabase.com/docs/guides/functions/auth (external webhooks)

---

## 1. Before writing code

1. Read src/services/purchases.ts (// TEMP(30)), src/data/mock/offerings.ts,
   src/utils/pricing.ts, src/hooks/usePaywall.ts,
   src/screens/PaywallScreen.tsx, src/screens/ProfileScreen.tsx (plan
   card, Manage subscription, // TODO(30)), src/services/account.ts,
   src/components/SupabaseAuthBridge.tsx, src/services/entryProcessor.ts
   and syncPolicy.ts (LIMIT_REACHED handling), src/store/devStore.ts,
   src/types/index.ts, supabase/functions/\_shared/ (auth, admin, errors,
   log, limits/weekly.ts), supabase/migrations/ and app.json.
2. List every // TEMP(30) and // TODO(30) in app and supabase/ with
   file:line. Each is closed here or explained in the report.
3. Ask the user:
   - "Which RevenueCat plan is the project on? Webhooks need the Pro
     plan." If webhooks aren't available, build everything except
     section 8's dashboard registration, and say so in the report.
   - The entitlement identifier (recommend 'pro') and the offering
     identifier (recommend 'default'), and the package types used
     (recommend Annual and Monthly).
     Never invent ids.
4. Ask before installing: `npx expo install react-native-purchases`.
   Do not install react-native-purchases-ui (the paywall is custom).
   Rebuild the dev client afterwards (step 05b: `npx expo prebuild --clean`,
   `npx expo run:android --port 8082`). Expo Go cannot run RevenueCat: if the
   app stops launching there, ask me whether to guard it or move testing to
   the Android build. The iPhone waits for the last step (AGENTS.md
   Instructional Memory).

---

## 2. Manual setup checklist (print it; never do it yourself)

App Store Connect

1. Sign the Paid Apps agreement and complete tax/banking (without this,
   products don't load).
2. Subscription group "Gracehush Pro": yearly and monthly products;
   introductory offer: free trial on the yearly product only (length
   per the user's decision, e.g. 7 days). Prices set by the user.
3. Create an In-App Purchase key and give it to RevenueCat
   (Project → Apps → App Store).
4. Sandbox tester accounts.
   Google Play Console
5. Subscription with yearly and monthly base plans; a free-trial offer
   on the yearly base plan. Prices set by the user.
6. Service account with financial permissions, added to RevenueCat.
7. License testers.
   RevenueCat
8. Entitlement 'pro' with all products attached; offering 'default'
   (current) with the Annual and Monthly packages.
9. Copy the public SDK keys (Apple and Google) and a secret API key
   (server only).
10. Webhooks (Pro plan): add the sync-revenuecat URL (section 8),
    enable HMAC signing, copy the signing secret (shown once), send
    events for production and sandbox.
    Ask the user to confirm before section 11 testing. Code can be written
    before that.

---

## 3. Environment

App (.env.local, .env.example; public SDK keys are client-safe):
EXPO_PUBLIC_REVENUECAT_IOS_KEY=
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=
Read them in src/constants/env.ts. Missing → purchases are unavailable
(Paywall shows its step 16 unavailable state); the app still runs.

Functions (supabase/functions/.env.example, empty values):
REVENUECAT*SECRET_API_KEY=
REVENUECAT_WEBHOOK_SECRET= # HMAC signing secret
REVENUECAT_ENTITLEMENT_ID=pro
The secret key and signing secret never appear in the app or any
EXPO_PUBLIC* variable.

---

## 4. Migration (approval gate)

Show the SQL and ask: "Add subscription expiry tracking and a webhook
event log?" Only on yes (step 18 process, local first, rls_test, types,
second yes before pushing):

alter table public.users_profile
add column if not exists subscription_expires_at timestamptz,
add column if not exists subscription_synced_at timestamptz;
-- service-role only: do NOT grant these to authenticated

create table if not exists public.revenuecat_events (
id text primary key,
type text not null,
received_at timestamptz not null default now()
);
alter table public.revenuecat_events enable row level security;
revoke all on public.revenuecat_events from anon, authenticated;
-- no policies: service role only

- Add rls_test cases: authenticated can't select revenuecat_events and
  can't update the two new profile columns.
- Regenerate types (`npm run types:db`).
- // TODO: delete revenuecat_events rows older than 90 days.

---

## 5. Server sync: \_shared/billing/revenuecat.ts

syncSubscription(admin, userId): Promise<{ tier: SubscriptionTier;
expiresAt: string | null }>

- GET https://api.revenuecat.com/v1/subscribers/{encodeURIComponent(userId)}
  with Authorization: Bearer REVENUECAT_SECRET_API_KEY. Timeout 10 s,
  one retry on 429/5xx. Use the field names from the API v1 page; if
  the page marks this endpoint deprecated, use the API v2 customer
  endpoint instead and report it.
- Entitlement = subscriber.entitlements[REVENUECAT_ENTITLEMENT_ID].
  Active when expires_date is null (lifetime) or > now, or
  grace_period_expires_date > now.
- Tier: active and the matching subscription's period_type is 'trial'
  → 'trial'; active otherwise → 'pro'; not active → 'free'.
- expiresAt = the later of expires_date and grace_period_expires_date.
- Update users_profile (service role, .eq('id', userId)):
  subscription_tier, subscription_expires_at, subscription_synced_at.
  No profile row → do nothing and return free (never create profiles
  here).
- Never log the response. Allowed: hashed user id, tier, status code,
  ms.

---

## 6. sync-subscription Edge Function (client-triggered)

supabase/functions/sync-subscription/index.ts, reusing \_shared:

- POST, verifyClerkRequest; userId only from the token.
- Throttle: if subscription_synced_at is under 10 seconds ago, return
  the stored tier without calling RevenueCat.
- syncSubscription → 200 { tier, expiresAt }.
- Errors use the step 19 envelope. RevenueCat unreachable → 503
  AI_UNAVAILABLE is wrong here: add BILLING_UNAVAILABLE (503) to the
  error map and the client union.
- config.toml: same verify_jwt choice as process-entry.

---

## 7. Free-limit change in process-entry (\_shared/limits/weekly.ts)

checkDevotionalLimit (step 22):

- Tier pro/trial and subscription_expires_at is null → allowed (old
  rows; sync on next app foreground fixes them).
- Tier pro/trial and subscription_expires_at < now → call
  syncSubscription once, then decide with the new tier.
- RevenueCat unreachable during that call → allowed (never block a paid
  user because of a RevenueCat outage); log "billing_sync_failed".
- Close the step 22 // TODO(30).

---

## 8. sync-revenuecat webhook Edge Function

supabase/functions/sync-revenuecat/index.ts:

- config.toml: verify_jwt = false (RevenueCat sends no Clerk token).
  Comment: "# Authenticated by HMAC signature".
- Read the raw body with `await req.text()` BEFORE parsing. Never
  re-stringify.
- Verify X-RevenueCat-Webhook-Signature "t=<unix>,v1=<hex>":
  HMAC-SHA256 with REVENUECAT_WEBHOOK_SECRET over `${t}.${rawBody}`
  (crypto.subtle), constant-time compare, |now − t| ≤ 300 s.
  Missing or invalid → 401, log "webhook_bad_signature" only.
- Parse JSON → event = body.event. Insert { id: event.id, type:
  event.type } into revenuecat_events with ON CONFLICT DO NOTHING.
  Already there → 200 (duplicate).
- User ids to sync:
  TRANSFER → event.transferred_from and event.transferred_to.
  Otherwise → event.app_user_id.
  Skip ids starting with "$RCAnonymousID:" and ids with no
  users_profile row (200, log "webhook_unknown_user").
- For each id: syncSubscription. Use EdgeRuntime.waitUntil to finish
  the work after responding 200 if the runtime supports it (check the
  Supabase docs); otherwise do it inline (it's fast). Total under
  20 s.
- Unknown event types → still sync (future-proof, per the docs).
- RevenueCat unreachable → delete the inserted event row and return 500
  so RevenueCat retries.
- TEST events from the dashboard → 200 without syncing.
- Logging: event type, hashed user id, outcome. Never the body.

---

## 9. App SDK: src/services/purchases.ts

Remove // TEMP(30). Keep every signature and return shape from step 16.

Setup (src/services/revenuecat.ts):

- configureOnce(userId): on the first sign-in,
  Purchases.configure({ apiKey: platform key, appUserID: userId }).
  Later account switches → Purchases.logIn(userId). Never configure
  before a Clerk user exists (no anonymous customers).
- Called from SupabaseAuthBridge after sign-in, before anything reads
  entitlements.
- Purchases.setLogLevel(DEBUG) only in **DEV**; production uses the
  default. Never log CustomerInfo.
- Sign out (signOutCleanup): if !(await Purchases.isAnonymous()),
  Purchases.logOut(). Errors ignored. Close the step 15 // TODO(30).

getCurrentOffering():

- Purchases.getOfferings() → offerings.current (or the configured
  offering id). None → null.
- Map availablePackages with packageType ANNUAL / MONTHLY to
  PlanPackage: id = identifier, productId, priceString, price,
  currencyCode, periodLabel from subscriptionPeriod (P1Y → year,
  P1M → month), pricePerMonthString when present (pricing.ts uses it
  first; close the step 16 // TODO(30)).
- introOffer: iOS → product.introPrice with price 0 → free_trial with
  periodDays from periodUnit × periodNumberOfUnits; Android → the
  default subscription option's free phase. Use the exact field names
  from the installed types.

isTrialEligible(packageId):

- iOS: Purchases.checkTrialOrIntroductoryPriceEligibility([productId])
  → ELIGIBLE only. Unknown → false (never advertise a trial you can't
  confirm).
- Android: true only when the package's default option has a free
  phase (Play only returns it to eligible users).

purchasePackage(packageId):

- Purchases.purchasePackage(pkg) → tierFromCustomerInfo(customerInfo).
- Map errors (RevenueCat error codes from the errors page):
  userCancelled / PURCHASE_CANCELLED → CANCELLED;
  PAYMENT_PENDING → PENDING; NETWORK → NETWORK;
  PURCHASE_NOT_ALLOWED → NOT_ALLOWED;
  PRODUCT_ALREADY_PURCHASED → ALREADY_OWNED; anything else → UNKNOWN.
- On success: call sync-subscription (await up to 5 s, ignore errors).
  restorePurchases(): Purchases.restorePurchases() → tier, then
  sync-subscription the same way.

tierFromCustomerInfo(info): entitlements.active[ENTITLEMENT_ID] →
periodType 'TRIAL' → 'trial', else 'pro'; none → 'free'.

---

## 10. Entitlement in the app

src/hooks/useEntitlement.ts:
{ tier: SubscriptionTier; isPro: boolean; loading: boolean;
managementUrl: string | null; refresh() }

- Purchases.getCustomerInfo() on mount and
  addCustomerInfoUpdateListener (remove on unmount).
- Works offline from the SDK cache. Before configure → loading.
- UI (plan card, Paywall "already a member", usage line) reads tier
  from this hook. The server limit stays the authority for submits.

Other wiring:

- Profile Manage subscription: managementUrl when present, otherwise
  the step 15 store URLs. Close the step 15 // TODO(30).
- App foreground: if the hook says pro/trial and the profile's
  subscription_tier is free (or the reverse), call sync-subscription
  once per foreground.
- Sync engine (step 24/25): on LIMIT_REACHED while useEntitlement says
  pro/trial, call sync-subscription, then retry the item once
  immediately instead of marking limit_reached.
- The step 25 resume after upgrade stays as is.
- Remove the step 17 in-memory tier override (// TEMP(30)). Mock
  scenarios still work when devStore.dataSource is 'mock' (purchases.ts
  keeps the step 16 mock behind that switch).

---

## 11. Testing

Local functions:

1. `deno test` for signature verification (valid, wrong secret, old
   timestamp, re-stringified body fails), tier mapping (lifetime,
   active, trial, grace period, expired), and TRANSFER id selection.
2. `npx supabase functions serve sync-revenuecat sync-subscription`.
   Send a signed sample event (build the signature in a small dev
   script with the local secret) → 200, profile updated; send it again
   → 200, no second sync (logs); bad signature → 401.
   Devices (dev build, sandbox / license testers):
3. Paywall shows real prices from the store in the device currency.
4. Trial-eligible sandbox account: "Start 7 days free trial"; after
   buying, an account that used it: "Subscribe for …".
5. Buy yearly with trial: Profile shows Pro trial; users_profile tier
   'trial' within seconds (sync-subscription), expires_at set.
6. Cancel the purchase sheet: nothing happens.
7. Restore on a second device signed into the same Clerk account: Pro.
8. Let a sandbox subscription expire (sandbox renewals are fast): tier
   returns to free (webhook, or the next foreground sync without
   webhooks).
9. Set subscription_expires_at in the past for a pro user in SQL and
   submit an entry as the 4th of the week: process-entry re-syncs and
   decides correctly.
10. Sign out: RevenueCat logs out; signing in as another account shows
    free.
11. Free user over the limit buys Pro from the limit paywall: the saved
    entry finishes automatically.
12. dataSource 'mock': the step 16 scenarios still work.

---

## 12. Deploy (approval gate)

Show test results and the checklist status. Ask: "Deploy
sync-subscription, sync-revenuecat and the updated process-entry?"
Only on yes: set the three secrets (values from the user, never
printed), deploy all three, then register the webhook URL
https://<project-ref>.supabase.co/functions/v1/sync-revenuecat in
RevenueCat (the user does it) and send a test event.

---

## 13. AGENTS.md updates

- Tech Stack: react-native-purchases; RevenueCat customer id = Clerk
  user id; no react-native-purchases-ui.
- Billing Rules: RevenueCat is the source of truth; the server tier is
  written only by syncSubscription (webhook or sync-subscription);
  subscription_expires_at guards expired access; grace period counts
  as Pro; prices never hardcoded; webhook verified by HMAC on the raw
  body; events deduplicated by id.
- Remove the "tier set only by the RevenueCat webhook" gap.

---

## 14. Rules

- Only react-native-purchases is new. No `any`. No layout or copy
  changes.
- Never log CustomerInfo, receipts, webhook bodies, keys or user ids.
- // TODO(31): delete the RevenueCat customer on account deletion
  (DELETE /subscribers/{id}) after the user confirms.
- // TODO(34): purchase events from step 16 with real outcomes.

Report: TEMP/TODO list and how each was closed; plan and webhook
availability; ids confirmed; migration decision; files created, changed,
deleted; test results 1–12; whether deployed; and every TODO left for
steps 31 and 34.
