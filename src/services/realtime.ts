import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

import { REALTIME_TOKEN_CHECK_MS, REALTIME_TOKEN_RENEW_S } from "@/constants/app";
import { getDataSource } from "@/data/mock/scenario";
import {
  handleAffirmationsChanged,
  handleEntryChanged,
  resetHandlers,
  type HandlerContext,
} from "@/services/realtimeHandlers";
import { getSupabase, getSupabaseUserId, renewSessionTokenIfExpiring } from "@/services/supabaseClient";
import { retryDelayMs } from "@/services/syncPolicy";
import { useDevStore } from "@/store/devStore";
import { selectCanSend, useOfflineStore } from "@/store/offlineStore";
import { selectRealtimeLive, useRealtimeStore } from "@/store/realtimeStore";
import type { AffirmationsChangedMessage, EntryChangedMessage, ProcessingStatus, RealtimeStatus } from "@/types";
import type { Database } from "@/types/database";

// Realtime (step 33): the database sends a short message to the account's own private channel, user:{userId}, when one of its
// entries or affirmations changes on the server (another phone, the server finishing a reflection, a change in the dashboard),
// and services/realtimeHandlers.ts reads the row and tells the screens. The messages hold ids, an operation, a status and a time,
// never anything a person wrote, and only the account's owner may join the channel (the policy on realtime.messages). The phone
// never sends on it.
//
// It runs only while someone is signed in, on the real data source, with the user's database open, the app in front and the
// phone able to send (what the sync engine waits for too), and stops as soon as one of these ends; iOS would close the socket in
// the background anyway. A channel that fails is tried again with the sync engine's backoff while the app is in front. A
// generation counter, as in the sync engine, drops whatever lands after a stop. Development builds log a status and nothing else:
// never a payload, a topic, a token or an id.

export type RealtimeEvent =
  | { type: "entry"; entryId: string; op: "INSERT" | "UPDATE" | "DELETE" }
  | { type: "affirmations"; entryId: string }
  // The channel came back after dropping while the app stayed in front: what changed meanwhile was not heard, so the screens load
  // again from the server.
  | { type: "resync" };

type Joined = { client: SupabaseClient<Database>; channel: RealtimeChannel };

// The account Realtime serves (null when stopped), and the generation: it moves on at every stop, pause and failed channel.
let userId: string | null = null;
let generation = 0;
let appActive = true;
let stopWatching: (() => void) | null = null;
// The channel, with the client it was made on: getSupabase() is null after a sign-out, and the channel must still be removed.
let current: Joined | null = null;
let connecting = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// Failed joins since the last good one: the backoff's step.
let failures = 0;
// While the channel is live: checks the session token every REALTIME_TOKEN_CHECK_MS.
let tokenTimer: ReturnType<typeof setInterval> | null = null;
// A channel was joined since startRealtime, and whether the next join follows a drop while the app stayed in front.
let joinedOnce = false;
let resyncNext = false;
// Channels being removed, in order: a new channel waits for them (the client hands back a listed channel of the same topic, and
// removing one drops every channel of its topic).
let teardown: Promise<void> = Promise.resolve();

const listeners = new Set<(event: RealtimeEvent) => void>();

function log(message: string): void {
  if (__DEV__) {
    console.log(`[realtime] ${message}`);
  }
}

function setStatus(status: RealtimeStatus, reason: string | null = null): void {
  const store = useRealtimeStore.getState();
  if (store.status === status && store.reason === reason) return;
  store.setStatus(status, reason);
  log(reason === null ? status : `${status} (${reason})`);
}

function emit(event: RealtimeEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A screen's failure stays its own.
    }
  }
}

// ---- the message contract --------------------------------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly string[] = ["pending", "uploading", "processing", "ready", "failed"] satisfies ProcessingStatus[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// An entry_changed payload of the contract's shape, or null. Only the contract's keys are read.
export function readEntryChanged(payload: unknown): EntryChangedMessage | null {
  if (!isRecord(payload)) return null;
  const { id, op, status } = payload;
  const updatedAt = payload.updated_at;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (op !== "INSERT" && op !== "UPDATE" && op !== "DELETE") return null;
  if (status !== null && (typeof status !== "string" || !STATUSES.includes(status))) return null;
  if (updatedAt !== null && typeof updatedAt !== "string") return null;
  return { id, op, status: status as ProcessingStatus | null, updated_at: updatedAt };
}

