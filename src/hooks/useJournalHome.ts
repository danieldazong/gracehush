import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  getLatestAffirmations,
  getProfile,
  listEntries,
  listPendingItems,
} from "@/data/journalRepository";
import type { MockScenario } from "@/data/mock/scenario";
import { mergePending, toPendingEntry } from "@/data/pendingEntries";
import { getCurrentSlot, getReflectionDays } from "@/data/selectors";
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
    };

// What a load produced, with the scenario it was for: data loaded for another scenario is not shown.
type LoadResult =
  | {
      scenario: MockScenario;
      status: "ready";
      profile: UserProfile;
      entries: JournalEntry[];
      affirmations: Affirmation[];
    }
  | { scenario: MockScenario; status: "error" };

// Journal Home data. It loads when the screen takes focus (the first time too), when the app returns
// to the foreground while the screen is focused, when the scenario changes, and on pull-to-refresh. It waits for the
// signed-in user's database (the reflections saved on this phone live in it), and, while the screen is in front, it
// follows the sync engine: the list of unsent reflections refreshes after every change, and the whole list after a
// reflection has been prepared.
export function useJournalHome(): HomeState {
  const scenario = useDevStore((state) => state.scenario);
  const dbReady = useOfflineStore((state) => state.dbReady);
  const dbFailed = useOfflineStore((state) => state.dbFailed);
  const online = useOfflineStore(selectIsOnline);
  const savedNote = useOfflineStore((state) => state.savedNote);
  const [now, setNow] = useState(() => new Date());
  const [result, setResult] = useState<LoadResult | null>(null);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);
  const latestPending = useRef(0);

  const refreshPending = useCallback(async () => {
    latestPending.current += 1;
    const request = latestPending.current;
    const items = await listPendingItems();
    if (request === latestPending.current) setPending(items);
  }, []);

  const load = useCallback(async () => {
    if (!dbReady) return;
    latestRequest.current += 1;
    const request = latestRequest.current;
    latestPending.current += 1;
    const pendingRequest = latestPending.current;
    setNow(new Date());
    try {
      const dev = useDevStore.getState();
      if (dev.nextHomeLoadFails) {
        dev.setNextHomeLoadFails(false);
        throw new Error("Journal load failed on purpose (dev)");
      }
      const [profile, entries, affirmations, items] = await Promise.all([
        getProfile(),
        listEntries(),
        getLatestAffirmations(),
        listPendingItems(),
      ]);
      if (request !== latestRequest.current) return;
      if (pendingRequest === latestPending.current) setPending(items);
      setResult({ scenario, status: "ready", profile, entries, affirmations });
    } catch {
      if (request !== latestRequest.current) return;
      // A failed refresh keeps the data that is already on screen.
      setResult((previous) =>
        previous?.status === "ready" && previous.scenario === scenario
          ? previous
          : { scenario, status: "error" },
      );
    }
  }, [scenario, dbReady]);

  // The callback changes with the scenario and with the database, so useFocusEffect reloads then if the screen is
  // focused, and otherwise on the next focus. Leaving the screen drops a response that is still on its way.
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
        }
      });
      return () => {
        subscription.remove();
        stopFollowing();
        latestRequest.current += 1;
      };
    }, [load, refreshPending]),
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
    useOfflineStore.getState().setSavedNote(null);
    await load();
    setRefreshing(false);
  }, [load]);

  const dismissNote = useCallback(() => useOfflineStore.getState().setSavedNote(null), []);

  if (dbFailed) {
    return { status: "error", retry };
  }
  const current = dbReady && result?.scenario === scenario ? result : null;
  if (current === null) {
    return { status: "loading" };
  }
  if (current.status === "error") {
    return { status: "error", retry };
  }
  const entries = mergePending(current.entries, pending.map(toPendingEntry));
  return {
    status: "ready",
    now,
    profile: current.profile,
    entries,
    affirmations: current.affirmations,
    reflectionDays: getReflectionDays(entries, now),
    currentSlot: getCurrentSlot(now, current.profile.reminders),
    // The dev scenario still forces the offline look in development.
    isOffline: scenario === "offline" || online === false,
    isOnline: online,
    savedNote,
    dismissNote,
    refresh,
    refreshing,
  };
}
