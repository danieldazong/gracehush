import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  countPendingPrayerChanges,
  listPrayers,
  markPrayerAnswered,
  readCachedPrayers,
  setPrayerTracked,
  unmarkPrayerAnswered,
  updateAnsweredNote,
} from "@/data/journalRepository";
import { getPrayerCounts, selectActivePrayers, selectAnsweredPrayers } from "@/data/selectors";
import { startOfflineSession } from "@/services/offlineSession";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { subscribe, syncNow } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import { selectIsOnline, useOfflineStore } from "@/store/offlineStore";
import type { MarkAnsweredInput, Prayer, RepoResult } from "@/types";

export type PrayersState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      now: Date;
      counts: { active: number; answered: number; total: number };
      active: Prayer[];
      answered: Prayer[];
      refresh: () => Promise<void>;
      refreshing: boolean;
      // The phone is offline and changes made here wait to be sent (step 29): the screen says they will sync.
      waitingOffline: boolean;
      markAnswered: (input: MarkAnsweredInput) => Promise<RepoResult<Prayer>>;
      unmarkAnswered: (prayerId: string) => Promise<RepoResult<Prayer>>;
      saveNote: (prayerId: string, note: string | null) => Promise<RepoResult<Prayer>>;
      // Remove from Prayers (step 29b): the reflection stays in the Journal, the prayer flags go (an answered date and note with
      // them). It shows at once and waits in the change queue like any prayer change, so it also works offline.
      removeFromPrayers: (entryId: string) => Promise<RepoResult<Prayer | null>>;
    };

// What a load produced, with the key it was for (the mock scenario and the data source): data loaded for another key is not
// shown.
type LoadResult =
  | { key: string; status: "ready"; prayers: Prayer[] }
  | { key: string; status: "error" };

// Prayers data (steps 14 and 29). It loads like Journal Home: when the screen takes focus (the first time too), when the app
// returns to the foreground while the screen is focused, when the data source or the scenario changes, and on pull-to-refresh,
// and it waits for the signed-in user's database. A load shows what the phone already has at once, then the server's list. While
// the screen is in front it follows the sync engine: a change the engine settled (sent, or refused for good) is read again from
// the phone. A change made here shows at once and waits on the phone until the engine has sent it (offline, until the phone is
// back online); it replaces that prayer by id, so two changes that finish in any order cannot undo each other. A failed change
// leaves the list as it was and returns the result.
// TODO(33): Realtime updates across devices.
export function usePrayers(): PrayersState {
  const scenario = useDevStore((state) => state.scenario);
  const dataSource = useDevStore((state) => state.dataSource);
  const dbReady = useOfflineStore((state) => state.dbReady);
  const dbFailed = useOfflineStore((state) => state.dbFailed);
  const online = useOfflineStore(selectIsOnline);
  const key = `${scenario}:${dataSource}`;
  const [now, setNow] = useState(() => new Date());
  const [result, setResult] = useState<LoadResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(0);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);

  const refreshPending = useCallback(async () => {
    setPendingChanges(await countPendingPrayerChanges());
  }, []);

  const load = useCallback(async () => {
    if (!dbReady) return;
    latestRequest.current += 1;
    const request = latestRequest.current;
    setNow(new Date());
    void refreshPending();
    try {
      // What the phone already has: shown at once, before the network is asked.
      const cached = await readCachedPrayers();
      if (request !== latestRequest.current) return;
      if (cached.length > 0) {
        setResult((previous) =>
          previous?.status === "ready" && previous.key === key
            ? previous
            : { key, status: "ready", prayers: cached },
        );
      }
      const listed = await listPrayers();
      if (request !== latestRequest.current) return;
      if (!listed.ok) throw new Error(listed.code);
      setResult({ key, status: "ready", prayers: listed.data });
    } catch {
      if (request !== latestRequest.current) return;
      // A failed refresh keeps the data that is already on screen.
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key ? previous : { key, status: "error" },
      );
    }
  }, [key, dbReady, refreshPending]);

  // After the engine settled a change, the phone holds the entry as it now stands: the list is read again from the phone alone.
  const reloadFromPhone = useCallback(async () => {
    void refreshPending();
    if (dataSource === "mock") return;
    const request = latestRequest.current;
    const cached = await readCachedPrayers();
    if (request !== latestRequest.current) return;
    setResult((previous) =>
      previous?.status === "ready" && previous.key === key ? { ...previous, prayers: cached } : previous,
    );
  }, [key, dataSource, refreshPending]);

  // A reflection was deleted (step 29b): its prayer leaves the list on screen at once.
  const dropPrayer = useCallback(
    (entryId: string) => {
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key
          ? { ...previous, prayers: previous.prayers.filter((prayer) => prayer.id !== entryId) }
          : previous,
      );
    },
    [key],
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
        if (event.type === "prayer") void reloadFromPhone();
        else if (event.type === "changed") void refreshPending();
        else if (event.type === "deleted") dropPrayer(event.entryId);
      });
      return () => {
        subscription.remove();
        stopFollowing();
        latestRequest.current += 1;
      };
    }, [load, reloadFromPhone, refreshPending, dropPrayer]),
  );

  const retry = useCallback(() => {
    setResult(null);
    if (dbFailed) {
      // The database could not be opened: open it again, and the load follows once it is ready.
      const userId = getSupabaseUserId();
      if (userId !== null) void startOfflineSession(userId);
      return;
    }
    load();
  }, [load, dbFailed]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const applyChange = useCallback(
    (change: RepoResult<Prayer>): RepoResult<Prayer> => {
      if (change.ok) {
        const updated = change.data;
        setResult((previous) =>
          previous?.status === "ready" && previous.key === key
            ? {
                ...previous,
                prayers: previous.prayers.map((prayer) =>
                  prayer.id === updated.id ? updated : prayer,
                ),
              }
            : previous,
        );
        // The change waits on this phone: the engine sends it now, or once the phone is back online.
        void syncNow("mutation");
        void refreshPending();
      }
      return change;
    },
    [key, refreshPending],
  );

  const markAnswered = useCallback(
    async (input: MarkAnsweredInput) => applyChange(await markPrayerAnswered(input)),
    [applyChange],
  );
  const unmarkAnswered = useCallback(
    async (prayerId: string) => applyChange(await unmarkPrayerAnswered(prayerId)),
    [applyChange],
  );
  const saveNote = useCallback(
    async (prayerId: string, note: string | null) =>
      applyChange(await updateAnsweredNote(prayerId, note)),
    [applyChange],
  );

  const removeFromPrayers = useCallback(
    async (entryId: string) => {
      const changed = await setPrayerTracked(entryId, false);
      if (changed.ok) {
        dropPrayer(entryId);
        // The change waits on this phone: the engine sends it now, or once the phone is back online.
        void syncNow("mutation");
        void refreshPending();
      }
      return changed;
    },
    [dropPrayer, refreshPending],
  );

  if (dbFailed) {
    return { status: "error", retry };
  }
  const current = dbReady && result?.key === key ? result : null;
  if (current === null) {
    return { status: "loading" };
  }
  if (current.status === "error") {
    return { status: "error", retry };
  }
  return {
    status: "ready",
    now,
    counts: getPrayerCounts(current.prayers),
    active: selectActivePrayers(current.prayers),
    answered: selectAnsweredPrayers(current.prayers),
    refresh,
    refreshing,
    waitingOffline: online === false && pendingChanges > 0,
    markAnswered,
    unmarkAnswered,
    saveNote,
    removeFromPrayers,
  };
}
