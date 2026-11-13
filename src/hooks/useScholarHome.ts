import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";

import { listConversations } from "@/data/scholarRepository";
import type { ScholarConversation } from "@/types";

// What the Scholar tab shows (step 38): the recent conversations, newest first. It loads when the tab comes into focus and on
// pull to refresh; a load that finishes after a newer one started is dropped. The starters and the ask bar never wait for it.
export type ScholarHomeState =
  | { phase: "loading" }
  | { phase: "ready"; conversations: ScholarConversation[]; refreshing: boolean }
  | { phase: "error"; refreshing: boolean };

export function useScholarHome(): { state: ScholarHomeState; refresh: () => void } {
  const [state, setState] = useState<ScholarHomeState>({ phase: "loading" });
  const request = useRef(0);

  const load = useCallback((asRefresh: boolean) => {
    const id = ++request.current;
    if (asRefresh) {
      setState((previous) => (previous.phase === "loading" ? previous : { ...previous, refreshing: true }));
    }
    void listConversations().then((result) => {
      if (id !== request.current) return;
      setState(result.ok ? { phase: "ready", conversations: result.data, refreshing: false } : { phase: "error", refreshing: false });
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(false);
      return () => {
        // A load still on its way when the tab loses focus is not shown.
        request.current += 1;
      };
    }, [load]),
  );

  const refresh = useCallback(() => load(true), [load]);
  return { state, refresh };
}
