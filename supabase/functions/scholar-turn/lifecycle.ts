import type { SupabaseClient } from "@supabase/supabase-js";

import { listAllFiles, removeAll } from "../_shared/account/storageFiles.ts";
import { AppError } from "../_shared/errors.ts";
import { STRAY_RECORDING_MS } from "../_shared/scholar/constants.ts";
import type { FallbackVariant } from "../_shared/scholar/heavyChat.ts";
import type { StoredBlock } from "../_shared/scholar/prompt.ts";
import type { HelpKind } from "../process-entry/contracts.ts";
import { dbFailure } from "../process-entry/lifecycle.ts";

// Every database and storage call of scholar-turn (step 38). The service-role client bypasses row level security, so each query
// filters by the verified user id, with no exceptions; the two counters are the database's own functions, and only the person's
// usage carries their id. Nothing here logs.

export type ConversationRow = {
  id: string;
  user_id: string;
  entry_id: string | null;
  title: string | null;
  is_heavy: boolean;
  last_message_at: string;
  created_at: string;
};

// What a message holds (jsonb, at most 16 KB): its blocks, and since 2026-11-11, on an answer that carries a help line, the help
// line's kind (one word, helpKind.ts) and, on a written answer, which one it was (so a second written answer in the conversation
// is the shorter one). Nothing else: no category, reason or phrase is ever saved.
export type MessageContent = { blocks: StoredBlock[]; help?: HelpKind; fallback?: FallbackVariant };

export type MessageRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "scholar";
  reply_to: string | null;
  input_type: "text" | "audio" | null;
  status: "pending" | "ready" | "failed";
  error_code: string | null;
  content: MessageContent | null;
  is_heavy: boolean;
  claimed_at: string | null;
  created_at: string;
};

// A write the table refused for a reason the flow answers itself: a row that is already there (23505), or a row it points at
// that is gone (23503). Every other failure throws.
export type Refused = { refused: "duplicate" | "missing" };

function refusal(error: { code?: string } | null): Refused | null {
  if (error?.code === "23505") return { refused: "duplicate" };
  if (error?.code === "23503") return { refused: "missing" };
  return null;
}

// ---- Reads ---------------------------------------------------------------------------------------------------------------

export async function findConversation(
  admin: SupabaseClient,
  userId: string,
  id: string,
): Promise<ConversationRow | null> {
  const { data, error } = await admin.from("scholar_conversations").select("*")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw dbFailure("scholar_conversation", error);
  return data as ConversationRow | null;
}

// The person's conversation about one reflection (at most one: the table's unique index).
export async function findConversationForEntry(
  admin: SupabaseClient,
  userId: string,
  entryId: string,
): Promise<ConversationRow | null> {
  const { data, error } = await admin.from("scholar_conversations").select("*")
    .eq("user_id", userId).eq("entry_id", entryId).maybeSingle();
  if (error) throw dbFailure("scholar_conversation_entry", error);
  return data as ConversationRow | null;
}

export async function findMessage(admin: SupabaseClient, userId: string, id: string): Promise<MessageRow | null> {
  const { data, error } = await admin.from("scholar_messages").select("*")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw dbFailure("scholar_message", error);
  return data as MessageRow | null;
}

// The answer to one message (at most one: reply_to is unique).
export async function findAnswer(admin: SupabaseClient, userId: string, messageId: string): Promise<MessageRow | null> {
  const { data, error } = await admin.from("scholar_messages").select("*")
    .eq("user_id", userId).eq("reply_to", messageId).maybeSingle();
  if (error) throw dbFailure("scholar_answer", error);
  return data as MessageRow | null;
}

// How many messages this person sent since `sinceIso`, not counting `excludeId` (the message being sent again).
export async function countRecentMessages(
  admin: SupabaseClient,
  userId: string,
  sinceIso: string,
  excludeId: string,
): Promise<number> {
  const { count, error } = await admin.from("scholar_messages").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("role", "user").gte("created_at", sinceIso).neq("id", excludeId);
  if (error) throw dbFailure("scholar_rate", error);
  return count ?? 0;
}

// The last `limit` ready messages of a conversation, oldest first: what the writer and the screening see.
export async function listHistory(
  admin: SupabaseClient,
  userId: string,
  conversationId: string,
  limit: number,
): Promise<MessageRow[]> {
  const { data, error } = await admin.from("scholar_messages").select("*")
    .eq("user_id", userId).eq("conversation_id", conversationId).eq("status", "ready")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw dbFailure("scholar_history", error);
  return (data as MessageRow[]).reverse();
}

