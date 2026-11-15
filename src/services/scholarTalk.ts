import { AppState, type NativeEventSubscription } from "react-native";

import {
  SCHOLAR_TALK_CONNECT_TIMEOUT_MS,
  SCHOLAR_TALK_END_GRACE_MS,
  SCHOLAR_TALK_REFRESH_MS,
  SCHOLAR_VOICE_END_RETRIES_MS,
} from "@/constants/app";
import type { ScholarVoiceKey } from "@/constants/scholarVoices";
import { finishTalk, getConversation, startTalk } from "@/data/scholarRepository";
import { track } from "@/services/analytics";
import { holdAwake, quietBeforeTalk, restorePlaybackMode } from "@/services/talkAudio";
import type { HelpKind, ScholarUsage, ScholarVoiceLimits } from "@/types";
import { isHeavyConversation, newestHelpLine } from "@/utils/scholarRows";

// A live talk with Scholar (step 39), as the app sees it: one talk at a time, its phase, who is speaking, its cap and why it
// ended. The Talk screen owns ElevenLabs' connection and hands this file its three controls (start, end, mute) and its events;
// nothing here imports ElevenLabs, so the Node checks run it. Every limit is the server's: the talk's own cap arrives with the
// start, and what is left of the month with the end.
//
// - Before a talk the app's own sound stops and the screen stays awake; after it the playback mode comes back.
// - A talk ends when the person ends it, at its cap (after Scholar finishes its sentence, or 20 seconds later), when GraceHush
//   goes to the background (the lock or the Home Screen; never for "inactive", which Control Center makes), and when the
//   connection drops. Its end is told to the server at once, and tried twice more if that fails.
// - After each of Scholar's answers the conversation is read again from the server: a talk that turns heavy keeps no countdown,
//   is never cut, and is never counted or tracked.
// - Nothing of a talk is kept on the phone, and nothing is logged.

export type TalkPhase = "idle" | "starting" | "connecting" | "live" | "ending" | "ended" | "failed";
export type TalkMode = "listening" | "thinking" | "speaking";
export type TalkEndedBy = "person" | "cap" | "left_app" | "dropped";

// The last talk that ended, for the Conversation screen: which conversation it was started from (`requestedId`), the one its
// turns were saved in (the server's), and what is left of the month once the server has said so. `seq` changes at each change.
export type LastTalk = { requestedId: string; conversationId: string; limits: ScholarVoiceLimits | null; seq: number };

export type TalkState = {
  phase: TalkPhase;
  mode: TalkMode;
  muted: boolean;
  conversationId: string | null;
  talkId: string | null;
  voice: ScholarVoiceKey | null;
  heavy: boolean;
  help: HelpKind | null;
  // The talk's own countdown in seconds, or null when it has none (a heavy conversation).
  secondsLeft: number | null;
  capReached: boolean;
  endedBy: TalkEndedBy | null;
  // Why the talk could not start: the server's code (or the repository's), and a 402's numbers.
  failure: { code: string; usage: ScholarUsage | null } | null;
  last: LastTalk | null;
};

// What the Talk screen gives this file: ElevenLabs' session, behind three calls.
export type TalkControls = {
  start: (conversationToken: string, session: string) => void | Promise<void>;
  end: () => void | Promise<void>;
  setMuted: (muted: boolean) => void;
};

// What the Talk screen tells this file. `user_spoke` is a finished transcript of the person's words (never read here).
export type TalkEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "mode"; mode: "speaking" | "listening" }
  | { type: "user_spoke" }
  | { type: "error" };

const IDLE: TalkState = {
  phase: "idle",
  mode: "listening",
  muted: false,
  conversationId: null,
  talkId: null,
  voice: null,
  heavy: false,
  help: null,
  secondsLeft: null,
  capReached: false,
  endedBy: null,
  failure: null,
  last: null,
};

