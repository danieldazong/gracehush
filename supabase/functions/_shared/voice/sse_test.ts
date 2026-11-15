import { assert, assertEquals } from "../../process-entry/testing/assert.ts";
import { VOICE_LINES } from "./lines.ts";
import { HOLD_PAD, openVoiceStream } from "./sse.ts";

// The stream ElevenLabs reads (step 39): OpenAI's chat-completion chunks as server-sent events.

type Chunk = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: { index: number; delta: { role?: string; content?: string }; finish_reason: string | null }[];
};

// Every event of a finished response: the parsed chunks, and whether the last event was [DONE].
async function events(response: Response): Promise<{ chunks: Chunk[]; done: boolean; raw: string }> {
  const raw = await response.text();
  const lines = raw.split("\n\n").filter((part) => part !== "");
  for (const line of lines) assert(line.startsWith("data: "), "every event is one data line");
  const payloads = lines.map((line) => line.slice("data: ".length));
  const done = payloads.at(-1) === "[DONE]";
  return {
    chunks: payloads.filter((payload) => payload !== "[DONE]").map((payload) => JSON.parse(payload)),
    done,
    raw,
  };
}

Deno.test("stream: what is said arrives piece by piece, the first with the assistant's role, then the stop and [DONE]", async () => {
  const stream = openVoiceStream();
  assertEquals(stream.response.status, 200);
  assertEquals(stream.response.headers.get("content-type"), "text/event-stream");
  assertEquals(stream.response.headers.get("cache-control"), "no-cache");
  assert(stream.open());
  assertEquals(stream.say("Give me a moment to think about that."), true);
  assertEquals(stream.say("  A reading from Psalm 23, verse 1.  "), true);
  assertEquals(stream.say("The Lord is my shepherd; I shall not want."), true);
  assertEquals(stream.said(), 3);
  stream.end();
  assertEquals(stream.open(), false);

  const { chunks, done } = await events(stream.response);
  assert(done, "the stream ends with [DONE]");
  assertEquals(chunks.length, 4);
  assertEquals(chunks.map((chunk) => chunk.choices[0].delta), [
    { role: "assistant", content: "Give me a moment to think about that. " },
    { content: "A reading from Psalm 23, verse 1. " },
    { content: "The Lord is my shepherd; I shall not want. " },
    {},
  ]);
  assertEquals(chunks.map((chunk) => chunk.choices[0].finish_reason), [null, null, null, "stop"]);
  // One answer: the same id and time on every chunk, in OpenAI's shape.
  assertEquals(new Set(chunks.map((chunk) => chunk.id)).size, 1);
  assertEquals(new Set(chunks.map((chunk) => chunk.created)).size, 1);
  assert(/^chatcmpl-[0-9a-f-]{36}$/.test(chunks[0].id), "an id of its own");
  for (const chunk of chunks) {
    assertEquals(chunk.object, "chat.completion.chunk");
    assertEquals(chunk.model, "scholar");
    assertEquals(chunk.choices.length, 1);
    assertEquals(chunk.choices[0].index, 0);
  }
});

Deno.test("stream: quotation marks, apostrophes and line breaks survive as one event each", async () => {
  const stream = openVoiceStream();
  stream.say('He said, "Peace, be still."\nAnd it’s quiet — “a great calm”.');
  stream.end();
  const { chunks, raw } = await events(stream.response);
  assertEquals(chunks[0].choices[0].delta.content, 'He said, "Peace, be still."\nAnd it’s quiet — “a great calm”. ');
  // The line break is inside the JSON, so it cannot split the event.
  assertEquals(raw.split("\n\n").filter((part) => part !== "").length, 3);
});

Deno.test("stream: an answer with no words is the assistant's turn with nothing in it", async () => {
  const stream = openVoiceStream();
  assertEquals(stream.say("   "), false);
  assertEquals(stream.say(""), false);
  assertEquals(stream.said(), 0);
  stream.end();
  const { chunks, done } = await events(stream.response);
  assert(done);
  assertEquals(chunks.map((chunk) => chunk.choices[0].delta), [{ role: "assistant" }, {}]);
  assertEquals(chunks.map((chunk) => chunk.choices[0].finish_reason), [null, "stop"]);
});

