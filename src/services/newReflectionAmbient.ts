import { NEW_REFLECTION_AMBIENT } from "@/constants/audio";
import { updateProfile } from "@/data/journalRepository";
import { subscribe as subscribeToSync } from "@/services/syncEngine";
import { usePlayerStore } from "@/store/playerStore";

// Every reflection made on this phone starts with Gentle Piano at 100% under its devotional (2026-11-20, the owner's request).
// When the sync engine finishes one (a heavy moment too: it is a reflection like any other), its devotional is marked so that
// its first load takes NEW_REFLECTION_AMBIENT, and the same choice is saved as the default, as a chip on Now Playing saves it.
// The person can then lower the volume, change the sound or turn it off, and that choice is saved as before, until the next
// reflection is made. A devotional that is already playing keeps its sound, and nothing starts playing by itself. The auth
// bridge starts it with the signed-in session and stops it when the session ends.
let stopListening: (() => void) | null = null;

export function startNewReflectionAmbient(): void {
  stopNewReflectionAmbient();
  stopListening = subscribeToSync((event) => {
    if (event.type !== "finished") return;
    usePlayerStore.getState().markNewReflection(event.entryId);
    void updateProfile(NEW_REFLECTION_AMBIENT);
  });
}

export function stopNewReflectionAmbient(): void {
  stopListening?.();
  stopListening = null;
}
