import { ANXIOUS_ENTRY_ID } from "@/data/mock/entries";
import type { TimeSlot } from "@/types";
import type { DailyAffirmationRow, JournalEntryRow } from "@/types/database";

// General on purpose: affirmations reach the lock screen, so they never mention the entry's specifics.
const AFFIRMATIONS: { slot: TimeSlot; headline: string; text: string }[] = [
  {
    slot: "morning",
    headline: "You are held, not hurried",
    text: "Give yourself permission to breathe slowly today. The burden you carry is already witnessed and held with gentle hands.",
  },
  {
    slot: "afternoon",
    headline: "Cast your cares like pebbles into quiet water",
    text: "Set down what you cannot fix this afternoon. Each worry you release is received, and you are allowed to rest in that quiet.",
  },
  {
    slot: "evening",
    headline: "Sleep is an act of trust",
    text: "You have done enough for today. Lay down your questions and let the night keep watch while you rest in God’s care.",
  },
];

// Three rows tied to the anxious entry from yesterday ("Tied to yesterday's prayer"), created with it.
export function buildAffirmations(entries: JournalEntryRow[]): DailyAffirmationRow[] {
  const source = entries.find((entry) => entry.id === ANXIOUS_ENTRY_ID);
  if (!source) return [];
  return AFFIRMATIONS.map(({ slot, headline, text }) => ({
    id: `affirmation-yesterday-${slot}`,
    user_id: source.user_id,
    entry_id: source.id,
    time_slot: slot,
    headline,
    affirmation_text: text,
    is_delivered: false,
    created_at: source.created_at,
    is_favorite: false,
    scheduled_for: null,
  }));
}
