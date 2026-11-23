import {
  AFFIRMATION_DAYS_AHEAD,
  WORD_DECK_MIN_REFLECTIONS,
  WORD_DECK_WEEK_DAYS,
  WORD_DECK_WEEK_MAX,
} from "@/constants/app";
import type { Affirmation, AffirmationVerse, JournalEntry, TimeSlot } from "@/types";
import { addDays, calendarDayIn, instantAt, isTimeZone, type CalendarDay } from "@/utils/zonedTime";

// The Word Deck (2026-11-17): which word each reminder carries. The lock screen used to take all of its words from the newest
// reflection, so a week of notifications was the same three words and a new reflection replaced every one that was waiting. Now
// the reminders take turns between the reflections of the week, newest first, always three a day, and a word is not heard again
// until its reflection has had its other words heard. Pure: no clock, no storage, no React. The scheduler reads the pool and the
// history, asks for the deal, writes the calendar and plans the notifications from it.
//
// The rules, in order:
// - The pool is the finished reflections of the last WORD_DECK_WEEK_DAYS local days, at most WORD_DECK_WEEK_MAX of them, newest
//   first. When the week has fewer than WORD_DECK_MIN_REFLECTIONS, older reflections join it up to that many, so a week of 21
//   reminders has seven reflections to draw their best three words from and does not repeat.
// - Each reminder, in time order, goes to the reflection that has waited longest for a turn (one that has never had a turn
//   waits longest: a new reflection plays at the next reminder), and a tie goes to the week before older ones, then to the newer
//   reflection. After its turn a reflection is last in line, so the same word never lands twice in a row.
// - Inside a reflection the word that has waited longest is the one dealt. A word never dealt comes before one that was; among
//   those the word that belongs to this part of the day (its own slot) comes first, and then the order below: the model's best
//   three (the slotted ones, in the order of the day), then the ones the person added, in the order they were made.
// - What was dealt at the reminders that have passed (the calendar) is the history; every reminder ahead is dealt again at each
//   plan from that history, so a plan made again with nothing new gives the same words, and the rotation goes on across days.
//
// A word is only its headline and verse: nothing the person wrote, and never an affirmation's longer text.

export type PoolTier = "week" | "older";

export type DeckWord = {
  id: string; // the affirmation's id
  entryId: string;
  // The lock-screen slot the word carries in its own reflection, or null for one the person added: only a tie-breaker here.
  slot: TimeSlot | null;
  headline: string;
  // Null for a word saved before step 37, or one whose verse could not be found; both parts are present when it is set.
  verse: AffirmationVerse | null;
};

export type DeckReflection = {
  entryId: string;
  tier: PoolTier;
  // The words that can be sent, in the order they are dealt (deckWordsOf). A reflection with none is skipped.
  words: readonly DeckWord[];
};

// What the calendar holds for a reminder that has passed (or is the current one): one row per slot of a local day.
export type DeckHistoryRow = {
  day: number; // yyyymmdd in the zone the phone was in when the row was made
  slot: TimeSlot;
  fireAt: number; // the instant, in milliseconds
  entryId: string;
  affirmationId: string;
};

export type DealtWord = {
  day: CalendarDay;
  slot: TimeSlot;
  time: string; // the reminder's "HH:mm"
  fireAt: Date;
  word: DeckWord;
};

export const DECK_SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];
const SLOT_ORDER: Record<TimeSlot, number> = { morning: 0, afternoon: 1, evening: 2 };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// A calendar day as one number, 20261117, in the order days come.
export function dayNumber(day: CalendarDay): number {
  return day.year * 10_000 + day.month * 100 + day.day;
}

// The reflections the deck draws from. `entries` are finished reflections that have their devotional, newest first. The week's
// come first (newest first, at most WORD_DECK_WEEK_MAX), then as many older ones as it takes to reach
// WORD_DECK_MIN_REFLECTIONS in all. The week is the local days of `timeZone` from today back WORD_DECK_WEEK_DAYS - 1 days.
export function selectPoolEntries(
  entries: readonly JournalEntry[],
  now: Date,
  timeZone: string,
): { entry: JournalEntry; tier: PoolTier }[] {
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  const weekStart = dayNumber(addDays(calendarDayIn(now, zone), -(WORD_DECK_WEEK_DAYS - 1)));
  const week: JournalEntry[] = [];
  const older: JournalEntry[] = [];
  for (const entry of entries) {
    const created = Date.parse(entry.createdAt);
    // An entry whose time cannot be read is not counted as this week's.
    if (Number.isFinite(created) && dayNumber(calendarDayIn(new Date(created), zone)) >= weekStart) week.push(entry);
    else older.push(entry);
  }
  const kept = week.slice(0, WORD_DECK_WEEK_MAX);
  const topUp = Math.max(0, WORD_DECK_MIN_REFLECTIONS - kept.length);
  return [
    ...kept.map((entry) => ({ entry, tier: "week" as const })),
    ...older.slice(0, topUp).map((entry) => ({ entry, tier: "older" as const })),
  ];
}

