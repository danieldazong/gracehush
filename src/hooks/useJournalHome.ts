import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  getLatestAffirmations,
  getProfile,
  getReflectionStreak,
  hydrateWordPool,
  hydrateWords,
  listPendingItems,
  loadEntriesPage,
  readCachedEntries,
  readCachedEntry,
  readCachedLatestAffirmations,
  readCachedWords,
  readCurrentWord,
  setAffirmationFavorite,
} from "@/data/journalRepository";
import { mergePending, toPendingEntry } from "@/data/pendingEntries";
import { getCurrentSlot, getReflectionDays, isListedEntry, mergeEntries } from "@/data/selectors";
import { requestAffirmationReschedule, subscribeWordCalendar } from "@/services/affirmationScheduler";
import { track } from "@/services/analytics";
import { haptics } from "@/services/haptics";
import { startOfflineSession } from "@/services/offlineSession";
import { subscribeRealtime } from "@/services/realtime";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { subscribe } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import { selectIsOnline, useOfflineStore, type SavedNote } from "@/store/offlineStore";
import type {
  Affirmation,
  CurrentWord,
  HomeEntry,
  JournalEntry,
  OutboxItem,
  TimeSlot,
  UserProfile,
} from "@/types";

export type HomeState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      now: Date;
      profile: UserProfile;
      // The reflections saved on this phone and not prepared yet come first (step 24), then the server's.
      entries: HomeEntry[];
      // How many entries the Journal has in all, the ones not loaded yet included.
      entryCount: number;
      affirmations: Affirmation[];
      // The word the last reminder carried, from the Word Deck's calendar (2026-11-17), or null: the card then shows the newest
      // reflection's affirmation for the current slot, as before.
      word: CurrentWord | null;
      // The deck of words (2026-11-20): the affirmations this phone holds for the reflections on screen, by entry id, each list
      // in position order. They come a moment after the entries, the phone's own first and then the ones fetched for a page, so
      // a reflection that is not in here yet has no card. It may also hold reflections that are no longer listed.
      words: Record<string, Affirmation[]>;
      reflectionDays: number;
      currentSlot: TimeSlot;
      isOffline: boolean;
      // false while NetInfo has not answered yet (no banner), true or false after.
      isOnline: boolean | null;
      // The calm line New Entry leaves behind when it saved something that has not been prepared yet.
      savedNote: SavedNote | null;
      dismissNote: () => void;
      refresh: () => Promise<void>;
      refreshing: boolean;
      // The next page of older entries (step 25). Does nothing while one is coming or when there is no older entry.
      loadMore: () => void;
      loadingMore: boolean;
      // Saves the heart on an affirmation: it shows at once and goes back, with `favoriteFailed`, when the save fails.
      toggleFavorite: (affirmation: Affirmation) => void;
      favoriteFailed: boolean;
    };

// What a load produced, with the key it was for (the mock scenario and the data source): data loaded for another key is
// not shown.
type LoadResult =
  | {
      key: string;
      status: "ready";
      profile: UserProfile;
      // The entries loaded so far, newest first: the first page, and the older pages the person scrolled to.
      entries: JournalEntry[];
      nextCursor: string | null;
      total: number | null;
      affirmations: Affirmation[];
      word: CurrentWord | null;
      words: Record<string, Affirmation[]>;
    }
  | { key: string; status: "error" };

// Where an entry a Realtime message changed goes in the list on screen (step 33), with the known total. A listed entry takes its
// place, or joins the list when it falls inside the loaded range (one more in all); a listed entry older than the loaded range is
// left for its page. An entry that is no longer listed (a failed one) leaves the list (one fewer in all).
function placeChangedEntry(
  list: { entries: JournalEntry[]; nextCursor: string | null; total: number | null },
  entryId: string,
  entry: JournalEntry | null,
  nowMs: number,
): { entries: JournalEntry[]; total: number | null } {
  const present = list.entries.some((item) => item.id === entryId);
  if (entry !== null && isListedEntry(entry, nowMs)) {
    if (present) return { entries: mergeEntries(list.entries, [entry]), total: list.total };
    const oldest = list.entries[list.entries.length - 1];
    const inRange = list.nextCursor === null || oldest === undefined || entry.createdAt >= oldest.createdAt;
    if (!inRange) return { entries: list.entries, total: list.total };
    return { entries: mergeEntries(list.entries, [entry]), total: list.total === null ? null : list.total + 1 };
  }
  if (!present) return { entries: list.entries, total: list.total };
  return {
    entries: list.entries.filter((item) => item.id !== entryId),
    total: list.total === null ? null : Math.max(0, list.total - 1),
  };
}

