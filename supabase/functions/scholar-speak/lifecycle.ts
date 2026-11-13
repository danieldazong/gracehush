import type { SupabaseClient } from "@supabase/supabase-js";

import { type ConversationRow, findConversation, findMessage, type MessageRow } from "../scholar-turn/lifecycle.ts";

// The database calls of scholar-speak (step 38): one saved answer and its conversation. Every query filters by the verified user
// id (scholar-turn/lifecycle.ts, whose reads these are); the day's usage is read and counted with the same functions as
// scholar-turn's. Nothing is written but the count, and nothing is stored: the audio goes to the phone and nowhere else.

export { bumpUsage, type ConversationRow, type MessageRow, readUsageRows } from "../scholar-turn/lifecycle.ts";

// An answer the person may hear: theirs, Scholar's, and ready. Another person's, a question, an answer still being made and a
// missing one all look the same: null.
export async function findSpokenAnswer(
  admin: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<{ answer: MessageRow; conversation: ConversationRow } | null> {
  const answer = await findMessage(admin, userId, messageId);
  if (answer === null || answer.role !== "scholar" || answer.status !== "ready") return null;
  const conversation = await findConversation(admin, userId, answer.conversation_id);
  return conversation === null ? null : { answer, conversation };
}
