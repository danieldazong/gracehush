import { getDeviceTimezone } from "@/data/mappers";
import {
  cancelScheduled,
  dismissPresented,
  ensureAffirmationChannel,
  getNotificationPermission,
  listPresentedIds,
  listScheduledIds,
  notificationsAvailable,
  requestNotificationPermission,
  scheduleAt,
} from "@/services/notifications";
import type { TrialStatus } from "@/types";
import {
  isTrialReminderId,
  planTrialReminder,
  reminderDayLabel,
  TRIAL_REMINDER_ID,
  TRIAL_REMINDER_KIND,
  type TrialTerms,
  trialReminderText,
} from "@/utils/trialReminder";

// The trial-end reminder on the phone (2026-11-18): one local notification, about two days before a free trial ends, that says what
// the person keeps, what the plan costs after the trial and where to manage it. The plan and the words are utils/trialReminder.ts;
// this only talks to the notifications. Local only, on the phone with no server: the price in it is the one the person was shown
// when they bought (the caller hands it over), it carries no words of the person's, and nothing about the person is reported
// anywhere. Nothing here throws, and the development log says a step that failed and nothing else: never the identifier, a date, a
// price or the text.

export type TrialReminderResult =
  | { status: "scheduled"; fireAt: number; day: string }
  // Nothing to schedule: this build cannot show notifications, or the trial is too short for a reminder.
  | { status: "skipped" }
  // The person has not allowed notifications for GraceHush.
  | { status: "denied" }
  | { status: "failed" };

const DAY_MS = 86_400_000;

function warn(step: string): void {
  if (__DEV__) console.warn(`[trial reminder] ${step}_failed`);
}

// True when the paywall may offer the switch: this build can show notifications, and the person has not turned them off for
// GraceHush. A permission never asked is fine, because the purchase asks in context; nothing is asked here.
export async function canOfferTrialReminder(): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  return (await getNotificationPermission()) !== "denied";
}

// A permission never asked is asked once, in context (the person has just started a trial and chose to be reminded). Anything
// but a yes is a no; a quiet (provisional) permission counts as given.
async function allowed(): Promise<boolean> {
  let permission = await getNotificationPermission();
  if (permission === "undetermined") permission = await requestNotificationPermission();
  return permission === "granted";
}

// After a trial purchase with the switch on. The plan comes first, so a trial too short for a reminder asks for nothing; then the
// permission; then one notification that replaces any earlier one. With no price to name there is no reminder: it never says a
// plan continues without saying at what.
export async function scheduleTrialReminder(endsAtMs: number, terms: TrialTerms): Promise<TrialReminderResult> {
  if (!notificationsAvailable() || terms.price.trim() === "") return { status: "skipped" };
  const plan = planTrialReminder({ endsAtMs, nowMs: Date.now(), timeZone: getDeviceTimezone() });
  if (plan === null) return { status: "skipped" };
  if (!(await allowed())) return { status: "denied" };
  try {
    await ensureAffirmationChannel();
    await cancelScheduled(plan.identifier);
    const { title, body } = trialReminderText(plan, terms);
    await scheduleAt({ identifier: plan.identifier, fireAt: plan.fireAt, title, body, data: { kind: TRIAL_REMINDER_KIND } });
    return { status: "scheduled", fireAt: plan.fireAt.getTime(), day: reminderDayLabel(plan.fireAt, plan.timeZone) };
  } catch {
    warn("schedule");
    return { status: "failed" };
  }
}

// Removes the waiting and the shown notifications that `isOurs` picks. Only identifiers with our prefix are ever picked, so the
// affirmations stay, and so does another project's notification (Expo Go lists those too).
async function removeReminders(isOurs: (identifier: string) => boolean): Promise<void> {
  try {
    for (const identifier of (await listScheduledIds()).filter(isOurs)) await cancelScheduled(identifier);
  } catch {
    warn("clear");
  }
  try {
    for (const identifier of (await listPresentedIds()).filter(isOurs)) await dismissPresented(identifier);
  } catch {
    warn("clear");
  }
}

// Removes every trial notification of ours, the real reminder and the developer panel's test ones. Sign-out and the panel's Clear
// button end here.
export async function clearTrialReminder(): Promise<void> {
  await removeReminders(isTrialReminderId);
}

// What RevenueCat reports about the account's trial, whenever it answers (services/subscriptionSync.ts). A trial that is gone,
// or that was cancelled in the store and will not renew, has nothing to remind about, so the real reminder goes, waiting or
// shown, and nothing else of ours: the developer panel's test notification is not a reminder for this account's trial and stays
// until it is tapped or cleared. An active trial that renews is left as it is, with no call at all. It never makes a reminder and
// never asks for a permission.
export async function reconcileTrialReminder(trial: TrialStatus | null): Promise<void> {
  if (trial !== null && trial.willRenew) return;
  await removeReminders((identifier) => identifier === TRIAL_REMINDER_ID);
}

// Development only (the developer panel): the real words, shown in `delayMs` instead of two days before, for a pretend trial that
// ends in three days, with the terms the panel read from the current offering. Answers whether it was scheduled.
export async function scheduleTestTrialReminder(terms: TrialTerms, delayMs = 10_000): Promise<boolean> {
  if (!notificationsAvailable() || terms.price.trim() === "") return false;
  const now = Date.now();
  const plan = planTrialReminder({ endsAtMs: now + 3 * DAY_MS, nowMs: now, timeZone: getDeviceTimezone() });
  if (plan === null || !(await allowed())) return false;
  try {
    await ensureAffirmationChannel();
    const { title, body } = trialReminderText(plan, terms);
    await scheduleAt({
      identifier: `trial-test-${now}`,
      fireAt: new Date(now + delayMs),
      title,
      body,
      data: { kind: TRIAL_REMINDER_KIND },
    });
    return true;
  } catch {
    warn("test");
    return false;
  }
}
