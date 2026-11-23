import { AppError } from "../errors.ts";
import { looksLikeWav } from "../tts/wavDuration.ts";
import { LISTEN_SPEECH_FORMAT, listenSpeechTiming, SPEECH, VOICE_TOKEN_TIMEOUT_MS } from "./constants.ts";

// The only code that talks to ElevenLabs from the server (step 39): a one-time token for a talk, the list of an agent's talks, and
// the deletion of one; and since 2026-11-19 an answer part read aloud in a chosen voice (Listen), and the deletion of what
// ElevenLabs keeps of that reading. The API key travels in the xi-api-key header and nowhere else. Nothing here logs, and no error
// carries ElevenLabs' message (it can quote what was sent): a failure is a short word of ours, with ElevenLabs' own status word
// when it is a snake_case code ("missing_permissions", "quota_exceeded").

const API = "https://api.elevenlabs.io";

const timedOut = (error: unknown) =>
  error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");

// ElevenLabs' own word for an error ({ detail: { status } }), when it is a snake_case code. Its message is never kept.
function elevenWord(raw: string): string {
  try {
    const detail = (JSON.parse(raw) as { detail?: unknown } | null)?.detail;
    const word = typeof detail === "object" && detail !== null ? (detail as { status?: unknown }).status : null;
    return typeof word === "string" && /^[a-z][a-z0-9_]{2,40}$/.test(word) ? word : "";
  } catch {
    return "";
  }
}

// A one-time token for one talk with one agent. The agents are private, so a talk cannot start without it, and only this
// server can ask for one. ElevenLabs at capacity (429) is "resting", every other failure "try again".
export async function mintConversationToken(apiKey: string, agentId: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API}/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(VOICE_TOKEN_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError("AI_UNAVAILABLE", timedOut(error) ? "voice:token_timeout" : "voice:token_network");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) throw new AppError("SCHOLAR_UNAVAILABLE", "voice:capacity");
    throw new AppError("AI_UNAVAILABLE", `voice:token_http_${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AppError("AI_UNAVAILABLE", "voice:token_bad_body");
  }
  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || token.length < 16 || token.length > 8192) {
    throw new AppError("AI_UNAVAILABLE", "voice:token_bad_body");
  }
  return token;
}

// A talk as ElevenLabs lists it: its id, the agent it belongs to and where it stands ("initiated", "in-progress", "processing",
// "done" or "failed").
export type ListedTalk = { id: string; agentId: string | null; status: string };

export type Failed = { ok: false; reason: string };
export type Listed = { ok: true; talks: ListedTalk[] } | Failed;

// One agent's talks, newest first (ElevenLabs' own order), at most a page of 100.
export async function listTalks(apiKey: string, agentId: string, timeoutMs: number): Promise<Listed> {
  let response: Response;
  try {
    response = await fetch(`${API}/v1/convai/conversations?agent_id=${encodeURIComponent(agentId)}&page_size=100`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, reason: timedOut(error) ? "list_timeout" : "list_network" };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, reason: `list_http_${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "list_bad_body" };
  }
  const rows = (body as { conversations?: unknown } | null)?.conversations;
  if (!Array.isArray(rows)) return { ok: false, reason: "list_bad_body" };
  const talks: ListedTalk[] = [];
  for (const row of rows) {
    const { conversation_id: id, agent_id: agent, status } = (row ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(id) || typeof status !== "string") continue;
    talks.push({ id, agentId: typeof agent === "string" ? agent : null, status });
  }
  return { ok: true, talks };
}

