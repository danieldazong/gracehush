import type { HelpKind } from "../../process-entry/contracts.ts";
import type { PhraseGroup } from "./phrases.ts";

// Which help line a heavy moment shows (2026-11-11, the readers' review of Scholar: a person being hurt at home was shown 988
// instead of a domestic violence line). Since screen-v4 (the readers' answer the same day) the screening names the line itself,
// in help_line, by the table below; the kinds of concern it finds (screen.ts CATEGORIES) choose it only when it names none
// (helpFromCategories), and are used for nothing else. The choice is saved with the reflection or the answer as one of four
// words, so the same line shows when it is opened again; no category, phrase or reason is ever stored, logged or shown. The
// readers chose the domestic violence line for a sexual assault and for a child being harmed too (2026-11-11).
//
//   crisis        the 988 Suicide & Crisis Lifeline, call or text (thoughts of ending their life, self-harm, anything unclear)
//   abuse         the National Domestic Violence Hotline, call or text, with 911 for danger now (someone is hurting them)
//   harm_others   988, call or text, with 911 for danger now (an intention to harm someone else)
//   emergency     911 first (a medical emergency, harm already underway)
//
// The numbers are the app's (src/constants/crisisResources.ts): it picks them for the phone's region, and outside the US it
// shows a helpline directory and the local emergency number instead.

export const HELP_KINDS: readonly HelpKind[] = ["crisis", "abuse", "harm_others", "emergency"];

export function isHelpKind(value: unknown): value is HelpKind {
  return typeof value === "string" && (HELP_KINDS as readonly string[]).includes(value);
}

// The most urgent kind the screening named wins. Nothing named (an uncertain reply, a blocked request) is the 988 line, which
// takes every kind of crisis.
export function helpFromCategories(categories: readonly string[]): HelpKind {
  if (categories.includes("medical_emergency")) return "emergency";
  if (categories.includes("abuse_or_danger_now")) return "abuse";
  if (categories.includes("harm_to_others")) return "harm_others";
  return "crisis";
}

export function helpFromPhraseGroup(group: PhraseGroup): HelpKind {
  return group === "others" ? "harm_others" : "crisis";
}

// The phone's region, as the app sends it (two capital letters). The US and its territories use 988 and 911; anywhere else the
// app shows a helpline directory and the server says "your local emergency number". A region the server cannot read is the US,
// the app's own market.
export type Region = "us" | "other";

const US_REGIONS = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

export function regionOf(code: string | null | undefined): Region {
  if (typeof code !== "string" || !/^[A-Za-z]{2}$/.test(code)) return "us";
  return US_REGIONS.has(code.toUpperCase()) ? "us" : "other";
}