function withFavorite(result: LoadResult | null, key: string, id: string, value: boolean): LoadResult | null {
  if (result?.status !== "ready" || result.key !== key) return result;
  const flip = (item: Affirmation): Affirmation => (item.id === id ? { ...item, isFavorite: value } : item);
  return {
    ...result,
    affirmations: result.affirmations.map(flip),
    word:
      result.word !== null && result.word.affirmation.id === id
        ? { ...result.word, affirmation: flip(result.word.affirmation) }
        : result.word,
    // The same affirmation may be a card of the deck.
    words: Object.fromEntries(Object.entries(result.words).map(([entryId, list]) => [entryId, list.map(flip)])),
  };
}

// The finished reflections among these entries: the ones a card of the deck can be made from.
function finishedIds(entries: readonly JournalEntry[]): string[] {
  return entries.filter((entry) => entry.status === "ready" && entry.devotional !== null).map((entry) => entry.id);
}

// Whether two reads of the word show the same card: a read that changes nothing must not redraw the screen.
function sameWord(a: CurrentWord | null, b: CurrentWord | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.affirmation.id === b.affirmation.id &&
    a.affirmation.isFavorite === b.affirmation.isFavorite &&
    a.slot === b.slot &&
    a.fireAt === b.fireAt &&
    (a.entry?.id ?? null) === (b.entry?.id ?? null)
  );
}

