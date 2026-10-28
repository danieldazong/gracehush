// TEMP(29): the prayer writes are mocks until step 29 replaces them. The profile (step 17), and the entries, the affirmations and the usage (step 25), are real: they come from Supabase through the read cache of step 24, unless the data source is the mock (a development switch). Keep the names and argument order.
import {
  AMBIENT_SOUNDS,
  FREE_DEVOTIONALS_PER_WEEK,
  MAX_GRATITUDE_NOTE_LENGTH,
  WEEK_STARTS_ON,
} from "@/constants/app";
import { copy } from "@/constants/copy";
import * as live from "@/data/entriesLive";
import { getDeviceTimezone, toAffirmation, toJournalEntry, toPrayer, toUserProfile } from "@/data/mappers";
import { addMockEntry, getMockDb } from "@/data/mock/db";
import {
  getDataSource,
  getEntriesPageSize,
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
  AffirmationSource,
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
import { weekWindow } from "@/utils/week";

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
  if (getDataSource() === "mock") {
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

// What Profile and the Paywall show of the plan. The mock data says what the Profile design says ("2 of 3 audio devotionals
// used this week"). Otherwise the plan is the one this device knows (getKnownTier), and on the free plan the count is of the
// devotionals this phone has this week, in the time zone of the profile and with the week the server uses (utils/week.ts):
// it needs no network, so Profile opens offline. It is a number to show and nothing more. Only the server's 402 opens the
// Paywall, because only the server counts every device.
export async function getUsage(): Promise<PlanUsage> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    const { subscriptionTier: tier } = toUserProfile(getMockDb().profile);
    const resetsAt = nextWeekStart(new Date()).toISOString();
    // Fixed mock data, not counted from the entries, which would give a different number on each weekday. Both paid tiers are
    // unlimited.
    return tier === "free"
      ? { tier, used: 2, limit: FREE_DEVOTIONALS_PER_WEEK, resetsAt }
      : { tier, used: 0, limit: null, resetsAt };
  }
  const tier = getKnownTier() ?? "free";
  const zone = await getProfile().then(
    (profile) => profile.timezone,
    () => getDeviceTimezone(),
  );
  const week = weekWindow(new Date(), zone);
  const resetsAt = week.end.toISOString();
  if (tier !== "free") return { tier, used: 0, limit: null, resetsAt };
  // A person who was paying earlier in the week and lapsed can have made more than the limit: the card shows the limit.
  const made = await live.countDevotionalsSince(week.start);
  return { tier, used: Math.min(made, FREE_DEVOTIONALS_PER_WEEK), limit: FREE_DEVOTIONALS_PER_WEEK, resetsAt };
}

// What this phone has, newest first: Profile counts it and the developer panel reads it. The mock data: every entry, every
// status. The real source: the entries the Journal lists, from the read cache.
export async function listEntries(): Promise<JournalEntry[]> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    return readEntries();
  }
  return live.readCachedEntries();
}

// The first thing Journal Home and Reflection show is what the phone already has, so these read the read cache and nothing
// else (step 25). The mock data has no cache: they answer nothing, and the screens go straight to the mock reads below.
export async function readCachedEntries(): Promise<JournalEntry[]> {
  return getDataSource() === "mock" ? [] : live.readCachedEntries(getEntriesPageSize());
}

export async function readCachedEntry(id: string): Promise<JournalEntry | null> {
  return getDataSource() === "mock" ? null : live.readCachedEntry(id);
}

export async function readCachedAffirmations(entryId: string): Promise<Affirmation[]> {
  return getDataSource() === "mock" ? [] : live.readCachedAffirmations(entryId);
}

export async function readCachedLatestAffirmations(): Promise<Affirmation[]> {
  return getDataSource() === "mock" ? [] : live.readCachedLatestAffirmations();
}

// What the affirmation notifications are made from (step 28): the newest finished entry this phone has, a crisis entry
// included (so that nothing is scheduled after one), with its affirmations when it is not one. Null when there is none. It
// reads this phone only, never the network, and the real source throws when the cache cannot be read, so the scheduler then
// changes nothing. The mock data's own rows in development.
export async function readAffirmationSource(): Promise<AffirmationSource | null> {
  if (getDataSource() === "mock") {
    const latest = readEntries().find((entry) => entry.status === "ready");
    if (latest === undefined) return null;
    const affirmations = latest.isCrisis ? [] : readAffirmations(latest.id);
    return { entryId: latest.id, isCrisis: latest.isCrisis, affirmations };
  }
  return live.readCachedAffirmationSource();
}

