import { AppError } from "../errors.ts";
import { VOICE_TOKEN_TIMEOUT_MS } from "./constants.ts";

// The only code that talks to ElevenLabs from the server (step 39): a one-time token for a talk, the list of an agent's talks, and
// the deletion of one. The API key travels in the xi-api-key header and nowhere else. Nothing here logs, and no error carries
// ElevenLabs' own words (they can quote what was sent): a failure is a short word of ours.

const API = "https://api.elevenlabs.io";

const timedOut = (error: unknown) =>
  error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");

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
