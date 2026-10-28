import {
  AudioModule,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type AudioRecorder,
  type RecorderState,
} from "expo-audio";
import { createRecordingOptions } from "expo-audio/build/utils/options";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import {
  KEEP_AWAKE_TAG,
  METER_INTERVAL_MS,
  RECORDING_MIME_TYPE,
  RECORDING_OPTIONS,
} from "@/constants/audio";
import { stopAmbient } from "@/services/ambientPlayer";
import { setSessionMode } from "@/services/audioSession";
import { usePlayerStore } from "@/store/playerStore";
import type { PermissionResult, RecorderStatus, RecordingResult } from "@/types";
import { meterToLevel, smoothLevel } from "@/utils/audioLevels";

import { toPermissionResult } from "./permissions";

function warn(message: string, error: unknown) {
  if (__DEV__) {
    console.warn(`[recorder] ${message}`, error);
  }
}

export async function getMicPermission(): Promise<PermissionResult> {
  try {
    return toPermissionResult(await getRecordingPermissionsAsync());
  } catch (error) {
    warn("could not read the microphone permission", error);
    return "undetermined";
  }
}

export async function requestMicPermission(): Promise<PermissionResult> {
  try {
    return toPermissionResult(await requestRecordingPermissionsAsync());
  } catch (error) {
    warn("could not request the microphone permission", error);
    return "undetermined";
  }
}

// The recorder (step 23). One recording at a time. The native recorder is made when a recording starts and released
// when it ends, so opening New Entry or writing never touches the microphone, and a recorder that cannot start fails
// only the start.
//
// What expo-audio 58 does by itself (read in its native sources): when the app goes to the background, or a call or
// Siri takes the audio session, it pauses a recording; when the app comes back, or the interruption ends, it resumes
// a recording that IT paused, and since 58.0.6 leaves alone one the app paused. Gracehush never records without a
// tap, so pauseRecording takes the pause over (a pause the app made is never resumed by the library) and only
// resumeRecording, on a tap, starts the microphone again.
//
// Nothing here logs: a native error can carry a file path.

// A recorder that says it is recording while its clock stands still has stopped. iOS keeps saying "recording" when
// the system refused a start or a resume. The wait is long enough for a Bluetooth microphone, which can take a few
// seconds to start delivering sound, not to be taken for a stall.
const STALL_MS = 4_000;
// Not recording for this many reads in a row means someone else paused it (a call, Siri).
const IDLE_READS_BEFORE_PAUSED = 2;

type Session = {
  recorder: AudioRecorder;
  timer: ReturnType<typeof setInterval>;
  level: number; // the smoothed level, 0 to 1
  durationMs: number; // the longest length read so far
  advancedAt: number; // when `durationMs` last grew
  idleReads: number;
};

let session: Session | null = null;

// import/namespace reads AudioModule (a default export that expo-audio re-exports by name) as a namespace and cannot
// see its members, so the construction below goes through a typed alias instead of a rule disable.
const nativeAudio: typeof AudioModule = AudioModule;

function keepAwake(on: boolean) {
  const done = on ? activateKeepAwakeAsync(KEEP_AWAKE_TAG) : deactivateKeepAwake(KEEP_AWAKE_TAG);
  done.catch(() => undefined);
}

function releaseQuietly(recorder: AudioRecorder | null) {
  try {
    recorder?.release();
  } catch {
    // Already released.
  }
}

function deleteQuietly(uri: string | null) {
  try {
    if (!uri) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing more to do for a file that is already gone.
  }
}

async function endSession() {
  const current = session;
  session = null;
  if (!current) return;
  clearInterval(current.timer);
  releaseQuietly(current.recorder);
  keepAwake(false);
  // Back to the playback mode, so the next devotional uses the speaker, plays with the silent switch on and keeps the lock
  // screen (audioSession.ts). Best effort: a recorder that really cannot record fails at prepare or record.
  await setSessionMode("playback");
}