let state: TalkState = IDLE;
// Raised by every start and every end, so an answer that arrives for an older talk changes nothing.
let generation = 0;
let controls: TalkControls | null = null;
let pending: { token: string; session: string } | null = null;
let requestedId: string | null = null;
let startedAt: number | null = null;
let talkSeconds: number | null = null;
let monthLimits: ScholarVoiceLimits | null = null;
let seq = 0;
let countdown: ReturnType<typeof setInterval> | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let appState: NativeEventSubscription | null = null;
let closing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function set(patch: Partial<TalkState>) {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

export function getTalkState(): TalkState {
  return state;
}

export function subscribeTalk(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function active(phase: TalkPhase = state.phase): boolean {
  return phase === "starting" || phase === "connecting" || phase === "live";
}

function stopCountdown() {
  if (countdown !== null) clearInterval(countdown);
  countdown = null;
  if (graceTimer !== null) clearTimeout(graceTimer);
  graceTimer = null;
}

function clearTimers() {
  stopCountdown();
  if (connectTimer !== null) clearTimeout(connectTimer);
  connectTimer = null;
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function watchAppState() {
  appState?.remove();
  // The lock and the Home Screen send "background"; Control Center and a system sheet send only "inactive", which never ends a
  // talk (decision 36).
  appState = AppState.addEventListener("change", (next) => {
    if (next === "background") void finish("left_app");
  });
}

// The phone's side of a talk that is over, or never started: the screen may sleep again, and the app's playback mode comes back.
async function releaseLocal() {
  appState?.remove();
  appState = null;
  holdAwake(false);
  await restorePlaybackMode();
}

function lengthBucket(seconds: number): "under_1" | "1_to_5" | "over_5" {
  if (seconds < 60) return "under_1";
  return seconds <= 300 ? "1_to_5" : "over_5";
}

// Starts a talk in a conversation, as the Talk screen opens. One talk at a time: a second call while one is on does nothing.
// `heavy` and `help` are what the Conversation screen already knows; the server's answer and each refresh can only add to them.
export async function beginTalk(input: {
  conversationId: string;
  entryId: string | null;
  heavy?: boolean;
  help?: HelpKind | null;
}): Promise<void> {
  if (active() || state.phase === "ending") return;
  const gen = ++generation;
  clearTimers();
  pending = null;
  startedAt = null;
  talkSeconds = null;
  monthLimits = null;
  requestedId = input.conversationId;
  set({
    ...IDLE,
    last: state.last,
    phase: "starting",
    conversationId: input.conversationId,
    heavy: input.heavy === true,
    help: input.help ?? null,
  });
  quietBeforeTalk();
  holdAwake(true);
  watchAppState();
  const result = await startTalk({ conversationId: input.conversationId, entryId: input.entryId });
  if (gen !== generation) {
    // Ended while it was starting: the talk the server opened is closed at once.
    if (result.ok) closing = closeOnServer(result.data.talkId, null);
    return;
  }
  if (!result.ok) {
    await releaseLocal();
    if (gen !== generation) return;
    set({ phase: "failed", failure: { code: result.code, usage: result.usage } });
    return;
  }
  const start = result.data;
  const heavy = state.heavy || start.heavy;
  talkSeconds = heavy ? null : start.limits.talkSeconds;
  monthLimits = start.limits;
  pending = { token: start.conversationToken, session: start.session };
  set({
    phase: "connecting",
    talkId: start.talkId,
    conversationId: start.conversationId,
    voice: start.voice,
    heavy,
    secondsLeft: talkSeconds,
  });
  connectTimer = setTimeout(() => {
    connectTimer = null;
    if (gen === generation && state.phase === "connecting") void finish("dropped");
  }, SCHOLAR_TALK_CONNECT_TIMEOUT_MS);
  // A heavy conversation's help line is pinned from the start: it is read from the conversation's answers.
  if (heavy) void refresh(gen);
  await launch(gen);
}

// Hands the token and the session to ElevenLabs once both the start's answer and the screen's controls are here.
async function launch(gen: number) {
  if (controls === null || pending === null || state.phase !== "connecting" || gen !== generation) return;
  const { token, session } = pending;
  pending = null;
  try {
    await controls.start(token, session);
  } catch {
    if (gen === generation) void finish("dropped");
  }
}

// The Talk screen's controls, while it is mounted. The returned function takes them back.
export function attachTalkControls(next: TalkControls): () => void {
  controls = next;
  void launch(generation);
  return () => {
    if (controls === next) controls = null;
  };
}

export function talkEvent(event: TalkEvent): void {
  switch (event.type) {
    case "connected":
      if (state.phase !== "connecting") return;
      if (connectTimer !== null) clearTimeout(connectTimer);
      connectTimer = null;
      startedAt = Date.now();
      set({ phase: "live", mode: "listening" });
      startCountdown();
      if (!state.heavy && state.voice !== null) track("scholar_talk_started", { voice: state.voice });
      return;
    case "mode":
      if (state.phase !== "live") return;
      if (event.mode === "speaking") {
        set({ mode: "speaking" });
        return;
      }
      if (state.mode === "speaking") {
        // Scholar finished speaking: an answer was saved. The conversation is read again, and a talk at its cap ends now.
        set({ mode: "listening" });
        scheduleRefresh();
        if (state.capReached) void finish("cap");
        return;
      }
      if (state.mode !== "thinking") set({ mode: "listening" });
      return;
    case "user_spoke":
      if (state.phase === "live" && state.mode === "listening") set({ mode: "thinking" });
      return;
    case "disconnected":
    case "error":
      if (state.phase === "connecting" || state.phase === "live") {
        void finish(state.capReached ? "cap" : "dropped", event.type === "disconnected");
      }
      return;
  }
}

function startCountdown() {
  stopCountdown();
  if (talkSeconds === null || state.heavy) return;
  tick();
  countdown = setInterval(tick, 1_000);
}

function tick() {
  if (startedAt === null || talkSeconds === null || state.phase !== "live") return;
  const left = Math.max(0, talkSeconds - Math.floor((Date.now() - startedAt) / 1_000));
  if (left !== state.secondsLeft) set({ secondsLeft: left });
  if (left > 0 || state.capReached) return;
  stopCountdown();
  set({ capReached: true });
  // At the cap Scholar finishes its sentence first, for 20 seconds at most.
  if (state.mode !== "speaking") {
    void finish("cap");
    return;
  }
  const gen = generation;
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (gen === generation) void finish("cap");
  }, SCHOLAR_TALK_END_GRACE_MS);
}

function scheduleRefresh() {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  const gen = generation;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh(gen);
  }, SCHOLAR_TALK_REFRESH_MS);
}