// The person's usage rows from `fromDay` on. The day is the profile's local day, which is the UTC day, the day before or the day
// after; the caller picks its row once it knows the zone.
export async function readUsageRows(
  admin: SupabaseClient,
  userId: string,
  fromDay: string,
): Promise<{ day: string; messages: number; listens: number }[]> {
  const { data, error } = await admin.from("scholar_usage").select("day, messages, listens")
    .eq("user_id", userId).gte("day", fromDay);
  if (error) throw dbFailure("scholar_usage", error);
  return (data as { day: string; messages: number; listens: number }[]).map((row) => ({
    day: String(row.day),
    messages: Number(row.messages) || 0,
    listens: Number(row.listens) || 0,
  }));
}

// When Scholar was closed for this account (scholar_closed_at, 2026-11-11: the person told it they are under 18), or null. Read
// apart from readProfile, which process-entry shares, so that process-entry never needs the column.
export async function readScholarClosedAt(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.from("users_profile").select("scholar_closed_at").eq("id", userId).maybeSingle();
  if (error) throw dbFailure("scholar_closed", error);
  const value = (data as { scholar_closed_at?: string | null } | null)?.scholar_closed_at;
  return typeof value === "string" && value !== "" ? value : null;
}

// How many free messages were answered on one UTC day, across every account (the project-wide ceiling). No person in it.
export async function readFreeAnswered(admin: SupabaseClient, day: string): Promise<number> {
  const { data, error } = await admin.from("scholar_safety_daily").select("free_answered").eq("day", day).maybeSingle();
  if (error) throw dbFailure("scholar_safety", error);
  return Number((data as { free_answered?: number } | null)?.free_answered ?? 0) || 0;
}

// ---- Writes --------------------------------------------------------------------------------------------------------------

export type NewConversation = {
  id: string;
  user_id: string;
  entry_id: string | null;
  title: string | null;
  is_heavy: boolean;
};

export async function insertConversation(
  admin: SupabaseClient,
  row: NewConversation,
): Promise<ConversationRow | Refused> {
  const { data, error } = await admin.from("scholar_conversations").insert(row).select();
  if (error) {
    const refused = refusal(error);
    if (refused) return refused;
    throw dbFailure("scholar_conversation_insert", error);
  }
  const rows = data as ConversationRow[];
  if (rows.length !== 1) throw new AppError("INTERNAL", "db:scholar_conversation_insert:no_row");
  return rows[0];
}

// One flagged message marks its conversation heavy for good, and a heavy conversation has no title.
export async function markConversationHeavy(admin: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await admin.from("scholar_conversations").update({ is_heavy: true, title: null })
    .eq("user_id", userId).eq("id", id);
  if (error) throw dbFailure("scholar_conversation_heavy", error);
}

// After an answer: the conversation's last message time, and its title when this answer brought one. Answers the row, or null
// when the conversation was deleted meanwhile.
export async function touchConversation(
  admin: SupabaseClient,
  userId: string,
  id: string,
  fields: { last_message_at: string; title?: string | null; is_heavy?: boolean },
): Promise<ConversationRow | null> {
  const { data, error } = await admin.from("scholar_conversations").update(fields)
    .eq("user_id", userId).eq("id", id).select();
  if (error) throw dbFailure("scholar_conversation_touch", error);
  return (data as ConversationRow[])[0] ?? null;
}

export type NewMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "scholar";
  reply_to: string | null;
  input_type: "text" | "audio" | null;
  status: "pending" | "ready";
  error_code: null;
  content: MessageContent | null;
  is_heavy: boolean;
  claimed_at: string | null;
};

export async function insertMessage(admin: SupabaseClient, row: NewMessage): Promise<MessageRow | Refused> {
  const { data, error } = await admin.from("scholar_messages").insert(row).select();
  if (error) {
    const refused = refusal(error);
    if (refused) return refused;
    throw dbFailure("scholar_message_insert", error);
  }
  const rows = data as MessageRow[];
  if (rows.length !== 1) throw new AppError("INTERNAL", "db:scholar_message_insert:no_row");
  return rows[0];
}

// Claims a message that failed, or whose claim lapsed, for exactly one request: a compare-and-set update on its status (and, for a
// pending one, on when it was claimed). Its created_at becomes now, so a message sent again moves to the end of the conversation.
// Answers the claimed row, or null when another request claimed it first.
export async function reclaimMessage(
  admin: SupabaseClient,
  userId: string,
  id: string,
  from: { status: "pending" | "failed" | "ready"; staleBefore: string | null },
  fields: { claimed_at: string; created_at: string; content?: { blocks: StoredBlock[] } },
): Promise<MessageRow | null> {
  let query = admin.from("scholar_messages").update({ status: "pending", error_code: null, ...fields })
    .eq("user_id", userId).eq("id", id).eq("status", from.status);
  if (from.staleBefore !== null) query = query.lt("claimed_at", from.staleBefore);
  const { data, error } = await query.select();
  if (error) throw dbFailure("scholar_message_claim", error);
  return (data as MessageRow[])[0] ?? null;
}

