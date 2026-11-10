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
  return AFFIRMATIONS.map(({ slot, headline, text, verse }, index) => ({
    id: `affirmation-yesterday-${slot}`,
    user_id: source.user_id,
    entry_id: source.id,
    time_slot: slot,
    position: index + 1,
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

// The affirmations the mock's add-affirmation adds, in order (2026-11-09): one per tap, with no lock-screen slot, each with a
// verse copied from the fixtures like the three above (the same check reads them). General on purpose, like the three.
export const EXTRA_AFFIRMATIONS: readonly { headline: string; text: string; verse: { reference: string; text: string } }[] = [
  {
    headline: "He leads you to still water",
    text: "The pace of your day is not the pace of your shepherd. He knows where the quiet places are, and he walks you to them.",
    verse: { reference: "Psalm 23:2", text: "He makes me lie down in green pastures;\nHe leads me beside quiet waters." },
  },
  {
    headline: "Your soul can be restored",
    text: "What the day has worn down, God mends. He guides you on, not for your record but for his name, which he keeps.",
    verse: {
      reference: "Psalm 23:3",
      text: "He restores my soul;\nHe guides me in the paths of righteousness\nfor the sake of His name.",
    },
  },
  {
    headline: "He walks the dark stretch too",
    text: "Where the way turns dark, God does not send you ahead alone. His presence is the comfort, and it goes the whole way.",
    verse: {
      reference: "Psalm 23:4",
      text: "Even though I walk through the valley of the shadow of death,\nI will fear no evil,\nfor You are with me;\nYour rod and Your staff, they comfort me.",
    },
  },
  {
    headline: "Goodness follows you home",
    text: "Mercy is not behind you only on good days. It follows all your days, and your place with God is kept for you.",
    verse: {
      reference: "Psalm 23:6",
      text: "Surely goodness and mercy will follow me\nall the days of my life,\nand I will dwell in the house of the LORD\nforever.",
    },
  },
  {
    headline: "God’s help comes with the dawn",
    text: "God is not outside your situation looking in. He is within it, and his help is timed for the morning you need it.",
    verse: { reference: "Psalm 46:5", text: "God is within her; she will not be moved.\nGod will help her when morning dawns." },
  },
  {
    headline: "Peace stands guard over you",
    text: "You do not have to understand everything to be at peace. God’s own peace keeps watch over your heart and your mind.",
    verse: {
      reference: "Philippians 4:7",
      text: "And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.",
    },
  },
  {
    headline: "Sleep is his gift to you",
    text: "Striving does not keep your world together. God does, and he gives rest to the ones he loves, you among them.",
    verse: {
      reference: "Psalm 127:2",
      text: "In vain you rise early\nand stay up late,\ntoiling for bread to eat—\nfor He gives sleep to His beloved.",
    },
  },
];
