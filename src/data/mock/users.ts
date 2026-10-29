import { getDeviceTimezone } from "@/data/mappers";
import type { UserProfileRow } from "@/types/database";

// Clerk-style id. There is no mock Clerk user: Journal Home and Profile read the real one.
export const MOCK_USER_ID = "user_mock_sarah";

// The one fixed date in the mocks, at noon UTC so the month reads "October" in every time zone.
const CREATED_AT = "2026-10-01T12:00:00.000Z";

export function buildProfile(now: Date): UserProfileRow {
  return {
    id: MOCK_USER_ID,
    created_at: CREATED_AT,
    subscription_tier: "free",
    subscription_expires_at: null,
    subscription_synced_at: null,
    reminder_morning: "08:00:00",
    reminder_afternoon: "13:00:00",
    reminder_evening: "20:00:00",
    last_active_at: now.toISOString(),
    timezone: getDeviceTimezone(),
    ambient_sound: "soft-rain",
    ambient_volume: 0.5,
    affirmations_enabled: true,
    updated_at: CREATED_AT,
  };
}
