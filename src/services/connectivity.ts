import NetInfo from "@react-native-community/netinfo";

import { useOfflineStore } from "@/store/offlineStore";

// Hands NetInfo's answers to the offline store (step 24). One listener for the app, started by the auth bridge. NetInfo
// calls the listener with the last known state as soon as it is added, and again at every change. Its internet check
// uses the system's own reachability (useNativeReachability is on by default), so the app configures nothing.
let unsubscribe: (() => void) | null = null;

export function startConnectivity(): void {
  if (unsubscribe !== null) return;
  unsubscribe = NetInfo.addEventListener((state) => {
    useOfflineStore.getState().setNet(state.isConnected, state.isInternetReachable);
  });
}

export function stopConnectivity(): void {
  unsubscribe?.();
  unsubscribe = null;
}

// A request failed with NETWORK or got an answer. Only the first one marks the network unreachable.
export function markUnreachable(): void {
  useOfflineStore.getState().setUnreachable(true);
}

export function markReachable(): void {
  if (useOfflineStore.getState().unreachable) useOfflineStore.getState().setUnreachable(false);
}
