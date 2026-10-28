import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { AppState } from "react-native";

import {
  AMBIENT_FADE_IN_MS,
  AMBIENT_FADE_OUT_MS,
  AMBIENT_FADE_STEP_MS,
  AMBIENT_PREVIEW_MS,
  AMBIENT_REMOTE_GRACE_MS,
  AMBIENT_SWITCH_MS,
  AMBIENT_UPDATE_MS,
  MAX_AMBIENT_GAIN,
} from "@/constants/audio";
import { sounds } from "@/constants/sounds";
import type { AmbientLoop, AmbientSound } from "@/types";

// The ambient bed (step 27): a second expo-audio player that loops a bundled sound under the devotional, mixed on the phone.
// The player store says what it wants (setAmbientBed) and this file makes it so. Profile's preview plays the same player
// while no devotional is playing. It never touches the audio session (audioSession.ts does), the lock screen (the
// devotional's player owns it) or the speed (the bed always plays at 1x).
//
// What is heard is ambientGain(volume) times a fade from 0 to 1. A paused player is always left at volume 0, so a start
// that nobody here asked for (see onStatus) is silent until a fade brings it in.

// What the player store wants under the devotional: the session's sound and volume, and whether the voice is being heard.
export type AmbientBed = { sound: AmbientSound; volume: number; on: boolean };
// A play or a pause that reached this player from outside the app, which the player store turns into the same action on
// the devotional (see onStatus).
export type AmbientRemoteCommand = "play" | "pause";

type Output = { sound: AmbientLoop; volume: number; from: "bed" | "preview" };

let bed: AmbientBed = { sound: "off", volume: 0, on: false };
let preview: { sound: AmbientLoop; volume: number } | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
const previewListeners = new Set<() => void>();
let remoteHandler: ((command: AmbientRemoteCommand) => void) | null = null;

// ---- the native player. It is made when a sound is first needed and let go of when nothing will need it soon.
let player: AudioPlayer | null = null;
let subscription: { remove: () => void } | null = null;
let loaded: AmbientLoop | null = null;
// play() was called and pause() was not since (or the player started by itself and was not paused since).
let asked = false;
// 0 to 1: how far the current fade has come. 0 whenever the player is paused.
let fade = 0;
// ambientGain of the volume being heard.
let level = 0;
// What the player last played: a start that comes from outside counts for the devotional only after the bed.
let served: "bed" | "preview" | null = null;
let ramp: { timer: ReturnType<typeof setTimeout>; to: number } | null = null;
// When the app last called play, pause or replace. A report this soon after one can still describe the moment before it.
let lastCallAt = Number.NEGATIVE_INFINITY;
// A sound whose file would not play. It is not tried again until another sound is chosen.
let broken: AmbientLoop | null = null;

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

// The gain for a volume of 0 to 1: the volume squared, times MAX_AMBIENT_GAIN. Half the volume is a quarter of the gain,
// about 12 dB down, which sounds about half as loud. A volume outside 0 to 1, or not a number, is clamped first.
export function ambientGain(volume: number): number {
  const clamped = clamp01(volume);
  return clamped * clamped * MAX_AMBIENT_GAIN;
}

function goal(): Output | null {
  if (bed.on) {
    return bed.sound === "off" || bed.sound === broken ? null : { sound: bed.sound, volume: bed.volume, from: "bed" };
  }
  if (preview === null || preview.sound === broken) return null;
  return { sound: preview.sound, volume: preview.volume, from: "preview" };
}

function called() {
  lastCallAt = Date.now();
}

function applyVolume() {
  if (player === null) return;
  try {
    player.volume = level * fade;
  } catch {
    // Released.
  }
}

function cancelRamp() {
  if (ramp === null) return;
  clearTimeout(ramp.timer);
  ramp = null;
}

function isLoaded(): boolean {
  try {
    return player?.isLoaded === true;
  } catch {
    return false;
  }
}

