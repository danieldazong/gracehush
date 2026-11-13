import { readScholarUsage, scholarSpeak, scholarTurn } from "@/api/journalApi";
import { copy } from "@/constants/copy";
import { toConversation, toScholarMessage } from "@/data/mappers";
import { getDataSource, takeMockScholarOutcome } from "@/data/mock/scenario";
import * as mock from "@/data/mock/scholar";
import {
  deleteConversationRow,
  selectConversation,
  selectConversationForEntry,
  selectConversations,
  selectMessages,
} from "@/data/scholarRemote";
import { hasAiPermission } from "@/services/aiPermission";
import { uploadRawRecording } from "@/services/mediaUpload";
import { deleteRecording } from "@/services/recordingFiles";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { selectCanSend, useOfflineStore } from "@/store/offlineStore";
import type {
  RepoResult,
  ScholarConversation,
  ScholarMessage,
  ScholarSpeakResponse,
  ScholarTurnRequest,
  ScholarTurnResponse,
  ScholarUsage,
} from "@/types";
import { deviceRegionCode } from "@/utils/region";
import { normalizeTimestamp } from "@/utils/timestamp";

// What Scholar's screens call (step 38, Part two). Conversations live in Postgres and the phone keeps them in memory only: no
// SQLite cache, no outbox and no Realtime (decision 11). Two gates stand in front of every message: nothing leaves the phone
// before the person has allowed Google's AI (AI Permission Rules), and nothing is sent while the phone is known to be offline.
// The mock data source answers from data/mock/scholar.ts and never reaches the server. Nothing here throws, and nothing logs.

// A turn that did not come back with an answer: the function's own code, or NO_PERMISSION (the AI permission is off), OFFLINE
// (nothing was sent), UPLOAD_FAILED (a spoken message's recording did not reach the bucket), NETWORK, UNAUTHORIZED or UNKNOWN.
// `usage` is the day's numbers a 402 carries.
export type TurnResult =
  | { ok: true; data: ScholarTurnResponse }
  | { ok: false; code: string; usage: ScholarUsage | null };

export type SpeakResult = { ok: true; data: ScholarSpeakResponse } | { ok: false; code: string; usage: ScholarUsage | null };

// A finished recording waiting to go with a spoken message.
export type SpokenTake = { uri: string };

export type ConversationData = { conversation: ScholarConversation | null; messages: ScholarMessage[] };

const MOCK_LATENCY_MS = 1_200;

