import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { AppState } from "react-native";
import { create } from "zustand";

import { KEEP_SESSION_ACTIVE, LOAD_TIMEOUT_MS, PLAYER_UPDATE_MS } from "@/constants/audio";
import { setAmbientBed, setAmbientRemoteHandler, stopAmbient } from "@/services/ambientPlayer";
import { setSessionMode } from "@/services/audioSession";
import { forgetDevotionalFile, getDevotionalFile } from "@/services/devotionalAudio";
import { activateLockScreen, clearLockScreen } from "@/services/lockScreen";
import type {
  AmbientDefault,
  AmbientSound,
  PlaybackError,
  PlaybackRate,
  PlaybackStatus,
  PlaybackTrack,
} from "@/types";

// What the mini player and Now Playing both show, and the one real player behind them (step 26). Not persisted.
//
// `status` is what the person sees and asked for: "playing" means the sound is on or on its way. While it is on its way
// (the file is being downloaded, opened, or the player is waiting for data) `isBuffering` is true as well, so a button can
// show a spinner and stay a pause button. `error` says why the audio could not be had; the next play tries again.
type PlayerState = {
  entryId: string | null;
  title: string;
  subtitle: string;
  durationMs: number;
  positionMs: number;
  status: PlaybackStatus;
  isBuffering: boolean;
  error: PlaybackError | null;
  rate: PlaybackRate;
  // The session's ambient bed (step 27): services/ambientPlayer.ts plays it under the voice (see the end of this file).
  ambientSound: AmbientSound;
  ambientVolume: number; // 0–1
  // Synchronous, and the caller passes the profile: the store never fetches for a screen. The audio itself is fetched
  // and opened in the background by what load() starts.
  load: (track: PlaybackTrack, ambient: AmbientDefault) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (ms: number) => void;
  skipBy: (deltaMs: number) => void;
  setRate: (rate: PlaybackRate) => void;
  setAmbient: (sound: AmbientSound) => void;
  setAmbientVolume: (volume: number) => void;
  // A full reset, for sign-out (step 15): the sound stops, the lock screen is cleared and the player is released, and so
  // are the ambient bed and Profile's preview (step 27).
  stop: () => void;
  // Profile calls it after a successful ambient save (step 15): the next load of a different devotional copies
  // the profile's ambient choice again. It changes no state, so nothing that is playing changes.
  reseedAmbient: () => void;
};

// The ambient choice is copied from the profile by the first load after the app starts (or after stop(), or after
// reseedAmbient() when Profile saved a new default). Later loads keep the session's choice: a listener's speed
// and sound belong to the session, not to a devotional.
let ambientSeeded = false;

// ---- the player. It is not part of the state: nothing draws from it.
//
// Every devotional gets a player of its own, made when its file is on the phone and released when another devotional is
// loaded. A late report from the old player then has nowhere to go, and a player never holds a file it should not.
let player: AudioPlayer | null = null;
let listener: { remove: () => void } | null = null;
let track: PlaybackTrack | null = null;
// Bumped by load() of another devotional and by stop(). A step that was waiting (the file, the player) looks at it
// afterwards and drops its result when it is out of date.
let generation = 0;
// The file is in the player and the player has said so.
let ready = false;
// The person wants sound. It can be true while the player is not ready yet.
let wantsPlaying = false;
// player.play() was called and the player was not paused since. A report that says "not playing" is something else
// pausing the player (a call, the lock screen, a headset) only while this is true.
let playRequested = false;
// Seeks on their way. The position the player reports can still be the old one until they are done.
let seeking = 0;
// Playing from the end starts again from 0.
let restartFromStart = false;
// The file was fetched again once because the player could not open it. A second failure is the end of it.
let refetched = false;
// What a player being opened calls when it has loaded its file, failed, or taken too long.
let settleLoad: ((result: "loaded" | "error" | "timeout") => void) | null = null;

// A report this close to the end of the devotional, with the player not playing, is the end: the report that says
// "finished" is lost when the app was suspended (the lock screen can play a devotional out while JS sleeps).
const END_TOLERANCE_MS = 300;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function update(patch: Partial<PlayerState>) {
  const state = usePlayerStore.getState();
  const changed = (Object.keys(patch) as (keyof PlayerState)[]).some((key) => state[key] !== patch[key]);
  if (changed) usePlayerStore.setState(patch);
}

