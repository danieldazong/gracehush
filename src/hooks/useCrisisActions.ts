import { useCallback, useState } from "react";

import {
  openCall,
  openText,
  openWeb,
  type CrisisLinkResult,
} from "@/services/crisisLinks";
import { useDevStore } from "@/store/devStore";
import type { CrisisAction, CrisisActionKind } from "@/types";

export type CrisisFallback = { kind: CrisisActionKind; value: string; body?: string };

// The one place for "run a crisis action, and show the fallback sheet when the phone cannot open it". Only the
// Reflection crisis view and Support Resources call it.
export function useCrisisActions() {
  // The value stays after the sheet closes, so the sheet's slide-out never draws an empty sheet.
  const [fallback, setFallback] = useState<CrisisFallback | null>(null);
  const [fallbackVisible, setFallbackVisible] = useState(false);

  const run = useCallback(async (action: CrisisAction) => {
    let result: CrisisLinkResult;
    const dev = useDevStore.getState();
    if (__DEV__ && dev.nextCrisisLinkFails) {
      dev.setNextCrisisLinkFails(false); // one-shot, like nextReflectionLoadFails
      result = { ok: false, fallback: action.value };
    } else if (action.kind === "call") {
      result = await openCall(action.value);
    } else if (action.kind === "text") {
      result = await openText(action.value, action.body);
    } else {
      result = await openWeb(action.value);
    }
    if (!result.ok) {
      setFallback({ kind: action.kind, value: result.fallback, body: action.body });
      setFallbackVisible(true);
    }
  }, []);

  const closeFallback = useCallback(() => setFallbackVisible(false), []);

  return { fallback, fallbackVisible, run, closeFallback };
}
