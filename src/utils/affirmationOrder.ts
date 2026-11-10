import type { Affirmation, TimeSlot } from "@/types";

const SLOT_ORDER: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

// An affirmation's place among its reflection's (2026-11-09): the server's position when the row has one (1 to 10), else the
// order of its lock-screen slot for a row read or cached before the column existed, else 1. The server's response.ts has the
// same rule, so the app shows a reflection the function answered and one it read back in the same order.
export function affirmationPosition(value: unknown, slot: TimeSlot | null): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  return slot === null ? 1 : SLOT_ORDER.indexOf(slot) + 1;
}

// The order of the cards.
export function byPosition(a: Affirmation, b: Affirmation): number {
  return a.position - b.position;
}