// Lets go of the player and everything that belongs to it. Never throws.
function releasePlayer() {
  const old = player;
  const oldListener = listener;
  const waiter = settleLoad;
  player = null;
  listener = null;
  settleLoad = null;
  ready = false;
  playRequested = false;
  seeking = 0;
  try {
    oldListener?.remove();
  } catch {
    // Already removed.
  }
  waiter?.("error");
  if (old === null) return;
  clearLockScreen(old);
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

// The audio cannot be had (or stopped working): the devotional stays loaded, paused, with the reason.
function fail(gen: number, error: PlaybackError) {
  if (gen !== generation) return;
  wantsPlaying = false;
  playRequested = false;
  update({ status: "paused", isBuffering: false, error });
}

function failPlayback() {
  try {
    player?.pause();
  } catch {
    // Nothing to pause.
  }
  fail(generation, "unavailable");
}

// Moves the player to a position. The store already shows it: this only keeps the player (and with it the lock screen)
// in step, and picks the player's own position up again when the move is done.
function moveTo(ms: number): Promise<void> {
  const current = player;
  if (current === null) return Promise.resolve();
  seeking += 1;
  return current
    .seekTo(ms / 1000)
    .catch(() => undefined)
    .then(() => {
      seeking = Math.max(0, seeking - 1);
      const { status, durationMs } = usePlayerStore.getState();
      if (seeking === 0 && player === current && status !== "ended") {
        update({ positionMs: clamp(current.currentTime * 1000, 0, durationMs) });
      }
    });
}

// The devotional played out. It stays shown as finished, with the position at the end, but the player is rewound and paused
// behind it: a player left at its end plays nothing when the lock screen presses Play.
function finish() {
  wantsPlaying = false;
  playRequested = false;
  update({ positionMs: usePlayerStore.getState().durationMs, status: "ended", isBuffering: false });
  try {
    player?.pause();
  } catch {
    // Nothing to pause.
  }
  void moveTo(0);
}

// One report from the player, turned into what the screens show. The ways a player says it is not playing differ: iOS says
// "waiting" while it gets data for a play that was asked for, Android keeps saying "playing" while it buffers (and keeps
// saying so after a pause during the buffering, until the buffering ends), and both say plain "paused" when something else
// paused it. So a "waiting" report counts only while the person wants sound, which the app's own pause clears at once. (The
// report's own isBuffering is not used: on iOS it is also true for a paused player whose buffer is empty.)
function reconcile(status: AudioStatus) {
  const { durationMs, status: shown } = usePlayerStore.getState();
  if (status.didJustFinish) {
    finish();
    return;
  }
  const waiting =
    status.timeControlStatus === "waitingToPlayAtSpecifiedRate" || status.playbackState === "buffering";
  const patch: Partial<PlayerState> = {};
  if (status.playing && !waiting) {
    // Sound is coming out, whoever asked for it: the lock screen and a headset can start it too.
    wantsPlaying = true;
    playRequested = true;
    patch.status = "playing";
    patch.isBuffering = false;
  } else if (waiting && wantsPlaying) {
    patch.status = "playing";
    patch.isBuffering = true;
  } else if (playRequested) {
    if (durationMs > 0 && status.currentTime * 1000 >= durationMs - END_TOLERANCE_MS) {
      finish();
      return;
    }
    // Asked to play, and now neither playing nor waiting: something else paused it.
    wantsPlaying = false;
    playRequested = false;
    patch.status = "paused";
    patch.isBuffering = false;
  }
  // The position follows the player, except behind a finished devotional and while a seek is on its way.
  if (seeking === 0 && (patch.status ?? shown) !== "ended") {
    patch.positionMs = clamp(status.currentTime * 1000, 0, durationMs);
  }
  update(patch);
}

function onStatus(status: AudioStatus) {
  if (status.error) {
    settleLoad?.("error");
    if (ready) failPlayback();
    return;
  }
  if (status.isLoaded) settleLoad?.("loaded");
  if (ready) reconcile(status);
}

// Makes the player for a file on the phone and waits until it has loaded it. Reports of the player begin the moment it
// exists, so the listener is attached before anything is asked of it, and the state it is in at that moment is read
// directly (a report sent before the listener was there is not repeated).
function openPlayer(uri: string): Promise<"loaded" | "error" | "timeout"> {
  let created: AudioPlayer;
  try {
    created = createAudioPlayer(
      { uri },
      {
        updateInterval: PLAYER_UPDATE_MS,
        keepAudioSessionActive: KEEP_SESSION_ACTIVE,
        // AirPlay still works through the audio session. What it must not do is take the file away from the app.
        allowsExternalPlayback: false,
      },
    );
  } catch {
    return Promise.resolve("error");
  }
  player = created;
  // A report from a player that was let go of since (a retry makes a new one within the same load) is not this one's.
  listener = created.addListener("playbackStatusUpdate", (status) => {
    if (player === created) onStatus(status);
  });
  if (created.isLoaded) return Promise.resolve("loaded");
  return new Promise((resolve) => {
    const timer = setTimeout(() => finishLoad("timeout"), LOAD_TIMEOUT_MS);
    const finishLoad = (result: "loaded" | "error" | "timeout") => {
      clearTimeout(timer);
      if (settleLoad === finishLoad) settleLoad = null;
      resolve(result);
    };
    settleLoad = finishLoad;
  });
}

async function startPlayback(gen: number) {
  const current = player;
  if (current === null || !ready || gen !== generation) return;
  try {
    if (restartFromStart) {
      restartFromStart = false;
      // Not "asked to play" yet: the report that ends this move says "not playing", and that is not a pause by someone else.
      await moveTo(0);
      // Paused, or another devotional loaded, while the player was moving.
      if (gen !== generation || player !== current || !wantsPlaying) return;
    }
    playRequested = true;
    current.play();
  } catch {
    failPlayback();
  }
}

// Everything between a load and a devotional that can play: the session, the file, the player, the lock screen.
async function prepare(gen: number): Promise<void> {
  const current = track;
  if (current === null || gen !== generation) return;
  update({ error: null });
  await setSessionMode("playback");
  if (gen !== generation) return;
  const file = await getDevotionalFile(current.entryId, current.audioPath);
  if (gen !== generation) return;
  if (!file.ok) {
    fail(gen, file.code === "NETWORK" ? "offline" : "unavailable");
    return;
  }
  const opened = await openPlayer(file.uri);
  if (gen !== generation) return;
  const opening = player;
  if (opened !== "loaded" || opening === null) {
    // A file the player cannot open is fetched again once: a damaged copy is the likely cause.
    if (!refetched) {
      refetched = true;
      releasePlayer();
      forgetDevotionalFile(current.entryId);
      await prepare(gen);
      return;
    }
    releasePlayer();
    fail(gen, "unavailable");
    return;
  }
  ready = true;
  const { rate, positionMs, status } = usePlayerStore.getState();
  try {
    opening.setPlaybackRate(rate, "high");
  } catch {
    // The speed is applied again at the next change.
  }
  activateLockScreen(opening, current);
  // A position chosen before the sound was ready (the scrubber was dragged, or the app was told where to start).
  if (positionMs > 0 && status !== "ended") await moveTo(positionMs);
  if (gen !== generation || player !== opening) return;
  if (wantsPlaying) await startPlayback(gen);
}

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  entryId: null,
  title: "",
  subtitle: "",
  durationMs: 0,
  positionMs: 0,
  status: "idle",
  isBuffering: false,
  error: null,
  rate: 1,
  ambientSound: "off",
  ambientVolume: 0.5,

  // The same entry does nothing, so reopening a reflection never resets its position. Another entry stops the one that
  // is playing and starts at 0, paused, while its audio is made ready in the background.
  load: (next, ambient) => {
    if (next.entryId === get().entryId) return;
    generation += 1;
    releasePlayer();
    track = next;
    wantsPlaying = false;
    restartFromStart = false;
    refetched = false;
    set({
      entryId: next.entryId,
      title: next.title,
      subtitle: next.subtitle,
      durationMs: next.durationMs,
      positionMs: 0,
      status: "paused",
      isBuffering: false,
      error: null,
    });
    if (!ambientSeeded) {
      ambientSeeded = true;
      set({ ambientSound: ambient.ambientSound, ambientVolume: ambient.ambientVolume });
    }
    void prepare(generation);
  },

  play: () => {
    const { entryId, status, error } = get();
    if (entryId === null || status === "playing") return;
    wantsPlaying = true;
    if (status === "ended") {
      restartFromStart = true;
      set({ positionMs: 0 });
    }
    // The sound has not started yet: the first report from the player says when it has.
    set({ status: "playing", isBuffering: true });
    if (error !== null) {
      // The audio could not be had last time: fetch it again, from the start.
      releasePlayer();
      refetched = false;
      forgetDevotionalFile(entryId);
      void prepare(generation);
      return;
    }
    if (ready) void startPlayback(generation);
    // Otherwise prepare() starts it when the file is ready.
  },

  pause: () => {
    wantsPlaying = false;
    if (get().status !== "playing") return;
    playRequested = false;
    const current = player;
    try {
      current?.pause();
    } catch {
      // Nothing to pause.
    }
    set({ status: "paused", isBuffering: false });
    if (current !== null && ready && seeking === 0) {
      update({ positionMs: clamp(current.currentTime * 1000, 0, get().durationMs) });
    }
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
    restartFromStart = false;
    if (positionMs >= durationMs) {
      wantsPlaying = false;
      playRequested = false;
      set({ positionMs, status: "ended", isBuffering: false });
      try {
        player?.pause();
      } catch {
        // Nothing to pause.
      }
      void moveTo(0);
      return;
    }
    set({ positionMs, status: status === "ended" ? "paused" : status });
    if (ready) void moveTo(positionMs);
  },

  skipBy: (deltaMs) => get().seekTo(get().positionMs + deltaMs),

  setRate: (rate) => {
    set({ rate });
    try {
      // The voice keeps its pitch at every speed.
      player?.setPlaybackRate(rate, "high");
    } catch {
      // Applied again with the next player.
    }
  },

  // The bed follows at once (the subscription at the end of this file). Now Playing also saves the choice as the default
  // the next devotional starts with; Profile changes only that default (step 15).
  setAmbient: (sound) => set({ ambientSound: sound }),

  setAmbientVolume: (volume) => set({ ambientVolume: clamp(volume, 0, 1) }),

  stop: () => {
    generation += 1;
    wantsPlaying = false;
    restartFromStart = false;
    refetched = false;
    track = null;
    releasePlayer();
    stopAmbient();
    ambientSeeded = false;
    set({
      entryId: null,
      title: "",
      subtitle: "",
      durationMs: 0,
      positionMs: 0,
      status: "idle",
      isBuffering: false,
      error: null,
      rate: 1,
      ambientSound: "off",
      ambientVolume: 0.5,
    });
  },

  reseedAmbient: () => {
    ambientSeeded = false;
  },
}));

// Back in the foreground: the lock screen, a headset or a call may have changed the player while JS was asleep, and no report
// is sent for what happened then.
AppState.addEventListener("change", (state) => {
  if (state !== "active" || player === null || !ready) return;
  try {
    reconcile(player.currentStatus);
  } catch {
    // Released.
  }
});

// ---- the ambient bed (step 27). It is heard only with the voice: it comes in when the voice is heard (not while the file is
// downloaded or opened), stays while the voice waits for data again, and goes when the devotional pauses, ends or another
// one is loaded. Because it follows this store, the lock screen, a headset and a call move it too.
let bedOn = false;
usePlayerStore.subscribe((state) => {
  if (state.status !== "playing") bedOn = false;
  else if (!state.isBuffering) bedOn = true;
  setAmbientBed({ sound: state.ambientSound, volume: state.ambientVolume, on: bedOn });
});

// A button that reached the ambient player instead of the devotional's (Android gives every player a media session) moves
// the devotional the same way, so the two never go apart.
// (play and pause do nothing when there is nothing to do.)
setAmbientRemoteHandler((command) => {
  const { play, pause } = usePlayerStore.getState();
  if (command === "pause") pause();
  else play();
});
