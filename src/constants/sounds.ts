import gentlePiano from "@/assets/audio/ambient/gentle-piano.m4a";
import morningBirds from "@/assets/audio/ambient/morning-birds.m4a";
import softRain from "@/assets/audio/ambient/soft-rain.m4a";
import sampleDevotionalFile from "@/assets/audio/sample-devotional.m4a";
import voiceBright from "@/assets/audio/scholar-voices/bright.mp3";
import voiceClear from "@/assets/audio/scholar-voices/clear.mp3";
import voiceDeep from "@/assets/audio/scholar-voices/deep.mp3";
import voiceSoft from "@/assets/audio/scholar-voices/soft.mp3";
import voiceSteady from "@/assets/audio/scholar-voices/steady.mp3";
import voiceStoryteller from "@/assets/audio/scholar-voices/storyteller.mp3";
import voiceWarm from "@/assets/audio/scholar-voices/warm.mp3";
import voiceWise from "@/assets/audio/scholar-voices/wise.mp3";
import type { ScholarVoiceKey } from "@/constants/scholarVoices";
import type { AmbientLoop } from "@/types";

// The ambient loops bundled with the app (step 27), one for each sound the chips offer. Each is a seamless loop made from a
// recording whose source and license are in assets/audio/ambient/LICENSES.md. The Record makes typecheck fail when a sound
// has no file. Only services/ambientPlayer.ts plays them.
export const sounds: Record<AmbientLoop, number> = {
  "soft-rain": softRain,
  "gentle-piano": gentlePiano,
  "morning-birds": morningBirds,
};

// The Welcome step's sample (2026-11-01, round 8, remade twice the same day): the first 20.5 seconds of a short devotional
// written for the Welcome in the voice the prompt asks for, read by the app's own text-to-speech voice (Aoede at 0.88), with
// the Gentle Piano loop mixed under it on the PC at the app's full ambient level; the voice and the piano fade out together
// through the last three seconds, in the middle of a sentence, so more of the devotional plainly remains (AAC 96 kbps,
// stereo, 44.1 kHz, 252 KB). The words and the recipe are in AGENTS.md's "Round 8 follow-up" entries. Only
// services/samplePlayer.ts plays it.
export const sampleDevotional: number = sampleDevotionalFile;

// Scholar's voice previews (step 39): each of the eight live-talk voices saying the talk's opening line ("Hi, I’m Scholar,
// GraceHush’s AI Bible companion. What’s on your heart today?"), made with ElevenLabs' speech API in each voice's own agent model
// for the voice pack (2026-11-13), its ID3 tag removed (MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono, 5.6 to 6.4 s, 89 to 102 KB).
// Only services/samplePlayer.ts plays them, from the voice rows.
export const scholarVoicePreviews: Record<ScholarVoiceKey, number> = {
  warm: voiceWarm,
  bright: voiceBright,
  clear: voiceClear,
  soft: voiceSoft,
  storyteller: voiceStoryteller,
  deep: voiceDeep,
  steady: voiceSteady,
  wise: voiceWise,
};
