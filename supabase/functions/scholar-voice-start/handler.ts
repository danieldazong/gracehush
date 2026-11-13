import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { optionalEnv } from "../_shared/env.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import { signVoiceSession, VOICE_SESSION_TTL_MS } from "../_shared/voice/session.ts";

// Live voice (step 39), the TEST RUN: starts one talk with Scholar's ElevenLabs agent. The phone sends its Clerk token; the
// server asks ElevenLabs for a one-time conversation token for the private agent (the API key never leaves the server) and
// signs who the talk belongs to (_shared/voice/session.ts). The phone hands both to the ElevenLabs SDK. The real version adds
// the allowance, the consent and the conversation; this one only proves the platform.

export type VoiceStartResponse = { conversationToken: string; session: string; expiresAt: string };

const ELEVENLABS_TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token";
const TOKEN_TIMEOUT_MS = 8_000;

type VoiceConfig = { apiKey: string; agentId: string; sessionSecret: string };

function readVoiceConfig(): VoiceConfig {
  const apiKey = optionalEnv("ELEVENLABS_API_KEY");
  if (!apiKey || !/^sk_[A-Za-z0-9]{20,}$/.test(apiKey)) throw new AppError("INTERNAL", "bad_config:ELEVENLABS_API_KEY");
  const agentId = optionalEnv("ELEVENLABS_AGENT_ID");
  if (!agentId || !/^[A-Za-z0-9_-]{8,80}$/.test(agentId)) {
    throw new AppError("INTERNAL", "bad_config:ELEVENLABS_AGENT_ID");
  }
  const sessionSecret = optionalEnv("SCHOLAR_VOICE_SESSION_SECRET");
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new AppError("INTERNAL", "bad_config:SCHOLAR_VOICE_SESSION_SECRET");
  }
  return { apiKey, agentId, sessionSecret };
}

async function mintConversationToken(config: VoiceConfig): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${ELEVENLABS_TOKEN_URL}?agent_id=${encodeURIComponent(config.agentId)}`, {
      headers: { "xi-api-key": config.apiKey },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AppError("AI_UNAVAILABLE", timedOut ? "voice:token_timeout" : "voice:token_network");
  }
  if (!response.ok) {
    await response.body?.cancel();
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

type Context = { requestId: string; startedAt: number; userHash: string | null; authMs: number };

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const authStarted = Date.now();
  const user = await verifyClerkRequest(req, readAuthConfig());
  context.authMs = Date.now() - authStarted;
  context.userHash = await shortHash(user.userId);

  const config = readVoiceConfig();
  const conversationToken = await mintConversationToken(config);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + VOICE_SESSION_TTL_MS;
  const session = await signVoiceSession(config.sessionSecret, { userId: user.userId, issuedAt, expiresAt });
  const answer: VoiceStartResponse = { conversationToken, session, expiresAt: new Date(expiresAt).toISOString() };
  return jsonResponse(200, answer, corsHeaders);
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = { requestId: crypto.randomUUID(), startedAt: Date.now(), userHash: null, authMs: 0 };
  let status = 200;
  let failure: AppError | null = null;
  try {
    if (req.method === "OPTIONS") {
      status = 204;
      return preflightResponse();
    }
    const response = await run(req, context);
    status = response.status;
    return response;
  } catch (error) {
    failure = error instanceof AppError
      ? error
      : new AppError("INTERNAL", `unhandled:${error instanceof Error ? error.name : "unknown"}`);
    status = failure.status;
    return errorResponse(failure, context.requestId, corsHeaders);
  } finally {
    // The shared allow-list: the token, the session and the ElevenLabs answer are never logged.
    writeLog(
      blankLogLine({
        requestId: context.requestId,
        status,
        code: failure?.code ?? null,
        reason: failure?.reason ?? (status === 200 ? "voice:start" : null),
        user: context.userHash,
        authMs: context.authMs,
        totalMs: Date.now() - context.startedAt,
      }),
    );
  }
}
