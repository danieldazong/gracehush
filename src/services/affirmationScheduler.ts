import { AppState } from "react-native";

import { AFFIRMATION_MIN_LEAD_MS, AFFIRMATION_RESCHEDULE_DEBOUNCE_MS } from "@/constants/app";
import {
  getKnownAffirmationsEnabled,
  readWordCalendar,
  readWordPool,
  saveWordCalendar,
} from "@/data/journalRepository";
import { getDeviceTimezone } from "@/data/mappers";
import { userHash } from "@/db/database";
import {
  AFFIRMATION_ID_PREFIX,
  isPlannedAffirmationId,
  planAffirmations,
  testAffirmationId,
  type PlannedAffirmation,
} from "@/services/affirmationPlanner";
import { setTapUser } from "@/services/notificationRouting";
import {
  cancelScheduled,
  dismissPresented,
  ensureAffirmationChannel,
  getNotificationPermission,
  listPresentedIds,
  listScheduledIds,
  notificationsAvailable,
  scheduleAt,
} from "@/services/notifications";
import { subscribe as subscribeToSync } from "@/services/syncEngine";
import { useOfflineStore } from "@/store/offlineStore";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import { dealWords, toHistoryRow, type DeckHistoryRow } from "@/utils/wordDeck";

// The daily affirmation notifications (step 28): local notifications only, made on this phone at the reminder times, in the
// phone's time zone, for the next 7 days. Since 2026-11-17 the three reminders of a day take turns between the reflections of the
// week (the Word Deck, utils/wordDeck.ts) and no longer all come from the newest one: each run reads the week's reflections and
// the calendar of what the reminders carried, deals the words, writes the deal to the calendar (which Today's card reads, so the
// card and the lock screen agree, notifications on or off) and plans the notifications from it. The auth bridge starts it when a
// user signs in; it then plans again whenever something the plan reads may have changed (the app comes to the front, a reminder
// time, the Daily Affirmations switch, the user's database opening, a reflection finishing, Journal's first page) and changes only
// the difference. Coming to the front also refills the 7 days.
//
// - One run at a time; a request during a run runs it once more after. Requests are gathered for half a second.
// - A run that cannot read something it needs (the database is not open, the profile was never read on this phone, the cache
//   or the calendar cannot be read) changes nothing: a bad read never cancels anyone's notifications.
// - The deal and the calendar do not depend on notifications: with the switch off, the permission missing or the module not
//   there (Expo Go on Android) the calendar is still written, and Today's card still shows the word of the day.
// - Nothing is logged but a step that failed. Never a title, a headline, an id or a time.

let userId: string | null = null;
let hash: string | null = null;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
let stopWatching: (() => void) | null = null;

function note(step: string) {
  if (__DEV__) {
    console.info(`[affirmations] ${step}_failed`);
  }
}

async function attempt(step: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch {
    note(step);
  }
}

// Told after each deal has been written to the calendar: Today's card reads the word that last arrived from there.
const calendarListeners = new Set<() => void>();

export function subscribeWordCalendar(listener: () => void): () => void {
  calendarListeners.add(listener);
  return () => {
    calendarListeners.delete(listener);
  };
}

function announceCalendar() {
  for (const listener of [...calendarListeners]) {
    try {
      listener();
    } catch {
      note("listener");
    }
  }
}

type PrefsState = ReturnType<typeof useProfilePrefsStore.getState>;

function enabledFor(state: PrefsState, id: string): boolean | null {
  const entry = state.byUser[id];
  return entry?.unsent.affirmationsEnabled ?? entry?.snapshot?.affirmationsEnabled ?? null;
}

export function startAffirmationSchedule(signedInUserId: string): void {
  stopAffirmationSchedule();
  const mine = generation;
  userId = signedInUserId;
  userHash(signedInUserId).then(
    (value) => {
      if (mine !== generation) return;
      hash = value;
      setTapUser(value);
      requestAffirmationReschedule();
    },
    () => note("hash"),
  );
  const appState = AppState.addEventListener("change", (status) => {
    if (status === "active") requestAffirmationReschedule();
  });
  const unsubscribers = [
    () => appState.remove(),
    useOnboardingStore.subscribe((state, previous) => {
      if (state.reminders !== previous.reminders) requestAffirmationReschedule();
    }),
    useProfilePrefsStore.subscribe((state, previous) => {
      if (enabledFor(state, signedInUserId) !== enabledFor(previous, signedInUserId)) requestAffirmationReschedule();
    }),
    useOfflineStore.subscribe((state, previous) => {
      if (state.dbReady && !previous.dbReady) requestAffirmationReschedule();
    }),
    subscribeToSync((event) => {
      if (event.type === "finished") requestAffirmationReschedule();
    }),
  ];
  stopWatching = () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

// The session ended (sign-out, or another account signs in). Planning stops and nothing more is written; what is scheduled
// stays until clearAffirmations or the next account's first plan replaces it.
export function stopAffirmationSchedule(): void {
  generation += 1;
  stopWatching?.();
  stopWatching = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  userId = null;
  hash = null;
  setTapUser(null);
}

// Plans again shortly (the requests of the next half second are one run). Also called by Journal when its first page and the
// affirmations of the week's reflections have come (a reflection may have changed on the server) and by Profile when
// notifications are allowed.
export function requestAffirmationReschedule(): void {
  if (userId === null) return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, AFFIRMATION_RESCHEDULE_DEBOUNCE_MS);
}