function simulateWrite(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A spoken message's recording is named after the message: {userId}/raw/chat-{messageId}.m4a, where scholar-turn reads it.
export function chatRecordingId(messageId: string): string {
  return `chat-${messageId}`;
}

// A turn on its way: the request, so a screen opened again can draw the person's message, and the answer to come.
export type TurnInFlight = { messageId: string; request: Omit<ScholarTurnRequest, "region">; promise: Promise<TurnResult> };

// The messages whose recording is in the bucket, so a retry does not upload it again, and the turn each conversation has in
// flight, so leaving the screen and coming back finds it. Both are this session's, and sign-out forgets them.
const uploaded = new Set<string>();
const inFlight = new Map<string, TurnInFlight>();

export function forgetScholarSession(): void {
  uploaded.clear();
  inFlight.clear();
}

function isMock(): boolean {
  return getDataSource() === "mock";
}

// Whether a message can be sent now: the mock data always, otherwise unless NetInfo says there is no connection.
export function canReachScholar(): boolean {
  return isMock() || selectCanSend(useOfflineStore.getState());
}

export async function listConversations(): Promise<RepoResult<ScholarConversation[]>> {
  if (isMock()) {
    await simulateWrite(300);
    return { ok: true, data: mock.listMockConversations() };
  }
  const result = await selectConversations();
  return result.ok ? { ok: true, data: result.data.map(toConversation) } : result;
}

// A conversation and its messages, oldest first. A conversation that does not exist (or is not this user's) is null.
export async function getConversation(id: string): Promise<RepoResult<ConversationData>> {
  if (isMock()) {
    await simulateWrite(300);
    return { ok: true, data: mock.getMockConversation(id) };
  }
  const [conversation, messages] = await Promise.all([selectConversation(id), selectMessages(id)]);
  if (!conversation.ok) return conversation;
  if (!messages.ok) return messages;
  if (conversation.data === null) return { ok: true, data: { conversation: null, messages: [] } };
  return {
    ok: true,
    data: { conversation: toConversation(conversation.data), messages: messages.data.map(toScholarMessage) },
  };
}

// The conversation opened from a reflection before, or null (one per reflection per person).
export async function findConversationForEntry(entryId: string): Promise<RepoResult<ScholarConversation | null>> {
  if (isMock()) return { ok: true, data: mock.findMockConversationForEntry(entryId) };
  const result = await selectConversationForEntry(entryId);
  return result.ok ? { ok: true, data: result.data === null ? null : toConversation(result.data) } : result;
}

export function getTurnInFlight(conversationId: string): TurnInFlight | null {
  return inFlight.get(conversationId) ?? null;
}

// One message and its answer. The same message sent again while it is in flight joins that request. A spoken message's
// recording is uploaded once (a retry finds it in the bucket), and the take on the phone is deleted as soon as it is there.
export function sendTurn(request: Omit<ScholarTurnRequest, "region">, take?: SpokenTake): Promise<TurnResult> {
  const running = inFlight.get(request.conversationId);
  if (running !== undefined && running.messageId === request.messageId) return running.promise;
  const promise = runTurn(request, take).finally(() => {
    if (inFlight.get(request.conversationId)?.promise === promise) inFlight.delete(request.conversationId);
  });
  inFlight.set(request.conversationId, { messageId: request.messageId, request, promise });
  return promise;
}

function withRegion<T extends object>(request: T): T & { region?: string } {
  const region = deviceRegionCode();
  return region === null ? request : { ...request, region };
}

async function runTurn(request: Omit<ScholarTurnRequest, "region">, take?: SpokenTake): Promise<TurnResult> {
  if (!hasAiPermission()) return { ok: false, code: "NO_PERMISSION", usage: null };
  if (isMock()) {
    await simulateWrite(MOCK_LATENCY_MS);
    return mock.mockTurn(request, takeMockScholarOutcome(), Date.now());
  }
  if (!selectCanSend(useOfflineStore.getState())) return { ok: false, code: "OFFLINE", usage: null };
  if (request.input.type === "audio" && take !== undefined && !uploaded.has(request.messageId)) {
    const userId = getSupabaseUserId();
    if (userId === null) return { ok: false, code: "UNAUTHORIZED", usage: null };
    const upload = await uploadRawRecording({ clientEntryId: chatRecordingId(request.messageId), uri: take.uri }, userId);
    if (!upload.ok) return { ok: false, code: upload.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "UPLOAD_FAILED", usage: null };
    uploaded.add(request.messageId);
    await deleteRecording(chatRecordingId(request.messageId)).catch(() => undefined);
  }
  const result = await scholarTurn(withRegion(request));
  if (result.ok) return { ok: true, data: withCanonicalTimes(result.data) };
  return { ok: false, code: result.code, usage: readScholarUsage(result.body) };
}

// The function answers with the times PostgREST wrote (microseconds and an offset), which the phone's engine was not shown to
// read: they are kept as the rest of the app keeps a server time (utils/timestamp.ts), so the messages sort by them.
function withCanonicalTimes(data: ScholarTurnResponse): ScholarTurnResponse {
  const message = (item: ScholarMessage): ScholarMessage => ({ ...item, createdAt: normalizeTimestamp(item.createdAt) });
  return {
    ...data,
    conversation: {
      ...data.conversation,
      createdAt: normalizeTimestamp(data.conversation.createdAt),
      lastMessageAt: normalizeTimestamp(data.conversation.lastMessageAt),
    },
    message: message(data.message),
    answer: message(data.answer),
  };
}

// One part of an answer read aloud. The mock data has no voice.
export async function speak(messageId: string, part: number): Promise<SpeakResult> {
  if (!hasAiPermission()) return { ok: false, code: "NO_PERMISSION", usage: null };
  if (isMock()) {
    await simulateWrite(400);
    return { ok: false, code: "AI_UNAVAILABLE", usage: null };
  }
  if (!selectCanSend(useOfflineStore.getState())) return { ok: false, code: "OFFLINE", usage: null };
  const result = await scholarSpeak(withRegion({ messageId, part }));
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, code: result.code, usage: readScholarUsage(result.body) };
}

// Deletes a conversation for good (its messages go with it). Online only, never queued; one that is already gone counts as
// deleted.
export async function deleteConversation(id: string): Promise<RepoResult<null>> {
  if (isMock()) {
    await simulateWrite(300);
    mock.deleteMockConversation(id);
    return { ok: true, data: null };
  }
  if (!selectCanSend(useOfflineStore.getState())) {
    return { ok: false, code: "NETWORK", message: copy.scholar.delete.offline };
  }
  const result = await deleteConversationRow(id);
  return result.ok ? { ok: true, data: null } : result;
}
