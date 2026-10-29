import { NO_SESSION_CODE } from "@/utils/supabaseErrors";

// What the sync engine does with a failure (step 24). Pure, so it is tested without a device. The codes are the ones
// process-entry answers with (ProcessEntryErrorCode) plus the app's own: NETWORK (no answer), UNKNOWN (an answer the app
// does not know) and UNREADABLE (the words saved on this phone cannot be read).
//
//   retry         the same item again, later, with backoff
//   limit         the free limit: the entry is saved, and nothing is retried until the person upgrades or the week resets
//   pause_auth    the session was refused: everything waits for the next sign-in
//   needs_action  only the person can fix it: nothing is retried
export type FailureAction = "retry" | "limit" | "pause_auth" | "needs_action";

const ACTIONS: Record<string, FailureAction> = {
  NETWORK: "retry",
  AI_UNAVAILABLE: "retry",
  INTERNAL: "retry",
  RATE_LIMITED: "retry",
  ALREADY_PROCESSING: "retry",
  UNKNOWN: "retry",
  LIMIT_REACHED: "limit",
  UNAUTHORIZED: "pause_auth",
  TOO_SHORT: "needs_action",
  NO_SPEECH: "needs_action",
  PAYLOAD_TOO_LARGE: "needs_action",
  INVALID_REQUEST: "needs_action",
  AUDIO_NOT_FOUND: "needs_action",
  METHOD_NOT_ALLOWED: "needs_action",
  UNREADABLE: "needs_action",
};

// A code this table does not list is an answer the app has not met: it is tried again, never dropped.
export function classify(code: string): FailureAction {
  return ACTIONS[code] ?? "retry";
}

// What the engine does with a prayer change the server did not take (step 29), from the HTTP status (0: no answer) and the
// database's error code:
//
//   retry       no answer, a timeout, too many requests, or a server error: the same change again, later, with the backoff below
//   pause_auth  the session was refused, or nobody is signed in: every change waits for the next start or return to the app
//   drop        the database refused this change (a rule, a grant, a value it cannot take): it can never go, so it is
//               removed, the entry is read again and the person is told. It is never retried.
export type PrayerFailureAction = "retry" | "pause_auth" | "drop";

// 42501: row level security or a missing grant; 23514: a check (the prayer rules of step 18); 22P02: a value of the wrong
// type; 22001: a value too long.
const PERMANENT_CODES = new Set(["42501", "23514", "22P02", "22001"]);

export function classifyPrayerFailure(status: number, code: string): PrayerFailureAction {
  if (code === NO_SESSION_CODE || status === 401 || /^PGRST30[123]$/.test(code)) return "pause_auth";
  if (PERMANENT_CODES.has(code)) return "drop";
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "retry";
  // A refusal with no database code comes from the gateway before the database: the session, not the change.
  if (status === 403) return "pause_auth";
  if (status >= 400) return "drop";
  return "retry";
}

// 5 s, 15 s, 60 s, 5 min, 15 min, 1 h, and then 1 h again.
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000] as const;
export const JITTER = 0.2;

// Some answers mean "not yet" for longer than the first steps: the server counts entries in a 10-minute window
// (RATE_LIMITED), and a request that died leaves its claim for up to 3 minutes (ALREADY_PROCESSING).
const MIN_DELAY_MS: Record<string, number> = { RATE_LIMITED: 60_000, ALREADY_PROCESSING: 30_000 };

// `attempts` is how many times the item has been sent, this failure included (1 after the first). Plus or minus 20%, so
// a crowd of phones does not come back at the same second.
export function retryDelayMs(code: string, attempts: number, random: () => number = Math.random): number {
  const step = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1;
  const base = Math.max(BACKOFF_MS[step], MIN_DELAY_MS[code] ?? 0);
  return Math.round(base * (1 + (random() * 2 - 1) * JITTER));
}
