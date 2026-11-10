import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { PostHog, PostHogPersistedProperty } from "posthog-react-native";

import { analyticsEnv } from "@/constants/env";
import { navigationRef } from "@/navigation/navigationRef";
import {
  sanitizeEvent,
  screenToTrack,
  toEntryFailedCode,
  type AnalyticsEventName,
  type AnalyticsProps,
  type JsonValue,
  type SendableEvent,
} from "@/services/analyticsPolicy";
import { subscribe as subscribeToSync } from "@/services/syncEngine";
import { useEntitlementStore } from "@/store/entitlementStore";
import { useOnboardingStore } from "@/store/onboardingStore";
import { usePlayerStore } from "@/store/playerStore";

// Product analytics (step 34): PostHog, only after the person said yes, and only events from the catalog in
// analyticsPolicy.ts. The client is made the first time consent is granted, never before: the SDK asks PostHog for its
// remote config as soon as a client exists, opted out or not, so a person who never said yes never reaches PostHog. This is
// the only file that imports posthog-react-native.

let client: PostHog | null = null;
let started = false;
// The route the last state change showed, tracked or not, so a return to the same tab after Reflection counts again.
let lastRoute: string | null = null;
// The devotional whose first play was sent; a replay after the end counts as a new play.
let playedEntryId: string | null = null;
// Development only: what the last events looked like when they left the filter, by name and property keys, never a value.
const recent: { name: string; keys: string[] }[] = [];

function consented(): boolean {
  return analyticsEnv.status === "ok" && useOnboardingStore.getState().analyticsConsent === "granted";
}

function beforeSend(event: SendableEvent): SendableEvent | null {
  const out = sanitizeEvent(event);
  if (__DEV__ && out !== null) {
    recent.unshift({ name: out.event, keys: Object.keys(out.properties ?? {}).sort() });
    recent.length = Math.min(recent.length, 20);
  }
  return out;
}

function makeClient(token: string, host: string): PostHog {
  return new PostHog(token, {
    host,
    // Off until optIn(): the line of defence if a client ever existed without consent.
    defaultOptIn: false,
    customStorage: AsyncStorage,
    personProfiles: "never",
    disableGeoip: true,
    before_send: beforeSend,
    captureAppLifecycleEvents: true,
    enableSessionReplay: false,
    preloadFeatureFlags: false,
    disableRemoteFeatureFlags: true,
    sendFeatureFlagEvent: false,
    disableSurveys: true,
    setDefaultPersonProperties: false,
    errorTracking: { autocapture: false },
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    flushAt: 20,
    flushInterval: 30_000,
  });
}

async function applySuperProperties(current: PostHog): Promise<void> {
  const tier = useEntitlementStore.getState().tier;
  await current.register({
    app_version: Constants.expoConfig?.version ?? "0",
    build: __DEV__ ? "development" : "release",
    ...(tier === null ? {} : { tier }),
  });
  if (tier === null) await current.unregister("tier");
}

// Follows the consent: yes makes the client (once) and opts in; no opts out and drops what was still waiting to be sent,
// so nothing leaves the phone after the switch goes off.
function applyConsent(): void {
  if (consented() && analyticsEnv.status === "ok") {
    client ??= makeClient(analyticsEnv.token, analyticsEnv.host);
    void client.optIn();
    void applySuperProperties(client);
    return;
  }
  if (client !== null) {
    void client.optOut();
    client.setPersistedProperty(PostHogPersistedProperty.Queue, null);
  }
}

// The one way an event is sent. A no-op without consent or a token.
export function track<N extends AnalyticsEventName>(name: N, props: AnalyticsProps<N>): void {
  if (client === null || !consented()) return;
  const properties: { [key: string]: JsonValue } = props;
  client.capture(name, properties);
}

// Called by the NavigationContainer on ready and on every state change. Route names only, never params, and only the
// screens analyticsPolicy.ts lists.
export function trackCurrentScreen(): void {
  if (!navigationRef.isReady()) return;
  const route = navigationRef.getCurrentRoute()?.name ?? null;
  if (route === lastRoute) return;
  lastRoute = route;
  const screen = screenToTrack(route ?? undefined);
  if (screen === null || client === null || !consented()) return;
  void client.screen(screen);
}

// Once, from App.tsx. Until the onboarding store has loaded the saved answer it reads "unset", so nothing is made; the
// subscription below then follows the loaded answer and every later change.
export function startAnalytics(): void {
  if (started) return;
  started = true;
  useOnboardingStore.subscribe((state, previous) => {
    if (state.analyticsConsent === previous.analyticsConsent) return;
    // A devotional played while sharing was off was never sent: the first play after sharing turns on counts.
    if (state.analyticsConsent === "granted") playedEntryId = null;
    applyConsent();
  });
  useEntitlementStore.subscribe((state, previous) => {
    if (state.tier !== previous.tier && client !== null && consented()) void applySuperProperties(client);
  });
  subscribeToSync((event) => {
    if (event.type === "finished" && !event.isCrisis) {
      // Since 2026-11-09 the audio is made behind the answer, so whether it came is no fact of this moment.
      track("reflection_ready", {
        input: event.inputType === "audio" ? "voice" : "text",
        scripture_verified: event.scriptureVerified,
      });
    } else if (event.type === "settled" && event.status === "needs_action") {
      track("entry_failed", { code: toEntryFailedCode(event.code) });
    }
  });
  usePlayerStore.subscribe((state, previous) => {
    if (state.status === "playing" && previous.status !== "playing" && state.entryId !== null && state.entryId !== playedEntryId) {
      playedEntryId = state.entryId;
      track("devotional_played", { rate: state.rate });
    } else if (state.status === "ended" && previous.status !== "ended") {
      playedEntryId = null;
      track("devotional_completed", { rate: state.rate });
    }
  });
  if (useOnboardingStore.persist.hasHydrated()) applyConsent();
}

// Sign-out and account deletion (signOutCleanup, last): the next account on this phone gets a new anonymous id. reset()
// also clears the opt-in and the super properties, so the device's consent is applied again. What was already waiting to be
// sent stays, under the old id.
export async function resetAnalytics(): Promise<void> {
  lastRoute = null;
  playedEntryId = null;
  if (client === null) return;
  client.reset();
  applyConsent();
}

export type AnalyticsSummary = {
  env: string;
  consent: string;
  client: boolean;
  optedOut: boolean | null;
  queued: number;
  // The last 8 characters of the random id made on the phone (its first characters are a timestamp, the same for two ids
  // made close together), so a sign-out can be seen to change it. Nothing else of the id is shown.
  idTail: string | null;
  recent: string[];
};

// The developer panel's "Analytics (dev)" group: names, keys, counts and the id's tail, never a value.
export function getAnalyticsSummary(): AnalyticsSummary {
  return {
    env: analyticsEnv.status,
    consent: useOnboardingStore.getState().analyticsConsent,
    client: client !== null,
    optedOut: client === null ? null : client.optedOut,
    queued: client === null ? 0 : (client.getPersistedProperty<unknown[]>(PostHogPersistedProperty.Queue) ?? []).length,
    idTail: client === null ? null : client.getDistinctId().slice(-8),
    recent: recent.map((entry) => `${entry.name} [${entry.keys.join(", ")}]`),
  };
}

export async function flushAnalytics(): Promise<void> {
  await client?.flush();
}
