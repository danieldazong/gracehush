// TEMP(26): replace the internals with the real player; keep the state names and the action names
import { AppState } from "react-native";
import { create } from "zustand";

import type {
  AmbientDefault,
  AmbientSound,
  PlaybackRate,
  PlaybackStatus,
  PlaybackTrack,
} from "@/types";

// What the mini player and Now Playing both show. Nothing plays: a position moves forward so both can be
// seen working, until step 26 puts the real player behind the same names. Not persisted.
type PlayerState = {
  entryId: string | null;
  title: string;
  subtitle: string;
  durationMs: number;
  positionMs: number;
  status: PlaybackStatus;
  rate: PlaybackRate;
  ambientSound: AmbientSound;
  ambientVolume: number; // 0–1
  // Synchronous, and the caller passes the profile: the store never fetches.
  load: (track: PlaybackTrack, ambient: AmbientDefault) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (ms: number) => void;
  skipBy: (deltaMs: number) => void;
  setRate: (rate: PlaybackRate) => void;
  setAmbient: (sound: AmbientSound) => void;
  setAmbientVolume: (volume: number) => void;
  // A full reset, for sign-out (step 15).
  stop: () => void;
};

const TICK_MS = 250;

// One interval for the whole app, running only while playing.
let timer: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
// The ambient choice is copied from the profile by the first load after the app starts (or after stop()).
// Later loads keep the session's choice: a listener's speed and sound belong to the session, not to a devotional.
let ambientSeeded = false;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

// It advances by the time that really passed, not by a fixed 250 ms: JS timers run late (measured up to
// 8.7 s on the emulator while it was busy) and a fixed step would make the clock lag.
function tick() {
  const now = Date.now();
  const elapsed = now - lastTickAt;
  lastTickAt = now;
  const { positionMs, durationMs, rate } = usePlayerStore.getState();
  const next = positionMs + elapsed * rate;
  if (next >= durationMs) {
    stopTimer();
    usePlayerStore.setState({ positionMs: durationMs, status: "ended" });
  } else {
    usePlayerStore.setState({ positionMs: next });
  }
}

// Always clears first, so there is never more than one interval.
function startTimer() {
  stopTimer();
  lastTickAt = Date.now();
  timer = setInterval(tick, TICK_MS);
}

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  entryId: null,
  title: "",
  subtitle: "",
  durationMs: 0,
  positionMs: 0,
  status: "idle",
  rate: 1,
  ambientSound: "off",
  ambientVolume: 0.5,

  // The same entry does nothing, so reopening a reflection never resets its position. Another entry stops
  // the one that is playing and starts at 0, paused.
  load: (track, ambient) => {
    if (track.entryId === get().entryId) return;
    stopTimer();
    set({ ...track, positionMs: 0, status: "paused" });
    if (!ambientSeeded) {
      ambientSeeded = true;
      set({ ambientSound: ambient.ambientSound, ambientVolume: ambient.ambientVolume });
    }
  },

  play: () => {
    const { entryId, status } = get();
    if (entryId === null || status === "playing") return;
    // From the end, play starts again from 0.
    set(status === "ended" ? { positionMs: 0, status: "playing" } : { status: "playing" });
    startTimer();
  },

  pause: () => {
    if (get().status !== "playing") return;
    stopTimer();
    set({ status: "paused" });
  },

  toggle: () => {
    if (get().status === "playing") get().pause();
    else get().play();
  },

  // Reaching the end ends the track, seeking back from the end pauses it, and seeking while playing keeps playing.
  seekTo: (ms) => {
    const { entryId, durationMs, status } = get();
    if (entryId === null || !Number.isFinite(ms)) return;
    const positionMs = clamp(ms, 0, durationMs);
    if (positionMs >= durationMs) {
      stopTimer();
      set({ positionMs, status: "ended" });
      return;
    }
    // The time since the last tick was spent at the old position.
    if (status === "playing") lastTickAt = Date.now();
    set({ positionMs, status: status === "ended" ? "paused" : status });
  },

  skipBy: (deltaMs) => get().seekTo(get().positionMs + deltaMs),

  setRate: (rate) => set({ rate }),

  // TODO(27): persist the ambient choice to users_profile
  setAmbient: (sound) => set({ ambientSound: sound }),

  // TODO(27): persist the ambient choice to users_profile
  setAmbientVolume: (volume) => set({ ambientVolume: clamp(volume, 0, 1) }),

  stop: () => {
    stopTimer();
    ambientSeeded = false;
    set({
      entryId: null,
      title: "",
      subtitle: "",
      durationMs: 0,
      positionMs: 0,
      status: "idle",
      rate: 1,
      ambientSound: "off",
      ambientVolume: 0.5,
    });
  },
}));

// TEMP(26): real audio keeps playing in the background, so step 26 removes this. Nothing is audible in
// this mock, so nothing should keep counting while the user is away.
AppState.addEventListener("change", (status) => {
  if (status !== "active") usePlayerStore.getState().pause();
});
