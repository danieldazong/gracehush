# 16-paywall-ui.md

Read AGENTS.md first and follow it strictly.

Build the Gracehush Pro paywall. It replaces the step 08 placeholder in `src/screens/paywall/PaywallScreen.tsx` (the path is NOT `src/screens/PaywallScreen.tsx`; remove `// TEMP: replaced in step 16`). This step is UI plus mocked offerings, trial eligibility, purchase and restore only. Real RevenueCat (`react-native-purchases`), entitlements and the webhook come in step 30. Do not install `react-native-purchases` or any paywall UI library here: nothing needs installing, configuring or signing up for in this step.

Design: `prompt_material/08-paywall.html` is the design source (one view, no hidden states; `prompt_material/08-paywall.png` is the same view, 590×1600, about 1.5x, so never measure dp from it; `Images/8._paywall_gracehush_pro.png` is the same file, byte for byte). In the HTML 1 CSS px = 1dp. Ignore everything the Stitch preview adds: its `selectPlan()` script (the real selection is state), the glow behind the header and the device frame. Do not add colors, fonts, radii or shadows: use the tokens, the utilities in `global.css` and the existing components. Text in this prompt overrides text in the HTML, including every price, count and feature claim.

---

## What you do yourself

Nothing blocks this step. Checked in the review: `.env.local` holds only `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (set), which is all the app uses so far, and step 16 reads no key, calls no service and installs nothing. Mock plans, mock prices and a mock purchase are the whole step. After the code is pulled, restart Metro with a cleared cache: `npx expo start -c`, then reopen Expo Go (new files add class names, and a hot reload does not recompile the stylesheet for them).

Two things are yours, and neither blocks this step:

1. **The three step 15 placeholders** (`PRIVACY_POLICY_URL`, `TERMS_URL`, `SUPPORT_EMAIL` in `src/constants/app.ts`) are still `example.com`. The paywall now links the first two, and Apple and Google both require them to be reachable from the purchase screen, so they must be real before any build that can take a payment. Instructions for creating the pages are in `prompts/15-profile-ui.md` ("What you do yourself"). For the iPhone build Apple's standard EULA (`https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`, checked in the review: it loads) may stand in for `TERMS_URL` if you approve it; Android needs your own page.
2. **Decide the real money facts before step 30**, because step 30 asks for them and they are yours to decide, not mine: the yearly price, the monthly price, and the trial length (the mock uses a 7-day trial on the yearly plan only). Nothing in the app may invent them. Also know what step 30 will ask you to set up (prepare early, nothing now): a RevenueCat account, a Google Play Console developer account (a one-time fee, check the current amount) and the paid Apple Developer account, which comes last (AGENTS.md, Instructional Memory).

---

## Decisions (made in the review; each one has its reason)

1. **The HTML is the design source; AGENTS.md "Screen Specifications, 8. Paywall" agrees with it, and the old draft contradicted both.** The old draft put the X on the right with a left spacer and moved Restore into the footer, replaced the title with "A devotional for every prayer.", added a "GRACEHUSH PRO" eyebrow, and cut the design's header. The design and AGENTS.md say: X on the left, "Restore purchases" on the right, title "Go deeper with Gracehush Pro", subtitle "A calm, unhurried space for your daily walk with God."
2. **The paywall lists only what AGENTS.md defines as Pro, and V1 defines one thing: unlimited audio devotionals** (Free users get `FREE_DEVOTIONALS_PER_WEEK` a week, Backend rule 10; Profile's Pro card and AGENTS.md section 7 say the same). The HTML lists five. Four are not built as gates, so they are left out and reported: *Ambient soundscapes* (every user has them on Now Playing and Profile), *Full private journal and audio history (never expires)* (no retention rule exists, and "never expires" is a promise nothing keeps), *Answered prayer timeline and gratitude notes* (free for everyone) and *Choice of contemplative devotional voices* (one server-side voice, step 06 decision 5; Profile skips the same row). The list is data: the card draws as many rows as `copy.paywall.features` holds (one now). To advertise another benefit, first make it a real gate in AGENTS.md "Subscription Rules", then add the row. **If you want more benefits on this screen, tell me which gate you want and I add both.**
3. **No gradient and no glow.** The HTML draws a blurred plum-to-terracotta glow behind the header. AGENTS.md's standing ruling skips decorative extras, and gradients are allowed only on Now Playing, so nothing is built and nothing needs asking.
4. **The "Save n%" badge is the existing tinted chip, inline with the plan title.** The HTML's solid terracotta badge with white text is 3.63:1 (the rule is `hopeful-fg` on the 12% tint, 5.00:1, AGENTS.md Styling Rules), and a translucent chip laid over the card's border would show the border through it, so it sits in the title row (it wraps under the title when they do not fit).
5. **The unselected radio ring is `mauve`**, not the HTML's `petal` (1.31:1 on white). The selected state (plum ring, plum dot, plum 2dp card border) is unchanged.
6. **Not built, because the app cannot keep the claim:** the shield line "No commitments. Cancel with one tap." (cancelling happens in the App Store or Google Play settings, not in one tap in the app; the disclosure under the button says where), and the old draft's "You haven't been charged." (a dropped connection can follow a charge). The error note says to use Restore purchases if the user thinks they were charged. AGENTS.md section 8 and the Subscription Rules are updated to say so.
7. **Prices, savings, per-month, trial length and every label come from the offering or from helpers.** `Save 50%` and `$5.00 / month` in the HTML are placeholders. The savings chip appears only when `annualSavingsPercent` returns a number; the trial is advertised only when the package has one **and** `isTrialEligible` says yes (never advertise a trial you cannot confirm).
8. **The CTA label is short and dynamic:** "Start 7-day free trial" or "Subscribe for $59.99/year". `PrimaryButton`'s label gets `shrink text-center` (one change, no visible difference when the label fits), because measured with the font files "Subscribe for $59.99/year" plus the arrow needs 272dp at 360dp wide with font scale 1.3 (room 246) and overflows at 320dp ×1.3 (room 214).
9. **The footer is pinned only where there is room:** `useWindowDimensions()` height at least 700 and `fontScale` at most 1.3. Otherwise the footer is the last thing in the scrolling page (at 320dp ×1.3 the disclosure alone is five lines). Either way the button, the disclosure and the legal links are one block.
10. **Loading is a skeleton in the shape of the screen** (AGENTS.md style: Journal, Profile), not a bare spinner, and while an `entryId` is being checked nothing of the paywall is drawn (see the crisis guard).
11. **Close is never disabled**, not even while a purchase or restore runs (never trap a user; a real purchase completes in the store anyway, and step 30's customer-info listener picks it up). "Restore purchases" and the plan options are disabled while one runs.
12. **The mock fails closed.** A mock that grants Pro for free must never ship: outside `__DEV__` `getCurrentOffering` answers `null` and `purchasePackage` answers `NOT_ALLOWED`. **Not shippable until step 30, like step 11's crisis view was until step 13: do not ship a build between this step and step 30.**
13. **Analytics markers follow step 34's catalog, not the old draft's names:** `paywall_viewed { source }`, `purchase_completed { plan: 'annual' | 'monthly', trial: boolean }`, `purchase_failed { code }` (a cancelled purchase sends it with `CANCELLED`), `restore_completed { found: boolean }`. There is no `paywall_plan_selected` or `purchase_started` in the catalog.
14. **Haptics:** a `selection` tick when the selected plan changes to a different one, none for pressing the selected one, none for a purchase result (AGENTS.md "Haptics", extended in this review: a plan option is a value picker like the segmented control and the ambient chips), never for an error.
15. **Crisis support is never paywalled.** `NewEntryScreen` already checks a crisis result before `LIMIT_REACHED` (confirmed in the code, `run()`); the screen also guards itself (section 5).

---

## 1. Before writing code

1. Read `src/screens/paywall/PaywallScreen.tsx` (the placeholder), `src/screens/journal/NewEntryScreen.tsx` (`run()`, its `LIMIT_REACHED` branch and the `TODO(22)` there), `src/screens/profile/ProfileScreen.tsx` (the plan card, "Restore purchases", `NoticeKind`, `openLink`), `src/components/profile/PlanCard.tsx`, `src/hooks/useProfileSettings.ts`, `src/navigation/types.ts`, `src/navigation/RootNavigator.tsx`, `src/data/journalRepository.ts` (`getUsage`, `getEntry`, `setMockSubscriptionTier`, `submitEntry`), `src/store/devStore.ts`, `src/components/dev/DevToolsPanel.tsx`, `src/types/index.ts`, `src/constants/app.ts`, `src/constants/copy.ts`, `src/utils/format.ts` (`formatWeekday` exists since step 15), `src/services/externalLinks.ts`, `src/components/PrimaryButton.tsx`, `src/screens/journal/ReflectionStateViews.tsx` (`MessageView`) and `prompt_material/08-paywall.html`.
2. The Pro rule is decision 2. If you find another feature in AGENTS.md that is gated, add it to the list and report it; if you find none beyond unlimited devotionals, build the one-row list.
3. `PRIVACY_POLICY_URL`, `TERMS_URL` and `MANAGE_SUBSCRIPTION_URL` exist in `src/constants/app.ts` (step 15), with `openLegalPage` and `openManageSubscription` in `src/services/externalLinks.ts` (`expo-web-browser` is installed). Reuse them; never duplicate a URL.
4. Icons all go through `Icon` with both names (checked against `sf-symbols-typescript` and `expo-symbols/build/android/symbols.json`): close `xmark` / `close`, check `checkmark` / `check`, CTA arrow `arrow.right` / `arrow_forward` (`PrimaryButton iconRight`). There is no other icon set and none is added.
5. `react-native-purchases` is not installed and stays that way. Its real types (10.15.0, `@revenuecat/purchases-typescript-internal` 19.12.0, read in the review) are what section 2 mirrors: `PurchasesPackage { identifier, packageType, product }`, `PurchasesStoreProduct { priceString, price, currencyCode, pricePerMonthString, introPrice, subscriptionPeriod, defaultOption }`, `PurchasesIntroPrice { price, periodUnit, periodNumberOfUnits }`, `SubscriptionOption.freePhase`, error codes `PURCHASE_CANCELLED_ERROR`, `PAYMENT_PENDING_ERROR`, `NETWORK_ERROR`, `PURCHASE_NOT_ALLOWED_ERROR`, `PRODUCT_ALREADY_PURCHASED_ERROR`.

---

## 2. Types (`src/types/index.ts`)

Shaped like RevenueCat so step 30 maps the SDK one to one (step 30 section 9 reads these names):

```ts
export type PackageKind = "annual" | "monthly";
export type IntroOffer = { kind: "free_trial"; periodDays: number };
export type PlanPackage = {
  id: string; // RevenueCat package identifier
  kind: PackageKind;
  productId: string;
  priceString: string; // localized, from the store
  price: number; // numeric, for calculations only
  currencyCode: string;
  periodLabel: "year" | "month";
  pricePerMonthString: string | null; // the SDK's own per-month string when it has one
  introOffer: IntroOffer | null;
};
export type Offering = { id: string; packages: PlanPackage[] };

