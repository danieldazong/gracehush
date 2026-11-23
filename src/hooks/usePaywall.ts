import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";

import { TRIAL_REMINDER_MIN_TRIAL_DAYS } from "@/constants/app";
import { getEntry, getUsage } from "@/data/journalRepository";
import { track } from "@/services/analytics";
import { haptics } from "@/services/haptics";
import {
  getCurrentOffering,
  isTrialEligible,
  purchasePackage,
  restorePurchases,
} from "@/services/purchases";
import {
  canOfferTrialReminder,
  scheduleTrialReminder,
  type TrialReminderResult,
} from "@/services/trialReminder";
import type { Offering, PlanPackage, PlanUsage, PurchaseErrorCode, RestoreResult } from "@/types";
import { activeIntroOffer } from "@/utils/pricing";

// A line under the button. It stays until the next purchase or restore, never on a timer.
export type PaywallNotice = "pending" | "error" | "notAllowed" | "restoreNone" | "restoreError";

type PaidTier = "trial" | "pro";

// What a success leaves for the done view: the plan, and what became of the trial-end reminder the person asked for (null when none
// was asked for: a plan with no trial, the switch off, or a restore).
type Done = { tier: PaidTier; reminder: TrialReminderResult | null };

export type PaywallState =
  | { status: "loading" }
  // The entry that sent the user here is a crisis entry: the screen replaces itself with Reflection.
  | { status: "crisis" }
  // A purchase or a restore succeeded.
  | { status: "done"; tier: PaidTier; reminder: TrialReminderResult | null }
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
      // The "Remind me before my trial ends" switch (2026-11-18): shown only for a trial of at least
      // TRIAL_REMINDER_MIN_TRIAL_DAYS days that the store confirmed for this user, on a phone that can be reminded. It starts on,
      // and the purchase schedules the reminder when it is.
      reminder: { available: boolean; on: boolean; set: (value: boolean) => void };
    };

type Loaded =
  | { kind: "crisis" }
  | { kind: "member"; tier: PaidTier }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      offering: Offering;
      eligibility: Record<string, boolean>;
      usage: PlanUsage;
      // Whether this phone can show the reminder (notifications can load and are not turned off for GraceHush). Read only when
      // some plan has a trial to sell; nothing is asked of the person.
      canRemind: boolean;
    };

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
    const eligibility = await readEligibility(offering);
    const sellsTrial = offering.packages.some((pkg) => activeIntroOffer(pkg, eligibility[pkg.id] ?? false) !== null);
    const canRemind = sellsTrial ? await canOfferTrialReminder().catch(() => false) : false;
    return { kind: "ready", offering, eligibility, usage, canRemind };
  } catch {
    return { kind: "unavailable" };
  }
}

// A cancelled purchase says nothing. ALREADY_OWNED never gets here: the caller restores instead.
function noticeForPurchase(code: PurchaseErrorCode): PaywallNotice | null {
  switch (code) {
    case "CANCELLED":
      return null;
    case "PENDING":
      return "pending";
    case "NOT_ALLOWED":
      return "notAllowed";
    default:
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
  const [done, setDone] = useState<Done | null>(null);
  // The reminder switch. On by default: it is the whole point of showing it, and the person can turn it off before they buy.
  const [remind, setRemind] = useState(true);
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
  const selectedKind = selected?.kind;
  // What the plan costs after the trial, for the reminder's words: the package's own price string and period.
  const selectedPrice = selected?.priceString ?? null;
  const selectedPeriod = selected?.periodLabel ?? null;
  // The switch is offered for a trial long enough to remind about, that the store confirmed for this user.
  const trialDays =
    selected !== null && loaded?.kind === "ready"
      ? (activeIntroOffer(selected, loaded.eligibility[selected.id] ?? false)?.periodDays ?? 0)
      : 0;
  const reminderAvailable = loaded?.kind === "ready" && loaded.canRemind && trialDays >= TRIAL_REMINDER_MIN_TRIAL_DAYS;

  const select = useCallback(
    (packageId: string) => {
      if (packageId !== selectedId) haptics.selection();
      setPicked(packageId);
    },
    [selectedId],
  );

  const setReminder = useCallback(
    (value: boolean) => {
      if (value !== remind) haptics.selection();
      setRemind(value);
    },
    [remind],
  );

  const purchase = useCallback(async () => {
    if (running.current || selectedId === null) return;
    running.current = true;
    setNotice(null);
    setPurchasing(true);
    try {
      const result = await purchasePackage(selectedId);
      // Sent before the screen check: a purchase that finishes after the screen closed still happened (step 34). A cancel
      // is CANCELLED: behaviour, not an error.
      if (!result.ok) track("purchase_failed", { code: result.code });
      else if (selectedKind !== undefined) track("purchase_completed", { plan: selectedKind, trial: result.tier === "trial" });
      // The reminder the person asked for is set whether or not the screen is still open, like the event above: the trial has
      // started. It names the price the person was shown, so the terms are the bought package's own. A failure to set it never
      // fails the purchase; the done view says what happened.
      let reminder: TrialReminderResult | null = null;
      if (
        result.ok &&
        result.tier === "trial" &&
        reminderAvailable &&
        remind &&
        typeof result.trialEndsAt === "number" &&
        selectedPrice !== null &&
        selectedPeriod !== null
      ) {
        reminder = await scheduleTrialReminder(result.trialEndsAt, { price: selectedPrice, period: selectedPeriod }).catch(
          (): TrialReminderResult => ({ status: "failed" }),
        );
      }
      if (!mounted.current) return;
      if (result.ok) {
        setDone({ tier: result.tier, reminder });
      } else if (result.code === "ALREADY_OWNED") {
        // The store says this account already has it: restore it instead of buying twice.
        setPurchasing(false);
        setRestoring(true);
        const answer = await restorePurchases();
        if (answer.ok) track("restore_completed", { found: answer.restored });
        const restored = restoreOutcome(answer);
        if (!mounted.current) return;
        if ("tier" in restored) setDone({ tier: restored.tier, reminder: null });
        else setNotice(restored.notice);
      } else {
        setNotice(noticeForPurchase(result.code));
      }
    } catch {
      track("purchase_failed", { code: "UNKNOWN" });
      if (mounted.current) setNotice("error");
    } finally {
      running.current = false;
      if (mounted.current) {
        setPurchasing(false);
        setRestoring(false);
      }
    }
  }, [selectedId, selectedKind, selectedPrice, selectedPeriod, reminderAvailable, remind]);

  const restore = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setNotice(null);
    setRestoring(true);
    try {
      const answer = await restorePurchases();
      if (answer.ok) track("restore_completed", { found: answer.restored });
      const restored = restoreOutcome(answer);
      if (!mounted.current) return;
      if ("tier" in restored) setDone({ tier: restored.tier, reminder: null });
      else setNotice(restored.notice);
    } catch {
      if (mounted.current) setNotice("restoreError");
    } finally {
      running.current = false;
      if (mounted.current) setRestoring(false);
    }
  }, []);

  if (done !== null) return { status: "done", tier: done.tier, reminder: done.reminder };
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
    reminder: { available: reminderAvailable, on: remind, set: setReminder },
  };
}
