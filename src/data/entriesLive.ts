import { ENTRY_CACHE_LIMIT } from "@/constants/app";
import {
  selectAffirmations,
  selectEntriesPage,
  selectEntry,
  updateAffirmationFavorite,
} from "@/data/entriesRemote";
import { toAffirmation, toJournalEntry } from "@/data/mappers";
import { getNewestReadyEntry, isListedEntry } from "@/data/selectors";
import * as cache from "@/db/cache";
import { isDatabaseOpen } from "@/db/database";
import type { Affirmation, JournalEntry, RepoResult, TimeSlot } from "@/types";

// The real source of the Journal's entries and affirmations (step 25), used by journalRepository.ts when the data source is
// Supabase: what this phone already has comes first (the read cache of step 24), then the network, and everything read from the
// network is written to the cache. The cache never breaks a screen: with the database closed, or a row that cannot be read, a
// read gives "nothing cached" and a write is skipped.

const SLOT_ORDER: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

// Every row read from the cache is decrypted, so a screen reads what it shows and a few rows more, not the whole cache: a failed
// entry or a stale one is read and then left out. The affirmations of the newest finished entry look at the newest few.
const SPARE_ROWS = 20;
const LATEST_LOOKBACK = 20;

async function safely<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  if (!isDatabaseOpen()) return fallback;
  try {
    return await task();
  } catch {
    return fallback;
  }
}

function bySlot(a: Affirmation, b: Affirmation): number {
  return SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);
}

// ---- what the phone already has ------------------------------------------------------------------------------------------
// The entries the Journal lists, newest first (a failed entry, or one still "processing" long after its request died, is kept
// but not listed).
export async function readCachedEntries(limit: number = ENTRY_CACHE_LIMIT): Promise<JournalEntry[]> {
  const entries = await safely(() => cache.listEntries(Math.min(ENTRY_CACHE_LIMIT, limit + SPARE_ROWS)), []);
  const now = Date.now();
  return entries.filter((entry) => isListedEntry(entry, now)).slice(0, limit);
}

export function readCachedEntry(id: string): Promise<JournalEntry | null> {
  return safely(() => cache.getEntry(id), null);
}

export async function readCachedAffirmations(entryId: string): Promise<Affirmation[]> {
  return safely(() => cache.listAffirmationsForEntry(entryId), []);
}

// The newest finished entry that is not a crisis, among the newest few the phone has.
async function cachedNewestReady(): Promise<JournalEntry | null> {
  const entries = await safely(() => cache.listEntries(LATEST_LOOKBACK), []);
  const now = Date.now();
  return getNewestReadyEntry(entries.filter((entry) => isListedEntry(entry, now)));
}

// The affirmations of the newest finished, non-crisis entry the phone has.
export async function readCachedLatestAffirmations(): Promise<Affirmation[]> {
  const latest = await cachedNewestReady();
  return latest === null ? [] : readCachedAffirmations(latest.id);
}

// The week's count of devotionals, from the entries this phone has: a finished entry that is not a crisis and holds a devotional
// (the server's rule, step 22). `since` is the start of the week. The query allows a margin, because created_at is compared as
// text, and the exact test is made on the dates.
export async function countDevotionalsSince(since: Date): Promise<number> {
  const bound = new Date(since.getTime() - 36 * 3_600_000).toISOString();
  const entries = await safely(() => cache.listEntriesSince(bound), []);
  return entries.filter(
    (entry) => !entry.isCrisis && entry.devotional !== null && Date.parse(entry.createdAt) >= since.getTime(),
  ).length;
}

// Remembers one entry (the passage of a reflection that was just confirmed).
export function rememberEntry(entry: JournalEntry): Promise<void> {
  return safely(() => cache.upsertEntry(entry), undefined);
}

// ---- from the network, written to the cache ------------------------------------------------------------------------------
export type EntriesPage = {
  entries: JournalEntry[];
  // The created_at to ask the next page from, or null when there is no older entry.
  nextCursor: string | null;
  // How many entries the Journal lists in all: known for the first page only.
  total: number | null;
};

// One page of the Journal. The first page also trims the cache to the newest ENTRY_CACHE_LIMIT entries.
export async function loadEntriesPage(cursor: string | null, limit: number): Promise<RepoResult<EntriesPage>> {
  const result = await selectEntriesPage(cursor, limit);
  if (!result.ok) return result;
  const { rows, nextCursor, total } = result.data;
  const entries = rows.map(toJournalEntry);
  await safely(async () => {
    for (const entry of entries) await cache.upsertEntry(entry);
    if (cursor === null) await cache.pruneEntries(ENTRY_CACHE_LIMIT);
  }, undefined);
  const now = Date.now();
  return {
    ok: true,
    data: {
      entries: entries.filter((entry) => isListedEntry(entry, now)),
      nextCursor,
      total,
    },
  };
}

// One entry of any status, or null when the server has none (it is then removed from the cache). With no answer from the server
// it is the cached copy; with none of those it throws, so the screen shows its error state.
export async function fetchEntry(id: string): Promise<JournalEntry | null> {
  const result = await selectEntry(id);
  if (result.ok) {
    if (result.data === null) {
      await safely(() => cache.removeEntry(id), undefined);
      return null;
    }
    const entry = toJournalEntry(result.data);
    await safely(() => cache.upsertEntry(entry), undefined);
    return entry;
  }
  const cached = await readCachedEntry(id);
  if (cached !== null) return cached;
  throw new Error(result.code);
}

// The affirmations of an entry, with the same fallbacks as fetchEntry.
export async function fetchAffirmations(entryId: string): Promise<Affirmation[]> {
  const result = await selectAffirmations(entryId);
  if (result.ok) {
    const list = result.data.map(toAffirmation).sort(bySlot);
    await safely(() => cache.upsertAffirmations(entryId, list), undefined);
    return list;
  }
  const cached = await readCachedAffirmations(entryId);
  if (cached.length > 0) return cached;
  throw new Error(result.code);
}

// The affirmations of the newest finished entry the phone has, which is the first page after a refresh.
export async function fetchLatestAffirmations(): Promise<Affirmation[]> {
  const latest = await cachedNewestReady();
  return latest === null ? [] : fetchAffirmations(latest.id);
}

// Saves a favorite. The cache follows only when the server accepted it.
export async function saveFavorite(id: string, value: boolean): Promise<RepoResult<Affirmation>> {
  const result = await updateAffirmationFavorite(id, value);
  if (!result.ok) return result;
  const saved = toAffirmation(result.data);
  await safely(() => cache.upsertAffirmations(saved.entryId, [saved]), undefined);
  return { ok: true, data: saved };
}
