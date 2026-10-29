import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";

import { REFLECTION_POLL_MAX_MS, REFLECTION_POLL_MS } from "@/constants/app";
import {
  getEntry,
  getProfile,
  listAffirmationsForEntry,
  readCachedAffirmations,
  readCachedEntry,
  setPrayerTracked,
} from "@/data/journalRepository";
import { getCurrentSlot } from "@/data/selectors";
import { confirmScriptureIfNeeded } from "@/services/scriptureConfirm";
import { subscribe, syncNow } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import type { Affirmation, JournalEntry, Prayer, RepoResult, TimeSlot, UserProfile } from "@/types";

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
      // Mark as Prayer Request (step 29): the entry shows the change at once, and the sync engine sends it.
      setTracked: (tracked: boolean) => Promise<RepoResult<Prayer | null>>;
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

// Reflection data for one entry. It loads when the screen takes focus (the first time too) and when the entry changes, and:
// - it shows what the phone already has at once (the read cache), and then what the server says;
// - an entry that a server is still preparing (another phone made it, or this phone stopped waiting for it) is read again
//   every REFLECTION_POLL_MS while the screen is in front, for up to REFLECTION_POLL_MAX_MS (TODO(33): realtime instead);
// - a passage that was kept as a reference only is asked for again (confirm-scripture), and the screen shows the answer.
// A failed reload keeps the data that is already on screen.
export function useReflection(entryId: string): ReflectionState {
  const [result, setResult] = useState<LoadResult | null>(null);
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);
  // True while the entry on screen is being prepared by a server: the interval below then reads it again.
  const preparing = useRef(false);

  const load = useCallback(async () => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    try {
      const dev = useDevStore.getState();
      if (dev.nextReflectionLoadFails) {
        dev.setNextReflectionLoadFails(false);
        throw new Error("Reflection load failed on purpose (dev)");
      }
      // What the phone already has.
      const [profile, cachedEntry, cachedAffirmations] = await Promise.all([
        getProfile(),
        readCachedEntry(entryId),
        readCachedAffirmations(entryId),
      ]);
      if (request !== latestRequest.current) return;
      if (cachedEntry !== null) {
        setResult((previous) =>
          previous?.entryId === entryId && previous.status === "ready"
            ? previous
            : { entryId, status: "ready", now: new Date(), entry: cachedEntry, affirmations: cachedAffirmations, profile },
        );
      }
      // What the server says.
      const [entry, affirmations] = await Promise.all([getEntry(entryId), listAffirmationsForEntry(entryId)]);
      if (request !== latestRequest.current) return;
      if (entry === null) {
        preparing.current = false;
        setResult({ entryId, status: "not-found" });
        return;
      }
      // An entry that is only in this phone's outbox is not read again here: the sync engine is preparing it.
      preparing.current = entry.status === "processing" && entry.pending === undefined;
      setResult({ entryId, status: "ready", now: new Date(), entry, affirmations, profile });
      const confirmed = await confirmScriptureIfNeeded(entry);
      if (request !== latestRequest.current || confirmed === entry) return;
      setResult({ entryId, status: "ready", now: new Date(), entry: confirmed, affirmations, profile });
    } catch {
      if (request !== latestRequest.current) return;
      setResult((previous) =>
        previous?.entryId === entryId && previous.status === "ready"
          ? previous
          : { entryId, status: "error" },
      );
    }
  }, [entryId]);

  // A prayer change of this entry was settled by the sync engine (sent, or refused for good and read again): the phone holds the
  // entry as it now stands.
  const refreshFromPhone = useCallback(async () => {
    const entry = await readCachedEntry(entryId);
    if (entry === null) return;
    setResult((previous) =>
      previous?.entryId === entryId && previous.status === "ready" ? { ...previous, entry } : previous,
    );
  }, [entryId]);

  // The callback changes with the entry, so useFocusEffect reloads then if the screen is focused. Leaving the screen drops a
  // response that is still on its way and stops the reading.
  useFocusEffect(
    useCallback(() => {
      load();
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - startedAt > REFLECTION_POLL_MAX_MS) {
          clearInterval(timer);
        } else if (preparing.current) {
          load();
        }
      }, REFLECTION_POLL_MS);
      const stopFollowing = subscribe((event) => {
        if (event.type === "prayer" && event.entryId === entryId) void refreshFromPhone();
      });
      return () => {
        clearInterval(timer);
        stopFollowing();
        latestRequest.current += 1;
      };
    }, [load, refreshFromPhone, entryId]),
  );

  const setTracked = useCallback(
    async (tracked: boolean) => {
      const changed = await setPrayerTracked(entryId, tracked);
      if (changed.ok) {
        const prayer = changed.data;
        setResult((previous) =>
          previous?.entryId === entryId && previous.status === "ready"
            ? { ...previous, entry: { ...previous.entry, prayer } }
            : previous,
        );
        // The change waits on this phone: the engine sends it now, or once the phone is back online.
        void syncNow("mutation");
      }
      return changed;
    },
    [entryId],
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
    setTracked,
  };
}
