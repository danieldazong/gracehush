// TEMP(17/24/25/29): internals move to Supabase and the SQLite cache. Keep the names and argument order; those steps widen some return types to RepoResult.
import { FREE_DEVOTIONALS_PER_WEEK, WEEK_STARTS_ON } from "@/constants/app";
import { toAffirmation, toJournalEntry, toUserProfile } from "@/data/mappers";
import { addMockEntry, getMockDb } from "@/data/mock/db";
import { takeMockSubmitOutcome, type MockSubmitOutcome } from "@/data/mock/scenario";
import type {
  Affirmation,
  JournalEntry,
  PlanUsage,
  Prayer,
  ProcessEntryRequest,
  ProcessingStage,
  SubmitResult,
  TimeSlot,
  UserProfile,
} from "@/types";

const SLOT_ORDER: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

// Where the real server answers: a crisis check runs before the devotional, and the free limit is
// checked before any AI call, so those outcomes stop earlier.
const STAGES: Record<MockSubmitOutcome, readonly ProcessingStage[]> = {
  ready: ["receiving", "reflecting", "preparing"],
  crisis: ["receiving", "reflecting"],
  failed: ["receiving", "reflecting"],
  limit: ["receiving"],
};
const STAGE_MS = 1200;

// Simulates the network in dev so screens show their loading state.
function simulateLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, __DEV__ ? 300 : 0));
}

// Freshly mapped on every call, so a screen can never change the rows by accident.
function readEntries(): JournalEntry[] {
  return getMockDb()
    .entries.map(toJournalEntry)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function readAffirmations(entryId: string): Affirmation[] {
  const { entries, affirmations } = getMockDb();
  // Safety net: a crisis entry never has affirmations, whatever the rows hold.
  if (entries.find((row) => row.id === entryId)?.is_crisis === true) return [];
  return affirmations
    .filter((row) => row.entry_id === entryId)
    .map(toAffirmation)
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}

// The next week start at 00:00 local. When today is that day, it is a week away.
function nextWeekStart(now: Date): Date {
  const daysUntil = (WEEK_STARTS_ON - now.getDay() + 7) % 7 || 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil);
}

export async function getProfile(): Promise<UserProfile> {
  await simulateLatency();
  return toUserProfile(getMockDb().profile);
}

export async function getUsage(): Promise<PlanUsage> {
  await simulateLatency();
  const { subscriptionTier: tier } = toUserProfile(getMockDb().profile);
  const resetsAt = nextWeekStart(new Date()).toISOString();
  // Fixed mock data (the Profile design's "2 of 3 audio devotionals used this week"), not counted
  // from the entries, which would give a different number on each weekday. Both paid tiers are unlimited.
  return tier === "free"
    ? { tier, used: 2, limit: FREE_DEVOTIONALS_PER_WEEK, resetsAt }
    : { tier, used: 0, limit: null, resetsAt };
}

// Newest first, every status included.
export async function listEntries(): Promise<JournalEntry[]> {
  await simulateLatency();
  return readEntries();
}

export async function getEntry(id: string): Promise<JournalEntry | null> {
  await simulateLatency();
  return readEntries().find((entry) => entry.id === id) ?? null;
}

// The prayer of every mapped entry that has one, so a prayer never disagrees with its entry.
// Newest first; step 14 selectors filter and sort.
export async function listPrayers(): Promise<Prayer[]> {
  await simulateLatency();
  return readEntries().flatMap((entry) => (entry.prayer ? [entry.prayer] : []));
}

// Ordered morning, afternoon, evening.
export async function listAffirmationsForEntry(entryId: string): Promise<Affirmation[]> {
  await simulateLatency();
  return readAffirmations(entryId);
}

// From the newest ready, non-crisis entry.
export async function getLatestAffirmations(): Promise<Affirmation[]> {
  await simulateLatency();
  const latest = readEntries().find((entry) => entry.status === "ready" && !entry.isCrisis);
  return latest ? readAffirmations(latest.id) : [];
}

// TEMP(25): call process-entry via api/journalApi.ts
// A mock run: it reports each stage 1.2 s apart, then answers with what the dev store asked for (one
// shot, see takeMockSubmitOutcome). A finished or crisis outcome adds an entry to the mock database.
export async function submitEntry(
  req: ProcessEntryRequest,
  onStage: (stage: ProcessingStage) => void,
): Promise<SubmitResult> {
  const outcome = takeMockSubmitOutcome();
  if (__DEV__) console.log(`[submitEntry] outcome ${outcome}`);
  for (const stage of STAGES[outcome]) {
    if (__DEV__) console.log(`[submitEntry] stage ${stage}`);
    onStage(stage);
    await new Promise((resolve) => setTimeout(resolve, STAGE_MS));
  }
  switch (outcome) {
    case "ready":
      return { kind: "ready", entryId: addMockEntry("ready", req) };
    case "crisis":
      return { kind: "crisis", entryId: addMockEntry("crisis", req) };
    case "failed":
      return { kind: "error", code: "AI_UNAVAILABLE" };
    case "limit":
      return { kind: "error", code: "LIMIT_REACHED" };
  }
}
