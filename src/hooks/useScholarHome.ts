import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";

import { SCHOLAR_HOME_RECENTS } from "@/constants/app";
import { listConversations, readScholarFree, type FreeConversation } from "@/data/scholarRepository";
import type { ScholarConversation } from "@/types";

// What the Scholar tab shows (step 38): the latest few conversations, newest first, and whether more exist (the tab's "See all"
// opens the Conversations screen for the rest, 2026-11-16). It loads when the tab comes into focus and on pull to refresh; a
// load that finishes after a newer one started is dropped. The starters and the ask bar never wait for it. For an account that is
// not Pro (`readFree`, 2026-11-20) it also reads the free conversation on each focus: null while none is claimed, undefined until
// it is read or when it cannot be.
export type ScholarHomeState =
  | { phase: "loading" }
  | { phase: "ready"; conversations: ScholarConversation[]; hasMore: boolean; refreshing: boolean }
  | { phase: "error"; refreshing: boolean };

export function useScholarHome(readFree = false): {
  state: ScholarHomeState;
  refresh: () => void;
  free: FreeConversation | null | undefined;
} {
  const [state, setState] = useState<ScholarHomeState>({ phase: "loading" });
  const [free, setFree] = useState<FreeConversation | null | undefined>(undefined);
  const request = useRef(0);

  const load = useCallback((asRefresh: boolean) => {
    const id = ++request.current;
    if (asRefresh) {
      setState((previous) => (previous.phase === "loading" ? previous : { ...previous, refreshing: true }));
    }
    void listConversations({ limit: SCHOLAR_HOME_RECENTS }).then((result) => {
      if (id !== request.current) return;
      setState(
        result.ok
          ? {
              phase: "ready",
              conversations: result.data.conversations,
              hasMore: result.data.nextCursor !== null,
              refreshing: false,
            }
          : { phase: "error", refreshing: false },
      );
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(false);
      let current = true;
      if (readFree) {
        void readScholarFree().then((read) => {
          if (current) setFree(read);
        });
      }
      return () => {
        current = false;
        // A load still on its way when the tab loses focus is not shown.
        request.current += 1;
      };
    }, [load, readFree]),
  );

  const refresh = useCallback(() => load(true), [load]);
  return { state, refresh, free };
}
