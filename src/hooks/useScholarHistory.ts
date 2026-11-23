import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";

import { SCHOLAR_HISTORY_PAGE, SCHOLAR_SEARCH_DEBOUNCE_MS } from "@/constants/app";
import { deleteConversation, listConversations } from "@/data/scholarRepository";
import type { ScholarConversation } from "@/types";
import { appendPage, mergeFirstPage } from "@/utils/scholarHistory";

// What the Conversations screen loads (2026-11-16): every conversation, newest first, 30 at a time as the list is scrolled, and
// the ones whose title holds the words typed in the search (matched on the server, so all of them are searched and not only
// what has loaded; the search waits for the typing to pause). The first load shows a skeleton; coming back to the screen reads
// the first page again and merges it into the pages already loaded, so the list neither jumps nor keeps a conversation that was
// deleted meanwhile. A response that arrives after a newer request started, or after the screen lost focus, is dropped.
export type ScholarHistoryState =
  | { phase: "loading" }
  | { phase: "error" }
  | {
      phase: "ready";
      conversations: ScholarConversation[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreFailed: boolean;
      refreshing: boolean;
    };

export function useScholarHistory(query: string): {
  state: ScholarHistoryState;
  // The words being searched, once the typing has paused ("" while nothing is searched).
  applied: string;
  loadMore: () => void;
  retry: () => void;
  refresh: () => void;
  // Deletes a conversation for good (online only) and takes it out of the list: "offline" when there is no connection and
  // nothing was sent, "failed" when the server did not delete it.
  deleteOne: (id: string) => Promise<"ok" | "offline" | "failed">;
} {
  const [state, setState] = useState<ScholarHistoryState>({ phase: "loading" });
  const [applied, setApplied] = useState(() => query.trim());
  const request = useRef(0);
  // The search the list was last loaded for, and whether a list is on screen: a focus on the same search merges the first page
  // into it, a new search starts over.
  const loadedFor = useRef<string | null>(null);
  const hasList = useRef(false);
  const moreInFlight = useRef(false);

  // The search is applied once the typing has paused.
  useEffect(() => {
    const words = query.trim();
    if (words === applied) return undefined;
    const timer = setTimeout(() => setApplied(words), SCHOLAR_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, applied]);

  const load = useCallback((mode: "fresh" | "merge" | "refresh", words: string) => {
    const id = ++request.current;
    loadedFor.current = words;
    moreInFlight.current = false;
    if (mode === "fresh") {
      hasList.current = false;
      setState({ phase: "loading" });
    }
    if (mode === "refresh") {
      setState((previous) => (previous.phase === "ready" ? { ...previous, refreshing: true } : previous));
    }
    void listConversations({ limit: SCHOLAR_HISTORY_PAGE, query: words }).then((result) => {
      if (id !== request.current) return;
      if (!result.ok) {
        // A list already on screen stays; only an empty screen shows the error.
        setState((previous) => (previous.phase === "ready" ? { ...previous, refreshing: false } : { phase: "error" }));
        return;
      }
      hasList.current = true;
      const page = { conversations: result.data.conversations, nextCursor: result.data.nextCursor };
      setState((previous) => {
        const pages =
          mode === "merge" && previous.phase === "ready"
            ? mergeFirstPage({ conversations: previous.conversations, nextCursor: previous.nextCursor }, page)
            : page;
        return { phase: "ready", ...pages, loadingMore: false, moreFailed: false, refreshing: false };
      });
    });
  }, []);

  // On focus: the first load of a search starts over, every later focus on it merges the first page into what is loaded.
  useFocusEffect(
    useCallback(() => {
      load(loadedFor.current === applied && hasList.current ? "merge" : "fresh", applied);
      return () => {
        request.current += 1;
      };
    }, [load, applied]),
  );

  const loadMore = useCallback(() => {
    if (state.phase !== "ready" || state.nextCursor === null || state.loadingMore || state.refreshing) return;
    if (moreInFlight.current) return;
    moreInFlight.current = true;
    const id = request.current;
    setState({ ...state, loadingMore: true, moreFailed: false });
    void listConversations({ limit: SCHOLAR_HISTORY_PAGE, query: applied, cursor: state.nextCursor }).then((result) => {
      if (id !== request.current) return;
      moreInFlight.current = false;
      setState((previous) => {
        if (previous.phase !== "ready") return previous;
        if (!result.ok) return { ...previous, loadingMore: false, moreFailed: true };
        const pages = appendPage(
          { conversations: previous.conversations, nextCursor: previous.nextCursor },
          { conversations: result.data.conversations, nextCursor: result.data.nextCursor },
        );
        return { ...previous, ...pages, loadingMore: false, moreFailed: false };
      });
    });
  }, [state, applied]);

  const retry = useCallback(() => load("fresh", applied), [load, applied]);
  const refresh = useCallback(() => load("refresh", applied), [load, applied]);

  const deleteOne = useCallback(async (id: string) => {
    const result = await deleteConversation(id);
    if (!result.ok) return result.code === "NETWORK" ? "offline" : "failed";
    setState((previous) =>
      previous.phase === "ready"
        ? { ...previous, conversations: previous.conversations.filter((conversation) => conversation.id !== id) }
        : previous,
    );
    return "ok";
  }, []);

  return { state, applied, loadMore, retry, refresh, deleteOne };
}
