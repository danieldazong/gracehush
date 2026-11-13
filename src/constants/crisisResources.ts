// The numbers the quiet line under a heavy moment's devotional names (components/HelpLine.tsx): the only file of the app that
// holds a service's number. Scholar's spoken help line (supabase/functions/_shared/scholar/heavyChat.ts) spells the same numbers
// out, and a test keeps the two equal. Re-check every number before each App Store and Play release, then change the date:
//   988lifeline.org                 988 takes calls and texts, "available 24/7/365" (checked 2026-10-20, 2026-11-07, 2026-11-11)
//   thehotline.org                  1-800-799-7233, and text START to 88788, 24/7 (checked 2026-11-11)
//   findahelpline.com               ThroughLine's directory of help lines, by country (checked 2026-11-11)
// The app states availability only: no cost, confidentiality or outcome claim (AGENTS.md Crisis Safety Rules).
export const HELPLINE_LAST_VERIFIED = "2026-11-11";

// The 988 Suicide & Crisis Lifeline: call or text, any time (United States).
export const HELPLINE_NUMBER = "988";

// Emergency services, for someone in danger right now (United States).
export const EMERGENCY_NUMBER = "911";

// The National Domestic Violence Hotline (United States), for a person someone is hurting (2026-11-11): the number as it is
// written, the digits the phone dials, and its text line.
export const DV_HOTLINE_NUMBER = "1-800-799-7233";
export const DV_HOTLINE_DIAL = "18007997233";
export const DV_TEXT_NUMBER = "88788";
export const DV_TEXT_BODY = "START";

// Outside the US the app names no number: a directory of help lines in the person's country, and their local emergency number.
export const FIND_A_HELPLINE_URL = "https://findahelpline.com";
