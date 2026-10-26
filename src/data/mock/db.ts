import { buildAffirmations } from "@/data/mock/affirmations";
import {
  ANXIOUS_ENTRY_ID,
  buildEntries,
  buildOfflineEntries,
  CRISIS_ENTRY_ID,
} from "@/data/mock/entries";
import { getMockScenario, type MockScenario } from "@/data/mock/scenario";
import { buildProfile } from "@/data/mock/users";
import type { ProcessEntryRequest } from "@/types";
import type { DailyAffirmationRow, JournalEntryRow, UserProfileRow } from "@/types/database";

// Only code inside src/data/ imports this. Steps 10 (a successful submit adds an entry), 14 (Mark
// Answered), 15 (updateProfile) and 16 (the purchase mock changes the tier) mutate it, so changes show
// across screens for the rest of the session.
interface MockDb {
  profile: UserProfileRow;
  entries: JournalEntryRow[];
  affirmations: DailyAffirmationRow[];
}

export function buildFixtures(now: Date, scenario: MockScenario = getMockScenario()): MockDb {
  const profile = buildProfile(now);
  if (scenario === "empty") return { profile, entries: [], affirmations: [] };
  const entries = buildEntries(now);
  if (scenario === "offline") entries.push(...buildOfflineEntries(now));
  return { profile, entries, affirmations: buildAffirmations(entries) };
}

let mockDb: MockDb | null = null;
let builtFor: MockScenario | null = null;

// Built on first use, never at import time, and rebuilt when the scenario changes.
export function getMockDb(): MockDb {
  const scenario = getMockScenario();
  if (mockDb === null || builtFor !== scenario) {
    mockDb = buildFixtures(new Date(), scenario);
    builtFor = scenario;
  }
  return mockDb;
}

// The mock data's stand-in for the server (data source "mock"): the server creates the entry. Here a finished (or crisis)
// fixture is cloned under a new id, so Journal and Reflection have something to show after a submit. Like the server it is
// idempotent on client_entry_id: a retried submit never adds a second row.
export function addMockEntry(kind: "ready" | "crisis", req: ProcessEntryRequest): string {
  const db = getMockDb();
  const existing = db.entries.find((row) => row.client_entry_id === req.clientEntryId);
  if (existing) return existing.id;

  const now = new Date();
  const created = now.toISOString();
  const fixtures = buildEntries(now);
  const templateId = kind === "crisis" ? CRISIS_ENTRY_ID : ANXIOUS_ENTRY_ID;
  const template = fixtures.find((row) => row.id === templateId);
  if (!template) {
    throw new Error(`The mock fixtures have no ${templateId} entry to clone`);
  }

  const id = `entry-new-${req.clientEntryId}`;
  db.entries.push({
    ...template,
    id,
    created_at: created,
    updated_at: created,
    client_entry_id: req.clientEntryId,
    input_type: req.inputType,
    // What was written becomes the transcript, so Journal quotes it. It lives only in this in-memory mock.
    transcript: req.inputType === "text" ? req.text : template.transcript,
    // A clone is not a tracked prayer, so the Prayers counts do not change.
    is_active_prayer: false,
    prayer_title: null,
    prayer_category: null,
    prayer_summary: null,
    is_answered: false,
    answered_at: null,
    answered_notes: null,
  });
  if (kind === "ready") {
    // The newest ready entry owns the affirmations Journal shows, so it gets the three rows too.
    db.affirmations.push(
      ...buildAffirmations(fixtures).map((row) => ({
        ...row,
        id: `affirmation-${id}-${row.time_slot}`,
        entry_id: id,
        created_at: created,
      })),
    );
  }
  return id;
}
