import { usePlayerStore } from "@/store/playerStore";

// The only way a screen or a component reads the player. It returns the whole store, so the caller re-renders
// on every tick: only the components that show the clock call it (MiniPlayerCard's AudioCard and
// NowPlayingScreen), and the Reflection screen itself must not.
export function usePlayback() {
  return usePlayerStore();
}
