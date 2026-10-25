// TEMP(25/29): internals move to Supabase and the SQLite read cache (built in step 24, filled by step 25). Keep the names and argument order; those steps widen some return types to RepoResult. The profile is real since step 17.
import {
  AMBIENT_SOUNDS,
  FREE_DEVOTIONALS_PER_WEEK,
  MAX_GRATITUDE_NOTE_LENGTH,
  WEEK_STARTS_ON,
} from "@/constants/app";
import { copy } from "@/constants/copy";
import { getDeviceTimezone, toAffirmation, toJournalEntry, toPrayer, toUserProfile } from "@/data/mappers";
import { addMockEntry, getMockDb } from "@/data/mock/db";
import {
  getProfileSource,
  takeMockNetworkFailure,
  takeMockPrayerMutationFailure,
  takeMockSubmitOutcome,
  type MockSubmitOutcome,
} from "@/data/mock/scenario";
import { toPendingEntry } from "@/data/pendingEntries";
import { isDatabaseOpen } from "@/db/database";
import * as outbox from "@/db/outbox";
import { scheduleProfileSync, syncProfile } from "@/services/profileSync";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type {
  Affirmation,
  HomeEntry,
  JournalEntry,
  MarkAnsweredInput,
  OutboxItem,
  PlanUsage,
  Prayer,
  ProcessEntryRequest,
  ProcessingStage,
  ProcessOutcome,
  ProfilePatch,
  RepoResult,
  SubscriptionTier,
  TimeSlot,
  UserProfile,
} from "@/types";
import type { JournalEntryRow } from "@/types/database";
import { answeredDateToTimestamp, isValidAnsweredDate } from "@/utils/prayerDates";

const SLOT_ORDER: readonly TimeSlot[] = ["morning", "afternoon", "evening"];

