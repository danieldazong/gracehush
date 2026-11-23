import { getDb } from "@/db/database";
import type { TimeSlot } from "@/types";
import type { DeckHistoryRow } from "@/utils/wordDeck";

// The Word Deck's calendar (2026-11-17, schema version 4): which affirmation each reminder carries, one row per slot of a local
// day. The scheduler writes it at every plan: the rows of reminders ahead are dealt again each time (so they are replaced), and a
// row at or before its time is history. History is what the rotation continues from across days, and what Today's card reads to
// show the word that last arrived, so the card and the lock screen agree. The rows hold ids, a slot and times only: the words are
// in the encrypted affirmations cache.
//
// A save is a few single statements and not a transaction: expo-sqlite's transaction is not exclusive, so another query running on
// the same connection would be pulled into it. A save that stops half way only leaves rows for reminders ahead missing, and the
// next plan writes them again.

type Row = { day: number; slot: string; fire_at: number; entry_id: string; affirmation_id: string };

const SLOTS: readonly string[] = ["morning", "afternoon", "evening"];
const COLUMNS = "day, slot, fire_at, entry_id, affirmation_id";
// With two reminders at the same time the later slot of the day is the one that "fired last", as the deal puts it last.
const NEWEST_FIRST = "fire_at DESC, CASE slot WHEN 'evening' THEN 2 WHEN 'afternoon' THEN 1 ELSE 0 END DESC";

function toRow(row: Row): DeckHistoryRow | null {
  if (!SLOTS.includes(row.slot)) return null;
  if (!Number.isFinite(row.day) || !Number.isFinite(row.fire_at)) return null;
  return {
    day: row.day,
    slot: row.slot as TimeSlot,
    fireAt: row.fire_at,
    entryId: row.entry_id,
    affirmationId: row.affirmation_id,
  };
}

// Every row, oldest first. Throws when the database cannot be read (a closed one included): the scheduler then changes nothing,
// because a bad read must not look like "no history".
export async function listWordCalendar(): Promise<DeckHistoryRow[]> {
  const rows = await getDb().getAllAsync<Row>(`SELECT ${COLUMNS} FROM word_calendar ORDER BY fire_at ASC, day ASC`);
  const list: DeckHistoryRow[] = [];
  for (const row of rows) {
    const mapped = toRow(row);
    if (mapped !== null) list.push(mapped);
  }
  return list;
}

// The row of the reminder that fired last at or before `nowMs`, but not older than `maxAgeMs`: the word that last arrived.
export async function getCurrentWordRow(nowMs: number, maxAgeMs: number): Promise<DeckHistoryRow | null> {
  const row = await getDb().getFirstAsync<Row>(
    `SELECT ${COLUMNS} FROM word_calendar WHERE fire_at <= ? AND fire_at >= ? ORDER BY ${NEWEST_FIRST} LIMIT 1`,
    nowMs,
    nowMs - maxAgeMs,
  );
  return row === null ? null : toRow(row);
}

// Replaces the rows of the reminders ahead with the deal just made, and removes rows older than `keepMs`. The rows at or before
// `nowMs` stay as they are (the history). A row whose day and slot are already there (the phone changed time zone on that day)
// takes the new deal's place.
export async function saveWordCalendar(rows: readonly DeckHistoryRow[], nowMs: number, keepMs: number): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM word_calendar WHERE fire_at > ?", nowMs);
  for (const row of rows) {
    await db.runAsync(
      `INSERT INTO word_calendar (${COLUMNS}) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (day, slot) DO UPDATE SET fire_at = excluded.fire_at, entry_id = excluded.entry_id,
         affirmation_id = excluded.affirmation_id`,
      row.day,
      row.slot,
      row.fireAt,
      row.entryId,
      row.affirmationId,
    );
  }
  await db.runAsync("DELETE FROM word_calendar WHERE fire_at < ?", nowMs - keepMs);
}
