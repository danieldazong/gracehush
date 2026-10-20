# 16-paywall-ui.md

Read AGENTS.md first and follow it strictly.

Build the Gracehush Pro paywall. It replaces the step 08 placeholder in
src/screens/PaywallScreen.tsx (remove // TEMP: replaced in step 16). This
step is UI plus mocked offerings, trial eligibility, purchase and restore
only. Real RevenueCat (react-native-purchases), entitlements and webhook
sync come in step 30. Do not install react-native-purchases or any
paywall UI library in this step.

Design reference: @prompt_material/08-paywall.png. Replicate it exactly:
layout, spacing, font sizes, colors, radii, shadows and alignment. Ignore
Google Stitch preview artifacts (state toggles, duplicate headers, device
frames). Use only the tokens in src/constants/theme.ts, the utilities in
global.css and existing components (PrimaryButton, ConfirmDialog). Do
not add new colors, fonts, radii or shadows. Gradients are allowed only
where AGENTS.md allows them (onboarding hero, player artwork). If the
screenshot uses a gradient, stop and ask before using one here. Text in
this prompt overrides text in the screenshot, including all prices,
counts and feature claims.

---

## 1. Before writing code

1. Read src/screens/PaywallScreen.tsx, src/screens/NewEntryScreen.tsx
   (the LIMIT_REACHED handling from step 10), src/screens/ProfileScreen.tsx
   (plan card + Restore from step 15), src/navigation/types.ts,
   src/navigation/RootNavigator.tsx, src/data/journalRepository.ts
   (getUsage), src/store/devStore.ts, src/types/index.ts,
   src/constants/app.ts, src/constants/copy.ts and src/utils/format.ts.
2. Read the Pro features in AGENTS.md. The paywall may list ONLY
   features that AGENTS.md defines as Pro for V1. If the screenshot
   lists a feature that isn't defined (for example Spiritual Memory /
   Insights, which is V2, or a feature with no gating rule), leave it
   out and list it in the report. If AGENTS.md defines no Pro feature
   list at all, stop and ask.
3. Confirm PRIVACY_POLICY_URL, TERMS_URL and the subscription management
   URLs exist in src/constants/app.ts (step 15). Reuse them. Never
   duplicate them.
4. Confirm the step 02 icon library has: x, check, sparkles (or star),
   infinity, headphones, waves, bell, shield, external-link. Do not
   install another icon set.

---

## 2. Types (src/types/index.ts)

Shape these like RevenueCat so step 30 maps the SDK 1:1:

type PackageKind = 'annual' | 'monthly';
type IntroOffer = {
kind: 'free_trial';
periodDays: number; // e.g. 7
periodLabel: string; // e.g. "7 days"
};
type PlanPackage = {
id: string; // RevenueCat package identifier
kind: PackageKind;
productId: string;
priceString: string; // localized, from the store
price: number; // numeric, for calculations only
currencyCode: string;
periodLabel: string; // "year" | "month"
introOffer: IntroOffer | null;
};
type Offering = { id: string; packages: PlanPackage[] };

type PurchaseErrorCode =
'CANCELLED' | 'PENDING' | 'NETWORK' | 'NOT_ALLOWED' |
'ALREADY_OWNED' | 'UNKNOWN';
type PurchaseResult =
| { ok: true; tier: 'trial' | 'pro' }
| { ok: false; code: PurchaseErrorCode; message: string };
type RestoreResult =
| { ok: true; restored: boolean; tier: SubscriptionTier }
| { ok: false; code: 'NETWORK' | 'UNKNOWN'; message: string };

No `any`.

---

## 3. Mock service: src/services/purchases.ts

Mark the whole file:
// TEMP(30): replace internals with react-native-purchases, keep
// signatures and return shapes.

getCurrentOffering(): Promise<Offering | null>
isTrialEligible(packageId: string): Promise<boolean>
purchasePackage(packageId: string): Promise<PurchaseResult>
restorePurchases(): Promise<RestoreResult>

