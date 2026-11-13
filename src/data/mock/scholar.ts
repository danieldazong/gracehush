import type { MockScholarOutcome } from "@/data/mock/scenario";
import { bsb } from "@/data/mock/scripture";
import type {
  ScholarConversation,
  ScholarMessage,
  ScholarTurnRequest,
  ScholarTurnResponse,
  ScholarUsage,
  Scripture,
} from "@/types";

// Scholar on the mock data (step 38, Part two): development only, when the data source is "mock". Conversations live in memory
// and the answers are written here, so the screens can be seen and their states reached without the server. The day's limit
// below is the mock's stand-in for the server's; the app itself holds no limit number. Every passage is the Berean Standard
// Bible text of data/mock/scripture.ts, pasted from the Bible API, never written from memory.

const MOCK_FREE_LIMIT = 5;

const conversations = new Map<string, ScholarConversation>();
const messages = new Map<string, ScholarMessage[]>();
let usedToday = 0;

function passage(reference: keyof typeof bsb): Scripture {
  return { reference, text: bsb[reference], translation: "BSB", verified: true };
}

function nowIso(now: number): string {
  return new Date(now).toISOString();
}

function usage(): ScholarUsage {
  return {
    kind: "free_day",
    used: usedToday,
    limit: MOCK_FREE_LIMIT,
    remaining: Math.max(0, MOCK_FREE_LIMIT - usedToday),
    resetsAt: null,
  };
}

export function resetMockScholar(): void {
  conversations.clear();
  messages.clear();
  usedToday = 0;
}

export function listMockConversations(): ScholarConversation[] {
  return [...conversations.values()].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export function getMockConversation(id: string): { conversation: ScholarConversation | null; messages: ScholarMessage[] } {
  const conversation = conversations.get(id) ?? null;
  return { conversation, messages: conversation === null ? [] : [...(messages.get(id) ?? [])] };
}

export function findMockConversationForEntry(entryId: string): ScholarConversation | null {
  return [...conversations.values()].find((conversation) => conversation.entryId === entryId) ?? null;
}

export function deleteMockConversation(id: string): void {
  conversations.delete(id);
  messages.delete(id);
}

function personMessage(request: ScholarTurnRequest, conversationId: string, at: string): ScholarMessage {
  return {
    id: request.messageId,
    conversationId,
    role: "user",
    replyTo: null,
    inputType: request.input.type,
    status: "ready",
    errorCode: null,
    blocks: request.input.type === "text"
      ? [{ type: "text", text: request.input.text.trim() }]
      : [{ type: "text", text: "This is where the words you spoke would be." }],
    isHeavy: false,
    helpLine: null,
    createdAt: at,
  };
}

// One turn of the mock: what the server would answer for the outcome the developer panel chose.
export function mockTurn(
  request: ScholarTurnRequest,
  outcome: MockScholarOutcome,
  now: number,
): { ok: true; data: ScholarTurnResponse } | { ok: false; code: string; usage: ScholarUsage | null } {
  const at = nowIso(now);
  const existing = conversations.get(request.conversationId);
  const heavy = outcome === "heavy" || existing?.isHeavy === true;
  const list = messages.get(request.conversationId) ?? [];
  const failedBefore = list.find((message) => message.id === request.messageId);

  if (!heavy && (outcome === "failed" || outcome === "limit" || outcome === "resting")) {
    const code = outcome === "failed" ? "AI_UNAVAILABLE" : outcome === "limit" ? "LIMIT_REACHED" : "SCHOLAR_UNAVAILABLE";
    if (outcome !== "resting") {
      const failed: ScholarMessage = { ...personMessage(request, request.conversationId, at), status: "failed", errorCode: code };
      if (existing === undefined) {
        conversations.set(request.conversationId, {
          id: request.conversationId,
          entryId: request.entryId ?? null,
          title: null,
          isHeavy: false,
          lastMessageAt: at,
          createdAt: at,
        });
      }
      messages.set(request.conversationId, [...list.filter((message) => message.id !== request.messageId), failed]);
    }
    return { ok: false, code, usage: outcome === "limit" ? { ...usage(), used: MOCK_FREE_LIMIT, remaining: 0 } : null };
  }

  const conversation: ScholarConversation = {
    id: request.conversationId,
    entryId: existing?.entryId ?? request.entryId ?? null,
    title: heavy ? null : existing?.title ?? "Peace when I’m anxious",
    isHeavy: heavy,
    lastMessageAt: at,
    createdAt: existing?.createdAt ?? at,
  };
  const message = { ...personMessage(request, conversation.id, failedBefore?.createdAt ?? at), isHeavy: outcome === "heavy" };
  const answer: ScholarMessage = heavy
    ? {
      id: `${request.messageId.slice(0, 24)}aaaaaaaaaaaa`,
      conversationId: conversation.id,
      role: "scholar",
      replyTo: message.id,
      inputType: null,
      status: "ready",
      errorCode: null,
      blocks: [
        { type: "passage", scripture: passage("Isaiah 41:10") },
        {
          type: "text",
          text:
            "Thank you for telling me. What you’re carrying is heavy, and you don’t have to hold it by yourself tonight.\n\nGod is near to you right now. Is there one person you trust whom you could reach out to today?",
        },
      ],
      isHeavy: outcome === "heavy",
      helpLine: outcome === "heavy" ? "crisis" : null,
      createdAt: nowIso(now + 1),
    }
    : {
      id: `${request.messageId.slice(0, 24)}bbbbbbbbbbbb`,
      conversationId: conversation.id,
      role: "scholar",
      replyTo: message.id,
      inputType: null,
      status: "ready",
      errorCode: null,
      blocks: [
        { type: "passage", scripture: passage("Philippians 4:6–7") },
        {
          type: "text",
          text:
            "Paul wrote these words from prison, so they come from someone who knew real trouble. He doesn’t tell the Philippians to pretend; he tells them to bring every worry to God in prayer, with thanks for what God has already done.\n\nThe promise isn’t that every problem disappears. It’s that God’s peace will stand guard over your heart and mind while you wait.",
        },
        {
          type: "prayer",
          text:
            "Father, you are the God who hears every worry I carry. Today I bring you what is weighing on me. Give me your peace in place of my fear. Help me rest in your care tonight, and trust you with what I cannot fix.",
        },
      ],
      isHeavy: false,
      helpLine: null,
      createdAt: nowIso(now + 1),
    };
  if (!heavy) usedToday += 1;
  conversations.set(conversation.id, conversation);
  messages.set(conversation.id, [...list.filter((item) => item.id !== message.id), message, answer]);
  return { ok: true, data: { conversation, message, answer, usage: heavy ? null : usage() } };
}
