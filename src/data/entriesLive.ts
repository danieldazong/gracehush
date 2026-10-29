import { ENTRY_CACHE_LIMIT, PRAYERS_LIMIT } from "@/constants/app";
import { copy } from "@/constants/copy";
import type { PrayerPatch } from "@/data/columns";
import {
  selectAffirmations,
  selectEntriesPage,
  selectEntry,
  selectPrayerRows,
  updateAffirmationFavorite,
  updatePrayerColumns,
} from "@/data/entriesRemote";
import { toAffirmation, toJournalEntry } from "@/data/mappers";
import { applyPrayerPatch, trackPatch } from "@/data/prayerPatches";
import { getNewestReadyEntry, isListedEntry } from "@/data/selectors";
import * as cache from "@/db/cache";
import { isDatabaseOpen } from "@/db/database";
import * as mutations from "@/db/mutations";
import type { Affirmation, AffirmationSource, JournalEntry, RepoResult, TimeSlot } from "@/types";

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

// Entries read from the server, with the prayer changes this phone has not sent yet on top (step 29), so a change that waits
// never flickers back when the server's copy is read. Without the database there is nothing waiting to know of.
async function withPendingChanges(entries: JournalEntry[]): Promise<JournalEntry[]> {
  const waiting = await safely(() => mutations.listMutations(), []);
  if (waiting.length === 0) return entries;
  const patches = new Map(waiting.map((change) => [change.entryId, change.patch]));
  return entries.map((entry) => {
    const patch = patches.get(entry.id);
    return patch === undefined ? entry : applyPrayerPatch(entry, patch);
  });
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

// The newest finished entry the phone has, a crisis entry included, and its affirmations (step 28's notifications). Unlike the
// reads above it throws when the cache cannot be read (a closed database included): a bad read must not look like "no
// reflection", which would cancel the notifications. An entry still being prepared is not finished, so it never counts.
export async function readCachedAffirmationSource(): Promise<AffirmationSource | null> {
  const entries = await cache.listEntries(LATEST_LOOKBACK);
  const now = Date.now();
  const latest = entries.find((entry) => entry.status === "ready" && isListedEntry(entry, now));
  if (latest === undefined) return null;
  if (latest.isCrisis) return { entryId: latest.id, isCrisis: true, affirmations: [] };
  const affirmations = await cache.listAffirmationsForEntry(latest.id);
  return { entryId: latest.id, isCrisis: false, affirmations };
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
  const entries = await withPendingChanges(rows.map(toJournalEntry));
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
    const [entry] = await withPendingChanges([toJournalEntry(result.data)]);
    await safely(() => cache.upsertEntry(entry), undefined);
    return entry;
  }
  const cached = await readCachedEntry(id);
  if (cached !== null) return cached;
  throw new Error(result.code);
}

// ---- prayers (step 29) -----------------------------------------------------------------------------------------------------
// The entries the phone has that are prayers, newest first, with the changes not sent yet already in them (a change is written
// to the cached entry when it is made).
export async function readCachedPrayerEntries(): Promise<JournalEntry[]> {
  return safely(() => cache.listPrayerEntries(), []);
}

// Every prayer the server has (up to PRAYERS_LIMIT), with this phone's waiting changes on top, written to the cache. A cached
// prayer the server no longer counts as one (changed on another phone) is no prayer in the cache either, unless a change made
// here says otherwise; that is known only when the server's list is whole.
export async function loadPrayerEntries(): Promise<RepoResult<JournalEntry[]>> {
  const result = await selectPrayerRows();
  if (!result.ok) return result;
  const entries = await withPendingChanges(result.data.map(toJournalEntry));
  await safely(async () => {
    for (const entry of entries) await cache.upsertEntry(entry);
    if (result.data.length >= PRAYERS_LIMIT) return;
    const listed = new Set(entries.map((entry) => entry.id));
    const waiting = new Set((await mutations.listMutations()).map((change) => change.entryId));
    for (const cached of await cache.listPrayerEntries()) {
      if (!listed.has(cached.id) && !waiting.has(cached.id)) {
        await cache.upsertEntry(applyPrayerPatch(cached, trackPatch(false)));
      }
    }
  }, undefined);
  return { ok: true, data: entries.filter((entry) => entry.prayer !== null) };
}

// A prayer change made on this phone: the cached entry shows it at once and the queue keeps it until the sync engine has sent
// it. `build` checks the entry and gives the change, or a failure; nothing is written then. The caller wakes the engine.
export async function changePrayer(
  entryId: string,
  build: (entry: JournalEntry) => RepoResult<PrayerPatch>,
): Promise<RepoResult<JournalEntry>> {
  const message = copy.prayers.errors.save;
  const entry = await readCachedEntry(entryId);
  if (entry === null || entry.isCrisis) return { ok: false, code: "NOT_FOUND", message };
  if (entry.status !== "ready") return { ok: false, code: "INVALID", message };
  const built = build(entry);
  if (!built.ok) return built;
  const next = applyPrayerPatch(entry, built.data);
  try {
    await cache.upsertEntry(next);
    try {
      await mutations.enqueuePatch(entryId, built.data);
    } catch (error) {
      // The change could not be kept, so the entry must not show it.
      await cache.upsertEntry(entry).catch(() => undefined);
      throw error;
    }
  } catch {
    return { ok: false, code: "UNKNOWN", message };
  }
  return { ok: true, data: next };
}

// What sending one waiting change gave (the sync engine acts on it): saved, or the entry is gone, or the server's status and
// the database's code.
export type PrayerSendOutcome =
  | { kind: "saved" }
  | { kind: "gone" }
  | { kind: "failed"; status: number; code: string };

// Sends a waiting change. When the server took it, the cache gets the entry as the server now has it, with any change made
// while this one was on its way on top, and the change leaves the queue unless such a change was merged into it (it goes next).
// An entry the server no longer has leaves the cache.
export async function sendPrayerChange(change: mutations.PendingChange): Promise<PrayerSendOutcome> {
  const result = await updatePrayerColumns(change.entryId, change.patch);
  if (!result.ok) return { kind: "failed", status: result.status, code: result.code };
  const removed = await mutations.removeMutation(change.entryId, change.revision);
  if (result.row === null) {
    await cache.removeEntry(change.entryId);
    return { kind: "gone" };
  }
  const saved = toJournalEntry(result.row);
  const later = removed ? null : await mutations.getMutation(change.entryId);
  await cache.upsertEntry(later === null ? saved : applyPrayerPatch(saved, later.patch));
  return { kind: "saved" };
}

// A change the server refused for good: it leaves the queue (unless another was merged into it while it was on its way, which
// then goes next), and the entry is read again so the phone shows what the server has. True when the change was dropped.
export async function dropPrayerChange(change: mutations.PendingChange): Promise<boolean> {
  if (!(await mutations.removeMutation(change.entryId, change.revision))) return false;
  const result = await selectEntry(change.entryId);
  if (result.ok) {
    if (result.data === null) await cache.removeEntry(change.entryId);
    else await cache.upsertEntry(toJournalEntry(result.data));
  }
  return true;
}

// A reflection was deleted for good (step 29b): its cached entry, its affirmations and any prayer change that waited for it go. A
// closed database is "nothing cached".
export async function forgetEntry(entryId: string): Promise<void> {
  await safely(() => cache.removeEntry(entryId), undefined);
  await safely(() => mutations.dropMutation(entryId), undefined);
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
