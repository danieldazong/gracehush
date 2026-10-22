import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import { getProfile, getUsage, listEntries, updateProfile } from "@/data/journalRepository";
import { getSyncSummary } from "@/data/selectors";
import { getNotificationPermission } from "@/services/notifications";
import { getCurrentOffering, isTrialEligible } from "@/services/purchases";
import { useDevStore } from "@/store/devStore";
import type { PermissionResult, PlanUsage, ProfilePatch, RepoResult, UserProfile } from "@/types";

type SyncSummary = { synced: number; pending: number };

export type ProfileSettingsState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      profile: UserProfile;
      usage: PlanUsage;
      syncSummary: SyncSummary;
      notificationStatus: PermissionResult;
      // Whether the store would give this user the yearly plan's free trial (the plan card's button label).
      trialEligible: boolean;
      refresh: () => Promise<void>;
      refreshing: boolean;
      save: (patch: ProfilePatch) => Promise<RepoResult<UserProfile>>;
    };

// What a load produced, with the key it was for (the mock scenario and the mock plan): data loaded for another
// key is not shown.
type LoadResult =
  | {
      key: string;
      status: "ready";
      profile: UserProfile;
      usage: PlanUsage;
      syncSummary: SyncSummary;
      notificationStatus: PermissionResult;
      trialEligible: boolean;
    }
  | { key: string; status: "error" };

// Whether the yearly plan's free trial is on offer to this user. It only labels a button, so a failure of the
// purchases service counts as "no trial" and never breaks Profile.
async function readTrialEligible(): Promise<boolean> {
  try {
    const offering = await getCurrentOffering();
    const annual = offering?.packages.find((pkg) => pkg.kind === "annual");
    return annual === undefined ? false : await isTrialEligible(annual.id);
  } catch {
    return false;
  }
}

// The fields of `profile` that `patch` is about to replace: what a failed save puts back.
function pickTouched(profile: UserProfile, patch: ProfilePatch): ProfilePatch {
  const touched: ProfilePatch = {};
  if (patch.affirmationsEnabled !== undefined) touched.affirmationsEnabled = profile.affirmationsEnabled;
  if (patch.ambientSound !== undefined) touched.ambientSound = profile.ambientSound;
  if (patch.ambientVolume !== undefined) touched.ambientVolume = profile.ambientVolume;
  return touched;
}

// Puts `profile` or `changes` onto a ready result of this key. Any other result comes back as it is.
function withProfile(
  result: LoadResult | null,
  key: string,
  change: UserProfile | ProfilePatch,
): LoadResult | null {
  if (result?.status !== "ready" || result.key !== key) return result;
  return { ...result, profile: { ...result.profile, ...change } };
}

// What Profile shows and changes. It loads like Journal Home and Prayers: when the screen takes focus (the first
// time too), when the app returns to the foreground while the screen is focused (so coming back from the system
// Settings updates the notification card with no manual refresh), when the mock scenario or the mock plan
// changes, and on pull-to-refresh. A failed refresh keeps the data that is already on screen.
export function useProfileSettings(): ProfileSettingsState {
  const scenario = useDevStore((state) => state.scenario);
  const mockProfileVersion = useDevStore((state) => state.mockProfileVersion);
  const notificationOverride = useDevStore((state) => state.notificationStatusOverride);
  const key = `${scenario}:${mockProfileVersion}`;
  const [result, setResult] = useState<LoadResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only the latest load and the latest save may act on their results. Touched in callbacks and effects only,
  // never in render.
  const latestRequest = useRef(0);
  const latestSave = useRef(0);

  const load = useCallback(async () => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    try {
      const [profile, usage, entries, notificationStatus, trialEligible] = await Promise.all([
        getProfile(),
        getUsage(),
        listEntries(),
        getNotificationPermission(),
        readTrialEligible(),
      ]);
      if (request !== latestRequest.current) return;
      setResult({
        key,
        status: "ready",
        profile,
        usage,
        syncSummary: getSyncSummary(entries),
        notificationStatus,
        trialEligible,
      });
    } catch {
      if (request !== latestRequest.current) return;
      setResult((previous) =>
        previous?.status === "ready" && previous.key === key ? previous : { key, status: "error" },
      );
    }
  }, [key]);

  // The callback changes with the key, so useFocusEffect reloads then if the screen is focused, and otherwise
  // on the next focus. Leaving the screen drops a response that is still on its way.
  useFocusEffect(
    useCallback(() => {
      load();
      const subscription = AppState.addEventListener("change", (status) => {
        if (status === "active") load();
      });
      return () => {
        subscription.remove();
        latestRequest.current += 1;
      };
    }, [load]),
  );

  const retry = useCallback(() => {
    setResult(null);
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const current = result?.key === key ? result : null;

  // Optimistic: the change shows at once and the repository is asked. Success puts the profile it returned on
  // screen, failure puts back only the fields this patch touched. An older save's answer is ignored, and the
  // caller gets the result either way, to show its notice. (If two saves in a row both fail, the second one's
  // rollback restores the first one's optimistic value; the next refresh corrects it.)
  const save = useCallback(
    async (patch: ProfilePatch): Promise<RepoResult<UserProfile>> => {
      latestSave.current += 1;
      const request = latestSave.current;
      const before = current?.status === "ready" ? pickTouched(current.profile, patch) : {};
      setResult((previous) => withProfile(previous, key, patch));
      const outcome = await updateProfile(patch);
      if (request === latestSave.current) {
        setResult((previous) => withProfile(previous, key, outcome.ok ? outcome.data : before));
      }
      return outcome;
    },
    [current, key],
  );

  if (current === null) {
    return { status: "loading" };
  }
  if (current.status === "error") {
    return { status: "error", retry };
  }
  return {
    status: "ready",
    profile: current.profile,
    usage: current.usage,
    syncSummary: current.syncSummary,
    notificationStatus:
      __DEV__ && notificationOverride !== null ? notificationOverride : current.notificationStatus,
    trialEligible: current.trialEligible,
    refresh,
    refreshing,
    save,
  };
}
