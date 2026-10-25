import { create } from "zustand";

// The transient state of the offline machinery (step 24). Not persisted: the database and the network are asked again at every
// start. The journal's data is never mirrored here: it lives in SQLite.
export type SavedNote = "offline" | "retry";

interface OfflineState {
  // The signed-in user's database is open and migrated, or it could not be opened. Neither is true while it is opening
  // and when nobody is signed in.
  dbReady: boolean;
  dbFailed: boolean;
  setDatabase: (state: "ready" | "failed" | "closed") => void;
  // What NetInfo last said. null is "not known yet": it counts as online for sending and shows no banner.
  netConnected: boolean | null;
  netReachable: boolean | null;
  // A request failed with NETWORK since NetInfo last changed or a request last got an answer.
  unreachable: boolean;
  // Every NetInfo event clears `unreachable`.
  setNet: (connected: boolean | null, reachable: boolean | null) => void;
  setUnreachable: (value: boolean) => void;
  // The calm line Journal shows after New Entry saved something that has not been prepared yet. Never a toast.
  savedNote: SavedNote | null;
  setSavedNote: (note: SavedNote | null) => void;
}

export const useOfflineStore = create<OfflineState>()((set) => ({
  dbReady: false,
  dbFailed: false,
  setDatabase: (state) => set({ dbReady: state === "ready", dbFailed: state === "failed" }),
  netConnected: null,
  netReachable: null,
  unreachable: false,
  setNet: (netConnected, netReachable) => set({ netConnected, netReachable, unreachable: false }),
  setUnreachable: (unreachable) => set({ unreachable }),
  savedNote: null,
  setSavedNote: (savedNote) => set({ savedNote }),
}));

type NetworkFacts = Pick<OfflineState, "netConnected" | "netReachable" | "unreachable">;

// For the banner and the "synced" toast: false when NetInfo says there is no connection or no internet, or a request has just
// failed; null while nothing is known yet; otherwise true.
export function selectIsOnline(state: NetworkFacts): boolean | null {
  if (state.unreachable || state.netConnected === false || state.netReachable === false) return false;
  if (state.netConnected === null && state.netReachable === null) return null;
  return true;
}

// For the sync engine: only what NetInfo knows. A failed request must not stop the retries that clear it.
export function selectCanSend(state: Pick<OfflineState, "netConnected" | "netReachable">): boolean {
  return state.netConnected !== false && state.netReachable !== false;
}