Deno.test("stream: a holding line goes out with its pad in one piece, and is not counted as a piece of the answer", async () => {
  const stream = openVoiceStream();
  assertEquals(stream.hold("  I’m here. Give me a moment. "), true);
  assertEquals(stream.said(), 0);
  assertEquals(stream.hold("   "), false);
  assertEquals(stream.say("Thank you for telling me."), true);
  assertEquals(stream.hold("I’m still here with you."), true);
  assertEquals(stream.said(), 1);
  stream.end();
  assertEquals(stream.hold("This is never heard."), false);

  const { chunks, done } = await events(stream.response);
  assert(done);
  // The first piece carries the role, whichever kind it is; the pad follows the line in the same piece.
  assertEquals(chunks.map((chunk) => chunk.choices[0].delta), [
    { role: "assistant", content: `I’m here. Give me a moment. ${HOLD_PAD}` },
    { content: "Thank you for telling me. " },
    { content: `I’m still here with you. ${HOLD_PAD}` },
    {},
  ]);

  // A reply that ends after a holding line alone has its role once, and still no piece of an answer.
  const only = openVoiceStream();
  only.hold(VOICE_LINES.hold);
  only.end();
  assertEquals(only.said(), 0);
  const alone = await events(only.response);
  assertEquals(alone.chunks.map((chunk) => chunk.choices[0].delta), [
    { role: "assistant", content: `${VOICE_LINES.hold} ${HOLD_PAD}` },
    {},
  ]);
});

Deno.test("stream: the pad is sixteen zero-width words, which ElevenLabs counts and no voice can say", () => {
  assertEquals(HOLD_PAD, "\u200B ".repeat(16));
  // Nothing in it can be said: zero-width spaces, each with a space after it. Twelve ellipses were voiced by some voices.
  assert(/^(?:\u200B )+$/.test(HOLD_PAD));
  assert(!/[\p{L}\p{N}\p{P}\p{S}]/u.test(HOLD_PAD));
  // As measured (2026-11-13): ElevenLabs' buffer counts words, and one run of zero-width spaces with no space between them
  // was not counted. So the pad is sixteen separate words, and every holding line with its pad is at least eighteen.
  const words = (text: string) => text.split(" ").filter((word) => word.length > 0).length;
  assertEquals(words(HOLD_PAD), 16);
  for (const line of [VOICE_LINES.hold, VOICE_LINES.holdHeavy, VOICE_LINES.secondHoldHeavy]) {
    assert(words(`${line} ${HOLD_PAD}`) >= 18, line);
  }
});

Deno.test("stream: nothing is said after the end, and ending twice changes nothing", async () => {
  const stream = openVoiceStream();
  stream.say("Okay.");
  stream.end();
  assertEquals(stream.say("One more thing."), false);
  stream.end();
  assertEquals(stream.said(), 1);
  const { chunks, done } = await events(stream.response);
  assert(done);
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].choices[0].delta, { role: "assistant", content: "Okay. " });
});

Deno.test("stream: a reader that goes away is the end of the stream, never an error", async () => {
  const stream = openVoiceStream();
  assertEquals(stream.say("I’m here. Give me a moment."), true);
  // ElevenLabs stops reading: the person spoke again, or the attempt was given up.
  await stream.response.body?.cancel();
  assertEquals(stream.open(), false);
  assertEquals(stream.say("This is never heard."), false);
  stream.end();
  assertEquals(stream.said(), 1);
});

Deno.test("stream: two answers never share an id", () => {
  const first = openVoiceStream();
  const second = openVoiceStream();
  first.say("One.");
  second.say("Two.");
  first.end();
  second.end();
  return Promise.all([events(first.response), events(second.response)]).then(([one, two]) => {
    assert(one.chunks[0].id !== two.chunks[0].id, "each answer has its own id");
  });
});
