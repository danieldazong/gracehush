import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { AppState } from "react-native";

import { sampleDevotional } from "@/constants/sounds";
import { setSessionMode } from "@/services/audioSession";

// The Welcome step's 12-second sample (2026-11-01, round 8): a bundled excerpt of a devotional the app's own voice read for
// a made-up prayer, so a person hears what they will get before they sign in. One shot: it plays to its end or is stopped,
// and the player is then let go of, so it holds no file and no media session. It never touches the lock screen or the
// ambient bed, and it stops when the app leaves the foreground.

let player: AudioPlayer | null = null;
let subscription: { remove: () => void } | null = null;
let playing = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

function setPlaying(next: boolean) {
  if (playing === next) return;
  playing = next;
  notify();
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

function onStatus(status: AudioStatus) {
  if (status.error || status.didJustFinish) stopSample();
}

export function isSamplePlaying(): boolean {
  return playing;
}

export function subscribeSample(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Plays the sample from its start. A second call while it plays does nothing; stopSample() ends it early.
export async function playSample(): Promise<void> {
  if (playing) return;
  setPlaying(true);
  // The playback mode, so the silent switch does not mute it, as for a devotional; a mode that cannot be set is not fatal.
  await setSessionMode("playback");
  // Stopped while the mode was being set.
  if (!playing) return;
  try {
    release();
    const created = createAudioPlayer(sampleDevotional, {
      // The sample never holds the session on its own: when it ends, the sound goes back to the other apps.
      keepAudioSessionActive: false,
    });
    player = created;
    subscription = created.addListener("playbackStatusUpdate", (status) => {
      if (player === created) onStatus(status);
    });
    created.play();
  } catch {
    // Only that it failed: a native error can carry more than that.
    if (__DEV__) console.warn("[sample] the sample could not be played");
    stopSample();
  }
}

export function stopSample(): void {
  release();
  setPlaying(false);
}

// Away from the foreground the sample stops: it belongs to a screen, not to the lock screen.
AppState.addEventListener("change", (state) => {
  if (state !== "active") stopSample();
});
