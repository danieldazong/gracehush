import { REALTIME_COALESCE_MS } from "@/constants/app";
import { fetchAffirmations, fetchEntry, forgetEntry } from "@/data/entriesLive";
import { readCachedEntry } from "@/data/journalRepository";
import * as outbox from "@/db/outbox";
import { requestAffirmationReschedule } from "@/services/affirmationScheduler";
import { forgetOnThisPhone } from "@/services/entryDeletion";
import type { RealtimeEvent } from "@/services/realtime";
import { syncNow } from "@/services/syncEngine";
import { usePlayerStore } from "@/store/playerStore";
import type { AffirmationsChangedMessage, EntryChangedMessage, JournalEntry } from "@/types";
import { normalizeTimestamp } from "@/utils/timestamp";

// What a Realtime message makes this phone do (step 33). A message says only that an entry, or an entry's affirmations, changed
// on the server; the phone reads the row itself, through the same live data layer the screens use (the network, this phone's
// waiting prayer changes on top, written to the read cache), and then tells the screens. Realtime runs only on the real data
// source, so the cache and the network here are the real ones.
//
// The app's own changes come back as messages too (a prayer change, a heart, a delete), and they cost nothing the second time: a
// message that is not newer than the cached entry is skipped, and a delete of an entry the phone no longer holds does nothing.

// The channel a message came on. `isCurrent` turns false once that channel has gone (a stop, a pause, a channel that failed): from
// then on nothing is read, written or told.
export type HandlerContext = {
  isCurrent: () => boolean;
  emit: (event: RealtimeEvent) => void;
};

// One entry's messages: they are read once, REALTIME_COALESCE_MS after the last of a burst, one read at a time.
type EntrySlot = {
  timer: ReturnType<typeof setTimeout> | null;
  reading: boolean;
  // A message came while a read was on its way: one more read follows it.
  again: boolean;
  // The latest updated_at the messages carried, in milliseconds (Infinity when one carried none: it is always read).
  newest: number;
  // INSERT when any message of the burst was one.
  op: "INSERT" | "UPDATE";
  // A delete came while a read was on its way: what that read brings is forgotten again.
  deleted: boolean;
  context: HandlerContext;
};

type AffirmationSlot = {
  timer: ReturnType<typeof setTimeout> | null;
  reading: boolean;
  again: boolean;
  context: HandlerContext;
};

const entrySlots = new Map<string, EntrySlot>();
const affirmationSlots = new Map<string, AffirmationSlot>();

// A server time in milliseconds, compared in the step 25 canonical form; Infinity when there is none or it cannot be read, so a
// message without one is always read.
function messageTime(text: string | null): number {
  if (text === null) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(normalizeTimestamp(text));
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function loadedInPlayer(entryId: string): boolean {
  try {
    return usePlayerStore.getState().entryId === entryId;
  } catch {
    return false;
  }
}

// The sync engine writes the server's answer for an entry it is sending itself, so a read here could only race it.
async function isBeingSent(entry: JournalEntry): Promise<boolean> {
  if (entry.clientEntryId === null) return false;
  try {
    return (await outbox.get(entry.clientEntryId))?.status === "sending";
  } catch {
    return false;
  }
}

// A reflection this phone stopped waiting for (its outbox item is queued, with a retry far off) has finished on the server: the
// item is sent again now, and the server answers the finished row with no model call, so the waiting card turns into it.
async function wakeQueued(clientEntryId: string | null): Promise<void> {
  if (clientEntryId === null) return;
  let moved = false;
  try {
    moved = await outbox.makeDue(clientEntryId, Date.now());
  } catch {
    return;
  }
  if (moved) void syncNow("realtime");
}

// The entry is gone from the server: this phone forgets it, as after its own delete (step 29b), and the screens are told.
async function forget(entryId: string, context: HandlerContext): Promise<void> {
  if (!context.isCurrent()) return;
  await forgetEntry(entryId);
  if (!context.isCurrent()) return;
  forgetOnThisPhone(entryId);
  context.emit({ type: "entry", entryId, op: "DELETE" });
}

async function forgetIfHeld(entryId: string, context: HandlerContext): Promise<void> {
  try {
    const cached = await readCachedEntry(entryId);
    if (!context.isCurrent()) return;
    // This phone's own delete coming back, or an entry it never had: nothing to do.
    if (cached === null && !loadedInPlayer(entryId)) return;
    await forget(entryId, context);
  } catch {
    // Nothing more: the screens load from the server when they open.
  }
}

async function reactToEntry(entryId: string, slot: EntrySlot): Promise<void> {
  const { context, op } = slot;
  const cached = await readCachedEntry(entryId);
  if (!context.isCurrent()) return;
  if (cached !== null) {
    const cachedAt = Date.parse(normalizeTimestamp(cached.updatedAt));
    if (Number.isFinite(cachedAt) && cachedAt >= slot.newest) {
      // Nothing newer than what the phone holds (often this phone's own change coming back). A finished reflection whose outbox
      // item still waits is sent again all the same.
      if (cached.status === "ready") await wakeQueued(cached.clientEntryId);
      return;
    }
    if (await isBeingSent(cached)) return;
  }
  const held = cached !== null || loadedInPlayer(entryId);
  const entry = await fetchEntry(entryId, context.isCurrent);
  if (!context.isCurrent()) return;
  if (slot.deleted) {
    // A delete came while this read was on its way: what it brought is forgotten again, and the delete has told the screens.
    await forgetEntry(entryId);
    return;
  }
  if (entry === null) {
    // The server no longer has it: the same as a delete.
    if (held) await forget(entryId, context);
    return;
  }
  if (entry.status === "ready" && cached?.status !== "ready") {
    // Newly finished. Its affirmations come before the notifications are planned again (a crisis entry has none), because the
    // two kinds of message can arrive in either order.
    if (!entry.isCrisis) {
      try {
        await fetchAffirmations(entryId, context.isCurrent);
      } catch {
        // The notifications are planned from what the phone has; the next load brings the affirmations.
      }
      if (!context.isCurrent()) return;
    }
    requestAffirmationReschedule();
    await wakeQueued(entry.clientEntryId);
    if (!context.isCurrent()) return;
  }
  context.emit({ type: "entry", entryId, op });
}

async function readEntry(entryId: string, slot: EntrySlot): Promise<void> {
  slot.timer = null;
  if (!slot.context.isCurrent()) {
    if (entrySlots.get(entryId) === slot) entrySlots.delete(entryId);
    return;
  }
  slot.reading = true;
  slot.again = false;
  try {
    await reactToEntry(entryId, slot);
  } catch {
    // No answer and nothing cached: the next message about it, or the screens' own load, brings it.
  } finally {
    slot.reading = false;
    if (slot.again && !slot.deleted && slot.context.isCurrent() && entrySlots.get(entryId) === slot) {
      scheduleEntry(entryId, slot);
    } else if (entrySlots.get(entryId) === slot) {
      entrySlots.delete(entryId);
    }
  }
}

function scheduleEntry(entryId: string, slot: EntrySlot): void {
  if (slot.timer !== null) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => void readEntry(entryId, slot), REALTIME_COALESCE_MS);
}