export type PurchaseErrorCode =
  | "CANCELLED" | "PENDING" | "NETWORK" | "NOT_ALLOWED" | "ALREADY_OWNED" | "UNKNOWN";
export type PurchaseResult =
  | { ok: true; tier: "trial" | "pro" }
  | { ok: false; code: PurchaseErrorCode; message: string };
export type RestoreResult =
  | { ok: true; restored: boolean; tier: SubscriptionTier }
  | { ok: false; code: "NETWORK" | "UNKNOWN"; message: string };
```

No `any`. There is no `periodLabel` on `IntroOffer`: the trial length is `periodDays`, and every label is built from it in `copy.paywall` (step 30 maps `periodUnit × periodNumberOfUnits` to days).

---

## 3. Mock service (`src/services/purchases.ts`) and its data

Mark the whole file `// TEMP(30): replace internals with react-native-purchases, keep signatures and return shapes.`

```ts
getCurrentOffering(): Promise<Offering | null>
isTrialEligible(packageId: string): Promise<boolean>
purchasePackage(packageId: string): Promise<PurchaseResult>
restorePurchases(): Promise<RestoreResult>
```

Mock data lives in `src/data/mock/offerings.ts`, marked `// PLACEHOLDER prices and ids. Real prices are set in App Store Connect and Play Console and arrive through RevenueCat. Never copy these values into screens or copy.ts.`:

