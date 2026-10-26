import { confirmScripture } from "@/api/journalApi";
import { SCRIPTURE_RETRY_MS } from "@/constants/app";
import { rememberEntry } from "@/data/entriesLive";
import { getDataSource } from "@/data/mock/scenario";
import { selectIsOnline, useOfflineStore } from "@/store/offlineStore";
import type { JournalEntry, Scripture } from "@/types";

// A reflection whose passage the Bible could not be read for when it was made keeps the reference only, and the card says "We’re
// confirming this passage." (step 20). When such a reflection is opened, this asks the server to read the passage again
// (confirm-scripture) and shows what it answers: the verified text, a passage that is still unverified, or none (the reference
// turned out not to exist). It never shows a passage the server did not verify, and it never throws.

// When each reflection was last asked about, so that opening it again and again does not ask again and again. In memory only.
const asked = new Map<string, number>();

export function needsScriptureConfirmation(entry: JournalEntry): boolean {
  return entry.status === "ready" && !entry.isCrisis && entry.scripture !== null && !entry.scripture.verified;
}

function same(a: Scripture | null, b: Scripture | null): boolean {
  return a === b || (a !== null && b !== null && a.reference === b.reference && a.verified === b.verified && a.text === b.text);
}

export async function confirmScriptureIfNeeded(entry: JournalEntry, now: number = Date.now()): Promise<JournalEntry> {
  if (!needsScriptureConfirmation(entry)) return entry;
  // The mock data has no server, and a phone with no connection cannot ask.
  if (getDataSource() === "mock" || selectIsOnline(useOfflineStore.getState()) === false) return entry;
  const last = asked.get(entry.id);
  if (last !== undefined && now - last < SCRIPTURE_RETRY_MS) return entry;
  asked.set(entry.id, now);
  const result = await confirmScripture(entry.id);
  if (!result.ok) return entry;
  const { scripture } = result.data;
  if (same(entry.scripture, scripture)) return entry;
  const confirmed: JournalEntry = { ...entry, scripture };
  await rememberEntry(confirmed);
  return confirmed;
}
