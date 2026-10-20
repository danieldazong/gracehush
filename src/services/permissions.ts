import { PermissionStatus, type PermissionResponse } from "expo";

import type { PermissionResult } from "@/types";

// A permission that can still be asked counts as "undetermined". On Android 13+ a notification
// permission that was never asked is reported as { status: "denied", canAskAgain: true }, not
// "undetermined", so a rule that only looks at the status would never show the prompt.
export function toPermissionResult(response: PermissionResponse): PermissionResult {
  if (response.granted) return "granted";
  if (response.status === PermissionStatus.UNDETERMINED || response.canAskAgain) {
    return "undetermined";
  }
  return "denied";
}