function run(): Promise<void> {
  if (running !== null) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again && userId !== null);
    } finally {
      running = null;
    }
  })();
  return running;
}

type Computed = { rows: DeckHistoryRow[]; plan: PlannedAffirmation[]; nowMs: number };

// Reads the week's reflections, the calendar and the permission, deals the words and works out the notifications; it changes
// nothing. Null when something it needs cannot be read yet: then the run changes nothing at all.
async function compute(): Promise<Computed | null> {
  const id = userId;
  const h = hash;
  if (id === null || h === null) return null;
  if (!useOfflineStore.getState().dbReady) return null;
  const enabled = getKnownAffirmationsEnabled(id);
  if (enabled === null) return null;
  const now = new Date(Date.now());
  const timeZone = getDeviceTimezone();
  let pool;
  let history;
  try {
    pool = await readWordPool(now, timeZone);
    history = await readWordCalendar();
  } catch {
    note("read");
    return null;
  }
  // While the newest reflection is a heavy moment saved the old way (only the person's words) nothing is dealt or sent.
  const deal = pool.quiet
    ? []
    : dealWords({
        now,
        timeZone,
        reminders: useOnboardingStore.getState().reminders,
        reflections: pool.reflections,
        history,
      });
  const permission = notificationsAvailable() ? await getNotificationPermission() : "undetermined";
  return {
    rows: deal.map(toHistoryRow),
    plan: planAffirmations({ enabled, permission, deal, userHash: h }),
    nowMs: now.getTime(),
  };
}

async function runOnce(): Promise<void> {
  const mine = generation;
  const computed = await compute();
  if (computed === null || mine !== generation) return;
  // The calendar first: Today's card reads it, and a run that stops after it leaves the card and the next plan right.
  await attempt("calendar", () => saveWordCalendar(computed.rows, computed.nowMs));
  if (mine !== generation) return;
  announceCalendar();
  if (!notificationsAvailable()) return;
  const plan = computed.plan;
  let scheduled: string[];
  try {
    scheduled = (await listScheduledIds()).filter(isPlannedAffirmationId);
  } catch {
    note("list");
    return;
  }
  const wanted = new Set(plan.map((item) => item.identifier));
  const have = new Set(scheduled);
  for (const identifier of scheduled) {
    if (wanted.has(identifier)) continue;
    if (mine !== generation) return;
    await attempt("cancel", () => cancelScheduled(identifier));
  }
  // A notification about to fire that is not scheduled yet is left out: iOS refuses a time that has passed.
  const missing = plan.filter(
    (item) => !have.has(item.identifier) && item.fireAt.getTime() - Date.now() >= AFFIRMATION_MIN_LEAD_MS,
  );
  if (missing.length > 0) await ensureAffirmationChannel();
  for (const item of missing) {
    if (mine !== generation) return;
    await attempt("schedule", () => scheduleAt(item));
  }
}

// Sign-out and account deletion (signOutCleanup): planning stops, a run still in the air finishes, then every notification of
// ours is cancelled and the ones in the notification center are removed.
export async function clearAffirmations(): Promise<void> {
  stopAffirmationSchedule();
  if (running !== null) await running.catch(() => undefined);
  if (!notificationsAvailable()) return;
  try {
    for (const identifier of await listScheduledIds()) {
      if (identifier.startsWith(AFFIRMATION_ID_PREFIX)) await attempt("cancel", () => cancelScheduled(identifier));
    }
  } catch {
    note("list");
  }
  try {
    for (const identifier of await listPresentedIds()) {
      if (identifier.startsWith(AFFIRMATION_ID_PREFIX)) await attempt("dismiss", () => dismissPresented(identifier));
    }
  } catch {
    note("presented");
  }
}

// ---- for the developer panel -----------------------------------------------------------------------------------------------

// How many are scheduled and the earliest one's local day and time ("2026-10-29 08:00"), read from the identifiers
// ("aff-morning-20261029-0800-1a2b3c4d"). No text.
export async function getAffirmationScheduleSummary(): Promise<{ count: number; next: string | null }> {
  const stamps = (await listScheduledIds())
    .filter(isPlannedAffirmationId)
    .map((identifier) => identifier.slice(-22, -9))
    .sort();
  const first = stamps[0];
  if (first === undefined) return { count: 0, next: null };
  const date = `${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}`;
  return { count: stamps.length, next: `${date} ${first.slice(9, 11)}:${first.slice(11, 13)}` };
}

// Plans now, without waiting for the half second.
export function rescheduleAffirmationsNow(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  return run();
}

// One notification in `delayMs`, with the next planned one's title, headline and tap: false when there is nothing to plan.
export async function scheduleTestAffirmation(delayMs: number): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  const computed = await compute();
  const next = computed?.plan[0];
  if (next === undefined) return false;
  try {
    await scheduleAt({ ...next, identifier: testAffirmationId(Date.now()), fireAt: new Date(Date.now() + delayMs) });
    return true;
  } catch {
    note("test");
    return false;
  }
}
