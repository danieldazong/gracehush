import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { MAX_RECORDING_MS, WAVEFORM_BAR_COUNT } from "@/constants/app";
import {
  cancelRecording,
  getMicPermission,
  holdPaused,
  pauseRecording,
  requestMicPermission,
  resumeRecording,
  startRecording,
  stopRecording,
} from "@/services/recorder";
import { deleteRecording, finalizeRecording } from "@/services/recordingFiles";
import type { RecordedAudio, RecorderStatus } from "@/types";

export type RecorderState = "idle" | "requesting" | "denied" | "recording" | "paused" | "recorded";

// "start" and "save" were the step 10 messages. "resume" is new in step 23: the system would not give the
// microphone back (a call is still going on).
export type RecorderError = "start" | "save" | "resume" | null;

const silence = () => Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0);

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

// Everything the Speak view needs from the recorder. A tap is the only thing that starts or resumes it. The state
// machine: idle -> (requesting) -> recording -> recorded, with recording <-> paused when the app is left or something
// else takes the microphone, and denied when the microphone is off. `clientEntryId` names the finished file
// (recordings/{clientEntryId}.m4a): the screen makes one per entry and passes it in.
export function useRecorder(clientEntryId: string) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<RecorderError>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(silence);
  const [recording, setRecording] = useState<RecordedAudio | null>(null);

  // The latest state for the AppState listener and the guards below. Written only in callbacks.
  const stateRef = useRef<RecorderState>("idle");
  // True while a start, a resume or a stop is on its way, so a second tap or the automatic stop cannot overlap.
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

  // Holds a running recording. It happens by itself when the app goes to the background or another app takes the
  // microphone; the take is kept and only a tap on the orb continues it.
  const hold = useCallback(() => {
    if (stateRef.current !== "recording") return;
    pauseRecording();
    setLevels(silence());
    update("paused");
  }, [update]);

  // Keeps what was recorded: stops the recorder, then moves the file to recordings/{clientEntryId}.m4a. Finish, the
  // automatic stop at the limit and the orb all use it, from recording or from paused.
  const stop = useCallback(async (): Promise<RecordedAudio | null> => {
    const from = stateRef.current;
    if ((from !== "recording" && from !== "paused") || busy.current) return null;
    busy.current = true;
    try {
      const raw = await stopRecording();
      const saved = await finalizeRecording(raw.uri, clientEntryId);
      const kept: RecordedAudio = {
        clientEntryId,
        uri: saved.uri,
        sizeBytes: saved.sizeBytes,
        durationMs: Math.min(raw.durationMs, MAX_RECORDING_MS),
        mimeType: raw.mimeType,
      };
      setRecording(kept);
      setDurationMs(kept.durationMs);
      setLevels(silence());
      update("recorded");
      return kept;
    } catch {
      await deleteRecording(clientEntryId);
      resetReading();
      setError("save");
      update("idle");
      return null;
    } finally {
      busy.current = false;
    }
  }, [clientEntryId, resetReading, update]);

  const onStatus = useCallback(
    (status: RecorderStatus) => {
      setDurationMs(Math.min(status.durationMs, MAX_RECORDING_MS));
      setLevels((previous) => [...previous.slice(1), clamp01(status.metering)]);
      if (status.durationMs >= MAX_RECORDING_MS) {
        stop();
      } else if (!status.isRecording && !busy.current) {
        hold();
      }
    },
    [hold, stop],
  );

  const start = useCallback(async () => {
    // A take that exists is replaced only after discard(), never by a stray second start.
    const current = stateRef.current;
    if (busy.current || current === "recording" || current === "paused" || current === "recorded") return;
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

  // The tap on the orb while paused. If the system will not give the microphone back, the take stays paused.
  const resume = useCallback(async () => {
    if (stateRef.current !== "paused" || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await resumeRecording();
      update("recording");
    } catch {
      setError("resume");
    } finally {
      busy.current = false;
    }
  }, [update]);

  // Throws the take away: stops a recorder that is running and deletes the file, wherever it is.
  const discard = useCallback(async () => {
    const current = stateRef.current;
    if (current === "recording" || current === "paused") {
      await cancelRecording().catch(() => undefined);
    } else if (current === "recorded") {
      await deleteRecording(clientEntryId);
    }
    setError(null);
    setRecording(null);
    resetReading();
    update("idle");
  }, [clientEntryId, resetReading, update]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = stateRef.current;
      if (current === "recording" || current === "paused") {
        cancelRecording().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "background") {
        hold();
        return;
      }
      if (status !== "active") return;
      // Back in the foreground: a paused take stays paused until a tap, even if the library resumed it.
      if (stateRef.current === "paused") holdPaused();
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
  }, [hold, update]);

  return { state, error, durationMs, levels, recording, start, resume, stop, discard };
}

export type Recorder = ReturnType<typeof useRecorder>;
