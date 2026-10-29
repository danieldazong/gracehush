import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  getLatestAffirmations,
  getProfile,
  listPendingItems,
  loadEntriesPage,
  readCachedEntries,
  readCachedLatestAffirmations,
  setAffirmationFavorite,
} from "@/data/journalRepository";
import { mergePending, toPendingEntry } from "@/data/pendingEntries";
import { getCurrentSlot, getReflectionDays, mergeEntries } from "@/data/selectors";
import { requestAffirmationReschedule } from "@/services/affirmationScheduler";
import { startOfflineSession } from "@/services/offlineSession";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { subscribe } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import { selectIsOnline, useOfflineStore, type SavedNote } from "@/store/offlineStore";
import type {
  Affirmation,
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
    }
  | { key: string; status: "error" };

function withFavorite(result: LoadResult | null, key: string, id: string, value: boolean): LoadResult | null {
  if (result?.status !== "ready" || result.key !== key) return result;
  return {
    ...result,
    affirmations: result.affirmations.map((item) => (item.id === id ? { ...item, isFavorite: value } : item)),
  };
}

// Journal Home data. It loads when the screen takes focus (the first time too), when the app returns to the foreground while
// the screen is focused, when the data source or the scenario changes, and on pull-to-refresh. It waits for the signed-in user's
// database (the reflections saved on this phone, and the cache of the ones the server has, live in it). A load shows what the
// phone already has at once, then replaces it with the first page from the server; older pages come with `loadMore`. While the
// screen is in front it follows the sync engine: the list of unsent reflections refreshes after every change, and the whole
// list after a reflection has been prepared.
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

  const refreshPending = useCallback(async () => {
    latestPending.current += 1;
    const request = latestPending.current;
    const items = await listPendingItems();
    if (request === latestPending.current) setPending(items);
  }, []);

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
        const [profile, cached, cachedAffirmations, items] = await Promise.all([
          getProfile(),
          readCachedEntries(),
          readCachedLatestAffirmations(),
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
                },
          );
        }
        // The first page from the server. Without an answer, what is on screen stays (or the error shows when nothing is).
        const page = await loadEntriesPage(null);
        if (request !== latestRequest.current) return;
        if (!page.ok) throw new Error(page.code);
        const affirmations = await getLatestAffirmations();
        // The newest reflection may be new to this phone (made on another phone, or a crisis entry): the affirmation
        // notifications are planned again from what the phone now holds (step 28), once its affirmations are here too.
        requestAffirmationReschedule();
        if (request !== latestRequest.current) return;
        const paged = pagesLoaded.current > 0;
        setResult((previous) => {
          const same = previous?.status === "ready" && previous.key === key ? previous : null;
          return {
            key,
            status: "ready",
            profile,
            affirmations,
            // Older pages that are already on screen stay, and their cursor with them.
            entries: paged && same !== null ? mergeEntries(same.entries, page.data.entries) : page.data.entries,
            nextCursor: paged && same !== null ? same.nextCursor : page.data.nextCursor,
            total: page.data.total,
          };
        });
      } catch {
        if (request !== latestRequest.current) return;
        // A failed refresh keeps the data that is already on screen.
        setResult((previous) =>
          previous?.status === "ready" && previous.key === key ? previous : { key, status: "error" },
        );
      }
    },
    [key, dbReady],
  );

  // The callback changes with the key and with the database, so useFocusEffect reloads then if the screen is focused, and
  // otherwise on the next focus. Leaving the screen drops a response that is still on its way.
  useFocusEffect(
    useCallback(() => {
      load();
      const subscription = AppState.addEventListener("change", (status) => {
        if (status === "active") load();
      });
      const stopFollowing = subscribe((event) => {
        if (event.type === "finished") {
          // What New Entry left behind is no longer true once the reflection is ready.
          useOfflineStore.getState().setSavedNote(null);
          load();
        } else if (event.type === "changed") {
          refreshPending();
        } else if (event.type === "deleted") {
          // A reflection was deleted (step 29b): it leaves the list on screen at once, also from an older page (pages merge by
          // id, so a reload alone would keep it), together with its affirmations; the server's count is one lower.
          setResult((previous) =>
            previous?.status === "ready" && previous.key === key
              ? {
                  ...previous,
                  entries: previous.entries.filter((entry) => entry.id !== event.entryId),
                  affirmations: previous.affirmations.filter((affirmation) => affirmation.entryId !== event.entryId),
                  total: previous.total === null ? null : Math.max(0, previous.total - 1),
                }
              : previous,
          );
        }
      });
      return () => {
        subscription.remove();
        stopFollowing();
        latestRequest.current += 1;
      };
    }, [load, refreshPending, key]),
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
    } finally {
      loadingMoreNow.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, key]);

  const toggleFavorite = useCallback(
    async (affirmation: Affirmation) => {
      if (savingFavorite.current) return;
      savingFavorite.current = true;
      const next = !affirmation.isFavorite;
      setFavoriteFailed(false);
      setResult((previous) => withFavorite(previous, key, affirmation.id, next));
      try {
        const saved = await setAffirmationFavorite(affirmation.id, next);
        if (!saved.ok) {
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
  return {
    status: "ready",
    now,
    profile: current.profile,
    entries,
    entryCount: entries.length + notLoaded,
    affirmations: current.affirmations,
    // TODO(33): the streak counts the entries loaded so far; a server-side count replaces it.
    reflectionDays: getReflectionDays(entries, now),
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