// Journal Home data. It loads when the screen takes focus (the first time too), when the app returns to the foreground while
// the screen is focused, when the data source or the scenario changes, and on pull-to-refresh. It waits for the signed-in user's
// database (the reflections saved on this phone, and the cache of the ones the server has, live in it). A load shows what the
// phone already has at once, then replaces it with the first page from the server; older pages come with `loadMore`. While the
// screen is in front it follows the sync engine: the list of unsent reflections refreshes after every change, and the whole
// list after a reflection has been prepared. Two things are followed for as long as the screen exists, also while another screen
// covers it: a reflection deleted leaves the list, and the scheduler's calendar moves the card's word; and the word is read again
// from the calendar as the screen is shown, because a reminder fires with nothing announced (2026-11-18). While the screen is in
// front it follows Realtime too (step 33): a change made elsewhere is read from the phone (the handler has written it there) and
// merged into the list, and after a dropped channel came back the list loads again. The "days of reflection" chip is the server's
// run of days (reflection_streak_days), asked for after the first page and when a reflection finishes; until it answers,
// offline, with the mock data and on any error, the chip counts what the phone holds. The deck of words (2026-11-20) needs the
// affirmations of every reflection on screen: they are read behind the list, never before it (the phone's own once the cached
// entries show, then one request for those a page's reflections lack), so the list never waits for them.
export function useJournalHome(): HomeState {
  const scenario = useDevStore((state) => state.scenario);
  const dbReady = useOfflineStore((state) => state.dbReady);
  const dbFailed = useOfflineStore((state) => state.dbFailed);
  const online = useOfflineStore(selectIsOnline);
  const savedNote = useOfflineStore((state) => state.savedNote);
  const dataSource = useDevStore((state) => state.dataSource);
  const key = `${scenario}:${dataSource}`;
  const [now, setNow] = useState(() => new Date());
  const [result, setResult] = useState<LoadResult | null>(null);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [favoriteFailed, setFavoriteFailed] = useState(false);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);
  const latestPending = useRef(0);
  // How many older pages the person has loaded since the last reset: while there are some, a refresh keeps them.
  const pagesLoaded = useRef(0);
  const loadingMoreNow = useRef(false);
  const savingFavorite = useRef(false);
  // The server's run of reflection days for the key it was asked for: null days when it gave no number.
  const [streak, setStreak] = useState<{ key: string; days: number | null } | null>(null);
  const latestStreak = useRef(0);
  // What is on screen, for the Realtime callbacks (they compare with it and need the profile's time zone). Set in an effect.
  const shown = useRef<LoadResult | null>(null);
  useEffect(() => {
    shown.current = result;
  }, [result]);

  const askStreak = useCallback(
    async (timezone: string) => {
      latestStreak.current += 1;
      const request = latestStreak.current;
      const days = await getReflectionStreak(timezone);
      if (request === latestStreak.current) setStreak({ key, days });
    },
    [key],
  );

  const refreshPending = useCallback(async () => {
    latestPending.current += 1;
    const request = latestPending.current;
    const items = await listPendingItems();
    if (request === latestPending.current) setPending(items);
  }, []);

  // The deck's words for these entries, behind the list: with `fetch`, the affirmations the phone lacks are asked for first
  // (one request), and then the phone's own are read. Only reflections the screen holds no words for are read, unless `all`
  // (pull-to-refresh reads every one again). A newer load has the newer say. It never rejects.
  const addWords = useCallback(
    async (entries: readonly JournalEntry[], request: number, options: { fetch: boolean; all?: boolean }) => {
      const all = options.all === true;
      const known = !all && shown.current?.status === "ready" && shown.current.key === key ? shown.current.words : {};
      const ids = finishedIds(entries).filter((id) => !(id in known));
      if (ids.length === 0) return;
      if (options.fetch) await hydrateWords(ids);
      const words = await readCachedWords(ids);
      if (request !== latestRequest.current || Object.keys(words).length === 0) return;
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key
          ? // What the screen already holds for a reflection is the newer read (a heart just tapped, a Realtime change), except
            // on a pull-to-refresh.
            { ...previous, words: all ? { ...previous.words, ...words } : { ...words, ...previous.words } }
          : previous,
      );
    },
    [key],
  );

  const load = useCallback(
    async (options: { reset?: boolean } = {}) => {
      if (!dbReady) return;
      latestRequest.current += 1;
      const request = latestRequest.current;
      latestPending.current += 1;
      const pendingRequest = latestPending.current;
      if (options.reset === true) pagesLoaded.current = 0;
      setNow(new Date());
      try {
        const dev = useDevStore.getState();
        if (dev.nextHomeLoadFails) {
          dev.setNextHomeLoadFails(false);
          throw new Error("Journal load failed on purpose (dev)");
        }
        // What the phone already has: shown at once, before the network is asked.
        const [profile, cached, cachedAffirmations, cachedWord, items] = await Promise.all([
          getProfile(),
          readCachedEntries(),
          readCachedLatestAffirmations(),
          readCurrentWord(Date.now()),
          listPendingItems(),
        ]);
        if (request !== latestRequest.current) return;
        if (pendingRequest === latestPending.current) setPending(items);
        if (cached.length > 0 && pagesLoaded.current === 0) {
          setResult((previous) =>
            previous?.status === "ready" && previous.key === key
              ? previous
              : {
                  key,
                  status: "ready",
                  profile,
                  entries: cached,
                  nextCursor: null,
                  total: null,
                  affirmations: cachedAffirmations,
                  word: cachedWord,
                  words: {},
                },
          );
          void addWords(cached, request, { fetch: false });
        }
        // The first page from the server. Without an answer, what is on screen stays (or the error shows when nothing is).
        const page = await loadEntriesPage(null);
        if (request !== latestRequest.current) return;
        if (!page.ok) throw new Error(page.code);
        void askStreak(profile.timezone);
        const affirmations = await getLatestAffirmations();
        // The reflections of the week may be new to this phone (made on another phone, say), or their affirmations never read
        // here: the ones the phone has none for are fetched (one request), and the reminders' words are dealt again from what
        // the phone now holds (the Word Deck, 2026-11-17; step 28 before it), once the affirmations are all here.
        await hydrateWordPool(new Date(Date.now()));
        requestAffirmationReschedule();
        const word = await readCurrentWord(Date.now());
        if (request !== latestRequest.current) return;
        const paged = pagesLoaded.current > 0;
        // The newest reflection's affirmations have just been read from the server: the deck holds the same ones.
        const newest = affirmations[0]?.entryId;
        setResult((previous) => {
          const same = previous?.status === "ready" && previous.key === key ? previous : null;
          const words = same?.words ?? {};
          return {
            key,
            status: "ready",
            profile,
            affirmations,
            word,
            words: newest === undefined ? words : { ...words, [newest]: affirmations },
            // Older pages that are already on screen stay, and their cursor with them.
            entries: paged && same !== null ? mergeEntries(same.entries, page.data.entries) : page.data.entries,
            nextCursor: paged && same !== null ? same.nextCursor : page.data.nextCursor,
            total: page.data.total,
          };
        });
        void addWords(page.data.entries, request, { fetch: true, all: options.reset === true });
      } catch {
        if (request !== latestRequest.current) return;
        // A failed refresh keeps the data that is already on screen.
        setResult((previous) =>
          previous?.status === "ready" && previous.key === key ? previous : { key, status: "error" },
        );
      }
    },
    [key, dbReady, askStreak, addWords],
  );

  // A Realtime message about one entry (step 33). The newest reflection's affirmations are read again with it, and the entry's
  // own for the deck, and the run of days is asked for again when a reflection has just finished.
  const mergeFromPhone = useCallback(
    async (entryId: string) => {
      const [entry, affirmations, word, words] = await Promise.all([
        readCachedEntry(entryId),
        readCachedLatestAffirmations(),
        readCurrentWord(Date.now()),
        readCachedWords([entryId]),
      ]);
      const before = shown.current?.status === "ready" && shown.current.key === key ? shown.current : null;
      if (before === null) return;
      const wasReady = before.entries.some((item) => item.id === entryId && item.status === "ready");
      const nowMs = Date.now();
      // The cards read the clock from here (a finished reflection's audio window among other things), so it moves with them.
      setNow(new Date(nowMs));
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key
          ? {
              ...previous,
              ...placeChangedEntry(previous, entryId, entry, nowMs),
              affirmations,
              word,
              words: { ...previous.words, ...words },
            }
          : previous,
      );
      if (entry !== null && entry.status === "ready" && entry.devotional !== null && !wasReady) {
        void askStreak(before.profile.timezone);
      }
    },
    [key, askStreak],
  );

  // A Realtime message about an entry's affirmations: the card shows the newest reflection's, and the deck that entry's, as the
  // phone now holds them.
  const refreshAffirmations = useCallback(
    async (entryId: string) => {
      const [affirmations, word, words] = await Promise.all([
        readCachedLatestAffirmations(),
        readCurrentWord(Date.now()),
        readCachedWords([entryId]),
      ]);
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key
          ? { ...previous, affirmations, word, words: { ...previous.words, ...words } }
          : previous,
      );
    },
    [key],
  );

  // The scheduler has written a new deal to the calendar (2026-11-17): the word that last arrived may be another one.
  const refreshWord = useCallback(async () => {
    const word = await readCurrentWord(Date.now());
    setResult((previous) =>
      previous?.status === "ready" && previous.key === key && !sameWord(previous.word, word)
        ? { ...previous, word }
        : previous,
    );
  }, [key]);

  // Followed for as long as the screen exists, also while another screen covers it (2026-11-18, the walk-through's F1): the tab
  // stays mounted behind Reflection, where a reflection is deleted, and the scheduler writes its calendar whenever the app comes
  // to the front. Followed only while in front, the card showed a deleted reflection's word, or the previous one, for the 1 to 3
  // seconds the screen's own load took once it was shown again.
  useEffect(() => {
    const stopFollowing = subscribe((event) => {
      if (event.type !== "deleted") return;
      // A reflection was deleted (step 29b): it leaves the list on screen at once, also from an older page (pages merge by id, so
      // a reload alone would keep it), together with its affirmations; the server's count is one lower.
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key
          ? {
              ...previous,
              entries: previous.entries.filter((entry) => entry.id !== event.entryId),
              affirmations: previous.affirmations.filter((affirmation) => affirmation.entryId !== event.entryId),
              word: previous.word?.affirmation.entryId === event.entryId ? null : previous.word,
              total: previous.total === null ? null : Math.max(0, previous.total - 1),
            }
          : previous,
      );
    });
    const stopCalendar = subscribeWordCalendar(() => {
      void refreshWord();
    });
    return () => {
      stopFollowing();
      stopCalendar();
    };
  }, [key, refreshWord]);

  // The callback changes with the key and with the database, so useFocusEffect reloads then if the screen is focused, and
  // otherwise on the next focus. Leaving the screen drops a response that is still on its way.
  useFocusEffect(
    useCallback(() => {
      load();
      // A reminder may have fired while the screen was covered, and nothing is announced when one does: the word is read again
      // from the phone's calendar at once, so the card does not wait for the first page from the server to show it.
      void refreshWord();
      const subscription = AppState.addEventListener("change", (status) => {
        if (status === "active") load();
      });
      const stopFollowing = subscribe((event) => {
        if (event.type === "finished") {
          // What New Entry left behind is no longer true once the reflection is ready.
          useOfflineStore.getState().setSavedNote(null);
          // A reflection finished while Journal is in front (the person came back before the server was done): one success tap
          // here, none for a heavy moment. Since 2026-11-10 the handoff lands on Reflection, which gives the tap otherwise; only
          // the screen in front is subscribed, so a finish is never felt twice.
          if (!event.isCrisis) haptics.success();
          load();
        } else if (event.type === "changed") {
          refreshPending();
        }
      });
      const stopListening = subscribeRealtime((event) => {
        if (event.type === "entry") void mergeFromPhone(event.entryId);
        else if (event.type === "affirmations") void refreshAffirmations(event.entryId);
        else load();
      });
      return () => {
        subscription.remove();
        stopFollowing();
        stopListening();
        latestRequest.current += 1;
      };
    }, [load, refreshPending, mergeFromPhone, refreshAffirmations, refreshWord]),
  );

  const retry = useCallback(() => {
    setResult(null);
    if (dbFailed) {
      // The database could not be opened: open it again, and the load follows once it is ready.
      const userId = getSupabaseUserId();
      if (userId !== null) void startOfflineSession(userId);
      return;
    }
    load({ reset: true });
  }, [load, dbFailed]);

  // Pull-to-refresh starts again from the first page.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    useOfflineStore.getState().setSavedNote(null);
    await load({ reset: true });
    setRefreshing(false);
  }, [load]);

  const dismissNote = useCallback(() => useOfflineStore.getState().setSavedNote(null), []);

  const current = dbReady && result?.key === key ? result : null;
  const nextCursor = current?.status === "ready" ? current.nextCursor : null;

  const loadMore = useCallback(async () => {
    if (nextCursor === null || loadingMoreNow.current) return;
    loadingMoreNow.current = true;
    setLoadingMore(true);
    const request = latestRequest.current;
    try {
      const page = await loadEntriesPage(nextCursor);
      // A load that started meanwhile has the newer say, and a page that did not come is asked for again on the next scroll.
      if (request !== latestRequest.current || !page.ok) return;
      pagesLoaded.current += 1;
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key
          ? { ...previous, entries: mergeEntries(previous.entries, page.data.entries), nextCursor: page.data.nextCursor }
          : previous,
      );
      // The deck goes on into this page: its reflections' words are fetched (one request) and read behind the list.
      void addWords(page.data.entries, request, { fetch: true });
    } finally {
      loadingMoreNow.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, key, addWords]);

  const toggleFavorite = useCallback(
    async (affirmation: Affirmation) => {
      if (savingFavorite.current) return;
      savingFavorite.current = true;
      const next = !affirmation.isFavorite;
      setFavoriteFailed(false);
      setResult((previous) => withFavorite(previous, key, affirmation.id, next));
      try {
        const saved = await setAffirmationFavorite(affirmation.id, next);
        if (saved.ok) {
          track("affirmation_favorited", { favorited: next });
        } else {
          setResult((previous) => withFavorite(previous, key, affirmation.id, !next));
          setFavoriteFailed(true);
        }
      } finally {
        savingFavorite.current = false;
      }
    },
    [key],
  );

  if (dbFailed) {
    return { status: "error", retry };
  }
  if (current === null) {
    return { status: "loading" };
  }
  if (current.status === "error") {
    return { status: "error", retry };
  }
  const entries = mergePending(current.entries, pending.map(toPendingEntry));
  // The entries the server has that are not on screen yet, on top of the ones that are.
  const notLoaded = Math.max(0, (current.total ?? current.entries.length) - current.entries.length);
  const serverDays = streak?.key === key ? streak.days : null;
  return {
    status: "ready",
    now,
    profile: current.profile,
    entries,
    entryCount: entries.length + notLoaded,
    affirmations: current.affirmations,
    word: current.word,
    words: current.words,
    reflectionDays: serverDays ?? getReflectionDays(entries, now),
    currentSlot: getCurrentSlot(now, current.profile.reminders),
    // The dev scenario still forces the offline look in development.
    isOffline: scenario === "offline" || online === false,
    isOnline: online,
    savedNote,
    dismissNote,
    refresh,
    refreshing,
    loadMore,
    loadingMore,
    toggleFavorite,
    favoriteFailed,
  };
}
