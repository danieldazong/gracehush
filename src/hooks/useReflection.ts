import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";

import { getEntry, getProfile, listAffirmationsForEntry } from "@/data/journalRepository";
import { getCurrentSlot } from "@/data/selectors";
import { useDevStore } from "@/store/devStore";
import type { Affirmation, JournalEntry, TimeSlot, UserProfile } from "@/types";

export type ReflectionState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      entry: JournalEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
      currentSlot: TimeSlot;
    };

// What a load produced, with the entry it was for: another entry's data is never shown.
type LoadResult =
  | {
      entryId: string;
      status: "ready";
      now: Date;
      entry: JournalEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
    }
  | { entryId: string; status: "not-found" }
  | { entryId: string; status: "error" };

// Reflection data for one entry. It loads when the screen takes focus (the first time too) and when
// the entry changes. A failed reload keeps the data that is already on screen.
export function useReflection(entryId: string): ReflectionState {
  const [result, setResult] = useState<LoadResult | null>(null);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    try {
      const dev = useDevStore.getState();
      if (dev.nextReflectionLoadFails) {
        dev.setNextReflectionLoadFails(false);
        throw new Error("Reflection load failed on purpose (dev)");
      }
      const [entry, affirmations, profile] = await Promise.all([
        getEntry(entryId),
        listAffirmationsForEntry(entryId),
        getProfile(),
      ]);
      if (request !== latestRequest.current) return;
      setResult(
        entry
          ? { entryId, status: "ready", now: new Date(), entry, affirmations, profile }
          : { entryId, status: "not-found" },
      );
    } catch {
      if (request !== latestRequest.current) return;
      setResult((previous) =>
        previous?.entryId === entryId && previous.status === "ready"
          ? previous
          : { entryId, status: "error" },
      );
    }
  }, [entryId]);

  // The callback changes with the entry, so useFocusEffect reloads then if the screen is focused.
  // Leaving the screen drops a response that is still on its way.
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        latestRequest.current += 1;
      };
    }, [load]),
  );

  const retry = useCallback(() => {
    setResult(null);
    load();
  }, [load]);

  const current = result?.entryId === entryId ? result : null;
  if (current === null) {
    return { status: "loading" };
  }
  if (current.status === "not-found") {
    return { status: "not-found" };
  }
  if (current.status === "error") {
    return { status: "error", retry };
  }
  return {
    status: "ready",
    entry: current.entry,
    affirmations: current.affirmations,
    profile: current.profile,
    currentSlot: getCurrentSlot(current.now, current.profile.reminders),
  };
}
