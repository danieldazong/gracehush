import type { AmbientSound, PlaybackRate, TimeSlot } from "@/types";

// Keep in sync with supabase/functions/_shared/limits/constants.ts (step 22).
export const FREE_DEVOTIONALS_PER_WEEK = 3;
export const WEEK_STARTS_ON = 1; // Monday

// "HH:mm", 24-hour. Copy it (`{ ...DEFAULT_REMINDERS }`) so nothing shares the reference.
export const DEFAULT_REMINDERS: Record<TimeSlot, string> = {
  morning: "08:00",
  afternoon: "13:00",
  evening: "20:00",
};

// The Android notification channel for the three daily affirmations (step 28 reuses it).
export const AFFIRMATION_CHANNEL_ID = "affirmations";

// Keep in sync with supabase/functions/process-entry/contracts.ts (step 19)
export const MAX_RECORDING_MS = 300_000;
export const MIN_RECORDING_MS = 3_000;
export const RECORDING_WARNING_MS = 270_000;
export const MAX_TEXT_LENGTH = 5_000;
export const MIN_TEXT_LENGTH = 10;
export const TEXT_COUNTER_FROM = 4_500;

// The bars on the New Entry waveform. Here and not in the component, so the recorder hook (the levels it
// keeps) and the component share it without the hook importing a component.
export const WAVEFORM_BAR_COUNT = 9;

// The player (step 12). Back and forward skip this far; the speed chips and the ambient chips show these,
// in this order.
export const SKIP_MS = 15_000;
export const PLAYBACK_RATES: readonly PlaybackRate[] = [0.8, 1, 1.2];
export const AMBIENT_SOUNDS: readonly AmbientSound[] = [
  "off",
  "soft-rain",
  "gentle-piano",
  "morning-birds",
];