// One read of the native recorder, handed to the hook as the step 10 status shape. `metering` is 0 to 1 and smoothed;
// `isRecording` is false once the recorder has stood idle for two reads or its clock has stalled.
function read(current: Session, onStatus: (status: RecorderStatus) => void) {
  if (session !== current) return;
  let status: RecorderState;
  try {
    status = current.recorder.getStatus();
  } catch {
    return;
  }
  const now = Date.now();
  const durationMs = Math.max(0, status.durationMillis);
  if (durationMs > current.durationMs) {
    current.durationMs = durationMs;
    current.advancedAt = now;
  }
  const stalled = status.isRecording && now - current.advancedAt > STALL_MS;
  const capturing = status.isRecording && !stalled;
  current.idleReads = capturing ? 0 : current.idleReads + 1;
  current.level = smoothLevel(current.level, capturing ? meterToLevel(status.metering) : 0);
  onStatus({
    isRecording: capturing || current.idleReads < IDLE_READS_BEFORE_PAUSED,
    durationMs,
    metering: current.level,
  });
}

export async function startRecording(onStatus: (status: RecorderStatus) => void): Promise<void> {
  await endSession();
  // A devotional that is playing stops: the take must not hear it, and the microphone takes the audio session. The ambient
  // bed stops at once as well, with no fade, which would still be playing from the speaker when the microphone opens.
  usePlayerStore.getState().pause();
  stopAmbient();
  let recorder: AudioRecorder | null = null;
  try {
    await setSessionMode("recording");
    recorder = new nativeAudio.AudioRecorder(createRecordingOptions(RECORDING_OPTIONS));
    await recorder.prepareToRecordAsync();
    recorder.record();
  } catch (error) {
    releaseQuietly(recorder);
    await setSessionMode("playback");
    throw error;
  }
  keepAwake(true);
  const next: Session = {
    recorder,
    timer: setInterval(() => read(next, onStatus), METER_INTERVAL_MS),
    level: 0,
    durationMs: 0,
    advancedAt: Date.now(),
    idleReads: 0,
  };
  session = next;
}

// Holds a running recording. The library has often paused it already (see above); the call is still made, because it is
// what tells the library the pause is ours, so that it never resumes the microphone by itself.
export function pauseRecording(): void {
  const current = session;
  if (!current) return;
  try {
    current.recorder.pause();
  } catch {
    // Paused by the system already.
  }
  keepAwake(false);
}

// The tap on Resume. Throws when the system will not give the microphone back (a call is still going on).
export async function resumeRecording(): Promise<void> {
  const current = session;
  if (!current) throw new Error("No recording is running");
  await setSessionMode("recording");
  current.recorder.record();
  current.advancedAt = Date.now();
  current.idleReads = 0;
  keepAwake(true);
}

// Back in the foreground with a recording that is ours to keep paused: if the library resumed it anyway (an older
// expo-audio, or a pause that raced the system's), pause it again.
export function holdPaused(): void {
  const current = session;
  if (!current) return;
  try {
    if (current.recorder.getStatus().isRecording) current.recorder.pause();
  } catch {
    // Nothing to hold.
  }
}

// Finishes the take and hands back the raw file (the hook moves it to its final place). The audio session goes back to
// playback and the recorder is released whatever happens.
export async function stopRecording(): Promise<RecordingResult> {
  const current = session;
  if (!current) throw new Error("No recording is running");
  try {
    // iOS reports a length of 0 once the recorder has stopped, so it is read first.
    const durationMs = Math.max(0, current.recorder.getStatus().durationMillis);
    await current.recorder.stop();
    const uri = current.recorder.uri;
    if (!uri) throw new Error("The recording has no file");
    return { uri, durationMs, mimeType: RECORDING_MIME_TYPE };
  } finally {
    await endSession();
  }
}

// Throws the take away: stops the recorder and deletes its unfinished file.
export async function cancelRecording(): Promise<void> {
  const current = session;
  if (!current) return;
  let uri: string | null = null;
  try {
    uri = current.recorder.uri;
    await current.recorder.stop();
  } catch {
    // A recorder that already stopped can refuse; the file is deleted either way.
  }
  await endSession();
  deleteQuietly(uri);
}
