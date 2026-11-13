import { optionalEnv } from "../_shared/env.ts";
import { verifyVoiceSession } from "../_shared/voice/session.ts";

// Live voice (step 39), the TEST RUN: Scholar's custom LLM endpoint as ElevenLabs calls it. In the real version this is where
// every spoken turn is screened and answered by Scholar's rules before a word is spoken. The test run answers with fixed
// test sentences only, after a delay the phone chooses, so the platform can be measured: what ElevenLabs sends (the shape,
// never the words), how long a reply may take before the agent gives up or fills in, and whether the person can interrupt.
//
// The caller is ElevenLabs, never the phone: it must send the shared secret (ELEVENLABS_LLM_SECRET, stored in ElevenLabs
// as the agent's custom LLM API key), and the talk's owner comes only from the signed session in the extra body.

const MAX_BODY_BYTES = 256 * 1024;
const MAX_DELAY_MS = 15_000;
const encoder = new TextEncoder();

type Shape = {
  spike: "voice-llm";
  requestId: string;
  path: string;
  auth: "bearer" | "x-api-key" | "api-key" | "none" | "wrong";
  keys: string[];
  messages: number;
  roles: string;
  extraKeys: string[] | null;
  session: "ok" | "bad" | "none";
  stream: boolean | null;
  delayMs: number;
  firstChunkMs: number | null;
  totalMs: number;
  status: number;
};

function sameSecret(a: string, b: string): boolean {
  // Length is not secret here (the shared secret has a fixed shape); the bytes are compared without an early exit.
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function readAuth(req: Request, secret: string): Shape["auth"] {
  const bearer = req.headers.get("authorization");
  if (bearer !== null) return sameSecret(bearer.replace(/^Bearer\s+/i, "").trim(), secret) ? "bearer" : "wrong";
  const xApiKey = req.headers.get("x-api-key");
  if (xApiKey !== null) return sameSecret(xApiKey.trim(), secret) ? "x-api-key" : "wrong";
  const apiKey = req.headers.get("api-key");
  if (apiKey !== null) return sameSecret(apiKey.trim(), secret) ? "api-key" : "wrong";
  return "none";
}

// Fixed test words: the first after a talk starts, then turns cycle. Long enough to interrupt.
function testReply(turn: number, delayMs: number, sessionOk: boolean): string {
  if (!sessionOk) return "This test talk could not be checked, so I won't go on. Please end it and start again.";
  const waited = delayMs === 0
    ? "I answered at once."
    : `I waited ${Math.round(delayMs / 1000)} seconds before answering.`;
  const lines = [
    `This is test answer ${turn}. ${waited} Try interrupting me while I speak, and I should stop right away. ` +
    "If you let me finish, say anything else and I'll answer again.",
    `Test answer ${turn}. ${waited} Here is a longer sentence on purpose, so there is time to cut in: ` +
    "the quiet of an early morning, a cup of tea going cold, and a list of things to do that can wait a minute.",
    `Test answer ${turn}. ${waited} Everything you say in this test is only for measuring the timing, and nothing is kept.`,
  ];
  return lines[(turn - 1) % lines.length];
}

function chunk(id: string, created: number, delta: Record<string, string>, finish: string | null): Uint8Array {
  const body = {
    id,
    object: "chat.completion.chunk",
    created,
    model: "scholar-test",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return encoder.encode(`data: ${JSON.stringify(body)}\n\n`);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function handle(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const shape: Shape = {
    spike: "voice-llm",
    requestId: crypto.randomUUID(),
    path: new URL(req.url).pathname.replace(/^.*\/scholar-voice-llm/, "") || "/",
    auth: "none",
    keys: [],
    messages: 0,
    roles: "",
    extraKeys: null,
    session: "none",
    stream: null,
    delayMs: 0,
    firstChunkMs: null,
    totalMs: 0,
    status: 200,
  };
  const finish = (response: Response): Response => {
    shape.status = response.status;
    shape.totalMs = Date.now() - startedAt;
    // TEST RUN ONLY: the shape of the request, never a word of it. Removed when the real endpoint replaces this one.
    if (!response.body || response.status !== 200 || shape.stream === false) console.log(JSON.stringify(shape));
    return response;
  };

  if (req.method !== "POST") return finish(json(405, { error: { message: "Method not allowed" } }));
  const secret = optionalEnv("ELEVENLABS_LLM_SECRET");
  if (!secret || secret.length < 32) return finish(json(500, { error: { message: "Not configured" } }));
  shape.auth = readAuth(req, secret);
  if (shape.auth === "none" || shape.auth === "wrong") return finish(json(401, { error: { message: "Unauthorized" } }));

  const text = await req.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) return finish(json(413, { error: { message: "Too large" } }));
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return finish(json(400, { error: { message: "Bad request" } }));
  }

  shape.keys = Object.keys(body).sort();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  shape.messages = messages.length;
  shape.roles = messages
    .map((message) => String((message as { role?: unknown } | null)?.role ?? "?").slice(0, 1))
    .join("");
  shape.stream = typeof body.stream === "boolean" ? body.stream : null;
  const extra = body.elevenlabs_extra_body;
  const extraObject = typeof extra === "object" && extra !== null && !Array.isArray(extra)
    ? extra as Record<string, unknown>
    : null;
  shape.extraKeys = extraObject ? Object.keys(extraObject).sort() : null;

  const sessionSecret = optionalEnv("SCHOLAR_VOICE_SESSION_SECRET") ?? "";
  const session = extraObject && sessionSecret.length >= 32
    ? await verifyVoiceSession(sessionSecret, extraObject.session)
    : null;
  shape.session = extraObject?.session === undefined ? "none" : session ? "ok" : "bad";
  const requestedDelay = Number(extraObject?.delayMs);
  shape.delayMs = Number.isFinite(requestedDelay) ? Math.max(0, Math.min(MAX_DELAY_MS, Math.round(requestedDelay))) : 0;
  const bufferWords = extraObject?.bufferWords === true;

  const turn = Math.max(
    1,
    messages.filter((message) => (message as { role?: unknown } | null)?.role === "user").length,
  );
  const reply = testReply(turn, shape.delayMs, session !== null);
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  if (shape.stream === false) {
    await new Promise((resolve) => setTimeout(resolve, shape.delayMs));
    return finish(json(200, {
      id,
      object: "chat.completion",
      created,
      model: "scholar-test",
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
    }));
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (bufferWords) {
          controller.enqueue(chunk(id, created, { role: "assistant", content: "... " }, null));
          shape.firstChunkMs = Date.now() - startedAt;
        }
        await new Promise((resolve) => setTimeout(resolve, shape.delayMs));
        const sentences = reply.match(/[^.!?]+[.!?]+\s*/g) ?? [reply];
        sentences.forEach((sentence, index) => {
          const delta: Record<string, string> = index === 0 && !bufferWords
            ? { role: "assistant", content: sentence }
            : { content: sentence };
          controller.enqueue(chunk(id, created, delta, null));
          if (shape.firstChunkMs === null) shape.firstChunkMs = Date.now() - startedAt;
        });
        controller.enqueue(chunk(id, created, {}, "stop"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        shape.totalMs = Date.now() - startedAt;
        console.log(JSON.stringify(shape));
        controller.close();
      }
    },
  });
  return finish(
    new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    }),
  );
}
