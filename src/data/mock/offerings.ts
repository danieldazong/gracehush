import type { Offering } from "@/types";

// TEMP(30): the offering comes from RevenueCat (services/purchases.ts); delete this file
// PLACEHOLDER prices and ids. Real prices are set in App Store Connect and Play Console and arrive through
// RevenueCat. Never copy these values into screens or copy.ts.
// Freshly built on every call, so a screen can never change the offering by accident.
export function buildMockOffering(): Offering {
  return {
    id: "default",
    packages: [
      {
        id: "$rc_annual",
        kind: "annual",
        productId: "gracehush_pro_yearly",
        priceString: "$59.99",
        price: 59.99,
        currencyCode: "USD",
        periodLabel: "year",
        // null, so the per-month helper's Intl path is the one exercised. Step 30 passes the SDK's own string.
        pricePerMonthString: null,
        introOffer: { kind: "free_trial", periodDays: 7 },
      },
      {
        id: "$rc_monthly",
        kind: "monthly",
        productId: "gracehush_pro_monthly",
        priceString: "$9.99",
        price: 9.99,
        currencyCode: "USD",
        periodLabel: "month",
        pricePerMonthString: null,
        introOffer: null,
      },
    ],
  };
}
