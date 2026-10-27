import { Asset } from "expo-asset";
import type { AudioLockScreenOptions, AudioMetadata, AudioPlayer } from "expo-audio";

import { SKIP_MS } from "@/constants/app";
import { images } from "@/constants/images";
import type { PlaybackTrack } from "@/types";

// What the lock screen, Control Center, CarPlay, a headset and the Android notification show and can do while a devotional
// is loaded (step 26). Only the title and the scripture reference ever go on it: never the words, the emotion or the date.
// Nothing here throws or logs: a lock screen that cannot be set up leaves the devotional playable in the app.
type LockScreenTrack = Pick<PlaybackTrack, "title" | "subtitle">;

// The two skip buttons jump as far as the buttons in the app. Android draws a numbered icon for 5, 10, 15 and 30 seconds.
const OPTIONS: AudioLockScreenOptions = {
  showSeekForward: true,
  showSeekBackward: true,
  seekForwardIntervalSeconds: SKIP_MS / 1000,
  seekBackwardIntervalSeconds: SKIP_MS / 1000,
};

// The artwork is a file address: expo-audio hands it to the system, which loads it itself. The bundled picture is turned
// into a local file once (in development Metro serves it, in a build it is already on the phone). A failure is not kept,
// so the next devotional tries again.
let artworkUrl: string | null = null;

async function resolveArtwork(): Promise<string | null> {
  try {
    const asset = Asset.fromModule(images.playerArtwork);
    await asset.downloadAsync();
    artworkUrl = asset.localUri ?? null;
  } catch {
    artworkUrl = null;
  }
  return artworkUrl;
}

function metadata(track: LockScreenTrack, artwork: string | null): AudioMetadata {
  return artwork === null
    ? { title: track.title, artist: track.subtitle }
    : { title: track.title, artist: track.subtitle, artworkUrl: artwork };
}

// Puts the player on the lock screen. The controls appear at once; the artwork is added when it is ready, because the
// first lookup can take a moment and must not hold the controls back.
export function activateLockScreen(player: AudioPlayer, track: LockScreenTrack): void {
  try {
    player.setActiveForLockScreen(true, metadata(track, artworkUrl), OPTIONS);
  } catch {
    return;
  }
  if (artworkUrl !== null) return;
  void resolveArtwork().then((artwork) => {
    if (artwork === null) return;
    try {
      // Has no effect when the player is not the active one any more (another devotional, or sign-out).
      player.updateLockScreenMetadata(metadata(track, artwork));
    } catch {
      // The player was released while the picture was loading.
    }
  });
}

export function clearLockScreen(player: AudioPlayer): void {
  try {
    player.clearLockScreenControls();
  } catch {
    // Already released.
  }
}