// entry_changed: a DELETE forgets the entry when the phone holds it; an INSERT or an UPDATE reads it, once per burst.
export function handleEntryChanged(message: EntryChangedMessage, context: HandlerContext): void {
  const entryId = message.id;
  if (message.op === "DELETE") {
    const slot = entrySlots.get(entryId);
    if (slot !== undefined) {
      if (slot.timer !== null) clearTimeout(slot.timer);
      slot.timer = null;
      slot.deleted = true;
      if (!slot.reading) entrySlots.delete(entryId);
    }
    void forgetIfHeld(entryId, context);
    return;
  }
  const at = messageTime(message.updated_at);
  let slot = entrySlots.get(entryId);
  if (slot === undefined) {
    slot = { timer: null, reading: false, again: false, newest: at, op: message.op, deleted: false, context };
    entrySlots.set(entryId, slot);
  } else {
    slot.newest = Math.max(slot.newest, at);
    if (message.op === "INSERT") slot.op = "INSERT";
    slot.context = context;
  }
  if (slot.reading) {
    slot.again = true;
    return;
  }
  scheduleEntry(entryId, slot);
}

async function readAffirmations(entryId: string, slot: AffirmationSlot): Promise<void> {
  slot.timer = null;
  const { context } = slot;
  slot.reading = true;
  slot.again = false;
  try {
    if (!context.isCurrent()) return;
    await fetchAffirmations(entryId, context.isCurrent);
    if (!context.isCurrent()) return;
    requestAffirmationReschedule();
    context.emit({ type: "affirmations", entryId });
  } catch {
    // No answer: the next message, or the screens' own load, brings them.
  } finally {
    slot.reading = false;
    if (slot.again && slot.context.isCurrent() && affirmationSlots.get(entryId) === slot) {
      scheduleAffirmations(entryId, slot);
    } else if (affirmationSlots.get(entryId) === slot) {
      affirmationSlots.delete(entryId);
    }
  }
}

function scheduleAffirmations(entryId: string, slot: AffirmationSlot): void {
  if (slot.timer !== null) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => void readAffirmations(entryId, slot), REALTIME_COALESCE_MS);
}

// affirmations_changed: the entry's affirmations are read once per burst, then the notifications are planned again.
export function handleAffirmationsChanged(message: AffirmationsChangedMessage, context: HandlerContext): void {
  const entryId = message.entry_id;
  let slot = affirmationSlots.get(entryId);
  if (slot === undefined) {
    slot = { timer: null, reading: false, again: false, context };
    affirmationSlots.set(entryId, slot);
  } else {
    slot.context = context;
  }
  if (slot.reading) {
    slot.again = true;
    return;
  }
  scheduleAffirmations(entryId, slot);
}

// Every read that waits is dropped (Realtime stopped, paused or lost its channel). A read already on its way finishes, writes
// nothing and tells nobody: its channel is no longer current.
export function resetHandlers(): void {
  for (const slot of entrySlots.values()) if (slot.timer !== null) clearTimeout(slot.timer);
  for (const slot of affirmationSlots.values()) if (slot.timer !== null) clearTimeout(slot.timer);
  entrySlots.clear();
  affirmationSlots.clear();
}
