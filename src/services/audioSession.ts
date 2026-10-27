import { setAudioModeAsync, type AudioMode } from "expo-audio";

// The app's audio session has two modes, and this is the only file that calls setAudioModeAsync (step 26).
//
// Every call carries every field. On iOS the native side builds the whole mode from what it is given and fills a missing
// field with its own default (playsInSilentMode false, interruptionMode mixWithOthers, shouldPlayInBackground false), so a
// partial call such as { allowsRecording: false } quietly turned the silent-switch, background and lock-screen settings
// off: step 23's recorder made calls like that, and this file replaces them.
export type SessionMode = "playback" | "recording";

const MODES: Record<SessionMode, AudioMode> = {
  // A devotional: heard with the silent switch on, in the background and from the lock screen. doNotMix is what makes the
  // lock-screen card belong to this app (expo-audio's own requirement), and it stops other apps' sound while it plays.
  playback: {
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
    allowsRecording: false,
    shouldPlayInBackground: true,
    shouldRouteThroughEarpiece: false,
    allowsBackgroundRecording: false,
  },
  // A take: the microphone is allowed and the speaker stays the output. A take is never made in the background (step 23),
  // so playing in the background is off while one runs.
  recording: {
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
    allowsRecording: true,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
    allowsBackgroundRecording: false,
  },
};

// Never throws: a mode that cannot be set leaves the previous one in place. A recorder that really cannot record fails at
// prepare or record, and a player at play, which their callers already handle. Every call reaches the native side, so
// resuming a take sets its mode again, as it did before this file existed.
export async function setSessionMode(mode: SessionMode): Promise<boolean> {
  try {
    await setAudioModeAsync(MODES[mode]);
    return true;
  } catch {
    // Only the mode's name: a native error can carry more than that.
    if (__DEV__) console.warn(`[audio] the ${mode} session mode could not be set`);
    return false;
  }
}
