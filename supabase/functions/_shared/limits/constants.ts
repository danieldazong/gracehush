// The free tier (step 22). The app keeps a copy of these two numbers in src/constants/app.ts (FREE_DEVOTIONALS_PER_WEEK and
// WEEK_STARTS_ON) for the paywall's words: keep them in step. The server's numbers are the ones that count.

// Free accounts get this many devotionals a week. A trial or Pro account has no limit.
export const FREE_DEVOTIONALS_PER_WEEK = 3;

// The week starts on this weekday at 00:00 in the profile's time zone (0 = Sunday, 1 = Monday).
export const WEEK_STARTS_ON = 1;