- Annual: `id "$rc_annual"`, `kind "annual"`, `productId "gracehush_pro_yearly"`, `priceString "$59.99"`, `price 59.99`, `currencyCode "USD"`, `periodLabel "year"`, `pricePerMonthString null` (so the helper's `Intl` path is exercised), `introOffer { kind: "free_trial", periodDays: 7 }`.
- Monthly: `id "$rc_monthly"`, `kind "monthly"`, `productId "gracehush_pro_monthly"`, `priceString "$9.99"`, `price 9.99`, `periodLabel "month"`, `pricePerMonthString null`, `introOffer null`.

`devStore` additions (`__DEV__` only, not persisted, in the existing style): `nextPurchaseOutcome: "success" | "cancelled" | "pending" | "failed" | "not-allowed" | "already-owned"` (one-shot: `purchasePackage` takes it and puts it back to `"success"`, like `takeMockSubmitOutcome`), `trialEligible: boolean` (default `true`), `restoreFindsPurchase: boolean` (default `false`), `offeringUnavailable: boolean` (default `false`), each with its setter.

Rules:

- Reads (`getCurrentOffering`, `isTrialEligible`) wait about 300 ms in `__DEV__` and 0 otherwise, like the repository's `simulateLatency`. Purchase and restore wait about 800 ms.
- **Outside `__DEV__` the service fails closed** (decision 12): `getCurrentOffering` answers `null`, `isTrialEligible` `false`, `purchasePackage` `{ ok: false, code: "NOT_ALLOWED" }`, `restorePurchases` `{ ok: true, restored: false, tier: "free" }`.
- `getCurrentOffering` answers `null` while `offeringUnavailable` is set.
- `isTrialEligible(id)`: true only when that package has an `introOffer` and `trialEligible` is on.
- `purchasePackage` success: tier `"trial"` when the package has an intro offer **and** `trialEligible` is on, otherwise `"pro"`. It calls `setMockSubscriptionTier(tier)` (step 15, in the repository) and then `useDevStore.getState().bumpMockProfileVersion()`, so Profile's plan card, `getUsage` and the dev panel follow for the rest of the session. After a trial is bought it sets `trialEligible` to `false` for the session. Outcomes map as: `cancelled` → `CANCELLED`, `pending` → `PENDING`, `failed` → `NETWORK`, `not-allowed` → `NOT_ALLOWED`, `already-owned` → `ALREADY_OWNED` (none changes the tier). An unknown package id is `UNKNOWN`.
- `restorePurchases`: with `restoreFindsPurchase` on it sets the tier to `"pro"`, bumps the version and answers `restored: true`; otherwise `restored: false` with the current tier.
- Never log an email, a user id, a price tied to the user or anything receipt-like.
- `src/data/journalRepository.ts` `submitEntry` (small change, so the free-limit mock follows the plan): a taken outcome of `"limit"` answers like `"ready"` when the profile's tier is not `"free"` (a paid user never hits the limit). `// TEMP(25)` stays on the function.

---

## 4. Pricing helpers (`src/utils/pricing.ts`, pure, no React)

A draft passed a 19-case Node harness in the review (including JPY, EUR, an invalid currency code, equal and lopsided prices, NaN and Infinity); keep these semantics:

```ts
annualSavingsPercent(annual: PlanPackage, monthly: PlanPackage): number | null
// Math.round((1 - annual.price / (monthly.price * 12)) * 100). Null when the currencies differ, a price is not
// finite or not above 0, or the result is below 1 (equal prices, a dearer yearly plan, a 0.4% saving).

pricePerMonthLabel(pkg: PlanPackage): string | null
// Annual packages only. pkg.pricePerMonthString when present (step 30 fills it); otherwise
// new Intl.NumberFormat(undefined, { style: "currency", currency: pkg.currencyCode }).format(pkg.price / 12),
// null if that throws (an invalid currency code). // TODO(30): prefer the SDK's string (it already does when set).

activeIntroOffer(pkg: PlanPackage, eligible: boolean): IntroOffer | null
// The trial this user can really get: eligible ? pkg.introOffer : null.

trialCtaLabel(pkg: PlanPackage, eligible: boolean): string
// activeIntroOffer(...) -> copy.paywall.cta.trial(days); otherwise copy.paywall.cta.subscribe(priceString, periodLabel).

renewalDisclosure(pkg: PlanPackage, eligible: boolean, platform: "ios" | "android"): string
// One of the four copy.paywall.disclosure builders (trial or paid, iOS or Android).
```

`Intl` formats in the device locale while the store's `priceString` follows the store's locale, so the two can differ in style on a few devices; that is why step 30 prefers the SDK's string. Strings come from `copy.paywall` (pricing.ts may import `copy`; it imports no React).

---

## 5. Navigation

- `RootStackParamList`: `Paywall: { source: "profile" | "limit"; entryId?: string }`.
- `RootNavigator`: Paywall keeps `presentation: "modal"` and gets `animation: "slide_from_bottom"` (an Android `modal` without it fades in, AGENTS.md vendor note; check it on the emulator). The tab bar and dock are hidden because the modal covers them.
- `NewEntryScreen` `LIMIT_REACHED` branch: it already calls `navigation.replace("Paywall", { source: "limit" })` after `leaving.current = true`, so Back never returns to the processing overlay. `SubmitResult` carries no `entryId` on an error, so pass nothing, and change the marker's text to `// TODO(22): the server returns entryId with LIMIT_REACHED; pass it as { source: "limit", entryId }`. Keep the order: a crisis result is checked before the limit.
- **Closing** (the X, "Maybe later", Continue, Android back):
  - `source "profile"` → `navigation.goBack()`.
  - `source "limit"` → `navigation.popTo("MainTabs", { screen: "Journal" })` (never `navigate("MainTabs")`: it pushes a second copy, AGENTS.md vendor note). Android back and an iOS swipe-down simply return to the screen below.
  - The same function serves every close path.
- **Crisis guard:** with an `entryId`, `usePaywall` loads the entry with `getEntry(entryId)` in the same `Promise.all` as the offering; if it `isCrisis`, the hook answers `status: "crisis"` and the screen immediately calls `navigation.replace("Reflection", { entryId })` from an effect. Until the guard has answered, the screen draws only the loading skeleton, never the paywall. Nothing about a crisis entry is logged. `// TODO(22): the server checks crisis before the free-tier limit; crisis support is never paywalled.`
- Opened from Profile's plan card (`navigation.navigate("Paywall", { source: "profile" })`, already wired), from New Entry's limit outcome, and (step 24) from a limit card on Journal. Update the Navigation Map as section 13 says.

---

## 6. Hook (`src/hooks/usePaywall.ts`)

`usePaywall(entryId: string | undefined): PaywallState`:

```ts
type PaywallNotice = "pending" | "error" | "notAllowed" | "restoreNone" | "restoreError";
type PaywallState =
  | { status: "loading" }
  | { status: "crisis" }
  | { status: "done"; tier: "trial" | "pro" }              // a purchase or a restore succeeded
  | { status: "unavailable"; retry; restore; restoring: boolean; notice: PaywallNotice | null }
  | { status: "member"; tier: "trial" | "pro" }             // already subscribed when the screen opened
  | { status: "ready"; offering; selected: PlanPackage; eligibility: Record<string, boolean>; usage: PlanUsage;
      select(packageId); purchase(); restore(); purchasing: boolean; restoring: boolean; notice: PaywallNotice | null };
```

- One `Promise.all` of `getUsage()`, `getCurrentOffering()` and `getEntry(entryId)` (or `null` without an id), then the trial eligibility of every package that has an intro offer (each `isTrialEligible(...)` caught to `false`). The order of decisions is: crisis entry → `crisis`; `usage.tier !== "free"` → `member`; no offering or no packages or any failure → `unavailable`; otherwise `ready`. The tier comes from `getUsage()` (it carries `tier`); `getProfile()` is not needed.
- Default selection: the annual package if present, otherwise the first. Keep the user's pick as `picked: string | null` and derive the selected package in render (`packages.find(id === picked) ?? default`), so nothing is set from an effect. `select` ticks `haptics.selection()` only when the id changes.
- Load with `useFocusEffect(useCallback(() => { load(); return () => { latestLoad.current += 1; }; }, [load]))`, **not** a plain `useEffect`: a draft that called `load()` from `useEffect` failed `react-hooks/set-state-in-effect` in the review, and the `useFocusEffect` form (the same one `useProfileSettings` uses) passed `tsc` and `eslint`, with a bad file proving the linter live. A request counter in a ref makes only the latest load act; a `mounted` ref (written only in an effect and its cleanup) makes a purchase or restore that finishes after the screen closed set nothing.
- `purchase()` and `restore()` share a `running` ref: neither starts while the other runs, and the state `purchasing` / `restoring` disables the plan options, the CTA and Restore (not Close). Results: ok → `done` with the tier; `CANCELLED` → nothing, no note, no dialog (`// TODO(34): purchase_failed { code: 'CANCELLED' }`); `PENDING` → notice `pending`; `NOT_ALLOWED` → `notAllowed`; `ALREADY_OWNED` → run `restore()` and show its result; anything else → `error`. Restore: `ok` and `restored` and a paid tier → `done`; `ok` and not restored → `restoreNone`; not ok → `restoreError`.
- `retry` sets the load back to `loading`, clears the notice and loads again.
- A draft of this hook and of `PlanOption` passed `npx tsc` and `npx eslint` (React Compiler rules) in the review; run lint again on the real files.

---

## 7. Screen (`src/screens/paywall/PaywallScreen.tsx`) and `PlanOption`

`SafeAreaView` (linen, `edges={["top", "bottom"]}`; `StyleSheet` for the style, AGENTS.md exception table). Side padding is `screen__content` (20, 16 under 360dp wide), not 24. Everything below the header is one `ScrollView` (`contentContainerStyle` bottom padding 16), plus the footer, pinned or inside the scroll (decision 9).

**Header** (`screen__content flex-row items-center justify-between pb-1 pt-2`), drawn from the first frame in every state:

- Left: the X, a `Pressable` with the `style` function only and an inner `size-11 items-center justify-center` `View`, `Icon` 24 `colors.ink`, `accessibilityRole="button"`, `accessibilityLabel={copy.common.close}`, `onPress={close}`. Never delayed, faded in or disabled.
- Right: "Restore purchases" (`text-label-md text-mauve`, `min-h-11 justify-center px-3 -mr-3`, `accessibilityRole="button"`), shown in `loading`, `ready` and `unavailable` (not in `member`, `done` or `crisis`) and disabled (opacity 0.5) unless the state is `ready` or `unavailable` and nothing is running.

**Limit banner** (`source "limit"` and state `ready` only; `card card--blush`, padding 16, `mb-4`): "You’ve used your {limit} free devotionals this week." from `usage.limit` (never typed), "They reset {weekday}." from `formatWeekday(usage.resetsAt)`, and, only when `route.params.entryId` is set, "Your reflection is saved." (never without an `entryId`). If `usage.limit` is `null` the state is `member`, which wins.

**Hero** (`items-center`, `mb-6`): an 80×80 circle (`size-20 items-center justify-center rounded-full border border-petal bg-card`, `style={shadows.card}`), `images.logoMark` 40×40 through `expo-image` with `tintColor={colors.plum}` (the mark is a white-stroke SVG, SignIn tints it the same way; `tintColor` on the SVG is verified on Android, not iOS), hidden from screen readers; the title (`mt-4 text-center text-title text-plum-deep`, `accessibilityRole="header"`) "Go deeper with Gracehush Pro"; the subtitle (`mt-2 max-w-xs text-center text-body text-mauve`) "A calm, unhurried space for your daily walk with God."

**Feature card** (`card gap-3`, `style={shadows.card}`, `mb-6`): one row per `copy.paywall.features` item (decision 2), `flex-row items-start gap-3`: a 24dp tile (`size-6 items-center justify-center rounded-full bg-sage/15 mt-0.5`) with a 16 `check` icon in `colors.sage` (decoration, hidden from screen readers: sage on its tint is 2.34:1, so the text carries the meaning), then `flex-1` text (`text-body text-ink`) and, when the item has a helper, `text-body-sm text-mauve`. Today: "Unlimited audio devotionals" with the helper "Free plans include {FREE_DEVOTIONALS_PER_WEEK} a week." (built from the constant).

**Plan selector** (`View` with `accessibilityRole="radiogroup"`, `gap-3`): one `PlanOption` per package, annual first. `src/components/paywall/PlanOption.tsx` (the only new reusable component), props `pkg`, `selected`, `trialDays: number | null` (set only when `activeIntroOffer` is non-null), `savingsPercent: number | null`, `perMonth: string | null`, `disabled`, `onSelect`:

- A `Pressable` carrying only the `style` function, `accessibilityRole="radio"`, `accessibilityState={{ checked: selected, disabled }}`, label "{title}, {price} / {period}" plus ", {n} days free" when the trial shows. The state is not repeated in the label: React Native's iOS code speaks "radio button" and "checked" or "unchecked" itself (read in `RCTViewComponentView.mm`), and Android announces the role and state.
- Inner `View`: `min-h-16 flex-row items-center gap-3 rounded-card border-2 bg-card p-4`, with `border-plum` selected and `border-petal` otherwise (the same 2dp border in both states, so choosing never moves the cards). Radio: `size-5` circle, `border-2`, `border-plum` selected / `border-mauve` otherwise, with a `size-2.5 rounded-full bg-plum` dot only when selected: that dot's `View` has `collapsable={false}`, because a view whose background appears on a state change is flattened away on Android (AGENTS.md vendor note).
- Middle `flex-1` column: the title row (`flex-row flex-wrap items-center gap-x-2 gap-y-1`): `text-section text-ink` "Yearly Access" or "Monthly Access" (the design's and AGENTS.md's names) and, for annual with a number from `annualSavingsPercent`, `chip chip--terracotta` with `chip__label chip__label--terracotta` "Save {n}%"; under it, annual only, `text-body-sm text-mauve` "{perMonth} / month, billed yearly" when `pricePerMonthLabel` is non-null, or, for monthly, "Billed monthly."; and, when `trialDays` is set, `text-label-md text-plum` "{n} days free".
- Right: the price, `text-label-lg text-ink` "{priceString} / {period}" (wraps if it must; it never pushes the radio out).

**Footer** (`ready` only; `screen__content gap-3 pb-2 pt-3`, with a `divider` above it when pinned):

- The notice line, when there is one (`text-body-sm text-center`, `text-rosewood`; `restoreNone` and `pending` are `text-mauve`), `accessibilityLiveRegion="polite"` and `useAnnounce(message)` (the Profile `Notice` pattern; do not use `announceForAccessibility` directly). A notice stays until the next action, never on a timer.
- `PrimaryButton size="large" iconRight={arrow}` labelled `trialCtaLabel(selected, eligible)`, `loading={purchasing}`, `disabled={restoring}`. The plum pill is the one filled button on the screen.
- Directly under it the disclosure (`renewalDisclosure(...)`, `Platform.OS`), `text-body-sm text-mauve text-center` (13/19; the HTML's 12 has no token).
- Source `limit` only: a text button "Maybe later" (`min-h-11`, `btn-text__label`) with the same behavior as close, above the legal row.
- The legal row: "Terms of Use" · "Privacy Policy" (`flex-row items-center justify-center`, each `min-h-11 justify-center px-2`, `text-label-md text-rosewood`, `accessibilityRole="link"`, a decorative `•` between), through `openLegalPage(TERMS_URL)` and `openLegalPage(PRIVACY_POLICY_URL)`; a failure shows the notice "We couldn’t open that page." If `TERMS_URL` is still the step 15 placeholder, keep it and list it in the report.

Never on this screen: countdown timers, "limited time" or "today only", fake reviews, star ratings, testimonials, user counts, crossed-out prices, an auto-selected upsell beyond the annual default, or crisis red.

---

## 8. States and outcomes

- **loading** (and `crisis`, until the replace happens): below the header, one `accessible` node labelled "Loading plans" with `accessibilityState={{ busy: true }}`, its children hidden (the Profile `LoadingSections` pattern): `Skeleton`s for the hero circle, two title bars, an 88dp card, two 88dp plan cards and a 56dp pill. The X works.
- **unavailable** (no offering, or an error): `MessageView` (exported from `src/screens/journal/ReflectionStateViews.tsx`, used by Now Playing the same way): "Plans aren’t available right now." / "Please check your connection and try again." with `PrimaryButton` "Try again" and a ghost `PrimaryButton` "Close". Restore stays available in the header and its notes show under the buttons.
- **member**: `MessageView`: "You’re already a Pro member." with the body "Your free trial is active." (trial) or "Thank you for being part of Gracehush." (pro), `PrimaryButton tone="ghost"` "Manage subscription" (`openManageSubscription`; a failure shows "We couldn’t open your subscription settings.") and "Close". No plans are drawn.
- **done**: `MessageView` replaces the whole body (plans and footer): "Welcome to Gracehush Pro." / "Your devotionals are unlimited." (trial: "Your free trial has started. Your devotionals are unlimited.") and `PrimaryButton` "Continue", which closes by the section 5 rules. `// TODO(25): if source 'limit' and entryId, resume that entry's devotional generation (step 25 section 7).` `// TODO(34): purchase_completed { plan, trial } / restore_completed { found: true }.`
- **notices** (`ready` footer): `pending` "Your purchase is pending approval. We’ll unlock Pro as soon as it’s confirmed." (`// TODO(30)`: the customer-info listener makes this true); `error` "We couldn’t complete your purchase. Please try again. If you think you were charged, choose Restore purchases."; `notAllowed` "Purchases are turned off on this device."; `restoreNone` "We didn’t find a previous purchase for this account."; `restoreError` "We couldn’t restore your purchases. Please try again."
- A cancelled purchase shows nothing at all.

---

## 9. Profile wiring (small, and only this)

In `ProfileScreen`, `PlanCard`, `useProfileSettings` and `copy.profile`:

- **Restore purchases** calls `restorePurchases()` from `src/services/purchases.ts` and shows the result: restored → "Your purchase is restored." (`copy.profile.plan.restored`; the plan card follows the new tier because the mock bumps the profile version), not restored → "We didn’t find a previous purchase for this account." (the existing `restoreNone` string is replaced with this one), failure → "We couldn’t restore your purchases. Please try again." (`restoreError`). Replace the single `"restore"` notice kind with `restored`, `restoreNone` and `restoreError`; the button is disabled while it runs (a ref guards a double tap). Remove the step 15 placeholder and its `// TODO(30)` in `ProfileScreen` and in `copy.ts`.
- **"Start free trial" or "Upgrade to Pro":** `useProfileSettings`' ready state gains `trialEligible: boolean`, computed inside the load's `Promise.all` as `getCurrentOffering()` → the annual package → `isTrialEligible(id)`, with its own `.catch(() => false)` (a purchases failure must never break Profile). `PlanCard` takes `trialEligible` and shows `copy.profile.plan.upsell.actionTrial` ("Start free trial") or `actionUpgrade` ("Upgrade to Pro"); the accessibility label follows. Remove the `// TODO(30)` above `action` in `copy.ts`.
- Change nothing else in Profile.

---

## 10. Dev panel (`src/components/dev/DevToolsPanel.tsx`, `__DEV__` only)

Replace the single "Open paywall (dev)" button with a "Paywall (dev)" group:

- Open: four buttons: `Profile` (`{ source: "profile" }`), `Limit` (`{ source: "limit" }`), `Limit + entry` (`{ source: "limit", entryId }` with the Ready target's id from the panel's existing `targets`, disabled when the scenario has none) and `Crisis entry` (the Crisis target's id; this must land on Reflection, never on the paywall).
- "Next purchase (dev)": `success`, `cancelled`, `pending`, `failed`, `not allowed`, `already owned` (the current one selected; one-shot, back to `success` after a purchase takes it).
- Three toggles that show as selected while on: "Trial eligible (dev)", "Restore finds purchase (dev)" and "Plans unavailable (dev)". Each one also calls `bumpMockProfileVersion()` so Profile's button label follows.
- The existing "Mock plan (dev)" and "Next submit (dev)" (`limit`) controls are how the member state and the limit path are reached.

---

## 11. Copy (`src/constants/copy.ts`, under `paywall`)

Every string above lives under `copy.paywall` (`restore`, `hero`, `features`, `limit`, `plan`, `cta`, `disclosure`, `legal`, `later`, `done`, `member`, `unavailable`, `notices`, `loading`), with curly apostrophes and builders for the numbers: `days(n)` ("1 day" / "7 days"), `plan.trialFree(n)` ("7 days free"), `plan.save(n)`, `plan.price(priceString, period)`, `plan.perMonth(price)`, `cta.trial(n)` ("Start {n}-day free trial"), `cta.subscribe(priceString, period)` ("Subscribe for {price}/{period}"), `limit.used(limit)`, `limit.resets(weekday)`, and the four disclosures:

- trial, iOS: "Free for {days}, then {price} per {period}. Renews automatically until canceled. To avoid being charged, cancel at least 24 hours before the trial ends in your App Store settings."
- trial, Android: "Free for {days}, then {price} per {period}. Renews automatically until canceled. To avoid being charged, cancel in Google Play before the trial ends."
- paid, iOS: "{price} per {period}. Renews automatically until canceled. Cancel at least 24 hours before it renews in your App Store settings."
- paid, Android: "{price} per {period}. Renews automatically until canceled. Cancel anytime in Google Play."

The `period` and `price` in these are the *billing* period and price, distinct from the trial `days`. `FREE_DEVOTIONALS_PER_WEEK` comes from `src/constants/app.ts`. The exact wording of the disclosure is a legal and store-review matter: Apple's guideline 3.1.2(c) points to Schedule 2 of the Developer Program License Agreement, which could not be read from here, so check the final text there (and Google's subscription policy: trial length, the price after the trial, how to cancel) before a release. The Terms link is part of that.

---

## 12. Rules

- No new dependencies. No `any`. NativeWind classes first; `StyleSheet` only where AGENTS.md allows (the `SafeAreaView`, `Pressable` style functions, shadows). A `Pressable` takes no `className` together with a `style` function: classes go on an inner `View`.
- New files: `src/components/paywall/PlanOption.tsx`, `src/hooks/usePaywall.ts`, `src/services/purchases.ts`, `src/data/mock/offerings.ts`, `src/utils/pricing.ts`. Keep the hero, the feature card, the footer and the states inside the screen unless the file passes about 300 lines; then extract `src/components/paywall/PaywallFooter.tsx` and nothing else.
- Every string is in `copy.paywall` (or the three `copy.profile.plan` keys of section 9). Prices, trial lengths and counts always come from data or helpers.
- Never log the plan or price chosen together with the user's identity, a receipt, an email or journal content. Crisis rules apply: nothing logged about a crisis entry.
- Markers to leave: `TEMP(30)` (the service, the offerings, `setMockSubscriptionTier`), `TODO(30)` (`// TODO(30): real offerings, eligibility, purchase, restore, entitlement "pro", Purchases.logIn(clerkUserId)`, the `pending` note, the per-month string), `TODO(22)` (two places), `TODO(25)` (the success resume) and `TODO(34)` (the four events of decision 13, no ids and no prices tied to the user). The three step 15 markers (`TODO(30)` twice in `copy.ts`, once in `ProfileScreen`) are closed here.

---

## 13. AGENTS.md updates (in this same step, then copy the file to `prompts/AGENTS.md`)

The review already changed these rules: Navigation Map (the Paywall line and a new Paywall bullet), Screen Specifications section 8 (the real layout, the one-feature list, no "cancel with one tap"), Subscription Rules (what Pro is in V1, the trial rule, fail-closed, the cancellation wording) and the Haptics list. At implementation, add:

- The Step 16 entry in the Build Status log: the decisions above, files created and changed, the measured sizes, what was verified and what was not, and the open items.
- Architecture: `components/paywall/PlanOption`, `usePaywall`, `services/purchases.ts` (a `TEMP(30)` mock that fails closed), `data/mock/offerings.ts`, `utils/pricing.ts`, the types, `copy.paywall`; remove "Planned: PlanOption (step 16)" and update the `paywall/` screens line.
- Navigation Map's dev-tools bullet ("Paywall (dev)" and its controls) and the Dev store paragraph (the four new fields and their setters).
- Record any vendor fact learned on a device (the Android modal slide, the iOS radio announcement, the pinned-footer rule) and say what was not verified on iOS.

---

## 14. Verify

Run `npx expo start -c` (Metro on 8082 for the emulator; never stop the user's 8081), `npm run lint` and `npm run typecheck` (read the real exit codes), and `npx expo export` once per platform (one at a time on this machine). Then, on the Android emulator (Expo Go 57) at 390dp (`wm size 1080x2340`, `wm density 443`), 360dp and 320dp with font scale 1.3:

1. The layout against `prompt_material/08-paywall.html` (proportions only against the PNG): the header with the X left and "Restore purchases" right, the 80dp hero circle, the title on two lines at 390dp, the feature card, two plan cards at least 64 tall with 12 between, the CTA 56 tall. At 390dp (852 tall) the footer is pinned and the CTA, the disclosure and the legal links are on screen without scrolling; at 320dp ×1.3 the footer is the end of the scrolling page and nothing is clipped, every control is at least 44, the long CTA label wraps instead of overflowing.
2. The X works from the first frame and in the loading, unavailable, member and done states, and while a purchase runs (the CTA, Restore and the plan options are disabled then).
3. Prices, "$5.00 / month", "Save 50%" and the trial come only from the mock offering. Temporarily change the mock prices (a reverted `TEMP-EXPERIMENT`): the screen follows; equal prices (119.88 and 9.99) hide the chip; a different currency code on one package hides it.
4. "Trial eligible (dev)" on and off: the CTA, the option's "7 days free" line and the disclosure change, on both `Platform.OS` values (a reverted experiment for the other platform's text).
5. Each "Next purchase": `success` (Profile's plan card shows "Gracehush Pro" and the trial or Pro state after closing, "Mock plan" follows, the next trial is not offered), `cancelled` (nothing at all), `pending`, `failed`, `not allowed` and `already owned` (it runs restore on its own and shows that result).
6. Restore with and without "Restore finds purchase (dev)", from the paywall header and from Profile; Profile's button is disabled while it runs and its button label is "Upgrade to Pro" after the trial is used.
7. "Plans unavailable (dev)" shows the unavailable state and "Try again" recovers once it is off.
8. Source `limit` through "Next submit (dev)" = `limit`: New Entry's processing overlay is replaced by the paywall (Android back lands on the tab you were on, never on the overlay), the banner shows the limit and the reset weekday from `getUsage`, "Your reflection is saved." appears only through the dev "Limit + entry" button, and "Maybe later", the X and Continue land on the Journal tab with one `MainTabs` in the stack. With the plan set to Pro or trial a `limit` submit finishes like a normal one (the section 3 change).
9. "Crisis entry" from the dev panel lands on Reflection's crisis view and never draws the paywall; a crisis submit never opens it.
10. Mock plan `trial` or `pro`: the paywall shows "You’re already a Pro member." and no plans.
11. The modal slides up on Android (a screen recording, as AGENTS.md describes); the tab bar and dock are hidden.
12. `uiautomator dump --compressed`: the plans are `radio` nodes with price and `checked`, inside a `radiogroup`; the disclosure is read; every link is labelled; the decorative icons and the logo are absent; no clickable sits inside another. With TalkBack: the plans, the CTA, Restore and the links read with their labels.
13. A Node check (compile the repo's TypeScript on require, the approach of step 14's harness) of `annualSavingsPercent`, `pricePerMonthLabel`, `activeIntroOffer`, `trialCtaLabel` and `renewalDisclosure`, and of the mock service with `__DEV__` set false (it fails closed) and with a tier of `pro` (`submitEntry` limit answers ready).
14. The log holds no email, id, price or receipt from this screen.

Not verifiable here, so for the user's iPhone in Expo Go: the iOS modal swipe-down, `tintColor` on the logo mark, VoiceOver on the radio group (it should say "radio button" and "checked"), the haptic feel, and any StoreKit behavior (step 30, and the paid Apple account is last). Say plainly that none of it was verified on iOS.

Report: files created and changed; the Pro features shown and the four taken from the design and left out, with reasons; the placeholder prices, ids and URLs; icons used; copy keys added; the measured sizes; what was verified and what was not; every `TEMP` and `TODO` left for steps 22, 25, 30 and 34; and any difference from the HTML with its reason.
