import { readScholarUsage, scholarSpeak, scholarTurn, scholarVoiceEnd, scholarVoiceStart } from "@/api/journalApi";
import { copy } from "@/constants/copy";
import { DEFAULT_SCHOLAR_VOICE, scholarVoiceOf, type ScholarVoiceKey } from "@/constants/scholarVoices";
import { toConversation, toScholarMessage } from "@/data/mappers";
import { getDataSource, takeMockScholarOutcome } from "@/data/mock/scenario";
import * as mock from "@/data/mock/scholar";
import {
  deleteConversationRow,
  selectConversation,
  selectConversationForEntry,
  selectConversationPage,
  selectCredits,
  selectFreeUse,
  selectMessages,
} from "@/data/scholarRemote";
import { getScholarVoice, hasAiPermission, hasVoicePermission } from "@/services/aiPermission";
import { uploadRawRecording } from "@/services/mediaUpload";
import { deleteRecording } from "@/services/recordingFiles";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { useEntitlementStore } from "@/store/entitlementStore";
import { selectCanSend, useOfflineStore } from "@/store/offlineStore";
import type {
  RepoResult,
  ScholarConversation,
  ScholarMessage,
  ScholarSpeakResponse,
  ScholarTurnRequest,
  ScholarTurnResponse,
  ScholarUsage,
  ScholarVoiceLimits,
  ScholarVoiceStartResponse,
} from "@/types";
import { deviceRegionCode } from "@/utils/region";
import { likePattern } from "@/utils/scholarHistory";
import { normalizeTimestamp } from "@/utils/timestamp";

// What Scholar's screens call (step 38, Part two). Conversations live in Postgres and the phone keeps them in memory only: no
// SQLite cache, no outbox and no Realtime (decision 11). Two gates stand in front of every message: nothing leaves the phone
// before the person has allowed Google's AI (AI Permission Rules), and nothing is sent while the phone is known to be offline.
// The mock data source answers from data/mock/scholar.ts and never reaches the server. Nothing here throws, and nothing logs.

// A turn that did not come back with an answer: the function's own code, or NO_PERMISSION (the AI permission is off), OFFLINE
// (nothing was sent), UPLOAD_FAILED (a spoken message's recording did not reach the bucket), NETWORK, UNAUTHORIZED or UNKNOWN.
// `usage` is what a 402 carries: the plan (scholar_plan, with the day Scholar opens for a trial) or a Pro account's credits.
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

// One page of conversations, newest first: the Scholar tab asks for a few, the Conversations screen for 30 at a time with a
// cursor (the last page's `nextCursor`) and, when the person searches, the words to match in a title. `nextCursor` is null on
// the last page.
export type ConversationPage = { conversations: ScholarConversation[]; nextCursor: string | null };

