import type { CrisisGroupId, CrisisResource } from "@/types";

// Re-check every number and URL in this file before each App Store and Play release, then change this date.
// Checked 2026-10-20 on the official pages: 988lifeline.org (call, text and chat, "24/7/365"; its Text button is
// sms:988 and its Chat button is chat.988lifeline.org), crisistextline.org ("Text HOME to 741741 ... 24/7") and
// findahelpline.com (ThroughLine's directory of helplines). The app states availability only: no cost,
// confidentiality or outcome claim (AGENTS.md Crisis Safety Rules).
export const CRISIS_RESOURCES_LAST_VERIFIED = "2026-10-20";

// Support Resources lists the resources under these headings, in this order.
export const CRISIS_GROUPS: { id: CrisisGroupId; title: string }[] = [
  { id: "lifeline", title: "988 Suicide & Crisis Lifeline" },
  { id: "other", title: "Other support" },
];

const lifelineCall: CrisisResource = {
  id: "lifeline-call",
  title: "988 Suicide & Crisis Lifeline",
  detail: "Call 988 • 24/7",
  group: "lifeline",
  grouped: { title: "Call 988", detail: "Available 24/7" },
  icon: "call",
  kind: "call",
  value: "988",
  urgent: true,
  onReflection: true,
  accessibilityLabel: "Call the 988 Suicide and Crisis Lifeline",
};

// The order is the Reflection crisis view's order (the HTML's): 988, Crisis Text Line, 911, outside the US.
export const CRISIS_RESOURCES: CrisisResource[] = [
  lifelineCall,
  {
    id: "lifeline-text",
    title: "988 Suicide & Crisis Lifeline",
    detail: "Text 988 • 24/7",
    group: "lifeline",
    grouped: { title: "Text 988", detail: "Available 24/7" },
    icon: "text",
    kind: "text",
    value: "988",
    urgent: false,
    onReflection: false,
    accessibilityLabel: "Text the 988 Suicide and Crisis Lifeline",
  },
  {
    id: "lifeline-chat",
    title: "988 Suicide & Crisis Lifeline",
    detail: "Chat online • 24/7",
    group: "lifeline",
    grouped: { title: "Chat online", detail: "Available 24/7" },
    icon: "web",
    kind: "web",
    value: "https://chat.988lifeline.org/",
    urgent: false,
    onReflection: false,
    accessibilityLabel: "Open the 988 Suicide and Crisis Lifeline online chat",
  },
  {
    id: "crisis-text-line",
    title: "Crisis Text Line",
    detail: "Text HOME to 741741 • 24/7",
    group: "other",
    icon: "text",
    kind: "text",
    value: "741741",
    body: "HOME",
    urgent: false,
    onReflection: true,
    accessibilityLabel: "Text HOME to 741741, Crisis Text Line",
  },
  {
    id: "emergency",
    title: "In immediate danger? Call 911",
    detail: "Immediate emergency assistance",
    group: "other",
    icon: "emergency",
    kind: "call",
    value: "911",
    urgent: true,
    onReflection: true,
    accessibilityLabel: "Call 911",
  },
  {
    id: "find-a-helpline",
    title: "Outside the US? Find a local helpline",
    detail: "Helplines in countries around the world",
    group: "other",
    icon: "web",
    kind: "web",
    value: "https://findahelpline.com",
    urgent: false,
    onReflection: true,
    accessibilityLabel: "Open Find a Helpline, a directory of helplines worldwide",
  },
];

// "Talk to someone now".
export const PRIMARY_CRISIS_RESOURCE = lifelineCall;