// An affirmations_changed payload of the contract's shape, or null. Only the entry's id is read.
export function readAffirmationsChanged(payload: unknown): AffirmationsChangedMessage | null {
  if (!isRecord(payload)) return null;
  const entryId = payload.entry_id;
  if (typeof entryId !== "string" || !UUID.test(entryId)) return null;
  return { entry_id: entryId };
}

function onMessage(gen: number, event: "entry_changed" | "affirmations_changed", payload: unknown): void {
  if (gen !== generation) return;
  const context: HandlerContext = { isCurrent: () => gen === generation, emit };
  if (event === "entry_changed") {
    const message = readEntryChanged(payload);
    if (message === null) {
      log("realtime_bad_payload");
      return;
    }
    useRealtimeStore.getState().countEvent();
    handleEntryChanged(message, context);
    return;
  }
  const message = readAffirmationsChanged(payload);
  if (message === null) {
    log("realtime_bad_payload");
    return;
  }
  useRealtimeStore.getState().countEvent();
  handleAffirmationsChanged(message, context);
}

// ---- the channel -------------------------------------------------------------------------------------------------------------
// Why Realtime cannot run now, as one word, or null when everything it needs holds.
function whyNot(): string | null {
  if (userId === null || getSupabaseUserId() !== userId) return "signed_out";
  if (getDataSource() !== "supabase") return "mock_data";
  if (useRealtimeStore.getState().forcePolling) return "force_polling";
  if (!appActive) return "background";
  const offline = useOfflineStore.getState();
  if (!offline.dbReady) return "no_database";
  if (!selectCanSend(offline)) return "offline";
  return null;
}

// The server's reason for a failed channel, as one short word: its own words can name the topic.
function failureReason(status: REALTIME_SUBSCRIBE_STATES, error: Error | undefined): string {
  if (status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) return "timed_out";
  if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) return "closed";
  const text = error?.message ?? "";
  if (/unauthori[sz]ed|permission/i.test(text)) return "unauthorized";
  if (/private_?only/i.test(text)) return "private_only";
  return "channel_error";
}

// Removes a channel after the ones before it, closing the socket first when asked: with it closed, the leave needs no answer.
function closeLater(ending: Joined, closeSocket: boolean): void {
  const previous = teardown;
  teardown = (async () => {
    await previous;
    if (closeSocket) {
      try {
        await ending.client.realtime.disconnect();
      } catch {
        // Already closed.
      }
    }
    try {
      await ending.client.removeChannel(ending.channel);
    } catch {
      // Already removed.
    }
  })();
}

function stopTokenChecks(): void {
  if (tokenTimer !== null) {
    clearInterval(tokenTimer);
    tokenTimer = null;
  }
}

// Realtime asks for the token itself only at its heartbeat (every 25 s), and Clerk mints the next one 17 s before the old one
// expires, in a background fetch that can fail or come late; either way a token could run out on the channel and the server would
// close it. So every 5 s the check renews a token that has 15 s or fewer left, then pushes Clerk's current token to the channel:
// setAuth() with no argument reads it through the accessToken callback, and Realtime sends it only when it changed.
async function checkToken(gen: number, client: SupabaseClient<Database>): Promise<void> {
  await renewSessionTokenIfExpiring(REALTIME_TOKEN_RENEW_S);
  if (gen !== generation) return;
  try {
    await client.realtime.setAuth();
  } catch {
    // Realtime keeps its last token; the next check tries again.
  }
}

function startTokenChecks(gen: number, client: SupabaseClient<Database>): void {
  stopTokenChecks();
  tokenTimer = setInterval(() => {
    if (gen !== generation) {
      stopTokenChecks();
      return;
    }
    void checkToken(gen, client);
  }, REALTIME_TOKEN_CHECK_MS);
}

// Ends what is running: the retry, the token checks, the reads that wait, the channel and the socket. Whatever arrives later is
// dropped.
function halt(): void {
  generation += 1;
  connecting = false;
  stopTokenChecks();
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  resetHandlers();
  const ending = current;
  current = null;
  if (ending !== null) closeLater(ending, true);
}

function pause(reason: string): void {
  const running = current !== null || connecting || retryTimer !== null;
  // A channel that drops while the app stays in front misses what changes meanwhile: the screens load again when it is back.
  if (running && appActive && joinedOnce) resyncNext = true;
  if (running) halt();
  setStatus("offline", reason);
}