export async function listConversations(options: {
  limit: number;
  cursor?: string | null;
  query?: string | null;
}): Promise<RepoResult<ConversationPage>> {
  const cursor = options.cursor ?? null;
  const pattern = likePattern(options.query ?? "");
  if (isMock()) {
    await simulateWrite(300);
    const page = mock.pageMockConversations({
      cursor,
      limit: options.limit,
      query: pattern === null ? null : (options.query ?? "").trim(),
    });
    return { ok: true, data: page };
  }
  const result = await selectConversationPage({ cursor, limit: options.limit, pattern });
  return result.ok
    ? { ok: true, data: { conversations: result.data.rows.map(toConversation), nextCursor: result.data.nextCursor } }
    : result;
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

// A Pro account's credits as the server keeps them (2026-11-18), for the line above the composer: what is left and when they
// renew. Null when no window is running (none spent yet, or the last one ended, which is a whole allowance) and when the row
// cannot be read. The app decides nothing from it: the server checks every message.
export async function readScholarCredits(now = Date.now()): Promise<ScholarUsage | null> {
  if (isMock()) return mock.mockCredits(now);
  const result = await selectCredits();
  if (!result.ok || result.data === null) return null;
  const renewsAt = Date.parse(result.data.renews_at);
  if (!Number.isFinite(renewsAt) || renewsAt <= now) return null;
  const used = Math.max(0, result.data.used);
  const limit = result.data.allowance;
  return { kind: "credits", used, limit, remaining: Math.max(0, limit - used), resetsAt: result.data.renews_at };
}

// The free conversation (2026-11-20) of an account that is not Pro: the conversation that claimed it and how many of its free
// messages were answered. Null while none is claimed (the next conversation to be answered becomes the free one); undefined when
// the row cannot be read. The app uses it only to offer Listen and Talk there; the server checks every message itself.
export type FreeConversation = { conversationId: string; messages: number };

export async function readScholarFree(): Promise<FreeConversation | null | undefined> {
  if (isMock()) return mock.mockFree();
  const result = await selectFreeUse();
  if (!result.ok) return undefined;
  return result.data === null ? null : { conversationId: result.data.conversation_id, messages: result.data.messages };
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
// read: they are kept as the rest of the app keeps a server time (utils/timestamp.ts), so the messages sort by them. A function
// from before scholar-v3 sends no welcome, which reads as none.
function withCanonicalTimes(data: ScholarTurnResponse): ScholarTurnResponse {
  const message = (item: ScholarMessage): ScholarMessage => ({
    ...item,
    welcome: item.welcome === true,
    createdAt: normalizeTimestamp(item.createdAt),
  });
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

// The voice an answer is read aloud in (2026-11-19): the one this account chose for Scholar, when it has allowed ElevenLabs, which
// reads it; otherwise none, and the server reads it in the devotional's voice. The server may still use the devotional's voice
// (its switch is off, or ElevenLabs failed): the voice is a wish, never a promise. A free account (2026-11-20) has the default
// voice only, which the server holds it to as well, so its parts are asked for, and kept, in that voice.
export function listenVoice(): ScholarVoiceKey | null {
  return hasVoicePermission() ? accountVoice() : null;
}

// The voice this account may use: the one it chose, or the default for a free account.
function accountVoice(): ScholarVoiceKey {
  return useEntitlementStore.getState().tier === "free" ? DEFAULT_SCHOLAR_VOICE : getScholarVoice();
}

// One part of an answer read aloud, in `voice` when one is given. A voice goes only while ElevenLabs is allowed, whoever asks:
// without the permission the part is asked for with no voice. The mock data has no voice.
export async function speak(messageId: string, part: number, voice: ScholarVoiceKey | null = null): Promise<SpeakResult> {
  if (!hasAiPermission()) return { ok: false, code: "NO_PERMISSION", usage: null };
  if (isMock()) {
    await simulateWrite(400);
    return { ok: false, code: "AI_UNAVAILABLE", usage: null };
  }
  if (!selectCanSend(useOfflineStore.getState())) return { ok: false, code: "OFFLINE", usage: null };
  const spokenIn = voice !== null && hasVoicePermission() ? voice : null;
  const result = await scholarSpeak(withRegion({ messageId, part, ...(spokenIn === null ? {} : { voice: spokenIn }) }));
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, code: result.code, usage: readScholarUsage(result.body) };
}

// ---- The live talk (step 39) ----
// A talk that could not start: the function's own code, or NO_PERMISSION (Google's AI is not allowed), NO_VOICE_PERMISSION
// (ElevenLabs is not allowed), OFFLINE and MOCK (the mock data has no voice), each with nothing sent. `usage` is what a 402
// carries (talk_plan for an account that is not Pro, with the day its plan begins for a trial; talk_month when the month's time
// is used up).
export type TalkStart = ScholarVoiceStartResponse & { voice: ScholarVoiceKey };
export type TalkStartResult = { ok: true; data: TalkStart } | { ok: false; code: string; usage: ScholarUsage | null };
export type TalkEndResult = { ok: true; limits: ScholarVoiceLimits } | { ok: false; code: string };

function canonicalLimits(limits: ScholarVoiceLimits): ScholarVoiceLimits {
  return { ...limits, resetsAt: normalizeTimestamp(limits.resetsAt) };
}

// Starts a live talk in a conversation: ElevenLabs' one-time token and the session the server signed. Both permissions are asked
// first, then the mock data, then the network. The voice is the one this account chose on this phone (the default for a free
// account, 2026-11-20); the server picks its agent, and answers with the voice the talk really uses.
export async function startTalk(input: { conversationId: string; entryId: string | null }): Promise<TalkStartResult> {
  if (!hasAiPermission()) return { ok: false, code: "NO_PERMISSION", usage: null };
  if (!hasVoicePermission()) return { ok: false, code: "NO_VOICE_PERMISSION", usage: null };
  if (isMock()) return { ok: false, code: "MOCK", usage: null };
  if (!selectCanSend(useOfflineStore.getState())) return { ok: false, code: "OFFLINE", usage: null };
  const request = withRegion({
    conversationId: input.conversationId,
    voice: accountVoice(),
    ...(input.entryId === null ? {} : { entryId: input.entryId }),
  });
  const result = await scholarVoiceStart(request);
  if (!result.ok) return { ok: false, code: result.code, usage: readScholarUsage(result.body) };
  return {
    ok: true,
    data: { ...result.data, voice: scholarVoiceOf(result.data.voice), limits: canonicalLimits(result.data.limits) },
  };
}

// The talk is over. Ending always works: no permission is asked, so a talk whose permission was taken back during it still
// closes. The answer is what is left of the month's talk time.
export async function finishTalk(talkId: string): Promise<TalkEndResult> {
  const result = await scholarVoiceEnd(talkId);
  return result.ok ? { ok: true, limits: canonicalLimits(result.data.limits) } : { ok: false, code: result.code };
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