// The Daily Affirmations switch as this phone knows it, with no waiting: null until the profile has been read on this phone
// (the scheduler plans nothing until then). The mock data's own row in development.
export function getKnownAffirmationsEnabled(userId: string): boolean | null {
  if (getDataSource() === "mock") return readMockProfile().affirmationsEnabled;
  return readLocalProfile(userId)?.affirmationsEnabled ?? null;
}

// One page of the Journal (step 25): the entries it lists, newest first, the cursor of the next page (null when there is no
// older entry) and, for the first page, how many entries there are in all. A failed read is a RepoResult, so a screen keeps
// what it has. The real source writes what it read to the cache. The mock data is one page.
export async function loadEntriesPage(cursor: string | null): Promise<RepoResult<live.EntriesPage>> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    return { ok: true, data: { entries: readEntries(), nextCursor: null, total: null } };
  }
  return live.loadEntriesPage(cursor, getEntriesPageSize());
}

// A reflection that is still only on this phone has no server id: its id is its client entry id, and it is an entry
// that is not finished yet (Reflection shows "still being prepared"), never "not found" (step 24). Otherwise the real source
// asks the server (null when it has no such entry) and falls back to the cached copy when there is no answer; with neither,
// it throws, and the screen shows its error state.
export async function getEntry(id: string): Promise<HomeEntry | null> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    const found = readEntries().find((entry) => entry.id === id);
    if (found) return found;
    const waiting = await findPendingItem(id);
    return waiting === null ? null : toPendingEntry(waiting);
  }
  const waiting = await findPendingItem(id);
  if (waiting !== null) return toPendingEntry(waiting);
  return live.fetchEntry(id);
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
  if (mock !== "free" || getDataSource() === "mock") return mock;
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
  const isMock = getDataSource() === "mock";
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

// Ordered morning, afternoon, evening. The real source asks the server and falls back to the cached copy; with neither it throws.
// A reflection that is only in this phone's outbox has no affirmations yet and no row on the server, so nobody is asked.
export async function listAffirmationsForEntry(entryId: string): Promise<Affirmation[]> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    return readAffirmations(entryId);
  }
  if ((await findPendingItem(entryId)) !== null) return [];
  return live.fetchAffirmations(entryId);
}

// From the newest ready, non-crisis entry. The real source never throws: with no answer it is the cached copy (fetchAffirmations
// falls back to it), or nothing when there is none, and Journal Home then shows no affirmation card.
export async function getLatestAffirmations(): Promise<Affirmation[]> {
  if (getDataSource() === "mock") {
    await simulateLatency();
    const latest = readEntries().find((entry) => entry.status === "ready" && !entry.isCrisis);
    return latest ? readAffirmations(latest.id) : [];
  }
  try {
    return await live.fetchLatestAffirmations();
  } catch {
    return [];
  }
}

// Saves the heart on an affirmation: the one column of daily_affirmations the app may write (step 18). The mock data changes
// the mock row, and fails when the developer panel's "Fail next save" is armed, like the other mock writes.
export async function setAffirmationFavorite(id: string, value: boolean): Promise<RepoResult<Affirmation>> {
  if (getDataSource() !== "mock") return live.saveFavorite(id, value);
  await simulateLatency();
  if (takeMockPrayerMutationFailure()) return failure("NETWORK", copy.journal.affirmation.saveError);
  const row = getMockDb().affirmations.find((candidate) => candidate.id === id);
  if (row === undefined) return failure("NOT_FOUND", copy.journal.affirmation.saveError);
  row.is_favorite = value;
  return { ok: true, data: toAffirmation(row) };
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

// A mock run for the sync engine, used while the data source is the mock (services/entryProcessor.ts): it reports each
// stage 1.2 s apart, then answers with what the dev store asked for (one shot, see takeMockSubmitOutcome), or with no answer at
// all when the dev panel failed the network. A finished or crisis outcome adds an entry to the mock database and answers with
// it, as the server does.
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
      // The real 402 also names the entry the server saved; the mock data has no server entry.
      return { ok: false, code: "LIMIT_REACHED", resetsAt: nextWeekStart(new Date()).toISOString() };
  }
}
