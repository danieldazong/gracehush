import { getMockDb } from "@/data/mock/db";
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
// and the answers are written here, so the screens can be seen and their states reached without the server. The credits below
// are the mock's stand-in for a Pro account's (2026-11-18: an allowance that renews 24 hours after its first spend, a message
// costing a few), and the free conversation is the mock's stand-in for an account that is not Pro on the mock plan (2026-11-20);
// the app itself holds no limit number. Every passage is the Berean Standard Bible text of
// data/mock/scripture.ts, pasted from the Bible API, never written from memory.

const MOCK_CREDITS = { allowance: 400, message: 4, windowMs: 86_400_000 } as const;
// The mock trial's free days, for the "trial" outcome: when its plan begins and Scholar opens.
const MOCK_TRIAL_MS = 3 * 86_400_000;
// The mock's stand-in for the free conversation (2026-11-20): an account that is not Pro on the mock plan has one conversation
// whose first few messages are answered. The number is the mock's own; the app holds none.
const MOCK_FREE_MESSAGES = 8;

const conversations = new Map<string, ScholarConversation>();
const messages = new Map<string, ScholarMessage[]>();
let creditsUsed = 0;
let creditsRenewAt: number | null = null;
let free: { conversationId: string; messages: number } | null = null;

function passage(reference: keyof typeof bsb): Scripture {
  return { reference, text: bsb[reference], translation: "BSB", verified: true };
}

function nowIso(now: number): string {
  return new Date(now).toISOString();
}

function windowRuns(now: number): boolean {
  return creditsRenewAt !== null && creditsRenewAt > now;
}

function credits(now: number): ScholarUsage {
  const used = windowRuns(now) ? creditsUsed : 0;
  return {
    kind: "credits",
    used,
    limit: MOCK_CREDITS.allowance,
    remaining: Math.max(0, MOCK_CREDITS.allowance - used),
    resetsAt: windowRuns(now) && creditsRenewAt !== null ? nowIso(creditsRenewAt) : null,
  };
}

// A spend starts a new window when none runs, as spend_scholar_credits does.
function spend(cost: number, now: number): void {
  if (!windowRuns(now)) {
    creditsUsed = 0;
    creditsRenewAt = now + MOCK_CREDITS.windowMs;
  }
  creditsUsed += cost;
}

// What a refusal of the mock carries: no credit left ("limit"), the free plan ("plan") or a trial whose plan has not begun
// ("trial"); the other outcomes carry nothing.
function refusal(outcome: MockScholarOutcome, now: number): ScholarUsage | null {
  if (outcome === "limit") {
    const renews = windowRuns(now) && creditsRenewAt !== null ? creditsRenewAt : now + MOCK_CREDITS.windowMs;
    const limit = MOCK_CREDITS.allowance;
    return { kind: "credits", used: limit, limit, remaining: 0, resetsAt: nowIso(renews) };
  }
  if (outcome === "plan") return { kind: "scholar_plan", used: 0, limit: 0, remaining: 0, resetsAt: null };
  if (outcome === "trial") {
    return { kind: "scholar_plan", used: 0, limit: 0, remaining: 0, resetsAt: nowIso(now + MOCK_TRIAL_MS) };
  }
  return null;
}

// The mock's credits as readScholarCredits answers them: null while no window runs.
export function mockCredits(now: number): ScholarUsage | null {
  return windowRuns(now) ? credits(now) : null;
}

// The mock's free conversation as readScholarFree answers it: null while none is claimed.
export function mockFree(): { conversationId: string; messages: number } | null {
  return free === null ? null : { ...free };
}

function freeUsage(used: number): ScholarUsage {
  return { kind: "free", used, limit: MOCK_FREE_MESSAGES, remaining: Math.max(0, MOCK_FREE_MESSAGES - used), resetsAt: null };
}

// The mock plan's tier, as the mock data's profile holds it (the developer panel's Mock plan).
function mockTier(): string {
  return getMockDb().profile.subscription_tier;
}

export function resetMockScholar(): void {
  conversations.clear();
  messages.clear();
  creditsUsed = 0;
  creditsRenewAt = null;
  free = null;
}

export function listMockConversations(): ScholarConversation[] {
  return [...conversations.values()].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

// One page of the mock's conversations as the server pages them: newest first, those older than `cursor` (a `lastMessageAt`),
// whose title holds `query` (a title that is none never matches), and a next cursor when more follow.
export function pageMockConversations(options: {
  cursor: string | null;
  limit: number;
  query: string | null;
}): { conversations: ScholarConversation[]; nextCursor: string | null } {
  const needle = options.query?.toLowerCase() ?? null;
  const matching = listMockConversations().filter(
    (conversation) =>
      (options.cursor === null || conversation.lastMessageAt < options.cursor) &&
      (needle === null || (conversation.title?.toLowerCase().includes(needle) ?? false)),
  );
  const page = matching.slice(0, options.limit);
  const last = page[page.length - 1];
  return {
    conversations: page,
    nextCursor: matching.length > options.limit && last !== undefined ? last.lastMessageAt : null,
  };
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
    welcome: false,
    createdAt: at,
  };
}

// One turn of the mock: what the server would answer for the outcome the developer panel chose.
export function mockTurn(
  request: ScholarTurnRequest,
  chosen: MockScholarOutcome,
  now: number,
): { ok: true; data: ScholarTurnResponse } | { ok: false; code: string; usage: ScholarUsage | null } {
  const at = nowIso(now);
  const existing = conversations.get(request.conversationId);
  const heavy = chosen === "heavy" || existing?.isHeavy === true;
  const list = messages.get(request.conversationId) ?? [];
  const failedBefore = list.find((message) => message.id === request.messageId);
  // An account that is not Pro on the mock plan: answered in its free conversation while a free message is left, and told by its
  // plan otherwise, as scholar-turn does (2026-11-20).
  const notPro = mockTier() !== "pro";
  const freeOpen = free === null || free.conversationId === request.conversationId;
  const freeLeft = freeOpen && (free?.messages ?? 0) < MOCK_FREE_MESSAGES;
  const outcome: MockScholarOutcome = !heavy && chosen === "ready" && notPro && !freeLeft
    ? mockTier() === "trial" ? "trial" : "plan"
    : chosen;

  if (!heavy && outcome !== "ready") {
    const code = outcome === "failed" ? "AI_UNAVAILABLE" : outcome === "resting" ? "SCHOLAR_UNAVAILABLE" : "LIMIT_REACHED";
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
    return { ok: false, code, usage: refusal(outcome, now) };
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
      welcome: false,
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
      welcome: false,
      createdAt: nowIso(now + 1),
    };
  let usage: ScholarUsage | null = null;
  if (!heavy && notPro) {
    free = { conversationId: conversation.id, messages: (free?.messages ?? 0) + 1 };
    usage = freeUsage(free.messages);
  } else if (!heavy) {
    spend(MOCK_CREDITS.message, now);
    usage = credits(now);
  }
  conversations.set(conversation.id, conversation);
  messages.set(conversation.id, [...list.filter((item) => item.id !== message.id), message, answer]);
  return { ok: true, data: { conversation, message, answer, usage } };
}
