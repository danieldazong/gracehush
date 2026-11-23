import type { SupabaseClient } from "@supabase/supabase-js";

import { dbFailure } from "../../process-entry/lifecycle.ts";

// Every database call about scholar_voice_sessions, the server's record of each live talk (step 39). The service-role client
// bypasses row level security, so each query filters by the verified user id, with no exceptions. The app can neither read nor
// write the table (it has no policy and no grant). Nothing here logs.

export type VoiceSessionRow = {
  // The talk's id, made by the server and carried in its signed session.
  id: string;
  user_id: string;
  // No foreign key: deleting a conversation does not give its talk time back.
  conversation_id: string;
  voice: string;
  started_at: string;
  last_turn_at: string | null;
  ended_at: string | null;
  // The talk's own cap in seconds, or null for a talk that started in a heavy conversation (never cut).
  cap_seconds: number | null;
  // How long the talk has lasted, as of its last turn or its end.
  seconds: number;
  turns: number;
  // The conversation was heavy when the talk started, or became heavy during it: the talk is never counted.
  is_heavy: boolean;
};

const COLUMNS = "id,user_id,conversation_id,voice,started_at,last_turn_at,ended_at,cap_seconds,seconds,turns,is_heavy";

// The person's talks that started at or after a moment, newest first. At most twenty start in a day, so a month's are well
// under the limit.
export async function listSessionsSince(
  admin: SupabaseClient,
  userId: string,
  sinceIso: string,
): Promise<VoiceSessionRow[]> {
  const { data, error } = await admin.from("scholar_voice_sessions").select(COLUMNS)
    .eq("user_id", userId).gte("started_at", sinceIso).order("started_at", { ascending: false }).limit(1000);
  if (error) throw dbFailure("voice_sessions", error);
  return data as VoiceSessionRow[];
}

// The person's talks in one conversation, newest first, however long ago (2026-11-20: the free conversation's talk time is
// counted over its whole life, not a month).
export async function listSessionsInConversation(
  admin: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<VoiceSessionRow[]> {
  const { data, error } = await admin.from("scholar_voice_sessions").select(COLUMNS)
    .eq("user_id", userId).eq("conversation_id", conversationId).order("started_at", { ascending: false }).limit(1000);
  if (error) throw dbFailure("voice_sessions", error);
  return data as VoiceSessionRow[];
}

// One talk of this person's. Another person's talk and one that does not exist are the same null.
export async function findSession(admin: SupabaseClient, userId: string, id: string): Promise<VoiceSessionRow | null> {
  const { data, error } = await admin.from("scholar_voice_sessions").select(COLUMNS)
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw dbFailure("voice_session", error);
  return data as VoiceSessionRow | null;
}

export async function insertSession(
  admin: SupabaseClient,
  row: Pick<VoiceSessionRow, "id" | "user_id" | "conversation_id" | "voice" | "cap_seconds" | "is_heavy">,
): Promise<VoiceSessionRow> {
  const { data, error } = await admin.from("scholar_voice_sessions").insert(row).select(COLUMNS);
  if (error) throw dbFailure("voice_session_insert", error);
  return (data as VoiceSessionRow[])[0];
}

// Ends a talk that has not ended: when it ended and how long it lasted. Answers the row as it now stands, or null when the talk
// had already ended (or is not this person's), in which case nothing changed.
export async function closeSession(
  admin: SupabaseClient,
  userId: string,
  id: string,
  fields: { ended_at: string; seconds: number },
): Promise<VoiceSessionRow | null> {
  const { data, error } = await admin.from("scholar_voice_sessions").update(fields)
    .eq("user_id", userId).eq("id", id).is("ended_at", null).select(COLUMNS);
  if (error) throw dbFailure("voice_session_close", error);
  return (data as VoiceSessionRow[])[0] ?? null;
}

// After a turn of a talk that is still running: when it was, how long the talk has lasted, and its turns when this one counted.
export async function recordTurn(
  admin: SupabaseClient,
  userId: string,
  id: string,
  fields: { last_turn_at: string; seconds: number; turns?: number },
): Promise<void> {
  const { error } = await admin.from("scholar_voice_sessions").update(fields)
    .eq("user_id", userId).eq("id", id).is("ended_at", null);
  if (error) throw dbFailure("voice_session_turn", error);
}

// The conversation became heavy during the talk: the talk is not counted, whether or not it has ended since.
export async function markSessionHeavy(admin: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await admin.from("scholar_voice_sessions").update({ is_heavy: true })
    .eq("user_id", userId).eq("id", id);
  if (error) throw dbFailure("voice_session_heavy", error);
}
