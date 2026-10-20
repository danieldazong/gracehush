import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { MAX_RECORDING_MS, WAVEFORM_BAR_COUNT } from "@/constants/app";
import {
  cancelRecording,
  getMicPermission,
  requestMicPermission,
  startRecording,
  stopRecording,
} from "@/services/recorder";
import type { RecorderStatus, RecordingResult } from "@/types";

export type RecorderState = "idle" | "requesting" | "denied" | "recording" | "recorded";

// "start" and "save" are the two messages step 23 reuses for a real recorder.
export type RecorderError = "start" | "save" | null;

const silence = () => Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0);

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

// Everything the Speak view needs from the recorder. A tap is the only thing that starts it. The state
// machine: idle -> (requesting) -> recording -> recorded, or denied when the microphone is off.
export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<RecorderError>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(silence);
  const [recording, setRecording] = useState<RecordingResult | null>(null);

  // The latest state for the AppState listener and the guards below. Written only in callbacks.
  const stateRef = useRef<RecorderState>("idle");
  // True while a start or a stop is on its way, so a second tap or the automatic stop cannot overlap.
  const busy = useRef(false);
  const mounted = useRef(false);

  const update = useCallback((next: RecorderState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const resetReading = useCallback(() => {
    setDurationMs(0);
    setLevels(silence());
  }, []);

  // Keeps what was recorded. Finish, the automatic stop at the limit and a backgrounded app all use it.
  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    if (stateRef.current !== "recording" || busy.current) return null;
    busy.current = true;
    try {
      const result = await stopRecording();
      const kept = { ...result, durationMs: Math.min(result.durationMs, MAX_RECORDING_MS) };
      setRecording(kept);
      setDurationMs(kept.durationMs);
      setLevels(silence());
      update("recorded");
      return kept;
    } catch {
      resetReading();
      setError("save");
      update("idle");
      return null;
    } finally {
      busy.current = false;
    }
  }, [resetReading, update]);

  const onStatus = useCallback(
    (status: RecorderStatus) => {
      setDurationMs(Math.min(status.durationMs, MAX_RECORDING_MS));
      setLevels((previous) => [...previous.slice(1), clamp01(status.metering)]);
      if (status.durationMs >= MAX_RECORDING_MS) {
        stop();
      }
    },
    [stop],
  );

  const start = useCallback(async () => {
    // A recording that exists is replaced only after discard(), never by a stray second start.
    if (busy.current || stateRef.current === "recording" || stateRef.current === "recorded") return;
    busy.current = true;
    setError(null);
    try {
      let permission = await getMicPermission();
      if (permission === "undetermined") {
        update("requesting");
        permission = await requestMicPermission();
      }
      if (!mounted.current) return;
      if (permission !== "granted") {
        update("denied");
        return;
      }
      resetReading();
      setRecording(null);
      await startRecording(onStatus);
      if (!mounted.current) {
        cancelRecording().catch(() => undefined);
        return;
      }
      update("recording");
    } catch {
      setError("start");
      update("idle");
    } finally {
      busy.current = false;
    }
  }, [onStatus, resetReading, update]);

  // Cancels a recording that is running and clears everything.
  const discard = useCallback(async () => {
    if (stateRef.current === "recording") {
      await cancelRecording().catch(() => undefined);
    }
    setError(null);
    setRecording(null);
    resetReading();
    update("idle");
  }, [resetReading, update]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (stateRef.current === "recording") {
        cancelRecording().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") {
        // TODO(23): real interruption handling (pause, resume)
        // Until then a recording that loses the screen is stopped and kept.
        if (stateRef.current === "recording") stop();
        return;
      }
      // Back from Settings: the card goes away by itself when the microphone was turned on.
      if (stateRef.current === "denied") {
        getMicPermission().then((permission) => {
          if (permission === "granted" && stateRef.current === "denied" && mounted.current) {
            update("idle");
          }
        });
      }
    });
    return () => subscription.remove();
  }, [stop, update]);

  return { state, error, durationMs, levels, recording, start, stop, discard };
}

export type Recorder = ReturnType<typeof useRecorder>;
