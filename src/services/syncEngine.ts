import { AppState } from "react-native";

import { getKnownTier } from "@/data/journalRepository";
import * as cache from "@/db/cache";
import { isDatabaseOpen } from "@/db/database";
import * as outbox from "@/db/outbox";
import { processItem, processorIsMock } from "@/services/entryProcessor";
import { cleanOldRecordings } from "@/services/recordingCleanup";
import { deleteRecording } from "@/services/recordingFiles";
import { markReachable, markUnreachable } from "@/services/connectivity";
import { classify, retryDelayMs } from "@/services/syncPolicy";
import { selectCanSend, useOfflineStore } from "@/store/offlineStore";
import type { OutboxItem, OutboxStatus, ProcessingStage, ProcessOutcome } from "@/types";

// The sync engine (step 24): it sends what is in the outbox, one reflection at a time, oldest first, whenever the app is in
// front, the phone can send and the database is open. It never runs in the background and it uses no background task.
//
// Rules the code below keeps:
// - One flight: a second syncNow while a run is going only asks the run to go round again.
// - A generation counter: stopSyncEngine (sign-out) makes every run and every answer still in the air stop touching the
//   database, which may already be closed or deleted.
// - On success the answer is saved first, then the outbox row is removed, then the recording is deleted: a crash in between
//   leaves an item that is sent again, and the server answers a finished entry with the same entry (nothing is made twice).
// - Nothing logs a word the person wrote, a file path, an id or a key. A log line is a state, an error code, an attempt
//   count or a delay. A crisis answer is logged like any other ("finished"): the app logs nothing about a crisis entry.
export type SyncReason = "start" | "foreground" | "online" | "timer" | "submit" | "upgrade" | "manual";

export type SyncEvent =
  | { type: "changed" }
  | { type: "stage"; clientEntryId: string; stage: ProcessingStage }
  | { type: "finished"; clientEntryId: string; entryId: string; isCrisis: boolean }
  | {
      type: "settled";
      clientEntryId: string;
      status: OutboxStatus;
      code: string | null;
      entryId: string | null;
    };

// What a screen that waits for one item gets back.
export type WaitResult =
  | { kind: "ready"; entryId: string; isCrisis: boolean }
  | { kind: "limit"; entryId: string | null }
  | { kind: "needs_action"; code: string }
  | { kind: "later" };

// A processor call that has not answered after this long counts as no answer, so a call that never returns cannot stall
// the queue. The server stops a request at about 150 s.
export const MAX_PROCESS_MS = 200_000;
// How long New Entry waits on the overlay before it lets go and the engine carries on without it.
export const WAIT_MS = 90_000;
const MIN_TIMER_MS = 1_000;
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

let started = false;
let generation = 0;
let runningGeneration: number | null = null;
let runAgain = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let appActive = true;
let stopListening: (() => void) | null = null;
const listeners = new Set<(event: SyncEvent) => void>();

function log(message: string) {
  if (__DEV__) {
    console.log(`[sync] ${message}`);
  }
}

function emit(event: SyncEvent) {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A listener's failure must not stop the engine.
    }
  }
}

// Emits after every change to the outbox, and when an item finishes or stops. Returns the way to stop listening.
export function subscribe(listener: (event: SyncEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSyncEngineStarted(): boolean {
  return started;
}

function canRun(): boolean {
  return started && appActive && isDatabaseOpen() && selectCanSend(useOfflineStore.getState());
}

function clearTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

// Wakes the engine for the earliest retry, or the earliest end of a held-back week. Not while offline or in the background:
// coming back online and coming back to the app both start a run.
async function arm(gen: number): Promise<void> {
  clearTimer();
  if (!canRun()) return;
  try {
    const [retryAt, resetAt] = await Promise.all([outbox.nextAttemptAt(), outbox.earliestLimitReset()]);
    if (gen !== generation) return;
    const times = [retryAt, resetAt].filter((time): time is number => time !== null);
    if (times.length === 0) return;
    const wait = Math.min(Math.max(Math.min(...times) - Date.now(), MIN_TIMER_MS), MAX_TIMER_MS);
    timer = setTimeout(() => {
      timer = null;
      void onTimer(gen);
    }, wait);
  } catch {
    // The database closed.
  }
}

async function onTimer(gen: number): Promise<void> {
  if (gen !== generation) return;
  await resumeHeld(false);
  await syncNow("timer");
}

// What was held back goes back in the queue when whatever held it is over:
// - items the free limit held: when the plan this phone knows is paid (wherever the purchase was made: the profile sync
//   brings the server's plan), or when the week that held them ends;
// - items held for a refused session, but only when the app starts or comes to the front (`withAuth`): a refused session
//   is asked again once per visit, never on a timer.
async function resumeHeld(withAuth: boolean): Promise<void> {
  try {
    const now = Date.now();
    const tier = getKnownTier();
    const paid = tier === "trial" || tier === "pro";
    let resumed = withAuth ? await outbox.resumePausedAuth(now) : 0;
    resumed += paid ? await outbox.resumeLimitReached(now) : await outbox.resumeLimitReachedDue(now);
    if (resumed > 0) emit({ type: "changed" });
  } catch {
    // The database closed.
  }
}

// The processor, with a ceiling on how long it may take. It never rejects.
function runProcessor(item: OutboxItem): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const ceiling = setTimeout(() => resolve({ ok: false, code: "NETWORK" }), MAX_PROCESS_MS);
    processItem(item, (stage) => emit({ type: "stage", clientEntryId: item.clientEntryId, stage })).then(
      (outcome) => {
        clearTimeout(ceiling);
        resolve(outcome);
      },
      () => {
        clearTimeout(ceiling);
        resolve({ ok: false, code: "UNKNOWN" });
      },
    );
  });
}

