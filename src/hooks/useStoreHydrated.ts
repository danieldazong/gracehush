import { useSyncExternalStore } from "react";

// The part of a persisted zustand store this hook reads, so any persisted store fits.
interface PersistedStore {
  persist: {
    hasHydrated(): boolean;
    onFinishHydration(callback: () => void): () => void;
  };
}

// True once a persisted store has loaded its saved state. useSyncExternalStore unsubscribes on unmount
// and needs no state set inside an effect. zustand's persist functions are closures, so passing them
// unbound is safe.
export function useStoreHydrated(store: PersistedStore): boolean {
  return useSyncExternalStore(store.persist.onFinishHydration, store.persist.hasHydrated);
}