Mock data lives in src/data/mock/offerings.ts:

- Annual: priceString "$59.99", price 59.99, currencyCode "USD",
  introOffer 7-day free trial.
- Monthly: priceString "$9.99", price 9.99, no introOffer.
- Mark the file: // PLACEHOLDER prices. Real prices are set in App Store
  Connect / Play Console and arrive via RevenueCat. Never copy these
  values into screens or copy.ts.

devStore additions (**DEV** only, not persisted):
nextPurchaseOutcome: 'success' | 'cancelled' | 'pending' | 'failed'
trialEligible: boolean // default true
restoreFindsPurchase: boolean // default false
offeringUnavailable: boolean // default false

Rules:

- About 800ms delay on every call.
- purchasePackage success: tier 'trial' if the package has an intro
  offer AND trialEligible, otherwise 'pro'. Update the in-memory mock
  profile's subscriptionTier, so Profile's plan card, getUsage and the
  free-limit mock all change for the rest of the session. After a trial
  is used, set trialEligible false for the session.
- restorePurchases: restoreFindsPurchase true sets the tier to 'pro' and
  returns restored true. Otherwise restored false with the current tier.
- offeringUnavailable makes getCurrentOffering return null.
- Never log email, user id or receipt data.

Pure helpers in src/utils/pricing.ts (unit-testable, no React):
annualSavingsPercent(annual, monthly): number | null
// Math.round((1 - annual.price / (monthly.price _ 12)) _ 100);
// null if <= 0 or currencies differ
pricePerMonthLabel(pkg): string | null
// annual only: Intl.NumberFormat(undefined, { style: 'currency',
// currency: pkg.currencyCode }).format(pkg.price / 12);
// null if formatting throws
// TODO(30): prefer the SDK's pricePerMonthString when present.
trialCtaLabel(pkg, eligible): string
renewalDisclosure(pkg, eligible, platform): string

---

## 4. Navigation

- Update RootStackParamList:
  `Paywall: { source: 'profile' | 'limit'; entryId?: string }`.
- Register Paywall in RootNavigator with presentation: 'modal',
  headerShown: false. Confirm the tab dock is hidden.
- In NewEntryScreen's LIMIT_REACHED handling (step 10): use
  navigation.replace('Paywall', { source: 'limit', entryId }) so Back
  never returns to the processing overlay. Pass entryId ONLY if the
  submit result says the entry was saved. If the result type has no such
  field, pass nothing and add // TODO(22): server returns entryId with
  LIMIT_REACHED.
- Closing the paywall:
  source 'profile' → navigation.goBack().
  source 'limit' → reset to the Journal tab (MainTabs → Journal).
- Crisis guard: if the screen is ever opened with an entryId whose entry
  isCrisis, immediately replace with Reflection { entryId }. Crisis
  outcomes are checked before LIMIT_REACHED in step 10. Confirm that
  order and keep it. // TODO(22): server checks crisis before the
  free-tier limit; crisis support is never paywalled.
- Update the Navigation Map in AGENTS.md: "Paywall — modal, from Profile
  plan card and the free-limit outcome of New Entry."

---

## 5. Hook: src/hooks/usePaywall.ts

- State union: loading | unavailable (with retry) | ready { offering,
  selectedId, eligibility: Record<packageId, boolean>, usage, tier,
  select(id), purchase(), restore(), purchasing, restoring, notice }.
- Parallel Promise.all: getCurrentOffering(), getUsage(), getProfile().
  Then eligibility per package that has an intro offer.
- Default selection: the annual package if present, otherwise the first.
- Ignore late responses and updates after unmount.
- purchase() and restore() can't run at the same time. Both disable
  every button while running.
- If the tier is already 'pro' or 'trial' when the screen loads, show the
  "You're already a Pro member" state (section 7) instead of the plans.

---

