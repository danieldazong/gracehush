import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import { AppState } from "react-native";

import { speak } from "@/data/scholarRepository";
import { setSessionMode } from "@/services/audioSession";
import { usePlayerStore } from "@/store/playerStore";
import type { ScholarUsage } from "@/types";

// Listen (step 38): Scholar's answer read aloud, one part at a time. It asks scholar-speak for part 0, plays it, and fetches the
// next part while one plays. Each part is written to Paths.cache/scholar/{messageId}-{part}.wav and stays there until the
// Conversation screen closes (clearScholarAudio), so a replay in the same visit makes no request. It sets the playback mode
// through audioSession.ts, never holds the session and never touches the lock screen (the readers: someone may be watching the
// phone), and a devotional that is playing pauses first. It stops when the screen is left, when the app leaves the foreground,
// when a take starts (services/recorder.ts) and at sign-out. Nothing here logs.

export type ScholarListenState =
  | { phase: "idle" }
  | { phase: "preparing"; messageId: string }
  | { phase: "playing"; messageId: string }
  | { phase: "failed"; messageId: string; code: string; usage: ScholarUsage | null };

type PartResult = { ok: true; parts: number } | { ok: false; code: string; usage: ScholarUsage | null };

const FOLDER = "scholar";
// A message id is a UUID made on the phone or by the server; anything else is refused rather than turned into a path.
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

const IDLE: ScholarListenState = { phase: "idle" };

let state: ScholarListenState = IDLE;
// Bumped by every stop: a part, a status report or a request that belongs to an older listen is dropped.
let generation = 0;
// Bumped when the cache is emptied: a part that arrives afterwards is not written into a folder the screen just cleared.
let cacheEpoch = 0;
let player: AudioPlayer | null = null;
let subscription: { remove: () => void } | null = null;
// How many parts each answer has, once scholar-speak has said, and the requests on their way, one per part.
const partCounts = new Map<string, number>();
const fetching = new Map<string, Promise<PartResult>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

function setState(next: ScholarListenState) {
  state = next;
  notify();
}

export function getScholarListenState(): ScholarListenState {
  return state;
}

export function subscribeScholarListen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function folder(): Directory {
  return new Directory(Paths.cache, FOLDER);
}

function partFile(messageId: string, part: number): File {
  return new File(folder(), `${messageId}-${part}.wav`);
}

// Lets go of the player. Never throws.
function release() {
  const old = player;
  const oldSubscription = subscription;
  player = null;
  subscription = null;
  try {
    oldSubscription?.remove();
  } catch {
    // Already removed.
  }
  if (old === null) return;
  try {
    old.pause();
  } catch {
    // Nothing to pause.
  }
  try {
    old.release();
  } catch {
    // Already released.
  }
}

// Part `part` of an answer on the phone: the cached file, else one request (a second ask for the same part waits for the first).
function ensurePart(messageId: string, part: number): Promise<PartResult> {
  const known = partCounts.get(messageId);
  if (known !== undefined && partFile(messageId, part).exists) return Promise.resolve({ ok: true, parts: known });
  const key = `${messageId}-${part}`;
  const running = fetching.get(key);
  if (running !== undefined) return running;
  const epoch = cacheEpoch;
  const promise = (async (): Promise<PartResult> => {
    const result = await speak(messageId, part);
    if (!result.ok) return { ok: false, code: result.code, usage: result.usage };
    if (epoch !== cacheEpoch) return { ok: false, code: "STOPPED", usage: null };
    try {
      const dir = folder();
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      await partFile(messageId, part).write(result.data.audioBase64, { encoding: "base64" });
    } catch {
      return { ok: false, code: "FILE", usage: null };
    }
    partCounts.set(messageId, result.data.parts);
    return { ok: true, parts: result.data.parts };
  })().finally(() => {
    if (fetching.get(key) === promise) fetching.delete(key);
  });
  fetching.set(key, promise);
  return promise;
}

async function playPart(messageId: string, part: number, current: number): Promise<void> {
  const ready = await ensurePart(messageId, part);
  if (current !== generation) return;
  if (!ready.ok) {
    release();
    setState({ phase: "failed", messageId, code: ready.code, usage: ready.usage });
    return;
  }
  try {
    release();
    const created = createAudioPlayer({ uri: partFile(messageId, part).uri }, { keepAudioSessionActive: false });
    player = created;
    subscription = created.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (player !== created || current !== generation) return;
      if (status.error) {
        release();
        setState({ phase: "failed", messageId, code: "PLAYBACK", usage: null });
      } else if (status.didJustFinish) {
        if (part + 1 < ready.parts) {
          void playPart(messageId, part + 1, current);
        } else {
          release();
          setState(IDLE);
        }
      }
    });
    created.play();
    setState({ phase: "playing", messageId });
  } catch {
    release();
    setState({ phase: "failed", messageId, code: "PLAYBACK", usage: null });
    return;
  }
  // The next part comes while this one plays, so the voice does not stop between them.
  if (part + 1 < ready.parts) void ensurePart(messageId, part + 1);
}

// Reads an answer aloud from its start. Another answer that is playing stops first.
export async function playScholarAnswer(messageId: string): Promise<void> {
  if (!SAFE_ID.test(messageId)) return;
  stopScholarAudio();
  const current = generation;
  setState({ phase: "preparing", messageId });
  // Two voices never speak at once: a devotional that is playing pauses (the store's own pause, as a take does).
  usePlayerStore.getState().pause();
  // The playback mode, so the silent switch does not mute it; a mode that cannot be set is not fatal.
  await setSessionMode("playback");
  if (current !== generation) return;
  await playPart(messageId, 0, current);
}

export function stopScholarAudio(): void {
  generation += 1;
  release();
  if (state.phase !== "idle") setState(IDLE);
}

// The Conversation screen closed, or the person signed out: stops the voice and deletes every part on the phone.
export function clearScholarAudio(): void {
  stopScholarAudio();
  cacheEpoch += 1;
  partCounts.clear();
  fetching.clear();
  try {
    const dir = folder();
    if (dir.exists) dir.delete();
  } catch {
    // Left for the next clear, or for the system's own cache clean-up.
  }
}

// Away from the foreground the voice stops: it belongs to the screen, never to the lock screen. Only "background" stops it:
// iOS also reports "inactive" while something covers the app for a moment, such as Control Center pulled down to turn up the
// volume, and the voice goes on then (step 38's walk-through, 2026-11-12). Locking the phone and leaving the app both reach
// "background", so they still stop it.
AppState.addEventListener("change", (status) => {
  if (status === "background") stopScholarAudio();
});
