import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  SCHOLAR_BREAK_NUDGE_TURNS,
  SCHOLAR_LOW_REMAINING,
  SCHOLAR_MAX_MESSAGE_LENGTH,
  SCHOLAR_MIN_SPOKEN_MS,
  SCHOLAR_PENDING_MS,
  SCHOLAR_PENDING_POLL_MS,
} from "@/constants/app";
import { copy } from "@/constants/copy";
import { getEntry } from "@/data/journalRepository";
import {
  canReachScholar,
  deleteConversation,
  findConversationForEntry,
  getConversation,
  getTurnInFlight,
  sendTurn,
  type TurnResult,
} from "@/data/scholarRepository";
import type { RootStackParamList } from "@/navigation/types";
import { hasAiPermission } from "@/services/aiPermission";
import { track } from "@/services/analytics";
import type { HomeEntry, ScholarConversation, ScholarInput, ScholarMessage, ScholarTurnRequest, ScholarUsage } from "@/types";
import {
  answerCount,
  buildConversationRows,
  isHeavyConversation,
  messageText,
  newestHelpLine,
  orderMessages,
} from "@/utils/scholarRows";

// Everything the Conversation screen does with its messages (step 38): it opens a conversation (by id, by its reflection, or a new
// one with an id made on the phone), sends one message at a time, shows the person's message at once and the answer when it comes,
// and keeps every failure on the screen with a way to try again under the same id (the server answers a message once). Nothing is
// sent before the AI permission or while the phone is known to be offline. No limit number lives here: the server's 402 and its
// `usage` say when a limit is reached and how many free messages are left.

type Params = RootStackParamList["Conversation"];
type Request = Omit<ScholarTurnRequest, "region">;

export type ConversationPhase = "loading" | "ready" | "missing" | "error";

export type ConversationNotice =
  | "offline"
  | "freeLimit"
  | "proLimit"
  | "rateLimited"
  | "resting"
  | "adultsOnly"
  | "noWords"
  | "uploadFailed"
  | "tooShort";

// A finished take waiting to be sent: its id is the message's (the file is recordings/chat-{messageId}.m4a).
export type SpokenTake = { messageId: string; uri: string; durationMs: number };
// "sent": the turn started. "kept": nothing was sent (offline, or a turn is in flight) and the take stays. "too_short": under a
// second, and the composer throws it away.
export type SpokenSend = "sent" | "kept" | "too_short";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function startedSource(params: Params): "tab" | "starter" | "reflection" {
  if (params.entryId !== undefined) return "reflection";
  if (params.starter !== undefined) return "starter";
  return "tab";
}

// The time a message drawn on the phone takes: now, or just after the newest message on the screen when the phone's clock is
// behind the server's, so it always sorts last (as the server puts a new or retried message last).
function nextTime(messages: ScholarMessage[]): string {
  let at = Date.now();
  for (const message of messages) {
    const sent = Date.parse(message.createdAt);
    if (Number.isFinite(sent) && sent >= at) at = sent + 1;
  }
  return new Date(at).toISOString();
}

// The person's message as the screen shows it while its answer is on its way: their words, or for a spoken message the words it
// already has (a retry) and otherwise "Voice message" until the transcript arrives.
function localMessage(request: Request, previous: ScholarMessage | undefined, createdAt: string): ScholarMessage {
  return {
    id: request.messageId,
    conversationId: request.conversationId,
    role: "user",
    replyTo: null,
    inputType: request.input.type,
    status: "pending",
    errorCode: null,
    blocks: request.input.type === "text"
      ? [{ type: "text", text: request.input.text }]
      : previous?.blocks.filter((block) => block.type === "text") ?? [],
    isHeavy: previous?.isHeavy ?? false,
    helpLine: null,
    createdAt,
  };
}

type Loaded =
  | { kind: "error" }
  | { kind: "missing" }
  | { kind: "ready"; id: string; conversation: ScholarConversation | null; messages: ScholarMessage[] };

// What is on the server for the conversation the screen opens: by its id, by its reflection, or nothing for a new one (its id
// was made on the phone). A conversation found by its reflection and gone by the time it is read is a new one. Never throws.
async function readConversation(params: Params, newId: string): Promise<Loaded> {
  let id = params.conversationId ?? newId;
  if (params.conversationId === undefined) {
    if (params.entryId === undefined) return { kind: "ready", id, conversation: null, messages: [] };
    const lookup = await findConversationForEntry(params.entryId);
    if (!lookup.ok) return { kind: "error" };
    if (lookup.data === null) return { kind: "ready", id, conversation: null, messages: [] };
    id = lookup.data.id;
  }
  const result = await getConversation(id);
  if (!result.ok) return { kind: "error" };
  if (result.data.conversation === null) {
    return params.conversationId !== undefined ? { kind: "missing" } : { kind: "ready", id: newId, conversation: null, messages: [] };
  }
  return { kind: "ready", id, conversation: result.data.conversation, messages: result.data.messages };
}

