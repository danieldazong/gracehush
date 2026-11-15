import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { KEEP_AWAKE_TALK_TAG } from "@/constants/app";
import { stopAmbient, stopPreview } from "@/services/ambientPlayer";
import { setSessionMode } from "@/services/audioSession";
import { stopSample } from "@/services/samplePlayer";
import { stopScholarAudio } from "@/services/scholarPlayer";
import { usePlayerStore } from "@/store/playerStore";

// The app's own sound around a live talk (step 39). Before a talk the microphone and the speaker are the talk's: a devotional
// that is playing pauses, and the ambient bed, Profile's preview, Scholar's Listen and any sample or voice preview stop. During
// it the screen stays awake under its own tag. After it the app's playback mode comes back, so the next devotional plays with
// the silent switch on, as before (the talk's audio session belongs to LiveKit, which switches it off itself).

export function quietBeforeTalk(): void {
  usePlayerStore.getState().pause();
  stopAmbient();
  stopPreview();
  stopScholarAudio();
  stopSample();
}

export function holdAwake(on: boolean): void {
  const done = on ? activateKeepAwakeAsync(KEEP_AWAKE_TALK_TAG) : deactivateKeepAwake(KEEP_AWAKE_TALK_TAG);
  done.catch(() => undefined);
}

export async function restorePlaybackMode(): Promise<void> {
  await setSessionMode("playback");
}
