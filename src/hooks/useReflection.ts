import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";

import { MAX_AFFIRMATIONS, REFLECTION_POLL_MAX_MS, REFLECTION_POLL_MS } from "@/constants/app";
import {
  addAffirmation as addAffirmationToEntry,
  getEntry,
  getProfile,
  listAffirmationsForEntry,
  readCachedAffirmations,
  readCachedEntry,
  setPrayerTracked,
} from "@/data/journalRepository";
import { requestAffirmationReschedule } from "@/services/affirmationScheduler";
import { isRealtimeLive, subscribeRealtime } from "@/services/realtime";
import { confirmScriptureIfNeeded } from "@/services/scriptureConfirm";
import { subscribe, syncNow } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import type { Affirmation, JournalEntry, Prayer, RepoResult, UserProfile } from "@/types";

export type ReflectionState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      entry: JournalEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
      // Mark as Prayer Request (step 29): the entry shows the change at once, and the sync engine sends it.
      setTracked: (tracked: boolean) => Promise<RepoResult<Prayer | null>>;
      // One more affirmation (2026-11-09), written by the server while the person waits; the list it answers replaces the one on
      // screen. Null once the reflection has MAX_AFFIRMATIONS, or while it is still a cached copy with no server answer.
      addAffirmation: (() => Promise<RepoResult<Affirmation[]>>) | null;
      adding: boolean;
    };

// What a load produced, with the entry it was for: another entry's data is never shown.
type LoadResult =
  | {
      entryId: string;
      status: "ready";
      entry: JournalEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
    }
  | { entryId: string; status: "not-found" }
  | { entryId: string; status: "error" };

// Reflection data for one entry. It loads when the screen takes focus (the first time too) and when the entry changes, and:
// - it shows what the phone already has at once (the read cache), and then what the server says;
// - while the screen is in front it follows Realtime (step 33): a change to this entry, or to its affirmations, is read again
//   from the phone (the handler has just written it there), a delete shows "not found", and after a dropped channel came back
//   the entry loads again;
// - an entry that a server is still preparing (another phone made it, or this phone stopped waiting for it) is read again
//   every REFLECTION_POLL_MS while the screen is in front, for up to REFLECTION_POLL_MAX_MS, only while Realtime is not live;
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
            : { entryId, status: "ready", entry: cachedEntry, affirmations: cachedAffirmations, profile },
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
      setResult({ entryId, status: "ready", entry, affirmations, profile });
      const confirmed = await confirmScriptureIfNeeded(entry);
      if (request !== latestRequest.current || confirmed === entry) return;
      setResult({ entryId, status: "ready", entry: confirmed, affirmations, profile });
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

  // A Realtime message about this entry or its affirmations (step 33): the handler has read them into the phone. An entry that a
  // server is still preparing is noted, so the polling below takes over if Realtime goes.
  const followRealtime = useCallback(async () => {
    const [entry, affirmations] = await Promise.all([readCachedEntry(entryId), readCachedAffirmations(entryId)]);
    if (entry === null) return;
    preparing.current = entry.status === "processing";
    setResult((previous) =>
      previous?.entryId === entryId && previous.status === "ready"
        ? { ...previous, entry, affirmations: affirmations.length > 0 ? affirmations : previous.affirmations }
        : previous,
    );
  }, [entryId]);

  // Deleted elsewhere (step 33): a load still on its way must not bring it back. A delete made on this screen leaves the screen
  // itself (step 29b), so the sync engine's own `deleted` event is not followed here.
  const showDeleted = useCallback(() => {
    latestRequest.current += 1;
    preparing.current = false;
    setResult({ entryId, status: "not-found" });
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
        } else if (preparing.current && !isRealtimeLive()) {
          load();
        }
      }, REFLECTION_POLL_MS);
      const stopFollowing = subscribe((event) => {
        if (event.type === "prayer" && event.entryId === entryId) void refreshFromPhone();
      });
      const stopListening = subscribeRealtime((event) => {
        if (event.type === "resync") {
          load();
        } else if (event.entryId !== entryId) {
          return;
        } else if (event.type === "entry" && event.op === "DELETE") {
          showDeleted();
        } else {
          void followRealtime();
        }
      });
      return () => {
        clearInterval(timer);
        stopFollowing();
        stopListening();
        latestRequest.current += 1;
      };
    }, [load, refreshFromPhone, followRealtime, showDeleted, entryId]),
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

  // One more affirmation (2026-11-09). One at a time: a second tap while one is on its way does nothing. The server's list replaces
  // the one on screen (a lock-screen slot may have moved), and the notifications are planned again from the phone's copy. A
  // reflection the server says is full (INVALID) is read again, so the screen shows the ten it has.
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const addAffirmation = useCallback(async (): Promise<RepoResult<Affirmation[]>> => {
    if (addingRef.current) return { ok: false, code: "UNKNOWN", message: "" };
    addingRef.current = true;
    setAdding(true);
    try {
      const added = await addAffirmationToEntry(entryId);
      if (added.ok) {
        setResult((previous) =>
          previous?.entryId === entryId && previous.status === "ready" ? { ...previous, affirmations: added.data } : previous,
        );
        requestAffirmationReschedule();
      } else if (added.code === "INVALID") {
        const affirmations = await listAffirmationsForEntry(entryId).catch(() => null);
        if (affirmations !== null) {
          setResult((previous) =>
            previous?.entryId === entryId && previous.status === "ready" ? { ...previous, affirmations } : previous,
          );
        }
      }
      return added;
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }, [entryId]);

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
  const canAdd = current.entry.status === "ready" && current.entry.devotional !== null && current.affirmations.length < MAX_AFFIRMATIONS;
  return {
    status: "ready",
    entry: current.entry,
    affirmations: current.affirmations,
    profile: current.profile,
    setTracked,
    addAffirmation: canAdd ? addAffirmation : null,
    adding,
  };
}
