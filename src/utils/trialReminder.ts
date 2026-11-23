import { TRIAL_REMINDER_AT, TRIAL_REMINDER_DAYS_BEFORE, TRIAL_REMINDER_MIN_LEAD_MS } from "@/constants/app";
import { copy } from "@/constants/copy";
import { addDays, calendarDayIn, clockIn, instantAt, isTimeZone } from "@/utils/zonedTime";

// The trial-end reminder, worked out (2026-11-18). Pure: no phone, no clock of its own, so a check can set both. A person who starts a
// free trial may switch on one local notification, TRIAL_REMINDER_DAYS_BEFORE calendar days before the day the trial ends, at
// TRIAL_REMINDER_AT on their clock. It names the day the trial ends, what the person keeps, what the plan costs after the trial and
// where to manage it. Apple lets a person cancel a trial up to 24 hours before it ends and no later, and the reminder falls 38 to 62
// hours before the end (an hour more or less where the clocks change), so there is always about a day left to act on it, whichever
// way the person decides. services/trialReminder.ts schedules it.

// The one reminder a phone holds. The developer button's test notification is "trial-test-{ms}", so everything of ours starts with
// the prefix and a clean-up never touches anything else (the affirmations are "aff-…").
export const TRIAL_REMINDER_ID = "trial-ending";
export const TRIAL_REMINDER_PREFIX = "trial-";
// Its tap data, and what the tap routing looks for.
export const TRIAL_REMINDER_KIND = "trial_reminder";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type TrialReminderPlan = {
  identifier: string;
  // When the notification is shown.
  fireAt: Date;
  // When the trial ends.
  endsAt: Date;
  // The zone every day in the text is read in (the phone's, or UTC when the phone's cannot be read).
  timeZone: string;
};

// What the plan costs once the trial is over: the store's own price string and the billing period of the package that was bought
// (PlanPackage.priceString and periodLabel), so no price is ever typed in the app.
export type TrialTerms = { price: string; period: string };

// The reminder for a trial that ends at `endsAtMs`, or null when there is nothing to plan: the end is not a time or is not ahead,
// or the reminder's moment is less than TRIAL_REMINDER_MIN_LEAD_MS away (iOS refuses a time that has passed). A zone Intl does not
// know is read as UTC. The day is the calendar day the trial ends on in the zone, so the reminder is 10:00 on the person's own
// clock whatever the zone and across a daylight-saving change (utils/zonedTime.ts).
export function planTrialReminder(input: { endsAtMs: number; nowMs: number; timeZone: string }): TrialReminderPlan | null {
  const { endsAtMs, nowMs } = input;
  if (!Number.isFinite(endsAtMs) || !Number.isFinite(nowMs) || endsAtMs <= nowMs) return null;
  const endsAt = new Date(endsAtMs);
  if (Number.isNaN(endsAt.getTime())) return null;
  const timeZone = isTimeZone(input.timeZone) ? input.timeZone : "UTC";
  const reminderDay = addDays(calendarDayIn(endsAt, timeZone), -TRIAL_REMINDER_DAYS_BEFORE);
  const fireAt = instantAt(reminderDay, TRIAL_REMINDER_AT, timeZone);
  if (fireAt.getTime() < nowMs + TRIAL_REMINDER_MIN_LEAD_MS) return null;
  return { identifier: TRIAL_REMINDER_ID, fireAt, endsAt, timeZone };
}

// "Monday", from the zone's own calendar. Names are written out, not asked of Intl, so they are the same on every engine.
function weekdayLabel(at: Date, zone: string): string {
  const { year, month, day } = clockIn(at, zone);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

// "Monday, Nov 30".
function dayLabel(at: Date, zone: string): string {
  const { month, day } = clockIn(at, zone);
  return `${weekdayLabel(at, zone)}, ${MONTHS[month - 1]} ${day}`;
}

// The day the reminder is shown on, for the paywall's line after the purchase: "Saturday, Nov 28".
export function reminderDayLabel(at: Date, timeZone: string): string {
  return dayLabel(at, isTimeZone(timeZone) ? timeZone : "UTC");
}

// The notification's words, the same on both platforms: the weekday the trial ends on, then what the person keeps, what the plan
// costs after the trial and where to manage it (copy.notifications.trialEnding).
export function trialReminderText(plan: TrialReminderPlan, terms: TrialTerms): { title: string; body: string } {
  const words = copy.notifications.trialEnding;
  return { title: words.title(weekdayLabel(plan.endsAt, plan.timeZone)), body: words.body(terms.price, terms.period) };
}

export function isTrialReminderId(identifier: string): boolean {
  return identifier.startsWith(TRIAL_REMINDER_PREFIX);
}

// True for the data a trial reminder carries. Expo Go adds keys of its own to a notification's data, so only `kind` is read.
export function isTrialReminderTap(data: unknown): boolean {
  return typeof data === "object" && data !== null && "kind" in data && data.kind === TRIAL_REMINDER_KIND;
}
