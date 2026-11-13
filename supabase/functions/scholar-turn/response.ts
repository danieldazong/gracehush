import { isHelpKind } from "../_shared/safety/helpKind.ts";
import type { StoredBlock } from "../_shared/scholar/prompt.ts";
import type { ScholarBlock, ScholarConversation, ScholarMessage } from "../process-entry/contracts.ts";
import type { ConversationRow, MessageRow } from "./lifecycle.ts";

// Saved rows as the app receives them (process-entry/contracts.ts, the server's copy of the contract). A passage is saved as
// its reference and the Bible's words, and it reaches the app as verified BSB scripture: Scholar never saves one it did not read.

export function toScholarConversation(row: ConversationRow): ScholarConversation {
  return {
    id: row.id,
    entryId: row.entry_id,
    title: row.title,
    isHeavy: row.is_heavy,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

// A saved block, or null for one that does not have the shape of one (never shown).
function toBlock(block: unknown): ScholarBlock | null {
  if (typeof block !== "object" || block === null) return null;
  const { type, text, reference } = block as Record<string, unknown>;
  if (typeof text !== "string" || text === "") return null;
  if (type === "text" || type === "prayer") return { type, text };
  if (type === "passage" && typeof reference === "string" && reference !== "") {
    return { type: "passage", scripture: { reference, text, translation: "BSB", verified: true } };
  }
  return null;
}

export function blocksOf(row: Pick<MessageRow, "content">): ScholarBlock[] {
  const blocks = row.content?.blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.map(toBlock).filter((block): block is ScholarBlock => block !== null);
}

export function toScholarMessage(row: MessageRow): ScholarMessage {
  const help = row.content?.help;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    replyTo: row.reply_to,
    inputType: row.input_type,
    status: row.status,
    errorCode: row.error_code,
    blocks: blocksOf(row),
    isHeavy: row.is_heavy,
    // An answer that carries a help line shows the one saved with it; one saved before 2026-11-11 shows the 988 line.
    helpLine: row.role === "scholar" && row.is_heavy ? (isHelpKind(help) ? help : "crisis") : null,
    createdAt: row.created_at,
  };
}

// A person's message's words (its text blocks), or null while a spoken one has none yet.
export function wordsOf(row: Pick<MessageRow, "content">): string | null {
  const blocks = row.content?.blocks;
  if (!Array.isArray(blocks)) return null;
  const words = blocks.filter((block): block is Extract<StoredBlock, { type: "text" }> =>
    typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string"
  ).map((block) => block.text.trim()).filter((text) => text !== "").join("\n\n");
  return words === "" ? null : words;
}
