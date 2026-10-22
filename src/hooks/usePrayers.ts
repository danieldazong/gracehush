import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  listPrayers,
  markPrayerAnswered,
  unmarkPrayerAnswered,
  updateAnsweredNote,
} from "@/data/journalRepository";
import type { MockScenario } from "@/data/mock/scenario";
import { getPrayerCounts, selectActivePrayers, selectAnsweredPrayers } from "@/data/selectors";
import { useDevStore } from "@/store/devStore";
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
      markAnswered: (input: MarkAnsweredInput) => Promise<RepoResult<Prayer>>;
      unmarkAnswered: (prayerId: string) => Promise<RepoResult<Prayer>>;
      saveNote: (prayerId: string, note: string | null) => Promise<RepoResult<Prayer>>;
    };

// What a load produced, with the scenario it was for: data loaded for another scenario is not shown.
type LoadResult =
  | { scenario: MockScenario; status: "ready"; prayers: Prayer[] }
  | { scenario: MockScenario; status: "error" };

// Prayers data. It loads like Journal Home: when the screen takes focus (the first time too), when the app
// returns to the foreground while the screen is focused, when the scenario changes, and on pull-to-refresh.
// A change waits for the repository and then replaces that prayer by id, so two changes that finish in any
// order cannot undo each other. A failed change leaves the list as it was and returns the result.
export function usePrayers(): PrayersState {
  const scenario = useDevStore((state) => state.scenario);
  const [now, setNow] = useState(() => new Date());
  const [result, setResult] = useState<LoadResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    setNow(new Date());
    try {
      const prayers = await listPrayers();
      if (request !== latestRequest.current) return;
      setResult({ scenario, status: "ready", prayers });
    } catch {
      if (request !== latestRequest.current) return;
      // A failed refresh keeps the data that is already on screen.
      setResult((previous) =>
        previous?.status === "ready" && previous.scenario === scenario
          ? previous
          : { scenario, status: "error" },
      );
    }
  }, [scenario]);

  // The callback changes with the scenario, so useFocusEffect reloads then if the screen is focused,
  // and otherwise on the next focus. Leaving the screen drops a response that is still on its way.
  useFocusEffect(
    useCallback(() => {
      load();
      const subscription = AppState.addEventListener("change", (status) => {
        if (status === "active") load();
      });
      return () => {
        subscription.remove();
        latestRequest.current += 1;
      };
    }, [load]),
  );

  const retry = useCallback(() => {
    setResult(null);
    load();
  }, [load]);

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
          previous?.status === "ready" && previous.scenario === scenario
            ? {
                ...previous,
                prayers: previous.prayers.map((prayer) =>
                  prayer.id === updated.id ? updated : prayer,
                ),
              }
            : previous,
        );
      }
      return change;
    },
    [scenario],
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

  const current = result?.scenario === scenario ? result : null;
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
    markAnswered,
    unmarkAnswered,
    saveNote,
  };
}
