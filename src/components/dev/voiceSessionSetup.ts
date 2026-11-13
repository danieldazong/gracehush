import { createConnection, setSetupStrategy, setupWebRTCSession } from "@elevenlabs/client/internal";
import { AndroidAudioTypePresets, AudioDeviceModule, AudioEngineMuteMode, AudioSession } from "@livekit/react-native";
import { Platform } from "react-native";

// Live voice (step 39), the TEST RUN: the voice session's setup, in place of the one @elevenlabs/react-native 1.2.39
// registers (its newest release, with @elevenlabs/client 1.36.0). Theirs ends a talk in the wrong order: it switches the
// iPhone's audio session off before it closes the connection, iOS refuses while the microphone and the speaker run
// ("Session deactivation failed"), and that error skips the close, so the talk stays connected (found on the phone on
// 2026-11-12: it ran on to the agent's 10-minute limit). Theirs also never gives the audio session back when a talk fails
// to connect. This copy is theirs but for those two things, the microphone's mute mode below, and the native volume levels,
// which their package does not export. Step 39's voice service carries the same fixes.
//
// Installed right before each talk starts: their package registers its own setup when its module is first evaluated, so
// installing at the start of a talk always wins.

type SessionEventKind =
  | "audio_session_released"
  | "audio_session_release_failed"
  | "mic_mute_mode_set"
  | "mic_mute_mode_failed";
type SessionEvent = (kind: SessionEventKind, detail: number | boolean | string) => void;
type SetupStrategy = Parameters<typeof setSetupStrategy>[0];

// The waits before each try at switching the audio session off. The microphone and the speaker stop a moment after the
// connection closes, and iOS refuses to switch off while they run. The last try comes 1.85 s after the close.
export const RELEASE_WAITS_MS = [100, 250, 500, 1_000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Never throws, so the SDK always goes on to close its input and output after it.
async function releaseAudioSession(onEvent?: SessionEvent): Promise<void> {
  for (let index = 0; index < RELEASE_WAITS_MS.length; index += 1) {
    await wait(RELEASE_WAITS_MS[index]);
    try {
      await AudioSession.stopAudioSession();
      onEvent?.("audio_session_released", index + 1);
      return;
    } catch {
      // Still running: try again after the next wait.
    }
  }
  onEvent?.("audio_session_release_failed", RELEASE_WAITS_MS.length);
}

// iPhone only. With LiveKit's default mute mode (voice processing), the mute applied when a talk's microphone track stops
// at End stays on iOS's voice-processing unit while the library reports the microphone unmuted, so every later talk in
// the same app session captures silence (ElevenLabs issue 991 and LiveKit issue 422, both open; found on the phone on
// 2026-11-12: only the first talk after the app started heard the person, although the engine reported recording and
// unmuted in every talk). In the input mixer mode a mute never touches the voice-processing unit, so nothing is left
// behind for the next talk. Set before each talk connects; it cannot stop a talk. The event carries the mode it found
// (0 is voice processing, 2 the input mixer).
async function setInputMixerMute(onEvent?: SessionEvent): Promise<void> {
  let before: number | string = "unknown";
  try {
    before = AudioDeviceModule.getMuteMode();
  } catch {
    // Read for the log only: the mode is set whatever it was.
  }
  try {
    await AudioDeviceModule.setMuteMode(AudioEngineMuteMode.InputMixer);
    onEvent?.("mic_mute_mode_set", before);
  } catch {
    onEvent?.("mic_mute_mode_failed", before);
  }
}

export function installVoiceSessionSetup(onEvent?: SessionEvent): void {
  const strategy: SetupStrategy = async (options) => {
    if (options.connectionType === "websocket" || options.signedUrl) {
      throw new Error("Only WebRTC talks are supported on a phone.");
    }
    await AudioSession.configureAudio({
      android: { preferredOutputList: ["speaker"], audioTypeOptions: AndroidAudioTypePresets.communication },
      ios: { defaultOutput: "speaker" },
    });
    await AudioSession.startAudioSession();
    if (Platform.OS === "ios") {
      await setInputMixerMute(onEvent);
    }
    let session: Awaited<ReturnType<SetupStrategy>>;
    try {
      session = setupWebRTCSession(await createConnection(options));
    } catch (error) {
      await releaseAudioSession(onEvent);
      throw error;
    }
    const { connection } = session;
    return {
      ...session,
      detach: async () => {
        // The connection first: it stops the microphone's track and leaves the call, so the audio can stop.
        connection.close();
        await releaseAudioSession(onEvent);
      },
    };
  };
  setSetupStrategy(strategy);
}
