import { AMBIENT_SOUNDS, PLAYBACK_RATES } from "@/constants/app";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import type { AmbientSound, PackageKind, PlaybackRate, PurchaseErrorCode, TimeSlot } from "@/types";

// What the app may send to PostHog (step 34), and the filter every event passes on its way out. Pure: no PostHog, no
// React Native. services/analytics.ts is the only caller.

// The needs_action codes of syncPolicy.ts that an entry_failed event may carry; any other code is "OTHER".
export type EntryFailedCode = "TOO_SHORT" | "NO_SPEECH" | "PAYLOAD_TOO_LARGE" | "AUDIO_NOT_FOUND" | "UNREADABLE" | "OTHER";

// The catalog: the only events track() accepts. No event, property or value is about a crisis entry, Support Resources,
// signing in or out, or anything a person wrote; there are no ids, titles, verses, counts of words or free text.
export type AnalyticsEvent =
  | { name: "onboarding_completed"; props: { permissions_prompted: boolean } }
  | { name: "reflection_ready"; props: { input: "text" | "voice"; scripture_verified: boolean; has_audio: boolean } }
  | { name: "entry_failed"; props: { code: EntryFailedCode } }
  | { name: "devotional_played"; props: { rate: PlaybackRate } }
  | { name: "devotional_completed"; props: { rate: PlaybackRate } }
  | { name: "ambient_changed"; props: { sound: AmbientSound; source: "now_playing" | "profile" } }
  | { name: "affirmation_favorited"; props: { favorited: boolean } }
  | { name: "affirmation_notification_opened"; props: { slot: TimeSlot } }
  | { name: "prayer_tracked_changed"; props: { tracked: boolean } }
  | { name: "prayer_marked_answered"; props: { has_note: boolean } }
  | { name: "prayer_removed"; props: { was_answered: boolean } }
  | { name: "reflection_deleted"; props: { source: "reflection" | "prayers" } }
  | { name: "paywall_viewed"; props: { source: "profile" | "limit" } }
  | { name: "purchase_completed"; props: { plan: PackageKind; trial: boolean } }
  | { name: "purchase_failed"; props: { code: PurchaseErrorCode } }
  | { name: "restore_completed"; props: { found: boolean } }
  | { name: "data_export_requested"; props: Record<string, never> };

export type AnalyticsEventName = AnalyticsEvent["name"];
export type AnalyticsProps<N extends AnalyticsEventName> = Extract<AnalyticsEvent, { name: N }>["props"];

// The screens a $screen event may name (route names, never params). Reflection is not one: the same route shows the crisis
// view, and the navigator cannot tell them apart. Support Resources, Onboarding and Sign In are not either.
export const TRACKED_SCREENS = ["Journal", "Prayers", "Profile", "NewEntry", "NowPlaying", "Paywall"] as const satisfies readonly (
  | keyof RootStackParamList
  | keyof MainTabParamList
)[];
export type TrackedScreen = (typeof TRACKED_SCREENS)[number];

// The SDK's own events that may leave the phone, with no property of their own but $screen's name. Application Installed and
// Updated never fire (the build sets no $app_build), and Application Opened's `url` is dropped (in Expo Go it is the dev
// server's address).
export const SYSTEM_EVENTS = ["$screen", "Application Opened", "Application Became Active", "Application Backgrounded"] as const;

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];
// The shape PostHog hands to before_send (its CaptureEvent), written out so this file needs no PostHog import.
export type SendableEvent = {
  uuid?: string;
  event: string;
  properties?: { [key: string]: JsonValue };
  $set?: { [key: string]: JsonValue };
  $set_once?: { [key: string]: JsonValue };
  timestamp?: Date;
};

type Check = (value: unknown) => boolean;
const bool: Check = (value) => typeof value === "boolean";
const oneOf =
  (values: readonly unknown[]): Check =>
  (value) =>
    values.includes(value);
const shortText: Check = (value) => typeof value === "string" && value.length > 0 && value.length <= 64;
// Every value of the union, so a new member is a type error here until it is listed.
const everyKey = <K extends string>(record: Record<K, true>): readonly K[] => Object.keys(record) as K[];

const ENTRY_FAILED_CODES = everyKey<EntryFailedCode>({
  TOO_SHORT: true,
  NO_SPEECH: true,
  PAYLOAD_TOO_LARGE: true,
  AUDIO_NOT_FOUND: true,
  UNREADABLE: true,
  OTHER: true,
});
const PURCHASE_CODES = everyKey<PurchaseErrorCode>({
  CANCELLED: true,
  PENDING: true,
  NETWORK: true,
  NOT_ALLOWED: true,
  ALREADY_OWNED: true,
  UNKNOWN: true,
});
const SLOTS = everyKey<TimeSlot>({ morning: true, afternoon: true, evening: true });
const PLANS = everyKey<PackageKind>({ annual: true, monthly: true });

