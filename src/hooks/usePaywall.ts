import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";

import { getEntry, getUsage } from "@/data/journalRepository";
import { haptics } from "@/services/haptics";
import {
  getCurrentOffering,
  isTrialEligible,
  purchasePackage,
  restorePurchases,
} from "@/services/purchases";
import type { Offering, PlanPackage, PlanUsage, PurchaseErrorCode, RestoreResult } from "@/types";

// A line under the button. It stays until the next purchase or restore, never on a timer.
export type PaywallNotice = "pending" | "error" | "notAllowed" | "restoreNone" | "restoreError";

type PaidTier = "trial" | "pro";

export type PaywallState =
  | { status: "loading" }
  // The entry that sent the user here is a crisis entry: the screen replaces itself with Reflection.
  | { status: "crisis" }
  // A purchase or a restore succeeded.
  | { status: "done"; tier: PaidTier }
  // Already subscribed when the screen opened.
  | { status: "member"; tier: PaidTier }
  | {
      status: "unavailable";
      retry: () => void;
      restore: () => Promise<void>;
      restoring: boolean;
      notice: PaywallNotice | null;
    }
  | {
      status: "ready";
      offering: Offering;
      selected: PlanPackage;
      // By package id. Only a package with a free trial can be true.
      eligibility: Record<string, boolean>;
      usage: PlanUsage;
      select: (packageId: string) => void;
      purchase: () => Promise<void>;
      restore: () => Promise<void>;
      purchasing: boolean;
      restoring: boolean;
      notice: PaywallNotice | null;
    };

type Loaded =
  | { kind: "crisis" }
  | { kind: "member"; tier: PaidTier }
  | { kind: "unavailable" }
  | { kind: "ready"; offering: Offering; eligibility: Record<string, boolean>; usage: PlanUsage };

// The yearly plan is the one to see selected first.
function defaultPackage(packages: PlanPackage[]): PlanPackage | null {
  return packages.find((pkg) => pkg.kind === "annual") ?? packages[0] ?? null;
}

// Whether the store would give this user each package's free trial. A failed check counts as not eligible, so a
// trial is never advertised without confirmation.
async function readEligibility(offering: Offering): Promise<Record<string, boolean>> {
  const withTrial = offering.packages.filter((pkg) => pkg.introOffer !== null);
  const flags = await Promise.all(withTrial.map((pkg) => isTrialEligible(pkg.id).catch(() => false)));
  return Object.fromEntries(withTrial.map((pkg, index) => [pkg.id, flags[index]]));
}

// The order of the decisions: a crisis entry first (crisis support is never paywalled), then a subscriber, then
// whether there is anything to sell. Any failure counts as no plans.
async function loadPaywall(entryId: string | undefined): Promise<Loaded> {
  try {
    const [usage, offering, entry] = await Promise.all([
      getUsage(),
      getCurrentOffering(),
      entryId === undefined ? Promise.resolve(null) : getEntry(entryId),
    ]);
    if (entry?.isCrisis === true) return { kind: "crisis" };
    if (usage.tier !== "free") return { kind: "member", tier: usage.tier };
    if (offering === null || offering.packages.length === 0) return { kind: "unavailable" };
    return { kind: "ready", offering, eligibility: await readEligibility(offering), usage };
  } catch {
    return { kind: "unavailable" };
  }
}

// A cancelled purchase says nothing. ALREADY_OWNED never gets here: the caller restores instead.
function noticeForPurchase(code: PurchaseErrorCode): PaywallNotice | null {
  switch (code) {
    case "CANCELLED":
      // TODO(34): purchase_failed { code: 'CANCELLED' }
      return null;
    case "PENDING":
      return "pending";
    case "NOT_ALLOWED":
      return "notAllowed";
    default:
      // TODO(34): purchase_failed { code }
      return "error";
  }
}

function restoreOutcome(result: RestoreResult): { tier: PaidTier } | { notice: PaywallNotice } {
  if (!result.ok) return { notice: "restoreError" };
  const { tier } = result;
  return result.restored && tier !== "free" ? { tier } : { notice: "restoreNone" };
}

// What the Paywall shows and does. It loads like the other screens: when the screen takes focus, and again on
// "Try again". Purchases and restores are guarded by one flag, so neither starts while the other runs.
export function usePaywall(entryId: string | undefined): PaywallState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<PaywallNotice | null>(null);
  const [done, setDone] = useState<PaidTier | null>(null);
  // Only the latest load may set state. Touched in callbacks and effects only, never in render.
  const latestLoad = useRef(0);
  // True while a purchase or a restore runs.
  const running = useRef(false);
  // A purchase or restore that finishes after the screen closed sets nothing.
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    latestLoad.current += 1;
    const request = latestLoad.current;
    const next = await loadPaywall(entryId);
    if (request === latestLoad.current) setLoaded(next);
  }, [entryId]);

  // Leaving the screen drops a response that is still on its way.
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        latestLoad.current += 1;
      };
    }, [load]),
  );

  const retry = useCallback(() => {
    setLoaded(null);
    setNotice(null);
    load();
  }, [load]);

  // The user's pick, or the default. Derived here, so nothing is set from an effect.
  const offering = loaded?.kind === "ready" ? loaded.offering : null;
  const selected =
    offering === null
      ? null
      : (offering.packages.find((pkg) => pkg.id === picked) ?? defaultPackage(offering.packages));
  const selectedId = selected?.id ?? null;

  const select = useCallback(
    (packageId: string) => {
      if (packageId !== selectedId) haptics.selection();
      setPicked(packageId);
    },
    [selectedId],
  );

  const purchase = useCallback(async () => {
    if (running.current || selectedId === null) return;
    running.current = true;
    setNotice(null);
    setPurchasing(true);
    try {
      const result = await purchasePackage(selectedId);
      if (!mounted.current) return;
      if (result.ok) {
        setDone(result.tier);
      } else if (result.code === "ALREADY_OWNED") {
        // The store says this account already has it: restore it instead of buying twice.
        setPurchasing(false);
        setRestoring(true);
        const restored = restoreOutcome(await restorePurchases());
        if (!mounted.current) return;
        if ("tier" in restored) setDone(restored.tier);
        else setNotice(restored.notice);
      } else {
        setNotice(noticeForPurchase(result.code));
      }
    } catch {
      if (mounted.current) setNotice("error");
    } finally {
      running.current = false;
      if (mounted.current) {
        setPurchasing(false);
        setRestoring(false);
      }
    }
  }, [selectedId]);

  const restore = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setNotice(null);
    setRestoring(true);
    try {
      const restored = restoreOutcome(await restorePurchases());
      if (!mounted.current) return;
      if ("tier" in restored) setDone(restored.tier);
      else setNotice(restored.notice);
    } catch {
      if (mounted.current) setNotice("restoreError");
    } finally {
      running.current = false;
      if (mounted.current) setRestoring(false);
    }
  }, []);

  if (done !== null) return { status: "done", tier: done };
  if (loaded === null) return { status: "loading" };
  if (loaded.kind === "crisis") return { status: "crisis" };
  if (loaded.kind === "member") return { status: "member", tier: loaded.tier };
  if (loaded.kind === "unavailable" || selected === null) {
    return { status: "unavailable", retry, restore, restoring, notice };
  }
  return {
    status: "ready",
    offering: loaded.offering,
    selected,
    eligibility: loaded.eligibility,
    usage: loaded.usage,
    select,
    purchase,
    restore,
    purchasing,
    restoring,
    notice,
  };
}