function scheduleRetry(): void {
  const gen = generation;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (gen === generation) evaluate();
  }, retryDelayMs("REALTIME", failures));
}

function onStatus(gen: number, status: REALTIME_SUBSCRIBE_STATES, error: Error | undefined): void {
  if (gen !== generation) return;
  if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
    failures = 0;
    joinedOnce = true;
    if (current !== null) startTokenChecks(gen, current.client);
    const resync = resyncNext;
    resyncNext = false;
    setStatus("live");
    if (resync) {
      useRealtimeStore.getState().countReconnect();
      emit({ type: "resync" });
    }
    return;
  }
  // CHANNEL_ERROR, TIMED_OUT, or a CLOSED it did not ask for (one it asked for comes after the generation moved on).
  if (appActive && joinedOnce) resyncNext = true;
  generation += 1;
  stopTokenChecks();
  resetHandlers();
  const failed = current;
  current = null;
  connecting = false;
  if (failed !== null) closeLater(failed, false);
  failures += 1;
  setStatus("offline", failureReason(status, error));
  scheduleRetry();
}

function connect(): void {
  const client = getSupabase();
  const owner = userId;
  if (client === null || owner === null) return;
  const gen = generation;
  connecting = true;
  setStatus("connecting");
  void (async () => {
    await teardown;
    if (gen !== generation) return;
    // A join carries the token Realtime holds at that moment, and the app's one client outlives a sign-out, so the current
    // account's token is asked for first. After the join it is checked every 5 s (startTokenChecks).
    try {
      await client.realtime.setAuth();
    } catch {
      // Realtime keeps its last token when the callback fails; the join then fails and is tried again.
    }
    if (gen !== generation) return;
    connecting = false;
    const channel = client.channel(`user:${owner}`, { config: { private: true } });
    current = { client, channel };
    channel
      .on("broadcast", { event: "entry_changed" }, (message) => onMessage(gen, "entry_changed", message.payload))
      .on("broadcast", { event: "affirmations_changed" }, (message) => onMessage(gen, "affirmations_changed", message.payload))
      .subscribe((status, error) => onStatus(gen, status, error));
  })();
}

// Starts or stops the channel to match the conditions. A retry that is waiting is left to its timer.
function evaluate(): void {
  if (userId === null) return;
  const reason = whyNot();
  if (reason !== null) {
    pause(reason);
    return;
  }
  if (current === null && !connecting && retryTimer === null) connect();
}

function endSession(): void {
  stopWatching?.();
  stopWatching = null;
  userId = null;
  joinedOnce = false;
  resyncNext = false;
  failures = 0;
  halt();
  setStatus("offline", "stopped");
}

// ---- what the app calls --------------------------------------------------------------------------------------------------
// The auth bridge calls it at sign-in. Idempotent: it waits for its own conditions, and follows them until stopRealtime.
export function startRealtime(id: string): void {
  if (userId === id) {
    evaluate();
    return;
  }
  if (userId !== null) endSession();
  userId = id;
  appActive = AppState.currentState === "active";
  const appState = AppState.addEventListener("change", (status) => {
    appActive = status === "active";
    // The screens load again by themselves after a return to the front, so a drop in the background asks for no resync.
    if (!appActive) resyncNext = false;
    evaluate();
  });
  const offline = useOfflineStore.subscribe(() => evaluate());
  const dataSource = useDevStore.subscribe((state, previous) => {
    if (state.dataSource !== previous.dataSource) evaluate();
  });
  const polling = useRealtimeStore.subscribe((state, previous) => {
    if (state.forcePolling !== previous.forcePolling) evaluate();
  });
  stopWatching = () => {
    appState.remove();
    offline();
    dataSource();
    polling();
  };
  evaluate();
}

// Sign-out, an account deletion and the auth bridge's cleanup call it, before the database and the token go. The channel is
// removed and the socket closed by the time it resolves.
export async function stopRealtime(): Promise<void> {
  endSession();
  await teardown;
}

export function subscribeRealtime(listener: (event: RealtimeEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// False while Force polling is on, as everything else that stops Realtime: Reflection polls then (step 25).
export function isRealtimeLive(): boolean {
  return selectRealtimeLive(useRealtimeStore.getState());
}