// Moves the fade to `to`, in steps, over `fullMs` times the distance to go, and then settles again. Away from the foreground
// it jumps at once: JS timers are throttled there (Android stops them), so a fade could be left half done.
function fadeTo(to: number, fullMs: number) {
  cancelRamp();
  const from = fade;
  const ms = fullMs * Math.abs(to - from);
  if (ms < AMBIENT_FADE_STEP_MS || AppState.currentState !== "active") {
    fade = to;
    applyVolume();
    settle();
    return;
  }
  const startedAt = Date.now();
  const step = () => {
    const progress = Math.min(1, (Date.now() - startedAt) / ms);
    fade = from + (to - from) * progress;
    applyVolume();
    if (progress < 1) {
      ramp = { timer: setTimeout(step, AMBIENT_FADE_STEP_MS), to };
      return;
    }
    ramp = null;
    settle();
  };
  ramp = { timer: setTimeout(step, AMBIENT_FADE_STEP_MS), to };
}

// A fade that is running ends now, where it was going.
function finishRamp() {
  if (ramp === null) return;
  const { to } = ramp;
  cancelRamp();
  fade = to;
  applyVolume();
  settle();
}

// Lets go of the player. Never throws.
function release() {
  cancelRamp();
  const old = player;
  const oldSubscription = subscription;
  player = null;
  subscription = null;
  loaded = null;
  asked = false;
  fade = 0;
  served = null;
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

// The sound would not play. The devotional plays on without it, and a preview of it ends.
function fail(sound: AmbientLoop | null) {
  // Only that something failed: the choice of sound is the user's.
  if (__DEV__) console.warn("[ambient] the sound could not be played");
  broken = sound;
  release();
  if (preview !== null && preview.sound === sound) endPreview();
}

// Puts `sound` in the player: a new player the first time (looping, silent), the same player otherwise.
function open(sound: AmbientLoop): boolean {
  try {
    if (player === null) {
      const created = createAudioPlayer(sounds[sound], {
        updateInterval: AMBIENT_UPDATE_MS,
        // The devotional's player keeps the session while a devotional is loaded. This one never holds it on its own, so
        // the end of a preview hands the sound back to the other apps.
        keepAudioSessionActive: false,
        // With AirPlay, a player that hands its file to the receiver stops looping (expo-audio 58.0.0).
        allowsExternalPlayback: false,
      });
      player = created;
      subscription = created.addListener("playbackStatusUpdate", (status) => {
        if (player === created) onStatus(status);
      });
      created.loop = true;
      created.volume = 0;
      asked = false;
      fade = 0;
    } else {
      called();
      player.replace(sounds[sound]);
    }
    loaded = sound;
    return true;
  } catch {
    fail(sound);
    return false;
  }
}

// The state changes before the native call: a report the call sends must already find it.
function start() {
  if (player === null) return;
  fade = 0;
  applyVolume();
  asked = true;
  called();
  try {
    player.play();
  } catch {
    fail(loaded);
  }
}

function stopPlayer() {
  if (player === null) return;
  asked = false;
  fade = 0;
  applyVolume();
  called();
  try {
    player.pause();
  } catch {
    // Nothing to pause.
  }
}

// Silence: a fade out, then a pause. When nothing will need the sound soon (the bed is off and there is no preview), the
// player is let go of, so it holds no file and, on Android, no media session.
function quiet() {
  if (asked && fade > 0) {
    fadeTo(0, AMBIENT_FADE_OUT_MS);
    return;
  }
  cancelRamp();
  if (asked) stopPlayer();
  if (bed.sound === "off" && preview === null) release();
}

// Takes one step towards what is wanted now. Every change calls it, and so does the end of every fade.
function settle() {
  const target = goal();
  if (target === null) {
    quiet();
    return;
  }
  served = target.from;
  level = ambientGain(target.volume);
  if (loaded !== target.sound) {
    // Another sound: the one that is playing dips out first, and settle() runs again when it is silent.
    if (asked && fade > 0) {
      fadeTo(0, AMBIENT_SWITCH_MS);
      return;
    }
    if (!open(target.sound)) return;
  }
  if (!asked) start();
  if (fade >= 1) {
    applyVolume();
    return;
  }
  // The sound fades in once its file is open. Until then the first report that says it is open calls settle() again.
  if (isLoaded()) fadeTo(1, AMBIENT_FADE_IN_MS);
}

// A start or a stop that the app did not ask for. The lock screen never reaches this player (the devotional's player owns
// it), but the system stops and restarts every player around a call or an alarm, and on Android a headset or car button
// can land here: every expo-audio player has a media session of its own, and the one that started playing last gets the
// button. A stop of the bed is passed on as a pause of the devotional, and a start after the bed as a play of it, so the two
// never go apart. A report sent just before the app's own last call is not counted.
function onStatus(status: AudioStatus) {
  if (status.error) {
    fail(loaded);
    return;
  }
  if (Date.now() - lastCallAt >= AMBIENT_REMOTE_GRACE_MS) {
    // Paused for real, not merely waiting for data: iOS says "waiting", and Android is not loaded while it buffers.
    const stopped = !status.playing && status.isLoaded && status.timeControlStatus === "paused";
    if (asked && stopped) {
      remoteStop();
      return;
    }
    if (!asked && status.playing) {
      remoteStart();
      return;
    }
  }
  // The file is open: a fade-in that was waiting for it can begin.
  if (status.isLoaded && asked && fade < 1 && ramp === null) settle();
}

function remoteStop() {
  cancelRamp();
  asked = false;
  fade = 0;
  applyVolume();
  if (served === "preview") endPreview();
  else if (bed.on) remoteHandler?.("pause");
  settle();
}

function remoteStart() {
  // It is playing, at volume 0: nothing is heard until a fade brings it in.
  asked = true;
  if (served === "bed" && !bed.on) remoteHandler?.("play");
  // Anything that does not want it now pauses it again.
  settle();
}

function notifyPreview() {
  for (const listener of [...previewListeners]) listener();
}

function endPreview() {
  if (previewTimer !== null) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (preview === null) return;
  preview = null;
  notifyPreview();
}

// ---- for the player store

// What the devotional wants under it. The store calls it on every change, so nothing happens when nothing changed.
export function setAmbientBed(next: AmbientBed): void {
  const volume = clamp01(next.volume);
  if (next.sound === bed.sound && volume === bed.volume && next.on === bed.on) return;
  if (next.sound !== bed.sound) broken = null;
  bed = { sound: next.sound, volume, on: next.on };
  // The bed wins over a preview: the preview ends when a devotional starts (from the lock screen, for example).
  if (bed.on) endPreview();
  settle();
}

export function setAmbientRemoteHandler(handler: (command: AmbientRemoteCommand) => void): void {
  remoteHandler = handler;
}

// Everything off at once and the player let go of: a recording is about to start (the microphone must not hear the bed),
// or the user signs out.
export function stopAmbient(): void {
  endPreview();
  release();
}

// ---- for Profile

// Plays `sound` at `volume` for AMBIENT_PREVIEW_MS, with a fade in and out, or changes the preview that is playing (a new
// sound plays its full time again, a new volume is heard at once). Never over a devotional that is playing.
export function previewAmbient(sound: AmbientSound, volume: number): void {
  if (bed.on) return;
  if (sound === "off") {
    stopPreview();
    return;
  }
  const isNew = preview === null || preview.sound !== sound;
  if (isNew) broken = null;
  const starting = preview === null;
  preview = { sound, volume: clamp01(volume) };
  if (isNew) {
    if (previewTimer !== null) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      endPreview();
      settle();
    }, AMBIENT_PREVIEW_MS);
  }
  if (starting) notifyPreview();
  settle();
}

export function stopPreview(): void {
  if (preview === null) return;
  endPreview();
  settle();
}

export function isPreviewing(): boolean {
  return preview !== null;
}

export function subscribePreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

// Away from the foreground: a fade that is running ends at once (Android stops JS timers there), and a preview, which
// belongs to Profile, stops at once. A bed under a devotional plays on.
AppState.addEventListener("change", (state) => {
  if (state === "active") return;
  finishRamp();
  if (preview !== null) {
    endPreview();
    settle();
  }
});
