import gentlePiano from "@/assets/audio/ambient/gentle-piano.m4a";
import morningBirds from "@/assets/audio/ambient/morning-birds.m4a";
import softRain from "@/assets/audio/ambient/soft-rain.m4a";
import type { AmbientLoop } from "@/types";

// The ambient loops bundled with the app (step 27), one for each sound the chips offer. Each is a seamless loop made from a
// recording whose source and license are in assets/audio/ambient/LICENSES.md. The Record makes typecheck fail when a sound
// has no file. Only services/ambientPlayer.ts plays them.
export const sounds: Record<AmbientLoop, number> = {
  "soft-rain": softRain,
  "gentle-piano": gentlePiano,
  "morning-birds": morningBirds,
};