// Each event's own properties: all of them must be there and valid, or the event is dropped.
const EVENT_PROPS: { [N in AnalyticsEventName]: { [K in keyof AnalyticsProps<N>]-?: Check } } = {
  onboarding_completed: { permissions_prompted: bool },
  reflection_ready: { input: oneOf(["text", "voice"]), scripture_verified: bool, has_audio: bool },
  entry_failed: { code: oneOf(ENTRY_FAILED_CODES) },
  devotional_played: { rate: oneOf(PLAYBACK_RATES) },
  devotional_completed: { rate: oneOf(PLAYBACK_RATES) },
  ambient_changed: { sound: oneOf(AMBIENT_SOUNDS), source: oneOf(["now_playing", "profile"]) },
  affirmation_favorited: { favorited: bool },
  affirmation_notification_opened: { slot: oneOf(SLOTS) },
  prayer_tracked_changed: { tracked: bool },
  prayer_marked_answered: { has_note: bool },
  prayer_removed: { was_answered: bool },
  reflection_deleted: { source: oneOf(["reflection", "prayers"]) },
  paywall_viewed: { source: oneOf(["profile", "limit"]) },
  purchase_completed: { plan: oneOf(PLANS), trial: bool },
  purchase_failed: { code: oneOf(PURCHASE_CODES) },
  restore_completed: { found: bool },
  data_export_requested: {},
};

const SYSTEM_PROPS: Record<(typeof SYSTEM_EVENTS)[number], Record<string, Check>> = {
  $screen: { $screen_name: oneOf(TRACKED_SCREENS) },
  "Application Opened": {},
  "Application Became Active": {},
  "Application Backgrounded": {},
};

// Kept on every event when present and valid. $screen_name is the last tracked screen (the SDK keeps it for the session);
// tier, app_version and build are the app's own super properties.
const COMMON_PROPS: Record<string, Check> = {
  $lib: shortText,
  $lib_version: shortText,
  $os: shortText,
  $os_name: shortText,
  $os_version: shortText,
  $device_type: shortText,
  $session_id: shortText,
  $is_identified: (value) => value === false,
  $screen_name: oneOf(TRACKED_SCREENS),
  tier: oneOf(["free", "trial", "pro"]),
  app_version: (value) => typeof value === "string" && /^\d{1,4}(\.\d{1,4}){0,3}$/.test(value),
  build: oneOf(["development", "release"]),
};

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function ownChecks(name: string): { checks: Record<string, Check>; required: boolean } | null {
  if (has(EVENT_PROPS, name)) {
    return { checks: EVENT_PROPS[name as AnalyticsEventName] as Record<string, Check>, required: true };
  }
  if (has(SYSTEM_PROPS, name)) {
    return { checks: SYSTEM_PROPS[name as keyof typeof SYSTEM_PROPS], required: name === "$screen" };
  }
  return null;
}

// PostHog's before_send. An event that is not in the catalog or the system list is dropped; so is a catalog event (or a
// $screen) whose own properties are missing or not valid. Every other property goes unless COMMON_PROPS keeps it, and the two
// flags PostHog reads to skip a person profile and the IP's location are set on every event, whatever came in.
export function sanitizeEvent(input: SendableEvent): SendableEvent | null {
  const own = ownChecks(input.event);
  if (own === null) return null;
  const source = input.properties ?? {};
  for (const key of Object.keys(own.checks)) {
    const ok = has(source, key) && own.checks[key](source[key]);
    if (!ok && own.required) return null;
  }
  const properties: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(source)) {
    const check = has(own.checks, key) ? own.checks[key] : has(COMMON_PROPS, key) ? COMMON_PROPS[key] : undefined;
    if (check !== undefined && check(source[key])) properties[key] = source[key];
  }
  properties.$process_person_profile = false;
  properties.$geoip_disable = true;
  return { ...input, properties, $set: undefined, $set_once: undefined };
}

// A tracked screen's name, or null for a route that is never sent.
export function screenToTrack(routeName: string | undefined): TrackedScreen | null {
  return (TRACKED_SCREENS as readonly string[]).includes(routeName ?? "") ? (routeName as TrackedScreen) : null;
}

// syncPolicy's needs_action codes as an entry_failed code.
export function toEntryFailedCode(code: string | null): EntryFailedCode {
  return (ENTRY_FAILED_CODES as readonly string[]).includes(code ?? "") && code !== "OTHER"
    ? (code as EntryFailedCode)
    : "OTHER";
}
