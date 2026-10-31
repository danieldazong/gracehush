import { create } from "zustand";

import type { RealtimeStatus } from "@/types";

// The Realtime connection as the screens and the developer panel see it (step 33). Not persisted: it starts offline at every
// launch, and services/realtime.ts is the only writer of the status and the counts.
interface RealtimeState {
  // offline until the service starts, and while it is stopped or waits to try again; connecting while it asks for the token or
  // waits for the join; live once the channel is joined.
  status: RealtimeStatus;
  // Why it is offline, as one short word for the developer panel ("background", "unauthorized", ...): never the server's own
  // words, a topic or an id. null while live or connecting.
  reason: string | null;
  // The messages received since launch, and how often the channel came back after dropping while the app stayed in front.
  events: number;
  reconnects: number;
  // Development only: keeps Realtime stopped, so the step 25 polling can be watched.
  forcePolling: boolean;
  setStatus: (status: RealtimeStatus, reason?: string | null) => void;
  countEvent: () => void;
  countReconnect: () => void;
  setForcePolling: (value: boolean) => void;
}

export const useRealtimeStore = create<RealtimeState>()((set) => ({
  status: "offline",
  reason: null,
  events: 0,
  reconnects: 0,
  forcePolling: false,
  setStatus: (status, reason = null) => set({ status, reason }),
  countEvent: () => set((state) => ({ events: state.events + 1 })),
  countReconnect: () => set((state) => ({ reconnects: state.reconnects + 1 })),
  setForcePolling: (forcePolling) => set({ forcePolling }),
}));

export function selectRealtimeLive(state: Pick<RealtimeState, "status">): boolean {
  return state.status === "live";
}
