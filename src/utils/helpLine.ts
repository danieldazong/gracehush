import {
  DV_HOTLINE_DIAL,
  DV_TEXT_BODY,
  DV_TEXT_NUMBER,
  EMERGENCY_NUMBER,
  FIND_A_HELPLINE_URL,
  HELPLINE_NUMBER,
} from "@/constants/crisisResources";
import type { HelpKind } from "@/types";
import type { Region } from "@/utils/region";

// What the quiet line under a heavy moment offers (2026-11-11, the readers' review: one line for every heavy moment showed 988 to
// a person someone was hurting). The help line saved with the reflection or the answer chooses the service, and the phone's
// region chooses whether a number can be named at all. The buttons are the readers' table, word for word; 911 for danger now is
// in the line itself (copy.reflection.help). Pure: components/HelpLine.tsx draws it, and the words are copy.ts's.
//
//   crisis        call 988, text 988
//   harm_others   call 988, text 988 (the line adds 911 for danger now)
//   abuse         call the National Domestic Violence Hotline, text START to 88788 (the line adds 911 for danger now)
//   emergency     call 911
//   elsewhere     the directory of help lines in their country, for every kind (the line names the local emergency number)
export type HelpService = "lifeline" | "hotline" | "emergency" | "directory";

export type HelpAction =
  | { kind: "call"; service: Exclude<HelpService, "directory">; number: string }
  | { kind: "text"; service: "lifeline" | "hotline"; number: string; body: string | null }
  | { kind: "web"; service: "directory"; url: string };

export function helpActions(kind: HelpKind, region: Region): HelpAction[] {
  if (region === "other") return [{ kind: "web", service: "directory", url: FIND_A_HELPLINE_URL }];
  switch (kind) {
    case "abuse":
      return [
        { kind: "call", service: "hotline", number: DV_HOTLINE_DIAL },
        { kind: "text", service: "hotline", number: DV_TEXT_NUMBER, body: DV_TEXT_BODY },
      ];
    case "emergency":
      return [{ kind: "call", service: "emergency", number: EMERGENCY_NUMBER }];
    default:
      return [
        { kind: "call", service: "lifeline", number: HELPLINE_NUMBER },
        { kind: "text", service: "lifeline", number: HELPLINE_NUMBER, body: null },
      ];
  }
}
