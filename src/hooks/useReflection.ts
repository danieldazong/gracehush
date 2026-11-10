import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";

import { AUDIO_PENDING_MS, MAX_AFFIRMATIONS, REFLECTION_POLL_MAX_MS, REFLECTION_POLL_MS } from "@/constants/app";
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
import { isAudioPending } from "@/data/selectors";
import { haptics } from "@/services/haptics";
import { isRealtimeLive, subscribeRealtime } from "@/services/realtime";
import { confirmScriptureIfNeeded } from "@/services/scriptureConfirm";
import { subscribe, syncNow } from "@/services/syncEngine";
import { useDevStore } from "@/store/devStore";
import type { Affirmation, HomeEntry, Prayer, RepoResult, UserProfile } from "@/types";

export type ReflectionState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      // A HomeEntry (step 24): a reflection still on this phone carries `pending`, which the screen reads for what it is
      // waiting on (2026-11-10).
      entry: HomeEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
      // The spoken devotional is still being made behind the server's answer (2026-11-09; isAudioPending): the player card
      // says so until the audio lands, or the window passes.
      audioPending: boolean;
      // Mark as Prayer Request (step 29): the entry shows the change at once, and the sync engine sends it.
      setTracked: (tracked: boolean) => Promise<RepoResult<Prayer | null>>;
      // One more affirmation (2026-11-09), written by the server while the person waits; the list it answers replaces the one on
      // screen. Null once the reflection has MAX_AFFIRMATIONS, or while it is still a cached copy with no server answer.
      addAffirmation: (() => Promise<RepoResult<Affirmation[]>>) | null;
      adding: boolean;
    };

// What a load produced, with the entry it was for: another entry's data is never shown. `readAt` is when the entry was read,
// for the audio's window (the clock is read where the entry is, never in render).
type LoadResult =
  | {
      entryId: string;
      status: "ready";
      entry: HomeEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
      readAt: number;
    }
  | { entryId: string; status: "not-found" }
  | { entryId: string; status: "error" };