## 6. Screen layout: src/screens/PaywallScreen.tsx

SafeAreaView (linen, top + bottom edges). ScrollView for content and a
pinned footer for the CTA + disclosures + legal links, so the required
terms are always on screen next to the button. Horizontal padding 24
(20 when the width is under 360).

Header (height 44):

- Left 44×44 spacer. Right: x button 44×44, ink, accessibilityLabel
  "Close". Always visible from the first frame. Never delayed, faded in
  or hidden.

Limit banner (source 'limit' only, blush .card, padding 16):

- "You've used your {limit} free devotionals this week." (from getUsage,
  never hardcoded), and "They reset {weekday}." (formatWeekday of
  resetsAt; add it to utils/format.ts if missing).
- If entryId is present: "Your reflection is saved." Never show this
  line without an entryId.

Hero (per screenshot): images.logoMark in the icon tile style from
onboarding, eyebrow "GRACEHUSH PRO", and the title (Fraunces SemiBold,
per screenshot) "A devotional for every prayer." Subtitle DM Sans mauve:
"Unlimited personal devotionals, read aloud in a calm voice, whenever
you need them." Adjust the title and subtitle only if they contradict
the feature list from section 1.

Feature list: one row per verified Pro feature (section 1). Check icon
in a sage tile, DM Sans Medium 15 ink, an optional 13 mauve helper.
Plain facts only, no exaggeration.

Plan selector (src/components/paywall/PlanOption.tsx, reused per
package):

- Radio-style card, white, 1px petal border. When selected: 2px plum
  border and a plum filled radio. Height ≥ 64. accessibilityRole
  "radio", accessibilityState { checked }, all inside a container with
  accessibilityRole "radiogroup".
- Annual: "Yearly", "{priceString} / year", the "{pricePerMonth} / month"
  helper if available, and a terracotta "Save {n}%" chip only when
  annualSavingsPercent returns a number. Add a "Best value" chip only if
  the screenshot shows one.
- Monthly: "Monthly", "{priceString} / month".
- If eligible for the trial, show "{periodLabel} free" on that option.

Footer (pinned):

- PrimaryButton, height 56:
  eligible trial → "Start {periodLabel} free trial"
  otherwise → "Subscribe for {priceString}/{periodLabel}"
  Shows a spinner while purchasing.
- Disclosure, DM Sans Regular 12/18, mauve, centered, directly under the
  button (renewalDisclosure):
  trial, iOS: "Free for {periodLabel}, then {priceString} per
  {periodLabel}. Renews automatically until canceled. Cancel anytime in
  your App Store settings at least 24 hours before the trial ends."
  trial, Android: "Free for {periodLabel}, then {priceString} per
  {periodLabel}. Renews automatically until canceled. Cancel anytime in
  Google Play before the trial ends."
  no trial: "{priceString} per {periodLabel}. Renews automatically until
  canceled. Cancel anytime in your {App Store / Google Play} settings."