async function applySuccess(item: OutboxItem, outcome: Extract<ProcessOutcome, { ok: true }>): Promise<void> {
  const id = item.clientEntryId;
  if (!processorIsMock) {
    await cache.upsertEntry(outcome.entry);
    await cache.upsertAffirmations(outcome.entry.id, outcome.affirmations);
  }
  await outbox.remove(id);
  if (item.inputType === "audio") await deleteRecording(id);
  markReachable();
  log("finished");
  emit({ type: "finished", clientEntryId: id, entryId: outcome.entry.id, isCrisis: outcome.entry.isCrisis });
  emit({ type: "changed" });
}

async function applyFailure(
  item: OutboxItem,
  code: string,
  entryId: string | null,
  resetsAt: string | null,
): Promise<void> {
  const id = item.clientEntryId;
  const now = Date.now();
  const attempts = item.attempts + 1;
  if (code === "NETWORK") markUnreachable();
  else markReachable();
  switch (classify(code)) {
    case "retry": {
      const delay = retryDelayMs(code, attempts);
      await outbox.markQueued(id, now + delay, code, now);
      log(`retry ${code}, attempt ${attempts}, in ${Math.round(delay / 1000)} s`);
      emit({ type: "settled", clientEntryId: id, status: "queued", code, entryId: null });
      break;
    }
    case "limit": {
      const at = resetsAt === null ? Number.NaN : Date.parse(resetsAt);
      await outbox.markLimitReached(id, entryId, Number.isFinite(at) ? at : null, now);
      log("held by the free limit");
      emit({ type: "settled", clientEntryId: id, status: "limit_reached", code, entryId });
      break;
    }
    case "pause_auth":
      await outbox.markPausedAuth(now);
      log("paused until the next sign-in");
      emit({ type: "settled", clientEntryId: id, status: "paused_auth", code, entryId: null });
      break;
    case "needs_action":
      await outbox.markNeedsAction(id, code, now);
      log(`needs the person: ${code}`);
      emit({ type: "settled", clientEntryId: id, status: "needs_action", code, entryId: null });
      break;
  }
  emit({ type: "changed" });
}

async function sendOne(item: OutboxItem, gen: number): Promise<void> {
  const id = item.clientEntryId;
  try {
    // Words that cannot be read (see outbox.toItem) can never be sent: the person has to look at it.
    if (item.inputType === "text" && item.text === null) {
      await applyFailure(item, "UNREADABLE", null, null);
      return;
    }
    if (!(await outbox.markSending(id, Date.now()))) return;
    emit({ type: "changed" });
    const outcome = await runProcessor({ ...item, attempts: item.attempts + 1, status: "sending" });
    if (gen !== generation) return;
    if (outcome.ok) await applySuccess(item, outcome);
    else await applyFailure(item, outcome.code, outcome.entryId ?? null, outcome.resetsAt ?? null);
  } catch {
    // Either the database closed (sign-out), which leaves nothing to update, or a write failed with the database still open.
    // Then the item must not stay "sending": it goes back in the queue, and a second send is harmless.
    if (gen === generation && isDatabaseOpen()) {
      try {
        const now = Date.now();
        await outbox.markQueued(id, now + retryDelayMs("UNKNOWN", item.attempts + 1), "UNKNOWN", now);
      } catch {
        // Nothing more can be done: the next start puts it back.
      }
    }
  }
}

