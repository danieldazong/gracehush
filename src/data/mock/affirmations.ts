import { ANXIOUS_ENTRY_ID } from "@/data/mock/entries";
import type { TimeSlot } from "@/types";
import type { DailyAffirmationRow, JournalEntryRow } from "@/types/database";

// General on purpose: affirmations reach the lock screen, so they never mention the entry's specifics. Since step 37 each one
// carries a verse of the Berean Standard Bible, as the server saves it: the verse's own words with its line breaks, copied
// from the real chapters in supabase/functions/_shared/bible/fixtures (a check in supabase/tests/notifications compares them),
// and a headline written from that verse.
const AFFIRMATIONS: {
  slot: TimeSlot;
  headline: string;
  text: string;
  verse: { reference: string; text: string };
}[] = [
  {
    slot: "morning",
    headline: "Your help is already here",
    text: "Before the first task of the day, you have a refuge. God is near in every hour of it, and his strength is yours today.",
    verse: {
      reference: "Psalm 46:1",
      text: "God is our refuge and strength,\nan ever-present help in times of trouble.",
    },
  },
  {
    slot: "afternoon",
    headline: "Nothing you need is beyond him",
    text: "In the middle of what worries you this afternoon, your Father already knows what you need, and he is generous with you.",
    verse: {
      reference: "Philippians 4:19",
      text: "And my God will supply all your needs according to His glorious riches in Christ Jesus.",
    },
  },
  {
    slot: "evening",
    headline: "A shepherd keeps watch tonight",
    text: "You have done enough for today. Lay down what you carried and let the night keep watch while you rest in God’s care.",
    verse: {
      reference: "Psalm 23:1",
      text: "The LORD is my shepherd;\nI shall not want.",
    },
  },
];

// Three rows tied to the anxious entry from yesterday ("Tied to yesterday's prayer"), created with it.
export function buildAffirmations(entries: JournalEntryRow[]): DailyAffirmationRow[] {
  const source = entries.find((entry) => entry.id === ANXIOUS_ENTRY_ID);
  if (!source) return [];
  return AFFIRMATIONS.map(({ slot, headline, text, verse }) => ({
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
    verse_reference: verse.reference,
    verse_text: verse.text,
  }));
}
