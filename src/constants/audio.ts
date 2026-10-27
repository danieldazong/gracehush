import { AudioQuality, IOSOutputFormat, type RecordingOptions } from "expo-audio";

import type { AudioMimeType } from "@/types";

// Speech, not music: AAC in an .m4a file, one channel, 64 kbps. That is about 0.5 MB a minute, so the longest
// recording (MAX_RECORDING_MS, 5:00) is about 2.4 MB, far under the function's limit below. `directory: "document"`
// keeps a take through an operating-system cache purge. `fileName` is one fixed name, so the take that was still
// being recorded when the app was killed (an .m4a is only valid once it is stopped) is overwritten by the next one
// instead of piling up; a finished take is moved to recordings/ by recordingFiles.ts. `isMeteringEnabled` feeds the
// waveform. `web` is required by the type and unused: this app has no web build.
export const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".m4a",
  fileName: "recording-in-progress",
  sampleRate: 44_100,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true,
  directory: "document",
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH },
  web: {},
};

// What the file is uploaded as, and what a process-entry request calls it. The bucket and the function both accept
// it (AudioMimeType in src/types, AUDIO_MIME_TYPES in process-entry).
export const RECORDING_MIME_TYPE: AudioMimeType = "audio/mp4";

// How often the recorder is read for the timer and the waveform.
export const METER_INTERVAL_MS = 100;

// The screen stays awake while a recording runs. Speaking aloud means no touches, so without this the phone would
// lock after its auto-lock time and the recording would pause every half minute or so.
export const KEEP_AWAKE_TAG = "gracehush-recording";

// A file under this is a recording that failed (a header and no sound).
export const MIN_RECORDING_FILE_BYTES = 1_024;

// Mirrors MAX_AUDIO_BYTES in supabase/functions/process-entry/constants.ts: the function refuses a larger file, so
// the phone does not upload one. Keep the two in sync.
export const MAX_RECORDING_FILE_BYTES = 12 * 1024 * 1024;

// ---- Playing a devotional (step 26)

// How often the player reports its position. Each report redraws the two places that show the clock.
export const PLAYER_UPDATE_MS = 250;

// Whether the audio session stays active while a devotional is paused or has finished. On iOS the lock-screen card
// belongs to the app that holds the session: with false the card goes away as soon as the player pauses, and the lock
// screen can no longer resume it. The price of true is that another app's music, which the devotional stopped, does not
// start again by itself: a devotional is a short, deliberate listen, and the session goes back to the system when the
// player is released (sign-out).
export const KEEP_SESSION_ACTIVE = true;

// How long a new player has to say that it has loaded its file before the audio counts as unavailable.
export const LOAD_TIMEOUT_MS = 10_000;

// The devotionals downloaded to the phone live in the cache folder (services/devotionalAudio.ts). Step 22 makes them WAV.
export const DEVOTIONAL_CACHE_FOLDER = "devotionals";
export const DEVOTIONAL_EXTENSION = ".wav";

// A download under this is not audio (a WAV header alone is 44 bytes).
export const MIN_DEVOTIONAL_FILE_BYTES = 1_024;

// The newest this many downloads are kept (about 5 MB each); older ones are deleted when a new one arrives.
export const MAX_CACHED_DEVOTIONALS = 12;

// How long the link that downloads one devotional is valid. It is used at once and never kept.
export const DEVOTIONAL_LINK_SECONDS = 300;

// How long the app waits for that link before the audio counts as needing a connection. A request with no connection can
// wait for minutes (a session token that cannot be refreshed), and a play that waited that long would start by itself when
// the connection came back.
export const DEVOTIONAL_LINK_TIMEOUT_MS = 15_000;