// The words of one reflection that can be sent, in the order they are dealt: those with no headline, or a verse with a missing
// half, are cleaned or left out. The model's best three (the ones that carry a slot) come first, in the order of the day; then the
// ones the person added, in the order they were made.
export function deckWordsOf(affirmations: readonly Affirmation[]): DeckWord[] {
  const usable: { word: DeckWord; position: number }[] = [];
  for (const affirmation of affirmations) {
    const headline = affirmation.headline.trim();
    if (headline === "") continue;
    const verse = affirmation.verse;
    const reference = verse?.reference.trim() ?? "";
    const hasVerse = verse !== null && reference !== "" && verse.text.trim() !== "";
    usable.push({
      position: affirmation.position,
      word: {
        id: affirmation.id,
        entryId: affirmation.entryId,
        slot: affirmation.slot,
        headline,
        verse: hasVerse ? { reference, text: verse.text } : null,
      },
    });
  }
  usable.sort((a, b) => {
    const aSlotted = a.word.slot !== null;
    const bSlotted = b.word.slot !== null;
    if (aSlotted !== bSlotted) return aSlotted ? -1 : 1;
    if (a.word.slot !== null && b.word.slot !== null && a.word.slot !== b.word.slot) {
      return SLOT_ORDER[a.word.slot] - SLOT_ORDER[b.word.slot];
    }
    return a.position - b.position || (a.word.id < b.word.id ? -1 : a.word.id > b.word.id ? 1 : 0);
  });
  return usable.map((item) => item.word);
}

type Candidate = { reflection: DeckReflection; rank: number; turn: number };

const TIER_ORDER: Record<PoolTier, number> = { week: 0, older: 1 };

// Whether `a` has the next turn before `b`: the one that has waited longest, then the week before older ones, then the newer one.
function comesBefore(a: Candidate, b: Candidate): boolean {
  if (a.turn !== b.turn) return a.turn < b.turn;
  if (a.reflection.tier !== b.reflection.tier) return TIER_ORDER[a.reflection.tier] < TIER_ORDER[b.reflection.tier];
  return a.rank < b.rank;
}

function nextReflection(candidates: readonly Candidate[]): DeckReflection {
  let best = candidates[0];
  for (const candidate of candidates) {
    if (comesBefore(candidate, best)) best = candidate;
  }
  return best.reflection;
}

// Which word of a reflection is dealt: the one that has waited longest (never dealt first), then the one that belongs to this
// slot, then the order the words are in.
function nextWord(words: readonly DeckWord[], slot: TimeSlot, lastDealt: ReadonlyMap<string, number>): DeckWord {
  let best = words[0];
  let bestDealt = lastDealt.get(best.id) ?? -Infinity;
  let bestFit = best.slot === slot ? 0 : 1;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    const dealt = lastDealt.get(word.id) ?? -Infinity;
    const fit = word.slot === slot ? 0 : 1;
    if (dealt < bestDealt || (dealt === bestDealt && fit < bestFit)) {
      best = word;
      bestDealt = dealt;
      bestFit = fit;
    }
  }
  return best;
}

// The calendar row of a dealt word (db/wordCalendar.ts keeps it).
export function toHistoryRow(item: DealtWord): DeckHistoryRow {
  return {
    day: dayNumber(item.day),
    slot: item.slot,
    fireAt: item.fireAt.getTime(),
    entryId: item.word.entryId,
    affirmationId: item.word.id,
  };
}

export type DealInput = {
  now: Date;
  timeZone: string;
  reminders: Record<TimeSlot, string>;
  // Newest first within each tier, the week's before the older ones (selectPoolEntries gives that order).
  reflections: readonly DeckReflection[];
  // The calendar: rows at or before `now` are history, anything later is ignored (it is about to be dealt again).
  history: readonly DeckHistoryRow[];
  days?: number;
};

// The word each reminder ahead carries, in time order: today's reminders that have not passed and every one of the next days
// (AFFIRMATION_DAYS_AHEAD in all). Empty when no reflection has a word.
export function dealWords(input: DealInput): DealtWord[] {
  const reflections = input.reflections.filter((reflection) => reflection.words.length > 0);
  if (reflections.length === 0) return [];
  const zone = isTimeZone(input.timeZone) ? input.timeZone : "UTC";
  const nowMs = input.now.getTime();

  // What the calendar says happened: when each reflection and each word last had a turn.
  const lastTurn = new Map<string, number>();
  const lastDealt = new Map<string, number>();
  for (const row of input.history) {
    if (row.fireAt > nowMs) continue;
    if (row.fireAt > (lastTurn.get(row.entryId) ?? -Infinity)) lastTurn.set(row.entryId, row.fireAt);
    if (row.fireAt > (lastDealt.get(row.affirmationId) ?? -Infinity)) lastDealt.set(row.affirmationId, row.fireAt);
  }

  const today = calendarDayIn(input.now, zone);
  const slots: { day: CalendarDay; slot: TimeSlot; time: string; fireAt: Date }[] = [];
  for (let offset = 0; offset < (input.days ?? AFFIRMATION_DAYS_AHEAD); offset += 1) {
    const day = addDays(today, offset);
    for (const slot of DECK_SLOTS) {
      const time = input.reminders[slot];
      if (!TIME.test(time)) continue;
      const fireAt = instantAt(day, time, zone);
      if (fireAt.getTime() <= nowMs) continue;
      slots.push({ day, slot, time, fireAt });
    }
  }
  slots.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);

  const dealt: DealtWord[] = [];
  for (const item of slots) {
    const at = item.fireAt.getTime();
    const reflection = nextReflection(
      reflections.map((candidate, rank) => ({
        reflection: candidate,
        rank,
        turn: lastTurn.get(candidate.entryId) ?? -Infinity,
      })),
    );
    const word = nextWord(reflection.words, item.slot, lastDealt);
    lastTurn.set(reflection.entryId, at);
    lastDealt.set(word.id, at);
    dealt.push({ ...item, word });
  }
  return dealt;
}
