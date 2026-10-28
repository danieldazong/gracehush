import { AFFIRMATION_DAYS_AHEAD } from "@/constants/app";
import { copy } from "@/constants/copy";
import type { AffirmationSource, PermissionResult, TimeSlot } from "@/types";
import { addDays, calendarDayIn, instantAt, isTimeZone } from "@/utils/zonedTime";

// Which affirmation notifications the phone should hold (step 28), worked out with no side effect: the scheduler compares
// this plan with what is scheduled and changes only the difference.
//
// An identifier names the slot, the local day and time, and a short hash of everything else the notification carries (its
// instant, title, body, entry and account). iOS reports a scheduled date trigger back as a time interval, so the phone cannot
// be asked when a notification will fire: the identifier says it instead, and any change (a reminder time, the time zone,
// a newer reflection, another account) is a new identifier. The same plan gives the same identifiers, so a run that finds
// nothing changed schedules and cancels nothing.

export const AFFIRMATION_ID_PREFIX = "aff-";
const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];
const PLANNED_ID = /^aff-(morning|afternoon|evening)-\d{8}-\d{4}-[0-9a-f]{8}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const USER_HASH = /^[0-9a-f]{16}$/;

// What a notification carries for its tap (notificationRouting.ts reads it back with readTapData).
export type AffirmationTapData = { kind: "affirmation"; entryId: string; slot: TimeSlot; userHash: string };

export type PlannedAffirmation = {
  identifier: string;
  fireAt: Date;
  title: string; // "Morning affirmation"
  body: string; // the affirmation's headline: never its text, the person's words, the emotion or the verse
  data: AffirmationTapData;
};

export type PlanInput = {
  now: Date;
  timeZone: string;
  reminders: Record<TimeSlot, string>;
  enabled: boolean; // Profile's Daily Affirmations switch
  permission: PermissionResult;
  source: AffirmationSource | null; // the newest finished reflection on the phone, and its affirmations
  userHash: string;
  days?: number;
};

// FNV-1a, 32 bits: short, stable and enough to tell two plans apart (a collision only means one notification is kept).
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const pad = (value: number, size: number) => String(value).padStart(size, "0");

// Nothing is planned while the switch is off, the phone will not show notifications, there is no finished reflection, or the
// newest one is a crisis entry: then nothing at all is sent until a newer reflection is ready, and an older reflection's
// affirmations are not used either. A reflection without all three headlines is skipped the same way.
export function planAffirmations(input: PlanInput): PlannedAffirmation[] {
  const { source } = input;
  if (!input.enabled || input.permission !== "granted" || source === null || source.isCrisis) return [];
  if (!USER_HASH.test(input.userHash)) return [];
  const headlines = new Map<TimeSlot, string>();
  for (const affirmation of source.affirmations) headlines.set(affirmation.slot, affirmation.headline.trim());
  if (SLOTS.some((slot) => !headlines.get(slot))) return [];

  const zone = isTimeZone(input.timeZone) ? input.timeZone : "UTC";
  const today = calendarDayIn(input.now, zone);
  const plan: PlannedAffirmation[] = [];
  for (let offset = 0; offset < (input.days ?? AFFIRMATION_DAYS_AHEAD); offset += 1) {
    const day = addDays(today, offset);
    for (const slot of SLOTS) {
      const time = input.reminders[slot];
      if (!TIME.test(time)) continue;
      const fireAt = instantAt(day, time, zone);
      if (fireAt.getTime() <= input.now.getTime()) continue;
      const title = copy.notifications.affirmationTitle(copy.onboarding.rhythm.slots[slot].name);
      const body = headlines.get(slot) ?? "";
      const hash = fnv1a([fireAt.getTime(), title, body, source.entryId, input.userHash].join("|"));
      const stamp = `${day.year}${pad(day.month, 2)}${pad(day.day, 2)}-${time.replace(":", "")}`;
      plan.push({
        identifier: `${AFFIRMATION_ID_PREFIX}${slot}-${stamp}-${hash}`,
        fireAt,
        title,
        body,
        data: { kind: "affirmation", entryId: source.entryId, slot, userHash: input.userHash },
      });
    }
  }
  return plan.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

// An identifier the planner made. The scheduler only ever cancels these (and, at sign-out, anything with the prefix), never a
// notification it did not make.
export function isPlannedAffirmationId(identifier: string): boolean {
  return PLANNED_ID.test(identifier);
}

// The developer panel's test notification: it has the prefix, so sign-out clears it, but it is not planned, so a reschedule
// never cancels it before it fires.
export function testAffirmationId(nowMs: number): string {
  return `${AFFIRMATION_ID_PREFIX}test-${nowMs}`;
}

// A tapped notification's data, or null when it is not one of ours. Expo Go adds keys of its own (experienceId, scopeKey),
// so only these four are read.
export function readTapData(data: unknown): AffirmationTapData | null {
  if (typeof data !== "object" || data === null) return null;
  const { kind, entryId, slot, userHash } = data as Record<string, unknown>;
  if (kind !== "affirmation" || typeof entryId !== "string" || entryId.length === 0) return null;
  if (slot !== "morning" && slot !== "afternoon" && slot !== "evening") return null;
  if (typeof userHash !== "string" || !USER_HASH.test(userHash)) return null;
  return { kind, entryId, slot, userHash };
}