// Reflection data for one entry. It loads when the screen takes focus (the first time too) and when the entry changes, and:
// - it shows what the phone already has at once (the read cache), and then what the server says;
// - while the screen is in front it follows Realtime (step 33): a change to this entry, or to its affirmations, is read again
//   from the phone (the handler has just written it there), a delete shows "not found", and after a dropped channel came back
//   the entry loads again;
// - an entry that a server is still preparing (another phone made it, or this phone stopped waiting for it), or whose spoken
//   devotional is still being made behind the answer (2026-11-09), is read again every REFLECTION_POLL_MS while the screen is
//   in front, for up to REFLECTION_POLL_MAX_MS, only while Realtime is not live;
// - opened by the id this phone gave a reflection (New Entry's handoff, 2026-11-10: the screen opens the moment New Entry's three
//   seconds are up, with the reflection still on its way), it shows the item being prepared and follows the sync engine: the
//   `finished` event for that id turns it into the reflection (one success tap, none for a heavy moment) and the hook reads by
//   the server's id from then on; a `settled` event (refused for good, held by the free limit, paused) reads the item again, so
//   the screen can say what it now is. A finish that landed before the first read is found through the cache (getEntry looks
//   the client id up there), and the hook follows the server's id the same way;
// - a passage that was kept as a reference only is asked for again (confirm-scripture), and the screen shows the answer.
// A failed reload keeps the data that is already on screen.
export function useReflection(entryId: string): ReflectionState {
  const [result, setResult] = useState<LoadResult | null>(null);
  // The id the hook reads by: the route's, until a reflection opened by the id this phone gave it has finished, then the
  // server's (the cache, the prayer change and the added affirmation all go by the server's id).
  const [resolved, setResolved] = useState<{ from: string; to: string } | null>(null);
  const activeId = resolved !== null && resolved.from === entryId ? resolved.to : entryId;
  // Only the latest request may set state. Touched in callbacks and effects only, never in render.
  const latestRequest = useRef(0);
  // True while the entry on screen is being prepared by a server, or while its audio is still being made: the interval below
  // then reads it again.
  const preparing = useRef(false);
  const awaitingAudio = useRef(false);

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
        readCachedEntry(activeId),
        readCachedAffirmations(activeId),
      ]);
      if (request !== latestRequest.current) return;
      if (cachedEntry !== null) {
        setResult((previous) =>
          previous?.entryId === activeId && previous.status === "ready"
            ? previous
            : { entryId: activeId, status: "ready", entry: cachedEntry, affirmations: cachedAffirmations, profile, readAt: Date.now() },
        );
      }
      // What the server says.
      const [entry, affirmations] = await Promise.all([getEntry(activeId), listAffirmationsForEntry(activeId)]);
      if (request !== latestRequest.current) return;
      if (entry === null) {
        preparing.current = false;
        awaitingAudio.current = false;
        setResult({ entryId: activeId, status: "not-found" });
        return;
      }
      // A reflection opened by the id this phone gave it, and finished since (the engine wrote it to the cache under the
      // server's id, which getEntry found by the client id): the hook reads by the server's id from here, and that reload
      // shows it. Nothing else answers an entry under another id.
      if (entry.pending === undefined && entry.id !== activeId) {
        setResolved({ from: entryId, to: entry.id });
        return;
      }
      // An entry that is only in this phone's outbox is not read again here: the sync engine is preparing it.
      preparing.current = entry.status === "processing" && entry.pending === undefined;
      const readAt = Date.now();
      awaitingAudio.current = isAudioPending(entry, readAt);
      setResult({ entryId: activeId, status: "ready", entry, affirmations, profile, readAt });
      const confirmed = await confirmScriptureIfNeeded(entry);
      if (request !== latestRequest.current || confirmed === entry) return;
      setResult({ entryId: activeId, status: "ready", entry: confirmed, affirmations, profile, readAt });
    } catch {
      if (request !== latestRequest.current) return;
      setResult((previous) =>
        previous?.entryId === activeId && previous.status === "ready"
          ? previous
          : { entryId: activeId, status: "error" },
      );
    }
  }, [entryId, activeId]);

  // A prayer change of this entry was settled by the sync engine (sent, or refused for good and read again): the phone holds the
  // entry as it now stands.
  const refreshFromPhone = useCallback(async () => {
    const entry = await readCachedEntry(activeId);
    if (entry === null) return;
    const readAt = Date.now();
    awaitingAudio.current = isAudioPending(entry, readAt);
    setResult((previous) =>
      previous?.entryId === activeId && previous.status === "ready" ? { ...previous, entry, readAt } : previous,
    );
  }, [activeId]);

  // A Realtime message about this entry or its affirmations (step 33): the handler has read them into the phone. An entry that a
  // server is still preparing is noted, so the polling below takes over if Realtime goes.
  const followRealtime = useCallback(async () => {
    const [entry, affirmations] = await Promise.all([readCachedEntry(activeId), readCachedAffirmations(activeId)]);
    if (entry === null) return;
    preparing.current = entry.status === "processing";
    const readAt = Date.now();
    awaitingAudio.current = isAudioPending(entry, readAt);
    setResult((previous) =>
      previous?.entryId === activeId && previous.status === "ready"
        ? { ...previous, entry, affirmations: affirmations.length > 0 ? affirmations : previous.affirmations, readAt }
        : previous,
    );
  }, [activeId]);

  // Deleted elsewhere (step 33): a load still on its way must not bring it back. A delete made on this screen leaves the screen
  // itself (step 29b), so the sync engine's own `deleted` event is not followed here.
  const showDeleted = useCallback(() => {
    latestRequest.current += 1;
    preparing.current = false;
    awaitingAudio.current = false;
    setResult({ entryId: activeId, status: "not-found" });
  }, [activeId]);

  // The callback changes with the entry, so useFocusEffect reloads then if the screen is focused. Leaving the screen drops a
  // response that is still on its way and stops the reading.
  useFocusEffect(
    useCallback(() => {
      load();
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - startedAt > REFLECTION_POLL_MAX_MS) {
          clearInterval(timer);
        } else if ((preparing.current || awaitingAudio.current) && !isRealtimeLive()) {
          load();
        }
      }, REFLECTION_POLL_MS);
      // The sync engine's events: a prayer change of this entry, and, for a reflection opened by the id this phone gave it and
      // not finished yet, its finish and anything that stopped it.
      const unresolved = activeId === entryId;
      const stopFollowing = subscribe((event) => {
        if (event.type === "prayer" && event.entryId === activeId) {
          void refreshFromPhone();
        } else if (event.type === "finished" && unresolved && event.clientEntryId === entryId) {
          // The reflection this screen was opened for is ready: one success tap (none for a heavy moment, Crisis Safety Rules),
          // and the server's id from here on, where the engine has just written it.
          if (!event.isCrisis) haptics.success();
          setResolved({ from: entryId, to: event.entryId });
        } else if (event.type === "settled" && unresolved && event.clientEntryId === entryId) {
          // Refused for good, held by the free limit, paused for a sign-in or waiting for a retry: the item is read again, and
          // the screen says what it now is.
          load();
        }
      });
      const stopListening = subscribeRealtime((event) => {
        if (event.type === "resync") {
          load();
        } else if (event.entryId !== activeId) {
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
    }, [load, refreshFromPhone, followRealtime, showDeleted, entryId, activeId]),
  );

  const setTracked = useCallback(
    async (tracked: boolean) => {
      const changed = await setPrayerTracked(activeId, tracked);
      if (changed.ok) {
        const prayer = changed.data;
        setResult((previous) =>
          previous?.entryId === activeId && previous.status === "ready"
            ? { ...previous, entry: { ...previous.entry, prayer } }
            : previous,
        );
        // The change waits on this phone: the engine sends it now, or once the phone is back online.
        void syncNow("mutation");
      }
      return changed;
    },
    [activeId],
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
      const added = await addAffirmationToEntry(activeId);
      if (added.ok) {
        setResult((previous) =>
          previous?.entryId === activeId && previous.status === "ready" ? { ...previous, affirmations: added.data } : previous,
        );
        requestAffirmationReschedule();
      } else if (added.code === "INVALID") {
        const affirmations = await listAffirmationsForEntry(activeId).catch(() => null);
        if (affirmations !== null) {
          setResult((previous) =>
            previous?.entryId === activeId && previous.status === "ready" ? { ...previous, affirmations } : previous,
          );
        }
      }
      return added;
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }, [activeId]);

  const current = result?.entryId === activeId ? result : null;
  const audioPending = current?.status === "ready" ? isAudioPending(current.entry, current.readAt) : false;

  // The audio's window ends while the screen is open: the entry is read again from the phone then, so the player card stops
  // saying the audio is coming (a timer sets the state, never the effect itself).
  useEffect(() => {
    if (!audioPending || current?.status !== "ready") return undefined;
    const remaining = AUDIO_PENDING_MS - (current.readAt - Date.parse(current.entry.updatedAt));
    const timer = setTimeout(() => void refreshFromPhone(), Math.max(0, remaining) + 50);
    return () => clearTimeout(timer);
  }, [audioPending, current, refreshFromPhone]);

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
    audioPending,
    setTracked,
    addAffirmation: canAdd ? addAffirmation : null,
    adding,
  };
}