// The conversation as the server now has it: a talk that turned heavy keeps no countdown and is never cut, and the help line on
// the screen follows the newest answer that carries one.
async function refresh(gen: number) {
  const id = state.conversationId;
  if (id === null) return;
  const result = await getConversation(id);
  if (gen !== generation || !result.ok || result.data.conversation === null) return;
  const heavy = isHeavyConversation(result.data.conversation, result.data.messages);
  if (!heavy) return;
  if (!state.heavy) {
    stopCountdown();
    talkSeconds = null;
  }
  set({ heavy: true, help: newestHelpLine(result.data.messages, state.help), secondsLeft: null, capReached: false });
}

// Ends the talk for the given reason. `closed` says ElevenLabs' connection is already gone.
async function finish(reason: TalkEndedBy, closed = false): Promise<void> {
  const phase = state.phase;
  if (!active(phase)) return;
  ++generation;
  clearTimers();
  const { talkId, heavy, voice, conversationId } = state;
  const seconds = startedAt === null ? 0 : (Date.now() - startedAt) / 1_000;
  startedAt = null;
  pending = null;
  set({ phase: "ending", endedBy: reason, mode: "listening", muted: false });
  if (!closed && phase !== "starting" && controls !== null) {
    try {
      await controls.end();
    } catch {
      // The connection is closing anyway.
    }
  }
  await releaseLocal();
  // Nothing about a heavy talk is tracked, nor a talk that never went live.
  if (phase === "live" && !heavy && voice !== null) {
    track("scholar_talk_ended", { length: lengthBucket(seconds), ended_by: reason });
  }
  seq += 1;
  const last: LastTalk | null =
    requestedId === null || conversationId === null
      ? null
      : { requestedId, conversationId, limits: heavy ? null : monthLimits, seq };
  set({ phase: "ended", last });
  if (talkId !== null) closing = closeOnServer(talkId, last);
}

// Tells the server the talk is over: at once, then twice more if that fails. The account's next start closes it anyway.
async function closeOnServer(talkId: string, last: LastTalk | null): Promise<void> {
  for (let attempt = 0; attempt <= SCHOLAR_VOICE_END_RETRIES_MS.length; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, SCHOLAR_VOICE_END_RETRIES_MS[attempt - 1]));
    const result = await finishTalk(talkId);
    if (result.ok) {
      // Shown only while this is still the last talk, and never for a heavy one (nothing of it is counted).
      if (last !== null && state.last?.seq === last.seq && last.limits !== null) {
        seq += 1;
        set({ last: { ...last, limits: result.limits, seq } });
      }
      return;
    }
    if (result.code === "NOT_FOUND" || result.code === "INVALID_REQUEST" || result.code === "UNAUTHORIZED") return;
  }
}

// The person ends the talk (End, Close, the back key, leaving the screen). Also the cap's and the tests' way in.
export function endTalk(reason: TalkEndedBy = "person"): Promise<void> {
  return finish(reason);
}

export function setTalkMuted(muted: boolean): void {
  if (state.phase !== "live" || controls === null) return;
  controls.setMuted(muted);
  set({ muted });
}

// The Talk screen has gone: an ended or failed talk goes back to idle, and the last talk stays for the Conversation screen.
export function resetTalk(): void {
  if (state.phase === "ended" || state.phase === "failed") set({ ...IDLE, last: state.last });
}

// Sign-out and account deletion: a talk on its way ends first, and nothing of it is kept. Its end is told to the server while
// the session still works; sign-out does not wait for the retries.
export async function endLiveTalk(): Promise<void> {
  await finish("person");
  ++generation;
  clearTimers();
  requestedId = null;
  monthLimits = null;
  set(IDLE);
}

// For the checks: the end the server is being told about.
export function talkClosing(): Promise<void> {
  return closing;
}
