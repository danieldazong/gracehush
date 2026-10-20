import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";

import type { PermissionResult, RecorderStatus, RecordingResult } from "@/types";

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

// TEMP(23): replace internals with expo-audio, keep signatures
// A mock: nothing is recorded and the microphone is never opened. It reports a status every 100 ms with
// the elapsed time taken from the clock (never counted in ticks: JS timers run late when the device is
// busy) and a smoothed random level.
const STATUS_INTERVAL_MS = 100;

let recording: { startedAt: number; timer: ReturnType<typeof setInterval> } | null = null;

function clearRecording() {
  if (recording) {
    clearInterval(recording.timer);
    recording = null;
  }
}

export async function startRecording(onStatus: (status: RecorderStatus) => void): Promise<void> {
  clearRecording();
  const startedAt = Date.now();
  let level = 0.5;
  const timer = setInterval(() => {
    level = 0.6 * level + 0.4 * (0.15 + Math.random() * 0.75);
    onStatus({ isRecording: true, durationMs: Date.now() - startedAt, metering: level });
  }, STATUS_INTERVAL_MS);
  recording = { startedAt, timer };
}

export async function stopRecording(): Promise<RecordingResult> {
  if (!recording) {
    throw new Error("No recording is running");
  }
  const durationMs = Date.now() - recording.startedAt;
  clearRecording();
  return { uri: `mock://recording-${Date.now()}.m4a`, durationMs, mimeType: "audio/m4a" };
}

export async function cancelRecording(): Promise<void> {
  clearRecording();
}
