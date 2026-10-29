import { copy } from "@/constants/copy";
import type { IntroOffer, PlanPackage } from "@/types";

const { cta, disclosure } = copy.paywall;

// The yearly saving against twelve monthly payments, as a whole percent. Null when there is nothing honest to say:
// the currencies differ, a price is not a finite number above zero, or the saving rounds to less than 1%.
export function annualSavingsPercent(annual: PlanPackage, monthly: PlanPackage): number | null {
  if (annual.currencyCode !== monthly.currencyCode) return null;
  const prices = [annual.price, monthly.price];
  if (!prices.every((price) => Number.isFinite(price) && price > 0)) return null;
  const percent = Math.round((1 - annual.price / (monthly.price * 12)) * 100);
  return percent >= 1 ? percent : null;
}

// What one month of a yearly plan costs, for the "per month, billed yearly" line. Annual packages only.
// Intl formats in the device locale while the store's price strings follow the store's, so the two can differ in
// style on a few devices; that is why the SDK's own string wins when it has one (services/purchases.ts passes it on).
export function pricePerMonthLabel(pkg: PlanPackage): string | null {
  if (pkg.kind !== "annual") return null;
  if (pkg.pricePerMonthString !== null) return pkg.pricePerMonthString;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: pkg.currencyCode }).format(
      pkg.price / 12,
    );
  } catch {
    // An invalid currency code. No line is better than a wrong one.
    return null;
  }
}

// The trial this user can really get: the package has one and the store confirmed they are eligible. A trial that
// cannot be confirmed is never advertised.
export function activeIntroOffer(pkg: PlanPackage, eligible: boolean): IntroOffer | null {
  return eligible ? pkg.introOffer : null;
}

// The button's label: "Start 7-day free trial", or "Subscribe for $59.99/year" when there is no trial to offer.
export function trialCtaLabel(pkg: PlanPackage, eligible: boolean): string {
  const trial = activeIntroOffer(pkg, eligible);
  return trial ? cta.trial(trial.periodDays) : cta.subscribe(pkg.priceString, pkg.periodLabel);
}

// The renewal and cancellation terms under the button, for the store the app runs on. `price` and `period` are
// the billing ones, not the trial's.
export function renewalDisclosure(
  pkg: PlanPackage,
  eligible: boolean,
  platform: "ios" | "android",
): string {
  const trial = activeIntroOffer(pkg, eligible);
  const ios = platform === "ios";
  if (trial) {
    const build = ios ? disclosure.trialIos : disclosure.trialAndroid;
    return build(trial.periodDays, pkg.priceString, pkg.periodLabel);
  }
  const build = ios ? disclosure.paidIos : disclosure.paidAndroid;
  return build(pkg.priceString, pkg.periodLabel);
}