function hasReadyAnswer(messages: ScholarMessage[]): boolean {
  return messages.some((message) => message.role === "scholar" && message.status === "ready");
}

export function useConversation(params: Params) {
  const source = startedSource(params);
  // A new conversation has nothing to read: it is ready at once (the load still runs, for the starter).
  const [phase, setPhase] = useState<ConversationPhase>(() =>
    params.conversationId !== undefined || params.entryId !== undefined ? "loading" : "ready"
  );
  const [conversationId, setConversationId] = useState(() => params.conversationId ?? randomUUID());
  const [conversation, setConversation] = useState<ScholarConversation | null>(null);
  const [messages, setMessages] = useState<ScholarMessage[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ConversationNotice | null>(null);
  const [usage, setUsage] = useState<ScholarUsage | null>(null);
  const [entry, setEntry] = useState<HomeEntry | null>(null);
  const [breakNote, setBreakNote] = useState(false);
  // The answers that arrived during this visit: they fade in, and "Scholar answered" is announced for each one.
  const [fresh, setFresh] = useState<string[]>([]);

  // The latest values for the callbacks below, written only in callbacks.
  const list = useRef<ScholarMessage[]>([]);
  const idRef = useRef(conversationId);
  const entryIdRef = useRef<string | null>(params.entryId ?? null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const loads = useRef(0);
  const watches = useRef(0);
  // A starter waits for the AI permission, and is sent once.
  const starter = useRef<string | null>(params.starter !== undefined ? copy.scholar.starters[params.starter] : null);
  // The takes this visit sent, for a retry: the file is deleted once it is uploaded, and the length is only checked.
  const takes = useRef(new Map<string, { uri: string; durationMs: number }>());

  const put = useCallback((next: ScholarMessage[]) => {
    list.current = next;
    setMessages(next);
  }, []);

  const mark = useCallback(
    (messageId: string, errorCode: string) => {
      put(list.current.map((message) => (message.id === messageId ? { ...message, status: "failed", errorCode } : message)));
    },
    [put],
  );

  const finishTurn = useCallback(() => {
    busy.current = false;
    setSendingId(null);
  }, []);

  // Reads the conversation every few seconds while a message it already has is still being answered (sent on another visit, or
  // the server is still working on it), and gives up after a minute: the message then offers "Try again".
  const watchPending = useCallback(
    (id: string, messageId: string, since: number) => {
      const run = ++watches.current;
      const stale = () => !mounted.current || run !== watches.current;
      void (async () => {
        for (;;) {
          await wait(SCHOLAR_PENDING_POLL_MS);
          if (stale()) return;
          const result = await getConversation(id);
          if (stale()) return;
          if (result.ok && result.data.conversation !== null) {
            const fresh = result.data.messages;
            const mine = fresh.find((message) => message.id === messageId);
            const replied = fresh.some((message) => message.replyTo === messageId && message.status === "ready");
            if (replied || (mine !== undefined && mine.status !== "pending")) {
              setConversation(result.data.conversation);
              put(fresh);
              finishTurn();
              return;
            }
          }
          if (Date.now() - since >= SCHOLAR_PENDING_MS) {
            mark(messageId, "TIMEOUT");
            finishTurn();
            return;
          }
        }
      })();
    },
    [finishTurn, mark, put],
  );

  const settle = useCallback(
    (request: Request, result: TurnResult, firstTurn: boolean) => {
      if (!mounted.current) return;
      if (result.ok) {
        finishTurn();
        const { conversation: saved, message, answer, usage: dayUsage } = result.data;
        idRef.current = saved.id;
        entryIdRef.current = saved.entryId;
        setConversationId(saved.id);
        setConversation(saved);
        setUsage(dayUsage);
        const rest = list.current.filter(
          (item) => item.id !== request.messageId && item.id !== message.id && item.id !== answer.id,
        );
        put([...rest, message, answer]);
        takes.current.delete(request.messageId);
        setNotice(null);
        setFresh((ids) => [...ids, answer.id]);
        // Nothing is sent about a heavy conversation (Analytics Rules).
        if (!saved.isHeavy && !answer.isHeavy) {
          if (firstTurn) track("scholar_conversation_started", { source });
          track("scholar_message_sent", {
            mode: request.input.type === "audio" ? "voice" : "text",
            turn: firstTurn ? "first" : "follow_up",
          });
          if (answerCount(list.current) >= SCHOLAR_BREAK_NUDGE_TURNS) setBreakNote(true);
        }
        return;
      }
      const { code } = result;
      if (code === "ALREADY_PROCESSING") {
        // Another request is answering this very message: wait for it as for one found on opening.
        watchPending(idRef.current, request.messageId, Date.now());
        return;
      }
      finishTurn();
      if (code === "NOT_FOUND") {
        // The conversation, or the reflection it belongs to, was deleted meanwhile.
        setPhase("missing");
        return;
      }
      if (code === "NO_PERMISSION") {
        put(list.current.filter((message) => message.id !== request.messageId));
        return;
      }
      if (code === "NO_SPEECH" || code === "AUDIO_NOT_FOUND") {
        // A spoken message with no words is not kept on the screen; one whose words were saved stays, with "Try again".
        const current = list.current.find((message) => message.id === request.messageId);
        if (current !== undefined && messageText(current).length > 0) mark(request.messageId, code);
        else put(list.current.filter((message) => message.id !== request.messageId));
        setNotice("noWords");
        return;
      }
      mark(request.messageId, code);
      if (code === "LIMIT_REACHED") {
        if (result.usage !== null) setUsage(result.usage);
        setNotice(result.usage?.kind === "pro_day" ? "proLimit" : "freeLimit");
      } else if (code === "RATE_LIMITED") {
        setNotice("rateLimited");
      } else if (code === "SCHOLAR_UNAVAILABLE") {
        setNotice("resting");
      } else if (code === "SCHOLAR_ADULTS_ONLY") {
        setNotice("adultsOnly");
      } else if (code === "UPLOAD_FAILED") {
        setNotice("uploadFailed");
      } else if (code === "OFFLINE") {
        setNotice("offline");
      }
    },
    [finishTurn, mark, put, source, watchPending],
  );

  const start = useCallback(
    (request: Request, take: { uri: string; durationMs: number } | undefined) => {
      const firstTurn = !hasReadyAnswer(list.current);
      busy.current = true;
      setNotice(null);
      setSendingId(request.messageId);
      const previous = list.current.find((message) => message.id === request.messageId);
      // A retry moves the message to the end, as the server does.
      const others = list.current.filter((message) => message.id !== request.messageId);
      put([...others, localMessage(request, previous, nextTime(others))]);
      if (take !== undefined) takes.current.set(request.messageId, take);
      void sendTurn(request, take === undefined ? undefined : { uri: take.uri }).then((result) =>
        settle(request, result, firstTurn)
      );
    },
    [put, settle],
  );

  const entryField = useCallback((): { entryId?: string } => {
    return entryIdRef.current === null ? {} : { entryId: entryIdRef.current };
  }, []);

  // A typed message. False when nothing was sent (empty, too long, a turn in flight, offline): the composer keeps the words.
  const send = useCallback(
    (text: string): boolean => {
      const words = text.trim();
      if (words.length === 0 || words.length > SCHOLAR_MAX_MESSAGE_LENGTH || busy.current) return false;
      if (!canReachScholar()) {
        setNotice("offline");
        return false;
      }
      start(
        { conversationId: idRef.current, messageId: randomUUID(), input: { type: "text", text: words }, ...entryField() },
        undefined,
      );
      return true;
    },
    [entryField, start],
  );

  // A finished take. Under a second it is too short to hear; offline or during a turn it is kept for later.
  const sendSpoken = useCallback(
    (take: SpokenTake): SpokenSend => {
      if (take.durationMs < SCHOLAR_MIN_SPOKEN_MS) {
        setNotice("tooShort");
        return "too_short";
      }
      if (busy.current) return "kept";
      if (!canReachScholar()) {
        setNotice("offline");
        return "kept";
      }
      start(
        {
          conversationId: idRef.current,
          messageId: take.messageId,
          input: { type: "audio", durationMs: Math.round(take.durationMs) },
          ...entryField(),
        },
        { uri: take.uri, durationMs: take.durationMs },
      );
      return "sent";
    },
    [entryField, start],
  );

  // "Try again" sends the same message under the same id: the server answers it once, and replays an answer it already has.
  const retry = useCallback(
    (messageId: string) => {
      if (busy.current) return;
      const message = list.current.find((item) => item.id === messageId && item.role === "user" && item.status === "failed");
      if (message === undefined) return;
      if (!canReachScholar()) {
        setNotice("offline");
        return;
      }
      const take = takes.current.get(messageId);
      // The server reads a spoken message's length only to check it, and answers from the words it saved or the recording it
      // has. A message read back from the server, whose take this phone no longer holds, goes with the shortest valid length.
      const input: ScholarInput = message.inputType === "audio"
        ? { type: "audio", durationMs: Math.round(take?.durationMs ?? SCHOLAR_MIN_SPOKEN_MS) }
        : { type: "text", text: messageText(message) };
      if (input.type === "text" && input.text.length === 0) return;
      start({ conversationId: idRef.current, messageId, input, ...entryField() }, take);
    },
    [entryField, start],
  );

  // The starter of a new conversation, once the AI permission is given (on opening, or from the sheet's Allow).
  const sendStarter = useCallback(() => {
    const text = starter.current;
    if (text === null || !hasAiPermission()) return;
    if (send(text)) starter.current = null;
  }, [send]);

  // What is on the server for this conversation, and the turn this session still has in flight for it.
  const load = useCallback(async () => {
    const run = ++loads.current;
    const stale = () => !mounted.current || run !== loads.current;
    const read = await readConversation(
      { conversationId: params.conversationId, entryId: params.entryId },
      idRef.current,
    );
    if (stale()) return;
    if (read.kind !== "ready") {
      setPhase(read.kind);
      return;
    }
    const { id, conversation: found, messages: loaded } = read;
    const entryId = params.entryId ?? found?.entryId ?? null;
    idRef.current = id;
    entryIdRef.current = entryId;
    setConversationId(id);
    setConversation(found);
    setPhase("ready");
    if (entryId !== null) {
      void getEntry(entryId)
        .then((value) => {
          if (!stale()) setEntry(value);
        })
        .catch(() => undefined);
    }

    // The turn sent on an earlier visit of this session: its message is drawn again and its answer awaited.
    const running = getTurnInFlight(id);
    if (running !== null) {
      const others = loaded.filter((message) => message.id !== running.messageId);
      const local = localMessage(running.request, loaded.find((message) => message.id === running.messageId), nextTime(others));
      const firstTurn = !hasReadyAnswer(loaded);
      put([...others, local]);
      busy.current = true;
      setSendingId(running.messageId);
      void running.promise.then((result) => settle(running.request, result, firstTurn));
      return;
    }
    // A message the server is still answering: under a minute old, wait for it; older, it offers "Try again".
    const people = orderMessages(loaded).filter((message) => message.role === "user");
    const last = people[people.length - 1];
    if (last !== undefined && last.status === "pending" && !loaded.some((message) => message.replyTo === last.id)) {
      const since = Date.parse(last.createdAt);
      if (Number.isFinite(since) && Date.now() - since < SCHOLAR_PENDING_MS) {
        put(loaded);
        busy.current = true;
        setSendingId(last.id);
        watchPending(id, last.id, since);
        return;
      }
      put(loaded.map((message) => (message.id === last.id ? { ...message, status: "failed", errorCode: "TIMEOUT" } : message)));
      return;
    }
    put(loaded);
    sendStarter();
  }, [params.conversationId, params.entryId, put, sendStarter, settle, watchPending]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const reload = useCallback(() => {
    setPhase("loading");
    void load();
  }, [load]);

  // The ⋯ menu's Delete forever. Online only; the screen goes back afterwards.
  const remove = useCallback(async (): Promise<boolean> => {
    const result = await deleteConversation(idRef.current);
    return result.ok;
  }, []);

  // A conversation opened from a reflection that was a heavy moment starts heavy on the server, so it is heavy here from the
  // start, before its first answer: no chips, the help button, no heads-up and no event.
  const heavy = isHeavyConversation(conversation, messages) || entry?.isCrisis === true;
  const rows = buildConversationRows(messages, sendingId);
  // The heads-up: a free account with one or two messages left today, never in a heavy conversation.
  const headsUp =
    !heavy && usage?.kind === "free_day" && usage.remaining > 0 && usage.remaining <= SCHOLAR_LOW_REMAINING
      ? usage.remaining
      : null;

  return {
    phase,
    conversationId,
    conversation,
    messages,
    rows,
    entry,
    heavy,
    help: newestHelpLine(messages, entry?.isCrisis === true ? entry.helpLine : null),
    sending: sendingId !== null,
    notice,
    headsUp,
    breakNote: breakNote && !heavy,
    fresh,
    send,
    sendSpoken,
    retry,
    sendStarter,
    dismissNotice: () => setNotice(null),
    reload,
    remove,
  };
}

export type Conversation = ReturnType<typeof useConversation>;
