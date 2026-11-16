import { useEffect } from "react";
import { NativeEventEmitter, NativeModules } from "react-native";

import { orbLevel } from "@/utils/orbLevel";
import { settleDrive, type VoiceDrive, voiceBands } from "@/utils/orbShape";

// The voice orb's ears (2026-11-15): LiveKit's native volume processor (the same one LiveKit's own hooks use) for one of the
// talk's two audio tracks, which the Talk screen finds in the room. Each report becomes a voice, [level, low, mid, high], that
// rises at once and settles over about a second (`settleDrive`), and is handed to the orb that is drawn (the shader orb's
// shared values, or the image orb's animated values), so a report costs no React render. This file reads the native module
// through react-native and imports nothing from LiveKit or ElevenLabs: only the Talk screen and the voice session do (a check
// keeps it so). If the processor cannot be had (a build without the module, a track the native side does not find), the orb
// still moves with the talk's state; it only loses the reaction to the voice.

// A LiveKit audio track by the two ids its native volume processor takes: the pair LiveKit's own hook reads.
export type OrbTrack = { peerConnectionId: number; trackId: string };

// Where a track's voice goes: the orb that is drawn.
export type LevelSink = { set: (voice: VoiceDrive) => void; clear: () => void };

// The native processor's request: five bands across the range of a voice, a report every 40 ms.
const PROCESSOR = { bands: 5, minFrequency: 120, maxFrequency: 6_000, updateInterval: 40 };
const LEVEL_EVENT = "LK_MULTIBAND_PROCESSED";
const SILENT: VoiceDrive = [0, 0, 0, 0];

// LiveKit's native module, as far as the orb uses it. `addListener` and `removeListeners` are what an event emitter module
// answers to; the other two make and delete a volume processor, and are the calls LiveKit's own hook makes.
type LiveKitNative = {
  createMultibandVolumeProcessor: (
    options: typeof PROCESSOR,
    peerConnectionId: number,
    trackId: string,
  ) => string | null | undefined;
  deleteMultibandVolumeProcessor: (tag: string, peerConnectionId: number, trackId: string) => void;
  addListener: (eventType: string) => void;
  removeListeners: (count: number) => void;
};

function liveKitNative(): LiveKitNative | null {
  const found = NativeModules.LivekitReactNativeModule as LiveKitNative | undefined;
  return found !== undefined && typeof found.createMultibandVolumeProcessor === "function" ? found : null;
}

let emitter: NativeEventEmitter | null = null;
function levelEmitter(native: LiveKitNative): NativeEventEmitter {
  emitter ??= new NativeEventEmitter(native);
  return emitter;
}

// The bands of a report for the processor with this tag; anything else is not for us.
function readBands(event: unknown, tag: string): readonly number[] | null {
  if (typeof event !== "object" || event === null) return null;
  const { id, magnitudes } = event as { id?: unknown; magnitudes?: unknown };
  return id === tag && Array.isArray(magnitudes) ? (magnitudes as readonly number[]) : null;
}

// Development only: what the native processors reported and which orb draws them, for the walk-through to read through the
// inspector (the levels themselves run on the UI thread and cannot be read from JavaScript). Nothing is collected in a release
// build.
type SourceDebug = { reports: number; last: number; peak: number };
const levelDebug: {
  native: boolean;
  renderer: "shader" | "images" | null;
  agent: SourceDebug;
  mic: SourceDebug;
} = {
  native: false,
  renderer: null,
  agent: { reports: 0, last: 0, peak: 0 },
  mic: { reports: 0, last: 0, peak: 0 },
};
export function getOrbLevelDebug() {
  return levelDebug;
}
export function noteOrbRenderer(renderer: "shader" | "images") {
  if (__DEV__) levelDebug.renderer = renderer;
}

// One track's voice into one sink, for as long as the track exists. The native processor is made when the track appears and
// deleted when it goes, and the sink is set back to silence.
export function useTrackLevel(track: OrbTrack | null, source: "agent" | "mic", sink: LevelSink) {
  const peerConnectionId = track?.peerConnectionId ?? null;
  const trackId = track?.trackId ?? null;
  useEffect(() => {
    if (peerConnectionId === null || trackId === null) return undefined;
    const native = liveKitNative();
    if (native === null) return undefined;
    let tag: string | null | undefined;
    try {
      tag = native.createMultibandVolumeProcessor(PROCESSOR, peerConnectionId, trackId);
    } catch {
      return undefined;
    }
    if (typeof tag !== "string") return undefined;
    const processor = tag;
    if (__DEV__) levelDebug.native = true;
    let held: VoiceDrive = SILENT;
    const subscription = levelEmitter(native).addListener(LEVEL_EVENT, (event: unknown) => {
      const bands = readBands(event, processor);
      if (bands === null) return;
      const [low, mid, high] = voiceBands(bands);
      const reported: VoiceDrive = [orbLevel(bands), low, mid, high];
      held = settleDrive(held, reported);
      if (__DEV__) {
        const seen = levelDebug[source];
        seen.reports += 1;
        seen.last = reported[0];
        seen.peak = Math.max(seen.peak, reported[0]);
      }
      sink.set(held);
    });
    return () => {
      subscription.remove();
      try {
        native.deleteMultibandVolumeProcessor(processor, peerConnectionId, trackId);
      } catch {
        // The track is gone with its processor.
      }
      sink.clear();
    };
  }, [peerConnectionId, trackId, source, sink]);
}