// Where the real server answers: a crisis check runs before the devotional, and the free limit is
// checked before any AI call, so those outcomes stop earlier.
const STAGES: Record<MockSubmitOutcome, readonly ProcessingStage[]> = {
  ready: ["receiving", "reflecting", "preparing"],
  crisis: ["receiving", "reflecting"],
  failed: ["receiving", "reflecting"],
  limit: ["receiving"],
  too_short: ["receiving"],
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

// The reminder times are the ones saved on this device, so an edit on Profile reaches the Journal's current
// slot and Reflection's times at once (the profile sync keeps them in step with users_profile).
function readMockProfile(): UserProfile {
  return {
    ...toUserProfile(getMockDb().profile),
    reminders: { ...useOnboardingStore.getState().reminders },
  };
}

// The signed-in user's profile as this device knows it: the sign-up date, the plan and the settings from the last sync,
// the settings changed since then (not yet sent) on top, and the reminder times from the onboarding store. Null until
// the first sync has finished.
function readLocalProfile(userId: string): UserProfile | null {
  const entry = useProfilePrefsStore.getState().byUser[userId];
  if (entry === undefined || entry.snapshot === null) return null;
  const { unsent, snapshot } = entry;
  return {
    id: userId,
    createdAt: snapshot.createdAt,
    subscriptionTier: snapshot.subscriptionTier,
    reminders: { ...useOnboardingStore.getState().reminders },
    timezone: getDeviceTimezone(),
    ambientSound: unsent.ambientSound ?? snapshot.ambientSound,
    ambientVolume: unsent.ambientVolume ?? snapshot.ambientVolume,
    affirmationsEnabled: unsent.affirmationsEnabled ?? snapshot.affirmationsEnabled,
  };
}

// Never waits for the network once the account has synced, so Journal, Reflection and Profile open offline and as
// fast as they did on the mock. The first call after sign-in waits for the sync the app already started (one request).
// Failing to read the profile at all throws: the hooks that call this already show their error state and retry on the
// next focus.
export async function getProfile(): Promise<UserProfile> {
  if (getProfileSource() === "mock") {
    await simulateLatency();
    return readMockProfile();
  }
  const userId = getSupabaseUserId();
  if (userId === null) throw new Error("There is no signed-in user.");
  const known = readLocalProfile(userId);
  if (known !== null) return known;
  // The sync saves the profile as soon as it has read the row, so even a sync that failed later (while sending an
  // edit) leaves one to show. Only a sync that could not read the row leaves nothing.
  await syncProfile();
  const afterSync = readLocalProfile(userId);
  if (afterSync === null) throw new Error(copy.profile.errors.load);
  return afterSync;
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

// A reflection that is still only on this phone has no server id: its id is its client entry id, and it is an entry
// that is not finished yet (Reflection shows "still being prepared"), never "not found" (step 24).
export async function getEntry(id: string): Promise<HomeEntry | null> {
  await simulateLatency();
  const found = readEntries().find((entry) => entry.id === id);
  if (found) return found;
  const item = await findPendingItem(id);
  return item === null ? null : toPendingEntry(item);
}

async function findPendingItem(clientEntryId: string): Promise<OutboxItem | null> {
  if (!isDatabaseOpen()) return null;
  try {
    return await outbox.get(clientEntryId);
  } catch {
    return null;
  }
}

// The reflections saved on this phone and not prepared yet, newest first. Empty while the database is not open, and when
// it cannot be read: Journal and Profile show what the server has either way.
export async function listPendingItems(): Promise<OutboxItem[]> {
  if (!isDatabaseOpen()) return [];
  try {
    return await outbox.listPending();
  } catch {
    return [];
  }
}

// How many reflections signing out would lose: the ones the server has never been given. 0 while the database is not open.
export async function countUnsentItems(): Promise<number> {
  if (!isDatabaseOpen()) return 0;
  try {
    return await outbox.countUnsent();
  } catch {
    return 0;
  }
}

// The plan as this device knows it, with no waiting. The sync engine uses it to send what the free limit held back as soon
// as the plan is paid, wherever the purchase was made. A mock purchase counts first, because the screens show the mock
// plan until step 30 (TEMP(30)); otherwise it is the plan the last profile sync read, or null before the first sync.
export function getKnownTier(): SubscriptionTier | null {
  const mock = getMockSubscriptionTier();
  if (mock !== "free" || getProfileSource() === "mock") return mock;
  const userId = getSupabaseUserId();
  return userId === null ? null : (readLocalProfile(userId)?.subscriptionTier ?? null);
}

// The prayer of every mapped entry that has one, so a prayer never disagrees with its entry.
// Newest first; step 14 selectors filter and sort.
export async function listPrayers(): Promise<Prayer[]> {
  await simulateLatency();
  return readEntries().flatMap((entry) => (entry.prayer ? [entry.prayer] : []));
}

// A write waits a little here, so a sheet or a dialog shows its spinner. The prayer writes, the profile write and
// the account requests (services/account.ts) share it. Steps 17, 29 and 31 replace the mocks with real calls.
const PRAYER_CHANGE_MS = 500;
const PROFILE_CHANGE_MS = 600;

export function simulateWrite(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failure(
  code: "NOT_FOUND" | "INVALID" | "NETWORK" | "UNAUTHORIZED",
  message: string,
): RepoResult<never> {
  return { ok: false, code, message };
}

// The row of a tracked prayer. A missing row, a crisis entry, an entry that is not finished and an entry that
// is not a prayer all come back null (toPrayer says no to each), and are never changed.
function findPrayerRow(prayerId: string): JournalEntryRow | null {
  const row = getMockDb().entries.find((entry) => entry.id === prayerId);
  return row !== undefined && toPrayer(row) !== null ? row : null;
}

function prayerResult(row: JournalEntryRow): RepoResult<Prayer> {
  const prayer = toPrayer(row);
  return prayer === null
    ? failure("NOT_FOUND", copy.prayers.errors.save)
    : { ok: true, data: prayer };
}

// A note is trimmed, and an empty one is no note.
function cleanNote(note: string | null): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

// TEMP(29): replace internals with SQLite + Supabase, keep signatures
export async function markPrayerAnswered(input: MarkAnsweredInput): Promise<RepoResult<Prayer>> {
  await simulateWrite(PRAYER_CHANGE_MS);
  if (takeMockPrayerMutationFailure()) return failure("NETWORK", copy.prayers.errors.save);
  const row = findPrayerRow(input.prayerId);
  if (row === null) return failure("NOT_FOUND", copy.prayers.errors.save);
  const answeredAt = answeredDateToTimestamp(input.answeredDate);
  if (answeredAt === null || !isValidAnsweredDate(input.answeredDate, row.created_at, new Date())) {
    return failure("INVALID", copy.prayers.errors.date);
  }
  const note = cleanNote(input.note);
  if (note !== null && note.length > MAX_GRATITUDE_NOTE_LENGTH) {
    return failure("INVALID", copy.prayers.errors.save);
  }
  row.is_active_prayer = true;
  row.is_answered = true;
  row.answered_at = answeredAt;
  row.answered_notes = note;
  row.updated_at = new Date().toISOString();
  return prayerResult(row);
}

// Back to Active. Unmarking an open prayer changes nothing and answers ok.
// TEMP(29): replace internals with SQLite + Supabase, keep signatures
export async function unmarkPrayerAnswered(prayerId: string): Promise<RepoResult<Prayer>> {
  await simulateWrite(PRAYER_CHANGE_MS);
  if (takeMockPrayerMutationFailure()) return failure("NETWORK", copy.prayers.errors.save);
  const row = findPrayerRow(prayerId);
  if (row === null) return failure("NOT_FOUND", copy.prayers.errors.save);
  if (row.is_answered === true) {
    // It stays a tracked prayer: without is_active_prayer, toPrayer would drop it from both tabs.
    row.is_active_prayer = true;
    row.is_answered = false;
    row.answered_at = null;
    row.answered_notes = null;
    row.updated_at = new Date().toISOString();
  }
  return prayerResult(row);
}

// TEMP(29): replace internals with SQLite + Supabase, keep signatures
export async function updateAnsweredNote(
  prayerId: string,
  note: string | null,
): Promise<RepoResult<Prayer>> {
  await simulateWrite(PRAYER_CHANGE_MS);
  if (takeMockPrayerMutationFailure()) return failure("NETWORK", copy.prayers.errors.save);
  const row = findPrayerRow(prayerId);
  if (row === null) return failure("NOT_FOUND", copy.prayers.errors.save);
  const cleaned = cleanNote(note);
  if (row.is_answered !== true || (cleaned !== null && cleaned.length > MAX_GRATITUDE_NOTE_LENGTH)) {
    return failure("INVALID", copy.prayers.errors.save);
  }
  row.answered_notes = cleaned;
  row.updated_at = new Date().toISOString();
  return prayerResult(row);
}

// The same checks in both modes: an unknown sound or a volume that is not a number is INVALID, and a volume
// outside 0..1 is clamped. An empty patch is fine.
function checkProfilePatch(patch: ProfilePatch): RepoResult<ProfilePatch> {
  const { affirmationsEnabled, ambientSound, ambientVolume } = patch;
  if (affirmationsEnabled !== undefined && typeof affirmationsEnabled !== "boolean") {
    return failure("INVALID", copy.profile.errors.save);
  }
  if (ambientSound !== undefined && !AMBIENT_SOUNDS.includes(ambientSound)) {
    return failure("INVALID", copy.profile.errors.save);
  }
  if (ambientVolume !== undefined && !Number.isFinite(ambientVolume)) {
    return failure("INVALID", copy.profile.errors.save);
  }
  const clean: ProfilePatch = {};
  if (affirmationsEnabled !== undefined) clean.affirmationsEnabled = affirmationsEnabled;
  if (ambientSound !== undefined) clean.ambientSound = ambientSound;
  if (ambientVolume !== undefined) clean.ambientVolume = Math.min(1, Math.max(0, ambientVolume));
  return { ok: true, data: clean };
}

// Saves what Profile can change. Same order as the prayer writes: wait (mock only), the dev failure flag, validate,
// write. The mock mode writes the mock row. Otherwise the change is kept on this device as an unsent edit for the
// signed-in user and a sync sends it to users_profile 800 ms later, so it also works offline (step 18).
export async function updateProfile(patch: ProfilePatch): Promise<RepoResult<UserProfile>> {
  const isMock = getProfileSource() === "mock";
  if (isMock) await simulateWrite(PROFILE_CHANGE_MS);
  if (takeMockPrayerMutationFailure()) return failure("NETWORK", copy.profile.errors.save);
  const checked = checkProfilePatch(patch);
  if (!checked.ok) return checked;
  const clean = checked.data;
  if (isMock) {
    const row = getMockDb().profile;
    if (clean.affirmationsEnabled !== undefined) row.affirmations_enabled = clean.affirmationsEnabled;
    if (clean.ambientSound !== undefined) row.ambient_sound = clean.ambientSound;
    if (clean.ambientVolume !== undefined) row.ambient_volume = clean.ambientVolume;
    if (Object.keys(clean).length > 0) row.updated_at = new Date().toISOString();
    return { ok: true, data: readMockProfile() };
  }
  const userId = getSupabaseUserId();
  if (userId === null) return failure("UNAUTHORIZED", copy.profile.errors.save);
  useProfilePrefsStore.getState().saveUnsent(userId, clean);
  scheduleProfileSync();
  const saved = readLocalProfile(userId);
  return saved === null ? failure("NOT_FOUND", copy.profile.errors.save) : { ok: true, data: saved };
}

// The dev panel and step 16's purchase mock (services/purchases.ts) change the tier to reach the trial and Pro
// states; the mock submit reads it, because a paid plan never hits the free limit.
// TEMP(30): the RevenueCat webhook sets the tier on the server; delete both
export function setMockSubscriptionTier(tier: SubscriptionTier): void {
  getMockDb().profile.subscription_tier = tier;
}

export function getMockSubscriptionTier(): SubscriptionTier {
  return toUserProfile(getMockDb().profile).subscriptionTier;
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

// What the mock database needs of an outbox item. It reads the words of a written entry and nothing else.
function toMockRequest(item: OutboxItem): ProcessEntryRequest {
  if (item.inputType === "text") {
    return { clientEntryId: item.clientEntryId, inputType: "text", text: item.text ?? "" };
  }
  return {
    clientEntryId: item.clientEntryId,
    inputType: "audio",
    audioPath: "",
    durationMs: item.durationMs ?? 0,
    mimeType: item.mimeType ?? "audio/mp4",
  };
}

// TEMP(25): the real processor uploads the recording and calls process-entry (services/entryProcessor.ts)
// A mock run for the sync engine: it reports each stage 1.2 s apart, then answers with what the dev store asked for (one
// shot, see takeMockSubmitOutcome), or with no answer at all when the dev panel failed the network. A finished or crisis
// outcome adds an entry to the mock database and answers with it, as the server does.
export async function processMock(
  item: OutboxItem,
  onStage: (stage: ProcessingStage) => void,
): Promise<ProcessOutcome> {
  if (takeMockNetworkFailure()) {
    onStage("receiving");
    await new Promise((resolve) => setTimeout(resolve, STAGE_MS));
    return { ok: false, code: "NETWORK" };
  }
  const taken = takeMockSubmitOutcome();
  // A paid plan never hits the free limit, so there a "limit" run finishes like a normal one.
  const outcome = taken === "limit" && getMockSubscriptionTier() !== "free" ? "ready" : taken;
  // The outcome is never logged: a crisis outcome must leave no log line (AGENTS.md Crisis Safety Rules).
  for (const stage of STAGES[outcome]) {
    if (__DEV__) console.log(`[process] stage ${stage}`);
    onStage(stage);
    await new Promise((resolve) => setTimeout(resolve, STAGE_MS));
  }
  switch (outcome) {
    case "ready":
    case "crisis": {
      const entryId = addMockEntry(outcome, toMockRequest(item));
      const entry = readEntries().find((candidate) => candidate.id === entryId);
      if (entry === undefined) return { ok: false, code: "INTERNAL" };
      return { ok: true, entry, affirmations: readAffirmations(entryId) };
    }
    case "failed":
      return { ok: false, code: "AI_UNAVAILABLE" };
    case "too_short":
      return { ok: false, code: "TOO_SHORT" };
    case "limit":
      // TODO(25): the 402 body carries the entry the server saved (entryId) and usage.resetsAt
      return { ok: false, code: "LIMIT_REACHED", resetsAt: nextWeekStart(new Date()).toISOString() };
  }
}
