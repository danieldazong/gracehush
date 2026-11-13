import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { signVoiceSession, VOICE_SESSION_TTL_MS } from "../_shared/voice/session.ts";
import { handle } from "./handler.ts";

// The test run's custom LLM endpoint (step 39): who may call it, and the OpenAI-style stream ElevenLabs reads.

const LLM_SECRET = "llm-secret-0123456789abcdef0123456789abcdef";
const SESSION_SECRET = "session-secret-0123456789abcdef0123456789";

function setEnv() {
  Deno.env.set("ELEVENLABS_LLM_SECRET", LLM_SECRET);
  Deno.env.set("SCHOLAR_VOICE_SESSION_SECRET", SESSION_SECRET);
}

async function session(): Promise<string> {
  const now = Date.now();
  return await signVoiceSession(SESSION_SECRET, {
    userId: "user_1",
    issuedAt: now,
    expiresAt: now + VOICE_SESSION_TTL_MS,
  });
}

function request(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${LLM_SECRET}` }): Request {
  return new Request("https://example.test/functions/v1/scholar-voice-llm/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function readStream(response: Response): Promise<{ chunks: Record<string, unknown>[]; done: boolean }> {
  const text = await response.text();
  const events = text.split("\n\n").filter((part) => part.startsWith("data: "));
  const done = events.at(-1) === "data: [DONE]";
  const chunks = events.filter((part) => part !== "data: [DONE]").map((part) => JSON.parse(part.slice(6)));
  return { chunks, done };
}

const messages = [
  { role: "system", content: "ignored" },
  { role: "assistant", content: "Hi" },
  { role: "user", content: "made-up words" },
];

Deno.test("only ElevenLabs with the shared secret may call it", async () => {
  setEnv();
  assertEquals((await handle(request({ messages }, {}))).status, 401);
  assertEquals((await handle(request({ messages }, { authorization: "Bearer wrong" }))).status, 401);
  const get = await handle(new Request("https://example.test/functions/v1/scholar-voice-llm", { method: "GET" }));
  assertEquals(get.status, 405);
});

Deno.test("a signed session gets a streamed test answer in OpenAI's chunk format, ending with [DONE]", async () => {
  setEnv();
  const response = await handle(
    request({ messages, stream: true, elevenlabs_extra_body: { session: await session(), delayMs: 0 } }),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/event-stream");
  const { chunks, done } = await readStream(response);
  assert(done, "the stream ends with [DONE]");
  const first = (chunks[0].choices as { delta: Record<string, string> }[])[0].delta;
  assertEquals(first.role, "assistant");
  const text = chunks.map((chunk) => (chunk.choices as { delta: { content?: string } }[])[0].delta.content ?? "").join(
    "",
  );
  assert(text.startsWith("This is test answer 1."), "the first user turn gets test answer 1");
  assert(!text.includes("made-up words"), "the person's words are never echoed");
  const last = (chunks.at(-1)?.choices as { finish_reason: string | null }[])[0];
  assertEquals(last.finish_reason, "stop");
});

Deno.test("a missing or forged session gets the refusal, never a normal answer", async () => {
  setEnv();
  for (const extra of [undefined, { session: "forged.token" }]) {
    const response = await handle(request({ messages, stream: true, elevenlabs_extra_body: extra }));
    const { chunks } = await readStream(response);
    const text = chunks.map((chunk) => (chunk.choices as { delta: { content?: string } }[])[0].delta.content ?? "")
      .join(
        "",
      );
    assert(text.startsWith("This test talk could not be checked"), "an unchecked talk is refused");
  }
});