- Row of text buttons, DM Sans Medium 13 plum: "Restore purchases" ·
  "Privacy Policy" · "Terms of Use" (expo-web-browser if installed,
  otherwise Linking.openURL). If TERMS_URL is still the placeholder from
  step 15, keep it and list it in the report. Apple's standard EULA
  (https://www.apple.com/legal/internet-services/itunes/dev/stdeula/)
  is an acceptable Terms link on iOS if the user approves.
- Source 'limit' only: ghost "Maybe later" above the legal row, with the
  same behavior as close.

Never on this screen: countdown timers, "limited time" or "today only"
language, fake reviews, star ratings, testimonials, user counts, crossed-
out prices, auto-selected upsells, or crisis red.

---

## 7. States and outcomes

- loading: plum ActivityIndicator. The close button still works.
- unavailable (offering null or error): "Plans aren't available right
  now." / "Please check your connection and try again." Buttons "Try
  again" and "Close".
- already Pro/trial: a calm card "You're already a Pro member." plus
  "Manage subscription" (step 15 URLs) and "Close". No plans shown.
- purchase success: an inline success state replaces the footer:
  "Welcome to Gracehush Pro." / "Your devotionals are unlimited." and a
  PrimaryButton "Continue" that closes using the section 4 rules.
  // TODO(25): if source 'limit' and entryId, resume that entry's
  // devotional generation.
- CANCELLED: do nothing. No message, no dialog.
- PENDING: inline note "Your purchase is pending approval. We'll unlock
  Pro as soon as it's confirmed."
- NETWORK / NOT_ALLOWED / UNKNOWN: inline error under the button:
  "We couldn't complete your purchase. You haven't been charged." plus
  try again. (NOT_ALLOWED: "Purchases are turned off on this device.")
- ALREADY_OWNED: run restore automatically, then show its result.
- Restore: restored → the success state. Not restored → inline note "We
  didn't find a previous purchase for this account."
- Every inline note stays until the next action, never on a timer, and
  is announced with AccessibilityInfo.announceForAccessibility.

---

## 8. Profile wiring (small change only)

In ProfileScreen (step 15):

- "Restore purchases" now calls restorePurchases() from
  src/services/purchases.ts and shows the same result notes. Remove the
  step 15 placeholder note and its // TODO(30).
- "Start Free Trial" vs "Upgrade to Pro" uses isTrialEligible for the
  annual package. Remove that // TODO(30).
- Change nothing else in Profile.

---

## 9. Rules

- No new dependencies. No `any`. NativeWind first. StyleSheet only where
  AGENTS.md allows.
- New reusable component: PlanOption only. Keep the hero, feature list,
  footer and states inside the screen unless the file passes about 300
  lines. If it does, extract src/components/paywall/PaywallFooter.tsx
  and nothing else.
- Every string goes in src/constants/copy.ts under `paywall`. Prices,
  trial lengths and counts always come from data or helpers.
- Never log the price chosen with the user identity, receipts, email or
  journal content.
- // TODO(30): real offerings, eligibility, purchase, restore,
  entitlement "pro", Purchases.logIn(clerkUserId).
- // TODO(34): paywall_viewed { source }, paywall_plan_selected
  { package_kind }, purchase_started { package_kind, has_trial },
  purchase_completed { package_kind, tier }, purchase_failed { code },
  restore_completed { restored }. No ids, no prices tied to the user.

---

## 10. Verify

Run `npx expo start -c`, `npm run lint` and `npm run typecheck`. Then:

1. The layout matches 08-paywall.png on a 390-wide iPhone and a small
   Android phone. The CTA, disclosure and legal links are visible
   without scrolling.
2. The close button works from the first frame, in loading, error and
   success states.
3. Prices, per-month and "Save %" come only from the mock offering.
   Change the mock prices and the screen follows. Equal prices hide the
   savings chip.
4. trialEligible true vs false: the CTA label, option label and
   disclosure change correctly on iOS and Android.
5. Each nextPurchaseOutcome: success (Profile plan card shows trial/Pro
   after closing), cancelled (nothing happens), pending, failed.
6. Restore with and without a purchase, from both Paywall and Profile.
7. offeringUnavailable shows the unavailable state, and Try again
   recovers.
8. Source 'limit' via devStore.nextSubmitOutcome = 'limit': the banner
   counts are right, "Your reflection is saved." shows only with an
   entryId, and Maybe later / close lands on the Journal tab, never the
   processing overlay.
9. Crisis outcome never opens the paywall.
10. Already Pro: the plans are replaced by the "already a member" card.
11. VoiceOver/TalkBack: plans read as radio buttons with price and
    state, the disclosure is read, and every link is labelled.

Report: files created and changed; Pro features shown and any removed
from the screenshot; placeholder prices and URLs; icons used; copy keys
added; and every TODO left for steps 22, 25, 30 and 34.
