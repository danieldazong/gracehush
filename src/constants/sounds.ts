import gentlePiano from "@/assets/audio/ambient/gentle-piano.m4a";
import morningBirds from "@/assets/audio/ambient/morning-birds.m4a";
import softRain from "@/assets/audio/ambient/soft-rain.m4a";
import sampleDevotionalFile from "@/assets/audio/sample-devotional.m4a";
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
