import { SCHOLAR_AI_REMINDER_MS } from "@/constants/app";
import type { HelpKind, ScholarConversation, ScholarMessage } from "@/types";

// What the Conversation screen draws (step 38), worked out from the messages alone, so it is the same on every visit and testable
// without a screen. Pure: no React, no clock but the one passed in.

// How a message that did not get its answer is drawn: "generic" is "Scholar couldn’t answer just now." with "Try again", "limit"
// is "Try again" alone (the day's limit held it), and "none" has no way to try again (Scholar is closed for the account).
export type FailureKind = "generic" | "limit" | "none";

export type ConversationRow =
  | { kind: "reminder"; key: string }
  | { kind: "user"; key: string; message: ScholarMessage; failure: FailureKind | null }
  | { kind: "waiting"; key: string }
  | { kind: "answer"; key: string; message: ScholarMessage; newest: boolean };

function hasWords(message: ScholarMessage): boolean {
  return message.blocks.some((block) => block.type === "text" && block.text.trim().length > 0);
}

// The person's words: the text blocks, in order. A spoken message's are its transcript once the server has it.
export function messageText(message: ScholarMessage): string {
  return message.blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();
}

function failureOf(message: ScholarMessage): FailureKind {
  if (message.errorCode === "LIMIT_REACHED") return "limit";
  if (message.errorCode === "SCHOLAR_ADULTS_ONLY") return "none";
  return "generic";
}

const time = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

// Each of the person's messages followed by its answer (`replyTo`), in the order the person sent them. An answer whose message is
// not loaded (older than the list holds) comes first, in its own order.
export function orderMessages(messages: ScholarMessage[]): ScholarMessage[] {
  const answers = new Map<string, ScholarMessage>();
  const people: ScholarMessage[] = [];
  const loose: ScholarMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") people.push(message);
    else if (message.replyTo !== null && !answers.has(message.replyTo)) answers.set(message.replyTo, message);
    else loose.push(message);
  }
  const byTime = (a: ScholarMessage, b: ScholarMessage) => time(a.createdAt) - time(b.createdAt);
  people.sort(byTime);
  const ordered: ScholarMessage[] = [];
  for (const person of people) {
    ordered.push(person);
    const answer = answers.get(person.id);
    if (answer !== undefined) {
      ordered.push(answer);
      answers.delete(person.id);
    }
  }
  return [...[...loose, ...answers.values()].sort(byTime), ...ordered];
}

// The rows, top to bottom: the AI reminder first (the public page, and New York's companion law), and again before a message sent
// three hours or more after the last reminder; each message and its answer; the waiting row under the message whose answer is on
// its way (`waitingFor`). A failed spoken message that has no words is not drawn: there is nothing of it to show.
export function buildConversationRows(messages: ScholarMessage[], waitingFor: string | null): ConversationRow[] {
  const rows: ConversationRow[] = [{ kind: "reminder", key: "reminder-0" }];
  let remindedAt: number | null = null;
  let newestAnswer = -1;
  for (const message of orderMessages(messages)) {
    if (message.role === "user") {
      if (message.inputType === "audio" && message.status === "failed" && !hasWords(message) && message.id !== waitingFor) {
        continue;
      }
      const sent = time(message.createdAt);
      if (remindedAt === null) {
        remindedAt = sent;
      } else if (sent - remindedAt >= SCHOLAR_AI_REMINDER_MS) {
        rows.push({ kind: "reminder", key: `reminder-${message.id}` });
        remindedAt = sent;
      }
      const failure = message.status === "failed" && message.id !== waitingFor ? failureOf(message) : null;
      rows.push({ kind: "user", key: message.id, message, failure });
      if (message.id === waitingFor) rows.push({ kind: "waiting", key: `waiting-${message.id}` });
    } else if (message.status === "ready") {
      newestAnswer = rows.length;
      rows.push({ kind: "answer", key: message.id, message, newest: false });
    }
  }
  const last = rows[newestAnswer];
  if (newestAnswer >= 0 && newestAnswer === rows.length - 1 && last?.kind === "answer") {
    rows[newestAnswer] = { ...last, newest: true };
  }
  return rows;
}

// A heavy conversation: the server's mark, or any message in it marked heavy (the answer to a flagged message is, before the
// conversation is read again).
export function isHeavyConversation(conversation: ScholarConversation | null, messages: ScholarMessage[]): boolean {
  return conversation?.isHeavy === true || messages.some((message) => message.isHeavy);
}

// The help line the "Get help" button shows: the newest answer's, else the one of the reflection the conversation began from
// (`fallback`), else the 988 line.
export function newestHelpLine(messages: ScholarMessage[], fallback: HelpKind | null = null): HelpKind {
  for (const message of [...orderMessages(messages)].reverse()) {
    if (message.role === "scholar" && message.helpLine !== null) return message.helpLine;
  }
  return fallback ?? "crisis";
}

// How many answers the conversation holds, for the break note.
export function answerCount(messages: ScholarMessage[]): number {
  return messages.filter((message) => message.role === "scholar" && message.status === "ready").length;
}
