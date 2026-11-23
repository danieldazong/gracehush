import type { Offering } from "@/types";

// The mock data source's offering (step 16); the real one comes from RevenueCat (services/purchases.ts).
// PLACEHOLDER prices and ids, set to the launch pricing the owner approved on 2026-11-18 ($125.99 a year with a 3-day free trial
// that covers reflections and not Scholar, $14.99 a month with none) so the development preview shows what the stores will. Real
// prices are set in App Store Connect and Play Console and arrive through RevenueCat. Never copy these values into screens or
// copy.ts.
// Freshly built on every call, so a screen can never change the offering by accident.
export function buildMockOffering(): Offering {
  return {
    id: "default",
    packages: [
      {
        id: "$rc_annual",
        kind: "annual",
        productId: "gracehush_pro_yearly",
        priceString: "$125.99",
        price: 125.99,
        currencyCode: "USD",
        periodLabel: "year",
        // null, so the per-month helper's Intl path is the one exercised. Step 30 passes the SDK's own string.
        pricePerMonthString: null,
        introOffer: { kind: "free_trial", periodDays: 3 },
      },
      {
        id: "$rc_monthly",
        kind: "monthly",
        productId: "gracehush_pro_monthly",
        priceString: "$14.99",
        price: 14.99,
        currencyCode: "USD",
        periodLabel: "month",
        pricePerMonthString: null,
        introOffer: null,
      },
    ],
  };
}
