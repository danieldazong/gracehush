import type { SupabaseClient } from "@supabase/supabase-js";

import type { SpeechStatus } from "../_shared/log.ts";
import type { TtsSetup } from "../_shared/tts/config.ts";
import { wavDurationMs } from "../_shared/tts/wavDuration.ts";
import { buildSpeechScript } from "../_shared/tts/script.ts";
import { storeDevotionalAudio } from "../_shared/tts/storeAudio.ts";
import { synthesize } from "../_shared/tts/synthesize.ts";
import { speechTiming } from "./constants.ts";
import { type EntryRow, findEntry, markSpeechFailed, saveAudio } from "./lifecycle.ts";

// The spoken devotional (step 22): the last, best-effort step of a request. It runs on a reflection that is already saved
// as ready, so nothing here can lose or fail one, and it never throws: every outcome is an answer, and a failure leaves the
// entry as it was (ready, as text) with a log word that says why.
//
//   script (the saved devotional, the passage only when verified, the prayer) -> Google Text-to-Speech -> a WAV -> its length
//   -> the private journal_media bucket -> the path and the length on the entry
//
// Only a path is stored and returned, never a link: the app asks Supabase for its own short-lived signed link (step 26).

type Db = <T>(work: () => Promise<T>) => Promise<T>;

export type SpeechJob = {
  admin: SupabaseClient;
  userId: string;
  // The saved entry: a reflection that is ready, with its devotional, and no audio yet.
  row: EntryRow;
  setup: TtsSetup;
  // Date.now() when the request started: the speech budget (speechTiming) is counted from it.
  startedAt: number;
  // Wraps a database call so that its time is counted in the request's dbMs.
  db: Db;
};

export type SpeechOutcome = {
  // The entry as it now stands: with its audio when speech worked or when another request added it first, else as it was
  // (with error_code TTS_FAILED after a failure that was marked).
  row: EntryRow;
  tts: SpeechStatus;
  ttsMs: number;
  ttsAttempts: number;
  // The characters Google bills: the script's, and only for a call that worked.
  ttsChars: number;
  audioMs: number | null;
};

const untouched = (row: EntryRow, tts: SpeechStatus): SpeechOutcome => ({
  row,
  tts,
  ttsMs: 0,
  ttsAttempts: 0,
  ttsChars: 0,
  audioMs: null,
});

// The upload may run until speechTiming.uploadTimeoutMs, but never later than this long after the speech deadline: 135 s
// plus 20 s would be past the platform's 150 s, and a request that is stopped there answers nothing at all.
const UPLOAD_GRACE_MS = 5_000;

export function uploadCapMs(startedAt: number): number {
  const untilDeadline = Math.max(0, startedAt + speechTiming.deadlineMs - Date.now());
  return Math.min(speechTiming.uploadTimeoutMs, untilDeadline + UPLOAD_GRACE_MS);
}

class UploadTimeout extends Error {}

// Rejects when `work` takes longer than `ms`. The timer is always cleared, and a late failure of `work` is already handled
// by the race, so nothing is left running or unhandled.
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new UploadTimeout()), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export async function speechStage(job: SpeechJob): Promise<SpeechOutcome> {
  const { admin, userId, row, setup, startedAt, db } = job;

  if (setup.state === "off") return untouched(row, "off");
  if (setup.state === "bad") return untouched(row, `bad_config:${setup.name}`);
  // Later than this in the request there is no time left to speak in. Sending the same request again adds the audio.
  if (Date.now() - startedAt >= speechTiming.latestStartMs) return untouched(row, "skipped:time");

  // The passage is read aloud only when it is verified, and then only with the Bible's own words from the row.
  const scripture = row.scripture_verified && row.scripture_reference !== null && row.scripture_text !== null
    ? { reference: row.scripture_reference, text: row.scripture_text }
    : null;
  const script = buildSpeechScript({
    devotional: row.devotional_script ?? "",
    scripture,
    closingPrayer: row.closing_prayer,
  });
  if (script === null) return untouched(row, "skipped:script");

  const started = Date.now();
  let attempts = 0;
  // After a failure the reflection stays ready as text and says so (TTS_FAILED), and the answer is built from the row that
  // says so. The marking is guarded and never throws.
  async function failed(reason: string): Promise<SpeechOutcome> {
    const marked = await db(() => markSpeechFailed(admin, userId, row.id));
    return {
      row: marked ?? row,
      tts: `failed:${reason}`,
      ttsMs: Date.now() - started,
      ttsAttempts: attempts,
      ttsChars: 0,
      audioMs: null,
    };
  }

  try {
    const spoken = await synthesize(script.markup, setup.config, startedAt + speechTiming.deadlineMs);
    attempts = spoken.attempts;
    if (!spoken.ok) return await failed(spoken.reason);

    // The length is measured from the file itself. null (a header that cannot be read) is stored as null, and the app's
    // player learns the length when it loads the file.
    const audioMs = wavDurationMs(spoken.audio);

    let path: string;
    try {
      path = await withTimeout(storeDevotionalAudio(admin, userId, row.id, spoken.audio), uploadCapMs(startedAt));
    } catch {
      return await failed("storage");
    }

    let saved: EntryRow | null;
    try {
      saved = await db(() => saveAudio(admin, userId, row.id, path, audioMs));
    } catch {
      return await failed("save");
    }

    // null: another request added its audio first, so the path was no longer empty. The entry is read again and answered as
    // it now is; if that read fails too, the answer is the row as it was and the next request will show the audio.
    let current = saved;
    if (current === null && row.client_entry_id !== null) {
      const clientEntryId = row.client_entry_id;
      current = await db(() => findEntry(admin, userId, clientEntryId)).catch(() => null);
    }
    return {
      row: current ?? row,
      tts: "ok",
      ttsMs: Date.now() - started,
      ttsAttempts: attempts,
      ttsChars: script.chars,
      audioMs,
    };
  } catch {
    // Anything this step did not expect (a bug, not Google): the reflection is saved, so say so and go on.
    return await failed("unexpected");
  }
}
