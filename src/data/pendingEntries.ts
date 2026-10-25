import type { HomeEntry, JournalEntry, OutboxItem } from "@/types";

// How an outbox item shows on Journal Home (step 24): as an entry-shaped card, so the offline banner's count, the filters
// and the streak keep working as they are. It carries no words (a pending card never shows what was written or said: the
// screen can be seen by someone else) and no scripture, devotional or prayer. `id` is the client entry id: the entry has no
// server id yet, and a card that opens nothing needs only a stable key.
//
// sending            -> the "preparing" card (status processing)
// needs_action       -> the "failed" card, with Review
// everything else    -> the "waiting" card (status pending): queued, held back by the free limit, or waiting for a sign-in
export function toPendingEntry(item: OutboxItem): HomeEntry {
  const created = new Date(item.createdAt).toISOString();
  return {
    id: item.clientEntryId,
    clientEntryId: item.clientEntryId,
    createdAt: created,
    updatedAt: created,
    inputType: item.inputType,
    transcript: null,
    dominantEmotion: null,
    status: item.status === "sending" ? "processing" : item.status === "needs_action" ? "failed" : "pending",
    isCrisis: false,
    scripture: null,
    devotional: null,
    prayer: null,
    failureCode: null,
    isLocalOnly: true,
    pending: {
      status: item.status,
      lastErrorCode: item.lastErrorCode,
      serverEntryId: item.serverEntryId,
      resetsAt: item.limitResetsAt === null ? null : new Date(item.limitResetsAt).toISOString(),
    },
  };
}

// The pending cards first, newest first overall. An entry that has the same client entry id as a pending item is the
// server's copy of that same reflection (it was claimed, or it finished while the item was still being settled): the
// pending card wins while it exists, so one reflection is never listed twice.
export function mergePending(entries: readonly JournalEntry[], pending: readonly HomeEntry[]): HomeEntry[] {
  const unsent = new Set(pending.map((entry) => entry.clientEntryId));
  const rest = entries.filter((entry) => entry.clientEntryId === null || !unsent.has(entry.clientEntryId));
  return [...pending, ...rest].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
