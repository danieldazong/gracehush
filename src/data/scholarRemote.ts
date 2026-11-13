import { SCHOLAR_MESSAGES_LIMIT, SCHOLAR_RECENTS_LIMIT } from "@/constants/app";
import { copy } from "@/constants/copy";
import { CONVERSATION_COLUMNS, SCHOLAR_MESSAGE_COLUMNS, type ConversationRow, type MessageRow } from "@/data/columns";
import { getSupabase, getSupabaseUserId } from "@/services/supabaseClient";
import type { RepoResult } from "@/types";
import { describeFailure, toFailureCode } from "@/utils/supabaseErrors";
import { normalizeTimestamp } from "@/utils/timestamp";

// The only code that sends a request about scholar_conversations and scholar_messages (step 38), as entriesRemote.ts is for the
// journal. It reads with the explicit column lists of data/columns.ts, and the one thing it writes is the deletion of a
// conversation (its messages go with it, on delete cascade): the server writes everything else. Every query filters by the
// user's id as well as relying on row level security. Nothing here logs more than a table and an error code.

function unauthorized(message: string): RepoResult<never> {
  return { ok: false, code: "UNAUTHORIZED", message };
}

function fail(
  table: string,
  status: number,
  error: { message?: string | null; code?: string | null },
  message: string,
): RepoResult<never> {
  if (__DEV__) {
    // Only the table and the code, never a message, a row, a token or an id.
    console.warn(`[supabase] ${describeFailure(table, status, error)}`);
  }
  return { ok: false, code: toFailureCode(status, error), message };
}

function conversationTimes(row: ConversationRow): ConversationRow {
  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at),
    last_message_at: normalizeTimestamp(row.last_message_at),
  };
}

function messageTimes(row: MessageRow): MessageRow {
  return { ...row, created_at: normalizeTimestamp(row.created_at) };
}

// The newest conversations first, for the Scholar tab.
export async function selectConversations(limit = SCHOLAR_RECENTS_LIMIT): Promise<RepoResult<ConversationRow[]>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.scholar.errors.load);
  const { data, error, status } = await supabase
    .from("scholar_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error !== null) return fail("scholar_conversations", status, error, copy.scholar.errors.load);
  return { ok: true, data: data.map(conversationTimes) };
}

// One conversation, or null when there is none (or it is not this user's).
export async function selectConversation(id: string): Promise<RepoResult<ConversationRow | null>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.scholar.errors.conversation);
  const { data, error, status } = await supabase
    .from("scholar_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) return fail("scholar_conversations", status, error, copy.scholar.errors.conversation);
  return { ok: true, data: data === null ? null : conversationTimes(data) };
}

// The conversation opened from a reflection (one per reflection per person), or null.
export async function selectConversationForEntry(entryId: string): Promise<RepoResult<ConversationRow | null>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.scholar.errors.conversation);
  const { data, error, status } = await supabase
    .from("scholar_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("entry_id", entryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) return fail("scholar_conversations", status, error, copy.scholar.errors.conversation);
  return { ok: true, data: data === null ? null : conversationTimes(data) };
}

// The newest `limit` messages of a conversation, returned oldest first.
export async function selectMessages(
  conversationId: string,
  limit = SCHOLAR_MESSAGES_LIMIT,
): Promise<RepoResult<MessageRow[]>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.scholar.errors.conversation);
  const { data, error, status } = await supabase
    .from("scholar_messages")
    .select(SCHOLAR_MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error !== null) return fail("scholar_messages", status, error, copy.scholar.errors.conversation);
  return { ok: true, data: data.map(messageTimes).reverse() };
}

// Deletes one of the user's conversations (its messages go with it). True when a row was deleted, false when there was none.
export async function deleteConversationRow(id: string): Promise<RepoResult<boolean>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized(copy.scholar.delete.failed);
  const { data, error, status } = await supabase
    .from("scholar_conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error !== null) return fail("scholar_conversations", status, error, copy.scholar.delete.failed);
  return { ok: true, data: data.length > 0 };
}
