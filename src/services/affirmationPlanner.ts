import { copy } from "@/constants/copy";
import type { PermissionResult, TimeSlot } from "@/types";
import { flowVerse, quoteVerse } from "@/utils/format";
import type { DealtWord } from "@/utils/wordDeck";

// Which affirmation notifications the phone should hold (step 28), worked out with no side effect: the scheduler compares
// this plan with what is scheduled and changes only the difference. Which word each reminder carries is the Word Deck's
// (utils/wordDeck.ts, 2026-11-17): the reminders take turns between the reflections of the week. This file only turns that
// deal into notifications.
//
// An identifier names the slot, the local day and time, and a short hash of everything else the notification carries (its
// instant, title, body, entry and account). iOS reports a scheduled date trigger back as a time interval, so the phone cannot
// be asked when a notification will fire: the identifier says it instead, and any change (a reminder time, the time zone,
// a new reflection's turn, another account) is a new identifier. The same deal gives the same identifiers, so a run that finds
// nothing changed schedules and cancels nothing.

export const AFFIRMATION_ID_PREFIX = "aff-";
const PLANNED_ID = /^aff-(morning|afternoon|evening)-\d{8}-\d{4}-[0-9a-f]{8}$/;
const USER_HASH = /^[0-9a-f]{16}$/;

// What a notification carries for its tap (notificationRouting.ts reads it back with readTapData).
export type AffirmationTapData = { kind: "affirmation"; entryId: string; slot: TimeSlot; userHash: string };

export type PlannedAffirmation = {
  identifier: string;
  fireAt: Date;
  // Step 37: an affirmation with a verse is its headline as the title and the verse with its reference as the body; one
  // without (saved before step 37, or whose verse could not be found) keeps step 28's form, "Morning affirmation" over the
  // headline. Never the affirmation's text, the person's words or the emotion.
  title: string;
  body: string;
  data: AffirmationTapData;
};

export type PlanInput = {
  enabled: boolean; // Profile's Daily Affirmations switch
  permission: PermissionResult;
  // The word each reminder ahead carries, in time order (dealWords): the reminders that have passed are not in it.
  deal: readonly DealtWord[];
  userHash: string;
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

// Nothing is planned while the switch is off, the phone will not show notifications, or the deal is empty (no reflection has a
// word, or the newest one is a heavy moment saved before 2026-11-08, which keeps the app quiet: the pool says so). A heavy
// moment's affirmations are sent like any other's (2026-11-08: they are written to speak hope). Each reminder carries its dealt
// word: an affirmation with a verse is its headline as the title and the verse with its reference as the body; one without
// keeps step 28's form, "Morning affirmation" over the headline, the slot being the one it is delivered at. The tap opens the
// word's own reflection.
export function planAffirmations(input: PlanInput): PlannedAffirmation[] {
  if (!input.enabled || input.permission !== "granted") return [];
  if (!USER_HASH.test(input.userHash)) return [];
  return input.deal.map(({ day, slot, time, fireAt, word }) => {
    const verse = word.verse
      ? copy.notifications.affirmationVerse(quoteVerse(flowVerse(word.verse.text)), word.verse.reference.trim())
      : null;
    const title = verse ? word.headline : copy.notifications.affirmationTitle(copy.onboarding.rhythm.slots[slot].name);
    const body = verse ?? word.headline;
    const hash = fnv1a([fireAt.getTime(), title, body, word.entryId, input.userHash].join("|"));
    const stamp = `${day.year}${pad(day.month, 2)}${pad(day.day, 2)}-${time.replace(":", "")}`;
    return {
      identifier: `${AFFIRMATION_ID_PREFIX}${slot}-${stamp}-${hash}`,
      fireAt,
      title,
      body,
      data: { kind: "affirmation" as const, entryId: word.entryId, slot, userHash: input.userHash },
    };
  });
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