// Deletes one talk at ElevenLabs: its words, its summary and its record. A talk that is not there any more is done.
export async function deleteTalk(apiKey: string, id: string, timeoutMs: number): Promise<{ ok: true } | Failed> {
  let response: Response;
  try {
    response = await fetch(`${API}/v1/convai/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, reason: timedOut(error) ? "delete_timeout" : "delete_network" };
  }
  await response.body?.cancel();
  if (response.ok || response.status === 404) return { ok: true };
  return { ok: false, reason: `delete_http_${response.status}` };
}

// Listen in the chosen voice (2026-11-19). ElevenLabs keeps every reading (its text and its sound) in the workspace's history until
// it is deleted, whatever the request asks: zero retention is for Enterprise accounts (measured: a request with
// enable_logging=false still answered a history item). So every reading says what ElevenLabs kept of it (`kept`), and the caller
// deletes it (deleteSpeech), whether or not the reading could be used:
//   { historyId }        the item ElevenLabs keeps.
//   { lost: "missing" }  ElevenLabs read the part but named no item.
//   { lost: "unknown" }  the request ended before ElevenLabs answered (capMs), so whether it kept one is not known.
//   null                 nothing kept: ElevenLabs refused the request, or it never reached ElevenLabs.
// A reading slower than answerMs is given up on (the caller reads the part another way), but its request stays open until capMs,
// so that if the reading still comes, `kept` names it and it can be deleted.
export type Kept = { historyId: string } | { lost: "missing" | "unknown" } | null;

export type VoiceSpeech =
  | { ok: true; audio: Uint8Array; kept: Promise<Kept> }
  | { ok: false; reason: string; kept: Promise<Kept> };

const HISTORY_ID = /^[A-Za-z0-9]{8,64}$/;
// Anything smaller is not speech (as synthesize.ts).
const MIN_AUDIO_BYTES = 1_024;

type SpeechReply =
  | { kind: "answered"; status: number; bytes: Uint8Array; historyId: string | null }
  | { kind: "timeout" | "network"; historyId: string | null };

function keptOf(reply: SpeechReply): Kept {
  if (reply.historyId !== null) return { historyId: reply.historyId };
  if (reply.kind === "answered") return reply.status >= 200 && reply.status < 300 ? { lost: "missing" } : null;
  return reply.kind === "timeout" ? { lost: "unknown" } : null;
}

async function requestSpeech(apiKey: string, voiceId: string, text: string, capMs: number): Promise<SpeechReply> {
  let historyId: string | null = null;
  try {
    const response = await fetch(
      `${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${LISTEN_SPEECH_FORMAT}`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: SPEECH.model,
          voice_settings: { stability: SPEECH.stability, similarity_boost: SPEECH.similarity, speed: SPEECH.speed },
        }),
        signal: AbortSignal.timeout(capMs),
      },
    );
    // Taken before the sound is read, so a reading whose sound is cut off can still be deleted.
    const id = response.headers.get("history-item-id");
    historyId = id !== null && HISTORY_ID.test(id) ? id : null;
    return {
      kind: "answered",
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
      historyId,
    };
  } catch (error) {
    return { kind: timedOut(error) ? "timeout" : "network", historyId };
  }
}

// One part of an answer read aloud in one voice (a ready-made voice of voices.ts), as a WAV at 24 kHz.
export async function speakInVoice(
  apiKey: string,
  voiceId: string,
  text: string,
  timing: { answerMs: number; capMs: number } = listenSpeechTiming,
): Promise<VoiceSpeech> {
  const reply = requestSpeech(apiKey, voiceId, text, timing.capMs);
  const kept = reply.then(keptOf);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timing.answerMs);
  });
  const first = await Promise.race([reply, slow]);
  clearTimeout(timer);
  if (first === null) return { ok: false, reason: "speech_timeout", kept };
  if (first.kind !== "answered") {
    return { ok: false, reason: first.kind === "timeout" ? "speech_timeout" : "speech_network", kept };
  }
  const { status, bytes } = first;
  if (status < 200 || status >= 300) {
    const word = elevenWord(new TextDecoder().decode(bytes.subarray(0, 4_096)));
    return { ok: false, reason: `speech_http_${status}${word ? `:${word}` : ""}`, kept };
  }
  if (bytes.length < MIN_AUDIO_BYTES) return { ok: false, reason: "speech_empty", kept };
  if (!looksLikeWav(bytes)) return { ok: false, reason: "speech_not_wav", kept };
  return { ok: true, audio: bytes, kept };
}

export type DeleteTiming = { deleteMs: number; deleteEveryMs: number; deleteForMs: number };

// Deletes what ElevenLabs keeps of one reading: its text and its sound. The key needs History write (a 401 "missing_permissions"
// otherwise). ElevenLabs saves the item a moment after the reading answers, and until then a DELETE answers 404
// "invalid_parameters" (measured 2026-11-21 with the production key: a DELETE at +1 ms and at +359 ms answered 404 while the item
// already read 200 from +550 ms; one at +1.2 s answered 200, and the item then read 400 "invalid_id"). An item already deleted
// answers 200, so a 404 here never means "gone": it is tried again every deleteEveryMs until deleteForMs have passed since the
// first try, each try ending after deleteMs. Until 2026-11-21 a 404 counted as done, which left every reading at ElevenLabs.
export async function deleteSpeech(
  apiKey: string,
  historyId: string,
  timing: DeleteTiming = listenSpeechTiming,
): Promise<{ ok: true } | Failed> {
  const until = Date.now() + timing.deleteForMs;
  for (;;) {
    const once = await deleteOnce(apiKey, historyId, timing.deleteMs);
    if (once.ok || !once.notSaved || Date.now() + timing.deleteEveryMs > until) {
      return once.ok ? { ok: true } : { ok: false, reason: once.reason };
    }
    await new Promise((resolve) => setTimeout(resolve, timing.deleteEveryMs));
  }
}

async function deleteOnce(
  apiKey: string,
  historyId: string,
  timeoutMs: number,
): Promise<{ ok: true } | (Failed & { notSaved: boolean })> {
  let response: Response;
  try {
    response = await fetch(`${API}/v1/history/${encodeURIComponent(historyId)}`, {
      method: "DELETE",
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, reason: timedOut(error) ? "history_timeout" : "history_network", notSaved: false };
  }
  if (response.ok) {
    await response.body?.cancel();
    return { ok: true };
  }
  const word = elevenWord(await response.text().catch(() => ""));
  return {
    ok: false,
    reason: `history_http_${response.status}${word ? `:${word}` : ""}`,
    notSaved: response.status === 404,
  };
}