async function drain(gen: number): Promise<void> {
  while (gen === generation && canRun()) {
    let item: OutboxItem | null;
    try {
      item = await outbox.nextDue(Date.now());
    } catch {
      return;
    }
    if (item === null) return;
    await sendOne(item, gen);
  }
}

// Runs the queue now. Safe to call from anywhere, at any time: while a run is going it only asks it to go round again.
export async function syncNow(reason: SyncReason): Promise<void> {
  if (!started) return;
  if (runningGeneration === generation) {
    runAgain = true;
    return;
  }
  const gen = generation;
  runningGeneration = gen;
  log(`run (${reason})`);
  try {
    do {
      runAgain = false;
      await drain(gen);
    } while (runAgain && gen === generation);
  } finally {
    if (runningGeneration === gen) runningGeneration = null;
  }
  if (gen === generation) await arm(gen);
}

async function begin(gen: number): Promise<void> {
  try {
    const now = Date.now();
    // The app was closed in the middle of a send, or while held back: those items go in the queue again.
    await outbox.resetSending(now);
    await resumeHeld(true);
    emit({ type: "changed" });
    void cleanOldRecordings();
  } catch {
    // The database closed while starting.
  }
  if (gen === generation) await syncNow("start");
}

// Idempotent. The auth bridge calls it once the user's database is open.
export function startSyncEngine(): void {
  if (started) return;
  started = true;
  generation += 1;
  const gen = generation;
  appActive = AppState.currentState === "active";
  const appState = AppState.addEventListener("change", (status) => {
    if (status === "active") {
      appActive = true;
      void resumeHeld(true).then(() => (gen === generation ? syncNow("foreground") : undefined));
    } else {
      appActive = false;
      clearTimer();
    }
  });
  let couldSend = selectCanSend(useOfflineStore.getState());
  const network = useOfflineStore.subscribe((state) => {
    const can = selectCanSend(state);
    if (can && !couldSend) void syncNow("online");
    couldSend = can;
  });
  stopListening = () => {
    appState.remove();
    network();
  };
  void begin(gen);
}

// Sign-out, or the user changed. Whatever is in the air is ignored when it lands.
export function stopSyncEngine(): void {
  started = false;
  generation += 1;
  clearTimer();
  stopListening?.();
  stopListening = null;
}

// The person deleted a refused reflection (Journal's Review), or chose to record it again: the item and its recording
// go, and the lists refresh.
export async function discardItem(clientEntryId: string): Promise<void> {
  try {
    await outbox.remove(clientEntryId);
  } catch {
    // The database closed (sign-out): there is nothing left to remove.
  }
  await deleteRecording(clientEntryId);
  emit({ type: "changed" });
}

// The plan may have changed (a purchase, a restore): what the free limit held back goes again, now, when the plan is
// paid. A call on the free plan changes nothing.
export async function resumeAfterUpgrade(): Promise<void> {
  if (!started) return;
  await resumeHeld(false);
  await syncNow("upgrade");
}

// New Entry: runs the queue and waits for what happens to this one item. It resolves when the item is finished or has
// stopped (a retry later, the free limit, a refused session, or something only the person can fix), or after WAIT_MS:
// then the engine goes on by itself and the screen lets go.
export function syncAndWait(
  clientEntryId: string,
  options: { onStage?: (stage: ProcessingStage) => void; waitMs?: number } = {},
): Promise<WaitResult> {
  return new Promise((resolve) => {
    let done = false;
    let stopWaiting: () => void = () => undefined;
    const finish = (result: WaitResult) => {
      if (done) return;
      done = true;
      clearTimeout(limit);
      stopWaiting();
      resolve(result);
    };
    const limit = setTimeout(() => finish({ kind: "later" }), options.waitMs ?? WAIT_MS);
    stopWaiting = subscribe((event) => {
      if (event.type === "stage" && event.clientEntryId === clientEntryId) {
        options.onStage?.(event.stage);
      } else if (event.type === "finished" && event.clientEntryId === clientEntryId) {
        finish({ kind: "ready", entryId: event.entryId, isCrisis: event.isCrisis });
      } else if (event.type === "settled" && event.clientEntryId === clientEntryId) {
        if (event.status === "needs_action") finish({ kind: "needs_action", code: event.code ?? "UNKNOWN" });
        else if (event.status === "limit_reached") finish({ kind: "limit", entryId: event.entryId });
        else finish({ kind: "later" });
      }
    });
    if (!started) finish({ kind: "later" });
    else void syncNow("submit");
  });
}