// A spoken message's words, once the screening has heard them (the message's one text block).
export async function saveWords(admin: SupabaseClient, userId: string, id: string, words: string): Promise<void> {
  const { error } = await admin.from("scholar_messages").update({
    content: { blocks: [{ type: "text", text: words }] },
  })
    .eq("user_id", userId).eq("id", id);
  if (error) throw dbFailure("scholar_message_words", error);
}

// Closes Scholar for this account (the person said they are under 18). The first closing time stays: a second call changes
// nothing. Only support reopens it, by hand.
export async function closeScholar(admin: SupabaseClient, userId: string, atIso: string): Promise<void> {
  const { error } = await admin.from("users_profile").update({ scholar_closed_at: atIso })
    .eq("id", userId).is("scholar_closed_at", null);
  if (error) throw dbFailure("scholar_close", error);
}

export async function markMessageHeavy(admin: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await admin.from("scholar_messages").update({ is_heavy: true }).eq("user_id", userId).eq("id", id);
  if (error) throw dbFailure("scholar_message_heavy", error);
}

// Releases a claimed message that got no answer, with the code the person was told. Its words stay.
export async function failMessage(admin: SupabaseClient, userId: string, id: string, code: string): Promise<void> {
  const { error } = await admin.from("scholar_messages").update({ status: "failed", error_code: code })
    .eq("user_id", userId).eq("id", id).eq("status", "pending");
  if (error) throw dbFailure("scholar_message_fail", error);
}

// The person's message once its answer is saved. Answers the row, or null when it was deleted with its conversation meanwhile.
export async function finishMessage(
  admin: SupabaseClient,
  userId: string,
  id: string,
  isHeavy: boolean,
): Promise<MessageRow | null> {
  const fields = isHeavy
    ? { status: "ready", error_code: null, is_heavy: true }
    : { status: "ready", error_code: null };
  const { data, error } = await admin.from("scholar_messages").update(fields).eq("user_id", userId).eq("id", id)
    .select();
  if (error) throw dbFailure("scholar_message_finish", error);
  return (data as MessageRow[])[0] ?? null;
}

// ---- The counters (after the response) -------------------------------------------------------------------------------------

export async function bumpUsage(admin: SupabaseClient, userId: string, day: string, messages: number, listens: number) {
  const { error } = await admin.rpc("bump_scholar_usage", {
    p_user: userId,
    p_day: day,
    p_messages: messages,
    p_listens: listens,
  });
  if (error) throw dbFailure("scholar_usage_bump", error);
}

export type SafetyCounter =
  | "screened"
  | "flagged_phrase"
  | "flagged_model"
  | "flagged_uncertain"
  | "flagged_blocked"
  | "flagged_writer"
  | "fallbacks"
  | "screen_failed"
  | "free_answered";

export async function bumpSafety(admin: SupabaseClient, day: string, counter: SafetyCounter) {
  const { error } = await admin.rpc("bump_scholar_safety", { p_day: day, p_counter: counter });
  if (error) throw dbFailure("scholar_safety_bump", error);
}

// ---- Recordings ------------------------------------------------------------------------------------------------------------

// Where a spoken message's recording is uploaded by the app (the existing journal_media_insert_own_raw policy).
export function chatRecordingPath(userId: string, messageId: string): string {
  return `${userId}/raw/chat-${messageId}.m4a`;
}

export async function removeRecording(admin: SupabaseClient, userId: string, messageId: string): Promise<void> {
  await removeAll(admin, "journal_media", [chatRecordingPath(userId, messageId)]);
}

// A person's chat- recordings older than STRAY_RECORDING_MS (a take uploaded and never sent). Only their own raw folder, and only
// chat- files: a reflection's recording is never touched.
export async function sweepStrayRecordings(admin: SupabaseClient, userId: string, now: number): Promise<number> {
  const files = await listAllFiles(admin, "journal_media", `${userId}/raw`);
  const stray = files.filter((file) => {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    const made = file.createdAt === null ? NaN : Date.parse(file.createdAt);
    return file.path.startsWith(`${userId}/raw/`) && name.startsWith("chat-") && Number.isFinite(made) &&
      now - made > STRAY_RECORDING_MS;
  }).map((file) => file.path);
  return stray.length === 0 ? 0 : await removeAll(admin, "journal_media", stray);
}
