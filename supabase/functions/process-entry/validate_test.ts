import { assertEquals, expectAppError } from "./testing/assert.ts";
import { MAX_BODY_BYTES } from "./constants.ts";
import { readJsonBody, validateRequest } from "./validate.ts";

const USER = "user_abc";
const ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";
const PATH = `${USER}/raw/${ID}.m4a`;
const audio = (over: Record<string, unknown> = {}) => ({
  clientEntryId: ID,
  inputType: "audio",
  audioPath: PATH,
  durationMs: 10_000,
  mimeType: "audio/mp4",
  ...over,
});
const text = (over: Record<string, unknown> = {}) => ({
  clientEntryId: ID,
  inputType: "text",
  text: "x".repeat(20),
  ...over,
});

Deno.test("a valid text request comes back trimmed and in the contract's shape", () => {
  assertEquals(validateRequest(text({ text: "  hello there friend  ", user_id: "someone_else" }), USER), {
    clientEntryId: ID,
    inputType: "text",
    text: "hello there friend",
  });
});

Deno.test("text length: 9 is too short, 10 and 5000 pass, 5001 is too long, spaces do not count", async () => {
  await expectAppError(() => validateRequest(text({ text: "123456789" }), USER), "TOO_SHORT");
  await expectAppError(() => validateRequest(text({ text: "   123456789   " }), USER), "TOO_SHORT");
  validateRequest(text({ text: "1234567890" }), USER);
  validateRequest(text({ text: "a".repeat(5000) }), USER);
  await expectAppError(() => validateRequest(text({ text: "a".repeat(5001) }), USER), "PAYLOAD_TOO_LARGE");
  await expectAppError(() => validateRequest(text({ text: 12345678901 }), USER), "INVALID_REQUEST", "text_type");
});

Deno.test("clientEntryId must be a lowercase UUID v4", async () => {
  for (
    const bad of [
      undefined,
      "",
      "abc",
      ID.toUpperCase(),
      "3f2b8c1e-5a4d-1e6f-9b7a-1c2d3e4f5a6b",
      "3f2b8c1e-5a4d-4e6f-cb7a-1c2d3e4f5a6b",
      7,
    ]
  ) {
    await expectAppError(
      () => validateRequest(text({ clientEntryId: bad }), USER),
      "INVALID_REQUEST",
      "client_entry_id",
    );
  }
});

Deno.test("only text and audio are input types, and the body must be an object", async () => {
  await expectAppError(() => validateRequest(text({ inputType: "video" }), USER), "INVALID_REQUEST", "input_type");
  for (const bad of [null, [], "x", 5]) {
    await expectAppError(() => validateRequest(bad, USER), "INVALID_REQUEST", "body_shape");
  }
});

Deno.test("a valid audio request passes with its exact path", () => {
  assertEquals(validateRequest(audio(), USER), {
    clientEntryId: ID,
    inputType: "audio",
    audioPath: PATH,
    durationMs: 10_000,
    mimeType: "audio/mp4",
  });
});

Deno.test("the audio path is exactly this user's, for this entry", async () => {
  for (
    const bad of [
      `user_other/raw/${ID}.m4a`,
      `${USER}/raw/00000000-0000-4000-8000-000000000000.m4a`,
      `${USER}/devotionals/${ID}.wav`,
      `${USER}/raw/${ID}.mp3`,
      `${USER}/raw/../${ID}.m4a`,
      `${PATH} `,
      undefined,
    ]
  ) {
    await expectAppError(() => validateRequest(audio({ audioPath: bad }), USER), "INVALID_REQUEST", "audio_path");
  }
});

Deno.test("audio mime type and duration rules", async () => {
  for (const mime of ["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac"]) {
    validateRequest(audio({ mimeType: mime }), USER);
  }
  await expectAppError(() => validateRequest(audio({ mimeType: "audio/wav" }), USER), "INVALID_REQUEST", "audio_mime");
  await expectAppError(() => validateRequest(audio({ durationMs: 2999 }), USER), "TOO_SHORT");
  validateRequest(audio({ durationMs: 3000 }), USER);
  validateRequest(audio({ durationMs: 302_000 }), USER);
  await expectAppError(() => validateRequest(audio({ durationMs: 302_001 }), USER), "PAYLOAD_TOO_LARGE");
  for (const bad of [-1, NaN, Infinity, "10000", null, undefined]) {
    await expectAppError(() => validateRequest(audio({ durationMs: bad }), USER), "INVALID_REQUEST", "audio_duration");
  }
});

Deno.test("an audioBase64 field is refused, whatever else the request holds", async () => {
  await expectAppError(() => validateRequest(audio({ audioBase64: "AAAA" }), USER), "INVALID_REQUEST", "audio_base64");
  await expectAppError(() => validateRequest(text({ audioBase64: "AAAA" }), USER), "INVALID_REQUEST", "audio_base64");
});

function request(
  body: BodyInit | null,
  headers: Record<string, string> = { "Content-Type": "application/json" },
): Request {
  return new Request("https://x.test/", { method: "POST", headers, body });
}

Deno.test("readJsonBody: content type, size, and JSON", async () => {
  assertEquals(await readJsonBody(request('{"a":1}')), { a: 1 });
  await expectAppError(
    () => readJsonBody(request('{"a":1}', { "Content-Type": "text/plain" })),
    "INVALID_REQUEST",
    "content_type",
  );
  await expectAppError(() => readJsonBody(request("{nope")), "INVALID_REQUEST", "json");
  await expectAppError(() => readJsonBody(request("")), "INVALID_REQUEST", "json");
  // Over the limit by the declared length...
  const big = JSON.stringify({ text: "a".repeat(MAX_BODY_BYTES) });
  await expectAppError(
    () => readJsonBody(request(big, { "Content-Type": "application/json", "Content-Length": String(big.length) })),
    "PAYLOAD_TOO_LARGE",
  );
  // ...and by the bytes actually read, when no length is declared (a chunked body).
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunk = new Uint8Array(16 * 1024).fill(97);
      for (let index = 0; index < 8; index += 1) controller.enqueue(chunk);
      controller.close();
    },
  });
  await expectAppError(
    () =>
      readJsonBody(
        new Request(
          "https://x.test/",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: stream,
            duplex: "half",
          } as RequestInit,
        ),
      ),
    "PAYLOAD_TOO_LARGE",
    "body_size",
  );
});
