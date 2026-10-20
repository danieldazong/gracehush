import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import { getLatestAffirmations, getProfile, listEntries } from "@/data/journalRepository";
import type { MockScenario } from "@/data/mock/scenario";
import { getCurrentSlot, getReflectionDays } from "@/data/selectors";
import { useDevStore } from "@/store/devStore";
import type { Affirmation, JournalEntry, TimeSlot, UserProfile } from "@/types";

export type HomeState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      now: Date;
      profile: UserProfile;
      entries: JournalEntry[];
      affirmations: Affirmation[];
      reflectionDays: number;
      currentSlot: TimeSlot;
      isOffline: boolean;
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
// to the foreground while the screen is focused, when the scenario changes, and on pull-to-refresh.
export function useJournalHome(): HomeState {
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
      const dev = useDevStore.getState();
      if (dev.nextHomeLoadFails) {
        dev.setNextHomeLoadFails(false);
        throw new Error("Journal load failed on purpose (dev)");
      }
      const [profile, entries, affirmations] = await Promise.all([
        getProfile(),
        listEntries(),
        getLatestAffirmations(),
      ]);
      if (request !== latestRequest.current) return;
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
    profile: current.profile,
    entries: current.entries,
    affirmations: current.affirmations,
    reflectionDays: getReflectionDays(current.entries, now),
    currentSlot: getCurrentSlot(now, current.profile.reminders),
    // TODO(24): NetInfo
    isOffline: scenario === "offline",
    refresh,
    refreshing,
  };
}
